/**
 * The two per-turn report lines, KALSA_GOVERNOR_TURN and KALSA_GOVERNOR_COST,
 * projected through the REAL emitter: a payload built by governorTurnLog, never
 * a hand-written one, walked through formatRecord and finalizeLine. What is
 * asserted here is what an uploaded report actually keeps: every field
 * surviving, and every line inside normalize.ts's 300-char clip.
 */
import {
  governorTurnLogLines,
  governorTurnPayloads,
  markGovernorTurnGap,
  resetGovernorTurnCost,
  type GovernorFallbackCode,
  type GovernorTurnStats,
} from "../../engine/governorTurnLog";
import { finalizeLine } from "../normalize";
import { formatRecord } from "../schema";

/** The stats a real S23 turn answers, shaped as the JSI bridge emits them
 *  (cpp/jsi/RNLlamaJSI.cpp governorStats): a hot NPU handed this turn's
 *  prefill to the GPU (rule 10) over three chunks, decode on the NPU leg. */
const HOT_NPU_HANDOFF = {
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
  { index: 0, requested: "auto", actual: "cpu", tokens: 512, prefill_ms: 180.5, forced: false, layers_device: "CPU" },
  { index: 1, requested: "auto", actual: "cpu", tokens: 256, prefill_ms: 90.25, forced: false, layers_device: "HTP0" },
  { index: 2, requested: "auto", actual: "gpu", tokens: 256, prefill_ms: 120.75, forced: false, layers_device: "GPUOpenCL" },
];

/** The whole pipeline for one emitted line: schema projection, then the final
 *  safety pass. null means the line was dropped. */
function report(emitted: string): { line: string; fields: Record<string, unknown> } | null {
  const split = emitted.indexOf(" ");
  const record = formatRecord(emitted.slice(0, split), JSON.parse(emitted.slice(split + 1)));
  if (record === null) return null;
  const line = finalizeLine(record);
  if (line === null) return null;
  const payload = line.slice(line.indexOf(" ") + 1);
  return { line, fields: JSON.parse(payload.slice(payload.indexOf(" ") + 1)) };
}

beforeEach(() => {
  // The decode-cost baseline is module state; each case starts from a load.
  resetGovernorTurnCost();
});

function turnLines(
  stats: GovernorTurnStats = HOT_NPU_HANDOFF,
  routeChunks: unknown = ROUTE_CHUNKS,
  fallbackCode: GovernorFallbackCode = "none",
): [string, string] {
  return governorTurnLogLines(
    governorTurnPayloads({
      stats,
      forced: false,
      fallbackCode,
      routeChunks,
    }),
  );
}

describe("KALSA_GOVERNOR_TURN keeps every placement fact", () => {
  it("survives the clip whole", () => {
    const out = report(turnLines()[0]);
    expect(out).not.toBeNull();
    expect(out?.fields).toEqual({
      ep: "GPU",
      ed: "NPU",
      rr: 10,
      th: true,
      hn: 1.75,
      hg: 6.25,
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

  it("stays inside the clip with the LONGEST values every field can hold", () => {
    // The budget the two-line split exists for, pinned at worst case: the
    // widest engine/state literals, a 31-char SoC-style SoC, and the largest
    // distinct device list the schema admits (maxItems 4).
    const out = report(
      turnLines(
        {
          engine_prefill: "Unknown",
          engine_decode: "Unknown",
          prefill_router_rule: 10,
          prefill_thermal_handoff: true,
          prefill_npu_headroom_c: -12.75,
          prefill_gpu_headroom_c: 18.75,
          npu_device: "HTP0",
          npu_fallback: "htp-device-missing",
          cache_type_k: "iq4_nl",
          cache_type_v: "q8_0",
          prefill_kv: "device",
          thermal_state: "COOLMODE",
          prefill_chunks: "64+64+64+64+64+64+64+64+64+64+64+64+64+64+64+64",
          commit_bytes: 4294967295,
          commit_ms: 999.5,
          decode_hop_commit_bytes: 4294967295,
          decode_tokens_cpu: 65535,
          decode_tokens_gpu: 65535,
          decode_tokens_npu: 65535,
          decode_hops: 65535,
        },
        [
          { layers_device: "GPUOpenCL" },
          { layers_device: "HTP0" },
          { layers_device: "HTP1" },
          { layers_device: "HTP2" },
        ],
        "native_unsupported",
      )[0],
    );
    expect(out).not.toBeNull();
    expect(out?.fields).toMatchObject({
      dev: ["GPUOpenCL", "HTP0", "HTP1", "HTP2"],
      chunks: 16,
    });
    expect(out?.line.length).toBeLessThanOrEqual(300);
  });

  it("drops a layer-device name outside the binding's backend set", () => {
    const out = report(
      turnLines(HOT_NPU_HANDOFF, [
        { layers_device: "Adreno (QNN)" },
        { layers_device: "/data/user/0/com.kalsa.app/models" },
      ])[0],
    );
    expect(out?.fields).not.toHaveProperty("dev");
    expect(out?.fields).toMatchObject({ chunks: 3, ep: "GPU" });
  });

  it("drops a list longer than the schema admits", () => {
    const out = report(
      turnLines(HOT_NPU_HANDOFF, [
        { layers_device: "CPU" },
        { layers_device: "HTP0" },
        { layers_device: "HTP1" },
        { layers_device: "HTP2" },
        { layers_device: "HTP3" },
      ])[0],
    );
    expect(out?.fields).not.toHaveProperty("dev");
  });

  it("is inside normalize.ts's clip, payload and all", () => {
    const out = report(turnLines()[0]);
    // The record itself must fit: finalizeLine prefixes the ISO timestamp and
    // clips at 300, so a longer record would be truncated mid-JSON.
    expect(out?.line.length).toBeLessThanOrEqual(300);
    expect(out?.line).toContain('"dev":["CPU","HTP0","GPUOpenCL"]');
  });

  it("keeps nulls as the explicit absences they are", () => {
    const out = report(
      turnLines(
        {
          ...HOT_NPU_HANDOFF,
          prefill_npu_headroom_c: null,
          prefill_gpu_headroom_c: null,
          npu_fallback: "htp-device-missing",
          prefill_chunks: "",
        },
        null,
      )[0],
    );
    expect(out?.fields).toMatchObject({ hn: null, hg: null, npuf: "htp-device-missing" });
    // No chunk ran and no chunk named a device: both are explicit absences,
    // kept as null (the rules are NUMN and a nullable enumArray) rather than
    // dropped, so "nothing ran" reads as a fact and not as a missing field.
    expect(out?.fields).toMatchObject({ chunks: null, dev: null });
  });

  it("drops a value outside its closed set and keeps the rest of the line", () => {
    const out = report(turnLines({ ...HOT_NPU_HANDOFF, engine_prefill: "the user's laptop" })[0]);
    expect(out?.fields).not.toHaveProperty("ep");
    expect(out?.fields).toMatchObject({ ed: "NPU", rr: 10, chunks: 3 });
  });
});

describe("KALSA_GOVERNOR_COST keeps the turn's own cost and its verdict", () => {
  it("survives the clip whole, legs in [cpu, gpu, npu] order", () => {
    const out = report(turnLines()[1]);
    expect(out?.fields).toEqual({
      cb: HOT_NPU_HANDOFF.commit_bytes,
      cm: HOT_NPU_HANDOFF.commit_ms,
      dhb: 4194304,
      tok: [2048, 1024, 3072],
      hops: 12,
      first: 1,
      gap: 0,
      failed: false,
      fr: "none",
    });
    expect(out?.line.length).toBeLessThanOrEqual(300);
  });

  it("keeps the LONGEST cost line inside the clip, every field surviving", () => {
    // Worst case for COST: the widest numbers a turn can produce (a 4 GiB hop
    // commit, 65 535 tokens per leg), a latched failure and the longest code.
    const out = report(
      turnLines(
        {
          ...HOT_NPU_HANDOFF,
          commit_bytes: 4294967295,
          commit_ms: 999.5,
          decode_hop_commit_bytes: 4294967295,
          decode_tokens_cpu: 65535,
          decode_tokens_gpu: 65535,
          decode_tokens_npu: 65535,
          decode_hops: 65535,
          failure_reason: "something latched",
        },
        ROUTE_CHUNKS,
        "native_unsupported",
      )[1],
    );
    expect(out?.fields).toEqual({
      cb: 4294967295,
      cm: 999.5,
      dhb: 4294967295,
      tok: [65535, 65535, 65535],
      hops: 65535,
      first: 1,
      gap: 0,
      failed: true,
      fr: "native_unsupported",
    });
    expect(out?.line.length).toBeLessThanOrEqual(300);
  });

  it("reports the second turn's delta, not the running total", () => {
    turnLines();
    const second = report(
      turnLines({
        ...HOT_NPU_HANDOFF,
        decode_hop_commit_bytes: 8388608,
        decode_tokens_cpu: 2560,
        decode_tokens_gpu: 1024,
        decode_tokens_npu: 4096,
        decode_hops: 20,
      })[1],
    );
    expect(second?.fields).toMatchObject({
      dhb: 8388608 - 4194304,
      tok: [2560 - 2048, 0, 4096 - 3072],
      hops: 20 - 12,
      first: 0,
      gap: 0,
    });
    expect(second?.line.length).toBeLessThanOrEqual(300);
  });

  it("keeps a gap line's absent numbers absent, and says gap:1", () => {
    turnLines();
    markGovernorTurnGap();
    const out = report(turnLines({ ...HOT_NPU_HANDOFF, decode_hops: 99 }, ROUTE_CHUNKS)[1]);
    expect(out?.fields).toEqual({
      cb: HOT_NPU_HANDOFF.commit_bytes,
      cm: HOT_NPU_HANDOFF.commit_ms,
      first: 0,
      gap: 1,
      failed: false,
      fr: "none",
    });
    // A gap line never carries a subtraction, so it can never read as a turn
    // whose cost was negative. (Checked from the tag on: the ISO timestamp
    // prefix contains dashes of its own.)
    expect(out?.line.slice(out.line.indexOf("KALSA_GOVERNOR_COST"))).not.toContain("-");
    expect(out?.line.length).toBeLessThanOrEqual(300);
  });

  it("carries a fallback code, never the reason prose", () => {
    const out = report(
      governorTurnLogLines(
        governorTurnPayloads({
          stats: {
            ...HOT_NPU_HANDOFF,
            failure_reason: "Governor decode failed: 10.0.0.1 said no",
          },
          forced: true,
          fallbackCode: "other",
          routeChunks: ROUTE_CHUNKS,
        }),
      )[1],
    );
    expect(out?.fields).toMatchObject({ failed: true, fr: "other" });
    expect(out?.line).not.toContain("10.0.0.1");
    expect(out?.line).not.toContain("decode failed");
  });

  it("drops a code outside the set and keeps the rest of the line", () => {
    const out = report(
      turnLines(HOT_NPU_HANDOFF, ROUTE_CHUNKS, "governor not eligible" as never)[1],
    );
    expect(out?.fields).not.toHaveProperty("fr");
    expect(out?.fields).toMatchObject({ cb: HOT_NPU_HANDOFF.commit_bytes, hops: 12 });
  });
});
