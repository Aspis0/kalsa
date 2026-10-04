// The host's room, on this computer: the chat's own pieces — the thread's
// bubbles, the composer, the waiting dots — wearing what a room has and a
// chat has not. Who wrote each message, who is in, and the call to Kalsa.
// Every user-visible sentence comes from the language table (the backend's
// codes its keys); a state the user can neither understand nor fix is not
// shown at all.

import { Fragment, useEffect, useRef, useState } from "react";
import { available } from "../lib/tauri";
import { useStickToBottom } from "../lib/stickToBottom";
import { RoomText } from "../lib/roomMention";
import { assignNameColors, assignNameTints, KALSA_NAME_COLOR, KALSA_TINT } from "../lib/roomColors";
import { isImageFile, prepareImage } from "../lib/images";
import type { PreparedImage } from "../lib/images";
import { AttachmentError } from "../lib/attachments";
import { prepareVideo, VideoCanceled } from "../lib/video";
import {
  clearRoomMedia,
  RoomMediaError,
  ROOM_IMAGE_MAX_BYTES,
  ROOM_VIDEO_MAX_BYTES,
  uploadRoomMedia,
} from "../lib/roomMedia";
import type { RoomMediaDescriptor } from "../lib/roomMedia";
import { forgetAllRoomMediaUrls } from "../lib/roomMediaCache";
import { uid } from "../lib/store";
import { isFallbackText, RoomMediaGrid } from "../components/RoomMediaGrid";
import { RoomMediaChips } from "../components/RoomMediaChips";
import { Composer } from "../components/Composer";
import { Markdown } from "../components/Markdown";
import { Thinking } from "../components/Thread";
import { clockTime, dayLabel, fullStamp, msUntilNextLocalMidnight, sameLocalDay } from "./roomTime";
import type { RoomEntry, RoomInfo } from "./roomFeed";
import { useRoomFeed } from "./useRoomFeed";
import { useLanguage } from "../i18n/useLanguage";
import "../components/Thread.css";
import "./RoomSurface.css";

/** The waiting line, in queue order: who is next, then the rest joined
    the way the chosen language lists them — whole messages, never joined
    fragments. */
export function queueLine(queue: string[], table: { queueNext: (a: string) => string; queueThen: (a: string, b: string) => string; listJoin: (items: string[]) => string }): string {
  if (queue.length === 0) return "";
  const [next, ...rest] = queue;
  if (rest.length === 0) return table.queueNext(next);
  const last = rest[rest.length - 1];
  const earlier = rest.slice(0, -1);
  const restPart = earlier.length > 0 ? table.listJoin([...earlier, last]) : last;
  return table.queueThen(next, restPart);
}

/** One picture or video on its way into the room: prepared here (a video
    compressed, its frames pulled), uploaded at send, then posted by id.
    The object URL is this chip's own and dies when the chip does. */
interface RoomPendingMedia {
  id: string;
  kind: "image" | "video";
  state: "compressing" | "ready" | "uploading";
  progress: number;
  url: string | null;
  blob: Blob | null;
  width: number;
  height: number;
  durationMs: number | null;
  frames: PreparedImage[];
  /** The descriptor of an upload that already landed: a retried post
      reuses it instead of writing a second blob to the shelf. */
  uploaded: RoomMediaDescriptor | null;
}

export function RoomSurface() {
  const feed = useRoomFeed();
  const { table, tag } = useLanguage();
  const room = table.room;
  const mediaWords = room.media;
  const { info, note, entries, live } = feed;
  // The backend leaves an UNNAMED host's name empty — the computer's own
  // label is English words nobody chose — and the page renders the
  // household's words for it. A set name crosses as itself.
  const localName = (name: string): string => (name === "" ? room.defaultHostName : name);
  const [draft, setDraft] = useState("");
  // The media on their way in, and the one sentence an attach or an
  // upload refused with. Both live here, with the draft's own durability.
  const [pendingMedia, setPendingMedia] = useState<RoomPendingMedia[]>([]);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const cancelers = useRef(new Map<string, { canceled: boolean }>());
  // The shelf's broom: the confirm it asks with, and the epoch a cleared
  // shelf bumps so every row's media re-asks a shelf that now says nothing.
  const [clearing, setClearing] = useState(false);
  const [mediaEpoch, setMediaEpoch] = useState(0);

  // The header's name affordance exists only while there is a name to
  // show: a bare "You are …" is noise, and the placeholder copy is not
  // approved.
  const hostMember = info?.members.find((member) => member.kind === "host");
  const hostName = hostMember ? localName(hostMember.name) : "";
  const [naming, setNaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");

  const ai = info?.ai;
  // A stop can act exactly while a turn runs — thinking or answering.
  // `running` is the feed's own word for that; the composer wears it as
  // the chat wears streaming.
  const turnRunning = ai?.running != null;

  // Glued to the bottom while the answer arrives, unless the reader
  // scrolled up — the thread's own rule.
  const { ref: scrollRef, following, toBottom } = useStickToBottom();

  // The day labels stand on this reading; a timer moves it when the local
  // day does, so an idle Room cannot keep yesterday's "Today".
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer = 0;
    const arm = (): void => {
      // A zone whose midnight the clock skipped can put the arithmetic
      // midnight behind the reading; the floor keeps the re-arm from
      // becoming a busy loop.
      const wait = Math.max(msUntilNextLocalMidnight(Date.now()), 1_000);
      timer = window.setTimeout(() => {
        setNow(Date.now());
        arm();
      }, wait);
    };
    arm();
    return () => window.clearTimeout(timer);
  }, []);

  // Both sends ride the one composer: the store adds the call itself when
  // the words name @Kalsa, and the quiet button names it outright. A bare
  // "@" names nobody — nothing to post, nobody to ask. The answer is the
  // feed's own, so a send the room refused leaves the words in the composer
  // for exactly as long as it leaves them nowhere else.
  async function post(text: string, withCall: boolean): Promise<boolean> {
    const body = text.trim();
    if ((!body && pendingMedia.length === 0) || body === "@") return false;
    if (pendingMedia.length === 0) return feed.send(body, withCall);
    return postWithMedia(body, withCall);
  }

  function patchMedia(id: string, patch: Partial<RoomPendingMedia>): void {
    setPendingMedia((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function dropMedia(id: string): void {
    setPendingMedia((current) => {
      const chip = current.find((item) => item.id === id);
      if (chip?.url) URL.revokeObjectURL(chip.url);
      return current.filter((item) => item.id !== id);
    });
    cancelers.current.delete(id);
  }

  // Attach: pictures are prepared at once (one road as the chat's); a
  // video compresses here in the webview with its progress on the chip,
  // cancelable, and its frames pulled beside it. A file that is neither is
  // a sentence, never a silence. Eight ride one message — the shelf's own
  // post cap (§5b) — and the ninth is a sentence too.
  const MEDIA_PER_POST = 8;
  async function attachMedia(files: FileList | File[]): Promise<void> {
    setMediaError(null);
    let room = MEDIA_PER_POST - pendingMedia.length;
    for (const file of Array.from(files)) {
      if (room <= 0) {
        setMediaError(mediaWords.tooManyMedia);
        continue;
      }
      if (isImageFile(file)) {
        room -= 1;
        const id = uid();
        const gate = { canceled: false };
        cancelers.current.set(id, gate);
        setPendingMedia((current) => [
          ...current,
          {
            id,
            kind: "image",
            state: "compressing",
            progress: 0,
            url: null,
            blob: null,
            width: 0,
            height: 0,
            durationMs: null,
            frames: [],
            uploaded: null,
          },
        ]);
        try {
          const image = await prepareImage(file);
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          patchMedia(id, {
            state: "ready",
            url: URL.createObjectURL(image.blob),
            blob: image.blob,
            width: image.width,
            height: image.height,
          });
        } catch (error) {
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          setMediaError(
            error instanceof AttachmentError && error.failure === "too-big"
              ? mediaWords.tooLargeImage
              : mediaWords.imageUnreadable,
          );
          dropMedia(id);
        } finally {
          cancelers.current.delete(id);
        }
        continue;
      }
      if (file.type.startsWith("video/") || /\.(mp4|m4v|mov)$/i.test(file.name)) {
        room -= 1;
        const id = uid();
        const gate = { canceled: false };
        cancelers.current.set(id, gate);
        setPendingMedia((current) => [
          ...current,
          {
            id,
            kind: "video",
            state: "compressing",
            progress: 0,
            url: null,
            blob: null,
            width: 0,
            height: 0,
            durationMs: null,
            frames: [],
            uploaded: null,
          },
        ]);
        try {
          const video = await prepareVideo(
            file,
            (progress) => patchMedia(id, { progress }),
            gate,
          );
          // A cancel that landed while the last frames were drawn leaves
          // the prepared bytes unwanted: no URL for a chip already gone.
          if (gate.canceled) {
            dropMedia(id);
            continue;
          }
          patchMedia(id, {
            state: "ready",
            progress: 1,
            url: URL.createObjectURL(video.blob),
            blob: video.blob,
            width: video.width,
            height: video.height,
            durationMs: video.durationMs,
            frames: video.frames,
          });
        } catch (error) {
          dropMedia(id);
          if (error instanceof VideoCanceled || gate.canceled) continue;
          setMediaError(
            error instanceof AttachmentError && error.failure === "too-big"
              ? mediaWords.tooLargeVideo
              : mediaWords.undecodableVideo,
          );
        } finally {
          cancelers.current.delete(id);
        }
        continue;
      }
      setMediaError(mediaWords.notMedia);
    }
  }

  function cancelMedia(id: string): void {
    const gate = cancelers.current.get(id);
    if (gate) gate.canceled = true;
    dropMedia(id);
  }

  // The host's own broom. The full-shelf sentence points here because this
  // is the only thing that can make room; after it the shelf answers every
  // read with media_not_found and the rows meet that with the fallback
  // words, which is what §5b stored them for.
  async function clearRoomMediaNow(): Promise<void> {
    setClearing(false);
    try {
      await clearRoomMedia();
      // No URL may outlive the blobs it names; the epoch remounts the
      // rows' media so nothing renders bytes that are no longer there.
      forgetAllRoomMediaUrls();
      setMediaEpoch((epoch) => epoch + 1);
    } catch (error) {
      setMediaError(
        error instanceof RoomMediaError ? mediaSentence(error.code) : mediaWords.clearFailed,
      );
    }
  }

  /** §5b's refusal codes, in the household's words. */
  function mediaSentence(code: string): string {
    switch (code) {
      case "too_large":
        return mediaWords.tooLargeVideo;
      case "room_media_full":
        return mediaWords.full;
      case "media_bad_sha":
      case "media_incomplete":
      case "media_bad_magic":
        return mediaWords.uploadBroken;
      default:
        return mediaWords.uploadFailed;
    }
  }

  /** The upload road for one pending item: images direct; a video's frames
      first (the shelf checks the video's ids against them), then the video
      itself. An upload that already landed rides again by its id. */
  async function uploadPending(item: RoomPendingMedia): Promise<RoomMediaDescriptor> {
    if (item.uploaded) return item.uploaded;
    if (!item.blob) throw new RoomMediaError("internal");
    const bytes = new Uint8Array(await item.blob.arrayBuffer());
    if (item.kind === "image" && bytes.byteLength > ROOM_IMAGE_MAX_BYTES) {
      throw new RoomMediaError("too_large");
    }
    if (item.kind === "video" && bytes.byteLength > ROOM_VIDEO_MAX_BYTES) {
      throw new RoomMediaError("too_large");
    }
    const frames: string[] = [];
    for (const frame of item.frames) {
      const descriptor = await uploadRoomMedia(
        {
          kind: "image",
          mime: frame.mime,
          width: frame.width,
          height: frame.height,
          durationMs: null,
          frames: [],
        },
        new Uint8Array(await frame.blob.arrayBuffer()),
        () => {},
        cancelers.current.get(item.id),
      );
      frames.push(descriptor.id);
    }
    const descriptor = await uploadRoomMedia(
      {
        kind: item.kind,
        mime: item.kind === "video" ? "video/mp4" : item.blob.type,
        width: Math.max(1, item.width),
        height: Math.max(1, item.height),
        durationMs: item.durationMs,
        frames,
      },
      bytes,
      (progress) => patchMedia(item.id, { state: "uploading", progress }),
      cancelers.current.get(item.id),
    );
    patchMedia(item.id, { uploaded: descriptor, state: "ready", progress: 1 });
    return descriptor;
  }

  async function postWithMedia(body: string, withCall: boolean): Promise<boolean> {
    setMediaError(null);
    const items = [...pendingMedia];
    // The room's order: images first, then videos — a video's frames must
    // be on the shelf before its own reserve names them.
    const order = [...items.filter((item) => item.kind === "image"), ...items.filter((item) => item.kind === "video")];
    const ids: string[] = [];
    let inFlight: string | null = null;
    try {
      for (const item of order) {
        inFlight = item.id;
        setPendingMedia((current) =>
          current.map((held) => (held.id === item.id ? { ...held, state: "uploading", progress: 0 } : held)),
        );
        const descriptor = await uploadPending(item);
        ids.push(descriptor.id);
        inFlight = null;
      }
    } catch (error) {
      if (error instanceof RoomMediaError && error.code === "canceled") {
        return false;
      }
      setMediaError(
        error instanceof RoomMediaError ? mediaSentence(error.code) : mediaWords.uploadFailed,
      );
      // The chip whose upload failed leaves; everything that already
      // landed stays for the next send, under its own id.
      if (inFlight !== null) dropMedia(inFlight);
      setPendingMedia((current) =>
        current.map((held) => (held.state === "uploading" ? { ...held, state: "ready", progress: 1 } : held)),
      );
      return false;
    }
    const sent = await feed.send(body, withCall, ids);
    if (sent) {
      for (const item of items) dropMedia(item.id);
    }
    return sent;
  }

  async function saveName(): Promise<void> {
    setNaming(false);
    await feed.saveName(nameDraft.trim());
  }

  // The room closed (or there is no app to ask): one quiet fact, nothing
  // to fix, nothing else on the page.
  if (!available() || (info !== null && !info.open)) {
    return (
      <div className="surface-page room-page">
        <p className="surface-quiet">{room.closedRoom}</p>
      </div>
    );
  }

  // One policy for every code the backend sends — note, refusal, name
  // error, failed send: the table's sentence when the language knows the
  // code, and the app's own fallback when it does not. Never the backend's
  // English, which no other language's reader was promised.
  const line = (code: string | null | undefined): string | null =>
    code ? (room.notes[code] ?? room.noteFallback) : null;
  const noteLine = line(note?.code);
  const refusalLine = line(feed.refusal?.code);
  const nameLine = line(feed.nameError?.code);
  const sendErrorLine = line(feed.sendError?.code);
  // One color per member, stable order, Kalsa in green — and the tint of
  // the same hue every message of theirs washes with.
  const colors = assignNameColors(info?.members ?? []);
  const tints = assignNameTints(info?.members ?? []);

  return (
    <div className="surface-page room-page">
      <header className="room-head">
        <h2 className="surface-verdict">{info?.room_name || hostName || table.chrome.room}</h2>
        <div className="room-people">
          {(info?.members ?? []).map((member) => (
            <span className="room-person" key={member.member_id}>
              <span className="room-person-name" style={{ color: colors.get(member.member_id) }}>
                {localName(member.name)}
              </span>
              {member.former ? <span className="room-left">{room.left}</span> : null}
            </span>
          ))}
        </div>
        {hostName && !naming ? (
          <button
            type="button"
            className="room-name-chip"
            onClick={() => {
              setNameDraft(hostName);
              setNaming(true);
            }}
          >
            {room.youAre(hostName)}
          </button>
        ) : null}
        {naming ? (
          <form
            className="room-name"
            onSubmit={(event) => {
              event.preventDefault();
              void saveName();
            }}
          >
            <input
              type="text"
              className="brain-bar-input room-name-input"
              value={nameDraft}
              autoFocus
              aria-label={room.nameAria}
              placeholder={hostName || room.namePlaceholder}
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => void saveName()}
            />
            {nameLine ? <span className="room-name-error">{nameLine}</span> : null}
          </form>
        ) : null}
        {clearing ? (
          <div className="room-clear" role="alertdialog" aria-label={mediaWords.clearAction}>
            <span className="room-clear-ask">{mediaWords.clearConfirm}</span>
            <span className="room-clear-actions">
              <button type="button" className="room-clear-delete" onClick={() => void clearRoomMediaNow()}>
                {mediaWords.clearDelete}
              </button>
              <button type="button" onClick={() => setClearing(false)}>
                {mediaWords.clearKeep}
              </button>
            </span>
          </div>
        ) : (
          <button type="button" className="room-clear-chip" onClick={() => setClearing(true)}>
            {mediaWords.clearAction}
          </button>
        )}
      </header>

      <div className="thread-wrap">
        <div
          ref={scrollRef}
          className="thread"
          aria-busy={turnRunning}
          aria-live="polite"
        >
          <div className="thread-column">
            {entries.length === 0 && live === null && !turnRunning ? (
              <p className="surface-quiet">{room.emptyRoom}</p>
            ) : null}
            {entries.map((entry, index) => {
              const when = entry.time * 1000;
              const newDay =
                index === 0 || !sameLocalDay(entries[index - 1].time * 1000, when);
              const label = dayLabel(when, now, tag);
              return (
                <Fragment key={entry.seq}>
                  {newDay ? (
                    <div className="room-day" role="separator" aria-label={label}>
                      {label}
                    </div>
                  ) : null}
                  <RoomRow
                    mediaEpoch={mediaEpoch}
                    entry={entry}
                    info={info ?? null}
                    color={colors.get(entry.member_id)}
                    tint={tints.get(entry.member_id)}
                    grouped={!newDay && entries[index - 1].member_id === entry.member_id}
                    defaultHostName={room.defaultHostName}
                    asked={room.askedKalsa}
                    left={room.left}
                    readLast={room.readLast}
                    when={fullStamp(when, tag)}
                    clock={clockTime(when, tag)}
                  />
                </Fragment>
              );
            })}
            {live !== null || turnRunning ? (
              // No clock on the live turn: the feed holds no moment for it,
              // and an invented one would be a lie. The message's own time
              // arrives with the message.
              <div className="row room-row">
                <div className="room-author">
                  <span className="room-author-name" style={{ color: KALSA_NAME_COLOR }}>
                    Kalsa
                  </span>
                </div>
                <div
                  className="room-bubble"
                  style={{ "--room-bubble-color": KALSA_NAME_COLOR, "--room-bubble-tint": KALSA_TINT } as React.CSSProperties}
                >
                  {live !== null && live.text !== "" ? (
                    <Markdown text={live.text} streaming />
                  ) : (
                    <Thinking />
                  )}
                </div>
              </div>
            ) : null}
          </div>
          {!following ? (
            <button
              type="button"
              className="jump-bottom"
              onClick={toBottom}
            >
              {table.thread.backToLatest}
            </button>
          ) : null}
        </div>

        <div className="room-turn">
          {!turnRunning && ai && ai.queue.length > 0 ? (
            <p className="surface-quiet">{queueLine(ai.queue.map(localName), room)}</p>
          ) : null}
          {refusalLine ? <p className="surface-quiet">{refusalLine}</p> : null}
          {noteLine ? <p className="surface-quiet">{noteLine}</p> : null}
        </div>
        {sendErrorLine ? (
          <p className="surface-quiet room-send-error" role="alert">
            {sendErrorLine}
          </p>
        ) : null}
        {mediaError ? (
          <p className="surface-quiet room-send-error" role="alert">
            {mediaError}
          </p>
        ) : null}
        <Composer
          streaming={turnRunning}
          opening={false}
          draft={draft}
          onDraftChange={setDraft}
          onSend={(text) => post(text, false)}
          onStop={() => void feed.stop()}
          onAttach={(files) => void attachMedia(files)}
          acceptsImages
          acceptsVideos
          mediaChips={
            <RoomMediaChips
              items={pendingMedia}
              words={mediaWords}
              onCancel={cancelMedia}
              onRemove={dropMedia}
            />
          }
          sendBlocked={pendingMedia.some((item) => item.state === "compressing")}
          allowsMediaOnly={pendingMedia.length > 0}
          ask={
            ai
              ? {
                  label: room.askKalsa,
                  disabled: ai.you_pending,
                  onAsk: (text) => post(text, true),
                }
              : undefined
          }
        />
      </div>
    </div>
  );
}

/** One message of the room. The author's name sits above in their color
    with the dot of it — once for a run of consecutive messages — and the
    bubble washes with the tint of the same hue, edged in the full color:
    whose words these are is readable at a glance, this computer's own on
    the right in their own color rather than a generic grey. A member who
    left holds no slot: their name wears the page's ink and their bubble
    the page's muted surface. */
function RoomRow({
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
  /** The hour and minute shown in the bubble's corner. */
  clock: string;
}) {
  const own = info !== null && entry.member_id === info.you;
  const aiId = info?.members.find((member) => member.kind === "ai")?.member_id;
  const isKalsa = entry.member_id === aiId;
  const media = entry.media !== undefined && entry.media.length > 0;
  // The words that actually render: a media post's "[Image]" fallback
  // belongs to the pixels, not to the text flow.
  const words = entry.text !== "" && !(media && isFallbackText(entry.text));
  const overMedia = !words && media;
  const style = {
    "--room-bubble-color": color,
    "--room-bubble-tint": tint,
    // Quoted: the invisible markdown spacer reads it as a CSS string.
    "--room-clock": `"${clock}"`,
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
      <div className="room-bubble" style={style}>
        {entry.call_ai && !isKalsa ? <span className="room-asked">{asked} </span> : null}
        <RoomMediaInBubble key={mediaEpoch} entry={entry} />
        {words ? (
          isKalsa ? <Markdown text={entry.text} /> : <RoomText text={entry.text} />
        ) : null}
        {entry.read !== null && entry.read !== undefined ? (
          <span className="room-read">{readLast(entry.read)}</span>
        ) : null}
        {clock ? (
          <>
            {/* A markdown answer reserves inside its last block (the ::after
                rule); plain words reserve with this twin on the last line. */}
            {words && !isKalsa ? (
              <span className="room-time-reserve" aria-hidden="true">
                {clock}
              </span>
            ) : null}
            <span className={`room-time${overMedia ? " room-time-over-media" : ""}`}>
              {clock}
            </span>
          </>
        ) : null}
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
