// The room's media on screen: pictures as thumbnails that read their blob
// only when NEAR the viewport, the video behind a poster until the reader
// presses play — no entry costs a read nobody looks at, and the reads that
// do happen live in one small LRU (lib/roomMediaCache). A blob that will
// not come — gone, cleared, or not this member's to see — renders the
// computer's own fallback words, which is what a phone from before this
// section would show.

import { useEffect, useRef, useState } from "react";
import { acquireRoomMediaUrl, holdRoomMediaUrl, releaseRoomMediaUrl } from "../lib/roomMediaCache";
import type { RoomMediaDescriptor } from "../lib/roomMedia";
import { MediaViewer } from "./MediaViewer";
import "./RoomMedia.css";

interface MediaWords {
  videoUnavailable: string;
  imageUnavailable: string;
  videoLabel: string;
  enlarge: string;
  playVideo: string;
  /** The computer's stored fallback tokens (§5b), shown again when the
      blob itself cannot be shown: the same words every reader sees. */
  fallbackImage: string;
  fallbackVideo: string;
}

/** Near enough to read: the margin the observer is given, so a thumbnail
    is ready a screen before it is looked at. */
const NEAR_VIEWPORT = "300px";
/** How long a gone-far item keeps its URL before handing it back. */
const RELEASE_GRACE_MS = 2000;

function durationLabel(durationMs: number | null): string {
  if (durationMs === null || durationMs <= 0) return "";
  const total = Math.round(durationMs / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** A message's media, laid out as it was attached. Clicking a picture
    opens the one viewer over the whole message — pictures and the video
    together, each loaded through the room's bounded cache. */
export function RoomMediaGrid({ media, words }: { media: RoomMediaDescriptor[]; words: MediaWords }) {
  const [viewing, setViewing] = useState<number | null>(null);
  // What the viewer is showing right now, held against the LRU.
  const viewerHold = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (viewerHold.current !== null) releaseRoomMediaUrl(viewerHold.current);
    },
    [],
  );
  if (media.length === 0) return null;
  const openAt = (postIndex: number): void => setViewing(postIndex);
  return (
    <>
      <div className="room-media">
        {media.map((item, postIndex) => (
          <RoomMediaItem
            key={item.id}
            item={item}
            words={words}
            onOpen={() => openAt(postIndex)}
          />
        ))}
      </div>
      {viewing !== null ? (
        <MediaViewer
          items={media.map((item) => ({ id: item.id, kind: item.kind }))}
          index={Math.min(viewing, media.length - 1)}
          load={async (entry) => {
            const found = media.find((one) => one.id === entry.id);
            if (found === undefined) return null;
            const answer = await acquireRoomMediaUrl(found.id, found.mime);
            if (answer !== null) {
              if (viewerHold.current !== null && viewerHold.current !== found.id) {
                releaseRoomMediaUrl(viewerHold.current);
              }
              holdRoomMediaUrl(found.id);
              viewerHold.current = found.id;
            }
            return answer;
          }}
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
  onOpen: () => void;
}) {
  const holder = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  // The read succeeded and the element still did not show: a CSP refusal or
  // a dead URL renders nothing, and the reader must not be left guessing
  // which of "blocked" and "gone" they are looking at.
  const [renderFailed, setRenderFailed] = useState(false);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (playing) return undefined;
    const el = holder.current;
    if (el === null) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setNear(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => setNear(entries.some((entry) => entry.isIntersecting)),
      { rootMargin: NEAR_VIEWPORT },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [playing]);

  useEffect(() => {
    // A video reads NOTHING until the reader presses play — nearness arms
    // the poster (a frame, a length), not the blob.
    if (item.kind === "video" && !playing) return undefined;
    if (!near || url !== null || failed) return undefined;
    let alive = true;
    void acquireRoomMediaUrl(item.id, item.mime).then((answer) => {
      if (!alive) return;
      if (answer === null) setFailed(true);
      else setUrl(answer);
    });
    return () => {
      alive = false;
    };
  }, [near, url, failed, item.id, item.mime, item.kind, playing]);

  // The url this item holds is held exactly while it shows it: one effect
  // takes the hold and its own cleanup gives it back, so no acquire/release
  // cycle can drift the count. Going far or unmounting hands the URL to
  // the LRU — which may then revoke it, and a later return reads the blob
  // again. That is the memory contract.
  useEffect(() => {
    if (url === null) return undefined;
    holdRoomMediaUrl(item.id);
    return () => releaseRoomMediaUrl(item.id);
  }, [url, item.id]);

  // Going far hands the URL back — but not on the flicker of a scroll
  // adjustment: intersection can report false for a frame while the
  // thread's own stick-to-bottom settles, and an item that dropped its
  // picture for a frame would flicker a placeholder into the reader's eye.
  useEffect(() => {
    if (near || url === null) return undefined;
    const timer = setTimeout(() => setUrl(null), RELEASE_GRACE_MS);
    return () => clearTimeout(timer);
  }, [near, url]);

  // One stable wrapper, observed across every branch: the ref must not
  // follow the content it watches, or a branch change leaves the observer
  // on a detached node and nearness is stuck forever.
  let body: JSX.Element;
  if (item.kind === "video") {
    // Nothing of a video is read until the reader asks for it: the poster
    // is a still the sender uploaded, or a quiet tile with the length.
    if (!playing) {
      body = (
        <>
          {item.frames.length > 0 ? (
            <VideoPoster frameId={item.frames[0]} near={near} />
          ) : null}
          <span className="room-media-poster-length">{durationLabel(item.duration_ms)}</span>
          <button
            type="button"
            className="room-media-play"
            aria-label={words.playVideo}
            onClick={(event) => {
              event.stopPropagation();
              setPlaying(true);
            }}
          >
            ▶
          </button>
          {failed ? <span className="room-media-fallback">{words.fallbackVideo}</span> : null}
        </>
      );
    } else {
      body = url ? (
        <video className="room-media-video" controls autoPlay src={url} aria-label={words.videoLabel} />
      ) : (
        <>
          {failed ? (
            <span className="room-media-fallback">{words.fallbackVideo}</span>
          ) : (
            <span className="room-media-loading" />
          )}
        </>
      );
    }
  } else if (failed || renderFailed) {
    body = (
      <span className="room-media-fallback" title={words.imageUnavailable}>
        {words.fallbackImage}
      </span>
    );
  } else if (!url) {
    body = (
      <div className="room-media-thumb-placeholder" aria-hidden={!near}>
        {near ? <span className="room-media-loading" /> : null}
      </div>
    );
  } else {
    body = (
      <button type="button" className="room-media-thumb" onClick={onOpen} aria-label={words.enlarge}>
        <img src={url} alt="" onError={() => setRenderFailed(true)} />
      </button>
    );
  }
  if (item.kind === "video" && !playing) {
    // The whole tile opens the viewer, as a picture's thumbnail does: the
    // walk's finding — the tile answered four clicks with nothing while the
    // ▶ beside it played. The ▶ keeps its inline play.
    return (
      <div
        ref={holder}
        className="room-media-item room-media-item-tile"
        role="button"
        tabIndex={0}
        aria-label={words.playVideo}
        onClick={() => onOpen()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
      >
        {body}
      </div>
    );
  }
  return (
    <div ref={holder} className="room-media-item">
      {body}
    </div>
  );
}

/** The video's poster: the sender's first uploaded frame, read through the
    same bounded cache as any picture. */
function VideoPoster({ frameId, near }: { frameId: string; near: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!near) return undefined;
    let alive = true;
    void acquireRoomMediaUrl(frameId, "image/jpeg").then((answer) => {
      if (alive && answer !== null) setUrl(answer);
    });
    return () => {
      alive = false;
    };
  }, [near, frameId]);
  // A frame that will not render (blocked, dead) leaves the quiet tile with
  // the length — never a broken image on a video nobody has asked for.
  if (gone || url === null) return null;
  return (
    <img className="room-media-poster-frame" src={url} alt="" onError={() => setGone(true)} />
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
