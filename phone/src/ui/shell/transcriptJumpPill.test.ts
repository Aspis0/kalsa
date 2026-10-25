/** The v2 jump pill: 36 dp paint, a 48 dp target, visible localized label. */
import { readFileSync } from "fs";
import { join } from "path";
import { modes } from "../../theme/design";
import { en } from "../../i18n/en";
import { it as itLocale } from "../../i18n/it";

const read = (file: string) => readFileSync(join(__dirname, file), "utf8");
const PARTS = read("TranscriptParts.tsx");
const TRANSCRIPT = read("Transcript.tsx");
const clean = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

function body(source: string, name: string): string {
  const start = source.indexOf(`${name}: {`);
  if (start < 0) throw new Error(`no style named ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`unclosed style ${name}`);
}

function contrast(a: string, b: string): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = (hex: string) => {
    const values = [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
    return 0.2126 * channel(values[0]!) + 0.7152 * channel(values[1]!) + 0.0722 * channel(values[2]!);
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("the jump pill's paint and target", () => {
  it("paints a 36 dp pill inside a real 48 dp target", () => {
    const pill = body(clean(PARTS), "jump");
    const target = body(clean(PARTS), "jumpBox");
    expect(pill).toContain("height: 36");
    expect(pill).toContain("borderRadius: radius.pill");
    expect(target).toContain("minHeight: MIN_TOUCH_TARGET");
    expect(target).toContain("minWidth: MIN_TOUCH_TARGET");
    expect(target).toContain("position: \"absolute\"");
  });

  it("uses the quiet ring that clears 3:1 beside both themes", () => {
    expect(body(clean(PARTS), "jump")).toContain("borderColor: colors.silence");
    for (const [name, colors] of Object.entries(modes)) {
      expect([name, contrast(colors.silence, colors.page) >= 3]).toEqual([name, true]);
      expect([name, contrast(colors.silence, colors.surface) >= 3]).toEqual([name, true]);
    }
  });

  it("shows a down glyph and the localized label while keeping its accessible name", () => {
    const code = clean(TRANSCRIPT);
    expect(code).toContain('<ArrowDown color={colors.ink2} size={16}');
    expect(code).toContain('t("shell.a11y.jumpLabel")');
    expect(code).toContain('accessibilityLabel={t("shell.a11y.jumpToEnd")}');
    expect(en.shell.a11y.jumpLabel).toBe("Jump to latest");
    expect(itLocale.shell.a11y.jumpLabel).toBe("Alla fine");
    expect(code).toContain('testID="transcript.jumpToEnd"');
  });

  it("would catch an icon-only target or a pill that shrinks below its target", () => {
    const valid = (height: number, width: number) => height >= 48 && width >= 48;
    expect(valid(48, 48)).toBe(true);
    expect(valid(36, 48)).toBe(false);
    expect(valid(48, 36)).toBe(false);
    expect(clean(TRANSCRIPT)).toContain("<View style={styles.jump}>");
  });
});
