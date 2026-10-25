import {
  kvBytesPerElement,
  kvBytesPerTokenAtProfile,
  modelAtKvProfile,
} from "./kvQuantCost";

describe("kvBytesPerTokenAtProfile", () => {
  test("leaves the catalog number alone at the profile it was derived at", () => {
    expect(kvBytesPerTokenAtProfile(6656, "q8_0", "q4_0")).toBe(6656);
    expect(kvBytesPerTokenAtProfile(13312, "q8_0", "q4_0")).toBe(13312);
  });

  test("q8_0/q8_0 lands on the integer element counts, not a fraction", () => {
    // LFM 6656 → 4096 elements/token/side; Qwen 13312 → 8192. At q8_0/q8_0
    // both sides cost 2.125 bytes/element, so the results are exact integers.
    expect(kvBytesPerTokenAtProfile(6656, "q8_0", "q8_0")).toBe(8704);
    expect(kvBytesPerTokenAtProfile(13312, "q8_0", "q8_0")).toBe(17408);
  });

  test("an f16 cache costs 2 bytes per element per side", () => {
    // 4096 elements x (2 + 2) bytes.
    expect(kvBytesPerTokenAtProfile(6656, "f16", "f16")).toBe(16384);
  });

  test("refuses an unknown quant or an unusable input instead of guessing", () => {
    expect(kvBytesPerElement("q8_0")).toBeCloseTo(34 / 32);
    expect(kvBytesPerElement("q4_0")).toBeCloseTo(18 / 32);
    expect(kvBytesPerElement("q9_9")).toBeNull();
    expect(kvBytesPerTokenAtProfile(6656, "q9_9", "q4_0")).toBeNull();
    expect(kvBytesPerTokenAtProfile(0, "q8_0", "q8_0")).toBeNull();
    expect(kvBytesPerTokenAtProfile(undefined, "q8_0", "q8_0")).toBeNull();
    expect(kvBytesPerTokenAtProfile(Number.NaN, "q8_0", "q8_0")).toBeNull();
  });

  test("modelAtKvProfile re-prices a catalog entry and passes through an unpriceable one", () => {
    const model = { id: "x", kvBytesPerToken: 6656 };
    expect(modelAtKvProfile(model, "q8_0", "q8_0")).toEqual({
      id: "x",
      kvBytesPerToken: 8704,
    });
    const noKv = { id: "y", kvBytesPerToken: undefined };
    expect(modelAtKvProfile(noKv, "q8_0", "q8_0")).toBe(noKv);
  });
});
