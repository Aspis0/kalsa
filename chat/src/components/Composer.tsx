import { useLayoutEffect, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent, ReactNode } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { downloadBytes } from "../lib/downloadBytes";
import "./Composer.css";

/** One pending picture, chip-shaped: the reference and the object URL the
    chip shows (the pixels are IndexedDB's, the URL's life is the chip's). */
export interface ComposerImage {
  id: string;
  url: string;
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
  /** Null when this model's own template cannot read a thinking switch, in
      which case no control is shown: a switch that moves while nothing changes
      is worse than none. */
  thinking?: boolean | null;
  onThinking?: (enabled: boolean) => void;
  /** A second send beside the primary one — the Room's call to Kalsa. The
      chat leaves it out. `disabled` is the caller's own rule (a call of
      yours already pending); the words are the same draft, cleared when
      the send takes them. */
  ask?: { label: string; disabled: boolean; onAsk: (text: string) => boolean | Promise<boolean> };
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
  thinking = null,
  onThinking,
  ask,
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

  return (
    <div className="composer">
      {mediaChips}
      {pendingImages.length > 0 && onRemoveImage ? (
        <div className="composer-images">
          {pendingImages.map((image) => (
            <figure key={image.id} className="composer-image">
              <img
                src={image.url}
                alt=""
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
              <button
                type="button"
                className="composer-image-remove"
                aria-label={composer.removeImage}
                onClick={() => onRemoveImage(image.id)}
              >
                ×
              </button>
            </figure>
          ))}
        </div>
      ) : null}
      <div className="composer-box">
        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          value={text}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={composer.placeholder}
          aria-label={composer.messageAria}
        />
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
              className="composer-action composer-attach"
              aria-label={composer.attachAria}
              title={
                acceptsImages && acceptsVideos
                  ? composer.attachTitleMedia
                  : acceptsImages
                    ? composer.attachTitleImages
                    : composer.attachTitle
              }
              onClick={() => fileRef.current?.click()}
            >
              <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
                <path
                  d="M11.5 7.2 6.4 12.3a2.3 2.3 0 0 1-3.3-3.3l6-6a3.7 3.7 0 0 1 5.2 5.2l-6 6a5.1 5.1 0 0 1-7.2-7.2l5.5-5.5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </>
        ) : null}
        {visionOfferBytes !== null && onOfferVision ? (
          <button
            type="button"
            className="composer-action composer-vision"
            onClick={onOfferVision}
          >
            {visionWords.offer(downloadBytes(visionOfferBytes, tag))}
          </button>
        ) : null}
        {thinking === null || thinking === undefined ? null : (
          <button
            type="button"
            className={`composer-action composer-thinking${thinking ? " is-on" : ""}`}
            aria-pressed={thinking}
            aria-label={thinking ? composer.thinkingOff : composer.thinkingOn}
            title={thinking ? composer.thinkingOnTitle : composer.thinkingOffTitle}
            onClick={() => onThinking?.(!thinking)}
          >
            Think
          </button>
        )}
        {ask && !streaming ? (
          <button
            type="button"
            className="composer-action composer-ask"
            disabled={!ready || ask.disabled || held}
            onClick={askKalsa}
          >
            {ask.label}
          </button>
        ) : null}
        {streaming ? (
          <button type="button" className="composer-action composer-stop" onClick={onStop} aria-label={composer.stopGenerating}>
            <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
              <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" fill="currentColor" />
            </svg>
          </button>
        ) : (
          <button
            type="button"
            className="composer-action composer-send"
            onClick={send}
            disabled={!canSend}
            aria-label={composer.send}
          >
            <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
              <path
                d="M8 2.2v10.6M3.8 7 8 2.8 12.2 7"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}
      </div>
      <p className="composer-hint">
        {opening ? composer.hintOpening : composer.hintSend}
      </p>
    </div>
  );
}
