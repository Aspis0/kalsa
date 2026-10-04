/**
 * The room's blobs as bounded object URLs. A room's history mounts a
 * couple hundred entries, and an unbounded cache would pin every mounted
 * item's whole blob in memory forever — so a URL is created only when an
 * item is near the viewport, and its holder (the item, or the viewer
 * showing it) RELEASES it when it goes far or unmounts. The LRU evicts and
 * revokes only what nobody holds: the held set is the near set, and the
 * cache is bounded by near set plus LRU cap. The cap counts URLs, not
 * bytes — a video in the viewer is one URL, whatever it weighs — declared,
 * because a byte-capped cache would strand a 100 MiB video that the
 * reader just asked to watch.
 */

import { readRoomMedia } from "./roomMedia";

const URL_CAP = 24;

const urls = new Map<string, string>();
const holds = new Map<string, number>();
const loading = new Map<string, Promise<string | null>>();

/** Everything this session holds, revoked at once: the shelf was cleared,
    and no URL may outlive the blobs it names. */
export function forgetAllRoomMediaUrls(): void {
  for (const url of urls.values()) URL.revokeObjectURL(url);
  urls.clear();
}

/** A held URL is one the LRU will not evict: something on screen is using
    it. Holds are counted; a far-away item releases what it held. */
export function holdRoomMediaUrl(id: string): void {
  holds.set(id, (holds.get(id) ?? 0) + 1);
}

export function releaseRoomMediaUrl(id: string): void {
  const held = holds.get(id) ?? 0;
  if (held <= 1) {
    holds.delete(id);
    trimToCap();
  } else {
    holds.set(id, held - 1);
  }
}

/** Past the cap, the oldest UNHELD URLs go — held ones stay whole even
    over the cap (what is on screen is bounded by the near set); when a
    hold drops, the excess it justified leaves with it. */
function trimToCap(): void {
  while (urls.size > URL_CAP) {
    let evictedId: string | undefined;
    for (const candidate of urls.keys()) {
      if (!holds.has(candidate)) {
        evictedId = candidate;
        break;
      }
    }
    if (evictedId === undefined) break;
    const evicted = urls.get(evictedId);
    urls.delete(evictedId);
    if (evicted !== undefined) URL.revokeObjectURL(evicted);
  }
}

/** One blob's URL, read at most once per session while it stays held; null
    when the shelf refuses the read (gone, cleared, or not this member's
    to see) — the caller's fallback-words case. */
export function acquireRoomMediaUrl(id: string, mime: string): Promise<string | null> {
  const held = urls.get(id);
  if (held !== undefined) {
    // Touched: the newest entry is the last the LRU would evict.
    urls.delete(id);
    urls.set(id, held);
    return Promise.resolve(held);
  }
  const pending = loading.get(id);
  if (pending !== undefined) return pending;
  const read = readRoomMedia(id)
    .then((bytes) => {
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      urls.delete(id);
      urls.set(id, url);
      trimToCap();
      return url;
    })
    .catch(() => null)
    .finally(() => {
      loading.delete(id);
    });
  loading.set(id, read);
  return read;
}
