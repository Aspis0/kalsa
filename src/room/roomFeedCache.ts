/** The last rendered feed survives a RoomScreen remount during app resume. */
import type { RoomFeed } from "./roomFeed";

const feeds = new Map<string, RoomFeed>();

export function cachedRoomFeed(localId: string): RoomFeed | null {
  return feeds.get(localId) ?? null;
}

export function rememberRoomFeed(localId: string, feed: RoomFeed): void {
  if (feed.status === "removed") {
    feeds.delete(localId);
  } else if (feed.status === "ready" && feed.epoch !== "") {
    feeds.set(localId, feed);
  }
}

export function clearRoomFeed(localId: string): void {
  feeds.delete(localId);
}
