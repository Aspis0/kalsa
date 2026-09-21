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
 * Four bugs the shape removes, each a different way to diverge:
 * - C1: a path that made a chat active without asking the door (an attachment
 *   creating a conversation). There is no setter here, so the path cannot exist.
 * - C2: a second Enter on a chat that does not exist yet made a second chat.
 *   `create` is single-flight — while one is pending the next is ignored, and
 *   the caller can tell because it answers `null` — and `isCurrent` is the
 *   guard the caller uses when its own task finishes late, after the user has
 *   moved on.
 * - C3: two quick switches raced on the door's four workers and resolved out of
 *   order, so the last click did not win. Opens run one at a time, in the order
 *   they were asked, so the door's order is the UI's order by construction.
 * - C4: during a switch the outgoing chat stayed live, and a send into it was a
 *   completion that never passed the door's gate. The snapshot's `pending` is
 *   the freeze the shell applies to the composer and retry while it is true.
 *
 * No React, no DOM, no fetch: the door arrives as an injected `Activate`, so
 * the harness drives this with a fake door and the order is a test rather than
 * a hope.
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
  /** An open is queued or in flight: the composer and retry stay frozen, and a
      send that started before this must not steal the chat when it lands. */
  readonly pending: boolean;
  /** A chat that does not exist yet is being created. A second creation is
      ignored, never a second chat. */
  readonly creating: boolean;
}

/** Asks the door to open a chat. `null` is a window with no door at all — a
    remote server, or a brain that is not serving: every open then succeeds
    locally, because there is no slot to diverge from. */
export type Activate = (id: string) => Promise<SlotAnswer>;

export interface SlotGate {
  /** For `useSyncExternalStore`. Stable identity for the lifetime of the gate. */
  subscribe: (listener: () => void) => () => void;
  /** Cached on purpose: `useSyncExternalStore` compares by identity, and a
      fresh object on every read would re-render the shell without end. */
  getSnapshot: () => SlotGateSnapshot;
  /** Opens a chat that already exists. Calls queue: two switches run in the
      order they were asked, never at once. */
  open: (id: string, activate: Activate | null) => Promise<OpenResult>;
  /** Opens a chat that does not exist yet, at most one at a time. Answers
      `null` when a creation is already pending — the second Enter is ignored,
      not a second chat. */
  create: (id: string, activate: Activate | null) => Promise<OpenResult | null>;
  /** True only while `chat` is still the active one. A task that finishes late,
      after the user moved on, must check this before it sends. */
  isCurrent: (chat: ActiveChat) => boolean;
  /** No active chat — a new conversation, or the active one was deleted. Never
      a divergence: with no active id there is nothing to save under a wrong
      name, and the next open goes through the door. */
  clear: () => void;
}

function mint(id: string): ActiveChat {
  // The one cast: the brand has no runtime representation, and this is the only
  // place a chat is minted. `as unknown` because the brand is deliberately not
  // satisfiable from outside.
  return { id } as unknown as ActiveChat;
}

export function createSlotGate(): SlotGate {
  let active: ActiveChat | null = null;
  let pending = 0;
  let creating = false;
  let snapshot: SlotGateSnapshot = { active: null, pending: false, creating: false };
  const listeners = new Set<() => void>();
  let chain: Promise<unknown> = Promise.resolve();

  function publish(): void {
    const next: SlotGateSnapshot = { active, pending: pending > 0, creating };
    if (
      next.active === snapshot.active &&
      next.pending === snapshot.pending &&
      next.creating === snapshot.creating
    ) {
      return;
    }
    snapshot = next;
    for (const listener of listeners) listener();
  }

  async function run(id: string, activate: Activate | null): Promise<OpenResult> {
    let answer: SlotAnswer;
    try {
      answer = activate ? await activate(id) : { kind: "ok" };
    } catch {
      // The injected call answered with a rejection instead of a SlotAnswer.
      // Nothing is known about the slot, which is exactly what DOOR_SILENT says.
      answer = { kind: "refused", message: DOOR_SILENT };
    }
    if (answer.kind === "refused") {
      return { opened: null, notice: { failed: true, message: answer.message } };
    }
    const chat = mint(id);
    active = chat;
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

  function open(id: string, activate: Activate | null): Promise<OpenResult> {
    pending += 1;
    publish();
    return enqueue(async () => {
      try {
        return await run(id, activate);
      } finally {
        pending -= 1;
        publish();
      }
    });
  }

  function create(id: string, activate: Activate | null): Promise<OpenResult | null> {
    if (creating) return Promise.resolve(null);
    creating = true;
    publish();
    return open(id, activate).finally(() => {
      creating = false;
      publish();
    });
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
    open,
    create,
    isCurrent(chat) {
      return active === chat;
    },
    clear() {
      active = null;
      publish();
    },
  };
}
