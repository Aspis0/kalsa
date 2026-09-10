import {
  __resetPrefillSpeedForTests,
  getLastPromptTokens,
  getPrefillTokPerSec,
  prefillBudgetTokens,
  recordPrefillSample,
} from "./prefillSpeed";

describe("prefillSpeed", () => {
  beforeEach(() => {
    __resetPrefillSpeedForTests();
  });

  test("unknown model → null speed and fallback budget", () => {
    expect(getPrefillTokPerSec("no-such-model")).toBeNull();
    expect(
      prefillBudgetTokens("no-such-model", 20_000, 1500),
    ).toBe(1500);
  });

  test("EMA after two samples: first seeds, second blends 30/70", () => {
    recordPrefillSample("lfm", 1000, 1000); // 1000 tok/s
    expect(getPrefillTokPerSec("lfm")).toBeCloseTo(1000);
    expect(getLastPromptTokens("lfm")).toBe(1000);
    recordPrefillSample("lfm", 3000, 1000); // 3000 tok/s
    expect(getPrefillTokPerSec("lfm")).toBeCloseTo(1600, 5);
    expect(getLastPromptTokens("lfm")).toBe(3000);
    // Budget = floor(tokPerSec × maxWaitMs / 1000).
    expect(prefillBudgetTokens("lfm", 20_000, 1500)).toBe(32_000);
  });

  test("EMAs are per-model", () => {
    recordPrefillSample("lfm", 1000, 1000);
    recordPrefillSample("minicpm5", 900, 1000);
    expect(getPrefillTokPerSec("lfm")).toBeCloseTo(1000);
    expect(getPrefillTokPerSec("minicpm5")).toBeCloseTo(900);
  });

  test("small or invalid samples are ignored", () => {
    // promptN below the 64-token floor (cache hit / tiny prompt).
    recordPrefillSample("lfm", 63, 1000);
    // promptMs <= 0: missing timings (-1), zero, unsynced counters.
    recordPrefillSample("lfm", 1000, 0);
    recordPrefillSample("lfm", 1000, -1);
    recordPrefillSample("lfm", 1000, Number.NaN);
    expect(getPrefillTokPerSec("lfm")).toBeNull();
    expect(getLastPromptTokens("lfm")).toBeNull();
    expect(prefillBudgetTokens("lfm", 20_000, 1500)).toBe(1500);

    // Boundary: exactly 64 tokens and positive ms is a valid sample.
    recordPrefillSample("lfm", 64, 1000);
    expect(getPrefillTokPerSec("lfm")).toBeCloseTo(64);
    expect(getLastPromptTokens("lfm")).toBe(64);
  });

  test("ignores empty model id", () => {
    recordPrefillSample("", 1000, 1000);
    expect(getPrefillTokPerSec("")).toBeNull();
    expect(getLastPromptTokens("")).toBeNull();
    expect(prefillBudgetTokens("", 20_000, 1500)).toBe(1500);
  });
});
