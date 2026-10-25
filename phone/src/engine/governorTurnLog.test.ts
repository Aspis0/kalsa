/**
 * The per-turn report lines: the payload each line carries, the chunk count
 * derived from the binding's accumulator, the per-turn decode deltas, and the
 * budget that forced the split into two lines in the first place.
 */
import {
  GOVERNOR_FALLBACK_CODES,
  GOVERNOR_NOT_ELIGIBLE_REASON,
  GOVERNOR_THERMO_INVALID_REASON,
  governorFallbackCodeFromNative,
  governorTurnLogLines,
  governorTurnPayloads,
  markGovernorTurnGap,
  prefillChunkCount,
  resetGovernorTurnCost,
  type GovernorFallbackCode,
} from "./governorTurnLog";

/** One turn's worth of counters, at the values an S23 turn reaches. */
const TURN_ONE = {
  engine_prefill: "GPU",
  engine_decode: "NPU",
  prefill_router_rule: 10,
  prefill_thermal_handoff: true,
  prefill_npu_headroom_c: 1.75,
  prefill_gpu_headroom_c: 6.25,
  npu_device: "HTP0",
  npu_fallback: null,
  cache_type_k: "q8_0",
  cache_type_v: "q8_0",
  prefill_kv: "device",
  thermal_state: "WARM",
  prefill_chunks: "cpu:512+256+256",
  commit_bytes: 2097152,
  commit_ms: 3.75,
  decode_hop_commit_bytes: 4194304,
  decode_tokens_cpu: 2048,
  decode_tokens_gpu: 1024,
  decode_tokens_npu: 3072,
  decode_hops: 12,
};

/** The same turn's route chunks, as the binding fills them in
 *  (NativeCompletionResult.route_chunks). */
const ROUTE_CHUNKS = [
  { index: 0, layers_device: "CPU" },
  { index: 1, layers_device: "HTP0" },
  { index: 2, layers_device: "GPUOpenCL" },
];

const turn = (stats: object, fallbackCode: GovernorFallbackCode = "none") =>
  governorTurnPayloads({
    stats,
    forced: false,
    fallbackCode,
    routeChunks: ROUTE_CHUNKS,
  });

beforeEach(() => {
  resetGovernorTurnCost();
});

describe("prefillChunkCount — the binding's prefill_chunks accumulator", () => {
  it("counts the entries of the '+'-joined run", () => {
    expect(prefillChunkCount("768+512+256")).toBe(3);
    expect(prefillChunkCount("512")).toBe(1);
  });

  it("does not count the 'cpu:' route prefix as a chunk of its own", () => {
    expect(prefillChunkCount("cpu:512+256")).toBe(2);
  });

  it("reads an absent accumulator as absent, never as zero chunks", () => {
    expect(prefillChunkCount("")).toBeNull();
    expect(prefillChunkCount(undefined)).toBeNull();
    expect(prefillChunkCount(42)).toBeNull();
    expect(prefillChunkCount("cpu:")).toBeNull();
    expect(prefillChunkCount("512+")).toBeNull();
  });
});

describe("governorTurnPayloads — placement", () => {
  it("carries the placement on TURN", () => {
    expect(turn(TURN_ONE).turn).toMatchObject({
      ep: "GPU",
      ed: "NPU",
      rr: 10,
      th: true,
      hn: 1.8,
      hg: 6.3,
      npu: "HTP0",
      npuf: null,
      ck: "q8_0",
      cv: "q8_0",
      kv: "device",
      chunks: 3,
      dev: ["CPU", "HTP0", "GPUOpenCL"],
      therm: "WARM",
      forced: false,
    });
  });

  it("rounds the f32 headroom noise to one decimal", () => {
    const turnLine = turn({
      ...TURN_ONE,
      prefill_npu_headroom_c: 41.30000305175781,
      prefill_gpu_headroom_c: -12.75,
    }).turn;
    expect(turnLine.hn).toBe(41.3);
    expect(turnLine.hg).toBe(-12.7);
  });

  it("omits the stats fields an older binding does not answer", () => {
    const payloads = governorTurnPayloads({
      stats: { engine_prefill: "CPU" },
      forced: true,
      fallbackCode: "none",
      routeChunks: null,
    });
    // Undefined never reaches the line: JSON drops the key, so the schema sees
    // no field at all rather than an explicit null.
    const turnLine = JSON.parse(governorTurnLogLines(payloads)[0].replace("KALSA_GOVERNOR_TURN ", ""));
    expect(turnLine).toEqual({ ep: "CPU", chunks: null, dev: null, forced: true });
    expect(payloads.turn.dev).toBeNull();
  });
});

describe("governorTurnPayloads — the decode cost is this turn's, not the running total", () => {
  it("reports the first turn's counters as cumulative and says so", () => {
    expect(turn(TURN_ONE).cost).toEqual({
      cb: 2097152,
      cm: 3.75,
      dhb: 4194304,
      tok: [2048, 1024, 3072],
      hops: 12,
      first: 1,
      gap: 0,
      failed: false,
      fr: "none",
    });
  });

  it("reports only what the second turn added", () => {
    turn(TURN_ONE);
    const second = turn({
      ...TURN_ONE,
      commit_bytes: 1048576,
      commit_ms: 1.25,
      decode_hop_commit_bytes: 8388608,
      decode_tokens_cpu: 2560,
      decode_tokens_gpu: 1024,
      decode_tokens_npu: 4096,
      decode_hops: 20,
    });
    expect(second.cost).toMatchObject({
      // The commit is this turn's own, and is NOT delta'd.
      cb: 1048576,
      cm: 1.25,
      dhb: 8388608 - 4194304,
      tok: [2560 - 2048, 1024 - 1024, 4096 - 3072],
      hops: 20 - 12,
      first: 0,
      gap: 0,
    });
  });

  it("reports a counter reset it was not told about as a gap with no numbers", () => {
    turn(TURN_ONE);
    // A live cache clear zeroes the engine's decode counters. The raw delta
    // would be a large negative number that describes no turn, so the line
    // says gap:1 and omits them rather than publishing the subtraction.
    const afterClear = turn({
      ...TURN_ONE,
      decode_hop_commit_bytes: 128,
      decode_tokens_cpu: 0,
      decode_tokens_gpu: 0,
      decode_tokens_npu: 64,
      decode_hops: 1,
    });
    expect(afterClear.cost).toMatchObject({ dhb: null, tok: null, hops: null, gap: 1, first: 0 });
    expect(JSON.stringify(afterClear.cost)).not.toContain("-");
  });

  it("carries no numbers on the line after a skipped turn, then re-baselines", () => {
    turn(TURN_ONE);
    markGovernorTurnGap();
    const skipped = turn({ ...TURN_ONE, decode_hops: 14, decode_hop_commit_bytes: 5000000 });
    // The gap is reported as gap:1 with first:0 — not as a first read of the
    // counters, which would look like a whole turn's cost for a turn that has
    // no line of its own.
    expect(skipped.cost).toMatchObject({ dhb: null, tok: null, hops: null, gap: 1, first: 0 });

    const after = turn({ ...TURN_ONE, decode_hops: 20, decode_hop_commit_bytes: 6300000 });
    expect(after.cost).toMatchObject({ hops: 6, dhb: 1300000, gap: 0, first: 0 });
  });

  it("answers nothing, rather than a cost of zero, when the binding is silent", () => {
    const cost = governorTurnPayloads({
      stats: { commit_bytes: 10 },
      forced: false,
      fallbackCode: "none",
      routeChunks: null,
    }).cost;
    expect(cost.dhb).toBeNull();
    expect(cost.tok).toBeNull();
    expect(cost.hops).toBeNull();
    expect(cost).not.toHaveProperty("first");
    expect(cost).not.toHaveProperty("gap");
  });

  it("reads the leg order as [cpu, gpu, npu], the observation row's", () => {
    expect(
      turn({
        decode_tokens_cpu: 1,
        decode_tokens_gpu: 2,
        decode_tokens_npu: 3,
        decode_hop_commit_bytes: 7,
        decode_hops: 4,
      }).cost.tok,
    ).toEqual([1, 2, 3]);
  });

  it("reads failed from the latched failure reason, never from its text", () => {
    const cost = turn(
      { ...TURN_ONE, failure_reason: "Governor decode failed: something a user typed" },
      "other",
    ).cost;
    expect(cost.failed).toBe(true);
    expect(JSON.stringify(cost)).not.toContain("user typed");
  });
});

describe("governorTurnLogLines", () => {
  it("emits TURN then COST, one line each", () => {
    const lines = governorTurnLogLines(
      governorTurnPayloads({
        stats: { engine_prefill: "NPU", commit_bytes: 1 },
        forced: false,
        fallbackCode: "none",
        routeChunks: null,
      }),
    );
    expect(lines.map((line) => line.split(" ")[0])).toEqual([
      "KALSA_GOVERNOR_TURN",
      "KALSA_GOVERNOR_COST",
    ]);
  });
});

describe("the fallback codes", () => {
  it("are a closed set with no prose in it", () => {
    expect(GOVERNOR_FALLBACK_CODES).toEqual([
      "none",
      "not_eligible",
      "thermo_invalid",
      "native_unsupported",
      "native_unnamed",
      "other",
      "runtime",
    ]);
    for (const code of GOVERNOR_FALLBACK_CODES) expect(code).not.toContain(" ");
    expect(GOVERNOR_NOT_ELIGIBLE_REASON).toContain(" ");
    expect(GOVERNOR_THERMO_INVALID_REASON).toContain(" ");
  });

  it("name the native refusal classes the binding actually throws", () => {
    // cpp/rn-llama.cpp:775,1545 and cpp/jsi/RNLlamaJSI.cpp:276,902,1438
    expect(governorFallbackCodeFromNative("governor: thermo profile invalid")).toBe("thermo_invalid");
    expect(governorFallbackCodeFromNative("governor_thermo is required in governor mode")).toBe(
      "thermo_invalid",
    );
    expect(governorFallbackCodeFromNative("Invalid governor_thermo profile")).toBe("thermo_invalid");
    // cpp/rn-llama.cpp:1548-1565,2007 and RNLlamaJSI.cpp:911,939
    expect(
      governorFallbackCodeFromNative("Governor mode does not support speculative or MTP decoding"),
    ).toBe("native_unsupported");
    expect(governorFallbackCodeFromNative("Governor mode is not enabled")).toBe("native_unsupported");
    expect(
      governorFallbackCodeFromNative("Governor mode supports sequence 0 only; parallel slots are disabled"),
    ).toBe("native_unsupported");
  });

  it("send a retry it cannot classify to other, not to a guess", () => {
    expect(governorFallbackCodeFromNative("ggml_backend_alloc: out of memory")).toBe("other");
    expect(governorFallbackCodeFromNative("")).toBe("native_unnamed");
    expect(governorFallbackCodeFromNative(undefined)).toBe("native_unnamed");
    expect(governorFallbackCodeFromNative(null)).toBe("native_unnamed");
  });
});