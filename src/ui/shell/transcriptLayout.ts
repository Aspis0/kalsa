/**
 * The transcript's arithmetic: the turn rhythm, the capsule's ceiling, the day
 * marker's height rule, and the decision it takes to make a table scroll.
 *
 * Pure, no React, and testable in the `node` jest stack (DESIGN.md, "proof
 * regime": there is no render harness, so every size the layout depends on is
 * written here and `Transcript.tsx` only places the boxes these functions
 * return).
 *
 * It sits ON `shellGeometry.ts` on purpose. The transcript band is a band the
 * shell owns, and the height that decides the day marker is exactly the height
 * the shell computed; re-deriving it here would let the two drift apart while
 * both tests stayed green.
 */
import { measure } from "../../theme/design";
import { shellGeometry, type Insets } from "./shellGeometry";

/** A turn is the user's capsule plus its own answer. Inside it: 6 dp. */
export const USER_TO_ANSWER_GAP = 6;
/** Between two turns: 26 dp. Grouping is by proximity; a separator between
 *  turns is never drawn (DESIGN.md §2.2). */
export const TURN_GAP = 26;
/** Between two paragraphs of one answer. The band is 12–16; 14 is the middle. */
export const PARAGRAPH_GAP = 14;
export const PARAGRAPH_GAP_MIN = 12;
export const PARAGRAPH_GAP_MAX = 16;
/** The user's turn never takes more than this share of the reading column. */
export const CAPSULE_WIDTH_RATIO = 0.78;
/** A floor, not a target: below a tap target the capsule would be unreadable.
 *  On the two real viewports the 78 % ratio is far above this. */
export const CAPSULE_MIN_WIDTH = 48;

/**
 * The day marker's own box: a hairline, 10 dp, a 16 dp label, 10 dp, a hairline
 * — 38 dp, rounded up to leave the label room to breathe.
 */
export const DAY_MARKER_HEIGHT = 42;
/**
 * Below this transcript height the marker is dropped entirely.
 *
 * 320 is a CHOSEN floor, not a derived one, and it is written that way on
 * purpose so a reviewer can move it: all the arithmetic fixes is the band the
 * marker has to sit inside. The marker costs 42 dp, a one-line turn about 104
 * (a capsule, a two-line answer and their 6 dp), the gap above it 26 — so the
 * rule this number encodes is that the marker may not eat more than roughly a
 * seventh of the band (42 x 7.6 = 320), past which it pushes a whole turn out of
 * view to say nothing. The two measured cases sit on opposite sides of it:
 * 349x621 leaves 443 dp and keeps the marker; 349x325 (the keyboard open)
 * leaves 195 and drops it.
 */
export const DAY_MARKER_MIN_TRANSCRIPT_HEIGHT = 320;

/** A cell's own left+right padding, and the narrowest a cell's content may be
 *  before a label and its number start to collide. */
export const TABLE_CELL_PADDING = 10;
export const TABLE_MIN_CELL_CONTENT = 97;
/** 117 dp. Deliberately wider than a cell would have if the phone width were
 *  divided by three (349/3 = 116): a three-column table therefore ALWAYS
 *  scrolls on both measured viewports, which is the point — silently cutting a
 *  column is the failure §2.2 forbids. */
export const TABLE_MIN_COLUMN_WIDTH = TABLE_MIN_CELL_CONTENT + 2 * TABLE_CELL_PADDING;

/** The role of one rendered item, in order. `assistant` is an answer. */
export type TranscriptRole = "user" | "assistant";

export type TranscriptLayout = {
  width: number;
  height: number;
  /** The reading column: the band minus its two gutters. */
  contentWidth: number;
  /** The transcript band's height, as `shellGeometry` computed it. */
  availableHeight: number;
  capsuleMaxWidth: number;
  /** The answer's own width. The capsule never narrows it: the two never share
   *  a line. It is capped by `measure.readingMaxWidth` on a wide screen only. */
  readingMeasure: number;
  showDayMarker: boolean;
  rhythm: {
    userToAnswer: number;
    betweenTurns: number;
    paragraph: number;
  };
};

/** Local calendar day, not a UTC one: a marker is about the reader's day. */
export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * The marker is dropped when the band is short. `availableHeight` is the
 * transcript band, the same number `transcriptLayout` reports.
 */
export function showsDayMarker(availableHeight: number): boolean {
  return availableHeight >= DAY_MARKER_MIN_TRANSCRIPT_HEIGHT;
}

/**
 * True when this message opens a new day AND the band can afford the marker.
 * `null` previous means the transcript's first message, which needs none: the
 * reader already knows it is today or the top of what they opened.
 */
export function shouldShowDayMarker(
  previousCreatedAt: number | null,
  createdAt: number,
  availableHeight: number,
): boolean {
  if (previousCreatedAt === null) return false;
  if (isSameDay(previousCreatedAt, createdAt)) return false;
  return showsDayMarker(availableHeight);
}

/**
 * The gap above an item, from the item before it. A user turn and its own
 * answer are one turn and sit 6 dp apart; everything else is 26 dp. The first
 * item has no gap above it.
 */
export function rhythmGap(previous: TranscriptRole | null, current: TranscriptRole): number {
  if (previous === null) return 0;
  return previous === "user" && current === "assistant" ? USER_TO_ANSWER_GAP : TURN_GAP;
}

/** Blank-line separated paragraphs; a single newline stays inside one. */
export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The turn rhythm is a decision, not styling: `Transcript.tsx` asks this, and
 * so does the test.
 */
export function transcriptLayout(width: number, height: number, insets: Insets): TranscriptLayout {
  const contentWidth = Math.max(0, width - 2 * measure.gutterCompact);
  const availableHeight = shellGeometry(width, height, insets).transcriptUsableHeight;
  // The floor is applied first and the content width last: on a degenerate
  // width the capsule yields to the column rather than overflowing it.
  const capsuleMaxWidth = Math.min(
    contentWidth,
    Math.max(CAPSULE_MIN_WIDTH, Math.floor(contentWidth * CAPSULE_WIDTH_RATIO)),
  );

  return {
    width,
    height,
    contentWidth,
    availableHeight,
    capsuleMaxWidth,
    readingMeasure: Math.min(contentWidth, measure.readingMaxWidth),
    showDayMarker: showsDayMarker(availableHeight),
    rhythm: {
      userToAnswer: USER_TO_ANSWER_GAP,
      betweenTurns: TURN_GAP,
      paragraph: PARAGRAPH_GAP,
    },
  };
}

export type TableScrollDecision = {
  columns: number;
  availableWidth: number;
  /** What the table needs at the minimum readable column width. */
  requiredWidth: number;
  /** True when the table must scroll horizontally instead of being cut. */
  scrolls: boolean;
};

/**
 * Step 3b consumes this; step 3 does not render a table. The decision is a pure
 * function of the column count and the width the table was given, so the
 * "three columns at 349 dp scroll" claim is a property of a function rather
 * than of a stylesheet someone has to read.
 */
export function tableScrollDecision(columns: number, availableWidth: number): TableScrollDecision {
  const count = Number.isFinite(columns) ? Math.max(0, Math.floor(columns)) : 0;
  const width = Number.isFinite(availableWidth) ? Math.max(0, availableWidth) : 0;
  const requiredWidth = count * TABLE_MIN_COLUMN_WIDTH;
  return {
    columns: count,
    availableWidth: width,
    requiredWidth,
    // A table with no columns has nothing to cut, so it never claims to scroll.
    scrolls: count > 0 && width < requiredWidth,
  };
}
