import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { PropsWithChildren } from "react";
import type { KnobCopy } from "../lib/knobs/types";
import "./KnobInfo.css";

interface KnobInfoContextValue {
  openId: string | null;
  setOpenId: (id: string | null) => void;
}

const KnobInfoContext = createContext<KnobInfoContextValue | null>(null);

export function KnobInfoScope({ children }: PropsWithChildren): JSX.Element {
  const [openId, setOpenId] = useState<string | null>(null);
  return <KnobInfoContext.Provider value={{ openId, setOpenId }}>{children}</KnobInfoContext.Provider>;
}

function inside(root: HTMLElement, target: EventTarget | null): boolean {
  let node = target as (HTMLElement & { parentNode?: unknown }) | null;
  while (node) {
    if (node === root) return true;
    node = node.parentNode as (HTMLElement & { parentNode?: unknown }) | null;
  }
  return false;
}

export function KnobInfo({ knob }: { knob: KnobCopy }): JSX.Element {
  const local = useState<string | null>(null);
  const context = useContext(KnobInfoContext);
  const openId = context?.openId ?? local[0];
  const setOpenId = context?.setOpenId ?? local[1];
  const generatedId = useId().replace(/:/g, "");
  const instanceId = `${knob.wire}-${generatedId}`;
  const panelId = `knob-info-panel-${instanceId}`;
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [popoverPosition, setPopoverPosition] = useState({ left: 16, top: 16 });
  const isOpen = openId === instanceId;

  useEffect(() => {
    if (!isOpen) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      setOpenId(null);
      triggerRef.current?.focus();
    };
    const onPointerDown = (event: MouseEvent): void => {
      const root = rootRef.current;
      if (root && !inside(root, event.target)) setOpenId(null);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen, setOpenId]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const place = (): void => {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const popoverWidth = Math.min(320, Math.max(0, viewportWidth - 32));
      const left = Math.min(Math.max(16, rect.left), Math.max(16, viewportWidth - popoverWidth - 16));
      const top = Math.min(rect.bottom + 8, Math.max(16, viewportHeight - 336));
      setPopoverPosition({ left, top });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [isOpen]);

  function toggle(): void {
    setOpenId(isOpen ? null : instanceId);
  }

  return (
    <span className="knob-info" ref={rootRef}>
      <button
        type="button"
        className="knob-info-trigger"
        ref={triggerRef}
        aria-label={`What ${knob.label} does`}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
      >
        i
      </button>
      {isOpen ? (
        <span
          className="knob-info-popover"
          id={panelId}
          role="region"
          aria-label={`${knob.label} explanation`}
          style={{ left: popoverPosition.left, top: popoverPosition.top }}
        >
          <span className="knob-info-heading">What it is</span>
          <span>{knob.whatItIs}</span>
          <span className="knob-info-heading">What it’s for</span>
          <span>{knob.whatItsFor}</span>
          <span className="knob-info-heading">Usual values</span>
          <span>{knob.usualValues ?? "There is no widely agreed value for this one."}</span>
        </span>
      ) : null}
    </span>
  );
}
