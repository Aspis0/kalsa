/**
 * The three claims step 3b makes about its renderer that a screenshot cannot
 * prove and that this jest stack cannot render:
 *
 * 1. **The table's structure follows the pure decision.** `tableScrollDecision`
 *    is the only thing allowed to decide whether a table scrolls, and when it
 *    says the table does not fit, the inner table is pinned to the decision's own
 *    `requiredWidth`. If the renderer invented its own threshold, the arithmetic
 *    in `transcriptLayout.ts` would be decoration.
 * 2. **A cell never shrinks below the readable minimum.** The cell style's
 *    `minWidth` is `TABLE_MIN_COLUMN_WIDTH` (97 dp of content plus two 10 dp
 *    paddings), which is what makes "a three-column table scrolls instead of
 *    being cut" true on the device rather than only in the constant.
 * 3. **The answer stays in the reading face.** Bold and italic take
 *    SourceSerif4's own semibold and italic, and the code block is mono. Step 1
 *    found the opposite defect in the old type layer — a body whose italic jumped
 *    to another family's serif — and this is where that family jump would come
 *    back. The check also fails on a numeric `fontWeight` in any of these files,
 *    because Android ignores one beside a custom family.
 *
 * A SOURCE check, the technique `transcriptNoFetch.test.ts` and
 * `sourceChipBox.test.ts` already use: read the files, strip the comments, and
 * match the wiring. Every predicate is exercised against a sample that must fail
 * it, so a check that quietly stopped matching cannot pass as green.
 */
import { readFileSync } from "fs";
import { join } from "path";

import {
  TABLE_CELL_PADDING,
  TABLE_MIN_CELL_CONTENT,
  TABLE_MIN_COLUMN_WIDTH,
  tableScrollDecision,
} from "./transcriptLayout";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

const MARKDOWN = read("TranscriptMarkdown.tsx");
const INLINE = read("TranscriptInline.tsx");
const STYLES = read("transcriptMarkdownStyles.ts");

/** Comments removed, so the prose about a rule cannot be mistaken for the rule. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** One style object's body, by brace counting, so indentation cannot matter. */
function styleBody(source: string, name: string): string {
  const body = styleBodyOrNull(source, name);
  if (body === null) throw new Error(`no style named ${name}`);
  return body;
}

function styleBodyOrNull(source: string, name: string): string | null {
  const start = source.indexOf(`${name}: {`);
  if (start < 0) return null;
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, index);
    }
  }
  return null;
}

/** The decision is called, and BOTH of its outputs are used. */
function tableFollowsTheDecision(source: string): boolean {
  return (
    source.includes("tableScrollDecision(") &&
    source.includes("decision.scrolls") &&
    source.includes("minWidth: decision.requiredWidth")
  );
}

/** The scroll view is built only when the decision says the table does not fit. */
function scrollViewIsGatedOnTheDecision(source: string): boolean {
  return /\{?\s*if \(!decision\.scrolls\)/.test(source) && /<ScrollView[\s\S]{0,200}horizontal/.test(source);
}

/** The cell's own minimum is the constant, on the width axis, exactly once. */
function cellHoldsTheMinimum(source: string): boolean {
  const body = styleBody(stripComments(source), "tableCell");
  const minimums = body.match(/minWidth:\s*([A-Za-z_]+)/g) ?? [];
  return (
    minimums.length === 1 &&
    minimums[0]!.endsWith("TABLE_MIN_COLUMN_WIDTH") &&
    !/minWidth:\s*\d/.test(body)
  );
}

/** No vertical rule on a cell: one would come out of the 97 dp of content. */
function cellHasNoVerticalRule(source: string): boolean {
  const body = styleBody(stripComments(source), "tableCell");
  return !/border(Left|Right|Start|End)/.test(body) && !/borderWidth/.test(body);
}

/** The code block is drawn in the mono face — either the family itself or the
 *  `type.mono` role, whose family IS that one. */
function codeIsMono(source: string): boolean {
  const body = styleBody(stripComments(source), "codeText");
  return body.includes("families.mono") || body.includes("type.mono");
}

/** Bold and italic come from the reading face, never from the sans family. */
function inlineWeightsStayInTheReadingFace(source: string): boolean {
  const body = stripComments(source);
  const bold = styleBodyOrNull(body, "inlineBold");
  const italic = styleBodyOrNull(body, "inlineItalic");
  if (bold === null || italic === null) return false;
  const sans = /families\.(sans|sansMedium|sansSemi|sansBold|sansItalic)\b/;
  return (
    bold.includes("families.display") &&
    !bold.includes("displayItalic") &&
    italic.includes("families.displayItalic") &&
    !sans.test(bold) &&
    !sans.test(italic)
  );
}

describe("the table follows the pure decision (§2.2)", () => {
  it("calls it, and uses both of its outputs", () => {
    expect(tableFollowsTheDecision(stripComments(MARKDOWN))).toBe(true);
  });

  it("gates the scroll view on the decision, never on its own threshold", () => {
    expect(scrollViewIsGatedOnTheDecision(stripComments(MARKDOWN))).toBe(true);
    expect(stripComments(MARKDOWN)).not.toMatch(/TABLE_MIN_COLUMN_WIDTH\s*\*/);
  });

  it("would catch a renderer that invented its own threshold", () => {
    expect(tableFollowsTheDecision("const fits = columns * 100 < width;")).toBe(false);
    expect(
      tableFollowsTheDecision("const d = tableScrollDecision(n, w); if (d.scrolls) {}"),
    ).toBe(false);
    expect(scrollViewIsGatedOnTheDecision("if (columns > 2) {")).toBe(false);
  });
});

describe("a cell keeps the readable minimum (§2.2, §1.1)", () => {
  it("binds the cell's minWidth to the constant, and to nothing numeric", () => {
    expect(cellHoldsTheMinimum(STYLES)).toBe(true);
    expect(cellHasNoVerticalRule(STYLES)).toBe(true);
  });

  it("is the width the decision and the design agree on: 97 + 2 x 10", () => {
    // The arithmetic that makes the two constants the same number, so a drift
    // between "the cell's minimum" and "what the decision requires" fails here.
    expect(TABLE_MIN_COLUMN_WIDTH).toBe(TABLE_MIN_CELL_CONTENT + 2 * TABLE_CELL_PADDING);
    // And the claim itself, on the measured viewport: three columns never fit.
    expect(tableScrollDecision(3, 321).scrolls).toBe(true);
    expect(tableScrollDecision(3, 321).requiredWidth).toBe(TABLE_MIN_COLUMN_WIDTH * 3);
  });

  it("would catch a cell that shrank itself or grew a rule", () => {
    expect(cellHoldsTheMinimum("tableCell: { flex: 1, minWidth: 90, padding: 10 }")).toBe(false);
    expect(cellHoldsTheMinimum("tableCell: { minWidth: TABLE_MIN_WIDTH }")).toBe(false);
    expect(cellHasNoVerticalRule("tableCell: { borderLeftWidth: 1 }")).toBe(false);
    expect(cellHasNoVerticalRule("tableCell: { borderWidth: 1 }")).toBe(false);
  });
});

describe("the answer stays in its own two faces", () => {
  it("draws code in mono and leaves the answer's weights in the reading face", () => {
    expect(codeIsMono(STYLES)).toBe(true);
    expect(inlineWeightsStayInTheReadingFace(STYLES)).toBe(true);
  });

  it("never sets a numeric fontWeight beside a custom family", () => {
    for (const file of [MARKDOWN, INLINE, STYLES]) {
      expect(stripComments(file)).not.toMatch(/fontWeight/);
    }
  });

  it("would catch an italic that jumped family, or a bold that borrowed sans", () => {
    expect(
      inlineWeightsStayInTheReadingFace("inlineBold: { fontFamily: families.sansSemi }"),
    ).toBe(false);
    expect(
      inlineWeightsStayInTheReadingFace(
        "inlineBold: { fontFamily: families.display }, inlineItalic: { fontFamily: families.sansItalic }",
      ),
    ).toBe(false);
    expect(codeIsMono("codeText: { fontFamily: families.reading }")).toBe(false);
  });
});
