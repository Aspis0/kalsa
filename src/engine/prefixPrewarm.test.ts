import {
  STATIC_PREFIX_MEASUREMENT_MAX_ENTRIES,
  STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS,
  capStaticPrefixMeasurements,
  classifyPrewarmResult,
  computePrewarmPrefixHash,
  djb2,
  estimateStaticPrefixTokens,
  isStaticPrefixMeasurementUsable,
  isSystemOnlyTemplateFailure,
  makeStaticPrefixMeasurement,
  parseStaticPrefixMeasurements,
  serializeStaticPrefixMeasurements,
  shouldApplyQueuedPrefixWipe,
  shouldSkipPrewarmWhenKvHoldsChat,
  shouldWipeKvOnPrefixInputChange,
  staticPrefixIdentity,
  staticPrefixMeasurementKey,
  staticPrefixTokensForActiveNCtx,
  type StaticPrefixMeasurement,
} from "./prefixPrewarm";
import { WINDOW_RESERVE_TOKENS } from "../context/windowProfile";

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

describe("static-prefix measurement bound", () => {
  // The guard is windowCeilingTokens(nCtx, tokens) = nCtx - RESERVE - tokens,
  // never negative by clamp. At tokens == nCtx - RESERVE the ceiling is 0,
  // so the bound is strict and derives only from WINDOW_RESERVE_TOKENS.
  const nCtx = 8192;
  const limit = nCtx - WINDOW_RESERVE_TOKENS;

  test("a measurement at or above nCtx - reserve is unusable", () => {
    expect(isStaticPrefixMeasurementUsable(limit - 1, nCtx)).toBe(true);
    expect(isStaticPrefixMeasurementUsable(limit, nCtx)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(limit + 1, nCtx)).toBe(false);
    expect(staticPrefixTokensForActiveNCtx(
      { tokens: limit, nCtx, at: 1 },
      nCtx,
    )).toBeNull();
    expect(staticPrefixTokensForActiveNCtx(
      { tokens: limit - 1, nCtx, at: 1 },
      nCtx,
    )).toBe(limit - 1);
  });

  test("the bound is the guard's reserve, not an estimator factor", () => {
    // Pins the derivation: the only constant in the bound is the guard's own
    // reserve, and the comparison at the edge is strict.
    expect(WINDOW_RESERVE_TOKENS).toBe(2048);
    expect(limit).toBe(nCtx - WINDOW_RESERVE_TOKENS);
    expect(isStaticPrefixMeasurementUsable(limit - 1, nCtx)).toBe(true);
    expect(isStaticPrefixMeasurementUsable(limit, nCtx)).toBe(false);
  });

  test("rejects non-positive, non-integer counts and contexts", () => {
    expect(isStaticPrefixMeasurementUsable(0, nCtx)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(-1, nCtx)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(1.5, nCtx)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(100, 0)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(100, 2048)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(100, 1.5)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(Number.NaN, nCtx)).toBe(false);
    expect(isStaticPrefixMeasurementUsable(100, Number.POSITIVE_INFINITY)).toBe(false);
  });

  test("make returns null instead of a poison entry", () => {
    expect(makeStaticPrefixMeasurement(limit, nCtx, 1)).toBeNull();
    expect(makeStaticPrefixMeasurement(1832, nCtx, 1)).toEqual({
      tokens: 1832,
      nCtx,
      at: 1,
    });
    expect(makeStaticPrefixMeasurement(1832, nCtx, -1)).toBeNull();
    expect(makeStaticPrefixMeasurement(1832, nCtx, 1.5)).toBeNull();
    expect(makeStaticPrefixMeasurement(1832, nCtx, Number.NaN)).toBeNull();
  });

  test("active-context poison is read as unmeasured, not as a 0 ceiling", () => {
    // Legitimately measured under a 128k context; unusable for the active 8k.
    const wide = makeStaticPrefixMeasurement(60000, 131072, 7);
    expect(wide).not.toBeNull();
    expect(staticPrefixTokensForActiveNCtx(wide, 8192)).toBeNull();
    expect(staticPrefixTokensForActiveNCtx(wide, 131072)).toBe(60000);
    // An invalid active context is never trusted either.
    expect(staticPrefixTokensForActiveNCtx(wide, 0)).toBeNull();
    expect(staticPrefixTokensForActiveNCtx(null, 8192)).toBeNull();
    expect(staticPrefixTokensForActiveNCtx(undefined, 8192)).toBeNull();
  });
});

describe("persisted static-prefix measurements v2", () => {
  const key = (name: string) => staticPrefixMeasurementKey("model-a", name);
  const entry = (tokens: number, at: number, nCtx = 8192) => ({
    tokens,
    nCtx,
    at,
  });

  test("keys the count by model and exact prefix identity", () => {
    expect(staticPrefixMeasurementKey("model-a", "prefix-a")).not.toBe(
      staticPrefixMeasurementKey("model-b", "prefix-a"),
    );
    expect(staticPrefixMeasurementKey("model-a", "prefix-a")).not.toBe(
      staticPrefixMeasurementKey("model-a", "prefix-b"),
    );
  });

  test("round-trips a v2 map deterministically", () => {
    const map = new Map([
      [key("a"), entry(1832, 3)],
      [key("b"), entry(2048, 1)],
      [key("c"), entry(900, 2)],
    ]);
    const wire = serializeStaticPrefixMeasurements(map);
    expect(parseStaticPrefixMeasurements(wire)).toEqual([
      [key("a"), entry(1832, 3)],
      [key("c"), entry(900, 2)],
      [key("b"), entry(2048, 1)],
    ]);
    // Serialization does not depend on Map insertion order.
    const reversed = new Map([...map.entries()].reverse());
    expect(serializeStaticPrefixMeasurements(reversed)).toBe(wire);
  });

  test("malformed schema is dropped without throwing", () => {
    expect(parseStaticPrefixMeasurements(null)).toEqual([]);
    expect(parseStaticPrefixMeasurements(undefined)).toEqual([]);
    expect(parseStaticPrefixMeasurements("")).toEqual([]);
    expect(parseStaticPrefixMeasurements("not-json")).toEqual([]);
    expect(parseStaticPrefixMeasurements("null")).toEqual([]);
    expect(parseStaticPrefixMeasurements("5")).toEqual([]);
    expect(parseStaticPrefixMeasurements('"str"')).toEqual([]);
    expect(parseStaticPrefixMeasurements("[]")).toEqual([]);
    expect(parseStaticPrefixMeasurements("[1,2,3]")).toEqual([]);
    expect(parseStaticPrefixMeasurements("{}")).toEqual([]);
    expect(capStaticPrefixMeasurements([])).toEqual([]);
    expect(
      parseStaticPrefixMeasurements(
        JSON.stringify({
          [key("missing-nctx")]: { tokens: 100, at: 1 },
          [key("missing-at")]: { tokens: 100, nCtx: 8192 },
          [key("string-tokens")]: { tokens: "100", nCtx: 8192, at: 1 },
          [key("float-tokens")]: { tokens: 100.5, nCtx: 8192, at: 1 },
          [key("negative-at")]: { tokens: 100, nCtx: 8192, at: -1 },
          [key("float-at")]: { tokens: 100, nCtx: 8192, at: 1.5 },
          [key("array-value")]: [100],
          [key("null-value")]: null,
        }),
      ),
    ).toEqual([]);
  });

  test("v1 number-only poison is rejected outright", () => {
    // The WIP format was { key: number }. None of it may be trusted now.
    expect(
      parseStaticPrefixMeasurements(JSON.stringify({ [key("a")]: 1832 })),
    ).toEqual([]);
    // A typed caller passing v1 now fails to compile; an untyped/runtime v1
    // value that reaches the serializer is dropped rather than written back.
    const legacy = new Map([[key("a"), 1832]]) as unknown as Map<
      string,
      StaticPrefixMeasurement
    >;
    expect(serializeStaticPrefixMeasurements(legacy)).toBe("{}");
    // Empty store round-trips as an empty object, not as a malformed blob.
    expect(serializeStaticPrefixMeasurements(new Map())).toBe("{}");
    expect(parseStaticPrefixMeasurements("{}")).toEqual([]);
  });

  test("keeps the newest 32 entries by at", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      [key(`p${String(i).padStart(2, "0")}`), entry(100 + i, i + 1)] as const,
    );
    const capped = capStaticPrefixMeasurements(many);
    expect(capped).toHaveLength(STATIC_PREFIX_MEASUREMENT_MAX_ENTRIES);
    expect(capped.map(([, m]) => m.at)).toEqual(
      Array.from({ length: 32 }, (_, i) => 40 - i),
    );
    // The full wire path caps too, so a poisoned oversized blob is bounded.
    expect(parseStaticPrefixMeasurements(JSON.stringify(Object.fromEntries(many))))
      .toHaveLength(STATIC_PREFIX_MEASUREMENT_MAX_ENTRIES);
    expect(serializeStaticPrefixMeasurements(many)).toBe(
      serializeStaticPrefixMeasurements(capped),
    );
  });

  test("duplicate keys keep the newer measurement", () => {
    const stale = key("a");
    const capped = capStaticPrefixMeasurements([
      [stale, entry(100, 10)],
      [stale, entry(200, 20)],
    ]);
    expect(capped).toEqual([[stale, entry(200, 20)]]);
  });

  test("duplicate keys with equal at keep the first occurrence", () => {
    const stale = key("a");
    const capped = capStaticPrefixMeasurements([
      [stale, entry(100, 5)],
      [stale, entry(200, 5)],
    ]);
    expect(capped).toEqual([[stale, entry(100, 5)]]);
  });

  test("equal timestamps order by key so the bytes stay stable", () => {
    const capped = capStaticPrefixMeasurements([
      [key("b"), entry(100, 5)],
      [key("a"), entry(100, 5)],
    ]);
    expect(capped.map(([k]) => k)).toEqual([key("a"), key("b")]);
  });

  test("an entry measured for a wider context survives but is unreadable here", () => {
    const wide = key("wide");
    const wire = serializeStaticPrefixMeasurements(
      new Map([[wide, entry(9000, 5, 16384)]]),
    );
    const parsed = parseStaticPrefixMeasurements(wire);
    expect(parsed).toEqual([[wide, entry(9000, 5, 16384)]]);
    expect(staticPrefixTokensForActiveNCtx(parsed[0][1], 8192)).toBeNull();
    expect(staticPrefixTokensForActiveNCtx(parsed[0][1], 16384)).toBe(9000);
  });
});

describe("isSystemOnlyTemplateFailure", () => {
  // Why this predicate decides anything: the prewarm prompt must be the static
  // prefix and NOTHING else, so the cache it leaves ends exactly where the next
  // real prompt diverges. One extra turn past that point moves p0 back behind
  // the frontier, llama_memory_seq_rm takes its partial-rollback branch
  // (llama-memory-recurrent.cpp:194) bounded by n_rs_seq = 0, fails, and
  // rn-completion.cpp clears the cache and re-prefills the whole window.
  // So the filler turn is only ever added to a model that has REFUSED.
  test("recognises the templates that cannot render a system-only chat", () => {
    // Verbatim from Qwen3.5-4B's own tokenizer.chat_template, read out of the
    // shipped GGUF: `raise_exception('No user query found in messages.')`
    // fires because its reverse scan clears multi_step_tool only on a user
    // role. Missing this string is not cosmetic — the model would never be
    // added to the filler set, so its prewarm would fail on every attempt.
    expect(
      isSystemOnlyTemplateFailure("No user query found in messages."),
    ).toBe(true);
    expect(
      isSystemOnlyTemplateFailure(
        "Error: minja: No user query found in messages.",
      ),
    ).toBe(true);
    expect(isSystemOnlyTemplateFailure("No messages provided.")).toBe(true);
    expect(isSystemOnlyTemplateFailure("Prompt is required")).toBe(true);
    expect(isSystemOnlyTemplateFailure("Unable to generate parser")).toBe(true);
    expect(
      isSystemOnlyTemplateFailure("jinja: unable to generate parser for tools"),
    ).toBe(true);
  });

  test("does not claim unrelated native failures", () => {
    // Misclassifying any of these would append the filler turn — and with it
    // give up prefix reuse — on a model whose template was never the problem.
    expect(isSystemOnlyTemplateFailure("n_predict must be > 0")).toBe(false);
    expect(isSystemOnlyTemplateFailure("out of memory")).toBe(false);
    expect(isSystemOnlyTemplateFailure("context shift is disabled")).toBe(false);
    expect(isSystemOnlyTemplateFailure("")).toBe(false);
    expect(isSystemOnlyTemplateFailure(undefined)).toBe(false);
    expect(isSystemOnlyTemplateFailure(null)).toBe(false);
    expect(isSystemOnlyTemplateFailure(42)).toBe(false);
  });
});
