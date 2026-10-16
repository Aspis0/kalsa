import assert from "node:assert/strict";
import { test } from "node:test";
import { fitHeat } from "../fit.mjs";

const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

const column = (name, values) => ({ name, values });

test("an exact design gives its coefficients back in the natural units", () => {
  // y = 2 x1 + 3 x2 on columns scaled to unit length, so the fit has to undo
  // the scaling before a coefficient means anything.
  const fit = fitHeat({
    columns: [column("x1", [1, 2, 3, 4]), column("x2", [0, 1, 4, 9])],
    y: [2, 7, 18, 35],
  });
  close(fit.coefficients[fit.names.indexOf("x1")], 2);
  close(fit.coefficients[fit.names.indexOf("x2")], 3);
  assert.equal(fit.rank, 3);
  assert.equal(fit.df, 1);
  close(fit.residualSigmaC, 0, 1e-9);
});

test("a column no row varies cannot be identified and is dropped by name", () => {
  const fit = fitHeat({
    columns: [column("x1", [1, 2, 3]), column("gpu_k", [0, 0, 0])],
    y: [2, 4, 6],
  });
  assert.deepEqual(fit.dropped, ["gpu_k"]);
  assert.equal(fit.names.length, 2);
  close(fit.coefficients[fit.names.indexOf("x1")], 2);
});

test("an exactly collinear design is reported as rank deficient, not fitted", () => {
  const a = [1, 2, 3, 4];
  const fit = fitHeat({ columns: [column("a", a), column("b", a.map((v) => v * 2))], y: [1, 2, 3, 4] });
  assert.equal(fit.names.length, 3);
  assert.equal(fit.rank, 2);
  // One direction survives at machine precision, so the ratio is enormous
  // rather than infinite - either way the design cannot separate the columns.
  assert.ok(fit.conditionNumber > 1e8, `${fit.conditionNumber}`);
});

test("the condition number is the design-matrix one, with the Gram ratio beside it", () => {
  // Columns centred and orthogonal: the scaled Gram is diag(4, 1, 1), so the
  // design matrix has singular values 2 and 1. The reported condition number is
  // the SQUARE ROOT of the Gram ratio - the two conventions differ by a square,
  // and printing only one of them is how a reader ends up 78x out.
  const fit = fitHeat({
    columns: [column("a", [1, -1, 1, -1]), column("b", [1, 1, -1, -1])],
    y: [1, 2, 3, 4],
  });
  close(fit.gramRatio, 4, 1e-9);
  close(fit.conditionNumber, 2, 1e-9);
  close(fit.conditionNumber ** 2, fit.gramRatio, 1e-9);
  const skewed = fitHeat({
    columns: [column("a", [1, 2, 3, 4]), column("b", [2, 4, 6, 8.02])],
    y: [1, 2, 3, 4],
  });
  assert.ok(skewed.conditionNumber > 30, `${skewed.conditionNumber}`);
  assert.ok(skewed.conditionNumber > fit.conditionNumber);
});

test("residuals come off the fit, in C", () => {
  // slope 2, intercept 0.04, residuals 0.06 / -0.14 / 0.16 / -0.14 / 0.06.
  const fit = fitHeat({ columns: [column("x1", [1, 2, 3, 4, 5])], y: [2.1, 3.9, 6.2, 7.9, 10.1] });
  assert.equal(fit.rows, 5);
  assert.equal(fit.df, 3);
  close(fit.residualSigmaC, 0.154919, 1e-5);
  close(fit.maxAbsResidualC, 0.16, 1e-9);
});