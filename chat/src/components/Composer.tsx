import { useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { downloadBytes } from "../lib/downloadBytes";
import { tap } from "../lib/browseArm";
import type { Arming } from "../lib/browseArm";
import type { Attachment } from "../lib/attachments";
import { ComposerChips } from "./ComposerChips";
import { Icon } from "./Icon";
import type { IconName } from "./Icon";
import "./Composer.css";

/** One pending chip: the reference and the object URL it shows — null for a
    video whose bytes were not kept, or while they are still being made. */
export interface ComposerImage {
  id: string;
  url: string | null;
  kind?: "image" | "video";
  /** The work line a compressing video chip carries ("Compressing… 42%"). */
  label?: string;
}

const DOCUMENT_ACCEPT = ".txt,.md,.markdown,.csv,.json,.log,.pdf,.docx,.pptx";
const IMAGE_ACCEPT = ".png,.jpg,.jpeg,.webp,.gif,.heic,.heif";
const VIDEO_ACCEPT = ".mp4,.m4v,.mov";

interface ComposerProps {
  streaming: boolean;
  // A chat is being opened at the door. Send and retry are frozen while it is
  // true, and the line below says why: the freeze costs a second of typing and
  // a missing signal costs a second chat.
  opening: boolean;
  // The unsent text lives above this component: going home and back
  // unmounts the composer, and a draft must survive the round trip.
  draft: string;
  onDraftChange: (text: string) => void;
  /** Whether the words were taken. Resolved before the draft is cleared, so
      a send that comes back false keeps the words where they were typed. */
  onSend: (text: string) => boolean | Promise<boolean>;
  onStop: () => void;
  // Absent where attachments have no route: the button and its hidden
  // input are not rendered at all (the Room carries words only).
  onAttach?: (files: FileList) => void;
  // Whether the model can see: the picker then offers pictures, and paste
  // and drop take them. Blind, nothing about images shows here at all.
  acceptsImages?: boolean;
  // The Room's picker: videos ride beside the pictures (the accept list
  // grows the kinds; the paste and drop route is the same onAttach).
  acceptsVideos?: boolean;
  // The room's pending media, chips the room page owns whole — this
  // component only places them above the box.
  mediaChips?: ReactNode;
  // True while something pending is still on its way (a video
  // compressing): both sends hold until the chips settle.
  sendBlocked?: boolean;
  // An empty box may send because media ride with it (the room's
  // media-only post); the chat's empty box still needs words.
  allowsMediaOnly?: boolean;
  /** The projector the brain has on the shelf, in bytes: the one quiet
      affordance beside the attach button. Null (or absent) when there is
      nothing to offer, and while the offer, the download or a refusal is
      already on screen. */
  visionOfferBytes?: number | null;
  onOfferVision?: () => void;
  // Pictures attached but not yet sent, removable like documents.
  images?: ComposerImage[];
  onRemoveImage?: (id: string) => void;
  /** Documents active in this conversation — they ride with the next send
      and are removable here exactly as in the files panel. Absent where
      documents have no route (the Room carries words only). */
  docs?: Attachment[];
  onRemoveDoc?: (id: string) => void;
  /** The pin each document chip carries: pinned rides every message, unpinned
      rides only this one. Absent means the surface offers no pin. */
  onPinDoc?: (id: string, pinned: boolean) => void;
  /** Null when this model's own template cannot read a thinking switch, in
      which case no control is shown: a switch that moves while nothing changes
      is worse than none. */
  thinking?: boolean | null;
  onThinking?: (enabled: boolean) => void;
  /** The browser control: null where there is no browser to offer, and the
      armed state otherwise. It arms the **next message only** — the composer
      never disarms it, the send does. */
  browse?: boolean | null;
  onBrowse?: (arming: Arming) => void;
  /** A second send beside the primary one — the Room's call to Kalsa. The
      chat leaves it out. `disabled` is the caller's own rule (a call of
      yours already pending); the words are the same draft, cleared when
      the send takes them. */
  /** The writing box's own prompt, where the page asks for something else (the Room). */
  placeholder?: string;
  ask?: { label: string; icon?: IconName; disabled: boolean; onAsk: (text: string) => boolean | Promise<boolean> };
  /** The attach button's own words and icon where the surface has them (the
      Room's photos); the chat's "Attach a file" otherwise. */
  attach?: { label: string; icon: IconName };
  /** The disclaimer, where the surface shortens it. */
  disclaimer?: string;
}

const MAX_HEIGHT = 200;

export function Composer({
  streaming,
  opening,
  draft,
  onDraftChange,
  onSend,
  onStop,
  onAttach,
  acceptsImages = false,
  acceptsVideos = false,
  mediaChips = null,
  sendBlocked = false,
  allowsMediaOnly = false,
  visionOfferBytes = null,
  onOfferVision,
  images,
  onRemoveImage,
  docs = [],
  onRemoveDoc,
  onPinDoc,
  thinking = null,
  onThinking,
  browse = null,
  onBrowse,
  ask,
  placeholder,
  attach,
  disclaimer,
}: ComposerProps) {
  const { table, tag } = useLanguage();
  const composer = table.composer;
  const visionWords = table.vision;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // A send is in flight — the words are with the room and the answer has
  // not come back. The ref is the guard (immediate, immune to batching);
  // the state is only the button's face. One flag covers both sends, so a
  // Send and an Ask-Kalsa cannot race each other into two posts either.
  const sendingNow = useRef(false);
  const [held, setHeld] = useState(false);
  const text = draft;
  const pendingImages = images ?? [];
  // An empty box sends when something rides with it: the pictures are the
  // message. Words alone still need words.
  const ready =
    (text.trim().length > 0 || pendingImages.length > 0 || allowsMediaOnly) && !opening;
  const canSend = ready && !streaming && !held && !sendBlocked;

  // Grow with the text up to MAX_HEIGHT, then scroll. Height only ever
  // derives from scrollHeight so the box never jumps while typing.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  // The one body both sends share: nothing leaves twice while a send is
  // still out — a second Enter or a second click during the round trip is
  // one post, not two.
  async function deliver(give: (value: string) => boolean | Promise<boolean>): Promise<void> {
    const value = text.trim();
    if (
      (!value && pendingImages.length === 0 && !allowsMediaOnly) ||
      streaming ||
      opening ||
      sendBlocked ||
      sendingNow.current
    ) {
      return;
    }
    sendingNow.current = true;
    setHeld(true);
    try {
      // The draft waits for the answer: a send that was refused keeps the
      // words where they were typed.
      if (await give(value)) onDraftChange("");
    } finally {
      sendingNow.current = false;
      setHeld(false);
    }
  }

  async function send(): Promise<void> {
    await deliver(onSend);
  }

  async function askKalsa(): Promise<void> {
    if (!ask || ask.disabled) return;
    await deliver(ask.onAsk);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (streaming) {
        onStop();
      } else if (!opening) {
        send();
      }
    }
  }

  // A picture on the clipboard is an attach, not a paste: the same road the
  // picker and the drop take. Text pastes as it always did.
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>): void {
    const files = event.clipboardData?.files;
    if (!files || files.length === 0) return;
    event.preventDefault();
    onAttach?.(files);
  }

  // The vision offer's one sentence, shown in the chip and again as its
  // title: the chip may truncate when the row is short, and the hover then
  // carries the whole offer.
  const visionLabel =
    visionOfferBytes !== null && onOfferVision
      ? visionWords.offer(downloadBytes(visionOfferBytes, tag))
      : null;

  return (
    <div className="composer">
      <div className="composer-box">
        {/* The Room's pending photos sit inside the box, above the words (16-room-media). */}
        {mediaChips}
        <ComposerChips
          docs={docs}
          onRemoveDoc={onRemoveDoc}
          onPinDoc={onPinDoc}
          images={pendingImages}
          onRemoveImage={onRemoveImage}
        />
        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          value={text}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder ?? composer.placeholder}
          aria-label={composer.messageAria}
        />
        <div className="composer-row">
          {onAttach ? (
            <>
              <input
                ref={fileRef}
                type="file"
                className="visually-hidden"
                multiple
                accept={
                  acceptsImages
                    ? `${DOCUMENT_ACCEPT},${IMAGE_ACCEPT}${acceptsVideos ? `,${VIDEO_ACCEPT}` : ""}`
                    : DOCUMENT_ACCEPT
                }
                aria-hidden="true"
                tabIndex={-1}
                onChange={(event) => {
                  if (event.target.files && event.target.files.length > 0) onAttach(event.target.files);
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="composer-pill composer-attach"
                title={
                  acceptsImages && acceptsVideos
                    ? composer.attachTitleMedia
                    : acceptsImages
                      ? composer.attachTitleImages
                      : composer.attachTitle
                }
                onClick={() => fileRef.current?.click()}
              >
                <Icon name={attach?.icon ?? "clip"} size={19} />
                {attach?.label ?? composer.attachAria}
              </button>
            </>
          ) : null}
          {visionLabel !== null ? (
            <button type="button" className="composer-pill composer-vision" title={visionLabel} onClick={onOfferVision}>
              <span className="composer-vision-label">{visionLabel}</span>
            </button>
          ) : null}
          {thinking === null || thinking === undefined ? null : (
            <button
              type="button"
              className={`composer-pill composer-thinking${thinking ? " is-on" : ""}`}
              aria-pressed={thinking}
              aria-label={thinking ? composer.thinkingOff : composer.thinkingOn}
              title={thinking ? composer.thinkingOnTitle : composer.thinkingOffTitle}
              onClick={() => onThinking?.(!thinking)}
            >
              <Icon name="thought" size={18} />
              {composer.think}
            </button>
          )}
          {/* The browser control. It arms the next message and nothing else:
              the send disarms it, and the person can disarm it before that. */}
          {browse === null || browse === undefined ? null : (
            <button
              type="button"
              className={`composer-pill composer-browser${browse ? " is-on" : ""}`}
              aria-pressed={browse}
              aria-label={browse ? composer.browserOff : composer.browser}
              title={browse ? composer.browserOnTitle : composer.browserTitle}
              onClick={() => onBrowse?.(tap({ armed: browse }))}
            >
              <Icon name="globe" size={18} />
              {browse ? composer.browserOn : composer.browser}
            </button>
          )}
          {/* Where the chat waits on the door, the line says so in place of the disclaimer. */}
          <span className="composer-note">{opening ? composer.hintOpening : (disclaimer ?? composer.disclaimer)}</span>
          {ask && !streaming ? (
            <button
              type="button"
              className="composer-pill composer-ask"
              disabled={!ready || ask.disabled || held}
              onClick={askKalsa}
            >
              {ask.icon ? <Icon name={ask.icon} size={18} /> : null}
              {ask.label}
            </button>
          ) : null}
          {streaming ? (
            <button type="button" className="composer-pill composer-stop" onClick={onStop}>
              <Icon name="square" size={15} stroke={2.6} />
              {composer.stop}
            </button>
          ) : (
            <button type="button" className="composer-pill composer-send" onClick={send} disabled={!canSend}>
              {composer.send}
              <Icon name="up" size={18} stroke={2.4} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
