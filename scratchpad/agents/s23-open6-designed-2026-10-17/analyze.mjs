/**
 * Does the design move the cooling term independently of turn length?
 *   node analyze.mjs <raw_dir>
 * Reads raw/observations.jsonl through the replay's own loader and measureRow, joins raw/labels.tsv (row -> design),
 * and prints per-row values plus the within-design correlations that OPEN 6 needs:
 *   corr(gap, h_wake)   - does an idle gap change the headroom the completion wakes with (the cooling input)?
 *   corr(wall_min, cool) - how much of the cooling column is just turn length?
 *   corr(gap, wall_min)  - should be ~0 by design: the gap is randomised against length.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const REPLAY = process.env.REPLAY ?? "/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/learning-governor/replay";
const raw = process.argv[2];
if (!raw) {
  process.stderr.write("usage: node analyze.mjs <raw_dir>\n");
  process.exit(1);
}
const { readObservations } = await import(pathToFileURL(join(REPLAY, "rows.mjs")).href);
const { measureRow } = await import(pathToFileURL(join(REPLAY, "perRow.mjs")).href);

const { rows } = readObservations(join(raw, "observations.jsonl"));
const labels = readFileSync(join(raw, "labels.tsv"), "utf8").trim().split("\n").slice(1).map((l) => l.split("\t"));
if (labels.length !== rows.length) {
  process.stderr.write(`label/row mismatch: ${labels.length} labels, ${rows.length} rows\n`);
  process.exit(1);
}

const out = rows.map((row, i) => {
  const m = measureRow(row, i);
  const [, , turn, length, gapTarget, gapActual] = labels[i];
  return {
    turn: Number(turn),
    length,
    gapTarget: Number(gapTarget),
    gapActual: Number(gapActual),
    state: row.state,
    predN: m.predN,
    wallMin: m.wallMin,
    hWake: m.hWake,
    cool: m.features.cool,
    npuK: m.features.npu_k,
    fit: m.fitExclusion === null,
  };
});

const fmt = (v, d = 2) => (v === null || v === undefined || Number.isNaN(v) ? "-" : Number(v).toFixed(d));
console.log("| turn | length | gap tgt | gap act s | state | pred_n | wall min | h_wake | cool | npu_k | fit |");
console.log("|---|---|---|---|---|---|---|---|---|---|---|");
for (const r of out) {
  console.log(`| ${r.turn} | ${r.length} | ${r.gapTarget} | ${r.gapActual} | ${r.state} | ${r.predN} | ` +
    `${fmt(r.wallMin)} | ${fmt(r.hWake, 3)} | ${fmt(r.cool, 3)} | ${fmt(r.npuK, 3)} | ${r.fit ? "yes" : "no"} |`);
}

const usable = out.filter((r) => r.fit && r.hWake !== null);
const pearson = (xs, ys) => {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
};
const col = (f) => usable.map(f);
console.log("");
console.log(`usable rows (fit): ${usable.length} of ${out.length}`);
console.log(`corr(gap_actual, h_wake)    = ${fmt(pearson(col((r) => r.gapActual), col((r) => r.hWake)), 3)}`);
console.log(`corr(wall_min, cool)        = ${fmt(pearson(col((r) => r.wallMin), col((r) => r.cool)), 3)}`);
console.log(`corr(gap_actual, wall_min)  = ${fmt(pearson(col((r) => r.gapActual), col((r) => r.wallMin)), 3)}`);
console.log(`corr(gap_actual, cool)      = ${fmt(pearson(col((r) => r.gapActual), col((r) => r.cool)), 3)}`);

console.log("");
console.log("| length | gap tgt | n | mean h_wake | mean wall min | mean cool | mean npu_k |");
console.log("|---|---|---|---|---|---|---|");
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
for (const length of ["short", "long"]) {
  for (const gap of [0, 2, 5, 10]) {
    const cell = usable.filter((r) => r.length === length && r.gapTarget === gap);
    console.log(`| ${length} | ${gap} | ${cell.length} | ${fmt(mean(cell.map((r) => r.hWake)), 3)} | ` +
      `${fmt(mean(cell.map((r) => r.wallMin)))} | ${fmt(mean(cell.map((r) => r.cool)), 3)} | ` +
      `${fmt(mean(cell.map((r) => r.npuK)), 3)} |`);
  }
}
