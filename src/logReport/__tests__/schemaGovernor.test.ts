/** Schema tests for the governor / thermal / stall tags. Payloads mirror the real emitters. */
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
