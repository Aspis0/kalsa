/**
 * The type layer, checked against the loader rather than against itself.
 *
 * Step 1 changed the faces and the scale and shipped without a test; two
 * defects escaped it — a role naming a family the boot gate never loads, and an
 * italic role pointing into another family's serif. `design.test.ts` could not
 * catch either, because it treats design.ts's own `families` object as "the
 * loaded set". This file reads `LOADED_FACES`, the list `fonts.ts` types its
 * loader against, and `baseTypeScale`, the actual role objects.
 *
 * A face that is loaded but named by no role (Inter_700Bold is one such) is
 * deliberately not asserted about: this test pins only what is referenced,
 * never that everything loaded is used.
 */
import { families as designFamilies } from "./design";
import { LOADED_FACES, baseTypeScale, typeFaces } from "./typeData";

const loaded = new Set<string>(LOADED_FACES);

/** "Inter_400Regular_Italic" -> "Inter": the family is the stem before the first "_". */
function familyOf(face: string): string {
  const stop = face.indexOf("_");
  return stop === -1 ? face : face.slice(0, stop);
}

/** A required text size, so a missing property is a type error, not a pass. */
function sizeOf(role: string, axis: "fontSize" | "lineHeight"): number {
  const value = baseTypeScale[role][axis];
  if (typeof value !== "number") throw new Error(`${role} has no ${axis}`);
  return value;
}

describe("the faces the roles name", () => {
  it("are all loaded by fonts.ts", () => {
    const referenced = new Set<string>([
      ...Object.values(typeFaces),
      ...Object.values(designFamilies),
    ]);
    for (const face of referenced) {
      expect([face, loaded.has(face)]).toEqual([face, true]);
    }
  });

  it("are loaded role by role, from the actual scale objects", () => {
    for (const [role, style] of Object.entries(baseTypeScale)) {
      const face = style.fontFamily as string | undefined;
      expect([role, typeof face === "string" && loaded.has(face)]).toEqual([role, true]);
    }
  });
});

describe("the italic roles", () => {
  it("stay inside their upright counterpart's family", () => {
    const pairs: Array<[string, string, string]> = [
      ["bodyItalic", typeFaces.bodyItalic, typeFaces.body],
      ["sansItalic", designFamilies.sansItalic, designFamilies.sans],
      ["displayItalic", designFamilies.displayItalic, designFamilies.display],
    ];
    for (const [role, italic, upright] of pairs) {
      expect([role, familyOf(italic)]).toEqual([role, familyOf(upright)]);
    }
  });
});

describe("the type scale", () => {
  const ladder = ["bodyXs", "label", "bodySm", "bodyMd", "bodyLg", "chatBody"];

  it("never increases as it descends, on both axes", () => {
    for (let i = 1; i < ladder.length; i += 1) {
      const above = ladder[i - 1];
      const below = ladder[i];
      expect([above, below, sizeOf(above, "fontSize") <= sizeOf(below, "fontSize")]).toEqual([above, below, true]);
      expect([above, below, sizeOf(above, "lineHeight") <= sizeOf(below, "lineHeight")]).toEqual([above, below, true]);
    }
  });

  it("keeps the mono pair ordered", () => {
    expect(sizeOf("monoXs", "fontSize")).toBeLessThanOrEqual(sizeOf("monoSm", "fontSize"));
    expect(sizeOf("monoXs", "lineHeight")).toBeLessThanOrEqual(sizeOf("monoSm", "lineHeight"));
  });

  it("gives every role more leading than type size", () => {
    for (const role of Object.keys(baseTypeScale)) {
      expect([role, sizeOf(role, "lineHeight") > sizeOf(role, "fontSize")]).toEqual([role, true]);
    }
  });

  it("never pairs a custom face with a numeric weight", () => {
    // The Android trap: a numeric weight beside a custom family is ignored on
    // device, so the two platforms silently disagree.
    for (const [role, style] of Object.entries(baseTypeScale)) {
      expect([role, (style as { fontWeight?: unknown }).fontWeight]).toEqual([role, undefined]);
    }
  });
});
