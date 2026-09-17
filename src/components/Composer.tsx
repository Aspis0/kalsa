import { useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import "./Composer.css";

interface ComposerProps {
  streaming: boolean;
  onSend: (text: string) => boolean;
  onStop: () => void;
}

const MAX_HEIGHT = 200;

export function Composer({ streaming, onSend, onStop }: ComposerProps) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);
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
    if (onSend(value)) setText("");
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
          onChange={(event) => setText(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Write a message…"
          aria-label="Message"
        />
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
