#!/usr/bin/env node
// Per-rep phase split: disaggregate each rep's energy into PREFILL vs DECODE
// (the kalsa-energy-rep-v1 schema, reserved in docs/ENERGY-SCHEMA.md until
// now). One rep = one llama-cli run; the sampler CSV covers the whole arm, the
// ${stem}.marks sidecar carries one boundary per rep.
//
// VERIFIED FORMATS (device-ngram-spec.sh + real campaign data):
//   marks: one line "r<N> <uptime>" per rep, e.g. "r1 554225.50", written by
//     the harness AFTER rep N's llama-cli exits — so mark_N is rep N's END,
//     not its start. The value is /proc/uptime field 1: the same monotonic
//     device clock as the CSV t_s column, joined as-is with NO conversion.
//   ${stem}_rN.txt: llama-cli output. Guaranteed perf info is the one speed
//     line "[ Prompt: X t/s | Generation: Y t/s ]". Longer perf lines
//     ("prompt eval time = ... ms / N tokens", "eval time = ... ms / M runs")
//     are used when present but do not exist in current data.
//
// Rep windows: rep 1 = [first CSV sample, mark_1); rep i>1 = [mark_{i-1},
// mark_i). Samples after the last mark (sampler shutdown lag) belong to no
// rep. Boundary math: prefill ends at window_start + prompt-eval duration,
// where prompt-eval duration is the run's own "prompt eval time" ms when the
// perf line exists, else prompt_tokens / prompt t/s from the speed line.
// prompt_tokens/gen_tokens must be verifiable — from the run's own perf
// lines, or from --prompt-tokens/--gen-tokens supplied by the operator (e.g.
// measured once on-device with a verbose llama-cli run). Neither present ->
// the phase columns stay EMPTY with a warning; never a guess. A rep whose
// .txt is missing or has no parsable speed/perf line is skipped entirely.
//
// Integration is energySchema.integrate on each sub-window, so per-phase J is
// computed from the same right-Riemann sums as the whole-arm J. The sample
// interval straddling the boundary is attributed to the decode side (an
// interval belongs to its right-endpoint sample, which is at/after the
// boundary; the borrowed predecessor sample affects only that one interval),
// so j_prefill + j_decode equals the whole-window J exactly. The sampler is
// ~1 Hz, so each phase edge carries <= 1 sample (~1 s) of attribution
// uncertainty — at the sanity band's ceiling that is up to ~20 J per edge, a
// few J at the G99's typical 2-5 W. mean_w_* are means over the phase's OWN
// samples (the borrowed straddle sample is excluded); durations partition the
// window exactly (prefill_s + decode_s = duration) except that an empty phase
// reports no duration at all.
//
// By convention the window starts where the previous rep ENDED, so for i>1 it
// contains the harness's inter-rep sleep and the model load; the boundary
// formula attributes whatever falls before prompt-eval-end to the prefill
// bucket. Phase J is therefore a convention, not a clean physical prefill —
// between-arm deltas of the same phase remain meaningful because every arm
// gets the identical arithmetic.
//
// Output: <dir>/<stem>.phases.csv (one row per rep) plus a markdown table on
// stdout. NOTE for consumers: the file lands in the campaign dir and does NOT
// match the sampler schema — run energyAggregate.mjs on a dir without
// .phases.csv files (or before splitting), it lists every *.csv.
//
// Usage: node scripts/energyPhaseSplit.mjs [dir=device-ngram-spec-out] [stem ...]
//        [--prompt-tokens N] [--gen-tokens N]
// Exit 0 with per-rep warnings on stderr; exit 1 only if nothing was produced.

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnergyCsv, integrate } from "./energySchema.mjs";

export const PHASES_COLUMNS = [
  "run_id", "rep", "window_start_s", "duration", "prefill_s", "decode_s",
  "j_prefill", "j_decode", "j_prefill_per_ptok", "j_per_tok_decode",
  "prompt_tokens", "gen_tokens", "mean_w_prefill", "mean_w_decode",
  "n_samples_prefill", "n_samples_decode", "warnings",
];

// "[ Prompt: 11.2 t/s | Generation: 9.1 t/s ]" — the one perf line the
// harness guarantees. Returns null when absent or malformed.
export function parseSpeedLine(text) {
  const m = text.match(
    /\[\s*Prompt:\s*([0-9.]+)\s*t\/s\s*\|\s*Generation:\s*([0-9.]+)\s*t\/s\s*\]/,
  );
  if (!m) return null;
  const promptTps = parseFloat(m[1]);
  const genTps = parseFloat(m[2]);
  if (!(promptTps > 0) || !(genTps > 0)) return null;
  return { promptTps, genTps };
}

// Upstream llama.cpp perf summary (stderr, present only in builds that print
// it). Each field is used only when its line exists. The direct promptEvalMs
// is preferred over promptTokens/promptTps: the speed line's t/s is rounded,
// the ms value is the run's own measurement.
export function parsePerfLines(text) {
  const out = { promptEvalMs: null, promptTokens: null, genTokens: null };
  // Anchored on the llama_perf prefix so "prompt eval time" can never be
  // matched by the plain eval-time pattern (\s* then "eval" vs "prompt ...").
  const pe = text.match(/llama_perf_context_print:\s*prompt eval time\s*=\s*([0-9.]+)\s*ms\s*\/\s*([0-9]+)\s*tokens/);
  if (pe) {
    out.promptEvalMs = parseFloat(pe[1]);
    out.promptTokens = parseInt(pe[2], 10);
  }
  const ev = text.match(/llama_perf_context_print:\s*eval time\s*=\s*([0-9.]+)\s*ms\s*\/\s*([0-9]+)\s*runs/);
  if (ev) out.genTokens = parseInt(ev[2], 10);
  return out;
}

// "r1 554225.50" per line; last write wins (the harness appends). Non-mark
// lines are counted, not fatal.
export function parseMarks(text) {
  const marks = new Map();
  let skipped = 0;
  for (const l of text.split("\n")) {
    if (!l.trim()) continue;
    const m = l.match(/^r([0-9]+)\s+([0-9]+(?:\.[0-9]+)?)\s*$/);
    if (m) marks.set(parseInt(m[1], 10), parseFloat(m[2]));
    else skipped++;
  }
  return { marks, skipped };
}

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "");
const esc = (x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);

// All phase splitting for one stem. Returns { rows, notes }: rows are
// PHASES_COLUMNS objects (values already formatted strings), notes are
// stem-level stderr messages (rep skips, missing files).
export function splitStem(stem, { csvText, marksText, repTexts, cliPromptTokens, cliGenTokens }) {
  const rows = [];
  const notes = [];
  const { rows: samples } = parseEnergyCsv(csvText);
  if (!samples.length) {
    notes.push(`${stem}: no usable CSV samples — stem skipped`);
    return { rows, notes };
  }
  samples.sort((a, b) => a.t - b.t);
  const firstT = samples[0].t;

  if (marksText === undefined) {
    notes.push(`${stem}: no .marks file — no rep windows, stem skipped`);
    return { rows, notes };
  }
  const parsed = parseMarks(marksText);
  if (parsed.skipped) notes.push(`${stem}: ${parsed.skipped} unparsable .marks line(s)`);
  const marks = parsed.marks;

  const repNums = [...new Set([...marks.keys(), ...repTexts.keys()])].sort((a, b) => a - b);
  for (const n of repNums) {
    const end = marks.get(n);
    const start = n > 1 ? marks.get(n - 1) : firstT;
    const repLabel = `${stem}: r${n}:`;
    if (end === undefined || (n > 1 && start === undefined)) {
      notes.push(`${repLabel} missing mark boundary — rep skipped`);
      continue;
    }
    if (start >= end) {
      notes.push(`${repLabel} non-monotonic marks (${start} >= ${end}) — rep skipped`);
      continue;
    }
    const text = repTexts.get(n);
    if (text === undefined) {
      notes.push(`${repLabel} missing _r${n}.txt — rep skipped`);
      continue;
    }
    const speed = parseSpeedLine(text);
    const perf = parsePerfLines(text);
    if (!speed && perf.promptEvalMs === null) {
      notes.push(`${repLabel} no parsable speed/perf line (failed run?) — rep skipped`);
      continue;
    }

    // Token counts: the run's own perf lines win over the CLI values; the
    // speed line alone is never enough.
    const promptTokens = perf.promptTokens ?? cliPromptTokens ?? null;
    const genTokens = perf.genTokens ?? cliGenTokens ?? null;
    const promptEvalS =
      perf.promptEvalMs !== null
        ? perf.promptEvalMs / 1000
        : promptTokens !== null && speed
          ? promptTokens / speed.promptTps
          : null;

    const warnings = [];
    const win = samples.filter((r) => r.t >= start && r.t < end);
    const row = {
      run_id: stem,
      rep: String(n),
      window_start_s: start.toFixed(2),
      duration: "", prefill_s: "", decode_s: "",
      j_prefill: "", j_decode: "", j_prefill_per_ptok: "", j_per_tok_decode: "",
      prompt_tokens: promptTokens ?? "", gen_tokens: genTokens ?? "",
      mean_w_prefill: "", mean_w_decode: "",
      n_samples_prefill: "", n_samples_decode: "",
      warnings: "",
    };
    if (!win.length) {
      warnings.push("rep window has no samples");
      row.n_samples_prefill = "0";
      row.n_samples_decode = "0";
      row.warnings = warnings.join("; ");
      rows.push(row);
      continue;
    }
    const whole = integrate(win);
    row.duration = fmt(whole.duration_s);

    if (promptEvalS === null) {
      warnings.push(
        `prompt-eval duration not derivable: no token counts in _r${n}.txt and no --prompt-tokens`,
      );
      row.warnings = warnings.join("; ");
      rows.push(row);
      continue;
    }

    // b = index of the first sample at/after the boundary; samples strictly
    // before it are prefill. The decode integration borrows win[b-1] so the
    // straddling interval's energy lands in decode and the two phases sum to
    // the whole-window J.
    const found = win.findIndex((r) => r.t >= start + promptEvalS);
    const b = found === -1 ? win.length : found;
    const ownPre = win.slice(0, b);
    const ownDec = win.slice(b);
    const preInt = integrate(ownPre);
    const decJoules = ownDec.length
      ? integrate(b > 0 ? [win[b - 1], ...ownDec] : ownDec).joules
      : null;

    row.prefill_s = ownPre.length ? fmt(preInt.duration_s) : "";
    row.decode_s = ownDec.length ? fmt(whole.duration_s - preInt.duration_s) : "";
    row.j_prefill = ownPre.length ? fmt(preInt.joules) : "";
    row.j_decode = decJoules !== null ? fmt(decJoules) : "";
    row.mean_w_prefill = ownPre.length ? fmt(preInt.mean_w) : "";
    row.mean_w_decode = ownDec.length ? fmt(integrate(ownDec).mean_w) : "";
    row.n_samples_prefill = String(ownPre.length);
    row.n_samples_decode = String(ownDec.length);
    if (!ownPre.length) warnings.push("prefill segment has no samples");
    if (!ownDec.length) warnings.push("decode segment has no samples");
    if (win.length < 2) warnings.push(`window has ${win.length} sample(s); integration degenerate`);
    if (promptTokens > 0 && ownPre.length) row.j_prefill_per_ptok = fmt(preInt.joules / promptTokens);
    if (genTokens > 0 && decJoules !== null) row.j_per_tok_decode = fmt(decJoules / genTokens);
    row.warnings = warnings.join("; ");
    rows.push(row);
  }
  return { rows, notes };
}

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prompt-tokens" || args[i] === "--gen-tokens") i++; // skip the value
    else positional.push(args[i]);
  }
  const flag = (name) => {
    const i = args.indexOf(name);
    if (i === -1) return undefined;
    const v = Number(args[i + 1]);
    if (!Number.isInteger(v) || v < 1) {
      console.error(`energyPhaseSplit: ${name} needs a positive integer, got ${args[i + 1]}`);
      process.exit(1);
    }
    return v;
  };
  const cliPromptTokens = flag("--prompt-tokens");
  const cliGenTokens = flag("--gen-tokens");
  if (cliPromptTokens !== undefined) {
    console.error(`energyPhaseSplit: using --prompt-tokens ${cliPromptTokens} for every rep (caller-verified count)`);
  }
  if (cliGenTokens !== undefined) {
    console.error(`energyPhaseSplit: using --gen-tokens ${cliGenTokens} for every rep (caller-verified count)`);
  }

  const dir = positional.shift() ?? "device-ngram-spec-out";
  if (!existsSync(dir)) {
    console.error(`no such directory: ${dir}`);
    process.exit(1);
  }
  const stems = positional.length
    ? positional
    : readdirSync(dir).filter((f) => f.endsWith(".csv") && !f.endsWith(".phases.csv")).sort()
        .map((f) => f.replace(/\.csv$/, ""));
  if (!stems.length) {
    console.error(`no *.csv in ${dir}`);
    process.exit(1);
  }

  let wroteAny = false;
  for (const stem of stems) {
    let csvText;
    try {
      csvText = readFileSync(path.join(dir, `${stem}.csv`), "utf8");
    } catch {
      console.error(`energyPhaseSplit: ${stem}: no ${stem}.csv — stem skipped`);
      continue;
    }
    let marksText;
    try {
      marksText = readFileSync(path.join(dir, `${stem}.marks`), "utf8");
    } catch {
      marksText = undefined;
    }
    const repTexts = new Map();
    const repRe = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_r([0-9]+)\\.txt$`);
    for (const f of readdirSync(dir)) {
      const m = f.match(repRe);
      if (m) repTexts.set(parseInt(m[1], 10), readFileSync(path.join(dir, f), "utf8"));
    }

    const { rows, notes } = splitStem(stem, { csvText, marksText, repTexts, cliPromptTokens, cliGenTokens });
    for (const n of notes) console.error(`energyPhaseSplit: ${n}`);
    if (!rows.length) continue;

    const out = path.join(dir, `${stem}.phases.csv`);
    const body = [
      PHASES_COLUMNS.join(","),
      ...rows.map((r) => PHASES_COLUMNS.map((c) => esc(r[c])).join(",")),
    ].join("\n") + "\n";
    writeFileSync(out, body);
    console.error(`energyPhaseSplit: wrote ${out} (${rows.length} rep row${rows.length === 1 ? "" : "s"})`);
    wroteAny = true;

    console.log(`\n## ${stem}\n`);
    console.log("| rep | window_start_s | duration | prefill_s | decode_s | J_prefill | J_decode | J/prefill-tok | J/decode-tok | W_prefill | W_decode | n_prefill | n_decode | warnings |");
    console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
    for (const r of rows) {
      const na = (x) => (x === "" ? "n/a" : x);
      console.log(
        `| ${r.rep} | ${r.window_start_s} | ${na(r.duration)} | ${na(r.prefill_s)} | ${na(r.decode_s)} | ` +
        `${na(r.j_prefill)} | ${na(r.j_decode)} | ${na(r.j_prefill_per_ptok)} | ${na(r.j_per_tok_decode)} | ` +
        `${na(r.mean_w_prefill)} | ${na(r.mean_w_decode)} | ${r.n_samples_prefill} | ${r.n_samples_decode} | ` +
        `${r.warnings || "—"} |`,
      );
    }
  }

  console.log("\nPhase boundary: prefill ends window_start + prompt-eval duration (the run's");
  console.log("prompt-eval perf line, else prompt_tokens / prompt t/s); decode takes the");
  console.log("remainder. Sampler is ~1 Hz: each phase edge carries <= 1 sample (~1 s) of");
  console.log("attribution uncertainty. Still the RELATIVE battery-terminal metric: the");
  console.log("inter-rep sleep and model load inside a rep window follow the boundary");
  console.log("convention, not a separate measurement.");
  if (!wroteAny) {
    console.error("energyPhaseSplit: nothing produced");
    process.exit(1);
  }
}

// Run main only when invoked directly, so the harness can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
