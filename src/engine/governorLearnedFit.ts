/**
 * The learned-value fit (learning-governor DESIGN.md 5.6): one ridge over the
 * phone's heat observations with the shipped device row as its prior, outlier
 * rejection, forgetting, and the ucb Stage 2 will carry in
 * decode_speed_heat / decode_speed_bg_c_per_min.
 *
 * Pure: no IO and no device facts beyond the seeds handed in, so every number
 * below is checkable by hand. Units are absolute (skin C per 1k tokens, C per
 * minute) rather than seed multiples: a new lab row changes the prior without
 * invalidating the fitted coefficients.
 */

/** The three decode legs, in the observation row's `tok`/`us` order. */
export type Leg = "cpu" | "gpu" | "npu";

export const LEGS: readonly Leg[] = ["cpu", "gpu", "npu"];

/**
 * DESIGN 5.6's design matrix, in column order:
 * npu_k, gpu_k, cpu_k, prompt_k, pre_gpu_k, wall_min, -h_first x wall_min.
 * The leg columns are in the design's order (npu first), which is NOT the
 * row's triple order — the map below is the only place that difference lives.
 */
export const HEAT_COLUMNS = 7;
export const HEAT_LEG_COLUMN: Record<Leg, number> = { npu: 0, gpu: 1, cpu: 2 };
export const HEAT_PROMPT_COLUMN = 3;
export const HEAT_PRE_GPU_COLUMN = 4;
export const HEAT_WALL_COLUMN = 5;
export const HEAT_COOLING_COLUMN = 6;

/** DESIGN 5.6: the prior counts as four rows of evidence. */
export const PRIOR_ROWS = 4;
/** Prior sd is 25 % of the seed (DESIGN 5.6). */
export const PRIOR_SD_FRACTION = 0.25;
/**
 * Prior sd for a column the device row does not measure (the two prefill
 * columns and the cooling term), in that column's own units. Deliberately
 * weak: these columns must be paid for by data before they move.
 */
export const PRIOR_SD_UNSEEDED = 1;
/** Background prior sd in C per minute (AUDIT-2's arithmetic note). */
export const PRIOR_SD_BACKGROUND = 0.5;
/** DESIGN 5.6: a 0.95 factor per accepted row (~13.5-row half-life). */
export const FORGETTING = 0.95;
/** DESIGN 5.6: residual sigma floor, in C. */
export const RESIDUAL_SIGMA_FLOOR = 0.2;
/** DESIGN 5.6: outlier band max(1.0 C, 3 sd). */
export const OUTLIER_FLOOR_C = 1;
export const OUTLIER_SIGMAS = 3;
/** DESIGN 5.6: the ucb multiplier clamp, as multiples of the seed. */
export const UCB_MIN = 0.75;
export const UCB_MAX = 3;
/**
 * Per-completion EWMA weight for the speed series. The design says "in-engine
 * EWMA" without a number and the engine has none today, so this is ours: fast
 * enough to follow a thermal slow-down within a turn, slow enough that one
 * paced window does not move the estimate.
 */
export const SPEED_EWMA_ALPHA = 0.25;

/** The accumulated data of the ridge. Empty until rows arrive; the prior is
 *  the shipped seed row, which the solve takes as an argument. */
export type HeatFitState = {
  /** Σ λᵏ·x xᵀ over accepted rows (already decayed). */
  gram: number[][];
  /** Σ λᵏ·x y. */
  rhs: number[];
  /** Σ λᵏ over accepted rows. */
  weight: number;
  /** Σ λᵏ·(y − x·β)², each residual taken against the pre-update fit. */
  rss: number;
};

export type HeatPrior = {
  /** Posterior mode with no data: the shipped row's per-leg heat. */
  mean: number[];
  /** Prior sd per column, in the column's own units. */
  sd: number[];
};

export type HeatSolution = {
  mean: number[];
  /** Posterior sd per column: the prior's own sd while no row has been
   *  accepted, then the measured residual's spread over the coefficient's
   *  marginal variance (which itself tightens as rows accumulate). */
  sd: number[];
  /** Residual sigma actually used (0 before any row). */
  sigma: number;
};

export const emptyHeatFit = (): HeatFitState => ({
  gram: Array.from({ length: HEAT_COLUMNS }, () => Array<number>(HEAT_COLUMNS).fill(0)),
  rhs: Array<number>(HEAT_COLUMNS).fill(0),
  weight: 0,
  rss: 0,
});

/** The prior the shipped seeds imply: measured columns take the seed, the
 *  unmeasured ones start at no effect with a weak pull toward it. */
export function heatPrior(seeds: Record<Leg, number>): HeatPrior {
  const mean = Array<number>(HEAT_COLUMNS).fill(0);
  const sd = Array<number>(HEAT_COLUMNS).fill(PRIOR_SD_UNSEEDED);
  for (const leg of LEGS) {
    const column = HEAT_LEG_COLUMN[leg];
    mean[column] = seeds[leg];
    // A seed of 0 carries no scale to shrink toward, so the weak generic sd
    // stands; legHeatUcb refuses to report a leg with no positive seed.
    sd[column] = seeds[leg] > 0 ? PRIOR_SD_FRACTION * seeds[leg] : PRIOR_SD_UNSEEDED;
  }
  sd[HEAT_WALL_COLUMN] = PRIOR_SD_BACKGROUND;
  return { mean, sd };
}

/** The residual sigma: the decayed mean squared residual, floored in C. */
export function heatSigma(state: HeatFitState): number {
  if (state.weight <= 0) return 0;
  return Math.sqrt(Math.max(state.rss / state.weight, RESIDUAL_SIGMA_FLOOR ** 2));
}

// Below this an LDLᵀ pivot is not a number we should divide by; the ridge is
// positive definite by construction (every prior sd is positive), so reaching
// it means the accumulated data has gone non-finite.
const PIVOT_FLOOR = 1e-12;

/** LDLᵀ of a symmetric matrix, unit lower factor in L. Returns null when a
 *  pivot collapses, and the caller falls back to the prior. */
function factorize(matrix: number[][]): { l: number[][]; d: number[] } | null {
  const n = matrix.length;
  const l: number[][] = Array.from({ length: n }, () => Array<number>(n).fill(0));
  const d: number[] = Array<number>(n).fill(0);
  for (let j = 0; j < n; j += 1) {
    let head = matrix[j][j];
    for (let k = 0; k < j; k += 1) head -= l[j][k] * l[j][k] * d[k];
    if (!(Math.abs(head) > PIVOT_FLOOR)) return null;
    d[j] = head;
    l[j][j] = 1;
    for (let i = j + 1; i < n; i += 1) {
      let sum = matrix[i][j];
      for (let k = 0; k < j; k += 1) sum -= l[i][k] * l[j][k] * d[k];
      l[i][j] = sum / head;
    }
  }
  return { l, d };
}

/** β of the factored system, and the marginal posterior variance of each
 *  coefficient with σ factored out.
 *
 *  A = L·D·Lᵀ, so A⁻¹ = L⁻ᵀ·D⁻¹·L⁻¹ = Mᵀ·D⁻¹·M for M = L⁻¹ (unit LOWER
 *  triangular). The diagonal is therefore Σ_{k≥j} M_kj² / d_k — a COLUMN of
 *  M squared over the pivots, not L's row: summing L's row only ever yields
 *  1/d_j, which ignores every coupling and reads the first pivot as if the
 *  column were uncorrelated. Columns of M come from solving L·m = e_j.
 */
function solveFactorized(
  f: { l: number[][]; d: number[] },
  b: readonly number[],
): { beta: number[]; invDiag: number[] } {
  const n = f.d.length;
  const beta = Array<number>(n).fill(0);
  for (let i = 0; i < n; i += 1) {
    let sum = b[i];
    for (let k = 0; k < i; k += 1) sum -= f.l[i][k] * beta[k];
    beta[i] = sum;
  }
  for (let i = 0; i < n; i += 1) beta[i] /= f.d[i];
  for (let i = n - 1; i >= 0; i -= 1) {
    let sum = beta[i];
    for (let k = i + 1; k < n; k += 1) sum -= f.l[k][i] * beta[k];
    beta[i] = sum;
  }
  const invDiag = Array<number>(n).fill(0);
  const column = Array<number>(n).fill(0);
  for (let j = 0; j < n; j += 1) {
    // Column j of M = L⁻¹: solve L·m = e_j (m is zero above the diagonal).
    let sum = 0;
    for (let i = j; i < n; i += 1) {
      let entry = i === j ? 1 : 0;
      for (let k = j; k < i; k += 1) entry -= f.l[i][k] * column[k];
      column[i] = entry;
      sum += (entry * entry) / f.d[i];
    }
    invDiag[j] = sum;
  }
  return { beta, invDiag };
}

/** Posterior mean and sd. A collapsed system answers the prior instead of a
 *  number nobody should send the engine. */
export function solveHeat(state: HeatFitState, prior: HeatPrior): HeatSolution {
  const sigma = heatSigma(state);
  const mean = prior.mean.slice();
  const sd = prior.sd.slice();
  const info = prior.sd.map((value) => PRIOR_ROWS / (value * value));
  const matrix = state.gram.map((row, i) =>
    row.map((value, j) => value + (i === j ? info[i] : 0)),
  );
  const b = state.rhs.map((value, i) => value + info[i] * prior.mean[i]);
  const factored = factorize(matrix);
  if (!factored) return { mean, sd, sigma };
  const { beta, invDiag } = solveFactorized(factored, b);
  for (let i = 0; i < HEAT_COLUMNS; i += 1) {
    mean[i] = beta[i];
    // Before any row the fit has no measured residual, so the coefficient's
    // uncertainty is the prior's own sd — DESIGN 5.6's "seed x 1.25 until the
    // app sends a value". From the first accepted row on it is that residual's
    // spread (floored at 0.2 C) over the coefficient's marginal variance.
    sd[i] =
      state.weight > 0
        ? Math.max(sigma, RESIDUAL_SIGMA_FLOOR) * Math.sqrt(Math.max(invDiag[i], 0))
        : prior.sd[i];
  }
  return { mean, sd, sigma };
}

export type HeatUpdate = { state: HeatFitState; accepted: boolean };

/** One observation. The residual is taken against the pre-update fit, so a row
 *  is judged by what the store believed before it saw it. */
export function updateHeat(
  state: HeatFitState,
  prior: HeatPrior,
  x: readonly number[],
  y: number,
): HeatUpdate {
  const { mean } = solveHeat(state, prior);
  let predicted = 0;
  for (let i = 0; i < HEAT_COLUMNS; i += 1) predicted += mean[i] * x[i];
  const residual = y - predicted;
  if (Math.abs(residual) > Math.max(OUTLIER_FLOOR_C, OUTLIER_SIGMAS * heatSigma(state))) {
    return { state, accepted: false };
  }
  const gram = state.gram.map((row, i) =>
    row.map((value, j) => FORGETTING * value + x[i] * x[j]),
  );
  const rhs = state.rhs.map((value, i) => FORGETTING * value + x[i] * y);
  return {
    accepted: true,
    state: {
      gram,
      rhs,
      weight: FORGETTING * state.weight + 1,
      rss: FORGETTING * state.rss + residual * residual,
    },
  };
}

/** The 0.75-3 band, as a multiple of the scale the column is judged against:
 *  a leg's shipped seed, or the background's prior scale. */
const clampedMultiple = (value: number, scale: number): number =>
  Math.min(UCB_MAX, Math.max(UCB_MIN, value / scale));

/** The per-leg ucb in C per 1k: the multiplier is clamped as a multiple of
 *  the seed (DESIGN 5.6's 0.75-3), so the clamp means the same thing on a
 *  cheap NPU and an expensive CPU. Null when the row carries no seed for it. */
export function legHeatUcb(
  meanCPer1k: number,
  sdCPer1k: number,
  seedCPer1k: number,
): number | null {
  if (!(seedCPer1k > 0)) return null;
  return clampedMultiple(Math.max(meanCPer1k, 0) + sdCPer1k, seedCPer1k) * seedCPer1k;
}

/** The background ucb in C per minute (DESIGN 5.6's decode_speed_bg_c_per_min),
 *  on the same 0.75-3 clamp. The background has no measured seed, so it is
 *  judged against the only scale a fit that has never seen this phone cool
 *  honestly can claim: its own prior sd of 0.5 C/min, which bounds the sent
 *  value to 0.375-1.5 C/min however large the fitted rate reads. */
export function backgroundUcb(meanCPerMin: number, sdCPerMin: number): number {
  return (
    clampedMultiple(Math.max(meanCPerMin, 0) + sdCPerMin, PRIOR_SD_BACKGROUND) *
    PRIOR_SD_BACKGROUND
  );
}

/** Per-completion EWMA; the first sample seeds the series. */
export function ewmaSpeed(previous: number | null, sample: number): number {
  return previous === null
    ? sample
    : SPEED_EWMA_ALPHA * sample + (1 - SPEED_EWMA_ALPHA) * previous;
}