import { isFallbackText, RoomMediaGrid } from "../components/RoomMediaGrid";
import { Markdown } from "../components/Markdown";
import { RoomText } from "../lib/roomMention";
import { useLanguage } from "../i18n/useLanguage";
import type { RoomEntry, RoomInfo } from "./roomFeed";
import "../components/Thread.css";
import "./RoomSurface.css";

/** One message of the room. The author's name sits above in their color
    with the dot of it — once for a run of consecutive messages — and the
    bubble washes with the tint of the same hue, edged in the full color:
    whose words these are is readable at a glance, this computer's own on
    the right in their own color rather than a generic grey. A member who
    left holds no slot: their name wears the page's ink and their bubble
    the page's muted surface. */
export function RoomRow({
  entry,
  mediaEpoch,
  info,
  color,
  tint,
  grouped,
  defaultHostName,
  asked,
  left,
  readLast,
  when,
  clock,
}: {
  entry: RoomEntry;
  /** Bumped when the shelf was cleared: the bubble's media remounts and
      re-asks a shelf that now refuses every read. */
  mediaEpoch: number;
  info: RoomInfo | null;
  /** The author's palette color, absent for a member no longer in the
      room: they hold no slot, and their name wears the page's own ink. */
  color: string | undefined;
  /** The same slot's tint, absent with the color. */
  tint: string | undefined;
  /** The previous message was this author's: their name is already above. */
  grouped: boolean;
  defaultHostName: string;
  asked: string;
  left: string;
  readLast: (count: number) => string;
  /** The whole moment, for the hover. */
  when: string;
  /** The hour and minute, on the bubble's last line. */
  clock: string;
}) {
  const own = info !== null && entry.member_id === info.you;
  const aiId = info?.members.find((member) => member.kind === "ai")?.member_id;
  const isKalsa = entry.member_id === aiId;
  const media = entry.media !== undefined && entry.media.length > 0;
  // The words that actually render: a media post's "[Image]" fallback
  // belongs to the pixels, not to the text flow.
  const words = entry.text !== "" && !(media && isFallbackText(entry.text));
  const style = {
    "--room-bubble-color": color,
    "--room-bubble-tint": tint,
  } as React.CSSProperties;
  return (
    <div className={`row room-row${own ? " room-row-own" : ""}${grouped ? " room-row-grouped" : ""}`} title={when}>
      {!grouped ? (
        <div className="room-author">
          <span className="room-author-name" style={{ color }}>
            {entry.name === "" ? defaultHostName : entry.name}
          </span>
          {entry.former ? <span className="room-left">{left}</span> : null}
        </div>
      ) : null}
      <div className={`room-bubble${isKalsa ? " room-bubble-kalsa" : ""}`} style={style}>
        {entry.call_ai && !isKalsa ? <span className="room-asked">{asked} </span> : null}
        <RoomMediaInBubble key={mediaEpoch} entry={entry} />
        {words ? (
          isKalsa ? <Markdown text={entry.text} /> : <RoomText text={entry.text} />
        ) : null}
        {entry.read !== null && entry.read !== undefined ? (
          <span className="room-read">{readLast(entry.read)}</span>
        ) : null}
        {clock ? <span className="room-time">{clock}</span> : null}
      </div>
    </div>
  );
}

/** A media post's blobs, above (or instead of) its words. The computer's
    fallback words — "[Image]", "[Video]" — belong to the pixels: they show
    only when the blobs themselves would not come. */
function RoomMediaInBubble({ entry }: { entry: RoomEntry }) {
  const { table } = useLanguage();
  if (!entry.media || entry.media.length === 0) return null;
  const words = table.room.media;
  return (
    <RoomMediaGrid
      media={entry.media}
      words={{
        videoUnavailable: words.videoUnavailable,
        imageUnavailable: words.imageUnavailable,
        videoLabel: words.videoLabel,
        enlarge: words.enlarge,
        playVideo: words.playVideo,
        fallbackImage: words.fallbackImage,
        fallbackVideo: words.fallbackVideo,
      }}
    />
  );
}
