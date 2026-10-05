/**
 * How much of a long conversation the list holds, and when it hands over more.
 *
 * The list no longer mounts every message, so the slice it draws needs its own
 * small arithmetic: a conversation arms the window at a tail of settled rows;
 * the reader nearing the top of that window prepends one page of history at a
 * time. Keeping the reader's place through a prepend is the scroll view's own
 * job (`maintainVisibleContentPosition`), not this module's — this decides
 * only which rows are drawn.
 *
 * The window is anchored to the id of the row it starts on. A conversation
 * replaced wholesale (a history load, a wipe to the welcome block) fails the
 * anchor check and re-arms at the new tail, so a stale offset can never slice
 * a different conversation into invisibility.
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
  /** The id of `settled[start]` as the window was armed; the anchor the
   *  armed window is checked against. */
  anchorId: string | null;
};

type Identifiable = { readonly id: string };

/** The tail window: the conversation's last TAIL rows, or all of it. */
export function tailWindow(settled: readonly Identifiable[]): TranscriptWindow {
  const start = Math.max(0, settled.length - TRANSCRIPT_WINDOW_TAIL);
  return { anchorId: settled[start]?.id ?? null, start };
}

/** False when the list's row at `start` is no longer the anchored one — a
 *  different conversation under a stale window. */
export function windowIsAnchored(
  window: TranscriptWindow,
  settled: readonly Identifiable[],
): boolean {
  return (settled[window.start]?.id ?? null) === window.anchorId;
}

/** One page further back, or the same window once the conversation's first
 *  row is in view. */
export function prependPage(
  window: TranscriptWindow,
  settled: readonly Identifiable[],
): TranscriptWindow {
  if (window.start === 0) return window;
  const start = Math.max(0, window.start - TRANSCRIPT_WINDOW_PAGE);
  return { anchorId: settled[start]?.id ?? null, start };
}
