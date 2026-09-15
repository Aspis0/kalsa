#!/usr/bin/env node
// Aggregate the energy CSVs produced by device-ngram-spec.sh (ENERGY=1).
//
// CSV rows (scripts/energy-sample.sh, on-device, ~1 Hz):
//   t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz
// cpu_freqs_kHz is colon-joined across CPUs.
//
// Audit-hardened (deepseek-v4.1 audit of c5fae2f):
// - torn last line (pull during write) is dropped: the file must end with \n;
// - strict field regex, rows that do not parse are dropped and counted;
// - monotonic t enforced: a row with t <= previous (device reboot) is dropped
//   with a warning instead of yielding negative durations;
// - per-metric valid counts: mean W and mean kHz divide by their own n, so a
//   failed read cannot dilute the mean; fmin prints n/a instead of Infinity;
// - power sanity band 0.1-20 W: outside it we warn (unit mismatch detection);
// - J/rep derives REPS from the sibling ${stem}_r<N>.txt files, no hardcode.
//
// Still true: power = |V*I| at the battery terminal, ~1 s gauge smoothing —
// a RELATIVE between-arm metric only (window includes load+prefill). The
// dilution from display/radio floor means J deltas run smaller than tok/s
// deltas; do not quote absolute J/token from this harness.
//
// Usage: node scripts/energyAggregate.mjs [dir=device-ngram-spec-out]

import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const dir = process.argv[2] ?? "device-ngram-spec-out";
if (!existsSync(dir)) {
  console.error(`no such directory: ${dir}`);
  process.exit(1);
}
const files = readdirSync(dir).filter((f) => f.endsWith(".csv")).sort();
if (!files.length) {
  console.error(`no *.csv in ${dir}`);
  process.exit(1);
}

const ROW = /^(\d+\.\d+),(-?\d*),(-?\d*),(-?\d*),([^,]*),([:\d]*)$/;

const rows = (file) => {
  let text = readFileSync(path.join(dir, file), "utf8");
  const torn = !text.endsWith("\n");
  if (torn) text = text.slice(0, text.lastIndexOf("\n") + 1); // drop torn tail
  const out = [];
  for (const l of text.split("\n")) {
    if (!l || l.startsWith("t_s,")) continue;
    const m = l.match(ROW);
    if (m) out.push({ t: parseFloat(m[1]), i: m[2], v: m[3], f: m[6] });
  }
  return { rows: out, torn };
};

console.log("| arm | n | s | mean W | J | J/rep | sumCPU kHz mean | min |");
console.log("|---|---|---|---|---|---|---|---|");
for (const f of files) {
  const stem = f.replace(/\.csv$/, "");
  const { rows: rs, torn } = rows(f);
  if (rs.length < 2) {
    console.log(`| ${stem} | ${rs.length}${torn ? " (torn tail dropped)" : ""} | too few samples | | | | | |`);
    continue;
  }
  let joules = 0, wsum = 0, nP = 0, fwsum = 0, nF = 0, fmin = Infinity;
  let dur = 0, tPrev = rs[0].t, tReg = 0;
  for (const r of rs) {
    if (r.t < tPrev) { tReg++; continue; } // non-monotonic (reboot): drop
    const dt = r.t - tPrev;
    tPrev = r.t;
    dur += dt;
    const cur = Math.abs(parseFloat(r.i));
    const volt = Math.abs(parseFloat(r.v));
    if (Number.isFinite(cur) && Number.isFinite(volt) && cur !== 0 && volt !== 0) {
      const p = (cur * volt) / 1e12; // uA*uV -> W
      joules += p * dt;
      wsum += p;
      nP++;
    }
    const freqSum = (r.f || "").split(":").reduce((s, x) => s + (parseInt(x) || 0), 0);
    if (freqSum > 0) { fwsum += freqSum; nF++; if (freqSum < fmin) fmin = freqSum; }
  }
  const meanW = nP ? wsum / nP : NaN;
  const meanF = nF ? fwsum / nF : NaN;
  if (Number.isFinite(meanW) && (meanW < 0.1 || meanW > 20)) {
    console.log(`  WARNING: ${stem} mean W ${meanW.toFixed(2)} outside the 0.1-20 W sanity band (unit mismatch?)`);
  }
  if (tReg) console.log(`  WARNING: ${stem} dropped ${tReg} non-monotonic row(s)`);
  // REPS from sibling per-rep outputs: ${stem}_r<N>.txt
  let reps = 0;
  try {
    reps = readdirSync(dir).filter((x) => x.startsWith(`${stem}_r`) && x.endsWith(".txt")).length;
  } catch { /* dir unreadable: no J/rep */ }
  const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : "n/a");
  console.log(
    `| ${stem} | ${rs.length}${torn ? "+torn" : ""} | ${fmt(dur, 0)} | ${fmt(meanW)} | ` +
    `${fmt(joules, 0)} | ${reps ? fmt(joules / reps, 0) : "n/a"} | ${fmt(meanF, 0)} | ${nF ? fmt(fmin, 0) : "n/a"} |`,
  );
}
console.log("\nRelative metric only: window includes load+prefill; power = |V*I| at the");
console.log("battery terminal (gauge ~1 s smoothing). J/rep needs the per-rep txt files.");
