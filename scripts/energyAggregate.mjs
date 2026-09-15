#!/usr/bin/env node
// Aggregate the energy CSVs produced by device-ngram-spec.sh (ENERGY=1).
//
// Parsing + integration live in scripts/energySchema.mjs (shared with the
// reserved per-rep phase splitter). This file is the between-arm table over a
// campaign dir, plus the optional CodeCarbon-compatible export (--emissions):
// one <dir>/emissions/<stem>_emissions.csv per arm — degenerate arms (fewer
// than two parsed rows, or no valid power sample) export a header-only file
// with an explicit stderr warning, never a silent skip. stdout stays
// table-only; export notes go to stderr. KALSA_GRID_G_PER_KWH (gCO2eq/kWh)
// fills the emissions column; it is read only when --emissions is active,
// and unset/empty/non-numeric/non-positive values keep the column empty
// (battery-powered run). A failed write never truncates the table: stdout
// prints in full, then "emissions export failed: <reason>" on stderr, exit 1.
//
// Audit-hardened via energySchema.mjs (deepseek-v4.1 audit of c5fae2f): torn
// last line dropped, strict field regex (unparseable rows warn on stderr),
// monotonic t enforced, per-metric valid counts, 0.1-20 W sanity band; J/rep
// derives REPS from the sibling ${stem}_r<N>.txt files, no hardcode.
//
// Still true: power = |V*I| at the battery terminal, ~1 s gauge smoothing —
// a RELATIVE between-arm metric only (window includes load+prefill). The
// dilution from display/radio floor means J deltas run smaller than tok/s
// deltas; do not quote absolute J/token from this harness.
//
// Usage: node scripts/energyAggregate.mjs [dir=device-ngram-spec-out] [--emissions]

import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  parseEnergyCsv,
  integrate,
  toEmissionsRow,
  toEmissionsCsv,
  emptyEmissionsCsv,
} from "./energySchema.mjs";

const args = process.argv.slice(2);
const emissions = args.includes("--emissions");
const dir = args.find((a) => !a.startsWith("--")) ?? "device-ngram-spec-out";
if (!existsSync(dir)) {
  console.error(`no such directory: ${dir}`);
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();
if (!files.length) {
  console.error(`no *.csv in ${dir}`);
  process.exit(1);
}

// Grid intensity only matters for the export: read the env var exclusively
// under --emissions, and only trust strictly positive finite values.
let grid;
if (emissions) {
  const gridRaw = process.env.KALSA_GRID_G_PER_KWH;
  if (gridRaw !== undefined && gridRaw !== "") {
    const n = Number(gridRaw);
    if (!Number.isFinite(n)) {
      console.error(`energyAggregate: ignoring non-numeric KALSA_GRID_G_PER_KWH=${gridRaw}`);
    } else if (n <= 0) {
      console.error(`energyAggregate: ignoring non-positive KALSA_GRID_G_PER_KWH=${gridRaw}`);
    } else {
      grid = n;
    }
  }
}

const emissionsDir = path.join(dir, "emissions");
const wrote = [];
const degenerate = [];
const writeErrors = [];

// m === null → degenerate run: header-only file, flagged in `degenerate`.
function exportEmissions(stem, m) {
  const out = path.join(emissionsDir, `${stem}_emissions.csv`);
  try {
    mkdirSync(emissionsDir, { recursive: true });
    writeFileSync(
      out,
      m ? toEmissionsCsv([toEmissionsRow({ stem, ...m, gridGPerKwh: grid })]) : emptyEmissionsCsv(),
    );
  } catch (err) {
    writeErrors.push(err);
    return;
  }
  wrote.push(out);
  if (!m) degenerate.push(stem);
}

console.log("| arm | n | s | mean W | J | J/rep | sumCPU kHz mean | min |");
console.log("|---|---|---|---|---|---|---|---|");
for (const f of files) {
  const stem = f.replace(/\.csv$/, "");
  const { rows: rs, torn, empty, skipped } = parseEnergyCsv(readFileSync(path.join(dir, f), "utf8"));
  if (skipped) console.error(`energyAggregate: ${stem}: skipped ${skipped} unparseable row(s)`);
  const marker = empty ? " (empty file)" : torn ? " (torn tail dropped)" : "";
  if (rs.length < 2) {
    console.log(`| ${stem} | ${rs.length}${marker} | too few samples | | | | | |`);
    if (emissions) exportEmissions(stem, null);
    continue;
  }
  const m = integrate(rs);
  for (const w of m.warnings) console.log(`  WARNING: ${stem} ${w}`);
  if (emissions) {
    if (m.n_power > 0) {
      exportEmissions(stem, m);
      if (m.duration_s < 1 || m.mean_w < 0.1) {
        console.error(
          `emissions: ${stem}: degenerate measurement exported ` +
          `(duration ${m.duration_s.toFixed(2)} s, mean ` +
          `${Number.isFinite(m.mean_w) ? `${m.mean_w.toFixed(2)} W` : "n/a"})`,
        );
      }
    } else {
      exportEmissions(stem, null);
    }
  }
  // REPS from sibling per-rep outputs: ${stem}_r<N>.txt
  let reps = 0;
  try {
    reps = readdirSync(dir).filter((x) => x.startsWith(`${stem}_r`) && x.endsWith(".txt")).length;
  } catch { /* dir unreadable: no J/rep */ }
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
  console.log(
    `| ${stem} | ${rs.length}${torn ? "+torn" : ""} | ${fmt(m.duration_s, 0)} | ${fmt(m.mean_w)} | ` +
    `${fmt(m.joules, 0)} | ${reps ? fmt(m.joules / reps, 0) : "n/a"} | ${fmt(m.sum_cpu_khz_mean, 0)} | ${fmt(m.sum_cpu_khz_min, 0)} |`,
  );
}
console.log("\nRelative metric only: window includes load+prefill; power = |V*I| at the");
console.log("battery terminal (gauge ~1 s smoothing). J/rep needs the per-rep txt files.");

if (emissions) {
  for (const out of wrote) console.error(`emissions: wrote ${out}`);
  for (const stem of degenerate) console.error(`emissions: ${stem}: degenerate run, header-only export`);
  if (wrote.length && !writeErrors.length) {
    console.error(
      grid !== undefined
        ? `emissions: grid factor ${grid} gCO2eq/kWh (KALSA_GRID_G_PER_KWH) applied`
        : "emissions: KALSA_GRID_G_PER_KWH unset — emissions column left empty (battery-powered)",
    );
  }
  if (writeErrors.length) {
    for (const msg of new Set(writeErrors.map((e) => String(e.message ?? e)))) {
      console.error(`emissions export failed: ${msg}`);
    }
    process.exitCode = 1;
  }
}
