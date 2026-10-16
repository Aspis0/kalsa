/**
 * CLI for the Stage 0 replay (DESIGN 3.3).
 *   node run.mjs <observations.jsonl> <report.md>
 * Reads one pulled file, writes the markdown report. Exit code 0 on success,
 * 1 on a read, shape or usage failure.
 */
import { writeFileSync } from "node:fs";
import { compareBattery } from "./battery.mjs";
import { fitHeat } from "./fit.mjs";
import { HEAT_FEATURES, measureRow } from "./perRow.mjs";
import { prefillAttribution } from "./prefill.mjs";
import { render } from "./report.mjs";
import { readObservations } from "./rows.mjs";
import { verdicts } from "./verdicts.mjs";

const [source, target] = process.argv.slice(2);
if (!source || !target) {
  process.stderr.write("usage: node run.mjs <observations.jsonl> <report.md>\n");
  process.exit(1);
}

const { rows, droppedGap, lines } = readObservations(source);
if (rows.length === 0) {
  process.stderr.write(`${source}: no usable rows (${droppedGap.length} gap rows dropped)\n`);
  process.exit(1);
}

const measurements = rows.map((row, index) => measureRow(row, index));
const usable = measurements.filter((m) => m.fitExclusion === null);
const column = (name) => ({ name, values: usable.map((m) => m.features[name]) });
const targets = usable.map((m) => m.targetC);
const fit = fitHeat({ columns: HEAT_FEATURES.map(({ name }) => column(name)), y: targets });
const withoutCooling = fitHeat({
  columns: HEAT_FEATURES.filter((f) => f.name !== "cool").map(({ name }) => column(name)),
  y: targets,
});

const battery = compareBattery(rows);
writeFileSync(
  target,
  `${render({
    source,
    lines,
    rows,
    droppedGap,
    measurements,
    fit,
    withoutCooling,
    battery,
    prefill: prefillAttribution(rows),
    verdicts: verdicts({ measurements, fit, withoutCooling, battery }),
  })}\n`,
);
process.stdout.write(
  `${target}: ${rows.length} rows, ${droppedGap.length} gap rows dropped, ` +
    `${measurements.reduce((sum, m) => sum + m.windows, 0)} windows, fit on ${fit.rows} rows\n`,
);