/**
 * Identify the DESIGN 5.6 heat fit and report how well the rows identify it:
 * least squares over the design's columns, plus the collinearity OPEN 6 asks
 * for (condition number, rank) and the residual sigma the 0.2 C floor and the
 * outlier cut are sized against.
 */

/** Cyclic Jacobi for a small symmetric matrix. Returns the eigenvalues in
 *  Jacobi's own order (NOT sorted - the caller sorts) with the matching
 *  eigenvectors as columns. */
function jacobiEigen(matrix) {
  const n = matrix.length;
  const a = matrix.map((row) => row.slice());
  const vectors = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  );
  for (let sweep = 0; sweep < 64; sweep += 1) {
    let offDiagonal = 0;
    for (let p = 0; p < n; p += 1) for (let q = p + 1; q < n; q += 1) offDiagonal += a[p][q] ** 2;
    if (offDiagonal < 1e-28) break;
    for (let p = 0; p < n; p += 1) {
      for (let q = p + 1; q < n; q += 1) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < n; k += 1) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k += 1) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k += 1) {
          const vkp = vectors[k][p];
          const vkq = vectors[k][q];
          vectors[k][p] = c * vkp - s * vkq;
          vectors[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((row, i) => row[i]), vectors };
}

/**
 * `columns` are the DESIGN 5.6 predictors in their natural units; an
 * intercept is added here. Columns that are identically zero across the rows
 * are dropped and named instead: no row identifies them, so a coefficient
 * would be an artefact of the arithmetic. Each predictor column is scaled to
 * unit L2 norm and the intercept column is left at 1, which is what makes the
 * condition number a statement about collinearity rather than about mixing
 * C/min with tokens - a convention that is only meaningful if it is stated, so
 * the report states it. The solve keeps the directions whose eigenvalue clears
 * a relative 1e-9, so a rank-deficient design returns the minimum-norm
 * least-squares answer instead of an arbitrary one.
 */
export function fitHeat({ columns, y }) {
  const dropped = [];
  const kept = columns.filter((column) => {
    const allZero = column.values.every((value) => value === 0);
    if (allZero) dropped.push(column.name);
    return !allZero;
  });
  const n = y.length;
  const p = kept.length + 1;
  const names = ["intercept", ...kept.map((column) => column.name)];
  const scales = [1, ...kept.map((column) => Math.hypot(...column.values) || 1)];
  const design = Array.from({ length: n }, (_, rowIndex) => [
    1,
    ...kept.map((column, k) => column.values[rowIndex] / scales[k + 1]),
  ]);

  const gram = Array.from({ length: p }, () => new Array(p).fill(0));
  const gramY = new Array(p).fill(0);
  design.forEach((row, rowIndex) => {
    for (let i = 0; i < p; i += 1) {
      gramY[i] += row[i] * y[rowIndex];
      for (let j = 0; j < p; j += 1) gram[i][j] += row[i] * row[j];
    }
  });

  const { values, vectors } = jacobiEigen(gram);
  // Jacobi leaves the eigenvalues in no particular order; rank and the
  // condition number both read them ascending.
  const order = values.map((value, k) => ({ value, k })).sort((a, b) => a.value - b.value);
  const largest = order.at(-1).value;
  const smallest = order[0].value;
  const cutoff = largest * 1e-9;
  const retained = order.filter((entry) => entry.value > cutoff);
  const scaled = new Array(p).fill(0);
  for (const { value, k } of retained) {
    const projection = Array.from({ length: p }, (_, i) => vectors[i][k]).reduce(
      (sum, coefficient, i) => sum + coefficient * gramY[i],
      0,
    );
    for (let i = 0; i < p; i += 1) scaled[i] += (projection / value) * vectors[i][k];
  }

  const coefficients = scaled.map((value, i) => (i === 0 ? value : value / scales[i]));
  const fitted = design.map((row) => row.reduce((sum, value, i) => sum + value * scaled[i], 0));
  const residuals = y.map((value, rowIndex) => value - fitted[rowIndex]);
  const df = n - retained.length;
  const residualSigmaC = df > 0 ? Math.sqrt(residuals.reduce((sum, r) => sum + r * r, 0) / df) : null;

  return {
    names,
    coefficients,
    dropped,
    rows: n,
    rank: retained.length,
    df,
    // The 2-norm condition number of the SCALED design matrix, s(max)/s(min),
    // which is the square root of the Gram ratio below. Both are reported
    // because the Gram ratio is what the eigen-decomposition actually
    // produces, and the two differ by a square - a reader comparing against a
    // design-matrix number needs the same convention. Over EVERY direction,
    // not the retained ones: a direction lost to collinearity is exactly the
    // case this number exists to report. Rank says how many survived the solve.
    conditionNumber: smallest > 0 ? Math.sqrt(largest / smallest) : null,
    gramRatio: smallest > 0 ? largest / smallest : null,
    residuals,
    residualSigmaC,
    maxAbsResidualC: residuals.length > 0 ? Math.max(...residuals.map(Math.abs)) : null,
  };
}