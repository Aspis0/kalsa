import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBattery } from "../battery.mjs";
import { countAbove, describe } from "../distributions.mjs";
import { prefillAttribution, prefillDeviceCase } from "../prefill.mjs";
import { readObservations } from "../rows.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;
const rows = readObservations(FIXTURE).rows;

test("the battery comparison reads only the rows where the probe answered", () => {
  const battery = compareBattery(rows);
  // Every row but c answered both probes; c is the denied one.
  assert.equal(battery.tempOk, 6);
  assert.equal(battery.tempCompared, 6);
  assert.equal(battery.withinHalfC, 6);
  assert.equal(battery.maxTempDeltaC, 0.2);
  assert.equal(battery.statusCompared, 6);
  // Row d's sysfs says Full (charging) while the row says unplugged.
  assert.equal(battery.statusAgreed, 5);
  assert.equal(battery.agreementPct, 5 / 6);
  assert.match(battery.verdict, /disagree/);
});

test("a denied probe everywhere reads as OPEN 4 answered negatively", () => {
  const denied = rows.filter((row) => row.bsys[0] === 0);
  assert.match(compareBattery(denied).verdict, /answered negatively/);
});

test("one probe readable is half the criterion, not all of it", () => {
  const [row] = rows;
  const tempOnly = compareBattery([{ ...row, bsys: [1, 300, 0, null] }]);
  assert.equal(tempOnly.tempCompared, 1);
  assert.equal(tempOnly.statusCompared, 0);
  assert.match(tempOnly.verdict, /status unreadable: the combined criterion is untested/);
  const statusOnly = compareBattery([{ ...row, bsys: [0, null, 1, 3] }]);
  assert.match(statusOnly.verdict, /temperature unreadable: the combined criterion is untested/);
});

test("the device decides the prefill case, not the route label", () => {
  const byTurn = new Map(rows.map((row) => [row.t, row]));
  assert.equal(prefillDeviceCase(byTurn.get("e")), "npu");
  assert.equal(prefillDeviceCase(byTurn.get("f")), "gpu");
  assert.equal(prefillDeviceCase(byTurn.get("a")), "absent");
  assert.equal(prefillDeviceCase({ prefill_dev: ["HTP0", "GPUOpenCL"] }), "mixed");
  assert.equal(prefillDeviceCase({ prefill_dev: [] }), "absent");
});

test("attribution is per DEVICE and never mixes a row without a prefill time", () => {
  const attribution = prefillAttribution(rows);
  assert.equal(attribution.rowsWithM4, 3);
  assert.equal(attribution.rowsMissingM4, 5);
  assert.deepEqual(attribution.deviceCases, { gpu: 1, npu: 2, mixed: 0, absent: 5 });

  // Turn g is the shape that produced the bogus rate: two rows, ONE of which
  // carries prefill_ms (1000) and 400 prompt tokens, while its round 1 sibling
  // has no prefill time but 500 prompt tokens. Summing the turn's prompt
  // tokens against the timed row's milliseconds is what must NOT happen.
  const npu = attribution.devices.find((device) => device.device === "npu");
  assert.deepEqual(
    { rows: npu.rows, promptTokens: npu.promptTokens, prefillMs: npu.prefillMs },
    { rows: 2, promptTokens: 800, prefillMs: 2000 },
  );
  assert.equal(npu.prefillTokPerSec, 400);
  // Row g/round 1 (500 prompt tokens, no prefill_ms) is left out entirely.
  assert.equal(attribution.perRow.some((row) => row.turn === "g" && row.promptTokens === 500), false);
});

test("each M4 row is reported on its own, and the mislabel is stated", () => {
  const attribution = prefillAttribution(rows);
  const mislabel = attribution.perRow.find((row) => row.turn === "e");
  assert.match(mislabel.agreement, /route says GPU, layers ran on HTP0/);
  assert.equal(mislabel.prefillTokPerSec, 400);
  const gpu = attribution.devices.find((device) => device.device === "gpu");
  assert.equal(gpu.prefillTokPerSec, 400);
  assert.match(attribution.agreements.join(" "), /route says GPU, layers ran on HTP0/);
});

test("a row with no prefill time has no rate at all, not a rate of zero", () => {
  const [row] = rows;
  assert.equal(prefillAttribution([row]).perRow.length, 0);
  assert.equal(prefillAttribution([row]).devices.length, 0);
});

test("percentiles are nearest-rank, so they never invent a value", () => {
  assert.deepEqual(describe([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]), {
    n: 10,
    min: 1,
    p50: 5,
    p90: 9,
    max: 10,
    mean: 5.5,
  });
  assert.equal(describe([]).p50, null);
  assert.equal(describe([1, null, Number.NaN, 3]).n, 2);
  assert.equal(countAbove([1, 5, 10], 4), 2);
});