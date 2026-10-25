/**
 * The chip's touch box (DESIGN.md §2.5): the painted chip stays the mock's small
 * pill, and the box the finger lands on is a real 48 dp on both axes.
 *
 * Two proofs, because neither one is enough alone. The arithmetic lives in
 * `shellGeometry.ts` and is asserted against the **literal** 48, so lowering
 * the project's floor does not quietly lower the chip's box with it. The second
 * is a source check: read the two files, strip the comments, and fail if the
 * box stops being worn by the chip nodes or stops being bound to the constant.
 * A constant that nothing renders is a decoration; a rendered box that drifted
 * off the constant is the defect this pair exists to catch. Each predicate is
 * tested against a sample that must fail it.
 */
import { readFileSync } from "fs";
import { join } from "path";

import * as design from "../../theme/design";
import {
  MIN_TOUCH_TARGET,
  SOURCE_CHIP_BOX_COST,
  SOURCE_CHIP_PAINTED_HEIGHT,
  SOURCE_CHIP_TOUCH_BOX,
} from "./shellGeometry";

const read = (file: string): string => readFileSync(join(__dirname, file), "utf8");

/** The two files that together decide how big a chip is. */
const EVIDENCE = read("TranscriptEvidence.tsx");
const PARTS = read("TranscriptParts.tsx");

/** Comments removed before matching, so the prose about the rule cannot trip it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

/** One style object's body, by brace counting, so nothing about indentation matters. */
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

/** Both chip nodes wear the box, and the paint is a separate node inside it. */
function chipsWearTheBox(evidence: string): boolean {
  const wearers = evidence.match(/style=\{styles\.sourceChipBox\}/g) ?? [];
  const painted = evidence.match(/styles\.sourceChip,/g) ?? [];
  return wearers.length === 2 && painted.length === 1 && evidence.includes("const pill = (");
}

/** The box is the constant, on both axes, and never the paint's own height. */
function boxIsTheConstant(body: string): boolean {
  const axes = body.match(/(minHeight|minWidth):\s*([A-Za-z_]+)/g) ?? [];
  return (
    axes.length === 2 &&
    axes.every((axis) => axis.endsWith("SOURCE_CHIP_TOUCH_BOX")) &&
    !body.includes("SOURCE_CHIP_PAINTED_HEIGHT")
  );
}

/** The paint did not grow into the box: the two sizes stay two things. */
function paintIsNotTheBox(body: string): boolean {
  return !/minHeight|minWidth/.test(body) && !/\b48\b/.test(body);
}

describe("the chip's box against the floor (§2.5)", () => {
  it("is at least the literal 48 dp, and fails here if it shrinks", () => {
    // The literal, NOT `MIN_TOUCH_TARGET`: the box is an alias of the floor, so a
    // test written against the alias would follow the floor down and still pass.
    expect(SOURCE_CHIP_TOUCH_BOX).toBeGreaterThanOrEqual(48);
    expect(MIN_TOUCH_TARGET).toBeGreaterThanOrEqual(48);
  });

  it("keeps the painted chip smaller than the box and names what the box costs", () => {
    expect(SOURCE_CHIP_PAINTED_HEIGHT).toBeGreaterThan(0);
    expect(SOURCE_CHIP_PAINTED_HEIGHT).toBeLessThan(SOURCE_CHIP_TOUCH_BOX);
    expect(SOURCE_CHIP_BOX_COST).toBe(SOURCE_CHIP_TOUCH_BOX - SOURCE_CHIP_PAINTED_HEIGHT);
    // The number the design accepts per row of chips, written down: 20 dp.
    expect(SOURCE_CHIP_BOX_COST).toBe(20);
  });

  it("derives the paint from the same two tokens the stylesheet pads with", () => {
    // Not a second copy of 28: the meta line inside `spacing.xs` above and below.
    expect(SOURCE_CHIP_PAINTED_HEIGHT).toBe(design.type.meta.lineHeight + 2 * design.spacing.xs);
  });
});

describe("and the component actually wears it", () => {
  const box = styleBody(stripComments(PARTS), "sourceChipBox");
  const paint = styleBody(stripComments(PARTS), "sourceChip");

  it("reads the files it claims to read", () => {
    expect(EVIDENCE).toContain("export function SourceChips");
    expect(PARTS).toContain("StyleSheet.create");
    // The style bodies are non-empty, so the brace counter cannot pass vacuously.
    expect(box.length).toBeGreaterThan(0);
    expect(paint.length).toBeGreaterThan(0);
  });

  it("binds both axes of the box to the constant, and the paint to neither", () => {
    expect(boxIsTheConstant(box)).toBe(true);
    expect(paintIsNotTheBox(paint)).toBe(true);
  });

  it("gives that box to the pressable chip and to the static one", () => {
    expect(chipsWearTheBox(stripComments(EVIDENCE))).toBe(true);
  });

  it("would catch each way of undoing it", () => {
    // A box shrunk to the paint, a paint that grew into the box, and a chip node
    // that went back to being the painted pill — one sample per predicate.
    expect(boxIsTheConstant("minHeight: SOURCE_CHIP_PAINTED_HEIGHT, minWidth: 48")).toBe(false);
    expect(boxIsTheConstant("minHeight: SOURCE_CHIP_TOUCH_BOX")).toBe(false);
    expect(paintIsNotTheBox("minHeight: SOURCE_CHIP_TOUCH_BOX")).toBe(false);
    expect(paintIsNotTheBox("paddingVertical: 48")).toBe(false);
    const unwrapped = 'const pill = (<View />); <Pressable style={[styles.sourceChip, styles.sourceChipLink]} />';
    expect(chipsWearTheBox(unwrapped)).toBe(false);
  });
});
