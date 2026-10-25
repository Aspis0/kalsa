#!/usr/bin/env node
// Aggregate scripts/device-ngram-spec.sh results into one table per model.
//
// Input:  device-ngram-spec-out/results.txt (default) — the tee'd campaign log.
// Output: per-(model, prompt) markdown table: arm, mean/speeds, spread, gate.
//
// Usage: node scripts/ngramSpecAggregate.mjs [results.txt]

import { readFileSync } from "node:fs";

const file = process.argv[2] ?? "device-ngram-spec-out/results.txt";
const lines = readFileSync(file, "utf8").split("\n");

// results.txt grammar (see device-ngram-spec.sh):
//   "--- <model>  prompt=<P>  (t=…)"
//   "  arm: <name>"
//   "    r1: Generation: 9.2 t/s"          (or "no-speed-line")
//   "  greedy gate: IDENTICAL (2 reps)"    / "GREEDY GATE FAILED r1 …"
const sections = [];
let cur = null;

for (const line of lines) {
  const sec = line.match(/--- (\S+)  prompt=(\S+)/);
  if (sec) {
    cur = { model: sec[1], prompt: sec[2], arms: new Map(), arm: null };
    sections.push(cur);
    continue;
  }
  const arm = line.match(/arm: (\S+)/);
  if (arm && cur) {
    cur.arm = arm[1];
    if (!cur.arms.has(cur.arm)) {
      cur.arms.set(cur.arm, { speeds: [], gate: "n/a" });
    }
    continue;
  }
  const speed = line.match(/r\d+: (?:Generation: ([\d.]+) t\/s|(no-speed-line))/);
  if (speed && cur && cur.arm) {
    const a = cur.arms.get(cur.arm);
    if (speed[1]) a.speeds.push(parseFloat(speed[1]));
    else a.speeds.push(NaN);
    continue;
  }
  const gate = line.match(/greedy gate: (IDENTICAL|FAILED|GATE INCONCLUSIVE)/);
  if (gate && cur && cur.arm) {
    cur.arms.get(cur.arm).gate = gate[1];
    continue;
  }
  const gateFailed = line.match(/GREEDY GATE FAILED/);
  if (gateFailed && cur && cur.arm) {
    cur.arms.get(cur.arm).gate = "FAILED";
  }
}

const mean = (xs) => {
  const v = xs.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
};
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");

let baseline = null;
for (const sec of sections) {
  console.log(`\n### ${sec.model} — prompt ${sec.prompt}`);
  console.log("| arm | tok/s (mean) | speeds | vs none | greedy gate |");
  console.log("|---|---|---|---|---|");
  baseline = sec.arms.get("none");
  const baseMean = mean(baseline?.speeds ?? []);
  for (const [arm, a] of sec.arms) {
    const m = mean(a.speeds);
    const delta =
      arm !== "none" && Number.isFinite(m) && Number.isFinite(baseMean) && baseMean > 0
        ? `${(((m - baseMean) / baseMean) * 100).toFixed(1)}%`
        : "—";
    console.log(
      `| ${arm} | ${fmt(m)} | ${a.speeds.map(fmt).join(", ") || "—"} | ${delta} | ${a.gate} |`,
    );
  }
}
console.log(
  "\nGate legend: IDENTICAL = greedy output equals baseline byte-for-byte; " +
    "FAILED = the arm accepted a draft token the target would not have sampled.",
);
