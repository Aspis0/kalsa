/**
 * Where the transcript sits: the pin state, and nothing else.
 *
 * Bottom-anchoring is known for three failures; all three are decided here,
 * because all three are behavioural and a screenshot cannot prove any:
 *
 *  1. whose is the last message -> while pinned the view shows the end and
 *     follows an append and a growth; the clearance under the last line belongs
 *     to `transcriptLayout.ts` (a layout fact, not a scroll one) and this
 *     module moves offsets and nothing else;
 *  2. the answer writing above itself then below -> starts as a rendering rule:
 *     `duplicateMessageIds` is the checkable half, a list holding the same
 *     answer twice is how it begins;
 *  3. the view fighting the reader -> one number decides the pin in every
 *     cause, so an upward move past the threshold unpins and nothing moves
 *     while unpinned.
 *
 * The desktop rule and this module are one function: the transcript grows from
 * the top while it fits and sticks to the bottom once it overflows — a short
 * conversation's end offset is zero, the top. An empty transcript is the
 * welcome block, not a short conversation: it opens at its START, stays armed
 * while shown (the first append follows to the end it begins), and no resize
 * moves the reader. And "first layout" is a property of the CONVERSATION, not
 * the event: React Native's `onLayout` fires for every re-layout, so the view
 * reports `placedBefore` beside the cause and THIS module tells the two apart
 * (see the field's own comment).
 */

/**
 * Within this distance of the end the view counts as pinned, in both directions:
 * the same number unpins and re-pins, so there is no hysteresis to reason about.
 */
export const PIN_THRESHOLD_DP = 10;

/**
 * How long after a programmatic scroll the view ignores `user-scroll` events.
 *
 * React Native's `scrollTo` emits scroll events of its own; obeying them
 * unpins the transcript while it is still moving and the run can end parked
 * away from the end. 400 ms outlasts the design's longest scroll animation
 * (the sheet's 300 ms, DESIGN.md §2.11 — `transcriptScroll.test.ts` asserts
 * the relation, so shortening a motion value cannot silently turn a
 * programmatic scroll into the reader's opinion). A grace, not a pin: the
 * events inside the window are ignored, not obeyed and not re-pinned.
 */
export const PROGRAMMATIC_SCROLL_GRACE_MS = 400;

export type ScrollCause =
  /** A message was added. */
  | "append"
  /** The content changed size with no new message: streaming, a disclosure opening. */
  | "growth"
  /** The reader moved the view. */
  | "user-scroll"
  /** The reader asked to return to the end. */
  | "jump-to-end"
  /** Nothing has been placed yet. Which of the two it IS — that first time, or
   *  a later layout of the same conversation — is not in the event; the view
   *  reports it as `placedBefore`, and the machine decides, below. */
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
  /** Messages held — the one fact that tells a conversation (opens at its end)
   *  from an empty one wearing the welcome block (opens at its first line). */
  messageCount: number;
  /**
   * Whether the band has already placed the view ONCE — the first-layout-done
   * fact `onLayout` cannot carry, because a keyboard re-layout is the same
   * event. Reported by the view, decided on here: `first-layout` with `false`
   * is a genuine first placement; with `true` it is a re-layout and folds into
   * `resize`. A fact, not a rule, so the rule cannot fork per call site.
   */
  placedBefore: boolean;
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

  // Settled once at the top so no branch below has to know: `first-layout` is
  // a first placement only until the band has laid out once; from there it is
  // a resize under a placed view, whose halves are already written.
  const cause: ScrollCause =
    input.cause === "first-layout" && input.placedBefore ? "resize" : input.cause;

  // No messages: no end to pin to, so every rule below reading the pin from
  // the distance to the end would read the welcome block's bottom as a
  // conversation's. The whole empty state is this one guard: the block opens
  // at its first line, stays armed (the first append follows to the end it
  // begins), never moves the reader on growth or resize, and offers no jump.
  if (input.messageCount === 0) {
    switch (cause) {
      case "first-layout":
      case "jump-to-end":
      // The conversation was wiped back to empty: the block again, from its top.
      case "append":
        return { pinned: true, scrollTo: 0 };
      case "user-scroll":
      case "growth":
      case "resize":
        return { pinned: true, scrollTo: null };
    }
  }

  switch (cause) {
    case "user-scroll": {
      // The reader's own position is the only honest source for the pin, and
      // never move the view for them.
      const pinned = distanceFromEnd(input) <= PIN_THRESHOLD_DP;
      return { pinned, scrollTo: null };
    }
    case "first-layout":
      // Nothing placed yet, so the offset means nothing — not even a stale 338
      // the view may report. A conversation opens at its end (a short one's end
      // is the top, as the desktop app starts); the empty guard above already
      // returned for the block, and a LATER layout never reaches this arm.
      return { pinned: true, scrollTo: end };
    case "jump-to-end":
      return { pinned: true, scrollTo: end };
    case "append":
    case "growth":
    case "resize":
      // Only while pinned. The append case is what makes this design work and
      // the easiest to get wrong: the OLD offset now measures far from the new
      // end, so deriving the pin from it here would decide "unpinned" and stop
      // following the newest message. Resize joins it so the keyboard cannot
      // throw a reader who scrolled away back to the bottom.
      return { pinned: input.pinned, scrollTo: input.pinned ? end : null };
  }
}

/**
 * The rendering half of "one entry per message": a list holding the same
 * message twice is how an answer ends up written above itself and then below.
 * Returns each repeated id once, in order of first repetition.
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
