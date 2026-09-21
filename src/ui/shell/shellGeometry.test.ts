/**
 * The shell's geometry, which is the only part of step 2 a node test can reach:
 * there is no render harness (DESIGN.md, "proof regime"), so the sizes and the
 * 48 dp floor are asserted here and the pixels are proven by screenshots.
 *
 * The three real sizes are the measured ones (DESIGN.md §1.1). The Jelly's
 * keyboard case is the one that decides the strip's collapsed form, and it is
 * the only case where the transcript is short.
 */
import {
  COMPOSER_HEIGHT,
  MIN_TOUCH_TARGET,
  STRIP_HEIGHT,
  STRIP_HEIGHT_COLLAPSED,
  shellGeometry,
  type Insets,
  type ShellGeometry,
} from "./shellGeometry";

type Case = {
  name: string;
  width: number;
  height: number;
  insets: Insets;
  collapsed: boolean;
};

/** Insets are the safe area only; the keyboard case passes height = app area. */
const CASES: Case[] = [
  {
    name: "Jelly Star 349x621",
    width: 349,
    height: 621,
    insets: { top: 24, bottom: 16 },
    collapsed: false,
  },
  {
    name: "Galaxy S23 360x780",
    width: 360,
    height: 780,
    insets: { top: 28, bottom: 24 },
    collapsed: false,
  },
  {
    name: "Jelly Star 349x325, keyboard open",
    width: 349,
    height: 325,
    insets: { top: 0, bottom: 0 },
    collapsed: true,
  },
];

const geoFor = (c: Case): ShellGeometry => shellGeometry(c.width, c.height, c.insets);

describe.each(CASES)("$name", (c) => {
  const geo = geoFor(c);

  it("partitions the usable height exactly, with no gap and no overflow", () => {
    const usable = c.height - c.insets.top - c.insets.bottom;
    expect(geo.usableHeight).toBe(usable);
    expect(geo.strip.top).toBe(c.insets.top);
    expect(geo.transcript.top).toBe(geo.strip.top + geo.strip.height);
    expect(geo.composer.top).toBe(geo.transcript.top + geo.transcript.height);
    // The sum, written out: this is the assertion that fails the moment a
    // constant is changed without the arithmetic following it.
    expect(geo.strip.height + geo.transcript.height + geo.composer.height).toBe(usable);
    expect(geo.composer.top + geo.composer.height).toBe(c.height - c.insets.bottom);
  });

  it("keeps the composer off the bottom inset and reports the offset", () => {
    expect(geo.composer.top + geo.composer.height).toBeLessThanOrEqual(c.height - c.insets.bottom);
    expect(geo.composerBottomOffset).toBe(c.insets.bottom);
  });

  it("gives every interactive box at least 48 dp on both axes", () => {
    for (const [name, box] of Object.entries(geo.touchTargets)) {
      expect([name, box.width >= MIN_TOUCH_TARGET, box.height >= MIN_TOUCH_TARGET]).toEqual([
        name,
        true,
        true,
      ]);
    }
    expect(geo.minTouchTarget).toBeGreaterThanOrEqual(48);
  });

  it("holds the strip and the composer open and collapsed above the floor", () => {
    expect(STRIP_HEIGHT).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(STRIP_HEIGHT_COLLAPSED).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
    expect(COMPOSER_HEIGHT).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET);
  });

  it("agrees with the collapsed form the height implies", () => {
    expect(geo.stripCollapsed).toBe(c.collapsed);
    const expectedStrip = c.collapsed ? STRIP_HEIGHT_COLLAPSED : STRIP_HEIGHT;
    expect(geo.strip.height).toBe(expectedStrip);
  });

  it("leaves the transcript a real, positive height", () => {
    expect(geo.transcript.height).toBeGreaterThan(0);
    expect(geo.transcriptUsableHeight).toBe(geo.transcript.height);
  });
});

describe("the smallest screen, 349x325 with the keyboard open", () => {
  const geo = shellGeometry(349, 325, { top: 0, bottom: 0 });

  it("collapses the strip to one line and still leaves the transcript room", () => {
    expect(geo.stripCollapsed).toBe(true);
    expect(geo.strip.height).toBe(STRIP_HEIGHT_COLLAPSED);
    // 325 - 52 - 78 = 195 dp of transcript.
    expect(geo.transcript.height).toBe(195);
    expect(geo.transcriptUsableHeight).toBeGreaterThanOrEqual(120);
  });
});

describe("a degenerate height", () => {
  it("degrades without a negative height and still partitions", () => {
    const geo = shellGeometry(349, 120, { top: 24, bottom: 24 });
    expect(geo.usableHeight).toBe(72);
    for (const [name, band] of Object.entries({ strip: geo.strip, transcript: geo.transcript, composer: geo.composer })) {
      expect([name, band.height >= 0]).toEqual([name, true]);
      expect([name, band.top >= 0]).toEqual([name, true]);
    }
    const total = geo.strip.height + geo.transcript.height + geo.composer.height;
    expect(total).toBe(geo.usableHeight);
    expect(geo.composerBottomOffset).toBeGreaterThanOrEqual(0);
  });

  it("does not put a negative height in the transcript when the bands cannot fit", () => {
    // 60 usable: smaller than the collapsed strip plus the composer, so the
    // transcript must yield rather than go negative.
    const geo = shellGeometry(349, 108, { top: 24, bottom: 24 });
    expect(geo.usableHeight).toBe(60);
    expect(geo.transcript.height).toBe(0);
    expect(geo.strip.height + geo.composer.height).toBe(60);
  });

  it("does not produce negative bands when the height is below the insets", () => {
    const geo = shellGeometry(349, 20, { top: 24, bottom: 24 });
    expect(geo.usableHeight).toBe(0);
    expect(geo.strip.height).toBe(0);
    expect(geo.transcript.height).toBe(0);
    expect(geo.composer.height).toBe(0);
    expect(geo.composerBottomOffset).toBeGreaterThanOrEqual(0);
  });
});

describe("the width is only used for the horizontal boxes", () => {
  it("keeps the pill and the field at or above the touch floor on the Jelly", () => {
    const geo = shellGeometry(349, 621, { top: 0, bottom: 0 });
    // 349 - 2*12 - 2*48 - 2*9 = 211 for the pill; 349 - 2*12 = 325 for the field.
    expect(geo.touchTargets.stripPill.width).toBe(211);
    expect(geo.touchTargets.composerField.width).toBe(325);
  });
});
