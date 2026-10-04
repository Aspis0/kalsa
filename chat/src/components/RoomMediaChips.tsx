// The room composer's pending media: one chip per picture or video on its
// way in — compressing (cancelable), ready, or uploading (a fraction at a
// time). The compression and the upload live in the room page; this draws
// what the state says and answers the two presses.

import type { English } from "../i18n/en/all";

export interface RoomPendingChip {
  id: string;
  kind: "image" | "video";
  /** The object URL of the prepared bytes; null while still compressing. */
  url: string | null;
  state: "compressing" | "ready" | "uploading";
  /** 0→1 while compressing or uploading; unused when ready. */
  progress: number;
}

type Words = English["room"]["media"];

export function RoomMediaChips({
  items,
  words,
  onCancel,
  onRemove,
}: {
  items: RoomPendingChip[];
  words: Words;
  onCancel: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="room-media-chips">
      {items.map((item) => {
        const pct = Math.min(99, Math.max(1, Math.round(item.progress * 100)));
        const label =
          item.state === "compressing"
            ? words.compressing(pct)
            : item.state === "uploading"
              ? words.uploading(pct)
              : item.kind === "video"
                ? words.videoLabel
                : null;
        return (
          <figure key={item.id} className="room-media-chip">
            {item.url && item.kind === "image" ? (
              <img src={item.url} alt="" />
            ) : (
              <span className="room-media-chip-glyph" aria-hidden="true">
                ▶
              </span>
            )}
            {label !== null ? <figcaption className="room-media-chip-label">{label}</figcaption> : null}
            <button
              type="button"
              className="room-media-chip-remove"
              aria-label={item.state === "compressing" ? words.cancel : words.remove}
              onClick={() => (item.state === "compressing" ? onCancel(item.id) : onRemove(item.id))}
            >
              ×
            </button>
          </figure>
        );
      })}
    </div>
  );
}
