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
  COMPOSER_TOOLBAR_HEIGHT,
  MIN_TOUCH_TARGET,
  MODEL_NAME_COLUMN_NEED_DP,
  SHELL_NOTICE_GAP,
  SHELL_NOTICE_HEIGHT,
  STRIP_CHEVRON_SIZE,
  STRIP_HEIGHT,
  STRIP_HEIGHT_COLLAPSED,
  bottomInsetFor,
  shellGeometry,
  stripPillTextColumn,
  type Insets,
  type ShellGeometry,
} from "./shellGeometry";
import { type as designType } from "../../theme/design";

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

  it("keeps the pill's chrome smaller than the pill, so only the pill is the target", () => {
    // BEFORE this held the LOGO MARK (28 dp) under the 48 dp pill. The mark is
    // gone from the strip — a capture showed it spending 28 dp of a 154 dp pill
    // while the model's own name truncated (`LFM2.5 …`) — and the chevron is
    // now the only picture inside. The rule is unchanged: chrome is a picture,
    // the pill around it is the touch target, and chrome may not decide the
    // pill's size.
    expect(STRIP_CHEVRON_SIZE).toBeGreaterThan(0);
    expect(STRIP_CHEVRON_SIZE).toBeLessThan(MIN_TOUCH_TARGET);
    expect(MIN_TOUCH_TARGET - STRIP_CHEVRON_SIZE).toBeGreaterThanOrEqual(12);
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
    // 325 - 52 - 78 = 195 dp of transcript, as `shellGeometry` partitions it.
    // The live shell then takes the toolbar row OUT of this height before the
    // partition (see COMPOSER_TOOLBAR_HEIGHT), so the app draws 195 - 48 = 147
    // here while the toolbar shows — the row is not a fourth band.
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

describe("the bottom inset rule: the keyboard and the safe area", () => {
  const INSETS: Insets = { top: 24, bottom: 16 };

  /**
   * The band numbers, without the inputs (the keyboard case has a taller
   * `height` than the window it is compared to, by design) and without
   * `composerBottomOffset`, which is exactly where the two cases must differ:
   * in the keyboard case the composer bottom is the keyboard's top edge.
   */
  const bandNumbers = (geo: ShellGeometry) => ({
    usableHeight: geo.usableHeight,
    strip: geo.strip,
    transcript: geo.transcript,
    composer: geo.composer,
    stripCollapsed: geo.stripCollapsed,
  });

  it("takes the larger of the two, never the sum, and the safe-area inset when there is no keyboard", () => {
    expect(bottomInsetFor(INSETS, 0)).toEqual(INSETS);
    // Absent: an omitted height is the same as a closed keyboard.
    expect(bottomInsetFor(INSETS)).toEqual(INSETS);
    // A keyboard thinner than the gesture bar still cannot lift the composer
    // above the bar's own edge.
    expect(bottomInsetFor(INSETS, 12)).toEqual(INSETS);
    expect(bottomInsetFor(INSETS, 296)).toEqual({ top: 24, bottom: 296 });
    // The rule in one line: 296 + 16 = 312 is the sum, and it is forbidden.
    expect(bottomInsetFor(INSETS, 296).bottom).not.toBe(INSETS.bottom + 296);
    // The top inset is carried through untouched, so the strip stays under the
    // status bar whichever way the keyboard went.
    expect(bottomInsetFor({ top: 28, bottom: 24 }, 296)).toEqual({ top: 28, bottom: 296 });
  });

  it("treats a negative or a non-finite keyboard height as no keyboard", () => {
    for (const bad of [-1, -296, NaN, Infinity, -Infinity]) {
      expect([String(bad), bottomInsetFor(INSETS, bad)]).toEqual([String(bad), INSETS]);
    }
  });

  it("makes the 325 dp case real: a 621 dp window with the keyboard open IS a short window", () => {
    const keyboard = shellGeometry(349, 621, bottomInsetFor(INSETS, 296));

    // The number that makes the claim checkable at a glance: the composer's
    // bottom edge is the keyboard's top edge, and 621 - 296 = 325 dp is the app
    // area this file has called the keyboard case all along.
    expect(keyboard.composerBottomOffset).toBe(296);
    expect(621 - keyboard.composerBottomOffset).toBe(325);
    expect(keyboard.usableHeight).toBe(301);

    // With the status bar counted, as the live app must, the bands are exactly
    // the bands of a pinned 341 dp window: 621 - 296 + 16, the gesture bar the
    // keyboard covers and a pinned window with no keyboard still reserves.
    const shortWindow = shellGeometry(349, 341, INSETS);
    expect(bandNumbers(keyboard)).toEqual(bandNumbers(shortWindow));

    // That 16 dp is the whole difference from the pinned 325 dp window the
    // preview uses, so the two are one gesture bar apart and not equal.
    const pinned325 = shellGeometry(349, 325, INSETS);
    expect(keyboard.usableHeight - pinned325.usableHeight).toBe(16);
    expect(keyboard.transcript.height - pinned325.transcript.height).toBe(16);

    // The file's own keyboard stand-in — 325 dp with both insets at zero, which
    // is how the app area was measured before edge-to-edge — is the same
    // statement with the insets at zero on both sides.
    const standIn = shellGeometry(349, 621, bottomInsetFor({ top: 0, bottom: 16 }, 296));
    const standInBands = bandNumbers(standIn);
    expect(standInBands).toEqual(bandNumbers(shellGeometry(349, 325, { top: 0, bottom: 0 })));
  });

  it("leaves every keyboard-free case numerically unchanged", () => {
    for (const c of CASES) {
      expect(shellGeometry(c.width, c.height, bottomInsetFor(c.insets, 0))).toEqual(geoFor(c));
    }
    // The pinned stand-in the file already asserts, as a keyboard-free case.
    const standIn = shellGeometry(349, 325, bottomInsetFor({ top: 0, bottom: 0 }, 0));
    expect(standIn.transcript.height).toBe(195);
    expect(standIn.usableHeight).toBe(325);
  });
});

describe("the preview's notice line", () => {
  it("holds one line plus the chosen gap below it, and still clips a wrap", () => {
    // BEFORE this assertion read only ">= one line, < two" over a 22 dp band
    // that left 3 dp under the caption; it now pins the gap the caption was
    // given, keeps the ceiling that makes a long string clip instead of
    // wrapping into the conversation, and states the band as its own arithmetic
    // so the constant and the gap cannot drift apart.
    expect(SHELL_NOTICE_HEIGHT).toBe(2 * SHELL_NOTICE_GAP + designType.meta.lineHeight);
    expect(SHELL_NOTICE_HEIGHT).toBeGreaterThanOrEqual(
      designType.meta.lineHeight + SHELL_NOTICE_GAP,
    );
    expect(SHELL_NOTICE_HEIGHT).toBeLessThan(2 * designType.meta.lineHeight);
  });

  it("still lets the bands partition the available height exactly at all three sizes", () => {
    // The notice is subtracted from the height BEFORE `shellGeometry` runs
    // (`Shell.tsx`, `ShellPreview.tsx`), so the taller band must leave the
    // partition invariant untouched at every measured size: 349x621,
    // 349x325 (the pinned keyboard case) and 360x780.
    for (const c of CASES) {
      const available = c.height - SHELL_NOTICE_HEIGHT;
      const geo = shellGeometry(c.width, available, c.insets);
      expect(geo.usableHeight).toBe(available - c.insets.top - c.insets.bottom);
      expect(geo.strip.height + geo.transcript.height + geo.composer.height).toBe(
        geo.usableHeight,
      );
      expect(geo.strip.top).toBe(c.insets.top);
      expect(geo.composer.top + geo.composer.height).toBe(available - c.insets.bottom);
    }
  });
});

describe("the width is only used for the horizontal boxes", () => {
  it("keeps the pill and the field at or above the touch floor on the Jelly", () => {
    const geo = shellGeometry(349, 621, { top: 0, bottom: 0 });
    // Contract history, all three states written down so the next change lands
    // as a deliberate edit of THIS number rather than a discovery:
    //   BEFORE the Web switch:  `349 - 2*12 - 3*48 - 3*9 = 154` (menu, export,
    //     new chat) — the pill 154 dp.
    //   WITH the switch AND export on the strip: four buttons, `= 97`, a 14 dp
    //     text column: the model name and "On this phone" both rendered as bare
    //     ellipses (host3 capture: "a row of tiny dots").
    //   NOW: export lives in the drawer (chat-level action; `HostDrawer.tsx`),
    //     three buttons again, pill 154 dp — and WHAT THE PILL SPENDS inside
    //     those 154 dp changed with the legibility slice: no 28 dp mark, no
    //     where-dot, spacing.xs padding and ONE gap, so the name's column is
    //     154 - 2*6 - 6 - 15 = 121 dp, against 71 dp before and the ~105 dp the
    //     capture measured for `LFM2.5 2.6B`. Nothing shrank below the 48 dp
    //     floor; the decorative pictures moved instead.
    expect(geo.touchTargets.stripPill.width).toBe(154);
    expect(stripPillTextColumn(geo.touchTargets.stripPill.width)).toBe(121);
    expect(stripPillTextColumn(geo.touchTargets.stripPill.width)).toBeGreaterThanOrEqual(
      MODEL_NAME_COLUMN_NEED_DP,
    );
    expect(geo.touchTargets.composerField.width).toBe(325);
  });
});

describe("the composer's toolbar row (D1 rows 13/14)", () => {
  it("is a real 48 dp row, and it is subtracted before the partition, not drawn over a band", () => {
    // The row is a shell row like the notice lines: paid out of the height in
    // `Shell.tsx`'s `extraRows` before `shellGeometry` runs, so the three-band
    // invariant above never mentions it — and the pinned 349x325 stand-in's
    // live transcript is 195 - 48 = 147 while the toolbar shows.
    expect(COMPOSER_TOOLBAR_HEIGHT).toBe(MIN_TOUCH_TARGET);
    const geo = shellGeometry(349, 325, { top: 0, bottom: 0 });
    expect(geo.transcript.height - COMPOSER_TOOLBAR_HEIGHT).toBe(147);
  });
});
