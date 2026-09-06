/**
 * Slope-based battery ETA estimator.
 *
 * Derives a drain *rate* (%/hour) from a window of `expo-battery` level
 * samples and projects how long until a reserved headroom is consumed. It is
 * deliberately fail-open: any input that does not clearly demonstrate real
 * discharge is reported as `measuring` or `unknown` rather than a number, so
 * the UI can never be blocked by a bad estimate.
 */

export interface BatterySample {
  /** Epoch milliseconds. */
  tMs: number;
  /** Charge level, 0–100. */
  percent: number;
}

/**
 * A single object with a `kind` discriminator and optional eta payload: the
 * numeric fields are only present when `kind === "eta"`.
 */
export type BatteryEtaResult = {
  kind: "unknown" | "measuring" | "charging" | "eta";
  /** Lower bound of the half-hour band (hours). */
  lowHours?: number;
  /** Upper bound of the half-hour band (hours). */
  highHours?: number;
  /** Observed drain rate, %/hour. */
  ratePctPerHour?: number;
};

/** Tunable gates, all with production defaults. */
export interface BatteryEtaGates {
  /** Minimum finite samples required. */
  minSamples: number;
  /** Minimum window span (ms) required. */
  minSpanMs: number;
  /** Minimum net drop (pp) over the minimum window. */
  minDropPct: number;
  /** Headroom to reserve from the current level. */
  reservePct: number;
  /** Upper bound on a projected ETA before giving up. */
  maxHours: number;
}

export const BATTERY_ETA_DEFAULTS: BatteryEtaGates = {
  minSamples: 3,
  minSpanMs: 10 * 60 * 1000,
  minDropPct: 1,
  reservePct: 5,
  maxHours: 24,
};

const MS_PER_HOUR = 3_600_000;

function resolveGates(g?: Partial<BatteryEtaGates>): BatteryEtaGates {
  return { ...BATTERY_ETA_DEFAULTS, ...(g ?? {}) };
}

/**
 * Estimate battery ETA from a time-ordered window of level samples.
 *
 * @param samples Newest-first or oldest-first; order is normalized internally.
 * @param gates Override any gate constant.
 */
export function estimateBatteryEtaHours(
  samples: BatterySample[] | null | undefined,
  gates?: Partial<BatteryEtaGates>,
): BatteryEtaResult {
  const G = resolveGates(gates);

  if (!samples || samples.length === 0) {
    return { kind: "unknown" };
  }

  // Any non-finite reading makes the whole window unusable.
  for (const s of samples) {
    if (!Number.isFinite(s.tMs) || !Number.isFinite(s.percent)) {
      return { kind: "unknown" };
    }
  }

  const ordered = [...samples].sort((a, b) => a.tMs - b.tMs);
  const first = ordered[0];
  const last = ordered[ordered.length - 1];

  if (ordered.length < G.minSamples) {
    return { kind: "measuring" };
  }

  const spanMs = last.tMs - first.tMs;
  if (spanMs < G.minSpanMs) {
    return { kind: "measuring" };
  }

  // Positive netDrop means discharge (battery fell); negative means it rose
  // across the window, i.e. charging.
  const netDrop = first.percent - last.percent;
  if (netDrop < 0) {
    return { kind: "charging" };
  }

  // Minimum-drain-rate gate: the observed drain must be at least as steep as
  // `minDropPct` measured over the minimum window. This keeps flat windows
  // (too little drop for their span) out of the ETA band.
  const minRate = (G.minDropPct * MS_PER_HOUR) / G.minSpanMs;
  const actualRate = (netDrop * MS_PER_HOUR) / spanMs;
  if (actualRate < minRate) {
    return { kind: "unknown" };
  }

  const headroom = last.percent - G.reservePct;
  if (headroom <= 0) {
    return { kind: "unknown" };
  }

  // Project the drain normalized to the minimum window so a short, measured
  // window still yields a stable hourly rate.
  const etaRate = (netDrop * MS_PER_HOUR) / G.minSpanMs;
  const etaHours = etaRate <= 0 ? Infinity : headroom / etaRate;

  if (!Number.isFinite(etaHours) || etaHours > G.maxHours) {
    return { kind: "unknown" };
  }

  const lowHours = Math.floor(etaHours * 2) / 2;
  return {
    kind: "eta",
    lowHours,
    highHours: lowHours + 0.5,
    ratePctPerHour: etaRate,
  };
}