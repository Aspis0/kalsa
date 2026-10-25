/**
 * The learned fit math (governorLearnedFit.ts): the ridge solve against a
 * hand-computed answer, the outlier band, the forgetting factor, the ucb form
 * DESIGN 5.6 specifies, and the speed EWMA.
 *
 * The known-answer cases build the accumulated state by hand so the expected
 * numbers are checkable with a calculator; the update path (decay, add,
 * reject) is asserted against states the module itself produced.
 */
import {
  backgroundUcb,
  emptyHeatFit,
  ewmaSpeed,
  FORGETTING,
  HEAT_COLUMNS,
  HEAT_LEG_COLUMN,
  HEAT_WALL_COLUMN,
  heatPrior,
  heatSigma,
  legHeatUcb,
  OUTLIER_FLOOR_C,
  PRIOR_ROWS,
  RESIDUAL_SIGMA_FLOOR,
  solveHeat,
  updateHeat,
  UCB_MAX,
  UCB_MIN,
  type HeatFitState,
} from "../governorLearnedFit";

// Prior sd is 25 % of a 4.0 seed = 1.0, so every column's information is
// PRIOR_ROWS / 1.0² = 4 and the no-data posterior is exactly the seed.
const SEEDS = { npu: 4, gpu: 4, cpu: 4 };
const prior = heatPrior(SEEDS);

/** A design row: the named cells, zeros elsewhere. */
const x = (cells: number[]): number[] => {
  const out = Array<number>(HEAT_COLUMNS).fill(0);
  cells.forEach((value, index) => {
    out[index] = value;
  });
  return out;
};

const add = (state: HeatFitState, cells: number[], y: number): HeatFitState =>
  updateHeat(state, prior, x(cells), y).state;

/** A state as the store would hold it after rows with residuals of `sigma`. */
const stateWithSigma = (sigma: number): HeatFitState => ({
  ...emptyHeatFit(),
  weight: 1,
  rss: sigma * sigma,
});

describe("ridge solve", () => {
  it("matches a hand-computed 2x2 block with the prior pulled in", () => {
    // Rows x = [1,0], [0,1], [1,1] with y = 2, 3, 5 give Σxxᵀ = [[2,1],[1,2]]
    // and Σxy = [7,8] (a λ of 1 would hold; the stored state IS the sum the
    // update path accumulates, so the state is built with those values).
    const state = emptyHeatFit();
    state.gram[0][0] = 2;
    state.gram[0][1] = 1;
    state.gram[1][0] = 1;
    state.gram[1][1] = 2;
    state.rhs[0] = 7;
    state.rhs[1] = 8;
    state.weight = 3;
    state.rss = 0;
    // With prior sd 1.0 the normal equations are [[6,1],[1,6]]·β =
    // [7,8] + INFO·[4,4] = [23,24], whose solution is β = [114/35, 121/35].
    expect(PRIOR_ROWS).toBe(4);
    const { mean, sigma } = solveHeat(state, prior);
    expect(mean[0]).toBeCloseTo(114 / 35, 10);
    expect(mean[1]).toBeCloseTo(121 / 35, 10);
    // Columns no row touched keep the shipped prior untouched.
    expect(mean[HEAT_LEG_COLUMN.cpu]).toBe(SEEDS.cpu);
    expect(mean[HEAT_WALL_COLUMN]).toBe(0);
    // sigma is floored at 0.2 C: a plane through every row must not claim a
    // zero-width uncertainty.
    expect(sigma).toBeCloseTo(RESIDUAL_SIGMA_FLOOR, 10);
  });

  it("keeps the no-data posterior at the seed and its prior sd", () => {
    const { mean, sd, sigma } = solveHeat(emptyHeatFit(), prior);
    expect(sigma).toBe(0);
    for (const leg of ["npu", "gpu", "cpu"] as const) {
      expect(mean[HEAT_LEG_COLUMN[leg]]).toBe(SEEDS[leg]);
      // No row yet means no measured residual, so the fit reports the
      // prior's own uncertainty — DESIGN 5.6's seed x 1.25.
      expect(sd[HEAT_LEG_COLUMN[leg]]).toBeCloseTo(1, 10);
    }
  });

  it("tightens the posterior sd below the prior's as rows arrive", () => {
    let state = emptyHeatFit();
    for (let i = 0; i < 8; i += 1) state = add(state, [2, 0, 0, 0, 0, 0.5, -0.1], 8);
    const { sd } = solveHeat(state, prior);
    expect(sd[HEAT_LEG_COLUMN.npu]).toBeLessThan(1);
    expect(sd[HEAT_LEG_COLUMN.npu]).toBeGreaterThan(0);
  });

  it("reads a symmetric system's marginal variance, not its first pivot", () => {
    // The marginal posterior sd of a coefficient is sigma x sqrt((A^-1)_jj),
    // and for a symmetric A the two columns MUST come out equal. Summing L's
    // row instead of squaring a column of L⁻¹ gives 1/d_j, which reads the
    // first pivot as if the column were uncorrelated and splits a symmetric
    // pair apart.
    //
    // Case 1: A = [[6,1],[1,6]] (prior info 4 on a prior sd of 1.0, so
    // Σxxᵀ = [[2,1],[1,2]]), sigma at its 0.2 C floor:
    // (A^-1)_jj = 6/(36-1) = 0.171429 -> sd = 0.2 x sqrt(6/35) = 0.082808.
    const mild = emptyHeatFit();
    mild.gram[0][0] = 2;
    mild.gram[0][1] = 1;
    mild.gram[1][0] = 1;
    mild.gram[1][1] = 2;
    mild.rhs[0] = 7;
    mild.rhs[1] = 8;
    mild.weight = 3;
    mild.rss = 0.04;
    const a = solveHeat(mild, prior);
    expect(a.sigma).toBeCloseTo(RESIDUAL_SIGMA_FLOOR, 10);
    expect(a.sd[0]).toBeCloseTo(0.082808, 6);
    expect(a.sd[1]).toBeCloseTo(0.082808, 6);
    expect(a.sd[0]).toBe(a.sd[1]);

    // Case 2: A = [[14,9.99],[9.99,14]] (Σxxᵀ = [[10,9.99],[9.99,10]]), the
    // strongly coupled one, with rss/weight = 0.2 so sigma = sqrt(0.2):
    // (A^-1)_00 = 14/(196-99.8001) = 0.145509, sd = sqrt(0.2) x sqrt(that)
    // = 0.170605. Here the pivots differ a lot (14 vs 6.8714), so the old
    // formula is wrong by more than a rounding digit.
    const coupled = emptyHeatFit();
    coupled.gram[0][0] = 10;
    coupled.gram[0][1] = 9.99;
    coupled.gram[1][0] = 9.99;
    coupled.gram[1][1] = 10;
    coupled.rhs[0] = 1;
    coupled.rhs[1] = 1;
    coupled.weight = 1;
    coupled.rss = 0.2;
    const b = solveHeat(coupled, prior);
    expect(b.sigma).toBeCloseTo(Math.sqrt(0.2), 10);
    expect(b.sd[0]).toBeCloseTo(0.170605, 6);
    expect(b.sd[1]).toBeCloseTo(0.170605, 6);
  });

  it("answers the prior instead of a number when the system collapses", () => {
    // The store never writes a non-finite gram, and a solve that cannot
    // factor must not hand the engine a NaN.
    const broken = emptyHeatFit();
    broken.gram[2][2] = Number.NaN;
    const { mean, sd } = solveHeat(broken, prior);
    expect(mean[0]).toBe(SEEDS.npu);
    expect(sd[0]).toBeCloseTo(1, 10);
  });
});

describe("outlier band", () => {
  it("is exactly 1.0 C on an empty fit", () => {
    expect(heatSigma(emptyHeatFit())).toBe(0);
    const atPrior = solveHeat(emptyHeatFit(), prior).mean[0];
    expect(updateHeat(emptyHeatFit(), prior, x([1]), atPrior + 0.99).accepted).toBe(true);
    expect(updateHeat(emptyHeatFit(), prior, x([1]), atPrior + 1.01).accepted).toBe(false);
  });

  it("is 3 sigma once the residuals say sigma", () => {
    const state = stateWithSigma(3);
    expect(heatSigma(state)).toBeCloseTo(3, 10);
    const predicted = solveHeat(state, prior).mean[0];
    expect(updateHeat(state, prior, x([1]), predicted + 8.9).accepted).toBe(true);
    expect(updateHeat(state, prior, x([1]), predicted + 9.1).accepted).toBe(false);
  });

  it("never narrows below the 1.0 C floor", () => {
    // A sigma under the 0.2 C floor reads as the floor, so the band stays 1.0.
    const state = stateWithSigma(0.05);
    expect(heatSigma(state)).toBeCloseTo(RESIDUAL_SIGMA_FLOOR, 10);
    const predicted = solveHeat(state, prior).mean[0];
    expect(updateHeat(state, prior, x([1]), predicted + OUTLIER_FLOOR_C + 0.1).accepted).toBe(false);
  });

  it("leaves the state object untouched when it rejects", () => {
    const state = add(emptyHeatFit(), [1], 4.05);
    const before = state.gram[0][0];
    const update = updateHeat(state, prior, x([1]), 40);
    expect(update.accepted).toBe(false);
    expect(update.state).toBe(state);
    expect(update.state.gram[0][0]).toBe(before);
    expect(update.state.weight).toBe(state.weight);
  });
});

describe("forgetting", () => {
  it("decays the accumulated fit by the factor before every add", () => {
    let state = emptyHeatFit();
    for (let i = 0; i < 3; i += 1) state = add(state, [1], 4.05);
    expect(FORGETTING).toBe(0.95);
    // Three adds at λ = 0.95 leave 0.95² + 0.95 + 1 rows of weight.
    expect(state.weight).toBeCloseTo(0.95 ** 2 + 0.95 + 1, 10);
    // And the gram is the decayed sum of the outer products, row for row.
    const expected = 0.95 ** 2 + 0.95 + 1;
    expect(state.gram[0][0]).toBeCloseTo(expected, 10);
    expect(state.rhs[0]).toBeCloseTo(4.05 * expected, 10);
  });

  it("accumulates the residual of the pre-update fit", () => {
    // y = 4.05 against a prior prediction of 4.0 is a 0.05 C residual.
    const state = add(emptyHeatFit(), [1], 4.05);
    expect(state.rss).toBeCloseTo(0.05 ** 2, 10);
    expect(heatSigma(state)).toBeCloseTo(RESIDUAL_SIGMA_FLOOR, 10);
  });

  it("lets a drained fit return to the prior", () => {
    let state = emptyHeatFit();
    for (let i = 0; i < 400; i += 1) state = add(state, [1], 4);
    const { mean, sd } = solveHeat(state, prior);
    expect(mean[HEAT_LEG_COLUMN.npu]).toBeCloseTo(SEEDS.npu, 1);
    expect(sd[HEAT_LEG_COLUMN.npu]).toBeLessThan(1);
  });
});

describe("ucb", () => {
  it("is mean + 1 sd as a multiple of the seed", () => {
    // AUDIT-3's arithmetic: seed 3.2 with mean 3.2 and sd 0.8 is UCB 4.0.
    expect(legHeatUcb(3.2, 0.8, 3.2)).toBeCloseTo(4, 10);
  });

  it("clamps the multiple to 0.75-3 of the seed", () => {
    expect(legHeatUcb(0, 0, 3.2)).toBeCloseTo(UCB_MIN * 3.2, 10);
    expect(legHeatUcb(100, 100, 3.2)).toBeCloseTo(UCB_MAX * 3.2, 10);
    // A negative fit cannot undercut the floor (the binding rejects it).
    expect(legHeatUcb(-5, 0, 3.2)).toBeCloseTo(UCB_MIN * 3.2, 10);
  });

  it("refuses a leg the device row does not price", () => {
    expect(legHeatUcb(1, 1, 0)).toBeNull();
  });

  it("reports the background as mean + sd on the same 0.75-3 clamp", () => {
    // No data: the prior mean 0 and its 0.5 C/min sd read as 1.0 x 0.5.
    expect(backgroundUcb(0, 0.5)).toBeCloseTo(0.5, 10);
    // A negative fit contributes nothing (the binding rejects one).
    expect(backgroundUcb(-2, 0.5)).toBeCloseTo(0.5, 10);
    // ...and cannot undercut the floor either.
    expect(backgroundUcb(-2, 0.1)).toBeCloseTo(UCB_MIN * 0.5, 10);
    expect(backgroundUcb(-2, 0.1)).toBeCloseTo(0.375, 10);
    // A wild rate is capped at 3 x the prior scale instead of being sent on.
    expect(backgroundUcb(10, 1)).toBeCloseTo(UCB_MAX * 0.5, 10);
    expect(backgroundUcb(10, 1)).toBeCloseTo(1.5, 10);
    // Inside the band it is mean + sd, unscaled.
    expect(backgroundUcb(0.6, 0.2)).toBeCloseTo(0.8, 10);
  });
});

describe("speed EWMA", () => {
  it("seeds on the first sample and blends after", () => {
    expect(ewmaSpeed(null, 21)).toBe(21);
    expect(ewmaSpeed(20, 24)).toBeCloseTo(0.25 * 24 + 0.75 * 20, 10);
  });
});