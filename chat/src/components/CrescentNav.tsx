import { useMemo, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { SurfaceKey } from "../app/surfaces";
import { SURFACES, SURFACE_KEYS } from "../app/surfaces";
import {
  CRESCENT_LABEL_MAX_WIDTH,
  CRESCENT_SHELL_WIDTH,
  CRESCENT_VISIBLE_COUNT,
  layoutCrescent,
} from "../app/crescentLayout";
import "./CrescentNav.css";

interface CrescentNavProps {
  activeSurface: SurfaceKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (surface: SurfaceKey) => void;
}

/**
 * Navigation between the app's surfaces on an arc of circle, ported from
 * devboule-v2's Shell. Six points, six surfaces: no paging by design.
 * Hovering the sliver opens it; leaving the shell, or moving well below
 * it, closes. The keyboard keeps a deliberate way in (Enter / ArrowDown).
 */
export function CrescentNav({ activeSurface, open, onOpenChange, onSelect }: CrescentNavProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  // Six keys, six slots, offset zero: canPrev/canNext are always false.
  const layout = useMemo(() => layoutCrescent(SURFACE_KEYS, CRESCENT_VISIBLE_COUNT, 0), []);

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
      aria-label="App sections"
      onPointerMove={handlePointerMove}
      onPointerLeave={open ? () => close() : undefined}
      onKeyDown={handleKeyDown}
    >
      <button
        type="button"
        ref={triggerRef}
        className="crescent-sliver"
        aria-label={open ? "Hide sections" : "Show sections"}
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

        {layout.points.map((point) => {
          const surface = SURFACES.find((item) => item.key === point.key);
          if (!surface) return null;
          const isActive = surface.key === activeSurface;
          return (
            <button
              type="button"
              key={surface.key}
              className={`nav-point${isActive ? " nav-point-active" : ""}`}
              style={{
                left: `${(point.x / CRESCENT_SHELL_WIDTH) * 100}%`,
                top: point.y,
              }}
              aria-label={`Open ${surface.label}`}
              aria-current={isActive ? "page" : undefined}
              onClick={() => {
                onSelect(surface.key);
                close();
                triggerRef.current?.focus();
              }}
            >
              <span className="nav-point-circle" aria-hidden="true">
                {surface.label.slice(0, 1)}
              </span>
              <span className="nav-point-label" style={{ maxWidth: CRESCENT_LABEL_MAX_WIDTH }}>
                {surface.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
