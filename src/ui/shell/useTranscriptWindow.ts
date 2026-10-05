/**
 * The transcript window's lifecycle: which settled rows the list draws, and
 * how the slice moves.
 *
 * A conversation arms the window at its tail; the reader nearing the slice's
 * top prepends one page of history at a time (their place through the prepend
 * is the scroll view's own job); the jump-to-end control trims back to the
 * tail, and so does every settled change while the reader is pinned to the
 * bottom. Re-anchoring on structural changes lives in `transcriptWindow.ts`;
 * this hook only applies it.
 */
import { useCallback, useMemo, useRef, useState } from "react";

import type { TranscriptMessage } from "./transcriptTypes";
import {
  PREPEND_MIN_INTERVAL_MS,
  PREPEND_TRIGGER_DP,
  advanceToTail,
  prependPage,
  reanchor,
  tailWindow,
  type TranscriptWindow,
} from "./transcriptWindow";

export function useTranscriptWindow(
  settled: readonly TranscriptMessage[],
  pinned: { readonly current: boolean },
) {
  const [listWindow, setListWindow] = useState<TranscriptWindow>(() => tailWindow(settled));
  const settledSeenRef = useRef(settled);
  let effective = reanchor(listWindow, settled);
  if (settledSeenRef.current !== settled) {
    settledSeenRef.current = settled;
    // Unpinned, the reader is somewhere in history and the slice must not
    // move under them; pinned, it holds the tail (see `advanceToTail`).
    if (pinned.current) effective = advanceToTail(effective, settled);
  }
  // Render-phase alignment: the current pass already draws the corrected
  // slice; the state update only spares the next pass the same check.
  if (effective !== listWindow) setListWindow(effective);

  const windowRef = useRef(effective);
  const settledRef = useRef(settled);
  windowRef.current = effective;
  settledRef.current = settled;

  const listData = useMemo(() => settled.slice(effective.start), [settled, effective.start]);

  // The reader can fling faster than a page lays out; the interval keeps the
  // list's own prepend tracking able to see one page settle before the next.
  const lastPrependAtRef = useRef(0);
  const prependIfNearTop = useCallback((offsetY: number) => {
    if (windowRef.current.start === 0) return;
    if (offsetY >= PREPEND_TRIGGER_DP) return;
    const at = Date.now();
    if (at - lastPrependAtRef.current < PREPEND_MIN_INTERVAL_MS) return;
    const next = prependPage(windowRef.current, settledRef.current);
    if (next === windowRef.current) return;
    lastPrependAtRef.current = at;
    windowRef.current = next;
    setListWindow(next);
  }, []);

  const trimToTail = useCallback(() => {
    const next = tailWindow(settledRef.current);
    if (next.start !== windowRef.current.start) {
      windowRef.current = next;
      setListWindow(next);
    }
  }, []);

  return { listData, prependIfNearTop, trimToTail, windowStart: effective.start };
}
