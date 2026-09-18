import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import {
  CRESCENT_LABEL_MAX_WIDTH,
  CRESCENT_SHELL_WIDTH,
  CRESCENT_VISIBLE_COUNT,
  layoutCrescent,
} from "../app/crescentLayout";
import "./CrescentNav.css";

export interface CrescentEntry {
  key: string;
  label: string;
  onSelect: () => void;
}

interface CrescentNavProps {
  entries: CrescentEntry[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The chat's own menu on an arc of circle, ported from devboule-v2's Shell.
 * It carries the way back to the brain and the chat's own things — never the
 * settings surfaces, which live on the brain page (THE-BRAIN-IS-THE-HOME.md
 * §5). Hovering the sliver opens it; leaving the shell, or moving well below
 * it, closes. The keyboard keeps a deliberate way in (Enter / ArrowDown).
 */
export function CrescentNav({ entries, open, onOpenChange }: CrescentNavProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Four entries, four slots, offset zero: canPrev/canNext are always false.
  const points = layoutCrescent(
    entries.map((entry) => entry.key),
    CRESCENT_VISIBLE_COUNT,
    0,
  ).points;

  function close(): void {
    onOpenChange(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLElement>): void {
    if (open && event.clientY > 170) close();
  }

  function openNav(): void {
    onOpenChange(true);
  }

  return (
    <div
      className="crescent-shell"
      role="navigation"
      aria-label="Chat menu"
      onPointerMove={handlePointerMove}
      onPointerLeave={open ? () => close() : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        className="crescent-sliver"
        aria-label={open ? "Hide menu" : "Show menu"}
        aria-expanded={open}
        aria-controls="crescent-surface-nav"
        onClick={() => (open ? close() : openNav())}
        onPointerEnter={() => !open && openNav()}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openNav();
          }
        }}
      />
      <div
        id="crescent-surface-nav"
        className={`crescent-nav${open ? " crescent-nav-open" : ""}`}
      >
        <div className="crescent-glow" aria-hidden="true" />
        <svg
          className="crescent-arc"
          viewBox={`0 0 ${CRESCENT_SHELL_WIDTH} 150`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d="M 240.8 21.9 A 410 410 0 0 0 699.2 21.9" vectorEffect="non-scaling-stroke" />
        </svg>

        {points.map((point) => {
          const entry = entries.find((item) => item.key === point.key);
          if (!entry) return null;
          return (
            <button
              type="button"
              key={entry.key}
              className="nav-point"
              style={{
                left: `${(point.x / CRESCENT_SHELL_WIDTH) * 100}%`,
                top: point.y,
              }}
              aria-label={`Open ${entry.label}`}
              onClick={() => {
                entry.onSelect();
                close();
                triggerRef.current?.focus();
              }}
            >
              <span className="nav-point-circle" aria-hidden="true">
                {entry.label.slice(0, 1)}
              </span>
              <span className="nav-point-label" style={{ maxWidth: CRESCENT_LABEL_MAX_WIDTH }}>
                {entry.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
