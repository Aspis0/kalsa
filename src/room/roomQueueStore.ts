/**
 * The persisted outgoing shelf, one key per room (keyed by the pairing's
 * localId) — where message TEXT lives in the same medium chats use
 * today: plain AsyncStorage (`kalsa.conversations.v1` and friends), so
 * the queue's protection level matches the transcripts beside it.
 *
 * Discipline: one in-process lock per room, one write per mutation, and
 * a blob that will not parse is backed up once under its own key and
 * never overwritten — writes refuse and the read surfaces the damage,
 * because the queue holds the only copy of a message nobody has seen.
 * An item persisted "sending" belongs to a process that died mid-POST;
 * every read heals it to "queued" — the same client_msg_id makes the
 * retry harmless (§5).
 */
import type { RoomError } from "./roomError";

const KEY_PREFIX = "kalsa.roomqueue.";

/** Minimal KV surface the store needs; AsyncStorage satisfies it. */
export type RoomQueueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
};

export type RoomQueueItemState = "queued" | "sending" | "sent" | "failed";

export type RoomQueueItem = {
  /** Minted once at compose time; every retry reuses it (§5). */
  clientMsgId: string;
  text: string;
  callAi: boolean;
  createdAt: number;
  state: RoomQueueItemState;
  /** The door's verdict once sent. */
  seq?: number;
  time?: number;
  /** The typed refusal that failed it (terminal). */
  error?: RoomError;
};

export function roomQueueKey(localId: string): string {
  return `${KEY_PREFIX}${localId}`;
}

function damagedQueueError(): Error {
  const error = new Error("room queue damaged") as Error & { code: string };
  error.code = "room_queue_damaged";
  return error;
}

/** Whether an error from any queue operation is the damaged-shelf verdict. */
export function isRoomQueueDamaged(error: unknown): boolean {
  return error instanceof Error && (error as { code?: unknown }).code === "room_queue_damaged";
}

function storage(): RoomQueueStorage {
  // Required on first use: importing this module never loads the store.
  return require("@react-native-async-storage/async-storage") as RoomQueueStorage;
}

function parseItems(raw: string): RoomQueueItem[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const envelope = parsed as Record<string, unknown>;
  if (!Array.isArray(envelope.items)) return null;
  const items: RoomQueueItem[] = [];
  for (const value of envelope.items) {
    if (typeof value !== "object" || value === null) return null;
    const stored = value as Record<string, unknown>;
    if (typeof stored.clientMsgId !== "string" || typeof stored.text !== "string") return null;
    if (typeof stored.createdAt !== "number") return null;
    const state = stored.state;
    if (state !== "queued" && state !== "sending" && state !== "failed") return null;
    const item: RoomQueueItem = {
      clientMsgId: stored.clientMsgId,
      text: stored.text,
      callAi: stored.callAi === true,
      createdAt: stored.createdAt,
      // A process that died mid-POST left "sending" behind; the id makes
      // re-sending it as new impossible to duplicate (§5).
      state: state === "sending" ? "queued" : state,
    };
    if (typeof stored.seq === "number") item.seq = stored.seq;
    if (typeof stored.time === "number") item.time = stored.time;
    if (typeof stored.error === "object" && stored.error !== null) {
      item.error = stored.error as RoomError;
    }
    items.push(item);
  }
  return items;
}

const locks = new Map<string, Promise<void>>();

/** One room's shelf at a time: queued mutations serialise per key. */
async function withQueueLock<T>(localId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(localId) ?? Promise.resolve();
  const result = previous.then(task, task);
  locks.set(localId, result.then(() => undefined, () => undefined));
  return result;
}

async function loadUnlocked(localId: string): Promise<RoomQueueItem[]> {
  const key = roomQueueKey(localId);
  const raw = await storage().getItem(key);
  if (raw == null) return [];
  const items = parseItems(raw);
  if (items !== null) return items;
  // The shelf holds unsent text: back it up once, never overwrite it.
  const kept = await storage().getItem(`${key}.damaged`);
  if (kept === null) await storage().setItem(`${key}.damaged`, raw);
  throw damagedQueueError();
}

/** The room's shelf in order, "sending" healed to "queued". */
export function loadRoomQueue(localId: string): Promise<RoomQueueItem[]> {
  return withQueueLock(localId, () => loadUnlocked(localId));
}

/** One mutation: one lock hold, one write — skipped when the change
 *  reports it changed nothing. The (healed) draft comes back either way,
 * * so callers can emit their snapshot from the same values they saved. */
export async function mutateRoomQueue(
  localId: string,
  change: (items: RoomQueueItem[]) => boolean,
): Promise<RoomQueueItem[]> {
  return withQueueLock(localId, async () => {
    const items = await loadUnlocked(localId);
    if (change(items)) await storage().setItem(roomQueueKey(localId), JSON.stringify({ items }));
    return items;
  });
}
