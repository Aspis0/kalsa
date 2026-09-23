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
 * between polls. Battery temperature is quantised to 0.1 C, so a span
 * shorter than TREND_MIN_SPAN_MS would turn that quantisation into a slope
 * the engine could read as a real rise.
 */

export type TrendSource = "battery" | "bench-skin";

export type TrendSample = {
  tMs: number;
  tempTenthsC: number;
};

/** Samples older than this never anchor the trend: a rate over a longer
 *  span is a report about the past, not about this poll. */
export const TREND_WINDOW_MS = 5 * 60_000;

/** Floor on the span used for the slope. At 60 s the 0.1 C quantisation
 *  contributes at most 0.1 C/min of slope, far below the engine's 1.5
 *  C/min threshold; a 10 s span could turn one quantisation step plus
 *  sensor jitter into a fake 1.8 C/min rise. */
export const TREND_MIN_SPAN_MS = 60_000;

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Endpoint slope of the fresh samples, in C per minute. The anchor is the
 * newest sample at least TREND_MIN_SPAN_MS older than the latest one, so the
 * trend tracks the recent rate instead of a session-long average. Returns 0
 * whenever no honest slope exists; never NaN or Infinity.
 */
export function trendCPerMin(
  samples: readonly TrendSample[],
  nowMs: number,
): number {
  if (!finite(nowMs)) return 0;
  const fresh = samples.filter(
    (sample) =>
      finite(sample.tMs) &&
      finite(sample.tempTenthsC) &&
      sample.tMs <= nowMs &&
      nowMs - sample.tMs <= TREND_WINDOW_MS,
  );
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
        // A different sensor behind the same series would fabricate deltas.
        samples = [];
        source = observedSource;
      }
      if (!sensorValid || !finite(tempTenthsC) || !finite(nowMs)) return;
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
