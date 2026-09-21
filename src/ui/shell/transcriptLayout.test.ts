/**
 * The transcript's arithmetic, at the sizes that decide it: the Jelly Star's
 * two cases (621 dp, and 325 with the keyboard open) and the S23's 780.
 *
 * This is the real proof of step 3 (DESIGN.md, "proof regime"): the pixels go
 * to screenshots, and everything that must be true regardless of pixels is
 * asserted here.
 */
import {
  CAPSULE_MIN_WIDTH,
  CAPSULE_WIDTH_RATIO,
  DAY_MARKER_HEIGHT,
  DAY_MARKER_MIN_TRANSCRIPT_HEIGHT,
  PARAGRAPH_GAP,
  PARAGRAPH_GAP_MAX,
  PARAGRAPH_GAP_MIN,
  TABLE_MIN_COLUMN_WIDTH,
  TRANSCRIPT_BOTTOM_PADDING,
  TRANSCRIPT_MIN_BOTTOM_AIR,
  TURN_GAP,
  USER_TO_ANSWER_GAP,
  USER_TO_CLOUD_GAP,
  isSameDay,
  rhythmGap,
  shouldShowDayMarker,
  showsDayMarker,
  splitParagraphs,
  tableScrollDecision,
  transcriptBottomPadding,
  transcriptLayout,
  type TranscriptLayout,
} from "./transcriptLayout";
import { CLOUD_COLLAPSED_HEIGHT_DP } from "../thinking/thoughtMotion";
import { shellGeometry, type Insets } from "./shellGeometry";

type Case = { name: string; width: number; height: number; insets: Insets };

const JELLY: Case = {
  name: "Jelly Star 349x621",
  width: 349,
  height: 621,
  insets: { top: 24, bottom: 16 },
};
const S23: Case = {
  name: "Galaxy S23 360x780",
  width: 360,
  height: 780,
  insets: { top: 28, bottom: 24 },
};
/** The keyboard-open app area: the case the shell already collapses the strip for. */
const JELLY_KEYBOARD: Case = { name: "Jelly keyboard 349x325", width: 349, height: 325, insets: { top: 0, bottom: 0 } };

const CASES: Case[] = [JELLY, S23, JELLY_KEYBOARD];

const layoutFor = (c: Case): TranscriptLayout => transcriptLayout(c.width, c.height, c.insets);

describe("the turn rhythm", () => {
  it("is the rhythm the design writes down", () => {
    expect(USER_TO_ANSWER_GAP).toBe(6);
    expect(USER_TO_CLOUD_GAP).toBe(12);
    expect(TURN_GAP).toBe(26);
    expect(PARAGRAPH_GAP).toBeGreaterThanOrEqual(PARAGRAPH_GAP_MIN);
    expect(PARAGRAPH_GAP).toBeLessThanOrEqual(PARAGRAPH_GAP_MAX);
  });

  it("groups a user's turn with its own answer and separates turns", () => {
    expect(rhythmGap(null, "user")).toBe(0);
    expect(rhythmGap(null, "assistant")).toBe(0);
    expect(rhythmGap("user", "assistant")).toBe(USER_TO_ANSWER_GAP);
    expect(rhythmGap("assistant", "user")).toBe(TURN_GAP);
    // Two user turns in a row (a message with no answer yet) are still turns.
    expect(rhythmGap("user", "user")).toBe(TURN_GAP);
    expect(rhythmGap("assistant", "assistant")).toBe(TURN_GAP);
  });

  it("gives a cloud-opening answer the larger chosen gap, and only there", () => {
    // The three shapes, side by side: bare answer 6, cloud answer 12, turns 26.
    expect(rhythmGap("user", "assistant", false)).toBe(6);
    expect(rhythmGap("user", "assistant", true)).toBe(12);
    expect(rhythmGap("assistant", "user", true)).toBe(26);
    // The flag only ever moves the user -> its own answer edge, and the first
    // item still has nothing above it.
    expect(rhythmGap(null, "assistant", true)).toBe(0);
    expect(rhythmGap("user", "user", true)).toBe(TURN_GAP);
    expect(rhythmGap("assistant", "assistant", true)).toBe(TURN_GAP);
  });

  it("carries the same rhythm into the layout object", () => {
    const layout = layoutFor(JELLY);
    expect(layout.rhythm.userToAnswer).toBe(6);
    expect(layout.rhythm.userToCloud).toBe(12);
    expect(layout.rhythm.betweenTurns).toBe(26);
    expect(layout.rhythm.paragraph).toBe(PARAGRAPH_GAP);
  });
});

describe("the clearance under the last item", () => {
  it("is at least the cloud's collapsed height, so the cloud can be last", () => {
    expect(TRANSCRIPT_BOTTOM_PADDING).toBeGreaterThanOrEqual(CLOUD_COLLAPSED_HEIGHT_DP);
    expect(Number.isInteger(TRANSCRIPT_BOTTOM_PADDING)).toBe(true);
    // The two bands with room keep the full clearance: 443 dp and 590 dp are
    // far above the cloud plus the chosen air. The 195 dp band no longer does —
    // that is the change DEFECT 2 made, asserted in the next test.
    expect(layoutFor(JELLY).bottomPadding).toBe(TRANSCRIPT_BOTTOM_PADDING);
    expect(layoutFor(S23).bottomPadding).toBe(TRANSCRIPT_BOTTOM_PADDING);
  });

  it("does not eat the 195 dp short band, so the first turn stays above the fold", () => {
    const short = layoutFor(JELLY_KEYBOARD).availableHeight; // 195
    expect(short).toBe(195);
    expect(TRANSCRIPT_BOTTOM_PADDING).toBeLessThan(short);
    // Once the clearance is reserved there is still room for the very cloud the
    // clearance exists for: the padding is a clearance, not the whole band.
    expect(short - TRANSCRIPT_BOTTOM_PADDING).toBeGreaterThanOrEqual(CLOUD_COLLAPSED_HEIGHT_DP);
  });

  it("yields to the 195 dp band instead of pushing the last item out of it", () => {
    const short = layoutFor(JELLY_KEYBOARD);
    const clearance = short.bottomPadding;
    expect(clearance).toBeLessThan(TRANSCRIPT_BOTTOM_PADDING);
    // The stated constraint in full: the clearance plus the tallest thing that
    // can be last plus the chosen air all fit inside the band.
    expect(clearance + CLOUD_COLLAPSED_HEIGHT_DP + TRANSCRIPT_MIN_BOTTOM_AIR).toBeLessThanOrEqual(
      short.availableHeight,
    );
  });

  it("clamps at 0 on a degenerate band and stays usable there", () => {
    expect(transcriptBottomPadding(0)).toBe(0);
    expect(transcriptBottomPadding(-40)).toBe(0);
    expect(transcriptBottomPadding(Number.NaN)).toBe(0);
    // Exactly the band the constraint leaves no room in.
    expect(transcriptBottomPadding(TRANSCRIPT_BOTTOM_PADDING + TRANSCRIPT_MIN_BOTTOM_AIR)).toBe(0);
    // One dp above it the clearance is one dp, never a negative padding.
    expect(transcriptBottomPadding(TRANSCRIPT_BOTTOM_PADDING + TRANSCRIPT_MIN_BOTTOM_AIR + 1)).toBe(1);
  });
});

describe.each(CASES)("$name", (c) => {
  const layout = layoutFor(c);

  it("leaves the answer the band's reading column, not the capsule's width", () => {
    const expectedContent = c.width - 2 * 14; // measure.gutterCompact
    expect(layout.contentWidth).toBe(expectedContent);
    // The two never share a line, so the capsule never narrows the answer.
    expect(layout.readingMeasure).toBe(expectedContent);
  });

  it("keeps the capsule at least 48 dp and never above 78 % of the column", () => {
    expect(layout.capsuleMaxWidth).toBeGreaterThanOrEqual(CAPSULE_MIN_WIDTH);
    expect(layout.capsuleMaxWidth).toBeLessThanOrEqual(
      Math.floor(layout.contentWidth * CAPSULE_WIDTH_RATIO),
    );
    // Both real widths are far above the floor, so the ratio is what pins them.
    expect(layout.capsuleMaxWidth).toBe(Math.floor(layout.contentWidth * 0.78));
  });

  it("takes the band's height from the shell rather than guessing it", () => {
    expect(layout.availableHeight).toBe(shellGeometry(c.width, c.height, c.insets).transcript.height);
    expect(layout.availableHeight).toBeGreaterThan(0);
  });
});

describe("the two measured viewports, in numbers", () => {
  it("is 321 x 443 with a 250 dp capsule at 349x621", () => {
    const layout = layoutFor(JELLY);
    expect(layout.contentWidth).toBe(321);
    expect(layout.availableHeight).toBe(443);
    expect(layout.capsuleMaxWidth).toBe(250);
    expect(layout.readingMeasure).toBe(321);
    expect(layout.showDayMarker).toBe(true);
  });

  it("is 332 x 590 with a 258 dp capsule at 360x780", () => {
    const layout = layoutFor(S23);
    expect(layout.contentWidth).toBe(332);
    expect(layout.availableHeight).toBe(590);
    expect(layout.capsuleMaxWidth).toBe(258);
    expect(layout.readingMeasure).toBe(332);
    expect(layout.showDayMarker).toBe(true);
  });

  it("is 321 x 195 with a 250 dp capsule at 349x325, keyboard open", () => {
    const layout = layoutFor(JELLY_KEYBOARD);
    expect(layout.contentWidth).toBe(321);
    expect(layout.availableHeight).toBe(195);
    expect(layout.capsuleMaxWidth).toBe(250);
    expect(layout.showDayMarker).toBe(false);
  });
});

describe("the day marker", () => {
  const today = new Date(2026, 8, 21, 12).getTime();
  const yesterday = new Date(2026, 8, 20, 12).getTime();
  const sameDayMorning = new Date(2026, 8, 21, 7).getTime();

  it("is dropped at the 325 dp app area and shown at 621 dp", () => {
    const short = layoutFor(JELLY_KEYBOARD);
    const tall = layoutFor(JELLY);
    expect(short.availableHeight).toBe(195);
    expect(short.showDayMarker).toBe(false);
    expect(tall.availableHeight).toBe(443);
    expect(tall.showDayMarker).toBe(true);
    expect(DAY_MARKER_MIN_TRANSCRIPT_HEIGHT).toBeGreaterThan(short.availableHeight);
    expect(DAY_MARKER_MIN_TRANSCRIPT_HEIGHT).toBeLessThanOrEqual(tall.availableHeight);
    // The threshold has to clear the marker's own box, or the marker would be
    // dropped for a band it actually fits in.
    expect(DAY_MARKER_MIN_TRANSCRIPT_HEIGHT).toBeGreaterThan(DAY_MARKER_HEIGHT);
  });

  it("shows one only where the day changes and the band can afford it", () => {
    const tall = layoutFor(JELLY).availableHeight;
    const short = layoutFor(JELLY_KEYBOARD).availableHeight;
    expect(shouldShowDayMarker(null, today, tall)).toBe(false);
    expect(shouldShowDayMarker(today, sameDayMorning, tall)).toBe(false);
    expect(shouldShowDayMarker(yesterday, today, tall)).toBe(true);
    expect(shouldShowDayMarker(yesterday, today, short)).toBe(false);
  });

  it("reads the day in the reader's own calendar", () => {
    expect(isSameDay(today, sameDayMorning)).toBe(true);
    expect(isSameDay(today, yesterday)).toBe(false);
    expect(showsDayMarker(0)).toBe(false);
    expect(showsDayMarker(DAY_MARKER_MIN_TRANSCRIPT_HEIGHT)).toBe(true);
  });
});

describe("the table-scroll decision step 3b consumes", () => {
  it("never claims a three-column table fits 349 dp", () => {
    // Both the raw band (349) and the reading column it really gets (321).
    for (const width of [349, 321]) {
      const decision = tableScrollDecision(3, width);
      expect(decision.scrolls).toBe(true);
      expect(decision.requiredWidth).toBe(3 * TABLE_MIN_COLUMN_WIDTH);
      expect(decision.requiredWidth).toBeGreaterThan(width);
    }
  });

  it("flips exactly where the third column stops fitting", () => {
    const needed = 3 * TABLE_MIN_COLUMN_WIDTH;
    expect(tableScrollDecision(3, needed - 1).scrolls).toBe(true);
    expect(tableScrollDecision(3, needed).scrolls).toBe(false);
    expect(tableScrollDecision(3, needed + 1).scrolls).toBe(false);
  });

  it("lets the columns that do fit stay put", () => {
    expect(tableScrollDecision(1, 321).scrolls).toBe(false);
    expect(tableScrollDecision(2, 321).scrolls).toBe(false);
    expect(tableScrollDecision(2, 2 * TABLE_MIN_COLUMN_WIDTH - 1).scrolls).toBe(true);
    expect(tableScrollDecision(4, 321).scrolls).toBe(true);
  });

  it("does not claim to scroll a table with nothing to cut", () => {
    expect(tableScrollDecision(0, 321).scrolls).toBe(false);
    expect(tableScrollDecision(-3, 321)).toEqual({
      columns: 0,
      availableWidth: 321,
      requiredWidth: 0,
      scrolls: false,
    });
  });

  it("survives a non-finite width without lying about it", () => {
    expect(tableScrollDecision(3, Number.NaN).scrolls).toBe(true);
    expect(tableScrollDecision(Number.NaN, 321).scrolls).toBe(false);
  });
});

describe("paragraphs in plain text", () => {
  it("splits on a blank line and keeps a single newline inside one paragraph", () => {
    expect(splitParagraphs("one\n\ntwo\n\nthree")).toEqual(["one", "two", "three"]);
    expect(splitParagraphs("one\ntwo")).toEqual(["one\ntwo"]);
    expect(splitParagraphs("  \n\n\n  ")).toEqual([]);
    expect(splitParagraphs("")).toEqual([]);
  });
});

describe("a wide screen", () => {
  it("caps the reading measure but still floors the capsule at 78 %", () => {
    const layout = transcriptLayout(1400, 900, { top: 0, bottom: 0 });
    expect(layout.contentWidth).toBe(1372);
    expect(layout.readingMeasure).toBe(620); // measure.readingMaxWidth
    expect(layout.capsuleMaxWidth).toBe(1070); // floor(1372 * .78)
  });

  it("yields the capsule to a column narrower than the floor", () => {
    const layout = transcriptLayout(40, 621, { top: 0, bottom: 0 });
    expect(layout.contentWidth).toBe(12);
    expect(layout.capsuleMaxWidth).toBe(12);
  });
});
