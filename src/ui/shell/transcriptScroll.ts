/**
 * Where the transcript sits: the pin state, and nothing else.
 *
 * The owner chose bottom-anchoring (2026-09-21) knowing the three failures it is
 * known for, and asked for it to be made to work rather than merely chosen. All
 * three of those failures are behavioural, so a screenshot cannot prove any of
 * them, and all three are decided here:
 *
 *  1. **whose is the last message** -> while pinned the view always shows the
 *     end, and the view follows an append and a growth; the clearance that keeps
 *     the composer band off the last line belongs to `transcriptLayout.ts`
 *     (`TRANSCRIPT_LAST_ITEM_GAP`, one chosen gap at every band), because it is
 *     a layout fact rather than a scroll one, and this module moves offsets and
 *     nothing else;
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
 *
 * And one more fact that decides the FIRST placement: whether there is anything
 * to be pinned to at all. `messageCount === 0` is not a short conversation — it
 * is the welcome block, ~607 dp of content to read DOWNWARDS in a ~357 dp band.
 * Parking that block at its end on first layout put the reader 250 dp in: the
 * hour greeting sat above the viewport unpainted, the plate showed as a sliver,
 * and the fourth suggestion card was cut to a ghost under the edge fade (device
 * capture `host3-firstopen.png`, measured there). So an empty transcript opens
 * at its START, stays armed while it is shown (the first append follows to the
 * end of the conversation it begins), and no resize of the block moves the
 * reader. All of it decided here; the view only reports the message count.
 */

/**
 * Within this distance of the end the view counts as pinned, in both directions:
 * the same number unpins and re-pins, so there is no hysteresis to reason about.
 */
export const PIN_THRESHOLD_DP = 10;

/**
 * How long after issuing a programmatic scroll the view ignores `user-scroll`
 * events.
 *
 * A programmatic `scrollTo` emits scroll events of its own in React Native, so
 * following the end — or placing the view at the end on first layout — fires
 * events that read as "the reader scrolled away". Obeying them unpins the
 * transcript while it is still moving, and the run can end parked somewhere
 * other than the end, showing the bottom clearance and no content.
 *
 * 400 ms, chosen to outlast the longest scroll animation the design names: the
 * sheet's 300 ms (DESIGN.md §2.11). `transcriptScroll.test.ts` asserts that
 * relation, so shortening a motion value cannot silently turn a programmatic
 * scroll into an opinion of the reader's. The value is a grace, not a pin: the
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
  /**
   * How many messages the transcript currently holds — the one fact first
   * layout needs to tell a conversation (opens at its end) from an empty
   * conversation wearing the welcome block (opens at its first line). The view
   * reports it; the decision stays in this module.
   */
  messageCount: number;
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

  // No messages: there is no end to be pinned to, so every rule below that
  // reads the pin from the distance to the end would be reading the welcome
  // block's bottom as if it were a conversation's. The empty state is decided
  // in this one guard: the block opens at its first line, the pin stays armed
  // (a reader scrolling the block never unpins, so the first append follows to
  // the end of the conversation it starts — never parked at the top of a
  // conversation that has just grown), a growing or resizing block never moves
  // the reader, and there is no end for a jump control to offer.
  if (input.messageCount === 0) {
    switch (input.cause) {
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
      // which is the top, exactly as the desktop app starts. (With no messages
      // the guard above already returned the block's first line.)
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
