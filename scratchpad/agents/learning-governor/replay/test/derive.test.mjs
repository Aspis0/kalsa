import assert from "node:assert/strict";
import { test } from "node:test";
import { HEAT_FEATURES, measureRow } from "../perRow.mjs";
import { readObservations } from "../rows.mjs";
import { headroomNoise, tokenSpans, zoneRise } from "../windows.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const byTurn = new Map(readObservations(FIXTURE).rows.map((row, index) => [row.t, { row, index }]));
const measured = (turn) => measureRow(byTurn.get(turn).row, byTurn.get(turn).index);

/** Derived numbers are floats, so they are asserted to 1e-9 rather than
 *  exactly: 30 x 0.03 is not 0.9 in binary floating point. */
const close = (actual, expected, epsilon = 1e-9) =>
  assert.ok(Math.abs(actual - expected) < epsilon, `${actual} != ${expected}`);

test("a window's span is the boundary difference, and the first sample spans nothing", () => {
  assert.deepEqual(tokenSpans(byTurn.get("a").row.win), [0, 32, 32, 32]);
});

test("zone rise skips a dark zone instead of reading it as zero", () => {
  const rise = zoneRise(byTurn.get("c").row.win);
  assert.deepEqual(
    { pairs: rise.cpu.pairs, dark: rise.cpu.dark },
    { pairs: 3, dark: 0 },
  );
  assert.deepEqual(
    { pairs: rise.npu.pairs, dark: rise.npu.dark },
    { pairs: 1, dark: 2 },
  );
  assert.equal(rise.cpu.min, 1);
  // The one npu pair that survives is (62.0 -> 63.0): the two dark windows
  // before it drop out instead of reading as a jump from nothing to 62 C.
  assert.equal(rise.npu.min, 1);
});

test("noise is the residual of the row's own trend", () => {
  close(headroomNoise([0.05, 0.06, 0.07, 0.08]).sigmaC, 0);
  // Slope 0.002 h/window, residuals -0.002 / 0.006 / -0.006 / 0.002 h, so
  // sigma = sqrt(80e-6 / 4) h = 0.004472 h = 0.134164 C on the 30 h map.
  close(headroomNoise([0.05, 0.06, 0.05, 0.06]).sigmaC, 0.134164, 1e-5);
  assert.equal(headroomNoise([0.04, null]).sigmaC, null);
});

test("a blind 0 is not a reading: noise ignores it, absent as well", () => {
  // A blind zero is a floor, so [0, 0, 0.02] carries ONE reading and cannot
  // produce a sigma; the three readings after a blind prefix can, and they are
  // the ones that must be measured.
  assert.equal(headroomNoise([0, 0, 0.02]).sigmaC, null);
  close(headroomNoise([0, 0.05, 0.06, 0.07]).sigmaC, 0);
  close(headroomNoise([null, 0.05, 0.06, 0.07]).sigmaC, 0);
});

test("on a warm row the wake hop is dropped too, leaving the ring's span", () => {
  // Wake at window 0 means every span except window 0's (which is empty) ran
  // awake - so the count equals the ring's last boundary, not that minus a hop.
  const m = measured("a");
  assert.equal(m.tokensFromWake.npu, 96);
  assert.equal(m.tokensCoveredByWindows, 96);
});

test("a warm row: wake at window 0, per-leg speed, y and the feature vector", () => {
  const m = measured("a");
  assert.equal(m.wakeIndex, 0);
  assert.equal(m.hWake, 0.05);
  assert.equal(m.skinWakeC, 38);
  assert.equal(m.hFirst, 0.05);
  assert.equal(m.hLast, 0.08);
  assert.equal(m.blindWindows, 0);
  assert.equal(m.fitExclusion, null);
  const npu = m.legSpeed.find((leg) => leg.leg === "npu");
  assert.equal(npu.tokPerSec, 20);
  assert.deepEqual(
    { cpu: m.tokensFromWake.cpu, gpu: m.tokensFromWake.gpu, npu: m.tokensFromWake.npu },
    { cpu: 0, gpu: 0, npu: 96 },
  );
  close(m.targetC, 0.9);
  close(m.features.npu_k, 0.096);
  close(m.features.prompt_k, 0.1);
  close(m.features.wall_min, 0.1);
  close(m.features.cool, -0.005);
  assert.deepEqual(
    { gpu_k: m.features.gpu_k, cpu_k: m.features.cpu_k, prefill_gpu_k: m.features.prefill_gpu_k },
    { gpu_k: 0, cpu_k: 0, prefill_gpu_k: 0 },
  );
});

test("the design vector names every feature the row builds", () => {
  assert.deepEqual(
    HEAT_FEATURES.map((feature) => feature.name),
    Object.keys(measured("a").features),
  );
});

test("a cold blind start wakes mid-completion and counts tokens only after it", () => {
  const m = measured("c");
  assert.equal(m.wakeIndex, 2);
  assert.equal(m.hWake, 0.02);
  assert.equal(m.hFirst, 0);
  assert.equal(m.blindWindows, 2);
  close(m.targetC, 0.3);
  // 96 tokens in the ring, and the span ending AT the wake boundary (64-32)
  // ran blind, so only the last window's 32 tokens are post-wake.
  assert.deepEqual(m.tokensFromWake, { cpu: 0, gpu: 0, npu: 32, coolmode: 0, unattributed: 0 });
  assert.equal(m.tokensCoveredByWindows, 96);
  assert.equal(m.decodeTokens, 96);
});

test("a row that goes blind again inside the span is censored out of the fit", () => {
  const m = measured("d");
  assert.equal(m.wakeIndex, 0);
  assert.equal(m.censored, true);
  assert.match(m.fitExclusion, /censored/);
});

test("an absent last headroom leaves no target", () => {
  const m = measured("e");
  assert.equal(m.wakeIndex, 0);
  assert.equal(m.hLast, null);
  assert.equal(m.absentWindows, 1);
  assert.equal(m.targetC, null);
  assert.match(m.fitExclusion, /no target/);
});

test("per-leg speed reads a mixed-leg row leg by leg", () => {
  const m = measured("e");
  assert.deepEqual(
    m.legSpeed.map((leg) => [leg.leg, leg.tokPerSec]),
    [
      ["cpu", 0],
      ["gpu", 32],
      ["npu", 16],
    ],
  );
  assert.deepEqual(
    { gpu: m.tokensFromWake.gpu, npu: m.tokensFromWake.npu },
    { gpu: 32, npu: 32 },
  );
});

test("a route label of GPU on HTP layers keeps the prefill heat off the GPU", () => {
  const m = measured("e");
  assert.equal(m.prefillCase, "npu");
  assert.equal(m.features.prefill_gpu_k, 0);
  const gpuPrefill = measured("f");
  assert.equal(gpuPrefill.prefillCase, "gpu");
  assert.equal(gpuPrefill.features.prefill_gpu_k, gpuPrefill.features.prompt_k);
});