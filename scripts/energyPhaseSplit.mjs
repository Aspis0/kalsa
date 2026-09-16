#!/usr/bin/env node
// Per-rep phase split, schemas kalsa-energy-rep-v2 and kalsa-energy-rep-v3:
// divide each rep's window
// energy into a PRE phase (j_pre) and a DECODE phase (j_decode), anchored the
// only way the data supports. History: v1 (572d3be) placed the boundary at
// window_start + prompt-eval duration, but the run's startup — inter-rep
// sleep, process spawn, model load — sits between the window start and the
// real prompt processing. In the 2026-09 campaign the v1 "prefill" bucket was
// pure idle (0.03-1.1 W) in 8/12 reps and j_decode carried load + prefill +
// decode (audit ENERGY-PHASE-AUDIT-2026-09-15, F1/F2: NO-SHIP). v2 re-anchors:
// decode duration = gen_tokens / gen tps from the rep's own speed line (the
// perf "eval time" ms when present), so decode occupies the LAST decode_s
// seconds of the window ending at mark_N; everything before it is j_pre.
//
// HONEST NAMING: j_pre is model load + inter-rep idle + prompt eval. The
// prompt-eval-only J is NOT resolvable at 1 Hz with the model load inside the
// window — a future in-engine phase timestamp would be needed. prefill_est_s
// (prompt_tokens / prompt tps) is informational only and drives nothing.
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
// rep. Marks hygiene is fatal (never silently absorb samples): out-of-order
// marks, or a mark before the first CSV sample, refuse the whole stem.
//
// Counts provenance (never a guess): --counts-manifest <csv> — the committed
// scripts/fixtures/energy-counts/manifest.csv — is the preferred source. The
// run's own llama_perf lines still win when present; --prompt-tokens/
// --gen-tokens remain a caller-verified fallback and say so on stderr.
// Without any count source the phase columns stay EMPTY with a warning.
//
// Integration is energySchema.integrate on each sub-window (right-Riemann: an
// interval belongs to its right-endpoint sample). EXACT interval set of the
// decode bucket: every interval fully inside [decode_start, mark_N) — the
// right-endpoint samples strictly after the first sample at/after
// decode_start. Consequences, both one-directional (audit R1): the interval
// straddling decode_start starts BEFORE the boundary and is attributed to
// j_pre IN FULL ("decode starts strictly after its start point"), and the
// partial interval between the last window sample and mark_N is charged to
// NO bucket — so j_decode is a LOWER bound on the nominal
// [decode_start, mark_N) span, short by at most two sample intervals, and
// j_per_tok_decode reads LOW on short decode buckets. decode_s_int carries
// the integrated seconds actually attributed to the decode bucket (coverage
// = decode_s_int / decode_s), so the truncation is visible per row. The
// split stays exact: j_pre + j_decode equals the whole-window J exactly
// (harness-tested) and n_pre + n_decode equals the window's sample count.
// w_decode is the mean over the decode segment's OWN samples — which
// INCLUDES the boundary sample whose interval energy sits in j_pre, so
// w_decode is NOT j_decode / decode_s (audit R4; they can diverge by tens of
// percent on short buckets). A LOW-RESOLUTION warning fires per row when
// fewer than 3 intervals are attributed to decode or coverage < 0.7 — the
// honest catch for short-decode stems where the convention dominates the
// per-token figure (audit R2). Edge uncertainty: each phase edge carries up
// to ONE SAMPLE INTERVAL of attribution uncertainty — the sampler is ~1 Hz
// nominal but the observed interval reaches 3.5 s under load, so the
// per-CSV observed median/max interval is reported in cadence_median_s/cadence_max_s
// (with a warning past 2 s) instead of a flat "~1 s" claim.
//
// Guards, exit 1: decode duration >= window duration; gen_tokens <= 0 with a
// count source present; out-of-order marks; a mark before the first CSV
// sample. Warnings (not failures): decode bucket low-resolution (< 3
// attributed intervals or decode_s_int < 0.7 * decode_s); implied decode
// power (j_decode / decode_s) outside the 0.1-20 W sanity band; cadence max
// > 2 s.
//
// Output: <dir>/<stem>.phases.csv (one row per rep) plus a markdown table on
// stdout. NOTE for consumers: the file lands in the campaign dir and does NOT
// match the sampler schema — energyAggregate.mjs skips *.phases.csv when it
// globs the dir's *.csv, so splitting before aggregating is safe.
//
// Usage: node scripts/energyPhaseSplit.mjs [dir=device-ngram-spec-out] [stem ...]
//        [--counts-manifest file] [--prompt-tokens N] [--gen-tokens N]
// Exit 0 with per-rep warnings on stderr; exit 1 if nothing was produced or
// any stem hit a fatal input error.

import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnergyCsv, integrate } from "./energySchema.mjs";

export const PHASES_COLUMNS = [
  "run_id", "rep", "window_start_s", "window_end_s", "duration", "decode_s",
  "decode_s_int",
  "prefill_est_s", "j_pre", "j_decode", "j_per_tok_decode",
  "prompt_tokens", "gen_tokens", "w_decode",
  "n_pre", "n_decode", "cadence_median_s", "cadence_max_s", "warnings",
];

export const PHASES_SCHEMA_V2 = "kalsa-energy-rep-v2";
export const PHASES_SCHEMA_V3 = "kalsa-energy-rep-v3";

export const PHASES_V3_COLUMNS = [
  "run_id", "rep", "window_start_s", "window_end_s", "duration",
  "load_idle_s", "prefill_s", "decode_s", "load_idle_s_int", "prefill_s_int", "decode_s_int",
  "j_load_idle", "j_prefill", "j_decode", "j_per_tok_decode",
  "prompt_tokens", "gen_tokens", "w_decode",
  "n_load_idle", "n_prefill", "n_decode", "cadence_median_s", "cadence_max_s", "warnings",
];

// scripts/fixtures/energy-counts/manifest.csv (tracked): one row per stem.
// count_run_gen_tps and count_run_output are provenance only — the tool never
// reads them; campaign_gen_tps_rN is cross-checked against each rep's speed
// line (warning on mismatch: wrong manifest/campaign pairing).
export const COUNTS_MANIFEST_COLUMNS = [
  "stem", "prompt_tokens", "gen_tokens", "count_run_gen_tps",
  "campaign_gen_tps_r1", "campaign_gen_tps_r2", "campaign_gen_tps_r3",
  "count_run_output",
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
// it). Each field is used only when its line exists. The direct ms values are
// preferred over counts/tps: the speed line's t/s is rounded, the ms values
// are the run's own measurements.
export function parsePerfLines(text) {
  const out = { promptEvalMs: null, evalMs: null, promptTokens: null, genTokens: null };
  // Anchored on the llama_perf prefix so "prompt eval time" can never be
  // matched by the plain eval-time pattern (\s* then "eval" vs "prompt ...").
  const pe = text.match(/llama_perf_context_print:\s*prompt eval time\s*=\s*([0-9.]+)\s*ms\s*\/\s*([0-9]+)\s*tokens/);
  if (pe) {
    out.promptEvalMs = parseFloat(pe[1]);
    out.promptTokens = parseInt(pe[2], 10);
  }
  const ev = text.match(/llama_perf_context_print:\s*eval time\s*=\s*([0-9.]+)\s*ms\s*\/\s*([0-9]+)\s*runs/);
  if (ev) {
    out.evalMs = parseFloat(ev[1]);
    out.genTokens = parseInt(ev[2], 10);
  }
  return out;
}

// One line written by the CLI after the final chunk carrying finish_reason.
// Durations are intentionally text-compatible with the CLI's three-decimal
// format; no clock or timestamp is accepted here.
export function parsePhaseStamp(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const matches = lines.filter((line) => {
    return /^phase prompt_n=-?\d+ prompt_ms=\d+\.\d{3} predicted_n=-?\d+ predicted_ms=\d+\.\d{3}$/.test(line);
  });
  if (!matches.length) {
    return { stamp: null, lineCount: lines.length, error: "no valid phase stamp line" };
  }
  const m = matches[matches.length - 1].match(
    /^phase prompt_n=(-?\d+) prompt_ms=(\d+\.\d{3}) predicted_n=(-?\d+) predicted_ms=(\d+\.\d{3})$/,
  );
  return {
    stamp: {
      promptN: parseInt(m[1], 10),
      promptMs: parseFloat(m[2]),
      predictedN: parseInt(m[3], 10),
      predictedMs: parseFloat(m[4]),
    },
    lineCount: lines.length,
    validLineCount: matches.length,
    error: matches.length > 1 ? "multiple phase stamp lines; using the last line" : null,
  };
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

// Counts manifest parser. Rows that cannot parse are returned in errors so
// main() can refuse the whole run (an incoherent manifest is caller error,
// not a per-stem skip); a well-formed gen_tokens=0 row is kept so the
// stem-level guard can name it.
export function parseCountsManifest(text) {
  const byStem = new Map();
  const errors = [];
  const lines = text.split("\n").filter((l) => l.trim());
  if (!lines.length) {
    errors.push("counts manifest is empty");
    return { byStem, errors };
  }
  if (lines[0].trim() !== COUNTS_MANIFEST_COLUMNS.join(",")) {
    errors.push(`counts manifest header mismatch: expected ${COUNTS_MANIFEST_COLUMNS.join(",")}`);
    return { byStem, errors };
  }
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    if (cols.length !== COUNTS_MANIFEST_COLUMNS.length) {
      errors.push(`counts manifest line ${i + 1}: expected ${COUNTS_MANIFEST_COLUMNS.length} fields, got ${cols.length}`);
      continue;
    }
    const [stem, pTok, gTok, countRunGenTps, r1, r2, r3, countRunOutput] = cols.map((c) => c.trim());
    if (!stem) {
      errors.push(`counts manifest line ${i + 1}: empty stem`);
      continue;
    }
    if (!/^\d+$/.test(pTok) || !/^\d+$/.test(gTok)) {
      errors.push(`counts manifest line ${i + 1} (${stem}): prompt_tokens/gen_tokens must be non-negative integers`);
      continue;
    }
    byStem.set(stem, {
      promptTokens: parseInt(pTok, 10),
      genTokens: parseInt(gTok, 10),
      countRunGenTps,
      campaignGenTps: [r1, r2, r3],
      countRunOutput,
    });
  }
  return { byStem, errors };
}

// Median/max inter-sample interval over the stem's WHOLE CSV — the honest
// per-stem sampler cadence (audit F5: the nominal ~1 Hz reaches 3.5 s under
// load, so "edge uncertainty <= 1 s" was false).
export function sampleCadence(samples) {
  const dts = [];
  for (let i = 1; i < samples.length; i++) dts.push(samples[i].t - samples[i - 1].t);
  if (!dts.length) return { median: NaN, max: NaN };
  const sorted = [...dts].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return { median, max: sorted[sorted.length - 1] };
}

const fmt = (x, d = 3) => (Number.isFinite(x) ? x.toFixed(d) : "");
const esc = (x) => (/[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x);
const MAX_STAMP_TOKENS = 1_000_000_000;

const roundJ = (x) => Math.round((x + Number.EPSILON) * 1000) / 1000;
const LOWRES_TAIL =
  "; j_per_tok_decode is sampling-granularity dominated — between-arm deltas of the same stem remain the sanctioned use";

function lowResolutionWarning(label, intervals, integratedS, nominalS) {
  if (!(nominalS > 0) || !(intervals < 3 || integratedS < 0.7 * nominalS)) {
    return null;
  }
  return `${label} bucket low-resolution: ${intervals} interval(s) attributed to ${label} ` +
    `(coverage ${integratedS.toFixed(2)}/${nominalS.toFixed(2)} s = ${Math.round((100 * integratedS) / nominalS)}%)${LOWRES_TAIL}`;
}

function splitStampedRep({
  stem,
  n,
  start,
  end,
  win,
  stamp,
  stampError,
  speed,
  perf,
  manifestEntry,
  cliPromptTokens,
  cliGenTokens,
  cad,
  cadenceWarn,
}) {
  const warnings = [];
  const repLabel = `${stem}: r${n}:`;
  const promptTokens = stamp?.promptN ?? perf.promptTokens ?? manifestEntry?.promptTokens ?? cliPromptTokens ?? null;
  const genTokens = stamp?.predictedN ?? perf.genTokens ?? manifestEntry?.genTokens ?? cliGenTokens ?? null;
  const row = {
    run_id: stem,
    rep: String(n),
    window_start_s: start.toFixed(2),
    window_end_s: end.toFixed(2),
    duration: "",
    load_idle_s: "",
    prefill_s: "",
    decode_s: "",
    load_idle_s_int: "",
    prefill_s_int: "",
    decode_s_int: "",
    j_load_idle: "",
    j_prefill: "",
    j_decode: "",
    j_per_tok_decode: "",
    prompt_tokens: promptTokens ?? "",
    gen_tokens: genTokens ?? "",
    w_decode: "",
    n_load_idle: "",
    n_prefill: "",
    n_decode: "",
    cadence_median_s: Number.isFinite(cad.median) ? cad.median.toFixed(3) : "",
    cadence_max_s: Number.isFinite(cad.max) ? cad.max.toFixed(3) : "",
    warnings: "",
  };
  if (cadenceWarn) warnings.push(cadenceWarn);

  if (stamp) {
    for (const [name, value] of [["prompt_n", stamp.promptN], ["predicted_n", stamp.predictedN]]) {
      if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_STAMP_TOKENS) {
        return {
          row,
          fatal: `${repLabel} phase stamp ${name} = ${value} is outside the sane range 1..${MAX_STAMP_TOKENS} - incoherent input`,
        };
      }
    }
    const countSources = [
      ["prompt_n", stamp.promptN, "perf prompt_tokens", perf.promptTokens],
      ["prompt_n", stamp.promptN, "manifest prompt_tokens", manifestEntry?.promptTokens],
      ["prompt_n", stamp.promptN, "--prompt-tokens", cliPromptTokens],
      ["predicted_n", stamp.predictedN, "perf gen_tokens", perf.genTokens],
      ["predicted_n", stamp.predictedN, "manifest gen_tokens", manifestEntry?.genTokens],
      ["predicted_n", stamp.predictedN, "--gen-tokens", cliGenTokens],
    ];
    for (const [stampName, stampValue, sourceName, sourceValue] of countSources) {
      if (sourceValue !== undefined && sourceValue !== null && stampValue !== sourceValue) {
        warnings.push(`phase stamp ${stampName} (${stampValue}) differs from ${sourceName} (${sourceValue})`);
      }
    }
  }

  if (manifestEntry && speed) {
    const claimed = parseFloat(manifestEntry.campaignGenTps[n - 1]);
    if (Number.isFinite(claimed) && Math.abs(claimed - speed.genTps) > 0.05) {
      warnings.push(
        `manifest campaign_gen_tps_r${n} (${claimed}) differs from this run's speed line (${speed.genTps}) - wrong manifest/campaign pairing?`,
      );
    }
  }

  if (!win.length) {
    warnings.push("rep window has no samples");
    row.n_load_idle = "0";
    row.n_prefill = "0";
    row.n_decode = "0";
    row.warnings = warnings.join("; ");
    return { row, fatal: null };
  }

  const whole = integrate(win);
  row.duration = fmt(whole.duration_s);

  const decodeDur = stamp
    ? stamp.predictedMs / 1000
    : perf.evalMs !== null
      ? perf.evalMs / 1000
      : genTokens !== null && speed
        ? genTokens / speed.genTps
        : null;
  if (decodeDur === null) {
    warnings.push(
      stampError
        ? `phase stamps ${stampError}; fell back to kalsa-energy-rep-v2 arithmetic`
        : "phase stamps absent; fell back to kalsa-energy-rep-v2 arithmetic",
    );
    warnings.push(
      "decode duration not derivable (needs gen token counts from counts manifest / --gen-tokens / perf line, and a speed line)",
    );
    row.warnings = warnings.join("; ");
    return { row, fatal: null };
  }
  if (genTokens !== null && genTokens <= 0) {
    return {
      row,
      fatal: `${repLabel} gen_tokens = ${genTokens} <= 0 with a count source present - incoherent input`,
    };
  }

  if (!stamp) {
    warnings.push(
      stampError
        ? `phase stamps ${stampError}; fell back to kalsa-energy-rep-v2 arithmetic`
        : "phase stamps absent; fell back to kalsa-energy-rep-v2 arithmetic",
    );
    warnings.push("prefill bucket unavailable; j_load_idle includes the v2 PRE phase (model load + idle + prompt eval)");
    if (whole.duration_s > 0 && decodeDur >= whole.duration_s) {
      return {
        row,
        fatal: `${repLabel} decode duration (${decodeDur.toFixed(3)} s) >= window duration (${whole.duration_s.toFixed(3)} s) - counts/speed line incoherent with the window`,
      };
    }
    const B = end - decodeDur;
    const found = win.findIndex((r) => r.t >= B);
    const b = found === -1 ? win.length : found;
    const preInt = integrate(win.slice(0, Math.min(b + 1, win.length)));
    const decSeg = win.slice(b);
    const decInt = decSeg.length ? integrate(decSeg) : null;
    const decJoules = decInt ? whole.joules - preInt.joules : 0;
    row.decode_s = fmt(decodeDur);
    row.load_idle_s_int = fmt(preInt.duration_s);
    row.decode_s_int = fmt(decInt ? decInt.duration_s : 0);
    row.j_load_idle = fmt(roundJ(preInt.joules));
    row.j_prefill = "0.000";
    row.j_decode = fmt(roundJ(whole.joules - preInt.joules));
    row.j_per_tok_decode = genTokens > 0 ? fmt(decJoules / genTokens) : "";
    row.w_decode = decInt && Number.isFinite(decInt.mean_w) ? fmt(decInt.mean_w) : "";
    row.n_load_idle = String(b);
    row.n_prefill = "0";
    row.n_decode = String(win.length - b);
    if (b === 0) warnings.push("decode_start at/before the first window sample - pre phase has no interval");
    if (decInt === null) warnings.push("decode segment has no samples (decode_s shorter than the tail gap to the mark)");
    const decIntervals = decSeg.length - 1;
    const decodeSInt = decInt ? decInt.duration_s : 0;
    if (decInt !== null && (decIntervals < 3 || decodeSInt < 0.7 * decodeDur)) {
      warnings.push(
        `decode bucket low-resolution: ${decIntervals} interval(s) attributed to decode ` +
          `(coverage ${decodeSInt.toFixed(2)}/${decodeDur.toFixed(2)} s = ${Math.round((100 * decodeSInt) / decodeDur)}%)` +
          LOWRES_TAIL,
      );
    }
    if (win.length < 2) warnings.push(`window has ${win.length} sample(s); integration degenerate`);
    if (decJoules !== null) {
      const impliedW = decJoules / decodeDur;
      if (Number.isFinite(impliedW) && (impliedW < 0.1 || impliedW > 20)) {
        warnings.push(`implied decode power ${impliedW.toFixed(2)} W (j_decode / decode_s) outside the 0.1-20 W sanity band - counts wrong?`);
      }
    }
    row.warnings = warnings.join("; ");
    return { row, fatal: null };
  }

  const prefillDur = stamp.promptMs / 1000;
  const windowSpan = end - start;
  if (prefillDur + decodeDur > windowSpan) {
    return {
      row,
      fatal: `${repLabel} stamped phase duration (${(prefillDur + decodeDur).toFixed(3)} s) exceeds window span (${windowSpan.toFixed(3)} s) - timings incoherent with the window`,
    };
  }
  const loadIdleDur = windowSpan - prefillDur - decodeDur;
  const decodeStart = end - decodeDur;
  const prefillStart = decodeStart - prefillDur;
  const prefillFound = win.findIndex((r) => r.t >= prefillStart);
  const decodeFound = win.findIndex((r) => r.t >= decodeStart);
  const p = prefillFound === -1 ? win.length : prefillFound;
  const d = decodeFound === -1 ? win.length : decodeFound;
  const loadInt = integrate(win.slice(0, Math.min(p + 1, win.length)));
  const prefillSeg = win.slice(p, Math.min(d + 1, win.length));
  const decodeSeg = win.slice(d);
  const prefillInt = p < d ? integrate(prefillSeg) : null;
  const decodeInt = d < win.length - 1 ? integrate(decodeSeg) : null;
  const jLoad = loadInt.joules;
  const jPrefill = prefillInt ? prefillInt.joules : 0;
  const jDecode = whole.joules - jLoad - jPrefill;
  const loadText = roundJ(jLoad);
  const prefillText = roundJ(jPrefill);
  const wholeText = roundJ(whole.joules);
  const decodeText = decodeInt ? roundJ(wholeText - loadText - prefillText) : null;

  row.load_idle_s = fmt(loadIdleDur);
  row.prefill_s = fmt(prefillDur);
  row.decode_s = fmt(decodeDur);
  row.load_idle_s_int = fmt(loadInt.duration_s);
  row.prefill_s_int = fmt(prefillInt ? prefillInt.duration_s : 0);
  row.decode_s_int = decodeInt ? fmt(decodeInt.duration_s) : "";
  row.j_load_idle = fmt(loadText);
  row.j_prefill = fmt(prefillText);
  row.j_decode = decodeInt ? fmt(decodeText) : "";
  row.j_per_tok_decode = decodeInt && genTokens > 0 ? fmt(jDecode / genTokens) : "";
  row.w_decode = decodeInt && Number.isFinite(decodeInt.mean_w) ? fmt(decodeInt.mean_w) : "";
  row.n_load_idle = String(p);
  row.n_prefill = String(Math.max(0, d - p));
  row.n_decode = String(win.length - d);

  const loadIntervals = Math.max(0, Math.min(p, win.length - 1));
  const prefillIntervals = prefillInt ? prefillSeg.length - 1 : 0;
  const decodeIntervals = decodeInt ? decodeSeg.length - 1 : 0;
  const loadLow = lowResolutionWarning("load+idle", loadIntervals, loadInt.duration_s, loadIdleDur);
  const prefillLow = lowResolutionWarning("prefill", prefillIntervals, prefillInt ? prefillInt.duration_s : 0, prefillDur);
  const decodeLow = lowResolutionWarning("decode", decodeIntervals, decodeInt ? decodeInt.duration_s : 0, decodeDur);
  if (loadLow) warnings.push(loadLow);
  if (prefillLow) warnings.push(prefillLow);
  if (decodeLow) warnings.push(decodeLow);
  if (!decodeInt) warnings.push("decode bucket has no intervals (decode_s is shorter than the tail gap to the mark)");
  if (win.length < 2) warnings.push(`window has ${win.length} sample(s); integration degenerate`);
  const impliedW = jDecode / decodeDur;
  if (Number.isFinite(impliedW) && (impliedW < 0.1 || impliedW > 20)) {
    warnings.push(`implied decode power ${impliedW.toFixed(2)} W (j_decode / decode_s) outside the 0.1-20 W sanity band - stamped timing or energy window needs review`);
  }
  if (stampError) warnings.push(`phase stamps: ${stampError}`);
  row.warnings = warnings.join("; ");
  return { row, fatal: null };
}

// All phase splitting for one stem. Returns { rows, notes, fatal }: rows are
// PHASES_COLUMNS or PHASES_V3_COLUMNS objects (values already formatted strings), notes are
// stem-level stderr messages (rep skips, missing files), and fatal is a
// stem-refusing input error (marks hygiene, incoherent counts) — a stem with
// a fatal produces NO file and fails the run.
export function splitStem(
  stem,
  {
    csvText,
    marksText,
    repTexts,
    manifestEntry,
    cliPromptTokens,
    cliGenTokens,
    phaseStampTexts = new Map(),
  },
) {
  const rows = [];
  const notes = [];
  let fatal = null;
  const useV3 = phaseStampTexts.size > 0;
  const setFatal = (msg) => {
    if (fatal === null) fatal = msg;
  };

  const { rows: samples } = parseEnergyCsv(csvText);
  if (!samples.length) {
    notes.push(`${stem}: no usable CSV samples — stem skipped`);
    return { rows, notes, fatal };
  }
  samples.sort((a, b) => a.t - b.t);
  const firstT = samples[0].t;
  const cad = sampleCadence(samples);
  const cadenceWarn =
    Number.isFinite(cad.max) && cad.max > 2
      ? `sampler cadence max ${cad.max.toFixed(3)} s exceeds 2 s (edge uncertainty up to one interval)`
      : null;

  if (marksText === undefined) {
    notes.push(`${stem}: no .marks file — no rep windows, stem skipped`);
    return { rows, notes, fatal };
  }
  const parsed = parseMarks(marksText);
  if (parsed.skipped) notes.push(`${stem}: ${parsed.skipped} unparsable .marks line(s)`);
  const marks = parsed.marks;

  // Marks hygiene (audit F7): a marks file that cannot be trusted must
  // refuse the stem, never silently absorb samples into the wrong window.
  for (const [n, t] of [...marks.entries()].sort((a, b) => a[0] - b[0])) {
    if (t < firstT) setFatal(`mark r${n} (${t}) precedes the first CSV sample (${firstT}) — refusing the stem`);
  }
  const markNums = [...marks.keys()].sort((a, b) => a - b);
  for (let i = 1; i < markNums.length; i++) {
    const prev = marks.get(markNums[i - 1]);
    const cur = marks.get(markNums[i]);
    if (cur <= prev) {
      setFatal(`marks out of order: r${markNums[i]} (${cur}) <= r${markNums[i - 1]} (${prev}) — refusing the stem`);
    }
  }
  if (fatal !== null) return { rows, notes, fatal };

  // Guard (audit F4): a count source with gen_tokens <= 0 is incoherent.
  // The CLI flags cannot produce this (validated >= 1); the manifest and the
  // perf lines can.
  if (!useV3 && manifestEntry && manifestEntry.genTokens <= 0) {
    setFatal(`counts manifest gen_tokens = ${manifestEntry.genTokens} <= 0 with a count source present — incoherent input`);
    return { rows, notes, fatal };
  }

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
      // Out-of-order was already fatal above; only an exact tie can reach
      // this (e.g. mark_1 == first CSV sample): an empty window, not data.
      notes.push(`${repLabel} empty rep window (start ${start} >= end ${end}) — rep skipped`);
      continue;
    }
    const text = repTexts.get(n);
    if (text === undefined) {
      notes.push(`${repLabel} missing _r${n}.txt — rep skipped`);
      continue;
    }
    const stampText = phaseStampTexts.get(n);
    const stampResult = stampText === undefined ? null : parsePhaseStamp(stampText);
    const stamp = stampResult?.stamp ?? null;
    const stampError = stampResult?.error ?? null;
    const speed = parseSpeedLine(text);
    const perf = parsePerfLines(text);
    if (!speed && perf.evalMs === null && !stamp) {
      notes.push(`${repLabel} no parsable speed/perf line (failed run?) — rep skipped`);
      continue;
    }

    const win = samples.filter((r) => r.t >= start && r.t < end);
    if (useV3) {
      const split = splitStampedRep({
        stem,
        n,
        start,
        end,
        win,
        stamp,
        stampError,
        speed,
        perf,
        manifestEntry,
        cliPromptTokens,
        cliGenTokens,
        cad,
        cadenceWarn,
      });
      if (split.fatal !== null) {
        setFatal(split.fatal);
        break;
      }
      rows.push(split.row);
      continue;
    }

    // Token counts per rep: the run's own perf lines win over the manifest;
    // the manifest (preferred) wins over the CLI flags. Resolved per field.
    const promptTokens = perf.promptTokens ?? manifestEntry?.promptTokens ?? cliPromptTokens ?? null;
    const genTokens = perf.genTokens ?? manifestEntry?.genTokens ?? cliGenTokens ?? null;
    if (genTokens !== null && genTokens <= 0) {
      setFatal(`${repLabel} gen_tokens = ${genTokens} <= 0 with a count source present — incoherent input`);
      break;
    }

    // Decode duration: the perf eval-time ms when present (the run's own
    // measurement, not rounded), else gen_tokens / gen tps.
    const decodeDur =
      perf.evalMs !== null
        ? perf.evalMs / 1000
        : genTokens !== null && speed
          ? genTokens / speed.genTps
          : null;

    const warnings = [];
    if (cadenceWarn) warnings.push(cadenceWarn);
    // Manifest/campaign pairing check: each rep's own speed line must agree
    // with the manifest's recorded campaign t/s (both printed to 0.1 t/s).
    if (manifestEntry && speed) {
      const claimed = parseFloat(manifestEntry.campaignGenTps[n - 1]);
      if (Number.isFinite(claimed) && Math.abs(claimed - speed.genTps) > 0.05) {
        warnings.push(
          `manifest campaign_gen_tps_r${n} (${claimed}) differs from this run's speed line (${speed.genTps}) — wrong manifest/campaign pairing?`,
        );
      }
    }
    const row = {
      run_id: stem,
      rep: String(n),
      window_start_s: start.toFixed(2),
      window_end_s: end.toFixed(2),
      duration: "", decode_s: "", decode_s_int: "", prefill_est_s: "",
      j_pre: "", j_decode: "", j_per_tok_decode: "",
      prompt_tokens: promptTokens ?? "", gen_tokens: genTokens ?? "",
      w_decode: "",
      n_pre: "", n_decode: "",
      cadence_median_s: Number.isFinite(cad.median) ? cad.median.toFixed(3) : "",
      cadence_max_s: Number.isFinite(cad.max) ? cad.max.toFixed(3) : "",
      warnings: "",
    };
    if (!win.length) {
      warnings.push("rep window has no samples");
      row.n_pre = "0";
      row.n_decode = "0";
      row.warnings = warnings.join("; ");
      rows.push(row);
      continue;
    }
    const whole = integrate(win);
    row.duration = fmt(whole.duration_s);

    if (decodeDur === null) {
      warnings.push(
        "decode duration not derivable (needs gen token counts from counts manifest / --gen-tokens / perf line, and a speed line)",
      );
      row.warnings = warnings.join("; ");
      rows.push(row);
      continue;
    }

    // Guard (audit F4): the anchored decode cannot fill (or exceed) the
    // whole window — that means counts/speed line vs window are incoherent.
    // A degenerate 0-duration window (single sample) carries no evidence
    // either way, so it keeps the warning-row path instead.
    if (whole.duration_s > 0 && decodeDur >= whole.duration_s) {
      setFatal(
        `${repLabel} decode duration (${decodeDur.toFixed(3)} s) >= window duration (${whole.duration_s.toFixed(3)} s) — counts/speed line incoherent with the window`,
      );
      break;
    }

    // b = index of the first sample at/after decode_start (B). Samples
    // strictly before B are the pre side; the interval straddling B —
    // [win[b-1].t, win[b].t) — starts before B, so it belongs to j_pre and
    // preInt integrates through win[b]. j_decode is the exact remainder
    // (whole - preJ), keeping the partition invariant bit-exact.
    const B = end - decodeDur;
    const found = win.findIndex((r) => r.t >= B);
    const b = found === -1 ? win.length : found;
    const preInt = integrate(win.slice(0, Math.min(b + 1, win.length)));
    const decSeg = win.slice(b);
    const decInt = decSeg.length ? integrate(decSeg) : null;
    const decJoules = decInt ? whole.joules - preInt.joules : null;

    row.decode_s = fmt(decodeDur);
    row.decode_s_int = decInt ? fmt(decInt.duration_s) : "";
    const promptEvalS =
      perf.promptEvalMs !== null
        ? perf.promptEvalMs / 1000
        : promptTokens !== null && speed
          ? promptTokens / speed.promptTps
          : null;
    row.prefill_est_s = promptEvalS !== null ? fmt(promptEvalS) : "";
    row.j_pre = fmt(preInt.joules);
    row.j_decode = decJoules !== null ? fmt(decJoules) : "";
    row.w_decode = decInt && Number.isFinite(decInt.mean_w) ? fmt(decInt.mean_w) : "";
    if (genTokens > 0 && decJoules !== null) row.j_per_tok_decode = fmt(decJoules / genTokens);
    row.n_pre = String(b);
    row.n_decode = String(win.length - b);

    if (b === 0) warnings.push("decode_start at/before the first window sample — pre phase has no interval");
    if (decInt === null) warnings.push("decode segment has no samples (decode_s shorter than the tail gap to the mark)");
    // Low-resolution decode bucket (audit R1/R2): with fewer than three
    // attributed intervals, or integrated coverage under 70% of the nominal
    // decode duration, a single convention truncation moves a double-digit
    // share of the bucket (1.2B/PURE: 2 intervals for a 3.3 s decode ->
    // published j_per_tok_decode 37-41% below the nominal window with no
    // other warning — cadence 1.06 s stays under the 2 s cadence rule).
    const decIntervals = decSeg.length - 1;
    const decodeSInt = decInt ? decInt.duration_s : 0;
    if (decInt !== null && (decIntervals < 3 || decodeSInt < 0.7 * decodeDur)) {
      warnings.push(
        `decode bucket low-resolution: ${decIntervals} interval(s) attributed to decode ` +
          `(coverage ${decodeSInt.toFixed(2)}/${decodeDur.toFixed(2)} s = ${Math.round((100 * decodeSInt) / decodeDur)}%); ` +
          "j_per_tok_decode is sampling-granularity dominated — between-arm deltas of the same stem remain the sanctioned use",
      );
    }
    if (win.length < 2) warnings.push(`window has ${win.length} sample(s); integration degenerate`);
    if (decJoules !== null) {
      const impliedW = decJoules / decodeDur;
      if (Number.isFinite(impliedW) && (impliedW < 0.1 || impliedW > 20)) {
        const w = `implied decode power ${impliedW.toFixed(2)} W (j_decode / decode_s) outside the 0.1-20 W sanity band — counts wrong?`;
        warnings.push(w);
        notes.push(`${repLabel} ${w}`);
      }
    }
    row.warnings = warnings.join("; ");
    rows.push(row);
  }
  return { rows, notes, fatal };
}

function main() {
  const args = process.argv.slice(2);
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--prompt-tokens" || args[i] === "--gen-tokens" || args[i] === "--counts-manifest") i++; // skip the value
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

  let manifestByStem = new Map();
  let hasManifest = false;
  const mi = args.indexOf("--counts-manifest");
  if (mi !== -1) {
    const manifestPath = args[mi + 1];
    if (!manifestPath) {
      console.error("energyPhaseSplit: --counts-manifest needs a file path");
      process.exit(1);
    }
    let text;
    try {
      text = readFileSync(manifestPath, "utf8");
    } catch {
      console.error(`energyPhaseSplit: cannot read counts manifest: ${manifestPath}`);
      process.exit(1);
    }
    const { byStem, errors } = parseCountsManifest(text);
    for (const e of errors) console.error(`energyPhaseSplit: ${e}`);
    if (errors.length) {
      console.error("energyPhaseSplit: counts manifest is invalid — refusing to split");
      process.exit(1);
    }
    console.error(`energyPhaseSplit: counts from manifest ${manifestPath} (preferred count source)`);
    if (cliPromptTokens !== undefined || cliGenTokens !== undefined) {
      console.error("energyPhaseSplit: ignoring --prompt-tokens/--gen-tokens where the manifest has the stem (manifest takes precedence)");
    }
    manifestByStem = byStem;
    hasManifest = true;
  } else if (cliPromptTokens !== undefined || cliGenTokens !== undefined) {
    console.error(
      "energyPhaseSplit: WARNING: --counts-manifest is the preferred count source; --prompt-tokens/--gen-tokens apply to every stem (caller-verified counts)",
    );
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
  let anyFatal = false;
  let wroteV2 = false;
  let wroteV3 = false;
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
    const phaseStampTexts = new Map();
    const stampRe = new RegExp(`^${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}_r([0-9]+)\\.stamps$`);
    for (const f of readdirSync(dir)) {
      const m = f.match(repRe);
      if (m) repTexts.set(parseInt(m[1], 10), readFileSync(path.join(dir, f), "utf8"));
      const s = f.match(stampRe);
      if (s) phaseStampTexts.set(parseInt(s[1], 10), readFileSync(path.join(dir, f), "utf8"));
    }

    const manifestEntry = manifestByStem.get(stem);
    if (hasManifest && !manifestEntry && (cliPromptTokens !== undefined || cliGenTokens !== undefined)) {
      console.error(`energyPhaseSplit: ${stem}: no manifest entry — falling back to --prompt-tokens/--gen-tokens`);
    }
    const { rows, notes, fatal } = splitStem(stem, {
      csvText,
      marksText,
      repTexts,
      manifestEntry,
      cliPromptTokens,
      cliGenTokens,
      phaseStampTexts,
    });
    for (const n of notes) console.error(`energyPhaseSplit: ${n}`);
    if (phaseStampTexts.size === 0) {
      for (const r of rows) {
        console.error(`energyPhaseSplit: ${stem}: r${r.rep}: phase stamps absent; falling back to kalsa-energy-rep-v2 arithmetic`);
      }
    }
    if (fatal !== null) {
      console.error(`energyPhaseSplit: FATAL ${stem}: ${fatal}`);
      anyFatal = true;
      continue;
    }
    if (!rows.length) continue;

    const columns = phaseStampTexts.size ? PHASES_V3_COLUMNS : PHASES_COLUMNS;
    const schema = phaseStampTexts.size ? PHASES_SCHEMA_V3 : PHASES_SCHEMA_V2;
    const out = path.join(dir, `${stem}.phases.csv`);
    const body = [
      columns.join(","),
      ...rows.map((r) => columns.map((c) => esc(r[c])).join(",")),
    ].join("\n") + "\n";
    writeFileSync(out, body);
    console.error(`energyPhaseSplit: wrote ${out} (${rows.length} rep row${rows.length === 1 ? "" : "s"})`);
    wroteAny = true;
    if (schema === PHASES_SCHEMA_V3) wroteV3 = true;
    else wroteV2 = true;

    console.log(`\n## ${stem}\n`);
    if (schema === PHASES_SCHEMA_V3) {
      console.log("| rep | window_start_s | window_end_s | duration | load_idle_s | prefill_s | decode_s | load_idle_s_int | prefill_s_int | decode_s_int | J_load_idle | J_prefill | J_decode | J/decode-tok | W_decode | n_load_idle | n_prefill | n_decode | cadence med/max | warnings |");
      console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
      for (const r of rows) {
        const na = (x) => (x === "" ? "n/a" : x);
        console.log(
          `| ${r.rep} | ${r.window_start_s} | ${r.window_end_s} | ${na(r.duration)} | ${na(r.load_idle_s)} | ${na(r.prefill_s)} | ${na(r.decode_s)} | ${na(r.load_idle_s_int)} | ${na(r.prefill_s_int)} | ${na(r.decode_s_int)} | ` +
          `${na(r.j_load_idle)} | ${na(r.j_prefill)} | ${na(r.j_decode)} | ${na(r.j_per_tok_decode)} | ${na(r.w_decode)} | ${r.n_load_idle} | ${r.n_prefill} | ${r.n_decode} | ${r.cadence_median_s}/${r.cadence_max_s} | ${r.warnings || "-"} |`,
        );
      }
    } else {
      console.log("| rep | window_start_s | window_end_s | duration | decode_s | decode_s_int | prefill_est_s | J_pre | J_decode | J/decode-tok | W_decode | n_pre | n_decode | cadence med/max | warnings |");
      console.log("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
      for (const r of rows) {
        const na = (x) => (x === "" ? "n/a" : x);
        console.log(
          `| ${r.rep} | ${r.window_start_s} | ${r.window_end_s} | ${na(r.duration)} | ${na(r.decode_s)} | ${na(r.decode_s_int)} | ${na(r.prefill_est_s)} | ` +
          `${na(r.j_pre)} | ${na(r.j_decode)} | ${na(r.j_per_tok_decode)} | ${na(r.w_decode)} | ` +
          `${r.n_pre} | ${r.n_decode} | ${r.cadence_median_s}/${r.cadence_max_s} | ${r.warnings || "—"} |`,
        );
      }
    }
  }

  if (wroteV2) {
    console.log("\nPhase boundary (kalsa-energy-rep-v2): decode = the LAST decode_s seconds of");
    console.log("the window ending at mark_N, decode_s = gen_tokens / gen tps from the run's");
    console.log("own speed line (perf eval-time ms when present). j_pre is everything before");
    console.log("it: model load + inter-rep idle + prompt eval — the prompt-eval-only J is");
    console.log("NOT resolvable at 1 Hz with the load in-window. The interval straddling");
    console.log("decode_start belongs to j_pre (decode starts strictly after its start");
    console.log("point) and the last partial interval before mark_N to no bucket, so");
    console.log("j_pre + j_decode equals the whole-window J exactly, but j_decode — and");
    console.log("j_per_tok_decode with it — is biased LOW on short buckets (at most two");
    console.log("sample intervals): decode_s_int shows the integrated seconds actually in");
    console.log("the decode bucket (coverage = decode_s_int/decode_s), and a LOW-RESOLUTION");
    console.log("warning fires below 3 attributed intervals or coverage < 0.7. w_decode");
    console.log("includes the boundary sample (its interval energy is in j_pre), so it is");
    console.log("NOT j_decode / decode_s. Still the RELATIVE battery-terminal metric:");
    console.log("j_per_tok_decode is arm-anchored — cross-stem ratios are REP-vs-REP only;");
    console.log("PURE numbers are low-resolution (see warnings); deltas between arms of the");
    console.log("same stem remain the sanctioned use.");
  }
  if (wroteV3) {
    console.log("\nPhase boundary (kalsa-energy-rep-v3): stamped decode = [mark_N - predicted_ms/1000, mark_N)");
    console.log("and stamped prefill = [mark_N - predicted_ms/1000 - prompt_ms/1000, mark_N - predicted_ms/1000).");
    console.log("Prefill is prompt evaluation through the first generated token; load+idle is the earlier remainder.");
    console.log("Each bucket reports nominal and sampler-integrated seconds, and j_load_idle + j_prefill + j_decode");
    console.log("equals the whole-window J exactly. Missing stamps use v2 arithmetic and are named per row.");
  }
  if (!wroteAny || anyFatal) {
    if (!wroteAny) console.error("energyPhaseSplit: nothing produced");
    process.exit(1);
  }
}

// Run main only when invoked directly, so the harness can import the helpers.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
