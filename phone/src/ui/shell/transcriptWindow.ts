/**
 * How much of a long conversation the list holds, and when it hands over more.
 *
 * The list no longer mounts every message, so the slice it draws needs its own
 * small arithmetic: a conversation arms the window at a tail of settled rows;
 * the reader nearing the top of that window prepends one page of history at a
 * time; a turn landing while the reader is PINNED to the bottom re-arms at the
 * tail so chatting never grows the mounted set. Keeping the reader's place
 * through a prepend is the scroll view's own job
 * (`maintainVisibleContentPosition`), not this module's — this decides only
 * which rows are drawn.
 *
 * The window is anchored to the ids of the row it starts on and of the
 * conversation's first row: deletions are followed instead of falling back to
 * the tail (which would yank a reader in old history to the end), and only a
 * conversation whose first row changed — a wholesale replace — re-arms at the
 * new tail, so a stale offset can never slice a different conversation into
 * invisibility.
 */

/**
 * The settled rows the list holds when a conversation opens: the whole
 * conversation for a short one, the last TAIL for a long one. Also the list's
 * `initialNumToRender`, so the tail mounts in one pass and the first
 * scroll-to-end lands on real measured heights — the property the full-mount
 * ScrollView had for free.
 */
export const TRANSCRIPT_WINDOW_TAIL = 30;

/** Settled rows added above the window per page, when the reader scrolls near
 *  its top. */
export const TRANSCRIPT_WINDOW_PAGE = 20;

/** The list's `maxToRenderPerBatch`: the rows one background batch may mount
 *  while a page fills in. Kept under the page size so a prepend never mounts
 *  a whole page in one frame. */
export const TRANSCRIPT_WINDOW_BATCH = 10;

/** Viewport-heights the list keeps mounted around the viewport while the
 *  reader pages through history. The tail already covers the streaming end;
 *  this window only serves the scroll upwards. */
export const TRANSCRIPT_WINDOW_SIZE = 7;

/** Distance from the window's top, in dp, that asks for the next page: more
 *  than a viewport, so the page lands before the reader reaches drawn-out
 *  content. */
export const PREPEND_TRIGGER_DP = 800;

/** Minimum ms between prepends: a fling can outrun a page's layout, and the
 *  list's own prepend tracking wants to see one page settle before the next. */
export const PREPEND_MIN_INTERVAL_MS = 150;

export type TranscriptWindow = {
  /** Index into the settled messages where the drawn slice starts. */
  start: number;
  /** The id of `settled[start]` as the window was armed; the anchor a
   *  deletion is followed by. */
  anchorId: string | null;
  /** The id of `settled[0]` as the window was armed: the one row whose
   *  replacement means this is a different conversation, not an edit. */
  firstId: string | null;
};

type Identifiable = { readonly id: string };

/** The tail window: the conversation's last TAIL rows, or all of it. */
export function tailWindow(settled: readonly Identifiable[]): TranscriptWindow {
  const start = Math.max(0, settled.length - TRANSCRIPT_WINDOW_TAIL);
  return { anchorId: settled[start]?.id ?? null, firstId: settled[0]?.id ?? null, start };
}

/**
 * The window to use against `settled` now. Unchanged while its anchor still
 * sits at its start; FOLLOWING the anchor when rows above it were deleted
 * (everything shifts up, the reader's rows stay); clamped to the nearest
 * surviving row when the anchor itself was deleted — a reader in old history
 * keeps their place, not a trip to the tail; back to the tail when the
 * conversation's first row changed, the one sign of a wholesale replace.
 */
export function reanchor(
  window: TranscriptWindow,
  settled: readonly Identifiable[],
): TranscriptWindow {
  if (window.anchorId !== null && settled[window.start]?.id === window.anchorId) return window;
  // Armed on the empty transcript: while it IS still empty the window is
  // already right, and a fresh object here would be a new object EVERY render
  // — the render-phase re-arm in `useTranscriptWindow` would then loop the
  // band (a null anchor and an empty conversation are the same state, so the
  // window is returned by identity, not rebuilt).
  if (window.anchorId === null) return settled.length === 0 ? window : tailWindow(settled);
  const followed = settled.findIndex((row) => row.id === window.anchorId);
  if (followed >= 0) return { anchorId: window.anchorId, firstId: window.firstId, start: followed };
  if (settled[0]?.id !== window.firstId) return tailWindow(settled);
  const start = Math.min(window.start, Math.max(0, settled.length - 1));
  return { anchorId: settled[start]?.id ?? null, firstId: window.firstId, start };
}

/**
 * On a settled change while the reader is PINNED to the bottom: hold the
 * slice at tail size, so chatting never grows the mounted set. Only a reader
 * who pages up widens the slice (and one reading away while turns land keeps
 * theirs — the slice may grow downward until they jump back, which trims).
 */
export function advanceToTail(
  window: TranscriptWindow,
  settled: readonly Identifiable[],
): TranscriptWindow {
  const tail = tailWindow(settled);
  return tail.start > window.start ? tail : window;
}

/** One page further back, or the same window once the conversation's first
 *  row is in view. */
export function prependPage(
  window: TranscriptWindow,
  settled: readonly Identifiable[],
): TranscriptWindow {
  if (window.start === 0) return window;
  const start = Math.max(0, window.start - TRANSCRIPT_WINDOW_PAGE);
  return { anchorId: settled[start]?.id ?? null, firstId: window.firstId, start };
}
