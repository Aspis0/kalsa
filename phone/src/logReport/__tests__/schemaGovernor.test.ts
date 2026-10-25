/** Schema tests for the governor / thermal / stall tags. Payloads mirror the real emitters. */
import {
  buildObservationRow,
  completionLogRow,
  type GovernorObservationStats,
} from "../../engine/governorObservation";
import { finalizeRecord } from "../normalize";
import { formatRecord } from "../schema";

function record(tag: string, json: string): Record<string, unknown> | null {
  const line = formatRecord(tag, JSON.parse(json));
  return line === null ? null : (JSON.parse(line.replace(/^[^ ]+ /, "")) as Record<string, unknown>);
}

describe("KALSA_GOVERNOR_PLAN (governorInputs.ts:228-243)", () => {
  it("keeps the plan numbers and literals", () => {
    expect(
      record(
        "KALSA_GOVERNOR_PLAN",
        JSON.stringify({
          gpu_fit: "Fit",
          decode_repack: true,
          required_mib_with_repack: 4358.7,
          required_mib_without_repack: 2998.06,
          available_mib: 3640.5,
          bench_norepack_forced: null,
          npu_device: "HTP0",
          npu_fallback: null,
          npu_lane: "auto",
        }),
      ),
    ).toEqual({
      gpu_fit: "Fit",
      decode_repack: true,
      required_mib_with_repack: 4358.7,
      required_mib_without_repack: 2998.06,
      available_mib: 3640.5,
      bench_norepack_forced: null,
      npu_device: "HTP0",
      npu_fallback: null,
      npu_lane: "auto",
    });
  });

  it("keeps npu_fit and available_src only as their literals", () => {
    const line = (npuFit: string, src: string) =>
      record(
        "KALSA_GOVERNOR_PLAN",
        JSON.stringify({ gpu_fit: "NoFit", npu_fit: npuFit, available_src: src }),
      );
    expect(line("NoFit", "fresh")).toEqual({
      gpu_fit: "NoFit",
      npu_fit: "NoFit",
      available_src: "fresh",
    });
    expect(line("Fit at /Users/marco", "MemAvailable 123 kB")).toEqual({
      gpu_fit: "NoFit",
    });
  });

  it("drops a npu_device that is not the resolver's literal", () => {
    const out = record(
      "KALSA_GOVERNOR_PLAN",
      '{"gpu_fit":"Fit","decode_repack":false,"required_mib_with_repack":1,' +
        '"required_mib_without_repack":1,"available_mib":2,"npu_device":"my computer"}',
    );
    expect(out).toEqual({
      gpu_fit: "Fit",
      decode_repack: false,
      required_mib_with_repack: 1,
      required_mib_without_repack: 1,
      available_mib: 2,
    });
  });

  it("keeps the applied pacing lines, null when the phone has no row", () => {
    const line = (start: string) =>
      record("KALSA_GOVERNOR_PLAN", `{"gpu_fit":"Fit","pacing_start":${start},"pacing_full":0.99}`);
    expect(line("0.87")).toEqual({ gpu_fit: "Fit", pacing_start: 0.87, pacing_full: 0.99 });
    expect(line("null")).toEqual({ gpu_fit: "Fit", pacing_start: null, pacing_full: 0.99 });
    expect(line('"0.87 on /Users/marco"')).toEqual({ gpu_fit: "Fit", pacing_full: 0.99 });
  });

  it("keeps npu_price only as its two literals", () => {
    const line = (price: string) =>
      record("KALSA_GOVERNOR_PLAN", `{"gpu_fit":"NoFit","npu_price":"${price}"}`);
    expect(line("lane_only")).toEqual({ gpu_fit: "NoFit", npu_price: "lane_only" });
    expect(line("with_gpu")).toEqual({ gpu_fit: "NoFit", npu_price: "with_gpu" });
    expect(line("lane_only on /Users/marco")).toEqual({ gpu_fit: "NoFit" });
  });

  it("keeps gpu_leg only as a boolean", () => {
    const line = (leg: string) =>
      record("KALSA_GOVERNOR_PLAN", `{"gpu_fit":"Fit","gpu_leg":${leg}}`);
    expect(line("false")).toEqual({ gpu_fit: "Fit", gpu_leg: false });
    expect(line("true")).toEqual({ gpu_fit: "Fit", gpu_leg: true });
    expect(line('"false on /Users/marco"')).toEqual({ gpu_fit: "Fit" });
  });
});

describe("KALSA_GOVERNOR_FALLBACK (LlamaService.ts:2456)", () => {
  it("keeps the closed reason set", () => {
    expect(
      record(
        "KALSA_GOVERNOR_FALLBACK",
        '{"stage":"correctness","reason":"gpu-prefill-incorrect-Unknown","forced":false}',
      ),
    ).toEqual({ stage: "correctness", reason: "gpu-prefill-incorrect-Unknown", forced: false });
  });

  it("drops a reason outside the generated set", () => {
    const out = record(
      "KALSA_GOVERNOR_FALLBACK",
      '{"stage":"correctness","reason":"governor rejected the model","forced":false}',
    );
    expect(out).toEqual({ stage: "correctness", forced: false });
  });
});

describe("KALSA_GOVERNOR_FAILED (LlamaService.ts:1821)", () => {
  it("keeps only the native thermal state, drops the free-prose reason", () => {
    expect(
      record(
        "KALSA_GOVERNOR_FAILED",
        '{"reason":"governor is failed","thermal_state":"WARM"}',
      ),
    ).toEqual({ thermal_state: "WARM" });
  });

  it("drops an unknown thermal state value", () => {
    const out = record(
      "KALSA_GOVERNOR_FAILED",
      '{"reason":"x","thermal_state":"on fire (see /Users/marco/notes.txt)"}',
    );
    expect(out).toEqual({});
  });
});

describe("KALSA_GOVERNOR_RUNTIME_FALLBACK (LlamaService.ts:2875)", () => {
  it("keeps the counter turnId and attempt, drops the native-message reason", () => {
    expect(
      record(
        "KALSA_GOVERNOR_RUNTIME_FALLBACK",
        '{"reason":"Nan NaN /etc/passwd","turnId":"7","attempt":2}',
      ),
    ).toEqual({ turnId: "7", attempt: 2 });
  });

  it("rejects a non-counter turnId", () => {
    const out = record(
      "KALSA_GOVERNOR_RUNTIME_FALLBACK",
      '{"reason":"x","turnId":"conv-a1b2c3","attempt":2}',
    );
    expect(out).toEqual({ attempt: 2 });
  });
});

describe("KALSA_GOVERNOR_PAUSE (governorPauseLog.ts:19-24)", () => {
  it("keeps the utility-site shape", () => {
    expect(
      record("KALSA_GOVERNOR_PAUSE", '{"site":"translate","reason":"thermal"}'),
    ).toEqual({ site: "translate", reason: "thermal" });
  });

  it("keeps the turn shape", () => {
    expect(
      record("KALSA_GOVERNOR_PAUSE", '{"turnId":"12","round":1,"reason":"profile"}'),
    ).toEqual({ turnId: "12", round: 1, reason: "profile" });
  });
});

describe("KALSA_THERMAL_COOLING (governorPauseLog.ts:44-58)", () => {
  it("keeps the enter line without an outcome", () => {
    expect(
      record(
        "KALSA_THERMAL_COOLING",
        '{"turnId":"12","round":1,"phase":"enter","waitedMs":0,"generationMs":0,"batt_temp_tenths_c":null}',
      ),
    ).toEqual({
      turnId: "12",
      round: 1,
      phase: "enter",
      waitedMs: 0,
      generationMs: 0,
      batt_temp_tenths_c: null,
    });
  });

  it("keeps the exit line with the closed outcome", () => {
    expect(
      record(
        "KALSA_THERMAL_COOLING",
        '{"turnId":"12","round":1,"phase":"exit","waitedMs":420,"generationMs":1200,"batt_temp_tenths_c":410,"outcome":"resumed"}',
      ),
    ).toEqual({
      turnId: "12",
      round: 1,
      phase: "exit",
      waitedMs: 420,
      generationMs: 1200,
      batt_temp_tenths_c: 410,
      outcome: "resumed",
    });
  });
});

describe("KALSA_STALL (LlamaService.ts:4338, :4392)", () => {
  it("keeps the gap line", () => {
    expect(
      record(
        "KALSA_STALL",
        '{"gapMs":10143,"tokens":1,"turnId":"9","reason":"gap","tokPerSec":0.098}',
      ),
    ).toEqual({ gapMs: 10143, tokens: 1, turnId: "9", reason: "gap", tokPerSec: 0.098 });
  });

  it("keeps the prefill line with a null rate", () => {
    expect(
      record(
        "KALSA_STALL",
        '{"gapMs":0,"tokens":0,"turnId":"10","reason":"prefill","tokPerSec":null}',
      ),
    ).toEqual({ gapMs: 0, tokens: 0, turnId: "10", reason: "prefill", tokPerSec: null });
  });

  it("drops a stall reason that is not one of the three emitters", () => {
    const out = record(
      "KALSA_STALL",
      '{"gapMs":1,"tokens":1,"turnId":"9","reason":"because the user said so","tokPerSec":1}',
    );
    expect(out).toEqual({ gapMs: 1, tokens: 1, turnId: "9", tokPerSec: 1 });
  });
});

describe("KALSA_IDLE_STALL (foregroundIdle.ts:249-252)", () => {
  it("keeps the two counters", () => {
    expect(record("KALSA_IDLE_STALL", '{"idleMs":120000,"tokenSilenceMs":null}')).toEqual({
      idleMs: 120000,
      tokenSilenceMs: null,
    });
  });
});

describe("KALSA_IOS_BG (iosBackgroundGuard.ts)", () => {
  it("keeps the two ops and drops anything else", () => {
    expect(record("KALSA_IOS_BG", '{"op":"abort"}')).toEqual({ op: "abort" });
    expect(record("KALSA_IOS_BG", '{"op":"reload"}')).toEqual({ op: "reload" });
    expect(record("KALSA_IOS_BG", '{"op":"stop"}')).toEqual({});
  });
});

describe("KALSA_IOS_MEM (iosMemoryGuard.ts)", () => {
  it("keeps the three ops, with a reason only on skip", () => {
    expect(record("KALSA_IOS_MEM", '{"op":"release"}')).toEqual({ op: "release" });
    expect(record("KALSA_IOS_MEM", '{"op":"deferred"}')).toEqual({ op: "deferred" });
    expect(record("KALSA_IOS_MEM", '{"op":"skip","reason":"remote"}')).toEqual({
      op: "skip",
      reason: "remote",
    });
    expect(record("KALSA_IOS_MEM", '{"op":"skip","reason":"no-engine"}')).toEqual({
      op: "skip",
      reason: "no-engine",
    });
  });

  it("drops an op or reason the plan never returns", () => {
    expect(record("KALSA_IOS_MEM", '{"op":"defer"}')).toEqual({});
    expect(record("KALSA_IOS_MEM", '{"op":"skip","reason":"because"}')).toEqual({
      op: "skip",
    });
  });
});

describe("KALSA_GOVERNOR_COMPLETION (governorObservation.ts, Stage 0)", () => {
  // A real row from the actual builder — the same object the service logs
  // (completionLogRow: the row minus the file-only win ring). The stats
  // fixture mirrors the engine test's Partial-spread helper.
  const stats = (over: Partial<GovernorObservationStats>): GovernorObservationStats =>
    ({
      decode_hops: 3,
      decode_tokens_cpu: 7,
      decode_tokens_npu: 89,
      decode_tokens_gpu: 0,
      decode_us_cpu: 400_000,
      decode_us_npu: 5_000_000,
      decode_us_gpu: 0,
      decode_paced_ms: 250,
      decode_paced_tokens: 12,
      decode_pacing_duty_last: 0.9375,
      decode_pacing_headroom_last: 0.42,
      decode_hop_rule: "heat_rank",
      decode_first_step_ms: 1000,
      decode_last_step_ms: 7000,
      decode_first_sample: [32, null, 0.1, 120, 0, 900, null, 55, 88, 70, 0.4, 0, 1],
      decode_batt_sysfs: [1, 301, 1, 2],
      decode_zone_trips: [108, 115, 95, 95, null, null],
      decode_window_samples: [],
      decode_window_samples_overflow: false,
      engine_prefill: "GPU",
      prefill_ms: 1840,
      thermal_state: "FAST",
      state_source: "battery",
      platform_thermal_status: -1,
      ...over,
    }) as GovernorObservationStats;
  const realRow = () =>
    completionLogRow(
      buildObservationRow(
        null,
        stats({}),
        {
          prompt_n: 512,
          predicted_n: 96,
          predicted_ms: 6000,
          predicted_per_second: 16,
          route_chunks: [
            {
              index: 0,
              requested: "auto",
              actual: "gpu",
              tokens: 512,
              prefill_ms: 1840,
              forced: false,
              layers_device: "HTP0",
            },
          ],
        },
        { batt_temp_tenths_c: 301, batt_level_pct: 88, plugged: false },
        { turnId: "42", round: 1, attempt: 1, gap: false, model: "lfm2.5-1.2b", soc: "SM8550" },
      ),
    );

  it("projects a real completion row through the closed schema", () => {
    const projected = record(
      "KALSA_GOVERNOR_COMPLETION",
      JSON.stringify(realRow()),
    ) as Record<string, unknown>;
    expect(projected).toMatchObject({
      t: "42",
      round: 1,
      attempt: 1,
      gap: 0,
      first_row: 1,
      state: "FAST",
      src: "battery",
      batt: 301,
      level: 88,
      plugged: 0,
      prompt_n: 512,
      pred_n: 96,
      pps: 16,
      // The route label and the device that actually ran: both survive, and
      // they are allowed to disagree (a phone NPU load reads GPU / HTP0).
      engine_prefill: "GPU",
      prefill_ms: 1840,
      prefill_dev: ["HTP0"],
      wall: [1000, 7000],
      bsys: [1, 301, 1, 2],
      trips: [108, 115, 95, 95, null, null],
      rule: "heat_rank",
      win_ovf: 0,
    });
    // The exact-length arrays survive whole.
    expect(projected.first).toHaveLength(13);
    expect(projected.tok).toEqual([7, 0, 89]);
  });

  it("keeps a prefill engine outside the binding's closed set out", () => {
    const row = { ...realRow(), engine_prefill: "HTP0" } as Record<string, unknown>;
    expect(
      (record("KALSA_GOVERNOR_COMPLETION", JSON.stringify(row)) as Record<string, unknown>)
        .engine_prefill,
    ).toBeUndefined();
  });

  it("drops a device array that is over-long or not a bounded identifier", () => {
    const project = (prefill_dev: unknown) =>
      (
        record(
          "KALSA_GOVERNOR_COMPLETION",
          JSON.stringify({ ...realRow(), prefill_dev }),
        ) as Record<string, unknown>
      ).prefill_dev;
    // The real case: several chunks across two devices.
    expect(project(["GPUOpenCL", "HTP0"])).toEqual(["GPUOpenCL", "HTP0"]);
    expect(project(Array(9).fill("HTP0"))).toBeUndefined();
    expect(project(["HTP0; rm -rf /"])).toBeUndefined();
    expect(project([7])).toBeUndefined();
    expect(project("HTP0")).toBeUndefined();
    // A null device list (no prefill ran, or an older binding) stays null.
    expect(project(null)).toBeNull();
  });

  it("drops a truncated array field, not the line", () => {
    const row = { ...realRow(), tok: [1, 2] } as Record<string, unknown>;
    const projected = record(
      "KALSA_GOVERNOR_COMPLETION",
      JSON.stringify(row),
    ) as Record<string, unknown>;
    expect(projected.tok).toBeUndefined();
    expect(projected.us).toEqual([400_000, 0, 5_000_000]);
  });

  it("drops a label outside the engine's closed sets", () => {
    const row = { ...realRow(), state: "HOT" } as Record<string, unknown>;
    expect((record("KALSA_GOVERNOR_COMPLETION", JSON.stringify(row)) as Record<string, unknown>).state).toBeUndefined();
  });
});

describe("KALSA_GOVERNOR_BATTERY_SYSFS (binding rn-governor.cpp)", () => {
  it("keeps the probe's four numbers", () => {
    expect(
      record("KALSA_GOVERNOR_BATTERY_SYSFS", '{"temp_ok":1,"temp_tenths_c":301,"status_ok":1,"status":2}'),
    ).toEqual({ temp_ok: 1, temp_tenths_c: 301, status_ok: 1, status: 2 });
  });
});

describe("KALSA_GOVERNOR_LEARNED (governorLearned.ts, Stage 1)", () => {
  // The payload the store actually writes, numbers and nulls only.
  const learned = (over: string = "") =>
    record(
      "KALSA_GOVERNOR_LEARNED",
      `{"tps_cpu":13,"tps_gpu":21,"tps_npu":16,` +
        `"prefill_tps_cpu":null,"prefill_tps_gpu":1200,"prefill_tps_npu":205,` +
        `"heat_cpu":9.125,"heat_gpu":4,"heat_npu":1.375,"heat_bg":0.5,` +
        `"heat_sigma":0.2,"heat_rows":7,"heat_rejects":1,"breaker":0,` +
        `"breaker_hold_ms":null${over}}`,
    );

  it("keeps the learned numbers and the nullable cells", () => {
    expect(learned()).toEqual({
      tps_cpu: 13,
      tps_gpu: 21,
      tps_npu: 16,
      prefill_tps_cpu: null,
      prefill_tps_gpu: 1200,
      prefill_tps_npu: 205,
      heat_cpu: 9.125,
      heat_gpu: 4,
      heat_npu: 1.375,
      heat_bg: 0.5,
      heat_sigma: 0.2,
      heat_rows: 7,
      heat_rejects: 1,
      breaker: 0,
      breaker_hold_ms: null,
    });
  });

  it("keeps a latched breaker's remaining hold", () => {
    const latched = record(
      "KALSA_GOVERNOR_LEARNED",
      '{"breaker":1,"breaker_hold_ms":3600000}',
    );
    expect(latched).toEqual({ breaker: 1, breaker_hold_ms: 3600000 });
  });

  it("drops a field that is not a finite number", () => {
    const out = record(
      "KALSA_GOVERNOR_LEARNED",
      '{"tps_cpu":13,"heat_gpu":"3.2 C/1k","heat_rows":7}',
    );
    expect(out).toEqual({ tps_cpu: 13, heat_rows: 7 });
  });
});

describe("a maximal KALSA_GOVERNOR_PLAN survives the whole report path", () => {
  // Every field at the widest value its rule allows: 17-digit doubles and the
  // enum values that carry the most characters.
  const maximal = {
    gpu_fit: "NoFit",
    decode_repack: true,
    required_mib_with_repack: 4358.700000000001,
    required_mib_without_repack: 2998.0600000000004,
    available_mib: 3640.5000000000005,
    bench_norepack_forced: false,
    npu_device: "HTP0",
    npu_fallback: null,
    npu_lane: "auto",
    npu_fit: "NoFit",
    available_src: "cached",
    pacing_start: 0.9876543210987654,
    pacing_full: 0.9999999999999999,
    npu_price: "with_gpu",
    gpu_leg: true,
  };

  it("is past the free-text clip, and comes out whole and parseable", () => {
    const record = formatRecord("KALSA_GOVERNOR_PLAN", maximal) as string;
    expect(record.length).toBeGreaterThan(300);
    expect(record.length).toBeLessThanOrEqual(1024);
    const line = finalizeRecord(record) as string;
    const payload = line.slice(line.indexOf(" ") + 1);
    expect(JSON.parse(payload.slice(payload.indexOf(" ") + 1))).toEqual(maximal);
  });
});
