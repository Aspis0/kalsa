/**
 * The Stage 0 observation row (learning-governor DESIGN.md 3.2): one JSON-line
 * row per completion, built from two GovernorStats snapshots. Pure data — the
 * caller owns the native read, the 2 s bound and the file. Privacy sentence:
 * numbers, nulls, ids and the engine's closed label sets only; never model
 * text, prompts or user content.
 *
 * Adapted from the spec's sketch to the binding as pushed at 861a3cc3: each
 * window sample is 13 cells (the applied forecast and status ride next to
 * duty_last, coordinator note 1), trips arrive already in C, the leg coding
 * carries gpu-coolmode as 3, and the stamps read 0 when no step ran.
 */
import type { GovernorStats } from "llama.rn";

/** The binding commit this row format (v:1) was built against; package.json
 *  pins the same sha. The row carries its own copy so a pulled observations
 *  file identifies its producer without the repo. */
export const OBSERVATION_BINDING_PIN = "d4754cb564d42d52381098e810396dcf88fa5d8e";

/**
 * The Stage 0 fields the 861a3cc3 wire carries. The binding's committed
 * lib/typescript build predates them, so they ride as a structural
 * extension of GovernorStats (same pattern as the npu_device cast in
 * LlamaService's emitGovernorTelemetry) until the binding's lib/ is
 * rebuilt; the JSI bridge answers them regardless.
 */
export type GovernorObservationStats = GovernorStats & {
  decode_us_cpu: number;
  decode_us_npu: number;
  decode_us_gpu: number;
  decode_first_step_ms: number;
  decode_last_step_ms: number;
  decode_first_sample: Array<number | null>;
  decode_batt_sysfs: Array<number | null>;
  decode_zone_trips: Array<number | null>;
  decode_window_samples: Array<Array<number | null>>;
  decode_window_samples_overflow: boolean;
};

/** The thermo profile the round pushed to the engine (nativeGovernorThermo's
 *  shape, LlamaService.ts); only these fields reach the row. */
export type ObservationThermo = {
  batt_temp_tenths_c: number;
  batt_level_pct: number;
  plugged: boolean;
  platform_thermal_status?: number;
};

export type ObservationIds = {
  turnId: string;
  round: number;
  attempt: number;
  /** The previous row's read was skipped (stop, pause, timeout): the deltas
   *  span two completions and the replay drops the row. */
  gap: boolean;
  model: string;
  soc: string;
};

export type ObservationCompletion = {
  prompt_n?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
};

export type GovernorObservationRow = {
  v: 1;
  t: string;
  round: number;
  attempt: number;
  gap: 0 | 1;
  fp: { model: string; soc: string; pin: string };
  first_row: 0 | 1;
  state: string;
  src: string;
  status: number;
  batt: number;
  level: number;
  plugged: 0 | 1;
  prompt_n: number | null;
  pred_n: number | null;
  pred_ms: number | null;
  pps: number | null;
  /** Monotonic ms stamps of the completion's first and last decode step
   *  (0 when no step ran — a stopped or paused-first-batch completion). */
  wall: [number, number];
  /** 13 cells, the decode_window_samples column order. */
  first: Array<number | null>;
  /** [temp_ok, temp tenths C | null, status_ok, status | null]. */
  bsys: Array<number | null>;
  /** Platform forecast headroom the policy last read (null = none). */
  hl: number | null;
  duty: number;
  paced: [number, number];
  tok: [number, number, number];
  /** Per-leg decode time in microseconds (deltas across rows). */
  us: [number, number, number];
  hops: number;
  rule: string | null;
  /** Passive-trip range in C per leg (null = leg without zones). */
  trips: Array<number | null>;
  /** One 13-cell row per committed hop window, oldest first. */
  win: Array<Array<number | null>>;
  win_ovf: 0 | 1;
};

const finiteOrNull = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const delta = (prev: number, now: number): number => now - prev;

const tripleDelta = (
  prev: GovernorObservationStats | null,
  stats: GovernorObservationStats,
  fields: readonly [
    "decode_tokens_cpu" | "decode_us_cpu",
    "decode_tokens_gpu" | "decode_us_gpu",
    "decode_tokens_npu" | "decode_us_npu",
  ],
): [number, number, number] =>
  prev === null
    ? [stats[fields[0]], stats[fields[1]], stats[fields[2]]]
    : [
        delta(prev[fields[0]], stats[fields[0]]),
        delta(prev[fields[1]], stats[fields[1]]),
        delta(prev[fields[2]], stats[fields[2]]),
      ];

/** One observation row. `prev` null (first row after a load/clear) emits the
 *  cumulative counter values with first_row:1; otherwise per-completion
 *  deltas. A NEGATIVE delta marks the row gap:1 — the engine zeroes its
 *  decode counters on a live cache clear, and a negative delta is the
 *  detectable symptom of a baseline that survived one (defence in depth
 *  under the resets at the clear sites; the replay drops gap rows). */
export function buildObservationRow(
  prev: GovernorObservationStats | null,
  stats: GovernorObservationStats,
  completion: ObservationCompletion,
  thermo: ObservationThermo,
  ids: ObservationIds,
): GovernorObservationRow {
  const gap = ids.gap;
  const pacedDelta = (key: "decode_paced_tokens" | "decode_paced_ms"): number =>
    prev === null ? stats[key] : delta(prev[key], stats[key]);
  const tok = tripleDelta(prev, stats, ["decode_tokens_cpu", "decode_tokens_gpu", "decode_tokens_npu"]);
  const us = tripleDelta(prev, stats, ["decode_us_cpu", "decode_us_gpu", "decode_us_npu"]);
  const paced: [number, number] = [pacedDelta("decode_paced_tokens"), pacedDelta("decode_paced_ms")];
  const hops = prev === null ? stats.decode_hops : delta(prev.decode_hops, stats.decode_hops);
  const counterReset = [...tok, ...us, ...paced, hops].some((value) => value < 0);
  return {
    v: 1,
    t: ids.turnId,
    round: ids.round,
    attempt: ids.attempt,
    gap: gap || counterReset ? 1 : 0,
    fp: { model: ids.model, soc: ids.soc, pin: OBSERVATION_BINDING_PIN },
    first_row: prev === null ? 1 : 0,
    state: stats.thermal_state,
    src: stats.state_source,
    status: stats.platform_thermal_status,
    batt: thermo.batt_temp_tenths_c,
    level: thermo.batt_level_pct,
    plugged: thermo.plugged ? 1 : 0,
    prompt_n: finiteOrNull(completion.prompt_n),
    pred_n: finiteOrNull(completion.predicted_n),
    pred_ms: finiteOrNull(completion.predicted_ms),
    pps: finiteOrNull(completion.predicted_per_second),
    wall: [stats.decode_first_step_ms, stats.decode_last_step_ms],
    first: stats.decode_first_sample,
    bsys: stats.decode_batt_sysfs,
    hl: stats.decode_pacing_headroom_last,
    duty: stats.decode_pacing_duty_last,
    paced,
    tok,
    us,
    hops,
    rule: stats.decode_hop_rule,
    trips: stats.decode_zone_trips,
    win: stats.decode_window_samples,
    win_ovf: stats.decode_window_samples_overflow ? 1 : 0,
  };
}

/** The KALSA_GOVERNOR_COMPLETION log line payload: the row minus the window
 *  ring, which is file-only (a pulled observations.jsonl carries it). */
export function completionLogRow(
  row: GovernorObservationRow,
): Omit<GovernorObservationRow, "win"> {
  const { win: _win, ...rest } = row;
  return rest;
}
