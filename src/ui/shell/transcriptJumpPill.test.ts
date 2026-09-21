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
