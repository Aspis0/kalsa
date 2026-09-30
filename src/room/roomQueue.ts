/**
 * The outgoing queue: compose-time validation and one crypto-grade
 * client_msg_id per message (§5 — persisted with the item, reused by
 * every retry), strict FIFO with exactly one post in flight per room,
 * and a verdict for every outcome: sent (removed from the shelf, its
 * seq handed out once so the stream's copy dedupes), terminal failure
 * (the id is burned), a hold (items stay queued), or a capped-backoff
 * retry of the SAME id. Flushes ride the triggers — open/reconnect
 * (wired by the stream), foreground (through resume), enqueue itself —
 * never background timers, which RN stops anyway.
 *
 * Privacy: this module never logs message text or the client_msg_id.
 */
import { backoffDelayMs } from "./roomBackoff";
import { forgetRoomEpoch } from "./roomEpochs";
import { postRoomMessage } from "./roomApi";
import type { RoomResult } from "./roomError";
import { roomQueueAttempt } from "./roomQueueOutcome";
import {
  loadRoomQueue,
  mutateRoomQueue,
  type RoomQueueItem,
} from "./roomQueueStore";
import { checkEncodedBody, checkRoomText } from "./roomBounds";

export type RoomQueueEvent =
  /** The shelf after every mutation — what a waiting list renders. */
  | { type: "changed"; items: RoomQueueItem[] }
  /** Removed from the queue with the door's verdict: reconcile with the
   *  stream by seq, and the entry the stream carries for it never shows
   *  as a second bubble. */
  | { type: "sent"; item: RoomQueueItem };

type Listener = (event: RoomQueueEvent) => void;

type RoomQueueSession = {
  listeners: Set<Listener>;
  /** The one post allowed in flight for this room. */
  inFlight: boolean;
  /** A flush arrived while sending: run one more pass when this ends. */
  pendingRerun: boolean;
  retryTimer: ReturnType<typeof setTimeout> | null;
  attempt: number;
};

const sessions = new Map<string, RoomQueueSession>();

function session(localId: string): RoomQueueSession {
  let existing = sessions.get(localId);
  if (existing === undefined) {
    existing = { listeners: new Set(), inFlight: false, pendingRerun: false, retryTimer: null, attempt: 0 };
    sessions.set(localId, existing);
  }
  return existing;
}

function emit(localId: string, event: RoomQueueEvent): void {
  for (const listener of [...session(localId).listeners]) {
    try {
      listener(event);
    } catch {
      // One listener's throw must not silence the others.
    }
  }
}

async function announce(localId: string): Promise<RoomQueueItem[]> {
  const items = await loadRoomQueue(localId);
  emit(localId, { type: "changed", items });
  return items;
}

/** One crypto-grade id per message, minted at compose and never again:
 *  expo-crypto is the app's random source (package.json), required on
 *  first use so importing the queue loads nothing native. */
function newClientMsgId(): string {
  const { getRandomBytes } = require("expo-crypto") as typeof import("expo-crypto");
  return Array.from(getRandomBytes(16), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The current shelf in order (what a waiting list first renders). */
export function getRoomQueue(localId: string): Promise<RoomQueueItem[]> {
  return loadRoomQueue(localId);
}

export function subscribeRoomQueue(localId: string, listener: Listener): () => void {
  const room = session(localId);
  room.listeners.add(listener);
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    room.listeners.delete(listener);
  };
}

/** Validate at compose (§9's bounds, encoded body included), mint the
 *  id once, persist, and start the first attempt. A refused compose
 *  stores nothing — and mints nothing: only a message the shelf accepts
 *  ever owns an id. */
export async function enqueueRoomMessage(
  localId: string,
  message: { text: string; callAi?: boolean },
): Promise<RoomResult<{ clientMsgId: string }>> {
  const textProblem = checkRoomText(message.text);
  if (textProblem !== null) return { ok: false, error: textProblem };
  const callAi = message.callAi === true;
  // The id is always 32 hex chars (16 bytes), so a fixed-width dummy
  // measures the body exactly before anything is minted or stored.
  const bodyProblem = checkEncodedBody(
    JSON.stringify({ client_msg_id: "0".repeat(32), text: message.text, call_ai: callAi }),
  );
  if (bodyProblem !== null) return { ok: false, error: bodyProblem };
  const clientMsgId = newClientMsgId();
  const item: RoomQueueItem = {
    clientMsgId,
    text: message.text,
    callAi,
    createdAt: Date.now(),
    state: "queued",
  };
  await mutateRoomQueue(localId, (items) => {
    items.push(item);
    return true;
  });
  await announce(localId);
  void flushRoomQueue(localId);
  return { ok: true, value: { clientMsgId } };
}

/** Drop one item — the only way a failed (or abandoned) message leaves. */
export async function discardRoomQueueItem(localId: string, clientMsgId: string): Promise<void> {
  await mutateRoomQueue(localId, (items) => {
    const at = items.findIndex((item) => item.clientMsgId === clientMsgId);
    if (at === -1) return false;
    items.splice(at, 1);
    return true;
  });
  await announce(localId);
}

/** An external flush (open, reconnect, foreground, enqueue): the wait is
 *  over — drop any pending timer, start the backoff from scratch, go.
 *  A flush that finds the one flight already running leaves a rerun for
 *  its end, so an item enqueued mid-send is never stranded. */
export async function flushRoomQueue(localId: string): Promise<void> {
  const room = session(localId);
  if (room.retryTimer !== null) {
    clearTimeout(room.retryTimer);
    room.retryTimer = null;
  }
  room.attempt = 0;
  if (room.inFlight) {
    room.pendingRerun = true;
    return;
  }
  await runAttempt(localId);
}

function scheduleRetry(localId: string, room: RoomQueueSession): void {
  if (room.retryTimer !== null) return;
  const delay = backoffDelayMs(room.attempt);
  room.attempt += 1;
  room.retryTimer = setTimeout(() => {
    room.retryTimer = null;
    void runAttempt(localId);
  }, delay);
}

/** Exactly one post in flight: the head queued item sends, and whatever
 *  its outcome says, the next — until the shelf holds nothing sendable
 *  right now. */
async function runAttempt(localId: string): Promise<void> {
  const room = session(localId);
  if (room.inFlight) return;
  room.inFlight = true;
  try {
    for (;;) {
      let items: RoomQueueItem[];
      try {
        items = await loadRoomQueue(localId);
      } catch {
        // A damaged shelf refuses everything: hold; a trigger probes again.
        return;
      }
      const head = items.find((item) => item.state === "queued");
      if (head === undefined) return;

      await mutateRoomQueue(localId, (draft) => {
        const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
        if (target === undefined || target.state !== "queued") return false;
        target.state = "sending";
        return true;
      });
      await announce(localId);

      const result = await postRoomMessage(
        { clientMsgId: head.clientMsgId, text: head.text, callAi: head.callAi },
        { roomLocalId: localId },
      );
      const verdict = roomQueueAttempt(result);
      if (verdict.kind === "sent") {
        await mutateRoomQueue(localId, (draft) => {
          const at = draft.findIndex((item) => item.clientMsgId === head.clientMsgId);
          if (at === -1) return false;
          draft.splice(at, 1);
          return true;
        });
        await announce(localId);
        emit(localId, {
          type: "sent",
          item: { ...head, state: "sent", seq: verdict.seq, time: verdict.time },
        });
        room.attempt = 0;
        continue; // the FIFO moves on
      }
      if (verdict.kind === "failed") {
        await mutateRoomQueue(localId, (draft) => {
          const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
          if (target === undefined) return false;
          target.state = "failed";
          target.error = verdict.error;
          return true;
        });
        await announce(localId);
        continue; // terminal — the next queued item is the new head
      }
      // hold or retry: this item goes back to waiting, in its place.
      await mutateRoomQueue(localId, (draft) => {
        const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
        if (target === undefined) return false;
        target.state = "queued";
        return true;
      });
      await announce(localId);
      if (verdict.kind === "retry") {
        // epoch_changed: the cached epoch dies with this round's refusals,
        // so the same id goes out bare on the retry and lands as new (§5).
        if (verdict.forgetEpoch) forgetRoomEpoch(localId);
        scheduleRetry(localId, room);
      }
      return; // hold: no timer; a trigger decides when to probe again
    }
  } catch {
    // A damaged shelf or a thrown post must not spin: the next trigger
    // (reconnect, foreground, enqueue) probes again.
    return;
  } finally {
    room.inFlight = false;
    if (room.pendingRerun) {
      room.pendingRerun = false;
      void runAttempt(localId);
    }
  }
}
