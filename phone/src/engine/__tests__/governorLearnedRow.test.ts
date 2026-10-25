/**
 * What one Stage 0 row teaches the learned store (governorLearnedRow.ts):
 * the per-leg decode speeds and their evidence floor, the prefill speed of the
 * device that actually ran the prompt, and the heat fit row anchored at the
 * wake sample.
 */
import { buildObservationRow, type GovernorObservationRow } from "../../engine/governorObservation";
import type { GovernorObservationStats } from "../../engine/governorObservation";
import {
  HEAT_COOLING_COLUMN,
  HEAT_LEG_COLUMN,
  HEAT_PRE_GPU_COLUMN,
  HEAT_PROMPT_COLUMN,
  HEAT_WALL_COLUMN,
} from "../../engine/governorLearnedFit";
import {
  learnedInputsFromRow,
  PREFILL_EVIDENCE_TOKENS,
  SHIPPED_HOP_TOKENS,
  speedEvidenceTokens,
} from "../../engine/governorLearnedRow";

/** A window sample in the binding's 13-cell order (rn-governor-samples.h). */
const window = (
  tokens: number | null,
  leg: number | null,
  headroom: number | null,
): Array<number | null> => [
  tokens,
  leg,
  headroom,
  0,
  0,
  0,
  null,
  null,
  null,
  null,
  null,
  null,
  1,
];

const stats = (over: Partial<GovernorObservationStats>): GovernorObservationStats =>
  ({
    decode_hops: 4,
    decode_tokens_cpu: 0,
    decode_tokens_npu: 0,
    decode_tokens_gpu: 0,
    decode_us_cpu: 0,
    decode_us_npu: 0,
    decode_us_gpu: 0,
    decode_paced_ms: 0,
    decode_paced_tokens: 0,
    decode_pacing_duty_last: 1,
    decode_pacing_headroom_last: null,
    decode_hop_rule: null,
    decode_first_step_ms: 1000,
    decode_last_step_ms: 61000,
    decode_first_sample: window(32, null, 0),
    decode_batt_sysfs: [0, null, 0, null],
    decode_zone_trips: Array<number | null>(6).fill(null),
    decode_window_samples: [],
    decode_window_samples_overflow: false,
    thermal_state: "FAST",
    state_source: "battery",
    platform_thermal_status: -1,
    ...over,
  }) as GovernorObservationStats;

const row = (over: Partial<GovernorObservationRow> = {}): GovernorObservationRow => ({
  v: 1,
  t: "7",
  round: 1,
  attempt: 1,
  gap: 0,
  fp: { model: "23127PN0CG", soc: "SM8650", pin: "abc123" },
  first_row: 0,
  state: "FAST",
  src: "battery",
  status: 0,
  batt: 320,
  level: 80,
  plugged: 0,
  prompt_n: 512,
  pred_n: 160,
  pred_ms: 8000,
  pps: 20,
  engine_prefill: "GPU",
  prefill_ms: 2500,
  prefill_dev: ["HTP0"],
  wall: [1000, 61000],
  first: window(32, null, 0),
  bsys: [0, null, 0, null],
  hl: 0.12,
  duty: 1,
  paced: [0, 0],
  tok: [0, 0, 160],
  us: [0, 0, 8_000_000],
  hops: 4,
  rule: "heat_rank",
  trips: Array<number | null>(6).fill(null),
  win: [
    window(32, null, 0),
    window(64, 2, 0.1),
    window(96, 2, 0.12),
    window(128, 1, 0.15),
  ],
  win_ovf: 0,
  ...over,
});

/** The inputs of a row that teaches something; a gap row is the only one the
 *  module refuses outright, and that case calls learnedInputsFromRow. */
const inputs = (over: Partial<GovernorObservationRow> = {}) => {
  const learned = learnedInputsFromRow(row(over));
  if (!learned) throw new Error("expected a row with something to learn");
  return learned;
};

describe("decode speed", () => {
  it("prices a leg from its own token and microsecond deltas", () => {
    const learned = inputs({ tok: [0, 96, 160], us: [0, 4_000_000, 8_000_000] });
    expect(learned?.decodeTps.gpu).toBeCloseTo(24, 10);
    expect(learned?.decodeTps.npu).toBeCloseTo(20, 10);
    expect(learned?.decodeTps.cpu).toBeNull();
  });

  it("skips a leg under two windows of evidence", () => {
    // The fixture's windows run at the shipped 32-token hop.
    const floor = speedEvidenceTokens(SHIPPED_HOP_TOKENS);
    const learned = inputs({
      tok: [0, floor - 1, floor],
      us: [0, 1_000_000, 4_000_000],
    });
    expect(learned?.decodeTps.gpu).toBeNull();
    expect(learned?.decodeTps.npu).toBeCloseTo(floor / 4, 10);
  });

  it("scales the floor with the hop the row actually ran at", () => {
    // A bench arm at a 64-token hop owes twice the evidence: 96 tokens is
    // under the floor there and would have passed the shipped 64.
    const slow = inputs({
      tok: [0, 96, 160],
      us: [0, 4_000_000, 8_000_000],
      win: [window(32, null, 0), window(96, 2, 0.1), window(160, 2, 0.12)],
    });
    expect(slow.decodeTps.gpu).toBeNull();
    const enough = inputs({
      tok: [0, 128, 256],
      us: [0, 4_000_000, 8_000_000],
      win: [window(32, null, 0), window(96, 2, 0.1), window(160, 2, 0.12)],
    });
    expect(enough.decodeTps.gpu).not.toBeNull();
    // ...and a faster cadence earns the weaker floor it asks for.
    const fast = inputs({
      tok: [0, 32, 40],
      us: [0, 1_000_000, 2_000_000],
      win: [window(32, null, 0), window(48, 2, 0.1), window(64, 2, 0.12)],
    });
    expect(fast.decodeTps.gpu).toBeCloseTo(32, 10);
  });

  it("learns no speed from a charging phone", () => {
    // Charging changes the power path under a decode as well as the battery
    // heat: the standing rule is never to benchmark a charging phone.
    const charging = inputs({ plugged: 1 });
    expect(charging.decodeTps).toEqual({ cpu: null, gpu: null, npu: null });
    expect(charging.prefill).toBeNull();
    expect(charging.heat).toBeNull();
  });

  it("skips a leg whose clock never ran", () => {
    expect(inputs({ tok: [100, 100, 100], us: [0, 0, 0] })?.decodeTps.npu).toBeNull();
  });
});

describe("prefill speed", () => {
  it("prices the device that ran the prompt", () => {
    // 512 tokens in 2500 ms on HTP0 is the NPU lane's prefill.
    expect(inputs()?.prefill).toEqual({ leg: "npu", tps: (512 / 2500) * 1000 });
  });

  it("prices a GPU prefill from the device string, not the route label", () => {
    // engine_prefill reads GPU while the layers sat on HTP0 (llama-ext.h:508):
    // only prefill_dev names the device that ran the matmuls.
    const learned = inputs({ engine_prefill: "GPU", prefill_dev: ["GPUOpenCL"] });
    expect(learned?.prefill).toEqual({ leg: "gpu", tps: (512 / 2500) * 1000 });
  });

  it("prices nothing when the prompt ran on two devices", () => {
    expect(inputs({ prefill_dev: ["HTP0", "GPUOpenCL"] })?.prefill).toBeNull();
  });

  it("prices nothing for a device the binding does not name", () => {
    expect(inputs({ prefill_dev: ["SomeBackend0"] })?.prefill).toBeNull();
    expect(inputs({ prefill_dev: null })?.prefill).toBeNull();
  });

  it("prices nothing under the prefill evidence floor or a zero clock", () => {
    const few = inputs({
      prompt_n: PREFILL_EVIDENCE_TOKENS - 1,
      prefill_dev: ["HTP0"],
    });
    expect(few?.prefill).toBeNull();
    expect(inputs({ prefill_ms: 0 })?.prefill).toBeNull();
    expect(inputs({ prefill_ms: null })?.prefill).toBeNull();
  });
});

describe("heat fit row", () => {
  it("anchors at the wake sample and books each window on the leg that ran it", () => {
    const learned = inputs();
    const heat = learned?.heat;
    expect(heat).not.toBeNull();
    // Wake is window 1 (h = 0.1); windows 2 and 3 add 32 tokens each.
    expect(heat?.x[HEAT_LEG_COLUMN.npu]).toBeCloseTo(32 / 1000, 10);
    expect(heat?.x[HEAT_LEG_COLUMN.gpu]).toBeCloseTo(32 / 1000, 10);
    expect(heat?.x[HEAT_LEG_COLUMN.cpu]).toBe(0);
    // h_last 0.15 - h_first 0.1 = 0.05 -> 1.5 C.
    expect(heat?.y).toBeCloseTo(1.5, 10);
  });

  it("carries the prompt on the non-GPU prefill column and the wall time", () => {
    const heat = inputs()?.heat;
    expect(heat?.x[HEAT_PROMPT_COLUMN]).toBeCloseTo(0.512, 10);
    expect(heat?.x[HEAT_PRE_GPU_COLUMN]).toBe(0);
    const wallMin = (61000 - 1000) / 60000;
    expect(heat?.x[HEAT_WALL_COLUMN]).toBeCloseTo(wallMin, 10);
    expect(heat?.x[HEAT_COOLING_COLUMN]).toBeCloseTo(-0.1 * wallMin, 10);
  });

  it("moves the prompt onto the GPU prefill column when the GPU ran it", () => {
    const heat = inputs({ prefill_dev: ["GPUOpenCL"] })?.heat;
    expect(heat?.x[HEAT_PRE_GPU_COLUMN]).toBeCloseTo(0.512, 10);
    expect(heat?.x[HEAT_PROMPT_COLUMN]).toBe(0);
  });

  it("prices nothing without a wake, and nothing with a blind endpoint", () => {
    // Every window blind: h == 0 is "the forecast says nothing", not a
    // measurement to fit heat against.
    expect(
      inputs({
        win: [window(32, null, 0), window(64, 2, 0), window(96, 2, 0.1)],
      }).heat,
    ).toBeNull();
    // Absent forecast (null) is not a wake either.
    expect(
      inputs({
        win: [window(32, null, null), window(64, 2, null), window(96, 2, 0.1)],
      }).heat,
    ).toBeNull();
    // The last window going blind again is a forecast drop, not a rise.
    expect(
      inputs({
        win: [window(32, null, 0), window(64, 2, 0.1), window(96, 2, 0)],
      }).heat,
    ).toBeNull();
    // A wake on the last window measures nothing after itself.
    expect(
      inputs({ win: [window(32, null, 0), window(64, 2, 0.1)] }).heat,
    ).toBeNull();
  });

  it("leaves a coolmode-marked window's tokens uncharged", () => {
    // Leg 3 is the binding's explicit gpu-coolmode marker: the engine books
    // those tokens under decode_tokens_cpu, so charging them to the CPU would
    // misprice the CPU heat coefficient. The window after it still counts.
    const heat = inputs({
      win: [
        window(32, null, 0),
        window(64, 2, 0.1),
        window(96, 3, 0.12),
        window(128, 2, 0.15),
      ],
    }).heat;
    expect(heat?.x[HEAT_LEG_COLUMN.cpu]).toBe(0);
    expect(heat?.x[HEAT_LEG_COLUMN.gpu]).toBe(0);
    expect(heat?.x[HEAT_LEG_COLUMN.npu]).toBeCloseTo(32 / 1000, 10);
  });

  it("prices nothing while charging, on a gap row, or with a truncated ring", () => {
    expect(inputs({ plugged: 1 }).heat).toBeNull();
    expect(inputs({ win_ovf: 1 }).heat).toBeNull();
    expect(inputs({ prompt_n: null }).heat).toBeNull();
    expect(learnedInputsFromRow(row({ gap: 1 }))).toBeNull();
  });

  it("prices nothing without a positive wall span", () => {
    expect(inputs({ wall: [1000, 1000] }).heat).toBeNull();
  });

  it("builds the same row the service would have logged", () => {
    // The end-to-end shape: a real buildObservationRow output, which is what
    // the completion hook hands the store.
    const built = buildObservationRow(
      null,
      stats({
        decode_tokens_npu: 160,
        decode_us_npu: 8_000_000,
        decode_first_step_ms: 1000,
        decode_last_step_ms: 61000,
        decode_window_samples: [
          window(32, null, 0),
          window(64, 2, 0.1),
          window(96, 2, 0.12),
          window(128, 1, 0.15),
        ],
      }),
      { prompt_n: 512, predicted_n: 160, predicted_ms: 8000, predicted_per_second: 20 },
      { batt_temp_tenths_c: 320, batt_level_pct: 80, plugged: false },
      { turnId: "7", round: 1, attempt: 1, gap: false, model: "23127PN0CG", soc: "SM8650" },
    );
    const learned = learnedInputsFromRow(built);
    expect(learned?.decodeTps.npu).toBeCloseTo(20, 10);
    expect(learned?.heat?.y).toBeCloseTo(1.5, 10);
  });
});