/**
 * The outgoing queue: compose-time validation and one crypto-grade
 * client_msg_id per message (§5 — persisted with the item, reused by
 * every retry), strict FIFO with exactly one post in flight per room,
 * and a verdict for every outcome: sent (removed from the shelf, its
 * seq handed out once so the stream's copy dedupes), terminal failure
 * (the id is burned), a hold carrying the door's sentence on the item,
 * or a capped-backoff retry of the SAME id.
 *
 * Nothing posts for a room nobody is subscribed to: a session exists
 * only while a listener holds it, the last one out drops it (its timer
 * included), and the next subscribe or stream open probes again. The
 * triggers are that open and the foreground reconnect — never
 * background work, which RN stops anyway. A pairing that no longer
 * exists leaves its messages on the shelf as terminal failures.
 *
 * Privacy: send diagnostics log only eight-character id prefixes, never text.
 */
import { getPairing } from "../pairing/pairingCredentialStore";
import { backoffDelayMs } from "./roomBackoff";
import { postRoomMessage } from "./roomApi";
import type { RoomErrorCode, RoomResult } from "./roomError";
import { roomQueueAttempt } from "./roomQueueOutcome";
import type { RoomPostAck } from "./roomWire";
import {
  deleteRoomQueue,
  loadRoomQueue,
  mutateRoomQueue,
  type RoomQueueItem,
  type RoomQueueSent,
} from "./roomQueueStore";
import { checkEncodedBody, checkRoomText } from "./roomBounds";

/** The shelf's cap; compose refuses beyond it with a typed queue_full. */
const MAX_QUEUE_ITEMS = 200;

type RoomSendStep =
  | "enqueue"
  | "persisted"
  | "kick"
  | "post"
  | "ack"
  | "fail"
  | "announce_fail"
  | "drop_no_pairing";

function logSend(
  op: RoomSendStep,
  localId: string,
  clientMsgId: string | null,
  startedAt: number,
  code?: RoomErrorCode | "storage_error",
): void {
  const fields = {
    op,
    ...(code === undefined ? {} : { code }),
    localId8: localId.slice(0, 8),
    clientId8: clientMsgId?.slice(0, 8) ?? "unknown",
    ms: Math.max(0, Date.now() - startedAt),
  };
  console.log(`KALSA_ROOM_SEND ${JSON.stringify(fields)}`);
}

export type RoomQueueEvent =
  /** The shelf after every mutation — what a waiting list renders. */
  | { type: "changed"; items: RoomQueueItem[] }
  /** Removed from the queue with the door's verdict: reconcile with the
   *  stream by seq, and the entry the stream carries for it never shows
   *  as a second bubble. */
  | { type: "sent"; item: RoomQueueSent };

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

/** Created by a subscription, dropped by the last unsubscribe: sessions
 *  with no listeners are looked up, never conjured. */
const sessions = new Map<string, RoomQueueSession>();

function emit(localId: string, event: RoomQueueEvent): void {
  const room = sessions.get(localId);
  if (room === undefined) return;
  for (const listener of [...room.listeners]) {
    try {
      listener(event);
    } catch {
      // One listener's throw must not silence the others.
    }
  }
}

async function announce(localId: string): Promise<void> {
  if (sessions.get(localId) === undefined) return;
  const items = await loadRoomQueue(localId);
  emit(localId, { type: "changed", items });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** One crypto-grade id per message, minted at compose and never again.
 *  Platform CSPRNGs only: expo-crypto first (the app's source, lazily
 *  required so importing the queue loads nothing native), a runtime's
 *  Web Crypto second — Hermes has none (see pairingTransport), and a
 *  weakened PRNG is never an option for an id that must be unguessable. */
export function createRoomClientMsgId(): string {
  try {
    const { getRandomBytes } = require("expo-crypto") as typeof import("expo-crypto");
    return hex(getRandomBytes(16));
  } catch {
    const web = (
      globalThis as { crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array } }
    ).crypto;
    if (web?.getRandomValues !== undefined) return hex(web.getRandomValues(new Uint8Array(16)));
    throw new Error("no secure random source for client_msg_id");
  }
}

/** The current shelf in order (what a waiting list first renders). */
export function getRoomQueue(localId: string): Promise<RoomQueueItem[]> {
  return loadRoomQueue(localId);
}

export function subscribeRoomQueue(localId: string, listener: Listener): () => void {
  let room = sessions.get(localId);
  const created = room === undefined;
  if (room === undefined) {
    room = { listeners: new Set(), inFlight: false, pendingRerun: false, retryTimer: null, attempt: 0 };
    sessions.set(localId, room);
  }
  const held = room;
  held.listeners.add(listener);
  let live = true;
  // The session's OWN start is what probes; a listener joining one already
  // running rides it. The app wires two listeners for one room (the stream's
  // ack floor, the screen's waiting list) and a second kick would land as a
  // pendingRerun on the attempt in flight — one POST per message, not two.
  if (created) void kick(localId);
  return () => {
    if (!live) return;
    live = false;
    held.listeners.delete(listener);
    if (held.listeners.size > 0) return;
    // The last one out takes the session — its retry timer included —
    // so no POST can ever run for a room nobody is watching.
    if (held.retryTimer !== null) {
      clearTimeout(held.retryTimer);
      held.retryTimer = null;
    }
    sessions.delete(localId);
  };
}

/** Validate at compose (§9's bounds, encoded body included), preserve the
 *  draft's id across retries, persist, and start the first attempt. */
export async function enqueueRoomMessage(
  localId: string,
  message: { text: string; callAi?: boolean; clientMsgId?: string },
): Promise<RoomResult<{ clientMsgId: string }>> {
  const startedAt = Date.now();
  let clientMsgId: string | null = message.clientMsgId ?? null;
  logSend("enqueue", localId, clientMsgId, startedAt);
  const textProblem = checkRoomText(message.text);
  if (textProblem !== null) {
    logSend("fail", localId, clientMsgId, startedAt, textProblem.code);
    return { ok: false, error: textProblem };
  }
  const callAi = message.callAi === true;
  // The id is always 32 hex chars (16 bytes), so a fixed-width dummy
  // measures the body exactly before anything is minted or stored.
  const bodyProblem = checkEncodedBody(
    JSON.stringify({ client_msg_id: "0".repeat(32), text: message.text, call_ai: callAi }),
  );
  if (bodyProblem !== null) {
    logSend("fail", localId, clientMsgId, startedAt, bodyProblem.code);
    return { ok: false, error: bodyProblem };
  }
  let existing: RoomQueueItem[];
  try {
    existing = await loadRoomQueue(localId);
  } catch {
    logSend("fail", localId, clientMsgId, startedAt, "storage_error");
    throw new Error("room queue storage failed");
  }
  if (clientMsgId !== null) {
    const held = existing.find((item) => item.clientMsgId === clientMsgId);
    if (held !== undefined) {
      if (held.text !== message.text || held.callAi !== callAi) {
        const error = {
          code: "client_msg_id_reused" as const,
          message: "This message id already belongs to another message.",
        };
        logSend("fail", localId, clientMsgId, startedAt, error.code);
        return { ok: false, error };
      }
      await announceAndKick(localId, clientMsgId, startedAt);
      return { ok: true, value: { clientMsgId } };
    }
  }
  if (existing.length >= MAX_QUEUE_ITEMS) {
    const error = queueFull();
    logSend("fail", localId, clientMsgId, startedAt, error.code);
    return { ok: false, error };
  }
  if (clientMsgId === null) {
    try {
      clientMsgId = createRoomClientMsgId();
    } catch {
      // Never a raw throw: the text was not stored, and the caller is
      // told why so it can try compose again.
      logSend("fail", localId, clientMsgId, startedAt, "client_msg_id_unavailable");
      return {
        ok: false,
        error: {
          code: "client_msg_id_unavailable",
          message: "No secure source could mint this message's client_msg_id.",
        },
      };
    }
  }
  const item: RoomQueueItem = {
    clientMsgId,
    text: message.text,
    callAi,
    createdAt: Date.now(),
    state: "queued",
  };
  let pushed = false;
  let duplicateMatches = false;
  let duplicateConflicts = false;
  try {
    await mutateRoomQueue(localId, (draft) => {
      const held = draft.find((item) => item.clientMsgId === clientMsgId);
      if (held !== undefined) {
        duplicateMatches = held.text === message.text && held.callAi === callAi;
        duplicateConflicts = !duplicateMatches;
        return false;
      }
      // Re-checked under the lock: a racing compose may have filled it.
      if (draft.length >= MAX_QUEUE_ITEMS) return false;
      draft.push(item);
      pushed = true;
      return true;
    });
  } catch {
    logSend("fail", localId, clientMsgId, startedAt, "storage_error");
    throw new Error("room queue storage failed");
  }
  if (!pushed) {
    if (duplicateMatches) {
      await announceAndKick(localId, clientMsgId, startedAt);
      return { ok: true, value: { clientMsgId } };
    }
    if (duplicateConflicts) {
      const error = {
        code: "client_msg_id_reused" as const,
        message: "This message id already belongs to another message.",
      };
      logSend("fail", localId, clientMsgId, startedAt, error.code);
      return { ok: false, error };
    }
    const error = queueFull();
    logSend("fail", localId, clientMsgId, startedAt, error.code);
    return { ok: false, error };
  }
  await announceAndKick(localId, clientMsgId, startedAt);
  return { ok: true, value: { clientMsgId } };
}

async function announceAndKick(
  localId: string,
  clientMsgId: string,
  startedAt: number,
): Promise<void> {
  logSend("persisted", localId, clientMsgId, startedAt);
  try {
    await announce(localId);
  } catch {
    // The durable item owns this send; a view refresh must not restore it to the composer.
    logSend("announce_fail", localId, clientMsgId, startedAt, "storage_error");
  }
  logSend("kick", localId, clientMsgId, startedAt);
  void kick(localId);
}

function queueFull(): { code: "queue_full"; message: string } {
  return { code: "queue_full", message: `At most ${MAX_QUEUE_ITEMS} messages may wait for a room.` };
}

/** Drop one item — the only way a failed (or abandoned) message leaves;
 *  P5's discard, and the shelf-empty shelf simply writes back empty. */
export async function discardRoomQueueItem(localId: string, clientMsgId: string): Promise<void> {
  await mutateRoomQueue(localId, (items) => {
    const at = items.findIndex((item) => item.clientMsgId === clientMsgId);
    if (at === -1) return false;
    items.splice(at, 1);
    return true;
  });
  await announce(localId);
}

/** The user's own retry of an item the shelf is holding: a terminal
 *  refusal burns the id, and this is the one caller allowed to un-burn
 *  it — the same words, the same id, so the door's idempotence still
 *  makes the second POST one message (§5). The wait is over by fiat:
 *  drop any owed backoff and go. */
export async function retryRoomQueueItem(localId: string, clientMsgId: string): Promise<void> {
  await mutateRoomQueue(localId, (items) => {
    const item = items.find((held) => held.clientMsgId === clientMsgId);
    if (item === undefined) return false;
    item.state = "queued";
    delete item.error;
    return true;
  });
  await announce(localId);
  await flushRoomQueue(localId);
}

/** After an enqueue: go now unless a backoff is already owed — the owed
 *  round picks this message up with the rest of the shelf (§9). */
async function kick(localId: string): Promise<void> {
  const room = sessions.get(localId);
  if (room === undefined || room.listeners.size === 0) return;
  if (room.retryTimer !== null) return;
  room.attempt = 0; // each item starts at the floor
  if (room.inFlight) {
    room.pendingRerun = true;
    return;
  }
  await runAttempt(localId);
}

/** An external flush (stream open, reconnect, foreground): the wait is
 *  over — drop any pending timer, start the backoff from scratch, go.
 *  A flush that finds the one flight already running leaves a rerun for
 *  its end, so an item enqueued mid-send is never stranded. */
export async function flushRoomQueue(localId: string): Promise<void> {
  const room = sessions.get(localId);
  if (room === undefined || room.listeners.size === 0) return;
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
  if (room.retryTimer !== null || room.listeners.size === 0) return;
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
  const room = sessions.get(localId);
  if (room === undefined || room.inFlight || room.listeners.size === 0) return;
  room.inFlight = true;
  try {
    const attemptStartedAt = Date.now();
    // A pairing that no longer exists (a newer one took its room) cannot
    // carry these messages, and no room can display them after its removal.
    const record = await getPairing(localId);
    if (record === null) {
      const droppedIds: string[] = [];
      try {
        droppedIds.push(...(await loadRoomQueue(localId)).map((item) => item.clientMsgId));
      } catch {
        // Delete even a damaged shelf: its text has no pairing that can open it.
      }
      await deleteRoomQueue(localId);
      if (droppedIds.length === 0) droppedIds.push("");
      for (const clientMsgId of droppedIds) {
        logSend("drop_no_pairing", localId, clientMsgId || null, attemptStartedAt);
      }
      emit(localId, { type: "changed", items: [] });
      return;
    }
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

      const sending = await mutateRoomQueue(localId, (draft) => {
        const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
        if (target === undefined || target.state !== "queued") return false;
        target.state = "sending";
        return true;
      });
      // The store heals a persisted "sending" to "queued" on every read
      // (a dead process's leftover); THIS announcement is the live send's
      // own, so it says what this process set — re-reading would report
      // the healed shelf and the reader would never see it leave.
      emit(localId, { type: "changed", items: sending });

      const attemptStartedAt = Date.now();
      logSend("post", localId, head.clientMsgId, attemptStartedAt);
      let result: RoomResult<RoomPostAck>;
      try {
        result = await postRoomMessage(
          { clientMsgId: head.clientMsgId, text: head.text, callAi: head.callAi },
          { roomLocalId: localId },
        );
      } catch {
        logSend("fail", localId, head.clientMsgId, attemptStartedAt, "unexpected");
        result = {
          ok: false,
          error: { code: "unreachable", message: "The room request failed unexpectedly." },
        };
      }
      const verdict = roomQueueAttempt(result);
      if (verdict.kind === "sent") {
        logSend("ack", localId, head.clientMsgId, attemptStartedAt);
        await mutateRoomQueue(localId, (draft) => {
          const at = draft.findIndex((item) => item.clientMsgId === head.clientMsgId);
          if (at === -1) return false;
          draft.splice(at, 1);
          return true;
        });
        await announce(localId);
        emit(localId, {
          type: "sent",
          item: {
            ...head,
            state: "sent",
            seq: verdict.seq,
            time: verdict.time,
            refusal: verdict.refusal,
          },
        });
        room.attempt = 0;
        continue; // the FIFO moves on
      }
      if (verdict.kind === "failed") {
        logSend("fail", localId, head.clientMsgId, attemptStartedAt, verdict.error.code);
        await mutateRoomQueue(localId, (draft) => {
          const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
          if (target === undefined) return false;
          target.state = "failed";
          target.error = verdict.error;
          return true;
        });
        await announce(localId);
        room.attempt = 0; // terminal: the next item starts at the floor
        continue; // terminal — the next queued item is the new head
      }
      logSend("fail", localId, head.clientMsgId, attemptStartedAt, verdict.error.code);
      // hold or retry: this item goes back to waiting, in its place,
      // with the door's sentence stored where P5 can read it.
      await mutateRoomQueue(localId, (draft) => {
        const target = draft.find((item) => item.clientMsgId === head.clientMsgId);
        if (target === undefined) return false;
        target.state = "queued";
        target.error = verdict.error;
        return true;
      });
      await announce(localId);
      if (verdict.kind === "retry") scheduleRetry(localId, room);
      return; // hold: no timer; a trigger decides when to probe again
    }
  } catch {
    // A failed queue operation must not spin; the next trigger probes again.
    return;
  } finally {
    room.inFlight = false;
    if (room.pendingRerun) {
      room.pendingRerun = false;
      // A rerun owed by a trigger that arrived mid-flight must not outrun a
      // backoff this run just scheduled: the timer owns the next attempt.
      if (room.retryTimer === null) void runAttempt(localId);
    }
  }
}
