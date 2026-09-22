/**
 * The pill's text column, measured against the STRINGS it must paint — in
 * both catalogues, in the font files the app actually loads.
 *
 * The defect this exists for: the strip's model pill spent its 154 dp on a
 * 28 dp mark, two 10 dp gaps, a where-dot and 20 dp of padding, and the name
 * got 71 dp against the ~105 dp `LFM2.5 2.6B` measures — a capture read
 * `LFM2.5 …` and `On this ph…`, the second cut mid-word. The node stack cannot
 * render text, but it can read the shipped TTF's advance widths and the
 * catalogue's strings: "does this line fit" is arithmetic here, in EVERY
 * catalogue the pill can draw.
 *
 * The font reader below is deliberately minimal — cmap format 4 and hmtx, the
 * two tables advance widths live in — because a metrics dependency would be a
 * worse risk than the ~50 lines it replaces. Its numbers are validated by the
 * capture: `LFM2.5 …` at 93 px in the old 99 px column (the cut the capture
 * saw), the full name at 116 px — which is why 71 dp could not hold it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../../i18n/en";
import { it as italian } from "../../i18n/it";
import { type } from "../../theme/design";
import {
  MODEL_NAME_COLUMN_NEED_DP,
  shellGeometry,
  stripPillTextColumn,
} from "./shellGeometry";

/** The Jelly, where the capture measured the pill: 480 px over 349 dp. */
const JELLY = { width: 349, height: 621, insets: { top: 24, bottom: 16 } };
/** 1 px = dp * this; from the capture itself (154 dp pill measured 212 px). */
const PX_PER_DP = 1.375;

const INTER_DIR = join("node_modules", "@expo-google-fonts", "inter");
const SEMIBOLD = join(__dirname, "..", "..", "..", INTER_DIR, "600SemiBold", "Inter_600SemiBold.ttf");
const MEDIUM = join(__dirname, "..", "..", "..", INTER_DIR, "500Medium", "Inter_500Medium.ttf");

type TrueType = { unitsPerEm: number; advance: (code: number) => number };

/** cmap (3,1) format 4 + hmtx: everything an advance width needs. */
function readTrueType(path: string): TrueType {
  const buf = readFileSync(path);
  const numTables = buf.readUInt16BE(4);
  const table = (tag: string): number => {
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16;
      if (buf.toString("ascii", p, p + 4) === tag) return buf.readUInt32BE(p + 8);
    }
    throw new Error(`${path}: no ${tag} table`);
  };
  const unitsPerEm = buf.readUInt16BE(table("head") + 18);
  const numHMetrics = buf.readUInt16BE(table("hhea") + 34);
  const hmtx = table("hmtx");

  const cmap = table("cmap");
  const subtables = buf.readUInt16BE(cmap + 2);
  let sub = -1;
  for (let i = 0; i < subtables; i++) {
    const p = cmap + 4 + i * 8;
    if (buf.readUInt16BE(p) === 3 && buf.readUInt16BE(p + 2) === 1) {
      sub = cmap + buf.readUInt32BE(p + 4);
    }
  }
  if (sub < 0) throw new Error(`${path}: no (3,1) cmap subtable`);
  if (buf.readUInt16BE(sub) !== 4) throw new Error(`${path}: cmap is not format 4`);

  const segCount = buf.readUInt16BE(sub + 6) / 2;
  const endBase = sub + 14; // endCode[segCount], then reservedPad
  const startBase = endBase + 2 * segCount + 2;
  const deltaBase = startBase + 2 * segCount;
  const rangeBase = deltaBase + 2 * segCount;

  const glyphId = (code: number): number => {
    for (let s = 0; s < segCount; s++) {
      if (buf.readUInt16BE(endBase + 2 * s) < code) continue;
      const start = buf.readUInt16BE(startBase + 2 * s);
      if (start > code) return 0;
      const delta = buf.readInt16BE(deltaBase + 2 * s);
      const range = buf.readUInt16BE(rangeBase + 2 * s);
      if (range === 0) return (code + delta) & 0xffff;
      const gid = buf.readUInt16BE(rangeBase + 2 * s + range + 2 * (code - start));
      return gid === 0 ? 0 : (gid + delta) & 0xffff;
    }
    return 0;
  };

  return {
    unitsPerEm,
    advance: (code: number): number => {
      const gid = glyphId(code);
      // A character outside the font is a measurement that would silently pass:
      // fail loudly instead.
      if (gid === 0) throw new Error(`${path}: no glyph for U+${code.toString(16)}`);
      const last = numHMetrics - 1;
      return buf.readUInt16BE(hmtx + 4 * Math.min(gid, last));
    },
  };
}

/** The laid-out width in dp: advance units scaled to the type size, plus the
 *  style's `letterSpacing` per character (how RN applies it). */
function textWidthDp(
  text: string,
  font: TrueType,
  fontSizeDp: number,
  letterSpacingDp = 0,
): number {
  const chars = Array.from(text);
  const units = chars.reduce((sum, ch) => sum + font.advance(ch.codePointAt(0) ?? 0), 0);
  return (units / font.unitsPerEm) * fontSizeDp + letterSpacingDp * chars.length;
}

const interSemiBold = readTrueType(SEMIBOLD);
const interMedium = readTrueType(MEDIUM);

/** What the pill gives its text at the width the capture measured. */
const COLUMN_DP = stripPillTextColumn(
  shellGeometry(JELLY.width, JELLY.height, JELLY.insets).touchTargets.stripPill.width,
);

describe("the column", () => {
  it("is what the geometry says it is, and clears the capture's measured need", () => {
    // 154 dp pill - 2*6 padding - 6 gap - 15 chevron = 121 dp. The floor is
    // the capture's own figure for `LFM2.5 2.6B` (~145 px = 105 dp), kept here
    // rather than the font's 85 dp because only a capture sees the device.
    expect(COLUMN_DP).toBe(121);
    expect(COLUMN_DP).toBeGreaterThanOrEqual(MODEL_NAME_COLUMN_NEED_DP);
    expect(COLUMN_DP * PX_PER_DP).toBeGreaterThanOrEqual(145);
  });

  it("would catch a longer string — the measurement is not vacuous", () => {
    const long = "LFM2.5-2.6B-Instruct-Q4_K_M-on-device";
    expect(textWidthDp(long, interSemiBold, type.label.fontSize, -0.1)).toBeGreaterThan(
      COLUMN_DP,
    );
  });
});

describe("the model name paints in full", () => {
  // The default the capture read (`"LFM2.5 2.6B"`), at the pill's own style:
  // `type.label` + Inter 600, the -0.1 letterSpacing `styles.modelName` carries.
  const NAME = "LFM2.5 2.6B";

  it("fits the column at the pill's type size, in dp and in the capture's px", () => {
    const widthDp = textWidthDp(NAME, interSemiBold, type.label.fontSize, -0.1);
    expect(widthDp).toBeGreaterThan(80); // a real width, not a broken reader
    expect(widthDp).toBeLessThanOrEqual(COLUMN_DP);
    expect(widthDp * PX_PER_DP).toBeLessThanOrEqual(COLUMN_DP * PX_PER_DP);
    // And against the device's own (larger) estimate: the column clears both.
    expect(COLUMN_DP).toBeGreaterThanOrEqual(MODEL_NAME_COLUMN_NEED_DP);
  });
});

describe("the where line paints in full — in BOTH catalogues", () => {
  it("fits every catalogue value of shell.where.thisPhone, with no ellipsis to cut a word", () => {
    // The defect was `On this ph…` cut MID-WORD, which reads as damage. The
    // fix must not trade it for the same cut in Italian: "Su questo telefono"
    // is the longer value and the one that decides the budget.
    const values = [en.shell.where.thisPhone, italian.shell.where.thisPhone];
    for (const value of values) {
      const widthDp = textWidthDp(value, interMedium, type.meta.fontSize);
      expect([value, widthDp]).toEqual([value, expect.any(Number)]);
      expect([value, widthDp <= COLUMN_DP]).toEqual([value, true]);
    }
    // The Italian value is the binding one; the margin it leaves is a fact
    // worth stating — if a copy edit shrinks it to nothing, the next assertion
    // on the column is where to look.
    expect(
      textWidthDp(italian.shell.where.thisPhone, interMedium, type.meta.fontSize),
    ).toBeLessThanOrEqual(COLUMN_DP);
  });
});

describe("the pill draws its chrome from the geometry's constants", () => {
  it("so the arithmetic above cannot drift from the styles that render it", () => {
    // stripPillTextColumn assumes padding, gap and chevron; these are the three
    // places that could quietly disagree with it.
    const styles = readFileSync(join(__dirname, "shellStyles.ts"), "utf8");
    expect(styles).toContain("gap: STRIP_PILL_GAP");
    expect(styles).toContain("paddingHorizontal: STRIP_PILL_PADDING_X");
    const shell = readFileSync(join(__dirname, "Shell.tsx"), "utf8");
    expect(shell).toContain("size={STRIP_CHEVRON_SIZE}");
    expect(shell).not.toContain("size={15}");
  });
});
