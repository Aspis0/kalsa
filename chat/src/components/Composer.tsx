import { useLayoutEffect, useRef } from "react";
import type { KeyboardEvent } from "react";
import { useLanguage } from "../i18n/useLanguage";
import { Icon } from "./Icon";
import "./Composer.css";

const MAX_HEIGHT = 200;

interface ComposerProps {
  draft: string;
  onDraftChange: (text: string) => void;
  /** Returns false when the words were not taken, so they stay in the box. */
  onSend: (text: string) => boolean;
}

/** The writing box. The text lives above it so navigation never loses a draft. */
export function Composer({ draft, onDraftChange, onSend }: ComposerProps) {
  const { table } = useLanguage();
  const t = table.composer;
  const areaRef = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.style.height = "auto";
    area.style.height = `${Math.min(area.scrollHeight, MAX_HEIGHT)}px`;
    area.style.overflowY = area.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
  }, [draft]);

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    if (onSend(draft)) onDraftChange("");
  }

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={areaRef}
          className="composer-input"
          rows={1}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t.placeholder}
          aria-label={t.messageAria}
        />
        <div className="composer-row">
          <span className="composer-note">{t.disclaimer}</span>
          <button
            type="button"
            className="composer-pill composer-send"
            disabled={draft.trim().length === 0}
            onClick={() => {
              if (onSend(draft)) onDraftChange("");
            }}
          >
            {t.send}
            <Icon name="up" size={16} stroke={2.4} />
          </button>
        </div>
      </div>
    </div>
  );
}
