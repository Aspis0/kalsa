import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import "./Composer.css";

interface ComposerProps {
  streaming: boolean;
  // The unsent text lives above this component: going home and back
  // unmounts the composer, and a draft must survive the round trip.
  draft: string;
  onDraftChange: (text: string) => void;
  onSend: (text: string) => boolean;
  onStop: () => void;
  onAttach: (files: FileList) => void;
}

const MAX_HEIGHT = 200;

export function Composer({ streaming, draft, onDraftChange, onSend, onStop, onAttach }: ComposerProps) {
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const text = draft;
  const canSend = text.trim().length > 0 && !streaming;

  // Grow with the text up to MAX_HEIGHT, then scroll. Height only ever
  // derives from scrollHeight so the box never jumps while typing.
  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [text]);

  function send(): void {
    const value = text.trim();
    if (!value || streaming) return;
    if (onSend(value)) onDraftChange("");
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (streaming) {
        onStop();
      } else {
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
          placeholder="Write a message…"
          aria-label="Message"
        />
        <input
          ref={fileRef}
          type="file"
          className="visually-hidden"
          multiple
          accept=".txt,.md,.pdf,.docx,.pptx"
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
          aria-label="Attach a file"
          title="Attach a file (text, markdown, PDF, Word, PowerPoint)"
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
        {streaming ? (
          <button type="button" className="composer-action composer-stop" onClick={onStop} aria-label="Stop generating">
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
            aria-label="Send message"
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
      <p className="composer-hint">Enter sends · Shift+Enter adds a line</p>
    </div>
  );
}
