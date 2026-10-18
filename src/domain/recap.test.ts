import { MAX_RECAP_BYTES, normalizeRecap } from "./recap";

describe("the recap line the phone may draw", () => {
  test("a line of text is kept as it is", () => {
    expect(normalizeRecap("Kalsa ha: aperto httpbin.org · scritto in 3 campi")).toBe(
      "Kalsa ha: aperto httpbin.org · scritto in 3 campi",
    );
  });

  test("control and format characters are removed, and nothing else is changed", () => {
    expect(normalizeRecap("a\u0000b‮c⁦d⁩")).toBe("a b c d");
  });

  test("a line with no text left, or no string at all, is no line", () => {
    expect(normalizeRecap("  ​\u0000 ")).toBeNull();
    expect(normalizeRecap(7)).toBeNull();
    expect(normalizeRecap(undefined)).toBeNull();
  });

  test("the cap is 500 UTF-8 bytes, and a larger line is dropped, not cut", () => {
    expect(MAX_RECAP_BYTES).toBe(500);
    expect(normalizeRecap("a".repeat(MAX_RECAP_BYTES))).toHaveLength(MAX_RECAP_BYTES);
    expect(normalizeRecap("a".repeat(MAX_RECAP_BYTES + 1))).toBeNull();
    // Two bytes a letter: half as many letters reach the same cap.
    expect(normalizeRecap("é".repeat(MAX_RECAP_BYTES / 2 + 1))).toBeNull();
  });
});
