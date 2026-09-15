import {
  STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS,
  classifyPrewarmResult,
  computePrewarmPrefixHash,
  djb2,
  estimateStaticPrefixTokens,
  parseStaticPrefixMeasurements,
  serializeStaticPrefixMeasurements,
  shouldApplyQueuedPrefixWipe,
  shouldSkipPrewarmWhenKvHoldsChat,
  shouldWipeKvOnPrefixInputChange,
  staticPrefixIdentity,
  staticPrefixMeasurementKey,
} from "./prefixPrewarm";

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

describe("shouldApplyQueuedPrefixWipe", () => {
  it("does not wipe when chat KV is held", () => {
    expect(shouldApplyQueuedPrefixWipe(true)).toBe(false);
  });

  it("allows wipe when chat KV is empty", () => {
    expect(shouldApplyQueuedPrefixWipe(false)).toBe(true);
  });

  it("is the skip helper inverted, not a second boolean", () => {
    expect(shouldApplyQueuedPrefixWipe(true)).toBe(
      !shouldSkipPrewarmWhenKvHoldsChat(true),
    );
    expect(shouldApplyQueuedPrefixWipe(false)).toBe(
      !shouldSkipPrewarmWhenKvHoldsChat(false),
    );
    expect(shouldApplyQueuedPrefixWipe(true)).toBe(
      shouldWipeKvOnPrefixInputChange(true),
    );
  });
});

describe("estimateStaticPrefixTokens", () => {
  it("never returns 0 — a 0 reserve is the bug this guards", () => {
    expect(estimateStaticPrefixTokens("", [])).toBe(
      STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS,
    );
    expect(estimateStaticPrefixTokens("", null)).toBeGreaterThan(0);
  });

  it("prices the system text at the window's own chars/token, plus the margin", () => {
    // 3969 chars = it systemPromptWithSearch, counted 2026-09-14; the
    // chars/3 part is exactly the estimate that underpriced the S23 prefix.
    expect(estimateStaticPrefixTokens("x".repeat(3969), [])).toBe(
      Math.ceil(3969 / 3) + STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS,
    );
  });

  it("charges tool schemas at the same low ratio and grows with them", () => {
    const tool = (pad: number) => [
      { function: { name: "web_search", description: "d".repeat(pad), parameters: {} } },
    ];
    const bare = estimateStaticPrefixTokens("", []);
    const withSmall = estimateStaticPrefixTokens("", tool(100));
    const withLarge = estimateStaticPrefixTokens("", tool(3000));
    expect(withSmall).toBeGreaterThan(bare);
    expect(withLarge).toBeGreaterThan(withSmall);
  });

  it("prices CJK at ~1 token per char, never the optimistic chars/3", () => {
    // chars/3 on CJK undercounts ~3x (audit FAIL 2026-09-14: the fallback
    // must be demonstrably conservative, not formula-checked on ASCII).
    const latin = estimateStaticPrefixTokens("x".repeat(300), []);
    const cjk = estimateStaticPrefixTokens("あ".repeat(300), []);
    expect(cjk).toBeGreaterThanOrEqual(300 + STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS);
    expect(cjk).toBeGreaterThan(latin);
    expect(latin).toBe(Math.ceil(300 / 3) + STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS);
  });

  it("keys the memo on the exact identity, immune to djb2 collisions", () => {
    const tool = (name: string) => [
      { function: { name, description: "d", parameters: {} } },
    ];
    const a = staticPrefixIdentity("it", "system", tool("web_search"));
    const b = staticPrefixIdentity("it", "system", tool("web_search"));
    const c = staticPrefixIdentity("it", "system", tool("write_note"));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    // The prewarm hash stays djb2 over the same identity bytes.
    expect(computePrewarmPrefixHash("it", "system", tool("web_search"))).toBe(
      djb2(a),
    );
  });
});

describe("persisted static-prefix measurements", () => {
  test("keys the count by model and exact prefix identity", () => {
    expect(staticPrefixMeasurementKey("model-a", "prefix-a")).not.toBe(
      staticPrefixMeasurementKey("model-b", "prefix-a"),
    );
    expect(staticPrefixMeasurementKey("model-a", "prefix-a")).not.toBe(
      staticPrefixMeasurementKey("model-a", "prefix-b"),
    );
  });

  test("round-trips valid counts and ignores malformed storage", () => {
    const map = new Map([
      [staticPrefixMeasurementKey("model-a", "prefix-a"), 1832],
      [staticPrefixMeasurementKey("model-b", "prefix-b"), 2048],
    ]);
    expect(parseStaticPrefixMeasurements(serializeStaticPrefixMeasurements(map))).toEqual(
      [...map.entries()],
    );
    expect(parseStaticPrefixMeasurements("not-json")).toEqual([]);
    expect(parseStaticPrefixMeasurements(JSON.stringify({ bad: 0 }))).toEqual([]);
  });
});
