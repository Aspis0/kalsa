import { DOOR_SILENT } from "./chat";
import type { SlotAnswer } from "./chat";

/**
 * The one road to an active chat.
 *
 * The invariant this module exists for: the chat the UI shows as active must
 * never diverge from the chat the door believes resident in this device's slot.
 * A divergence is silent data loss — the next switch saves the slot's state
 * into another chat's file — so becoming active is not a UI decision at all:
 * it is the door's answer, recorded here. Every path that opens a chat goes
 * through `open` (a chat that exists) or `create` (one that does not yet), and
 * the shell reads the result through `useSyncExternalStore`; there is no setter
 * anywhere for it to call.
 *
 * Five bugs the shape removes, each a different way to diverge:
 * - C1: a path that made a chat active without asking the door (an attachment
 *   creating a conversation). There is no setter here, so the path cannot exist.
 * - C2: a second Enter on a chat that does not exist yet made a second chat.
 *   `create` is single-flight — while one is pending the next is ignored, and the
 *   caller can tell because it answers `null` — and `isCurrent` is the guard the
 *   caller uses when its own task finishes late, after the user has moved on.
 * - C3: two quick switches raced on the door's four workers and resolved out of
 *   order, so the last click did not win. Opens run one at a time, in the order
 *   they were asked, so the door's order is the UI's order by construction.
 * - C4: during a switch the outgoing chat stayed live, and a send into it was a
 *   completion that never passed the door's gate. The snapshot's `pending` is
 *   the freeze the shell applies to the composer and retry while it is true.
 * - C5: the window's belief that there was no door was not the same fact as
 *   there being none — a poll tick that failed, or the second between a running
 *   engine and this window's credential, made the client call a live door
 *   "absent" and mint a chat locally against it. `DoorAccess` separates the two,
 *   `unready` holds the open, and the hand-over repairs what was already minted.
 *
 * No React, no DOM, no fetch: the door arrives as an injected `Activate`, so the
 * harness drives this with a fake door and the order is a test rather than a
 * hope.
 */

declare const ACTIVE_CHAT: unique symbol;

/** A chat the door has taken. Minted below and nowhere else, so no other path
    can make a chat active without a door answer. */
export interface ActiveChat {
  readonly id: string;
  readonly [ACTIVE_CHAT]: true;
}

/** What the app tells the user about the slot. `failed` distinguishes a door
    that refused (an alert: the chat did not open) from one built without the
    tier (a status: the chat opened and the door only says what it cannot do). */
export interface SlotNotice {
  failed: boolean;
  message: string;
}

export interface OpenResult {
  /** The chat to show as active, or null when the door refused and the active
      chat must not move. */
  opened: ActiveChat | null;
  /** The slot sentence, null on a plain success. */
  notice: SlotNotice | null;
}

export interface SlotGateSnapshot {
  readonly active: ActiveChat | null;
  /** An open is queued, in flight, or held for a door that is not callable yet:
      the composer and retry stay frozen, and a send that started before this
      must not steal the chat when it lands. */
  readonly pending: boolean;
  /** A chat that does not exist yet is being created. A second creation is
      ignored, never a second chat. */
  readonly creating: boolean;
  /** A sentence the gate itself owes the window: a held open's wait, that
      wait's end as an error, and the hand-over refusal, which has no caller. */
  readonly notice: SlotNotice | null;
}

/** Asks the door to open a chat. Built where the credential lives, and injected:
    this module never reads a token and the harness hands it a fake. */
export type Activate = (id: string) => Promise<SlotAnswer>;

/** What this window knows about the door. Three states, not `Activate | null`:
    `null` was two different facts at once, and only one of them is a licence to
    open a chat locally.
    - `absent`: no door this window can reach — a plain browser (there is no
      endpoint left to point at one), or this app's own server being off. An
      open settles locally on purpose; a door that appears later is the
      hand-over below.
    - `unready`: a door EXISTS and cannot be called yet — the engine is running
      and its address is known while this window's credential is not in hand, or
      the poll has not answered yet. Opening locally here is C5.
    - `ready`: carries the call.
    `absent` is the only state that authorizes a mint. It used to be argued from
    "a brain that is not serving is no door", which is false: the door lives in
    the app's state and outlives the engine. */
export type DoorAccess =
  | { readonly kind: "absent" }
  | { readonly kind: "unready" }
  | { readonly kind: "ready"; readonly activate: Activate };

/** The door's standing, as the poll and the credential fetch leave it. */
export type DoorStanding = "absent" | "unready" | "ready";

/** The standing from the brain's own account and whether this window holds this
    computer's credential. Pure, and here rather than in the poller, because
    this is the rule C5 got wrong and every combination of it is a check the
    harness runs. */
export function standingOf(
  brain: { kind: string; endpoint?: string | null } | null,
  hasCredential: boolean,
): DoorStanding {
  // No answer yet is NOT "no door": a window that has not heard from its own
  // brain does not know whether that brain is serving this slot, and the door
  // it has not heard from may be serving it right now.
  if (brain === null) return "unready";
  // Starting, stopped or failed: no door serves this window at this moment,
  // and an open settles locally until one does. A door that appears later is
  // the hand-over below.
  if (brain.kind !== "running") return "absent";
  // A running engine whose door has no address yet, and a door up whose key
  // this window has not been handed: a door exists either way.
  if (!brain.endpoint) return "unready";
  return hasCredential ? "ready" : "unready";
}

/** One poll's answer folded into what the window already knew. A poll that did
    not answer is `null` and keeps the previous facts: "I could not ask my own
    brain" is not "there is no brain", and reading it as the second is what made
    a lost tick a second of blindness in which a chat could be minted against a
    live slot. `null` in and `null` out is the one case where nothing was ever
    known, which `standingOf` calls `unready` rather than `absent`. */
export function lastKnown<T>(known: T | null, answer: T | null): T | null {
  return answer ?? known;
}

export interface SlotGate {
  /** For `useSyncExternalStore`. Stable identity for the lifetime of the gate. */
  subscribe: (listener: () => void) => () => void;
  /** Cached on purpose: `useSyncExternalStore` compares by identity, and a
      fresh object on every read would re-render the shell without end. */
  getSnapshot: () => SlotGateSnapshot;
  /** Tells the gate what this window knows about the door. A door that has
      become callable takes the active chat over before the answer settles, so a
      caller that awaits this sees the hand-over done; the shell fires and
      forgets. */
  setAccess: (next: DoorAccess) => Promise<void>;
  /** Opens a chat that already exists. Calls queue: two switches run in the
      order they were asked, never at once. */
  open: (id: string) => Promise<OpenResult>;
  /** Opens a chat that does not exist yet, at most one at a time. Answers
      `null` when a creation is already pending — the second Enter is ignored,
      not a second chat. */
  create: (id: string) => Promise<OpenResult | null>;
  /** True only while `chat` is still the active one. A task that finishes late,
      after the user moved on, must check this before it sends. */
  isCurrent: (chat: ActiveChat) => boolean;
  /** True when `id` is already the active chat and nothing is queued, in flight
      or held. The shell's "this one is already open" fast path asks here rather
      than reading the rendered active id: during a switch that id is the
      outgoing chat, and skipping the open on that basis lets an open the user
      has already moved past win. */
  isSettled: (id: string) => boolean;
  /** No active chat — a new conversation, or the active one was deleted. Never
      a divergence: with no active id there is nothing to save under a wrong
      name, and the next open goes through the door. */
  clear: () => void;
  /** The chat is gone from the store. Clears the active chat when it is this
      one, and refuses to take it later: its own open can be in flight when the
      delete lands, and the mint would otherwise make a conversation the store
      no longer has the active one. */
  clearIf: (id: string) => void;
  /** Takes the gate's own sentence down. */
  dismissNotice: () => void;
}

function mint(id: string): ActiveChat {
  // The one cast: the brand has no runtime representation, and this is the only
  // place a chat is minted. `as unknown` because the brand is deliberately not
  // satisfiable from outside.
  return { id } as unknown as ActiveChat;
}

const HOLD_WAITING = "Waiting for this computer's door to become reachable…";
const HOLD_EXPIRED = "This computer's door did not become reachable in time. Try again.";
const HOLD_MS = 15000; // the poll's credential fetch lands well inside; no door is an error, not a freeze

export function createSlotGate(holdMs = HOLD_MS): SlotGate {
  let active: ActiveChat | null = null;
  // Whether a door took the active chat. One this window minted has to be
  // handed over as soon as a door can be called, or the UI keeps showing a chat
  // the slot does not hold.
  let doorTook = false;
  let pending = 0;
  let creating = false;
  let notice: SlotNotice | null = null;
  // Held, not `absent`: a gate that has been told nothing must not mint on the
  // assumption that there is no door. The shell sets this on mount.
  let access: DoorAccess = { kind: "unready" };
  let snapshot: SlotGateSnapshot = { active: null, pending: false, creating: false, notice: null };
  const listeners = new Set<() => void>();
  // Chats this window has deleted: one id per delete in a session.
  const gone = new Set<string>();
  let chain: Promise<unknown> = Promise.resolve();
  let waiting: (() => void)[] = [];

  function publish(): void {
    const next: SlotGateSnapshot = { active, pending: pending > 0, creating, notice };
    if (
      next.active === snapshot.active &&
      next.pending === snapshot.pending &&
      next.creating === snapshot.creating &&
      next.notice === snapshot.notice
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  function changed(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const deadline = setTimeout(() => resolve(true), ms);
      waiting.push(() => { clearTimeout(deadline); resolve(false); });
    });
  }

  async function run(id: string): Promise<OpenResult> {
    // A door that exists and cannot be called yet holds the open here: no
    // request, no slot, above all no mint; the wait speaks and a deadline
    // ends it as an error — no address or no key is a wait forever otherwise.
    while (access.kind === "unready") {
      notice = { failed: false, message: HOLD_WAITING };
      publish();
      if (await changed(holdMs)) {
        notice = { failed: true, message: HOLD_EXPIRED };
        return { opened: null, notice };
      }
    }
    if (notice?.message === HOLD_WAITING) { notice = null; publish(); }
    // The chat may have been deleted while this waited its turn: asking the
    // door for a conversation the window has removed would take the slot for it.
    if (gone.has(id)) return { opened: null, notice: null };
    const via = access;
    let answer: SlotAnswer;
    if (via.kind === "ready") {
      try {
        answer = await via.activate(id);
      } catch {
        // The injected call answered with a rejection instead of a SlotAnswer.
        // Nothing is known about the slot, which is exactly what DOOR_SILENT
        // says.
        answer = { kind: "refused", message: DOOR_SILENT };
      }
    } else {
      // `absent`: the one case an open may settle locally — honest only on
      // the assumption `DoorAccess` states, which this module cannot check.
      answer = { kind: "ok" };
    }
    if (answer.kind === "refused") {
      return { opened: null, notice: { failed: true, message: answer.message } };
    }
    // Deleted while the door was answering: the door took a chat this window
    // has removed, and it does not become the active one.
    if (gone.has(id)) return { opened: null, notice: null };
    const chat = mint(id);
    active = chat;
    doorTook = via.kind === "ready";
    return {
      opened: chat,
      notice: answer.kind === "no-tier" ? { failed: false, message: answer.message } : null,
    };
  }

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    // The chain survives a rejection, or one failed open would wedge the door
    // for the rest of the session.
    chain = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  function open(id: string): Promise<OpenResult> {
    // A new open supersedes whatever the gate last wanted to say: a sentence
    // left up about an earlier hand-over must not come back when this open
    // answers plainly and the shell clears its own.
    notice = null;
    pending += 1;
    publish();
    return enqueue(async () => {
      try {
        return await run(id);
      } finally {
        pending -= 1;
        publish();
      }
    });
  }

  function create(id: string): Promise<OpenResult | null> {
    if (creating) return Promise.resolve(null);
    creating = true;
    publish();
    return open(id).finally(() => {
      creating = false;
      publish();
    });
  }

  /** The door is callable and did not take the active chat: the UI is showing a
      chat the slot does not hold, and the next switch would write the slot's
      state into that chat's file. Opening it on the door is the repair. A
      refusal leaves no chat to fall back to — the refusal is about the only
      chat that was open — so the window ends up with none, with the door's own
      sentence up. */
  function handOver(): Promise<void> {
    pending += 1;
    publish();
    return enqueue(async () => {
      try {
        const chat = active;
        // The person may have opened another chat while this waited its turn,
        // and that one is the door's already.
        if (chat === null || doorTook || gone.has(chat.id)) return;
        const result = await run(chat.id);
        if (result.opened === null) {
          active = null;
          doorTook = false;
          notice = result.notice;
          publish();
        }
      } finally {
        pending -= 1;
        publish();
      }
    });
  }

  function setAccess(next: DoorAccess): Promise<void> {
    const moved = next.kind !== access.kind;
    access = next;
    if (!moved) return Promise.resolve();
    const woken = waiting;
    waiting = [];
    for (const wake of woken) wake();
    if (next.kind !== "ready") {
      // Not callable at all: nothing the door took is known to be in the slot any
      // more. The next door may be a different one — a restart, or the door
      // rebuilt beside a deleted pairing store — and this window cannot tell one
      // door from another by its answer. It is told by losing the credential
      // first (`forgetLocalCredential`), which takes the access through
      // `unready` and clears this.
      doorTook = false;
      return Promise.resolve();
    }
    if (active === null || doorTook) return Promise.resolve();
    return handOver();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot() {
      return snapshot;
    },
    setAccess,
    open,
    create,
    isCurrent(chat) {
      return active === chat;
    },
    isSettled(id) {
      return pending === 0 && active !== null && active.id === id;
    },
    clear() {
      active = null;
      doorTook = false;
      publish();
    },
    clearIf(id) {
      gone.add(id);
      if (active !== null && active.id === id) {
        active = null;
        doorTook = false;
        publish();
      }
    },
    dismissNotice() {
      if (notice === null) return;
      notice = null;
      publish();
    },
  };
}
