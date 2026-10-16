/**
 * What one Stage 0 observation row can teach the learned store
 * (learning-governor DESIGN.md 5.6): the per-leg decode speeds, the prefill
 * speed of the device that actually ran the prompt (M4's seam), and at most
 * one heat fit row.
 *
 * Pure and read-only over the row: a row that cannot price a fit is not an
 * error, it is a completion this store learns nothing from.
 */
import type { GovernorObservationRow } from "./governorObservation";
import {
  HEAT_COOLING_COLUMN,
  HEAT_LEG_COLUMN,
  HEAT_PRE_GPU_COLUMN,
  HEAT_PROMPT_COLUMN,
  HEAT_WALL_COLUMN,
  HEAT_COLUMNS,
  type Leg,
} from "./governorLearnedFit";

/** The shipped row's hop, in tokens (rn-legs-table.cpp k_rows): the fallback
 *  cadence when a completion's own windows do not show one. */
export const SHIPPED_HOP_TOKENS = 32;
/** DESIGN 5.6's ">= 2 x hop" evidence rule for a per-leg speed sample: the
 *  row's own cadence doubled, not a constant — a bench arm that doubles the
 *  hop has to pay for it, and one that halves it earns the weaker floor. */
export const speedEvidenceTokens = (hopTokens: number): number => 2 * hopTokens;
/** Below this the prefill ms reading is dominated by fixed overhead rather than
 *  by the prompt. */
export const PREFILL_EVIDENCE_TOKENS = 32;
/** The binding's closed layer-device literals (llama-ext.h:508-524), mapped to
 *  the leg whose speed they price. An unrecognized device is not learned. */
const PREFILL_DEVICE_LEG: Record<string, Leg> = {
  HTP0: "npu",
  GPUOpenCL: "gpu",
  CPU: "cpu",
};

export type LearnedInputs = {
  /** Per-leg decode speed in tok/s; null where the leg's evidence floor was
   *  not met on this completion. */
  decodeTps: Record<Leg, number | null>;
  /** The prefill device whose speed this completion priced, and its tok/s. */
  prefill: { leg: Leg; tps: number } | null;
  /** The heat fit row: the design matrix and y = 30 (h_last - h_first). */
  heat: { x: number[]; y: number } | null;
};

/** 13-cell window sample (rn-governor-samples.h): cells 0/1 are the cumulative
 *  token count and the leg that ran the window's last step, cell 2 the forecast
 *  at that boundary. */
const WINDOW_TOKENS = 0;
const WINDOW_LEG = 1;
const WINDOW_HEADROOM = 2;
/** 3 is the binding's explicit gpu-coolmode marker: the engine books those
 *  tokens under decode_tokens_cpu, so the window's leg is unknown here and the
 *  tokens are left uncharged rather than mispriced to the CPU. */
const LEG_COOLMODE_MARKER = 3;
const TOKENS_PER_UNIT = 1000;
const MS_PER_MINUTE = 60_000;
/** skin = 36.5 + 30·h (DESIGN 5.3), so Δh of 0.1 is 3 C. */
const C_PER_HEADROOM = 30;

const cell = (window: Array<number | null>, index: number): number | null => {
  const value = window[index];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
};

/** A finite headroom the engine could read: 0 is blind (no forecast to
 *  attribute heat to) and null is absent, so neither is a measurement. */
const forecast = (window: Array<number | null>): number | null => {
  const h = cell(window, WINDOW_HEADROOM);
  return h !== null && h > 0 ? h : null;
};

/** The hop this completion actually ran at: the first full window's token
 *  delta, since the binding records a sample every `hop` tokens. A completion
 *  shorter than one window (or one whose ring overflowed) shows none, so the
 *  shipped cadence stands. */
function hopTokens(row: GovernorObservationRow): number {
  for (let i = 1; i < row.win.length; i += 1) {
    const tokens = cell(row.win[i], WINDOW_TOKENS);
    const previous = cell(row.win[i - 1], WINDOW_TOKENS);
    if (tokens !== null && previous !== null && tokens > previous) {
      return tokens - previous;
    }
  }
  return SHIPPED_HOP_TOKENS;
}

function decodeSpeeds(row: GovernorObservationRow): Record<Leg, number | null> {
  const speeds: Record<Leg, number | null> = { cpu: null, gpu: null, npu: null };
  const floor = speedEvidenceTokens(hopTokens(row));
  for (const [index, leg] of (["cpu", "gpu", "npu"] as const).entries()) {
    const tokens = row.tok[index];
    const micros = row.us[index];
    if (tokens < floor || micros <= 0) continue;
    speeds[leg] = (tokens * 1e6) / micros;
  }
  return speeds;
}

/** The prefill speed of the device that ran the prompt. One device only: the
 *  row carries the DISTINCT devices, not a per-device token split, so a
 *  chunked prefill across two of them prices neither. */
function prefillSpeed(row: GovernorObservationRow): LearnedInputs["prefill"] {
  const devices = row.prefill_dev;
  if (!devices || devices.length !== 1) return null;
  const leg = PREFILL_DEVICE_LEG[devices[0]];
  if (!leg) return null;
  const tokens = row.prompt_n;
  if (tokens === null || tokens < PREFILL_EVIDENCE_TOKENS || row.prefill_ms === null) {
    return null;
  }
  if (!(row.prefill_ms > 0)) return null;
  return { leg, tps: (tokens * 1000) / row.prefill_ms };
}

/** One heat observation, anchored at the wake: the first window whose forecast
 *  is above 0. Blind and absent windows carry no heat attribution, so a
 *  completion that never wakes prices nothing. */
function heatRow(row: GovernorObservationRow): LearnedInputs["heat"] {
  if (row.prompt_n === null) return null;
  // Charging adds battery heat the fit has no column for, and the standing
  // rule is never to benchmark a charging phone.
  if (row.plugged === 1) return null;
  // A truncated ring drops windows, so the per-leg token counts would be short.
  if (row.win_ovf === 1) return null;
  const wallMs = row.wall[1] - row.wall[0];
  if (!(wallMs > 0)) return null;
  const hFirst = row.win.findIndex((window) => forecast(window) !== null);
  const last = row.win.length - 1;
  if (hFirst < 0 || hFirst >= last) return null;
  const start = forecast(row.win[hFirst]);
  const end = forecast(row.win[last]);
  // A blind endpoint is not a measurement of the leg's heat: y would be a
  // forecast drop, not a temperature rise.
  if (start === null || end === null) return null;

  const legTokens: Record<Leg, number> = { cpu: 0, gpu: 0, npu: 0 };
  for (let i = hFirst + 1; i <= last; i += 1) {
    const leg = cell(row.win[i], WINDOW_LEG);
    const tokens = cell(row.win[i], WINDOW_TOKENS);
    const previous = cell(row.win[i - 1], WINDOW_TOKENS);
    if (leg === null || tokens === null || previous === null) continue;
    if (leg === LEG_COOLMODE_MARKER) continue;
    const named = (["cpu", "gpu", "npu"] as const)[leg];
    if (named === undefined) continue;
    legTokens[named] += tokens - previous;
  }

  const x = Array<number>(HEAT_COLUMNS).fill(0);
  for (const leg of ["cpu", "gpu", "npu"] as const) {
    x[HEAT_LEG_COLUMN[leg]] = legTokens[leg] / TOKENS_PER_UNIT;
  }
  const devices = row.prefill_dev;
  const onGpu =
    devices !== null && devices.length === 1 && PREFILL_DEVICE_LEG[devices[0]] === "gpu";
  x[onGpu ? HEAT_PRE_GPU_COLUMN : HEAT_PROMPT_COLUMN] = row.prompt_n / TOKENS_PER_UNIT;
  // KNOWN BIEF, and it is the unsafe direction. The window samples carry no
  // time stamp, so both wall columns stand in the WHOLE completion's decode
  // span (T) for the post-wake one (t), with k = T/t > 1 the wake's share of
  // the completion. The fit then explains a cooling rate measured over t with
  // a predictor of size k*t, so the background coefficient reads bg_true/k —
  // DEFLATED by k, and a learned ucb can land below the 0.5 C/min prior.
  // Nothing reads this value yet (Stage 1 is shadow), which is exactly why it
  // has to be fixed before any number reaches the engine: the wake needs its
  // own clock, or the wall columns have to go.
  x[HEAT_WALL_COLUMN] = wallMs / MS_PER_MINUTE;
  x[HEAT_COOLING_COLUMN] = -start * x[HEAT_WALL_COLUMN];
  return { x, y: C_PER_HEADROOM * (end - start) };
}

/** Everything this row teaches, or null when it teaches nothing at all (a gap
 *  row's deltas span two completions).
 *
 *  Nothing is learned from a charging phone, speed included: charging adds
 *  battery heat no column can separate, and it changes the power path under a
 *  decode too — the standing rule is never to benchmark a charging phone. */
export function learnedInputsFromRow(row: GovernorObservationRow): LearnedInputs | null {
  if (row.gap === 1) return null;
  const charging = row.plugged === 1;
  return {
    decodeTps: charging ? { cpu: null, gpu: null, npu: null } : decodeSpeeds(row),
    prefill: charging ? null : prefillSpeed(row),
    heat: heatRow(row),
  };
}