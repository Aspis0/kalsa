import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "../i18n/useLanguage";
import "./Composer.css";

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
  thinking = null,
  onThinking,
  ask,
}: ComposerProps) {
  const { table } = useLanguage();
  const composer = table.composer;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = draft;
  const ready = text.trim().length > 0 && !opening;
  const canSend = ready && !streaming;

  // Grow with the text up to MAX_HEIGHT, then scroll. Height only ever
  // derives from scrollHeight so the box never jumps while typing.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  async function send(): Promise<void> {
    const value = text.trim();
    if (!value || streaming || opening) return;
    // The draft waits for the answer: a send that was refused keeps the
    // words where they were typed.
    if (await onSend(value)) onDraftChange("");
  }

  async function askKalsa(): Promise<void> {
    const value = text.trim();
    if (!value || streaming || opening || !ask || ask.disabled) return;
    if (await ask.onAsk(value)) onDraftChange("");
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

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          value={text}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
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
              accept=".txt,.md,.markdown,.csv,.json,.log,.pdf,.docx,.pptx"
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
              title="Attach a file (text, markdown, CSV, PDF, Word, PowerPoint)"
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
        {thinking === null || thinking === undefined ? null : (
          <button
            type="button"
            className={`composer-action composer-thinking${thinking ? " is-on" : ""}`}
            aria-pressed={thinking}
            aria-label={thinking ? composer.thinkingOff : composer.thinkingOn}
            title={
              thinking
                ? "Thinking: the model reasons before answering. Turn it off to be answered at once."
                : "Thinking off: the model answers at once, without reasoning first."
            }
            onClick={() => onThinking?.(!thinking)}
          >
            Think
          </button>
        )}
        {ask && !streaming ? (
          <button
            type="button"
            className="composer-action composer-ask"
            disabled={!ready || ask.disabled}
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
        {opening ? "Opening the chat…" : "Enter sends · Shift+Enter adds a line"}
      </p>
    </div>
  );
}
