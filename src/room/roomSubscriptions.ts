/**
 * The subscription surface over the stream: one live stream per room no
 * matter how many listeners, replaced never added — a second subscribe
 * joins the same wire, and the door's per-device seat cap is never
 * raced. Unsubscribing the last listener closes the stream; background
 * pauses every stream and foreground resumes each from its own cursor.
 */
import { subscribeRoomQueue } from "./roomQueue";
import { openRoomStream, type RoomStreamEvent } from "./roomStream";

type Listener = (event: RoomStreamEvent) => void;

type Entry = {
  handle: ReturnType<typeof openRoomStream>;
  listeners: Set<Listener>;
  /** The queue hook that keeps the stream's floor covering sent seqs. */
  leaveQueue: () => void;
};

const entries = new Map<string, Entry>();

/** Listen to a room's stream — and only that room's: the door allows
 *  two streams per device and silently retires the oldest, so this app
 *  keeps at most one live stream (the room on screen); every other room
 *  refreshes through info/history when it is opened. The same room
 *  shares its one wire across listeners, and the returned function
 *  leaves the last listener holding it. */
export function subscribeRoomEvents(roomLocalId: string, listener: Listener): () => void {
  for (const [otherRoom, entry] of [...entries]) {
    if (otherRoom === roomLocalId) continue;
    entry.handle.close();
    entries.delete(otherRoom);
  }
  let entry = entries.get(roomLocalId);
  if (entry === undefined) {
    const listeners = new Set<Listener>([listener]);
    const handle = openRoomStream(roomLocalId, (event) => {
      for (const current of [...listeners]) {
        try {
          current(event);
        } catch {
          // One listener's throw must not silence the others.
        }
      }
    });
    // A post the queue completes itself raises this stream's floor: the
    // entry the door carries for it is a duplicate the dispatch drops —
    // the one bubble, whichever channel reported it first.
    const leaveQueue = subscribeRoomQueue(roomLocalId, (event) => {
      if (event.type === "sent" && typeof event.item.seq === "number") {
        handle.markDelivered(event.item.seq);
      }
    });
    entry = { handle, listeners, leaveQueue };
    entries.set(roomLocalId, entry);
  } else {
    entry.listeners.add(listener);
  }
  const subscribed = entry;
  let live = true;
  return () => {
    if (!live) return;
    live = false;
    subscribed.listeners.delete(listener);
    if (subscribed.listeners.size === 0) {
      subscribed.leaveQueue();
      subscribed.handle.close();
      entries.delete(roomLocalId);
    }
  };
}

/** Background: every stream closes its wire and its timers; the resume
 *  state each session kept is what foreground dials with. */
export function pauseRoomStreams(): void {
  for (const entry of entries.values()) entry.handle.pause();
}

export function resumeRoomStreams(): void {
  for (const entry of entries.values()) entry.handle.resume();
}
