import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { ConversationMeta } from "../lib/types";
import {
  CRESCENT_SHELL_WIDTH,
  CRESCENT_VISIBLE_COUNT,
  layoutCrescent,
} from "../app/crescentLayout";
import "./CrescentNav.css";

// devboule-v2 allows 100px labels for short surface names; conversation
// titles run longer, and six 100px labels collide across ~92px point gaps.
const CONVERSATION_LABEL_MAX_WIDTH = 78;

interface CrescentNavProps {
  conversations: ConversationMeta[];
  activeId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
}

/**
 * The conversation switcher on an arc of circle, ported from devboule-v2's
 * surface navigation. Pointer movement can only CLOSE it; opening is a
 * deliberate gesture (click / Enter / ArrowDown on the sliver).
 */
export function CrescentNav({
  conversations,
  activeId,
  open,
  onOpenChange,
  onSelect,
  onNew,
}: CrescentNavProps) {
  const [offset, setOffset] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<{ key?: string; delta: -1 | 1; arrow: boolean } | null>(null);
  const openRef = useRef(open);
  const keys = useMemo(() => conversations.map((c) => c.id), [conversations]);
  const layout = useMemo(
    () => layoutCrescent(keys, CRESCENT_VISIBLE_COUNT, offset),
    [keys, offset],
  );
  const byId = useMemo(() => new Map(conversations.map((c) => [c.id, c])), [conversations]);
  const hasItems = conversations.length > 0;

  useLayoutEffect(() => {
    openRef.current = open;
  }, [open ]);

  function close(): void {
    onOpenChange(false);
    setOffset(0);
  }

  function page(delta: -1 | 1): void {
    const el = document.activeElement;
    pendingFocus.current = {
      key: el instanceof HTMLElement ? el.dataset.convKey : undefined,
      delta,
      arrow:
        el instanceof HTMLElement &&
        el.classList.contains("crescent-page-arrow") &&
        el.dataset.convKey === undefined,
    };
    setOffset((o) => o + delta);
  }

  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    pendingFocus.current = null;
    if (!openRef.current || !pending) return;
    const visible = layout.visibleKeys;
    const keep = pending.key !== undefined && visible.includes(pending.key);
    if (!keep && pending.arrow) {
      const label = pending.delta === 1 ? "Show next conversations" : "Show previous conversations";
      navRef.current?.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)?.focus();
      return;
    }
    const focusKey = keep ? pending.key : pending.delta === 1 ? visible.at(-1) : visible[0];
    if (!focusKey) return;
    navRef.current
      ?.querySelector<HTMLButtonElement>(`[data-conv-key="${CSS.escape(focusKey)}"]`)
      ?.focus();
  }, [layout.visibleKeys]);

  function handleKeyDown(event: KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape") {
      if (!open) return;
      event.preventDefault();
      close();
      triggerRef.current?.focus();
      return;
    }
    if (!open) return;
    if (
      event.target instanceof Element &&
      event.target.closest("input, textarea, select, [contenteditable]") !== null
    ) {
      return;
    }
    if (event.key === "ArrowLeft" && layout.canPrev) {
      event.preventDefault();
      page(-1);
    } else if (event.key === "ArrowRight" && layout.canNext) {
      event.preventDefault();
      page(1);
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
      aria-label="Conversations"
      onPointerMove={handlePointerMove}
      onPointerLeave={open ? () => close() : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        className={`crescent-sliver${hasItems ? " crescent-sliver-has-items" : ""}`}
        aria-label={
          open
            ? "Hide conversations"
            : hasItems
              ? `Show ${conversations.length} conversation${conversations.length === 1 ? "" : "s"}`
              : "Show conversations"
        }
        aria-expanded={open}
        aria-controls="crescent-conversation-nav"
        onClick={() => (open ? close() : openNav())}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            openNav();
          }
        }}
      />
      <div
        id="crescent-conversation-nav"
        ref={navRef}
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

        {open && layout.canPrev ? (
          <button
            type="button"
            className="crescent-page-arrow crescent-page-arrow-prev"
            aria-label="Show previous conversations"
            onClick={() => page(-1)}
          >
            ‹
          </button>
        ) : null}
        {open && layout.canNext ? (
          <button
            type="button"
            className="crescent-page-arrow crescent-page-arrow-next"
            aria-label="Show next conversations"
            onClick={() => page(1)}
          >
            ›
          </button>
        ) : null}

        {layout.points.map((point) => {
          const conv = byId.get(point.key);
          if (!conv) return null;
          const isActive = conv.id === activeId;
          const initial = (conv.title || "?").trim().slice(0, 1).toUpperCase();
          return (
            <button
              type="button"
              key={conv.id}
              className={`nav-point${isActive ? " nav-point-active" : ""}`}
              style={{
                left: `${(point.x / CRESCENT_SHELL_WIDTH) * 100}%`,
                top: point.y,
              }}
              data-conv-key={conv.id}
              aria-label={`Open conversation: ${conv.title}`}
              aria-current={isActive ? "true" : undefined}
              title={conv.title}
              onClick={() => {
                onSelect(conv.id);
                close();
                triggerRef.current?.focus();
              }}
            >
              <span className="nav-point-circle" aria-hidden="true">
                {initial}
              </span>
              <span className="nav-point-label" style={{ maxWidth: CONVERSATION_LABEL_MAX_WIDTH }}>
                {conv.title}
              </span>
            </button>
          );
        })}

        {open && conversations.length === 0 ? (
          <button type="button" className="crescent-empty-new" onClick={onNew}>
            Start your first conversation
          </button>
        ) : null}
      </div>

      <svg
        className={`crescent-hint${open ? " crescent-hint-hidden" : ""}`}
        viewBox={`0 0 ${CRESCENT_SHELL_WIDTH} 40`}
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <path d="M 340 14 A 410 410 0 0 0 600 14" />
      </svg>
    </div>
  );
}
