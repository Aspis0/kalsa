/**
 * The persisted outgoing shelf, one key per room (keyed by the pairing's
 * localId) — where message TEXT lives in the same medium chats use
 * today: plain AsyncStorage (`kalsa.conversations.v1` and friends), so
 * the queue's protection level matches the transcripts beside it.
 *
 * Discipline: one in-process lock per room, one write per mutation, and
 * a blob that will not parse is backed up once under its own key and
 * never overwritten. A single bad ELEMENT is this shelf's different
 * rule: this is message text, not credentials — the damaged raw is
 * preserved once in the backup and the valid items survive the read. An
 * item persisted "sending" belongs to a process that died mid-POST;
 * every read heals it to "queued" — the same client_msg_id makes the
 * retry harmless (§5).
 */
import type { RoomError } from "./roomError";

const KEY_PREFIX = "kalsa.roomqueue.";

/** Minimal KV surface the store needs; AsyncStorage satisfies it. */
type RoomQueueStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem?(key: string): Promise<void>;
};

/** What the shelf ever holds: sent is an event, never a stored state. */
export type RoomQueueItemState = "queued" | "sending" | "failed";

export type RoomQueueItem = {
  /** Minted once at compose time; every retry reuses it (§5). */
  clientMsgId: string;
  text: string;
  callAi: boolean;
  createdAt: number;
  state: RoomQueueItemState;
  /** The typed refusal that failed it (terminal), or — while it waits —
   *  the last attempt's reason (read_only, removed, unreachable…), so P5
   *  can say what the room answered. */
  error?: RoomError;
};

/** A message the door took: the reconcile signal, never stored. */
export type RoomQueueSent = {
  clientMsgId: string;
  text: string;
  callAi: boolean;
  createdAt: number;
  state: "sent";
  seq: number;
  /** §5's refused call, when the room took the message but not its call
   *  (`already_pending`), null when it took both. */
  refusal: string | null;
  time: number;
};

export function roomQueueKey(localId: string): string {
  return `${KEY_PREFIX}${localId}`;
}

function damagedQueueError(): Error {
  return new Error("room queue damaged");
}

function storage(): RoomQueueStorage {
  // Required on first use: importing this module never loads the store.
  return require("@react-native-async-storage/async-storage") as RoomQueueStorage;
}

function decodeItem(value: unknown): RoomQueueItem | null {
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
  if (typeof stored.error === "object" && stored.error !== null) {
    item.error = stored.error as RoomError;
  }
  return item;
}

type Envelope = { items: RoomQueueItem[]; dropped: boolean };

/** The envelope decides the verdict; one bad element only costs itself —
 *  its bytes live on in the backup the caller writes. */
function parseEnvelope(raw: string): Envelope | null {
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
  let dropped = false;
  for (const value of envelope.items) {
    const item = decodeItem(value);
    if (item === null) dropped = true;
    else items.push(item);
  }
  return { items, dropped };
}

const locks = new Map<string, Promise<void>>();

/** One room's shelf at a time: queued mutations serialise per key. */
async function withQueueLock<T>(localId: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(localId) ?? Promise.resolve();
  const result = previous.then(task, task);
  locks.set(localId, result.then(() => undefined, () => undefined));
  return result;
}

async function keepDamagedOnce(localId: string, raw: string): Promise<void> {
  const key = `${roomQueueKey(localId)}.damaged`;
  const kept = await storage().getItem(key);
  if (kept === null) await storage().setItem(key, raw);
}

async function loadUnlocked(localId: string): Promise<RoomQueueItem[]> {
  const raw = await storage().getItem(roomQueueKey(localId));
  if (raw == null) return [];
  const parsed = parseEnvelope(raw);
  if (parsed !== null) {
    // Bad elements: preserved once in the backup, gone from the shelf —
    // the survivors keep their texts and the queue stays usable.
    if (parsed.dropped) await keepDamagedOnce(localId, raw);
    return parsed.items;
  }
  // Not our blob at all: keep its bytes once, refuse every write, surface
  // the damage — the only copy of its texts must not be overwritten.
  await keepDamagedOnce(localId, raw);
  throw damagedQueueError();
}

/** The room's shelf in order, "sending" healed to "queued". */
export function loadRoomQueue(localId: string): Promise<RoomQueueItem[]> {
  return withQueueLock(localId, () => loadUnlocked(localId));
}

/** One mutation: one lock hold, one write — skipped when the change
 *  reports it changed nothing. The (healed) draft comes back either way,
 *  so callers can emit their snapshot from the same values they saved. */
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

/** A pairing's shelf and any damaged-text backup leave with that pairing. */
export async function deleteRoomQueue(localId: string): Promise<void> {
  await withQueueLock(localId, async () => {
    const store = storage();
    const key = roomQueueKey(localId);
    if (store.removeItem) {
      await Promise.all([store.removeItem(key), store.removeItem(`${key}.damaged`)]);
    } else {
      await Promise.all([
        store.setItem(key, JSON.stringify({ items: [] })),
        store.setItem(`${key}.damaged`, ""),
      ]);
    }
  });
}
