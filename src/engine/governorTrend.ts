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

/** Floor on the span used for the slope. Two margins meet here and they
 *  are different numbers (derivations:
 *  scratchpad/agents/governor-trend-numeric/REPORT.md section 1.2):
 *  the 0.1 C reading resolution moves the slope by at most 0.1 C/min at
 *  60 s, a resolution margin of 15x against the engine's 1.5 C/min; the
 *  0.9 C sensor excursion this file cites gives 0.9 C/min at the same
 *  floor, so the margin against a real excursion is only 1.67x. The
 *  floor buys the resolution margin, not immunity from excursions. */
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
 *   0.1 C resolution honest. The real lever is the sampler's cadence,
 *   which this file does not control.
 */

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Endpoint slope of the fresh samples, in C per minute. Input order is not
 * trusted: samples are sorted by timestamp first, because an exported
 * function must not be silently wrong on unsorted input. The anchor is the
 * newest sample at least TREND_MIN_SPAN_MS older than the latest one, so the
 * trend tracks the recent rate instead of a session-long average. Returns 0
 * whenever no honest slope exists; never NaN or Infinity.
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
          // A foreign invalid reading is not applicable: it says nothing
          // about this sensor and must not clear a good series.
          return;
        }
        // Two sensors in one series would fabricate deltas; a real reading
        // from a new sensor starts a new series.
        samples = [];
        source = observedSource;
      }
      if (!sensorValid || !finite(tempTenthsC) || !finite(nowMs)) {
        // The sensor reported nothing: drop every sample, so a later poll
        // can never anchor a slope across an interval that was not observed.
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
