/**
 * The transcript's jump control, after a vision audit found it doing damage.
 *
 * The audit looked at `mock/shell-jelly-621.png` and reported that the control —
 * a white pill about 131 x 48 dp, with a down arrow and the words "Go to the
 * end" in it — floated over the transcript and hid the reader's own word
 * "trust?" behind it. Any control that floats over a scroll view covers
 * something, so the fix is not to float it elsewhere but to cover as little as
 * possible: a 48 dp round icon in the bottom-right corner, named only by its
 * accessible label. The label was what made it 131 dp wide.
 *
 * This is a source check and not a rendered one, for the reason DESIGN.md's
 * proof regime gives: jest runs on `node` with `.ts` only and there is no render
 * harness, so a style object cannot be imported and asserted. What it locks is
 * the two things that actually went wrong — the box, and the visible label.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { modes } from "../../theme/design";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

const PARTS = read("TranscriptParts.tsx");
const TRANSCRIPT = read("Transcript.tsx");

/** Comments removed, so the prose about the fix cannot satisfy the checks. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** One style object's body, by brace counting, so indentation cannot matter. */
function styleBody(source: string, name: string): string {
  const start = source.indexOf(`${name}: {`);
  if (start < 0) throw new Error(`no style named ${name}`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  throw new Error(`unclosed style ${name}`);
}

/** The JSX of the jump control, from its testID to the element that closes it. */
function jumpBlock(source: string): string {
  const start = source.indexOf('testID="transcript.jumpToEnd"');
  if (start < 0) throw new Error("the jump control is gone");
  const end = source.indexOf("</Pressable>", start);
  if (end < 0) throw new Error("the jump control has no closing tag");
  return source.slice(start, end);
}

/** The pill is a real 48 dp box on both axes and has no room for a label. */
function boxIsSquareAndTight(body: string): boolean {
  const height = /height:\s*MIN_TOUCH_TARGET/.test(body);
  const width = /width:\s*MIN_TOUCH_TARGET/.test(body);
  const noLabelRoom = !/paddingHorizontal|flexDirection/.test(body);
  return height && width && noLabelRoom;
}

/** No visible text inside the control: the accessible name is all of it. */
function hasNoVisibleLabel(block: string): boolean {
  return !/<Text/.test(block) && !/jumpLabel/.test(block);
}

/**
 * The accessible name is the control's only name now, so it has to be there.
 * It sits on the `Pressable` above the `testID`, which is why this reads the
 * file rather than the slice from the `testID` down.
 */
function namesTheControl(source: string): boolean {
  return source.includes('accessibilityLabel={t("shell.a11y.jumpToEnd")}');
}

/** WCAG 2.1 contrast, the same formula `design.test.ts` runs on the palette. */
function contrast(a: string, b: string): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = (hex: string): number => {
    const parts = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return (
      0.2126 * channel(parts[0]!) +
      0.7152 * channel(parts[1]!) +
      0.0722 * channel(parts[2]!)
    );
  };
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

describe("the jump control's boundary", () => {
  it("rings the circle with the token that reaches 3:1, elevation kept", () => {
    const body = styleBody(stripComments(PARTS), "jump");
    expect(body).toMatch(/borderColor:\s*colors\.silence\b/);
    expect(body).toMatch(/borderWidth:\s*1\b/);
    // The ring is the boundary; the lift is still the surface's (§1.2).
    expect(body).toContain("elevation.raised");
  });

  it("measures the ring at 3:1 against the page AND the control's own fill, both modes", () => {
    // §1.2 forbids a border telling a SURFACE from the page (white on the page
    // is 1.07:1); this ring's job is different — it says "control", and the
    // number for a UI component's boundary is WCAG 2.2 SC 1.4.11 (non-text
    // contrast): 3:1 against adjacent colours. A requirement, not taste.
    //
    // BEFORE (2026-09-21, `colors.borderStrong`): light 1.53:1 page / 1.64:1
    // fill, dark 2.09 / 1.88 — below 3:1 everywhere, and a vision audit could
    // not trace the ring. AFTER (`colors.silence`): light 5.97 / 6.41, dark
    // 7.12 / 6.40. `colors.inkSoft` also clears the bar (11.67 / 12.52 light,
    // 11.35 / 10.19 dark) but at 11–13:1 reads as a hard frame rather than a
    // control edge; silence is the quieter passing token.
    for (const [mode, c] of Object.entries(modes)) {
      const vsPage = contrast(c.silence, c.page);
      const vsFill = contrast(c.silence, c.surface);
      expect([mode, "page", vsPage >= 3]).toEqual([mode, "page", true]);
      expect([mode, "fill", vsFill >= 3]).toEqual([mode, "fill", true]);
    }
  });
});

describe("the jump control covers as little as it can", () => {
  const body = styleBody(stripComments(PARTS), "jump");
  const block = jumpBlock(stripComments(TRANSCRIPT));

  it("reads the two files it claims to read", () => {
    expect(PARTS).toContain("createTranscriptStyles");
    expect(TRANSCRIPT).toContain("export function Transcript");
    // Both slices are non-empty, so neither brace counter nor the marker search
    // can pass vacuously.
    expect(body.length).toBeGreaterThan(0);
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain("ArrowDown");
  });

  it("keeps the control a 48 dp box on both axes", () => {
    expect(boxIsSquareAndTight(body)).toBe(true);
  });

  it("draws no visible label in it, and keeps the accessible name", () => {
    expect(hasNoVisibleLabel(block)).toBe(true);
    expect(namesTheControl(stripComments(TRANSCRIPT))).toBe(true);
    // The style the label used is gone, so a re-added label cannot lean on it.
    expect(stripComments(PARTS)).not.toContain("jumpLabel");
  });

  it("would catch the pill coming back", () => {
    expect(boxIsSquareAndTight("minHeight: MIN_TOUCH_TARGET, paddingHorizontal: 14")).toBe(false);
    expect(boxIsSquareAndTight("height: MIN_TOUCH_TARGET")).toBe(false);
    const labelled =
      'testID="transcript.jumpToEnd"><Text style={styles.jumpLabel}>{label}</Text></Pressable>';
    expect(hasNoVisibleLabel(labelled)).toBe(false);
    expect(namesTheControl("accessibilityRole=\"button\" testID=\"transcript.jumpToEnd\"")).toBe(
      false,
    );
  });
});
