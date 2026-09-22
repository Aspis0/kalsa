/**
 * The transcript's arithmetic: the turn rhythm, the capsule's ceiling, the day
 * marker's height rule, the clearance under the last item, and the decision it
 * takes to make a table scroll.
 *
 * Pure, no React, testable in the node jest stack (DESIGN.md, "proof regime").
 * It sits ON `shellGeometry.ts` on purpose: the band is the shell's, and the
 * height that decides the day marker is exactly the height the shell computed —
 * re-deriving it here would let the two drift while both tests stayed green.
 */
import { measure } from "../../theme/design";
import { shellGeometry, type Insets } from "./shellGeometry";

/** A turn is the user's capsule plus its own answer. Inside it: 6 dp. */
export const USER_TO_ANSWER_GAP = 6;
/**
 * The same gap when the answer opens with the cloud: a CHOSEN 12 — the
 * arithmetic only produces the bare answer's 6, and at 6 the white blob reads
 * as a bubble hanging off the green capsule.
 */
export const USER_TO_CLOUD_GAP = 12;
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
 * Below this transcript height the marker is dropped entirely. 320 is a
 * CHOSEN floor (labelled so a reviewer can move it): it encodes that the marker
 * may not eat more than roughly a seventh of the band — 42 marker x 7.6 = 320.
 * The measured cases straddle it: 443 dp keeps the marker, 195 (keyboard) drops it.
 */
export const DAY_MARKER_MIN_TRANSCRIPT_HEIGHT = 320;

/**
 * The gap under the transcript's last item, in dp: the transcript scrolls under
 * the composer band, so without it the newest element sits on that band's edge.
 * 24 is CHOSEN, not derived — it replaced `Math.ceil(CLOUD_COLLAPSED_HEIGHT_DP)`,
 * which sized the gap from the cloud's collapsed height: wrong, because the cloud
 * need not FIT in the gap, only be visible and scrollable, and one element's
 * height charged every band (the 171 dp keyboard band spent 30 % of itself on
 * it). It is NOT a function of the cloud: `thoughtMotion` no longer feeds the
 * transcript, and a test holds that.
 */
export const TRANSCRIPT_LAST_ITEM_GAP = 24;

/**
 * The clearance for a band of this height: ONE gap, the same 24 dp at every band
 * that can hold it (the keyboard-short one included), never a share of the band.
 * Capped by the band and floored at 0, so a degenerate band yields a smaller
 * gap instead of a negative padding.
 */
export function transcriptBottomPadding(availableHeight: number): number {
  const band = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  return Math.max(0, Math.min(TRANSCRIPT_LAST_ITEM_GAP, Math.floor(band)));
}

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
  /** The clearance under the last item: one chosen gap, the same at every band
   *  that can hold it; see `transcriptBottomPadding`. */
  bottomPadding: number;
  rhythm: {
    userToAnswer: number;
    /** When the answer opens with the cloud, the chosen, larger gap. */
    userToCloud: number;
    betweenTurns: number;
    paragraph: number;
  };
};

/** Local calendar day, not a UTC one: a marker is about the reader's day. */
export function isSameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

/**
 * The marker is dropped when the band is short.
 */
export function showsDayMarker(availableHeight: number): boolean {
  return availableHeight >= DAY_MARKER_MIN_TRANSCRIPT_HEIGHT;
}

/**
 * True when this message opens a new day AND the band can afford the marker.
 * `null` previous means the transcript's first message, which needs none.
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
 * The gap above an item: a user turn and its own answer sit close together,
 * everything else is TURN_GAP; the first item has none. `opensWithCloud` is the
 * caller saying the answer starts with the thinking cloud (the larger gap).
 */
export function rhythmGap(
  previous: TranscriptRole | null,
  current: TranscriptRole,
  opensWithCloud = false,
): number {
  if (previous === null) return 0;
  if (previous === "user" && current === "assistant") {
    return opensWithCloud ? USER_TO_CLOUD_GAP : USER_TO_ANSWER_GAP;
  }
  return TURN_GAP;
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
    bottomPadding: transcriptBottomPadding(availableHeight),
    rhythm: {
      userToAnswer: USER_TO_ANSWER_GAP,
      userToCloud: USER_TO_CLOUD_GAP,
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
 * A pure function of column count and given width, so "three columns at 349 dp
 * scroll" is a property of a function rather than of a stylesheet to read.
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
