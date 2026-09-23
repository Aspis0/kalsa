/**
 * Producer for trend_c_per_min, the one governor profile field that used to
 * stay 0 because nothing filled it.
 *
 * Engine contract (llama-governor-policy.cpp at engine pin 1577495b):
 * - Unit is degrees Celsius per minute of battery temperature, positive when
 *   the battery warms. The engine escalates WARM to COOLMODE when the trend
 *   reaches 1.5 C/min (k_trend_c_per_min).
 * - profile_is_valid refuses a non-finite trend, which invalidates the whole
 *   profile, so this producer only ever emits finite numbers. It emits 0 for
 *   "no honest trend": not enough history, samples outside the window, an
 *   invalid sensor, or a clock that went backwards. Zero never escalates.
 *
 * Only real poll observations enter the series; nothing is interpolated
 * between polls. Do not trust a margin claim from this header: the span
 * arithmetic and the measured poll cadence are documented at
 * TREND_MIN_SPAN_MS and in the cadence note below, derivations in
 * scratchpad/agents/governor-trend-numeric/REPORT.md (lab repo).
 */

export type TrendSource = "battery" | "bench-skin";

export type TrendSample = {
  tMs: number;
  tempTenthsC: number;
};

/** Samples older than this never anchor the trend: a rate over a longer
 *  span is a report about the past, not about this poll. */
export const TREND_WINDOW_MS = 5 * 60_000;

/** Floor on the span used for the slope. Two numbers, different meanings:
 *  - resolution: one 0.1 C code across 60 s is 0.1 C/min, 15x below the
 *    engine's 1.5 C/min - quantisation only, not a sensor guarantee;
 *  - measured from the archived traces on 2026-09-23: idle never moved
 *    (0.0 C over 61 s at 1 s cadence,
 *    out/jelly-energy-baseline-20260916/idle-floor.csv), under load 60 s
 *    endpoints reached +2.0 C (out/jelly-energy-baseline-20260916/
 *    phase-data/) and +3.7 C (out/t20c-gate-20260916/energy-trace.csv,
 *    10 s host). Chords >= 1.5 C: 9/9 on-device and 18/21 host kept
 *    climbing afterwards; the largest downward 60 s endpoint anywhere
 *    was 0.9 C - negative sign, never fires.
 *  So the floor bounds resolution, not real ramps: a real ramp crossing
 *  the threshold fires by design. The round-2 "0.9 C" margin was a
 *  test-comment hypothetical, never a measurement - retired here.
 *  Derivations: scratchpad/agents/governor-trend-numeric/REPORT.md
 *  section 1.2 (lab repo); measurement commands in the governor-trend
 *  REPORT (lab repo). */
export const TREND_MIN_SPAN_MS = 60_000;

/**
 * Cadence note - measured, not assumed. Poll gaps on the live completion
 * path were 280.65 / 292.33 / 274.77 s (numeric report sections 1.4 and 4),
 * so the window above holds about two samples with 8 to 25 s of slack
 * before the anchor falls out and the trend reads 0. Consequences:
 * - a sustained ramp is reported at its own rate over the poll gap;
 * - a short burst is diluted by the span: a 60 s burst needs
 *   1.5 * span / 60 C/min to surface, i.e. 4.7x the engine threshold at
 *   a 280 s gap;
 * - at the current cadence the field is effectively inert, which fails
 *   safe - that is why this is a note and not a bug. Do not shrink the
 *   window or the floor to compensate: 60 s is the floor that keeps the
 *   0.1 C resolution honest. The real lever is a temperature feed on the poll path
 *   (the map's dead high-rate native reader is the pattern: an
 *   in-process reader with no caller yet), not the trace interval - the
 *   1 Hz trace CSV has no temperature column at all.
 */

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Endpoint slope of the fresh samples, in C per minute. The value is a
 * chord between two observed endpoints: the mean rate between them, which
 * says nothing about the path between the polls. At the measured cadence a
 * single chord can carry the field over the threshold; that is the
 * intended safety direction (early escalation), not a defect. Input order
 * is not trusted: samples are sorted by timestamp first, because an
 * exported function must not be silently wrong on unsorted input. The
 * anchor is the newest sample at least TREND_MIN_SPAN_MS older than the
 * latest one. Returns 0 whenever no honest slope exists; never NaN or
 * Infinity.
 */
export function trendCPerMin(
  samples: readonly TrendSample[],
  nowMs: number,
): number {
  if (!finite(nowMs)) return 0;
  const fresh = samples
    .filter(
      (sample) =>
        finite(sample.tMs) &&
        finite(sample.tempTenthsC) &&
        sample.tMs <= nowMs &&
        nowMs - sample.tMs <= TREND_WINDOW_MS,
    )
    .sort((a, b) => a.tMs - b.tMs);
  if (fresh.length < 2) return 0;
  const last = fresh[fresh.length - 1];
  let anchor: TrendSample | null = null;
  for (let i = fresh.length - 2; i >= 0; i--) {
    if (last.tMs - fresh[i].tMs >= TREND_MIN_SPAN_MS) {
      anchor = fresh[i];
      break;
    }
  }
  if (!anchor) return 0;
  const spanMinutes = (last.tMs - anchor.tMs) / 60_000;
  const slope =
    (last.tempTenthsC - anchor.tempTenthsC) / 10 / spanMinutes;
  return Number.isFinite(slope) ? slope : 0;
}

export type TrendProducer = {
  observe(
    source: TrendSource,
    tempTenthsC: number,
    sensorValid: boolean,
    nowMs: number,
  ): void;
  trend(nowMs: number): number;
  reset(): void;
};

export function createTrendProducer(): TrendProducer {
  let samples: TrendSample[] = [];
  let source: TrendSource | null = null;

  return {
    observe(observedSource, tempTenthsC, sensorValid, nowMs) {
      if (observedSource !== source) {
        if (!sensorValid) {
          // Foreign invalid: not applicable to this sensor - as if it never happened.
          // The old clear-on-any-source-change rule let a reading carrying
          // no information about this sensor destroy a valid series: 0
          // reported where 1.5 was true. The chord that survives is then
          // the same honest endpoint rate as a gap with no poll at all,
          // window-capped both ways.
          return;
        }
        // Two sensors in one series would fabricate deltas; a real reading
        // from a new sensor starts a new series.
        samples = [];
        source = observedSource;
      }
      if (!sensorValid || !finite(tempTenthsC) || !finite(nowMs)) {
        // The sensor presented no data: drop every sample so the next
        // reading starts a fresh chord instead of pairing across this
        // rejected reading. A gap with no poll at all is a different case:
        // see the chord semantics at trendCPerMin.
        samples = [];
        return;
      }
      const last = samples[samples.length - 1];
      if (last && nowMs < last.tMs) {
        // Wall clock jumped backwards; old timestamps cannot anchor a rate.
        samples = [];
      }
      samples.push({ tMs: nowMs, tempTenthsC });
      const cutoff = nowMs - TREND_WINDOW_MS;
      samples = samples.filter((sample) => sample.tMs >= cutoff);
    },
    trend(nowMs) {
      return trendCPerMin(samples, nowMs);
    },
    reset() {
      samples = [];
      source = null;
    },
  };
}

/** One producer for the process: readGovernorThermo observes every poll. */
export const trendProducer = createTrendProducer();
