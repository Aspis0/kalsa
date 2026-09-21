/**
 * Where the transcript sits: the pin state, and nothing else.
 *
 * The owner chose bottom-anchoring (2026-09-21) knowing the three failures it is
 * known for, and asked for it to be made to work rather than merely chosen. All
 * three of those failures are behavioural, so a screenshot cannot prove any of
 * them, and all three are decided here:
 *
 *  1. **whose is the last message** -> while pinned the view always shows the
 *     end, and `BOTTOM_KEEP_CLEAR_DP` of padding keeps the composer band off the
 *     last line; the view follows an append and a growth, but only while pinned;
 *  2. **the answer writing above itself and then below** -> that failure starts
 *     as a rendering rule, not a scroll rule, and `duplicateMessageIds` is the
 *     checkable half of it: a list holding the same answer twice is how it begins;
 *  3. **the view fighting the reader** -> one number decides the pin in every
 *     cause, so an upward move past the threshold unpins and nothing moves while
 *     unpinned.
 *
 * And the rule that keeps this coherent with the desktop app: the transcript
 * grows from the top while it fits and sticks to the bottom once it overflows. A
 * short conversation has an end offset of zero, which is the top — so both
 * statements are the same function rather than two behaviours to choose between.
 */
import { type } from "../../theme/design";

/**
 * Within this distance of the end the view counts as pinned, in both directions:
 * the same number unpins and re-pins, so there is no hysteresis to reason about.
 */
export const PIN_THRESHOLD_DP = 10;

/**
 * The scroll content's bottom padding: one line of the reading face so the
 * composer band can never sit on the last line's descenders, plus a little air.
 * Derived from the type scale rather than written down, so it follows the reading
 * face if that changes.
 */
export const BOTTOM_KEEP_CLEAR_DP = Math.ceil(type.body.lineHeight) + 6;

export type ScrollCause =
  /** A message was added. */
  | "append"
  /** The content changed size with no new message: streaming, a disclosure opening. */
  | "growth"
  /** The reader moved the view. */
  | "user-scroll"
  /** The reader asked to return to the end. */
  | "jump-to-end"
  /** Nothing has been placed yet: the band knows its size for the first time. */
  | "first-layout"
  /** The band changed size under a placed view: the keyboard opening or closing. */
  | "resize";

export type ScrollInput = {
  cause: ScrollCause;
  contentHeight: number;
  viewportHeight: number;
  offsetY: number;
  /** Whether the view was pinned **before** this event. */
  pinned: boolean;
};

export type ScrollDecision = {
  pinned: boolean;
  /** The offset to set, or null to leave the view exactly where the reader left it. */
  scrollTo: number | null;
};

/** The offset that shows the end. Zero when everything already fits, which is the
 *  top: a short conversation begins at the top, exactly as the desktop app does. */
export function endOffset(contentHeight: number, viewportHeight: number): number {
  return Math.max(0, Math.max(0, contentHeight) - Math.max(0, viewportHeight));
}

function distanceFromEnd(input: ScrollInput): number {
  return endOffset(input.contentHeight, input.viewportHeight) - Math.max(0, input.offsetY);
}

export function transcriptScroll(input: ScrollInput): ScrollDecision {
  const end = endOffset(input.contentHeight, input.viewportHeight);

  switch (input.cause) {
    case "user-scroll": {
      // The reader's own position is the only thing the pin can honestly be read
      // from, and never move the view for them.
      const pinned = distanceFromEnd(input) <= PIN_THRESHOLD_DP;
      return { pinned, scrollTo: null };
    }
    case "first-layout":
      // Nothing has been placed yet, so the offset at this moment means nothing.
      // A conversation opens at its end — and a short one has an end of zero,
      // which is the top, exactly as the desktop app starts.
      return { pinned: true, scrollTo: end };
    case "jump-to-end":
      return { pinned: true, scrollTo: end };
    case "append":
    case "growth":
    case "resize":
      // Only while pinned. The append case is the one that makes this design work
      // and the easiest to get wrong: it leaves the OLD offset behind, which now
      // measures far from the new end, so deriving the pin from the offset here
      // would decide "unpinned" and never follow the newest message again. The
      // resize case belongs with it for the same reason: the keyboard opening
      // must not throw a reader who had scrolled away back to the bottom.
      return { pinned: input.pinned, scrollTo: input.pinned ? end : null };
  }
}

/**
 * The rendering half of "one entry per message". A list that holds the same message
 * twice is how an answer ends up written above itself and then below: the
 * placeholder and the real answer become two entries. Returns the ids that appear
 * more than once, each reported once, in the order it is first repeated.
 */
export function duplicateMessageIds(messages: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const message of messages) {
    if (seen.has(message.id) && !duplicates.includes(message.id)) duplicates.push(message.id);
    seen.add(message.id);
  }
  return duplicates;
}
