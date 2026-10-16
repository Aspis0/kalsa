/**
 * Turn one row's window ring into the series and per-window statistics the
 * report reads: token spans, the headroom series, the freshness ages, the
 * per-leg zone-temperature rise, and the forecast noise inside a row.
 */
import { HOT_CELL, LEGS, WIN } from "./rows.mjs";

/**
 * The ring stores the CUMULATIVE token count at each window boundary
 * (0, 32, 64, ... and win[0] is the first decode step's own sample), so a
 * window's span is the difference with the previous boundary and win[0]
 * spans nothing. The leg that ran the span is leg_prev at its end boundary -
 * which is also why the span ENDING at a boundary ran before that boundary's
 * forecast reading: the span ending at the wake boundary ran blind.
 */
export function tokenSpans(win) {
  return win.map((sample, index) => sample[WIN.tokens] - (index === 0 ? 0 : win[index - 1][WIN.tokens]));
}

/**
 * Per-leg zone hot-temperature rise across consecutive windows. A null
 * temperature is a dark zone (rn-thermal-legs.cpp:108, "one dark zone makes
 * the whole leg unknown"), so the pair is excluded from zone statistics
 * rather than treated as a zero rise.
 */
export function zoneRise(win) {
  const rise = {};
  for (const leg of LEGS) {
    const values = [];
    let dark = 0;
    const cell = HOT_CELL[leg];
    for (let index = 1; index < win.length; index += 1) {
      const before = win[index - 1][cell];
      const after = win[index][cell];
      if (before === null || after === null) {
        dark += 1;
        continue;
      }
      values.push(after - before);
    }
    rise[leg] = {
      pairs: values.length,
      dark,
      min: values.length > 0 ? Math.min(...values) : null,
      max: values.length > 0 ? Math.max(...values) : null,
      mean: values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null,
    };
  }
  return rise;
}

/**
 * Forecast noise inside one row, in C: the residual of a straight line fitted
 * through the row's own headroom series. WHY detrend: a successive difference
 * mixes real heating with forecast noise, so it is only an upper bound; the
 * residual of the within-row trend is the noise alone. WHY blind windows drop
 * out: `h == 0` is the forecast saying it has nothing (a floor, not a
 * reading) and `h == null` is no reading at all (DESIGN 3.2), and fitting a
 * line through either would measure the floor, not the noise. The skin map
 * `skin = 36.5 + 30 h` (DESIGN 5.3) turns headroom units into C.
 */
export function headroomNoise(headroom) {
  const points = headroom
    .map((value, index) => ({ index, value }))
    .filter((point) => typeof point.value === "number" && point.value !== 0);
  if (points.length < 3) return { points: points.length, sigmaC: null, maxAbsC: null };
  const n = points.length;
  const meanX = points.reduce((sum, p) => sum + p.index, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.value, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (const p of points) {
    sxy += (p.index - meanX) * (p.value - meanY);
    sxx += (p.index - meanX) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const residuals = points.map((p) => p.value - (meanY + slope * (p.index - meanX)));
  const sigmaC = Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / n) * 30;
  return { points: n, sigmaC, maxAbsC: Math.max(...residuals.map(Math.abs)) * 30 };
}

/** Every per-window series the rest of the replay reads, from one ring. */
export function windowSeries(row) {
  const win = row.win;
  return {
    spans: tokenSpans(win),
    headroom: win.map((sample) => sample[WIN.headroom]),
    legs: win.map((sample) => sample[WIN.leg]),
    hAge: win.map((sample) => sample[WIN.headroomAge]),
    statusAge: win.map((sample) => sample[WIN.statusAge]),
    appAge: win.map((sample) => sample[WIN.appAge]),
    appliedHeadroom: win.map((sample) => sample[WIN.appliedHeadroom]),
    dutyLast: win.map((sample) => sample[WIN.dutyLast]),
    tokensAtBoundary: win.map((sample) => sample[WIN.tokens]),
    rise: zoneRise(win),
    noise: headroomNoise(win.map((sample) => sample[WIN.headroom])),
    /** Count of windows on a leg other than the cooldown marker or none. */
    legWindows: legWindowCounts(win),
  };
}

function legWindowCounts(win) {
  const counts = { cpu: 0, gpu: 0, npu: 0, coolmode: 0, none: 0 };
  for (const sample of win) {
    const leg = sample[WIN.leg];
    if (leg === 0 || leg === 1 || leg === 2) counts[LEGS[leg]] += 1;
    else if (leg === 3) counts.coolmode += 1;
    else counts.none += 1;
  }
  return counts;
}