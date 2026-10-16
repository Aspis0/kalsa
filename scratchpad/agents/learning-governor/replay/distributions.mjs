/**
 * Describe a list of numbers: the one-line summary every distribution in the
 * report prints. Percentiles are nearest-rank on the sorted values, which
 * never invents a value the rows did not contain.
 */
export function describe(values) {
  const finite = values.filter((value) => typeof value === "number" && Number.isFinite(value));
  const sorted = [...finite].sort((a, b) => a - b);
  const n = sorted.length;
  return {
    n,
    min: n > 0 ? sorted[0] : null,
    p50: n > 0 ? sorted[Math.ceil(0.5 * n) - 1] : null,
    p90: n > 0 ? sorted[Math.ceil(0.9 * n) - 1] : null,
    max: n > 0 ? sorted[n - 1] : null,
    mean: n > 0 ? sorted.reduce((sum, value) => sum + value, 0) / n : null,
  };
}

/** How many values sit strictly above `threshold` - the question a gate like
 *  the 4 s forecast-read gate or the 1200 s app-sample backstop asks. */
export function countAbove(values, threshold) {
  return values.filter((value) => typeof value === "number" && value > threshold).length;
}