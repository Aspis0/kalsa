import { useLayoutEffect, useRef } from "react";
import type { MutableRefObject } from "react";

/**
 * A reply box as tall as its own text. Counting rows is not enough because a
 * long line wraps into several, and a reply that hides its own ending reads as
 * a reply that stops there — so the box is measured, not counted.
 */

/** Fits the box to the text inside it. The height is cleared first, otherwise
    the box can only ever grow and never shrinks when a reply is shortened. */
export function autoSize(el: HTMLTextAreaElement | null): void {
  if (el === null) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

/** The ref to put on the textarea, and the fitting happens here whenever the
    words inside it change. */
export function useAutoSize(value: string): MutableRefObject<HTMLTextAreaElement | null> {
  const box = useRef<HTMLTextAreaElement | null>(null);
  useLayoutEffect(() => {
    autoSize(box.current);
  }, [value]);
  return box;
}