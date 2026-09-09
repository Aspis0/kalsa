import { classifyPrewarmResult } from "./prefixPrewarm";

describe("classifyPrewarmResult", () => {
  it("fails on a native error", () => {
    expect(
      classifyPrewarmResult({
        error: "decode failed",
        tokens_evaluated: 10,
        tokens_cached: 10,
      }),
    ).toBe("failed");
  });

  it("skips an interrupted prewarm", () => {
    expect(
      classifyPrewarmResult({ interrupted: true, tokens_evaluated: 10, tokens_cached: 10 }),
    ).toBe("skip");
  });

  it("skips when generation produced tokens", () => {
    expect(
      classifyPrewarmResult({ tokens_predicted: 1, tokens_evaluated: 10, tokens_cached: 10 }),
    ).toBe("generated");
  });

  it("accepts dense prewarm with unsynchronized prompt timings", () => {
    expect(
      classifyPrewarmResult({
        tokens_evaluated: 2112,
        tokens_cached: 2112,
        timings: { prompt_ms: 0, prompt_n: 1 },
      }),
    ).toBe("success");
  });

  it("fails when no prompt tokens were evaluated", () => {
    expect(classifyPrewarmResult({ tokens_evaluated: 0, tokens_cached: 0 })).toBe("failed");
  });

  it("fails when decode cached fewer tokens than evaluated", () => {
    expect(
      classifyPrewarmResult({ tokens_evaluated: 2112, tokens_cached: 1200 }),
    ).toBe("failed");
  });
});
