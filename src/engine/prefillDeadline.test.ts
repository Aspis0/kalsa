import { MIN_PREFILL_DEADLINE_MS, prefillDeadlineMs } from "./prefillDeadline";

describe("prefillDeadlineMs", () => {
  test("arms the min deadline without a prefill EMA", () => {
    expect(
      prefillDeadlineMs({
        promptTokensEstimate: 2112,
        prefillTokPerSec: null,
        minMs: MIN_PREFILL_DEADLINE_MS,
      }),
    ).toBe(MIN_PREFILL_DEADLINE_MS);
  });

  test("allows five measured prefill durations", () => {
    expect(
      prefillDeadlineMs({
        promptTokensEstimate: 2112,
        prefillTokPerSec: 15,
        minMs: MIN_PREFILL_DEADLINE_MS,
      }),
    ).toBe(705_000);
  });

  test("applies the minimum floor", () => {
    expect(
      prefillDeadlineMs({
        promptTokensEstimate: 1,
        prefillTokPerSec: 100,
        minMs: MIN_PREFILL_DEADLINE_MS,
      }),
    ).toBe(90_000);
  });
});
