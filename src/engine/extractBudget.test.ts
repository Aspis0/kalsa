import {
  EXTRACT_MEMORY_MIN_TIMEOUT_MS,
  extractTimeoutMs,
} from "./extractBudget";

describe("extractTimeoutMs", () => {
  test("uses the historical minimum without both speed measurements", () => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec: null,
        nPredict: 128,
        promptTokensEstimate: 1100,
        prefillTokPerSec: null,
      }),
    ).toBe(EXTRACT_MEMORY_MIN_TIMEOUT_MS);
  });

  test.each([
    ["NaN decode EMA", Number.NaN, 48],
    ["infinite prefill EMA", 10, Number.POSITIVE_INFINITY],
  ])("fails closed for %s", (_name, decodeTokPerSec, prefillTokPerSec) => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec,
        nPredict: 128,
        promptTokensEstimate: 1100,
        prefillTokPerSec,
      }),
    ).toBe(EXTRACT_MEMORY_MIN_TIMEOUT_MS);
  });

  test("applies the minimum clamp for a tiny prompt on a fast phone", () => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec: 100,
        nPredict: 1,
        promptTokensEstimate: 1,
        prefillTokPerSec: 100,
      }),
    ).toBe(EXTRACT_MEMORY_MIN_TIMEOUT_MS);
  });

  test("budgets the Jelly from measured prefill and decode speed", () => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec: 3.4,
        nPredict: 128,
        promptTokensEstimate: 1100,
        prefillTokPerSec: 15,
      }),
    ).toBeCloseTo(110_980, 0);
  });

  test("budgets the S23 from measured prefill and decode speed", () => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec: 10,
        nPredict: 128,
        promptTokensEstimate: 1100,
        prefillTokPerSec: 48,
      }),
    ).toBeCloseTo(35_717, 0);
  });

  test("applies the maximum clamp for a huge prompt on a slow phone", () => {
    expect(
      extractTimeoutMs({
        decodeTokPerSec: 0.1,
        nPredict: 128,
        promptTokensEstimate: 10_000,
        prefillTokPerSec: 1,
      }),
    ).toBe(120_000);
  });
});
