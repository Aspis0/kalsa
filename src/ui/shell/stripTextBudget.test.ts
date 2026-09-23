/** The model name and short location label must fit the v2 single-line pill. */
import { readFileSync } from "fs";
import { join } from "path";
import { type } from "../../theme/design";
import { shellGeometry, stripPillTextColumn } from "./shellGeometry";

const SEMIBOLD = join(__dirname, "..", "..", "..", "node_modules", "@expo-google-fonts", "inter", "600SemiBold", "Inter_600SemiBold.ttf");
const MEDIUM = join(__dirname, "..", "..", "..", "node_modules", "@expo-google-fonts", "inter", "500Medium", "Inter_500Medium.ttf");

type FontMetrics = { unitsPerEm: number; advance: (code: number) => number };

function readFont(path: string): FontMetrics {
  const buf = readFileSync(path);
  const count = buf.readUInt16BE(4);
  const table = (name: string) => {
    for (let i = 0; i < count; i += 1) {
      const offset = 12 + i * 16;
      if (buf.toString("ascii", offset, offset + 4) === name) return buf.readUInt32BE(offset + 8);
    }
    throw new Error(`${path}: missing ${name}`);
  };
  const unitsPerEm = buf.readUInt16BE(table("head") + 18);
  const metrics = buf.readUInt16BE(table("hhea") + 34);
  const hmtx = table("hmtx");
  const cmap = table("cmap");
  let sub = -1;
  for (let i = 0; i < buf.readUInt16BE(cmap + 2); i += 1) {
    const offset = cmap + 4 + i * 8;
    if (buf.readUInt16BE(offset) === 3 && buf.readUInt16BE(offset + 2) === 1) sub = cmap + buf.readUInt32BE(offset + 4);
  }
  if (sub < 0 || buf.readUInt16BE(sub) !== 4) throw new Error(`${path}: missing format 4 cmap`);
  const segments = buf.readUInt16BE(sub + 6) / 2;
  const end = sub + 14;
  const start = end + 2 * segments + 2;
  const delta = start + 2 * segments;
  const range = delta + 2 * segments;
  const glyph = (code: number) => {
    for (let i = 0; i < segments; i += 1) {
      if (buf.readUInt16BE(end + 2 * i) < code) continue;
      if (buf.readUInt16BE(start + 2 * i) > code) return 0;
      const d = buf.readInt16BE(delta + 2 * i);
      const r = buf.readUInt16BE(range + 2 * i);
      if (!r) return (code + d) & 0xffff;
      const id = buf.readUInt16BE(range + 2 * i + r + 2 * (code - buf.readUInt16BE(start + 2 * i)));
      return id ? (id + d) & 0xffff : 0;
    }
    return 0;
  };
  return {
    unitsPerEm,
    advance(code) {
      const id = glyph(code);
      if (!id) throw new Error(`${path}: no glyph for U+${code.toString(16)}`);
      return buf.readUInt16BE(hmtx + 4 * Math.min(id, metrics - 1));
    },
  };
}

function textWidth(text: string, font: FontMetrics, size: number, spacing = 0): number {
  const chars = Array.from(text);
  const units = chars.reduce((sum, ch) => sum + font.advance(ch.codePointAt(0) ?? 0), 0);
  return (units / font.unitsPerEm) * size + spacing * chars.length;
}

const nameFont = readFont(SEMIBOLD);
const locationFont = readFont(MEDIUM);
const pillColumn = stripPillTextColumn(shellGeometry(349, 621, { top: 24, bottom: 16 }).touchTargets.stripPill.width);

describe("the v2 single-line model pill copy", () => {
  it("uses the bodyStrong role for the model name", () => {
    expect(type.bodyStrong).toMatchObject({ fontFamily: "Inter_600SemiBold", fontSize: 15, lineHeight: 21 });
  });

  it("measures the model's short name against the available text column", () => {
    const width = textWidth("LFM2.5 2.6B", nameFont, type.bodyStrong.fontSize, -0.1);
    expect(width).toBeGreaterThan(80);
    expect(width).toBeLessThanOrEqual(pillColumn);
  });

  it.each(["Locale", "Kalsa Brain"])("fits the short location label %s beside the model name", (label) => {
    expect(textWidth(label, locationFont, 11.5)).toBeLessThan(pillColumn);
  });

  it("does not budget the removed full-sentence status line", () => {
    const fullSentence = "Su questo telefono";
    expect(textWidth(fullSentence, locationFont, 12)).toBeGreaterThan(textWidth("Locale", locationFont, 11.5));
    expect(pillColumn).toBeGreaterThanOrEqual(100);
  });

  it("keeps the pill text readable without relying on a numeric font weight", () => {
    expect((type.bodyStrong as { fontWeight?: unknown }).fontWeight).toBeUndefined();
    expect(type.bodyStrong.fontFamily).toBe(nameFont ? "Inter_600SemiBold" : "");
  });
});
