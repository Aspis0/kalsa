import { cleanModelName } from "./pairingModelName";

describe("cleanModelName", () => {
  test("keeps a marketing name as it is, trimmed at both ends", () => {
    expect(cleanModelName("  iPhone 15 Pro Max  ")).toBe("iPhone 15 Pro Max");
    expect(cleanModelName("Pixel 8")).toBe("Pixel 8");
  });

  test("drops what nobody can see, the way the desk drops it from a name", () => {
    expect(cleanModelName("iPhone​ 15\n Pro")).toBe("iPhone 15 Pro");
    expect(cleanModelName("Pixel‮ 8\u0000")).toBe("Pixel 8");
    // A tag character, a private-use character and an unassigned one.
    expect(cleanModelName("Pixel\u{E0020} 8\u{E000}\u{10FFFF}")).toBe("Pixel 8");
  });

  test("cuts to forty characters, counting code points, never half of one", () => {
    const cut = cleanModelName(`Pixel 8 ${"🙂".repeat(50)}`);
    expect(cut).toBeDefined();
    expect(Array.from(cut ?? "")).toHaveLength(40);
  });

  test("refuses a model code, which is not a name a person can recognise", () => {
    expect(cleanModelName("SM-S911B")).toBeUndefined();
    expect(cleanModelName("2201123G")).toBeUndefined();
  });

  test("refuses what is blank or not text at all", () => {
    expect(cleanModelName("   ")).toBeUndefined();
    expect(cleanModelName("​​")).toBeUndefined();
    expect(cleanModelName("")).toBeUndefined();
    expect(cleanModelName(null)).toBeUndefined();
    expect(cleanModelName(undefined)).toBeUndefined();
  });
});
