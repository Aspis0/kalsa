/**
 * The Stage 0 observation row builder (governorObservation.ts): per-completion
 * deltas, the first row's cumulative values, gap rows, null cells kept as
 * null, and the closed label sets the JSONL allows (coordinator note 7 — the
 * schema test checks membership, not "no strings").
 */
import fs from "fs";
import path from "path";
import {
  buildObservationRow,
  completionLogRow,
  OBSERVATION_BINDING_PIN,
  type GovernorObservationStats,
} from "../governorObservation";

const stats = (over: Partial<GovernorObservationStats>): GovernorObservationStats =>
  ({
    decode_hops: 0,
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
    decode_first_step_ms: 0,
    decode_last_step_ms: 0,
    decode_first_sample: Array<number | null>(13).fill(null),
    decode_batt_sysfs: [0, null, 0, null],
    decode_zone_trips: Array<number | null>(6).fill(null),
    decode_window_samples: [],
    decode_window_samples_overflow: false,
    thermal_state: "FAST",
    state_source: "battery",
    platform_thermal_status: -1,
    ...over,
  }) as GovernorObservationStats;

const ids = {
  turnId: "42",
  round: 1,
  attempt: 1,
  gap: false,
  model: "lfm2.5-1.2b",
  soc: "SM8550",
};
const thermo = {
  batt_temp_tenths_c: 301,
  batt_level_pct: 88,
  plugged: false,
};
const timings = {
  prompt_n: 512,
  predicted_n: 96,
  predicted_ms: 6000,
  predicted_per_second: 16,
};

test("first row: cumulative counters and first_row:1", () => {
  const row = buildObservationRow(
    null,
    stats({
      decode_tokens_cpu: 7,
      decode_tokens_npu: 89,
      decode_tokens_gpu: 0,
      decode_us_npu: 5_000_000,
      decode_hops: 3,
      decode_paced_tokens: 12,
      decode_paced_ms: 250,
      decode_first_step_ms: 1000,
      decode_last_step_ms: 7000,
    }),
    timings,
    thermo,
    ids,
  );
  expect(row.first_row).toBe(1);
  expect(row.tok).toEqual([7, 0, 89]);
  expect(row.us).toEqual([0, 0, 5_000_000]);
  expect(row.hops).toBe(3);
  expect(row.paced).toEqual([12, 250]);
  expect(row.wall).toEqual([1000, 7000]);
});

test("second row: deltas of tokens, us, hops, paced", () => {
  const prev = stats({
    decode_tokens_cpu: 7,
    decode_tokens_npu: 89,
    decode_tokens_gpu: 0,
    decode_us_npu: 5_000_000,
    decode_hops: 3,
    decode_paced_tokens: 12,
    decode_paced_ms: 250,
  });
  const row = buildObservationRow(
    prev,
    stats({
      decode_tokens_cpu: 7,
      decode_tokens_npu: 185,
      decode_tokens_gpu: 0,
      decode_us_npu: 11_000_000,
      decode_hops: 6,
      decode_paced_tokens: 24,
      decode_paced_ms: 500,
    }),
    timings,
    thermo,
    ids,
  );
  expect(row.first_row).toBe(0);
  expect(row.tok).toEqual([0, 0, 96]);
  expect(row.us).toEqual([0, 0, 6_000_000]);
  expect(row.hops).toBe(3);
  expect(row.paced).toEqual([12, 250]);
});

test("gap row, fingerprint, thermo and timing cells", () => {
  const row = buildObservationRow(
    null,
    stats({ decode_pacing_headroom_last: 0.42, decode_hop_rule: "heat_rank" }),
    { prompt_n: 10, predicted_n: undefined, predicted_ms: 5, predicted_per_second: undefined },
    thermo,
    { ...ids, gap: true },
  );
  expect(row.gap).toBe(1);
  expect(row.fp).toEqual({ model: "lfm2.5-1.2b", soc: "SM8550", pin: OBSERVATION_BINDING_PIN });
  expect(row.batt).toBe(301);
  expect(row.level).toBe(88);
  expect(row.plugged).toBe(0);
  // Absent timings cross as null, never 0 — 0 is a real value.
  expect(row.prompt_n).toBe(10);
  expect(row.pred_n).toBeNull();
  expect(row.pred_ms).toBe(5);
  expect(row.pps).toBeNull();
  expect(row.hl).toBe(0.42);
  expect(row.rule).toBe("heat_rank");
});

test("null cells of the observation arrays are kept as null", () => {
  const first = Array<number | null>(13).fill(null);
  first[0] = 32;
  first[12] = 0.9375;
  const row = buildObservationRow(
    null,
    stats({
      decode_first_sample: first,
      decode_batt_sysfs: [1, 301, 1, 2],
      decode_zone_trips: [108, 115, 95, 95, null, null],
      decode_window_samples: [first, Array<number | null>(13).fill(null)],
      decode_window_samples_overflow: true,
    }),
    timings,
    thermo,
    ids,
  );
  expect(row.first).toHaveLength(13);
  expect(row.first[0]).toBe(32);
  expect(row.first[1]).toBeNull();
  expect(row.bsys).toEqual([1, 301, 1, 2]);
  expect(row.trips).toEqual([108, 115, 95, 95, null, null]);
  expect(row.win).toHaveLength(2);
  expect(row.win[1][0]).toBeNull();
  expect(row.win_ovf).toBe(1);
});

test("labels stay inside the binding's closed sets", () => {
  const states = ["Unknown", "FAST", "WARM", "COOLMODE", "CRITICAL", "LOWBAT", "Invalid"];
  const sources = ["battery", "platform"];
  const rules = ["alternation", "headroom", "heat_rank", "gpu_burst"];
  for (const state of states) {
    expect(buildObservationRow(null, stats({ thermal_state: state }), timings, thermo, ids).state).toBe(state);
  }
  for (const src of sources) {
    expect(buildObservationRow(null, stats({ state_source: src }), timings, thermo, ids).src).toBe(src);
  }
  for (const rule of [...rules, null]) {
    expect(buildObservationRow(null, stats({ decode_hop_rule: rule }), timings, thermo, ids).rule).toBe(rule);
  }
});

test("a negative delta (a counter reset under a stale baseline) marks the row gap", () => {
  // A live cache clear zeroes the engine's counters; if a baseline survived
  // it, the symptom is a negative delta and the row must read gap:1 so the
  // replay drops it.
  const prev = stats({ decode_tokens_npu: 500, decode_us_npu: 30_000_000, decode_hops: 9 });
  const row = buildObservationRow(
    prev,
    stats({ decode_tokens_npu: 12, decode_us_npu: 900_000, decode_hops: 0 }),
    timings,
    thermo,
    ids,
  );
  expect(row.gap).toBe(1);
  expect(row.tok).toEqual([0, 0, -488]);
  // The same numbers with a null baseline are a normal first row.
  expect(buildObservationRow(null, stats({ decode_tokens_npu: 12 }), timings, thermo, ids).gap).toBe(0);
});

test("the pin constant tracks package.json's llama.rn dependency", () => {
  const pkg = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../../../package.json"), "utf8"),
  ) as { dependencies: { "llama.rn": string } };
  expect(pkg.dependencies["llama.rn"]).toContain(OBSERVATION_BINDING_PIN);
});

test("the log line is the row minus the win ring", () => {
  const row = buildObservationRow(null, stats({ decode_window_samples: [Array<number | null>(13).fill(null)] }), timings, thermo, ids);
  const logRow = completionLogRow(row) as Record<string, unknown>;
  expect(logRow.win).toBeUndefined();
  expect(logRow.win_ovf).toBe(0);
  expect(logRow.t).toBe("42");
  expect(Object.keys(row).some((key) => key === "win")).toBe(true);
});
