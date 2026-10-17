/**
 * The machinery every one-time "may this leave the phone?" notice needs: the
 * storage bound, the one-dialog-at-a-time queue, and the turn's cancellation.
 *
 * Extracted from firstSearchNotice.ts so the fetch notice gets the same cancel
 * guarantees rather than a second copy of them that can drift. What each gate
 * owns — its own key, its own stored format, and what "accepted" means for it —
 * stays in its own file; this file only knows how to ask once, safely.
 *
 * Pure: the dialog is injected, so a gate is testable without a UI.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * "allow" the one action · "deny" — the user chose "Not now": this action is
 * skipped and the notice comes back next time · "unavailable" — the gate could
 * not be resolved, so the action did not run.
 */
export type ConsentVerdict = "allow" | "deny" | "unavailable";

export type ConsentStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/** Storage is a device call that can wedge; a read or write that never settles
 *  would block every later prompt. The USER'S DIALOG is deliberately not
 *  bounded — how long someone takes to read a notice is theirs to spend. */
const STORAGE_TIMEOUT_MS = 5_000;

function withStorageTimeout<T>(op: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("consent storage timed out")),
      STORAGE_TIMEOUT_MS,
    );
    op.then(
      (value: T) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/** One pending dialog per id, so two asks for the SAME id share one question
 *  instead of stacking two copies of it. */
const pending = new Map<string, Promise<ConsentVerdict>>();

/** Every dialog, and every dialog's read-modify-write of a consent key, runs on
 *  this one chain. Two notices must never show two Alerts at once (the
 *  platform's behaviour for concurrent dialogs is not something this app should
 *  depend on), and a read-modify-write outside the chain could drop an answer
 *  another dialog accepted while it was open. */
let dialogChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = dialogChain.then(task, task);
  dialogChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Resolve one install's one-time answer to `questionId`.
 *
 * `signal` is the turn's cancellation. It is honoured three times: a turn
 * cancelled before its turn in the queue never shows a dialog at all, one
 * cancelled while its dialog is open resolves immediately so the queue moves
 * on, and a queued prompt re-checks the abort inside its own queue slot.
 *
 * `confirm` must resolve false on dismiss as well as on "Not now" — an
 * unanswered dialog is not consent.
 *
 * Fail CLOSED. A gate that cannot read its own stored state cannot claim the
 * user ever said yes, so the action does not run. Same for the stored format:
 * a value this gate cannot parse is a value it never wrote, so it is not a
 * consent.
 *
 * A failed write after the user said yes still runs the action: they answered,
 * and asking again next time is the honest outcome of a storage that is down.
 */
export async function askOncePerInstall(args: {
  /** Which question this is: two asks with the same id share one dialog. */
  questionId: string;
  /** The AsyncStorage key this question persists its answer under. */
  storageKey: string;
  /** True when the stored value already means "this id was accepted". */
  isAccepted: (stored: string | null) => boolean;
  /** The value to store once accepted, built from the baseline read inside the
   *  queue — a gate whose value merges other entries cannot rebuild it from a
   *  write-only memory of what is there. */
  acceptedValue: (baseline: string | null) => string;
  confirm: () => Promise<boolean>;
  signal?: AbortSignal;
  storage?: ConsentStorage;
}): Promise<ConsentVerdict> {
  const storage: ConsentStorage = args.storage ?? AsyncStorage;
  let stored: string | null;
  try {
    // Read OUTSIDE the chain on purpose: an already-accepted question must not
    // queue behind an unrelated open dialog. The read that guards the WRITE is
    // the one inside askOnce.
    stored = await withStorageTimeout(storage.getItem(args.storageKey));
  } catch {
    return "unavailable";
  }
  if (args.isAccepted(stored)) return "allow";

  const alreadyOpen = pending.get(args.questionId);
  if (alreadyOpen) return alreadyOpen;
  const asking = enqueue(async () =>
    // Cancelled while queued: no dialog, no write, and the queue is free.
    args.signal?.aborted ? "deny" : askOnce(args, storage),
  ).finally(() => {
    pending.delete(args.questionId);
  });
  pending.set(args.questionId, asking);
  return asking;
}

async function askOnce(
  args: {
    storageKey: string;
    acceptedValue: (baseline: string | null) => string;
    confirm: () => Promise<boolean>;
    signal?: AbortSignal;
  },
  storage: ConsentStorage,
): Promise<ConsentVerdict> {
  let answer = false;
  try {
    // Inside the try: a confirm that throws synchronously (a host with no
    // dialog to show) is the same "cannot ask" as one that rejects, and must
    // reach the same verdict rather than rejecting the gate.
    answer = await beforeAbort(args.confirm(), args.signal);
  } catch {
    // A dialog that cannot be shown is not consent.
    return "unavailable";
  }
  // Cancelled while the dialog was open: the queue moves on now and any later
  // tap on the stale Alert is discarded. Nothing is persisted for a turn that
  // is over.
  if (!answer) return "deny";

  // Inside the chain, so no other dialog can read-modify-write between here and
  // the setItem below. A read that fails leaves the baseline unknown, and
  // writing a value built from it would claim the user agreed to something this
  // gate never showed them — so this action runs on the answer just given and
  // nothing is stored.
  let baseline: string | null;
  try {
    baseline = await withStorageTimeout(storage.getItem(args.storageKey));
  } catch {
    return "allow";
  }
  try {
    await withStorageTimeout(
      storage.setItem(args.storageKey, args.acceptedValue(baseline)),
    );
  } catch {
    // Consent given, write refused: run the action and ask again next time.
  }
  return "allow";
}

/**
 * The dialog's answer, or false as soon as the turn is cancelled. A late answer
 * is never read: RN's Alert cannot be dismissed programmatically, so the stale
 * prompt may still be on screen, and a tap on it must not persist consent for a
 * turn that has ended.
 */
function beforeAbort(
  dialog: Promise<boolean>,
  signal: AbortSignal | undefined,
): Promise<boolean> {
  if (!signal) return dialog;
  if (signal.aborted) {
    dialog.catch(() => undefined);
    return Promise.resolve(false);
  }
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve(false);
    };
    signal.addEventListener("abort", onAbort);
    dialog.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}