// The room's media on screen: a message's pictures as thumbnails, its video
// inline, every blob read from the shelf through the host's read command and
// held as an object URL. A blob that will not come (gone, or not this
// member's to see) is a neutral placeholder, never a broken element.

import { useEffect, useState } from "react";
import { readRoomMedia } from "../lib/roomMedia";
import type { RoomMediaDescriptor } from "../lib/roomMedia";
import { MediaViewer } from "./MediaViewer";
import type { ViewerItem } from "./MediaViewer";
import "./RoomMedia.css";

/**
 * Blob URLs live as long as the session does: a revoke under a mounted row
 * would break an element that still shows the bytes, and the room's window
 * holds at most the feed's own 200 entries. The cost of that choice is
 * memory — a video read for the bubble stays resident — declared here, and
 * the reason chunked reads are the shape a future host should grow.
 */
const urlCache = new Map<string, string>();

function cachedUrl(id: string): string | null {
  return urlCache.get(id) ?? null;
}

/** One blob's object URL, read once per session. */
function useMediaUrl(id: string): { url: string | null; missing: boolean } {
  const [url, setUrl] = useState<string | null>(() => cachedUrl(id));
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const held = cachedUrl(id);
    if (held) {
      setUrl(held);
      setMissing(false);
      return undefined;
    }
    let alive = true;
    setUrl(null);
    setMissing(false);
    void readRoomMedia(id)
      .then(({ mime, data }) => {
        if (!alive) return;
        const created = URL.createObjectURL(new Blob([data], { type: mime }));
        urlCache.set(id, created);
        setUrl(created);
      })
      .catch(() => {
        if (alive) setMissing(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);
  return { url, missing };
}

interface MediaWords {
  videoUnavailable: string;
  imageUnavailable: string;
  videoLabel: string;
  enlarge: string;
}

/** The viewer's list: every blob of this message that is on screen, in post
    order, and where one post index lands in it. */
function viewerItemsOf(media: RoomMediaDescriptor[]): {
  items: ViewerItem[];
  indexOf: (postIndex: number) => number;
} {
  const items: ViewerItem[] = [];
  const at = new Map<number, number>();
  media.forEach((item, postIndex) => {
    const url = cachedUrl(item.id);
    if (url) {
      at.set(postIndex, items.length);
      items.push({ id: item.id, kind: item.kind, url });
    }
  });
  return { items, indexOf: (postIndex) => at.get(postIndex) ?? 0 };
}

/** A message's media, laid out as it was attached. Clicking a picture
    opens the one viewer over the whole message — pictures and the video
    together. The viewer's index counts the items that made it into the
    list (every blob on screen has), so it opens and navigates in that
    space. */
export function RoomMediaGrid({ media, words }: { media: RoomMediaDescriptor[]; words: MediaWords }) {
  const [viewing, setViewing] = useState<number | null>(null);
  if (media.length === 0) return null;
  const openAt = (postIndex: number): void =>
    setViewing(viewerItemsOf(media).indexOf(postIndex));
  const viewer = viewing === null ? null : viewerItemsOf(media);
  return (
    <>
      <div className="room-media">
        {media.map((item, postIndex) => (
          <RoomMediaItem
            key={item.id}
            item={item}
            words={words}
            onOpen={item.kind === "image" ? () => openAt(postIndex) : undefined}
          />
        ))}
      </div>
      {viewer !== null && viewer.items.length > 0 ? (
        <MediaViewer
          items={viewer.items}
          index={Math.min(viewing ?? 0, viewer.items.length - 1)}
          onNavigate={setViewing}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </>
  );
}

function RoomMediaItem({
  item,
  words,
  onOpen,
}: {
  item: RoomMediaDescriptor;
  words: MediaWords;
  onOpen?: () => void;
}) {
  const { url, missing } = useMediaUrl(item.id);
  if (missing) {
    return (
      <span
        className="room-media-missing"
        title={item.kind === "video" ? words.videoUnavailable : words.imageUnavailable}
      >
        {item.kind === "video" ? "▶" : "🖼"}
      </span>
    );
  }
  if (!url) return null;
  if (item.kind === "video") {
    // The inline player: controls, metadata on open — the bytes stay put
    // until the reader presses play.
    return (
      <video className="room-media-video" controls preload="metadata" src={url} aria-label={words.videoLabel} />
    );
  }
  return (
    <button type="button" className="room-media-thumb" onClick={onOpen} aria-label={words.enlarge}>
      <img src={url} alt="" />
    </button>
  );
}

/** The fallback words the computer stores for a media-only post (§5b):
    true only when the text is nothing but those tokens — a poster who
    wrote "[Image]" as their whole message meant the words, and keeps
    them. */
export function isFallbackText(text: string): boolean {
  const stripped = text.replace(/\[(Image|Video)\]/g, "").trim();
  return text.length > 0 && stripped.length === 0;
}
