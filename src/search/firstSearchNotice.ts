/**
 * The notice before a phone web search sends the query to a provider it has
 * not been told about yet: what leaves the phone, and to whom. Pure decision
 * logic — the host owns the dialog and AsyncStorage is injected, so the gate
 * is testable without a UI and without a device.
 *
 * Consent is PER PROVIDER, not per install. The search has more than one
 * possible recipient: the active provider, and — when it fails — the free Exa
 * MCP fallback that searchWeb sends the query to. A user who agreed to send
 * queries to Brave has not agreed to send them to Exa, so each recipient is
 * named once, the first time this install sends a query to it.
 *
 * Fail CLOSED. A gate that cannot read its own stored state cannot claim the
 * user ever said yes, so the search does not run. Same for an unknown provider
 * name: the copy names the provider, and copy that cannot name who receives
 * the query is not a consent. Only the exact stored format counts — a value
 * this module cannot parse is a value this module never wrote, so it is not a
 * consent.
 *
 * Desk-mode chats that search from the PC are a different path and are out of
 * scope here: this gate guards the phone-local providers only.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

import { getStrings, type Locale } from "../i18n";
import { PROVIDERS, PROVIDER_IDS, type SearchProviderId } from "./registry";

/** The accepted providers, one entry per install. Same AsyncStorage pattern as
 *  the other one-time choices (PROVIDER_STORAGE_KEY, GOVERNOR_ENABLED_KEY). */
export const SEARCH_CONSENT_KEY = "kalsa.search.consent.v1";

/** The format marker: anything without it is a value this module never wrote,
 *  and is therefore not read as consent. */
const CONSENT_FORMAT = "v1";

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

/**
 * "allow" the search · "deny" — the user chose "Not now": this search is
 * skipped and the notice comes back next time for that provider · "unavailable"
 * — the gate could not be resolved, so the search did not run.
 */
export type SearchConsentVerdict = "allow" | "deny" | "unavailable";

export type SearchConsentStorage = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

/**
 * The name the notice shows, or null when the id names no registered provider.
 * A copy that cannot name who receives the query is not consent, so the caller
 * treats null as "unavailable".
 */
export function providerDisplayName(id: SearchProviderId | null | undefined): string | null {
  if (!id) return null;
  return PROVIDERS[id]?.name ?? null;
}

/** The providers this install has already been told about. Anything this
 *  module cannot parse yields the empty set: no provider is accepted. */
export function parseSearchConsent(raw: string | null | undefined): SearchProviderId[] {
  if (typeof raw !== "string") return [];
  const prefix = `${CONSENT_FORMAT}:`;
  if (!raw.startsWith(prefix)) return [];
  const accepted = raw
    .slice(prefix.length)
    .split(",")
    .filter((id) => (PROVIDER_IDS as string[]).includes(id));
  return accepted as SearchProviderId[];
}

/** One pending dialog per provider, so two searches for the SAME provider
 *  share one question instead of stacking two copies of it. */
const pending = new Map<SearchProviderId, Promise<SearchConsentVerdict>>();

/** Every dialog, and every dialog's read-modify-write of the consent key, runs
 *  on this one chain. Two providers must never show two Alerts at once (the
 *  platform's behaviour for concurrent dialogs is not something this app
 *  should depend on), and a read-modify-write outside the chain could drop a
 *  provider another dialog accepted while it was open. */
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
 * Resolve the consent for sending a query to `providerId` on this install.
 *
 * `signal` is the turn's cancellation. It is honoured twice: a turn cancelled
 * before its turn in the queue never shows a dialog at all, and one cancelled
 * while its dialog is open resolves immediately so the queue moves on. RN's
 * Alert cannot be dismissed programmatically, so a tap on a prompt whose turn
 * is over is discarded rather than acted on.
 *
 * `confirm` must resolve false on dismiss as well as on "Not now" — an
 * unanswered dialog is not consent — and runs with no focused button, so a
 * stray Enter never accepts the search.
 *
 * A failed write after "Search" still runs the search: the user answered yes,
 * and asking again next time is the honest outcome of a storage that is down.
 */
export async function confirmSearchProvider(args: {
  locale: Locale;
  providerId: SearchProviderId;
  confirm: (providerName: string) => Promise<boolean>;
  signal?: AbortSignal;
  storage?: SearchConsentStorage;
}): Promise<SearchConsentVerdict> {
  const storage: SearchConsentStorage = args.storage ?? AsyncStorage;
  const providerName = providerDisplayName(args.providerId);
  if (providerName === null) return "unavailable";
  let accepted: SearchProviderId[];
  try {
    // Read OUTSIDE the chain on purpose: an already-accepted provider must not
    // queue behind an unrelated open dialog. The read that guards the WRITE is
    // the one inside askOnce.
    accepted = parseSearchConsent(await withStorageTimeout(storage.getItem(SEARCH_CONSENT_KEY)));
  } catch {
    return "unavailable";
  }
  if (accepted.includes(args.providerId)) return "allow";

  const alreadyOpen = pending.get(args.providerId);
  if (alreadyOpen) return alreadyOpen;
  const asking = enqueue(async () =>
    // Cancelled while queued: no dialog, no write, and the queue is free.
    args.signal?.aborted ? "deny" : askOnce(args, providerName, storage),
  ).finally(() => {
    pending.delete(args.providerId);
  });
  pending.set(args.providerId, asking);
  return asking;
}

async function askOnce(
  args: {
    providerId: SearchProviderId;
    confirm: (providerName: string) => Promise<boolean>;
    signal?: AbortSignal;
  },
  providerName: string,
  storage: SearchConsentStorage,
): Promise<SearchConsentVerdict> {
  const dialog = args.confirm(providerName);
  let answer = false;
  try {
    answer = await beforeAbort(dialog, args.signal);
  } catch {
    // A dialog that cannot be shown is not consent.
    return "unavailable";
  }
  // Cancelled while the dialog was open: the queue moves on now and any later
  // tap on the stale Alert is discarded. Nothing is persisted for a turn that
  // is over.
  if (!answer) return "deny";

  // Inside the chain, so no other dialog can read-modify-write between here
  // and the setItem below. A read that fails leaves the baseline unknown, and
  // writing a list built from it would erase every OTHER provider's consent —
  // so this query runs on the answer the user just gave and nothing is stored.
  let next: SearchProviderId[];
  try {
    next = [
      ...new Set([
        ...parseSearchConsent(await withStorageTimeout(storage.getItem(SEARCH_CONSENT_KEY))),
        args.providerId,
      ]),
    ];
  } catch {
    return "allow";
  }
  try {
    await withStorageTimeout(storage.setItem(SEARCH_CONSENT_KEY, `${CONSENT_FORMAT}:${next.join(",")}`));
  } catch {
    // Consent given, write refused: run the search and ask again next time.
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

/**
 * The refusal for the PRIMARY provider: nothing was sent, so the model is told
 * the search did not run.
 */
export function searchConsentRefusalText(
  verdict: Exclude<SearchConsentVerdict, "allow">,
  locale: Locale,
): string {
  const notice = getStrings(locale).searchNotice;
  return verdict === "deny" ? notice.declined : notice.unavailable;
}

/**
 * The refusal for the FALLBACK provider. The primary request already went out
 * and failed, so "the search did not run" would be false: this names the
 * provider that received the query and the one it was not sent to. Both the
 * "Not now" answer and the fail-closed unreadable case use it, because the
 * user did not agree to the fallback either way.
 */
export function searchFallbackRefusalText(
  locale: Locale,
  primaryId: SearchProviderId,
  fallbackId: SearchProviderId,
): string {
  const name = (id: SearchProviderId): string => providerDisplayName(id) ?? id;
  return getStrings(locale).searchNotice.fallbackDeclined
    .replace("{primary}", name(primaryId))
    .replace("{fallback}", name(fallbackId));
}