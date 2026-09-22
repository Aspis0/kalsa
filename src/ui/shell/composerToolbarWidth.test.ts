/**
 * The toolbar row's width arithmetic against 349 dp — the strip pill's budget
 * one band down, measured the same way `stripTextBudget.test.ts` measures the
 * pill: read the shipped TTF for advance widths, read the catalogues for the
 * strings, and let "does it fit" be arithmetic instead of a hope.
 *
 * The defect this pins (vision audit, 4 of 4 shots): with FOUR controls the
 * `Library document` chip was clipped by the row's right edge and the `Notes`
 * chip sat ENTIRELY outside 349 dp — the row scrolled and its last control was
 * undiscoverable. The chip was removed (it also could not do its job without
 * the attachment flow), and this file holds both halves of that decision:
 *
 *   1. research + notes fit 349 dp IN BOTH CATALOGUES, with room to spare —
 *      the row still scrolls for text scaling, but never has to at 1x;
 *   2. adding `Library document` back OVERFLOWS 349 dp — so the chip returns
 *      only with a row that has the width for it (the attachment flow's own
 *      slice), never by re-clipping the row.
 *
 * The font reader below is the one `stripTextBudget.test.ts` carries, kept
 * local on purpose: two tests each own their reader, so neither can break the
 * other's proof, and this one measures the MEDIUM face at `type.meta` (the
 * chip's actual paint) rather than the pill's semibold.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { en } from "../../i18n/en";
import { it as italian } from "../../i18n/it";
import { spacing, type } from "../../theme/design";
import {
  MIN_TOUCH_TARGET,
  TOOLBAR_CHIP_ICON,
  TOOLBAR_CHIP_LABEL_GAP,
  toolbarChipWidth,
  toolbarChipsAvailable,
  toolbarChipsWidth,
} from "./shellGeometry";

/** The row's own source, so the arithmetic cannot drift from the component. */
const RAW_SOURCE = readFileSync(join(__dirname, "ComposerToolbar.tsx"), "utf8");
/** Comments stripped: prose about a rule must never satisfy the rule. */
const SOURCE = RAW_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^[ \t]*\/\/.*$/gm, "");

/** The device the clipping was seen on: 349 x 621 dp (DESIGN.md §1.1). */
const JELLY_WIDTH = 349;

const INTER_MEDIUM = join(
  __dirname,
  "..",
  "..",
  "..",
  "node_modules",
  "@expo-google-fonts",
  "inter",
  "500Medium",
  "Inter_500Medium.ttf",
);

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
  const endBase = sub + 14;
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
      if (gid === 0) throw new Error(`${path}: no glyph for U+${code.toString(16)}`);
      const last = numHMetrics - 1;
      return buf.readUInt16BE(hmtx + 4 * Math.min(gid, last));
    },
  };
}

const interMedium = readTrueType(INTER_MEDIUM);

/** The label's laid-out width in dp at the chip's `type.meta` paint. */
function labelDp(text: string): number {
  const chars = Array.from(text);
  const units = chars.reduce((sum, ch) => sum + interMedium.advance(ch.codePointAt(0) ?? 0), 0);
  return (units / interMedium.unitsPerEm) * type.meta.fontSize;
}

/** The two catalogues a row must fit in, with the three labels each can draw. */
const CATALOGUES = [
  {
    locale: "en",
    research: en.chat.deepResearch,
    notes: en.notes.title,
    document: en.chat.libraryDocument,
  },
  {
    locale: "it",
    research: italian.chat.deepResearch,
    notes: italian.notes.title,
    document: italian.chat.libraryDocument,
  },
] as const;

describe("the row's budget, as numbers", () => {
  it("is exactly what 349 dp leaves the chips scroller after row padding, ✦ and a gap", () => {
    // 349 - 2*14 row padding - 48 templates target - 6 gap = 267 dp.
    expect(toolbarChipsAvailable(JELLY_WIDTH)).toBe(267);
    // The chrome each chip spends, from the same tokens the component pads with:
    // 2*10 pill padding + 15 icon + 4 icon↔label gap = 39 dp before any text.
    expect(spacing.md).toBe(14);
    expect(spacing.sm).toBe(10);
    expect(spacing.xs).toBe(6);
    expect(toolbarChipWidth(0)).toBe(2 * spacing.sm + TOOLBAR_CHIP_ICON + TOOLBAR_CHIP_LABEL_GAP);
    expect(toolbarChipsWidth([])).toBe(0);
    // Chips are separated by the scroller's own content gap.
    expect(toolbarChipsWidth([10, 20])).toBe(toolbarChipWidth(10) + toolbarChipWidth(20) + spacing.xs);
  });

  it("the component spends those same tokens (budget and render cannot drift)", () => {
    expect(SOURCE).toContain("TOOLBAR_CHIP_ICON");
    expect(SOURCE).toContain("TOOLBAR_CHIP_LABEL_GAP");
    expect(SOURCE).toMatch(/paddingHorizontal: spacing\.sm/);
    expect(SOURCE).toMatch(/paddingHorizontal: spacing\.md/);
    expect(SOURCE).toMatch(/gap: spacing\.xs/);
    expect(SOURCE).not.toContain("hitSlop");
  });
});

describe("what fits 349 dp: research + notes, in both catalogues", () => {
  it.each(CATALOGUES)("$locale: the two remaining chips fit with room to spare", (sheet) => {
    const widths = [labelDp(sheet.research), labelDp(sheet.notes)];
    const used = toolbarChipsWidth(widths);
    expect(used).toBeLessThanOrEqual(toolbarChipsAvailable(JELLY_WIDTH));
    // "Room to spare" is a claim, so measure it: at least 20 dp of slack, i.e.
    // the fit is not a rounding accident of one long label.
    expect(toolbarChipsAvailable(JELLY_WIDTH) - used).toBeGreaterThanOrEqual(20);
  });
});

describe("what did NOT fit: the removed library-document chip", () => {
  it.each(CATALOGUES)("$locale: three chips overflow the row — the clip this slice removed", (sheet) => {
    const widths = [labelDp(sheet.research), labelDp(sheet.document), labelDp(sheet.notes)];
    const used = toolbarChipsWidth(widths);
    expect(used).toBeGreaterThan(toolbarChipsAvailable(JELLY_WIDTH));
    // The overflow is the LAST chip falling out, not a hairline: Notes leaves
    // the row entirely (the audit's second finding), so the missing width must
    // exceed a whole notes chip's width.
    const notesChip = toolbarChipWidth(labelDp(sheet.notes));
    expect(used - toolbarChipsAvailable(JELLY_WIDTH)).toBeGreaterThan(notesChip);
    // And the FIRST finding — the document chip clipped by the right edge in
    // 4 of 4 shots: research + document alone already exceed the scroller.
    expect(toolbarChipsWidth([labelDp(sheet.research), labelDp(sheet.document)])).toBeGreaterThan(
      toolbarChipsAvailable(JELLY_WIDTH),
    );
  });

  it("would catch a row that quietly took the chip back", () => {
    expect(SOURCE).not.toContain("shell.composer.document");
    expect(SOURCE).not.toContain("chat.libraryDocument");
  });
});

describe("the measurement itself", () => {
  it("is not vacuous: a longer string does not fit", () => {
    const decoy = "Deep research on a very long label that must not fit the row at all";
    expect(toolbarChipsWidth([labelDp(decoy)])).toBeGreaterThan(
      toolbarChipsAvailable(JELLY_WIDTH),
    );
  });

  it("measures at the chip's real type role, on the real face", () => {
    expect(type.meta.fontSize).toBe(12);
    expect(type.meta.fontFamily).toBe("Inter_500Medium");
    // A non-empty measurement of a short word, so a broken reader that returned
    // 0 for everything would fail here rather than make every fit pass.
    expect(labelDp("Notes")).toBeGreaterThan(10);
  });

  it("keeps the floor the row is drawn on at its literal", () => {
    expect(MIN_TOUCH_TARGET).toBe(48);
  });
});
