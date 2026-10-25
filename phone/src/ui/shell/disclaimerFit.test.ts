/**
 * The disclaimer must stay one line on the 349 dp reference phone, in every
 * shipped locale, in the shell and in the Room. The widths come from the Inter
 * Medium file the app loads: advances summed over the string, no kerning, the
 * way one text run is laid out. A copy change, a new locale or a type bump
 * fails here instead of truncating on a device.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { en } from "../../i18n/en";
import { it as italian } from "../../i18n/it";
import { families, measure, space, type } from "../../theme/design";
import { COMPOSER_DISCLAIMER_HEIGHT, DISCLAIMER_MAX_FONT_SCALE } from "./disclaimerMetrics";

const FONT = join(__dirname, "../../../node_modules/@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf");
const REFERENCE_WIDTH = 349;
const MIN_SLACK = 10;

type Ttf = { unitsPerEm: number; lineEm: number; width: (text: string, size: number) => number };

/** The few tables a width needs: head, hhea, hmtx and the BMP cmap (format 4). */
function readTtf(path: string): Ttf {
  const buf = readFileSync(path);
  const tables = new Map<string, number>();
  for (let i = 0; i < buf.readUInt16BE(4); i++) {
    const record = 12 + i * 16;
    tables.set(buf.toString("latin1", record, record + 4), buf.readUInt32BE(record + 8));
  }
  const head = tables.get("head")!;
  const hhea = tables.get("hhea")!;
  const hmtx = tables.get("hmtx")!;
  const cmap = tables.get("cmap")!;
  const unitsPerEm = buf.readUInt16BE(head + 18);
  const numHMetrics = buf.readUInt16BE(hhea + 34);
  let subtable = -1;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i++) {
    const platform = buf.readUInt16BE(cmap + 4 + 8 * i);
    const encoding = buf.readUInt16BE(cmap + 6 + 8 * i);
    if ((platform === 3 && encoding === 1) || platform === 0) {
      subtable = cmap + buf.readUInt32BE(cmap + 8 + 8 * i);
      break;
    }
  }
  if (subtable < 0 || buf.readUInt16BE(subtable) !== 4) throw new Error("no BMP cmap (format 4)");

  function glyph(code: number): number {
    const segX2 = buf.readUInt16BE(subtable + 6);
    const ends = subtable + 14;
    const starts = ends + segX2 + 2;
    const deltas = starts + segX2;
    const ranges = deltas + segX2;
    for (let i = 0; i < segX2 / 2; i++) {
      if (code > buf.readUInt16BE(ends + 2 * i)) continue;
      const start = buf.readUInt16BE(starts + 2 * i);
      if (code < start) return 0;
      const delta = buf.readInt16BE(deltas + 2 * i);
      const range = buf.readUInt16BE(ranges + 2 * i);
      if (range === 0) return (code + delta) & 0xffff;
      const found = buf.readUInt16BE(ranges + 2 * i + range + 2 * (code - start));
      return found === 0 ? 0 : (found + delta) & 0xffff;
    }
    return 0;
  }

  return {
    unitsPerEm,
    lineEm: (buf.readInt16BE(hhea + 4) - buf.readInt16BE(hhea + 6)) / unitsPerEm,
    width(text, size) {
      let units = 0;
      for (const char of text) {
        const g = glyph(char.codePointAt(0)!);
        if (g === 0 && char !== " ") throw new Error(`the font has no glyph for ${char}`);
        units += buf.readUInt16BE(hmtx + 4 * Math.min(g, numHMetrics - 1));
      }
      return (units / unitsPerEm) * size;
    },
  };
}

const font = readTtf(FONT);
const shipped: Array<[string, string]> = [
  ["en", en.shell.disclaimer],
  ["it", italian.shell.disclaimer],
];

describe("the disclaimer line at the 349 dp reference width", () => {
  test("the caption token is the Inter Medium file read here", () => {
    expect(type.caption.fontFamily).toBe(families.sansMedium);
    expect(families.sansMedium).toBe("Inter_500Medium");
  });

  test.each(shipped)("%s fits one line in the shell and in the Room with 10 dp to spare", (_, text) => {
    const width = font.width(text, type.caption.fontSize);
    for (const sidePadding of [measure.gutter, space.md]) {
      expect(width).toBeLessThanOrEqual(REFERENCE_WIDTH - 2 * sidePadding - MIN_SLACK);
    }
  });

  test("the OS text scale cap keeps the glyphs inside the line box, and is the largest such cap", () => {
    const glyphBox = (scale: number) => type.caption.fontSize * scale * font.lineEm;
    expect(glyphBox(DISCLAIMER_MAX_FONT_SCALE)).toBeLessThanOrEqual(COMPOSER_DISCLAIMER_HEIGHT);
    expect(glyphBox(DISCLAIMER_MAX_FONT_SCALE + 0.01)).toBeGreaterThan(COMPOSER_DISCLAIMER_HEIGHT);
  });
});
