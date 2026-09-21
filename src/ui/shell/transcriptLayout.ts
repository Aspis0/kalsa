/**
 * The transcript's arithmetic: the turn rhythm, the capsule's ceiling, the day
 * marker's height rule, the clearance under the last item, and the decision it
 * takes to make a table scroll.
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
import { CLOUD_COLLAPSED_HEIGHT_DP } from "../thinking/thoughtMotion";
import { shellGeometry, type Insets } from "./shellGeometry";

/** A turn is the user's capsule plus its own answer. Inside it: 6 dp. */
export const USER_TO_ANSWER_GAP = 6;
/**
 * The same gap when the answer opens with the cloud, and it is a CHOSEN 12, not
 * a derived number: the layout's arithmetic produces only the bare answer's 6.
 * The cloud is a filled white blob with two puffs on its top edge, so at 6 dp it
 * reads as a bubble hanging off the green capsule; 12 separates the two shapes
 * without inventing a new rhythm step. Written here so a reviewer can move it.
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

/**
 * The FULL clearance under the transcript's last item. The transcript scrolls
 * under the composer band, so without it the newest element is pinned to the
 * band's bottom edge; when that element is the cloud, the disclosure has nowhere
 * to open into — measured on the Jelly, the body dumped to 0 dp (y716-714) and
 * "Show thinking" had nothing to reveal.
 *
 * The floor is the cloud's own collapsed height (`CLOUD_COLLAPSED_HEIGHT_DP`,
 * shared with the component that draws it): a clearance smaller than the tallest
 * thing that can be last does not clear it. `Math.ceil` keeps it a whole dp and
 * keeps the two from drifting.
 *
 * It is not reserved at every size — that is what emptied the 195 dp keyboard
 * band, because 96 of 195 dp is half the band. `transcriptBottomPadding` yields
 * this clearance back to a short band; this constant stays the full amount.
 */
export const TRANSCRIPT_BOTTOM_PADDING = Math.ceil(CLOUD_COLLAPSED_HEIGHT_DP);

/**
 * The air that must be left under the last item once the clearance is taken.
 *
 * 24 is a CHOSEN estimate, not a derived number, and it is labelled the way
 * `DAY_MARKER_MIN_TRANSCRIPT_HEIGHT` is so a reviewer can move it: the
 * arithmetic fixes only the cap the clearance may take, never how much air the
 * item the reader is reading should keep. 24 dp is about one and a half answer
 * lines at the reading size — enough that the clearance reads as a clearance
 * rather than as the last line sitting on the band's edge.
 */
export const TRANSCRIPT_MIN_BOTTOM_AIR = 24;

/**
 * The clearance for a band of this height. The full clearance clears the cloud,
 * but reserving it on a band that cannot afford it is the other half of the
 * failure: on the 195 dp keyboard band it pushed the last item up and left the
 * band showing padding and no content, which is what the 325 capture shows.
 *
 * So the clearance yields to the band. It stays `TRANSCRIPT_BOTTOM_PADDING`
 * while the tallest thing that can be last — the collapsed cloud — plus
 * `TRANSCRIPT_MIN_BOTTOM_AIR` still fits, and shrinks to whatever is left when
 * it does not. A degenerate band clamps to 0 rather than handing the layout a
 * negative padding, so the function stays usable at any height.
 */
export function transcriptBottomPadding(availableHeight: number): number {
  const band = Number.isFinite(availableHeight) ? Math.max(0, availableHeight) : 0;
  const room = band - TRANSCRIPT_BOTTOM_PADDING - TRANSCRIPT_MIN_BOTTOM_AIR;
  return Math.max(0, Math.min(TRANSCRIPT_BOTTOM_PADDING, Math.floor(room)));
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
  /** The clearance under the last item, so it can sit clear of the composer.
   *  Yields to a short band instead of eating it; see `transcriptBottomPadding`. */
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
 * answer are one turn and sit close together; everything else is 26 dp. The
 * first item has no gap above it. `opensWithCloud` is the caller saying the
 * answer starts with the thinking cloud, which takes the larger chosen gap.
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
