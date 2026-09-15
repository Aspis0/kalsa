#!/usr/bin/env node
// Aggregate the energy CSVs produced by device-ngram-spec.sh (ENERGY=1).
//
// Each CSV (from scripts/energy-sample.sh running on-device) holds 1 Hz rows:
//   t_s,current_uA,voltage_uV,batt_temp_deciC,cpu_freqs_kHz,zones_temp_deciC
// cpu_freqs_kHz is colon-joined across CPUs.
//
// Reported per file: samples, duration, mean |power| W, J for the window,
// mean and min total CPU bandwidth (sum of per-CPU kHz — the throttle signal:
// battery temp proved pinned/useless while tok/s swung 2x), and J/rep when a
// rep count is derivable from the sibling results.txt naming.
//
// v1 caveats (documented, not bugs): current sign/units vary per vendor, so
// power uses |V*I| and J is for RELATIVE between-arm comparison only; the
// window includes model load + prefill (identical across arms of the same
// model+prompt), so deltas are meaningful, absolutes are not.
//
// Usage: node scripts/energyAggregate.mjs [dir=device-ngram-spec-out]

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "device-ngram-spec-out";
const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();

if (!files.length) {
  console.error(`no *.csv in ${dir}`);
  process.exit(1);
}

const rows = (file) =>
  readFileSync(path.join(dir, file), "utf8")
    .split("\n")
    .filter((l) => l && !l.startsWith("t_s,"))
    .map((l) => l.split(","))
    .filter((p) => p.length >= 5);

console.log("| arm csv | n | s | mean W | J | J/rep* | sumCPU kHz mean | min |");
console.log("|---|---|---|---|---|---|---|---|");
for (const f of files) {
  const rs = rows(f);
  if (rs.length < 2) { console.log(`| ${f} | too few samples | | | | | | |`); continue; }
  let joules = 0, wsum = 0, fwsum = 0, fmin = Infinity;
  const t0 = parseFloat(rs[0][0]);
  let tPrev = t0;
  for (const [t, i, v, , fr] of rs) {
    const ts = parseFloat(t);
    const dt = Math.max(0, ts - tPrev);
    tPrev = ts;
    const cur = Math.abs(parseFloat(i) ?? NaN);   // uA, sign varies per vendor
    const volt = Math.abs(parseFloat(v) ?? NaN);  // uV
    const p = Number.isFinite(cur) && Number.isFinite(volt) ? (cur * volt) / 1e12 : NaN; // W
    if (Number.isFinite(p)) { joules += p * dt; wsum += p; }
    const freqSum = (fr || "").split(":").reduce((s, x) => s + (parseInt(x) || 0), 0);
    if (freqSum > 0) { fwsum += freqSum; fmin = Math.min(fmin, freqSum); }
  }
  const n = rs.length;
  const dur = tPrev - t0;
  const meanW = wsum / n;
  const meanF = fwsum / n;
  // rep count from the sibling naming convention _r<N>.txt is not in the csv
  // name (one csv per ARM, not per rep) — print J/arm; per-rep division needs
  // REPS from the run (default 2).
  console.log(
    `| ${f.replace(".csv", "")} | ${n} | ${dur.toFixed(0)} | ${meanW.toFixed(2)} | ` +
    `${joules.toFixed(0)} | ${(joules / 2).toFixed(0)}* | ${meanF.toFixed(0)} | ${fmin.toFixed(0)} |`,
  );
}
console.log("\n* J/rep assumes REPS=2. Relative metric only: window includes load+prefill;");
console.log("  power = |V*I| from the fuel gauge (vendor sign/units, ~1s gauge smoothing).");
