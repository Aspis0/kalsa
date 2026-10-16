import assert from "node:assert/strict";
import { test } from "node:test";
import { compareBattery } from "../battery.mjs";
import { fitHeat } from "../fit.mjs";
import { HEAT_FEATURES, measureRow } from "../perRow.mjs";
import { prefillAttribution } from "../prefill.mjs";
import { render } from "../report.mjs";
import { readObservations } from "../rows.mjs";
import { verdicts } from "../verdicts.mjs";

const FIXTURE = new URL("./fixture.jsonl", import.meta.url).pathname;

/** The whole pipeline over the fixture, exactly as run.mjs drives it. A broken
 *  render path throws here instead of only on a real phone file. */
const renderFixture = () => {
  const { rows, droppedGap, lines } = readObservations(FIXTURE);
  const measurements = rows.map((row, index) => measureRow(row, index));
  const usable = measurements.filter((m) => m.fitExclusion === null);
  const column = (name) => ({ name, values: usable.map((m) => m.features[name]) });
  const y = usable.map((m) => m.targetC);
  const fit = fitHeat({ columns: HEAT_FEATURES.map(({ name }) => column(name)), y });
  const withoutCooling = fitHeat({
    columns: HEAT_FEATURES.filter((f) => f.name !== "cool").map(({ name }) => column(name)),
    y,
  });
  const battery = compareBattery(rows);
  return render({
    source: FIXTURE,
    lines,
    rows,
    droppedGap,
    measurements,
    fit,
    withoutCooling,
    battery,
    prefill: prefillAttribution(rows),
    verdicts: verdicts({ measurements, fit, withoutCooling, battery }),
  });
};

test("the report renders every section over a fixture file", () => {
  const markdown = renderFixture();
  for (const heading of [
    "## 1. Rows, legs and speed",
    "## 2. Derived wake start",
    "## 3. Freshness distributions",
    "## 4. Forecast noise",
    "## 5. Zone hot temperatures",
    "## 6. Battery sysfs",
    "## 7. Heat fit",
    "## 8. Per-device prefill attribution",
    "## 9. What this replay cannot measure",
    "## 10. OPEN verdicts",
  ]) {
    assert.ok(markdown.includes(heading), `missing ${heading}`);
  }
  assert.match(markdown, /GPU overshoot: not measurable/);
  assert.equal(markdown.includes("undefined"), false);
  assert.equal(markdown.includes("NaN"), false);
});

test("a row with an empty ring prints a dash for the wake and 0 coverage", () => {
  const markdown = renderFixture();
  const section1 = markdown.split("## 2.")[0].split("\n");
  // Row h carries no decode window at all: no wake, no windows, no ring.
  assert.match(section1.find((line) => line.startsWith("| 7 | h |")), /\| 7 \| h \| 0 \| 69 \| 0 \| 0\.00 \|/);
  assert.ok(section1.find((line) => line.startsWith("| 7 | h |")).includes("| - |"), "wake must print a dash");
  const section2 = markdown.split("## 2.")[1].split("## 3.")[0].split("\n");
  // §2's columns start at the row index, so the empty-ring row reads:
  // wake "-", no windows, no tokens per leg, ring coverage 0 of 70 tokens.
  const cells = section2
    .find((line) => line.startsWith("| 7 | - |"))
    .split("|")
    .map((cell) => cell.trim())
    .filter((cell) => cell !== "");
  assert.deepEqual(cells, ["7", "-", "0", "0", "0", "0", "0", "0", "0", "0", "70", "0.0 %"]);
});