/**
 * The transcript band's edge fades: both edges present, page-coloured, inert,
 * and painted under the jump control.
 *
 * The element exists because a vision audit found the band's two clip edges
 * slicing content mid-glyph in the ordinary resting state — a citation chip cut
 * in half by the top edge, a heading chopped by the composer's top edge at the
 * bottom — and called the halved chip the worst visual defect of the set. The
 * owner did not ask for the fade and may reverse it; what this test pins is
 * that IF it exists it cannot become a touch-catcher, an accessibility node or
 * a black-smudging gradient, and that it keeps the z-order the jump control's
 * new ring depends on.
 *
 * A SOURCE check, the technique `transcriptMarkdownSource.test.ts` and
 * `shellLogoAsset.test.ts` use: jest runs on `node` with `.ts` only and there
 * is no render harness (DESIGN.md, "proof regime"), so a gradient is read as
 * source. Comments are stripped before matching so the prose about the rules
 * cannot satisfy them, and every predicate is exercised against a sample that
 * must fail it, so a guard that quietly stopped matching cannot pass as green.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { TRANSCRIPT_LAST_ITEM_GAP } from "./transcriptLayout";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

const FADE = read("TranscriptEdgeFade.tsx");
const TRANSCRIPT = read("Transcript.tsx");
const PACKAGE = readFileSync(join(__dirname, "../../../package.json"), "utf8");

/** Comments removed, so the header explaining the fade is not also the proof
 *  that the fade is inert. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** Every `<LinearGradient ... />` element's JSX, self-close included. */
function gradientBlocks(source: string): string[] {
  const blocks: string[] = [];
  let from = source.indexOf("<LinearGradient");
  while (from >= 0) {
    const end = source.indexOf("/>", from);
    if (end < 0) break;
    blocks.push(source.slice(from, end + 2));
    from = source.indexOf("<LinearGradient", end + 2);
  }
  return blocks;
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

/** Exactly one gradient per edge, both anchored inside the band's own box. */
function drawsBothEdges(code: string): boolean {
  const blocks = gradientBlocks(code);
  if (blocks.length !== 2) return false;
  const topBlock = blocks.find((block) => block.includes("styles.top"));
  const bottomBlock = blocks.find((block) => block.includes("styles.bottom"));
  if (topBlock === undefined || bottomBlock === undefined) return false;
  if (!blocks.every((block) => block.includes("styles.edge"))) return false;
  const edge = styleBody(code, "edge");
  const top = styleBody(code, "top");
  const bottom = styleBody(code, "bottom");
  return (
    /height:\s*EDGE_FADE_HEIGHT/.test(edge) &&
    /position:\s*"absolute"/.test(edge) &&
    /left:\s*0/.test(edge) &&
    /right:\s*0/.test(edge) &&
    /top:\s*0\b/.test(top) &&
    /bottom:\s*0\b/.test(bottom)
  );
}

/** Paint, not a control: it takes no touches, announces nothing, is not found
 *  by a test id — decorative gradients get no catalogue string and no node. */
function isInert(block: string): boolean {
  return (
    block.includes('pointerEvents="none"') &&
    block.includes('importantForAccessibility="no"') &&
    !/onPress|onStartShouldSetResponder|onTouch|accessible=\{true\}|accessibility(Role|Label)|testID/.test(
      block,
    )
  );
}

function hasNoTestIds(code: string): boolean {
  return !/testID/.test(code);
}

/** The ramp runs from the mode's own page colour to that same colour at zero
 *  alpha — never `"transparent"`, which is rgba(0,0,0,0) and interpolates the
 *  gradient through black across a green page. */
function fadesIntoThePageColour(code: string): boolean {
  const blocks = gradientBlocks(code);
  if (blocks.length !== 2) return false;
  const opaqueAtTop = blocks.some((block) => block.includes("colors={[colors.page, clear]}"));
  const opaqueAtBottom = blocks.some((block) => block.includes("colors={[clear, colors.page]}"));
  return (
    opaqueAtTop &&
    opaqueAtBottom &&
    code.includes("${colors.page}00") &&
    !/"transparent"/.test(code) &&
    code.includes('from "expo-linear-gradient"')
  );
}

/** Document order is paint order: after the ScrollView (over the content it
 *  dissolves), before the jump control (under the control and its ring). */
function paintsUnderTheJumpControl(code: string): boolean {
  const scrollEnd = code.indexOf("</ScrollView>");
  const fade = code.indexOf("<TranscriptEdgeFade");
  const jump = code.indexOf('testID="transcript.jumpToEnd"');
  return scrollEnd >= 0 && fade > scrollEnd && jump > fade;
}

/** The top ramp is opaque at the edge it protects, so it may only draw while
 *  content has actually scrolled under that edge — a short conversation starts
 *  flush at the top with no gap above it. */
function topFadeIsGated(fadeCode: string, transcriptCode: string): boolean {
  return (
    /topClipped\s*\?/.test(fadeCode) &&
    transcriptCode.includes("topClipped={topClipped}") &&
    transcriptCode.includes("setTopClipped(") &&
    /offsetRef\.current > 0/.test(transcriptCode)
  );
}

describe("the transcript band's edge fades", () => {
  const fade = stripComments(FADE);
  const transcript = stripComments(TRANSCRIPT);

  it("reads the files it claims to read", () => {
    expect(FADE).toContain("export function TranscriptEdgeFade");
    expect(TRANSCRIPT).toContain("export function Transcript");
    // Non-vacuous: the extracted blocks are the gradients', not stray JSX.
    expect(gradientBlocks(fade)).toHaveLength(2);
    expect(styleBody(fade, "edge").length).toBeGreaterThan(0);
  });

  it("draws one fade at each edge, at the band's own resting clearance", () => {
    expect(drawsBothEdges(fade)).toBe(true);
    // The height is CHOSEN, and chosen as a pair: 24 dp is the gap the layout
    // already keeps empty under the last item, so at rest the bottom ramp
    // veils empty page. Moving one number without the other breaks that.
    const declared = /export const EDGE_FADE_HEIGHT = (\d+);/.exec(fade);
    expect(declared).not.toBeNull();
    expect(Number(declared![1])).toBe(TRANSCRIPT_LAST_ITEM_GAP);
  });

  it("is inert and silent: no touches, no accessibility node, no testID", () => {
    for (const block of gradientBlocks(fade)) {
      expect(isInert(block)).toBe(true);
    }
    expect(hasNoTestIds(fade)).toBe(true);
  });

  it("fades into the current mode's page colour, never through black, and adds no dependency", () => {
    expect(fadesIntoThePageColour(fade)).toBe(true);
    // The gradient package must already be a dependency of the app — a band
    // file may not silently introduce one.
    expect(PACKAGE).toMatch(/"expo-linear-gradient":\s*"~/);
  });

  it("paints over the content and under the jump control", () => {
    expect(paintsUnderTheJumpControl(transcript)).toBe(true);
  });

  it("draws the top fade only while content is under the top edge", () => {
    expect(topFadeIsGated(fade, transcript)).toBe(true);
  });
});

describe("would catch a fade that broke one of those rules", () => {
  const fade = stripComments(FADE);
  const transcript = stripComments(TRANSCRIPT);

  it("would catch a fade missing one edge, or anchored wrong", () => {
    expect(
      drawsBothEdges('<LinearGradient colors={[colors.page, clear]} style={[styles.edge, styles.top]} />'),
    ).toBe(false);
    expect(
      drawsBothEdges(
        "styleBody decoy\n" +
          '<LinearGradient style={[styles.edge, styles.top]} />\n' +
          '<LinearGradient style={[styles.edge, styles.top]} />',
      ),
    ).toBe(false);
  });

  it("would catch an interactive, announced or found fade", () => {
    expect(
      isInert(
        '<LinearGradient pointerEvents="none" importantForAccessibility="no" onPress={f} style={[styles.edge, styles.top]} />',
      ),
    ).toBe(false);
    expect(
      isInert(
        '<LinearGradient pointerEvents="none" importantForAccessibility="no" accessibilityLabel="fade" style={[styles.edge, styles.top]} />',
      ),
    ).toBe(false);
    expect(
      isInert('<LinearGradient importantForAccessibility="no" style={[styles.edge, styles.top]} />'),
    ).toBe(false);
    expect(hasNoTestIds('const x = { testID: "fade" };')).toBe(false);
  });

  it("would catch a ramp that fades through black", () => {
    expect(
      fadesIntoThePageColour(
        'const clear = "transparent";\n' +
          '<LinearGradient colors={[colors.page, clear]} style={[styles.edge, styles.top]} />\n' +
          '<LinearGradient colors={[clear, colors.page]} style={[styles.edge, styles.bottom]} />',
      ),
    ).toBe(false);
  });

  it("would catch a fade painted over the jump control, or not under the ScrollView", () => {
    expect(
      paintsUnderTheJumpControl(
        'testID="transcript.jumpToEnd" </ScrollView> <TranscriptEdgeFade />',
      ),
    ).toBe(false);
    expect(
      paintsUnderTheJumpControl('<TranscriptEdgeFade /> <Pressable testID="transcript.jumpToEnd">'),
    ).toBe(false);
  });

  it("would catch an ungated top fade", () => {
    expect(topFadeIsGated(fade, "const topClipped = true;")).toBe(false);
    expect(
      topFadeIsGated(fade, "topClipped={topClipped} setTopClipped((was) => was) offsetRef.current > 0"),
    ).toBe(true);
    expect(topFadeIsGated("<LinearGradient />", transcript)).toBe(false);
  });
});
