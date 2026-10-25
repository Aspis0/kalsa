import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { FOLD_MS, reducedMotion } from "./motion";

// Two frames: one for the browser to take the height the row stands as, one
// to move away from it — a transition needs both sides computed apart. Not
// every page this runs on hands out frames, and a plain task does the same
// job where nobody is watching motion.
function frame(step: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(step);
  else setTimeout(step, 0);
}

interface RowFold {
  /** Attach to a row: the fold measures the height it stands as. */
  refFor: (id: number) => (element: HTMLDivElement | null) => void;
  /** Fold the row with this id; `remove` runs once the beat is over. */
  begin: (id: number, remove: () => void) => void;
  /** What a folding row wears — a row standing still wears nothing. */
  styleFor: (id: number) => CSSProperties | undefined;
  /** Whether a fold is under way, so no answer lands in the middle of one. */
  folding: () => boolean;
}

/** One row's farewell: measure, fade, leave — and nothing after the page. */
export function useRowFold(): RowFold {
  const [folded, setFolded] = useState<{ id: number; height: number } | null>(null);
  const active = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows = useRef(new Map<number, HTMLDivElement>());
  const live = useRef(true);

  // A page that goes away mid-fold leaves nothing behind: the timer is
  // cleared, and every callback past the unmount finds `live` false.
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  return {
    refFor: (id) => (element) => {
      if (element) rows.current.set(id, element);
      else rows.current.delete(id);
    },
    begin: (id, remove) => {
      if (!live.current) return;
      if (reducedMotion()) {
        remove();
        return;
      }
      const row = rows.current.get(id);
      const height = typeof row?.offsetHeight === "number" ? row.offsetHeight : 0;
      setFolded({ id, height });
      active.current = id;
      timer.current = setTimeout(() => {
        timer.current = null;
        active.current = null;
        setFolded(null);
        remove();
      }, FOLD_MS);
      frame(() => {
        if (!live.current) return;
        frame(() => {
          if (live.current) setFolded({ id, height: 0 });
        });
      });
    },
    styleFor: (id) => {
      if (folded === null || folded.id !== id) return undefined;
      const transition = `height ${FOLD_MS}ms ease, padding ${FOLD_MS}ms ease, border-width ${FOLD_MS}ms ease, opacity ${FOLD_MS}ms ease`;
      if (folded.height > 0) return { height: `${folded.height}px`, overflow: "hidden", transition };
      return {
        height: 0,
        paddingTop: 0,
        paddingBottom: 0,
        borderTopWidth: 0,
        borderBottomWidth: 0,
        opacity: 0,
        overflow: "hidden",
        transition,
      };
    },
    folding: () => active.current !== null,
  };
}
