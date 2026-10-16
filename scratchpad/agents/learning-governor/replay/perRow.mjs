/**
 * One row's measurements: the derived wake start, the per-leg speed and
 * tokens, the headroom endpoints, and the feature vector and target of the
 * DESIGN 5.6 heat fit.
 */
import { COOLMODE_LEG, LEGS, WIN } from "./rows.mjs";
import { windowSeries } from "./windows.mjs";
import { prefillDeviceCase } from "./prefill.mjs";

/** AOSP skin map (DESIGN 5.3): skin = 36.5 + 30 h, so 30 x delta-h is the
 *  implied skin change in C. */
const SKIN_BASE_C = 36.5;
const SKIN_PER_HEADROOM = 30;

/** The DESIGN 5.6 heat design, in the units its coefficients are read. The
 *  key names are the row's feature keys, so the fit can address them without
 *  a second mapping table. */
export const HEAT_FEATURES = [
  { name: "npu_k", unit: "C per 1k NPU tokens" },
  { name: "gpu_k", unit: "C per 1k GPU tokens" },
  { name: "cpu_k", unit: "C per 1k CPU tokens" },
  { name: "prompt_k", unit: "C per 1k prompt tokens" },
  { name: "prefill_gpu_k", unit: "C per 1k GPU-prefilled prompt tokens" },
  { name: "wall_min", unit: "C per completion minute" },
  { name: "cool", unit: "C per (-h_wake x wall_min)" },
];

const perLegSpeed = (row) =>
  LEGS.map((leg, index) => {
    const tokens = row.tok[index];
    const us = row.us[index];
    return { leg, tokens, us, tokPerSec: us > 0 ? (tokens * 1e6) / us : null };
  });

/** Tokens per leg from the wake to the last window, starting one hop AFTER the
 *  wake boundary: the span ending at the wake boundary ran before the forecast
 *  woke, so counting it would charge a blind hop to the awake observation. The
 *  gpu-coolmode marker is booked apart - the engine charges those tokens to the
 *  CPU counters while saying the GPU ran them, so counting them as CPU would
 *  double-count a leg and mis-attribute its heat. */
function tokensFromWake(series, wakeIndex) {
  const buckets = { cpu: 0, gpu: 0, npu: 0, coolmode: 0, unattributed: 0 };
  if (wakeIndex < 0) return buckets;
  for (let index = wakeIndex + 1; index < series.legs.length; index += 1) {
    const leg = series.legs[index];
    if (leg === 0 || leg === 1 || leg === 2) buckets[LEGS[leg]] += series.spans[index];
    else if (leg === COOLMODE_LEG) buckets.coolmode += series.spans[index];
    else buckets.unattributed += series.spans[index];
  }
  return buckets;
}

/** Why a row cannot enter the heat fit, or null when it can. A row is out
 *  when the forecast never woke (no observation to start from), when a blind
 *  window sits inside the observed span (h is floored at 0, so the drop is
 *  censored and y would only be a lower bound), when the last headroom is
 *  absent, or when it carries no prompt token count for the prompt column. */
function fitExclusion({ wakeIndex, censored, hLast, promptK, absent }) {
  if (wakeIndex < 0) return "no wake: forecast absent or blind for the whole completion";
  if (censored) return "censored: blind window (h == 0) inside the observed span";
  if (hLast === null) return `no target: h_last absent (${absent} absent window${absent === 1 ? "" : "s"})`;
  if (promptK === null) return "no prompt token count for the prompt column";
  return null;
}

export function measureRow(row, index) {
  const series = windowSeries(row);
  const headroom = series.headroom;
  const wakeIndex = headroom.findIndex((value) => typeof value === "number" && value > 0);
  const lastIndex = headroom.length - 1;
  const hWake = wakeIndex >= 0 ? headroom[wakeIndex] : null;
  const hLast = headroom[lastIndex] ?? null;
  const tokens = tokensFromWake(series, wakeIndex);
  const wallMin = (row.wall[1] - row.wall[0]) / 60000;
  const promptK = typeof row.prompt_n === "number" ? row.prompt_n / 1000 : null;
  const prefillCase = prefillDeviceCase(row);
  const absent = headroom.filter((value) => value === null).length;
  const censored = wakeIndex >= 0 && headroom.slice(wakeIndex).some((value) => value === 0);

  return {
    index,
    turn: row.t,
    round: row.round,
    predN: row.pred_n ?? null,
    pps: row.pps ?? null,
    pacedTokens: row.paced[0],
    wallMin,
    legSpeed: perLegSpeed(row),
    windows: headroom.length,
    legWindows: series.legWindows,
    /** The distinct positive boundary steps the ring took - a cheap check that
     *  it stepped by the design's 32-token hop. */
    steps: [...new Set(series.spans.filter((span) => span > 0))],
    headroom,
    wakeIndex,
    hWake,
    skinWakeC: hWake === null ? null : SKIN_BASE_C + SKIN_PER_HEADROOM * hWake,
    hFirst: headroom[0] ?? null,
    hLast,
    hLastFromRow: row.hl ?? null,
    blindWindows: headroom.filter((value) => value === 0).length,
    absentWindows: absent,
    tokensFromWake: tokens,
    /** The ring's own coverage: the cumulative count at its last boundary. A
     *  row with an empty ring covers 0, not "nothing". */
    tokensCoveredByWindows: series.tokensAtBoundary[lastIndex] ?? 0,
    decodeTokens: row.tok.reduce((sum, value) => sum + value, 0),
    censored,
    prefillCase,
    hfAge: row.first[WIN.headroomAge],
    hAge: series.hAge,
    statusAge: series.statusAge,
    appAge: series.appAge,
    rise: series.rise,
    noise: series.noise,
    features: {
      npu_k: tokens.npu / 1000,
      gpu_k: tokens.gpu / 1000,
      cpu_k: tokens.cpu / 1000,
      prompt_k: promptK ?? 0,
      // WHY the device and not engine_prefill: a phone NPU load labels the
      // route GPU while Hexagon runs the matmuls, so only a GPU device label
      // puts prefill heat on the GPU.
      prefill_gpu_k: prefillCase === "gpu" ? (promptK ?? 0) : 0,
      wall_min: wallMin,
      cool: hWake === null ? 0 : -hWake * wallMin,
    },
    targetC: hWake === null || hLast === null ? null : SKIN_PER_HEADROOM * (hLast - hWake),
    fitExclusion: fitExclusion({ wakeIndex, censored, hLast, promptK, absent }),
  };
}