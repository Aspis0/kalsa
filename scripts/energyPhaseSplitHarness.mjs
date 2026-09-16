#!/usr/bin/env node
/**
 * Offline harness for scripts/energyPhaseSplit.mjs (kalsa-energy-rep-v2).
 *
 * Feeds synthetic campaign dirs (sampler CSV + .marks + _rN.txt per stem) to
 * the splitter end-to-end and asserts hand-computed phase energies. The main
 * 2-rep fixture uses a piecewise power series (1.2 W early, 0.4 W late in
 * rep 1, 0.8 W rep 2, 2.0 W post-campaign tail) so every J cell is checkable
 * by hand. v2 anchors the decode phase to the rep END (decode = the last
 * decode_s = gen_tokens/gen tps seconds before mark_N), so covered here:
 * decode-at-end anchoring with hand-computed cells, the boundary-straddle
 * interval landing in j_pre (decode starts strictly after its start point),
 * the exact j_pre + j_decode = window-J partition, marks joined as device
 * uptime with NO conversion, run's own llama_perf lines beating the manifest,
 * counts-manifest parsing + preferred-source precedence + campaign t/s
 * cross-check, the not-derivable path (phase columns empty, gen_tokens empty
 * — never 0, never a guess), missing _rN.txt, unparsable speed line, window
 * with no samples, degenerate 1-sample window, sampler-cadence columns and
 * the > 2 s warning, and the audit-F4 guards (decode duration >= window and
 * gen_tokens <= 0 -> exit 1; implied decode power outside 0.1-20 W -> loud
 * warning, exit 0). The auditor's 8.9x wrong-stem-counts scenario (PURE
 * counts on the REP stem) is NOT rejected: the error is damped to ~-40% and
 * flagged by the decode-bucket low-resolution warning — exit 0 (audit R3);
 * only the MIRROR direction (counts implying decode_s >= window) exits 1.
 * decode_s_int (integrated seconds actually attributed to the decode bucket)
 * is asserted in the golden header and rows, with the low-resolution warning
 * fixtures for both triggers: a short decode bucket and the wrong-counts-on-
 * REP direction. Marks hygiene is fatal: out-of-order
 * marks and marks before the first CSV sample refuse the stem.
 *
 * Zero npm deps. Exit 1 on any failure.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  PHASES_COLUMNS,
  COUNTS_MANIFEST_COLUMNS,
  parseSpeedLine,
  parsePerfLines,
  parseMarks,
  parseCountsManifest,
  sampleCadence,
  splitStem,
} from "./energyPhaseSplit.mjs";
import { parseEnergyCsv, integrate } from "./energySchema.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function check(name, cond, detail = "") {
  if (cond) {
    console.log(`PASS  ${name}`);
    passed += 1;
  } else {
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

const HEADER = "t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz";
// 4 V gauge: current_uA * 4e6 uV / 1e12 -> W. 300000=1.2 W, 250000=1.0 W,
// 200000=0.8 W, 100000=0.4 W, 500000=2.0 W, 7500000=30 W, 10000000=40 W.
// t_s always 2-decimal like the real sampler — the schema row regex needs a
// decimal point.
const row = (t, uA) => `${t.toFixed(2)},${uA},4000000,300,Discharging,500000:500000`;
const csv = (rows) => [HEADER, ...rows, ""].join("\n");
const SPEED = "[ Prompt: 4.0 t/s | Generation: 2.0 t/s ]\n";
const SPEED84 = "[ Prompt: 8.4 t/s | Generation: 8.4 t/s ]\n";

// The exact decode-bucket low-resolution warning string (audit R1/R2), built
// from the formatted CSV cells so golden comparisons stay byte-exact. The
// text stays comma-free like every row warning — the warnings field is the
// last CSV column and naive consumers split on plain commas.
const LOWRES_TAIL =
  "; j_per_tok_decode is sampling-granularity dominated — between-arm deltas of the same stem remain the sanctioned use";
const lowres = (n, cov, nom) =>
  `decode bucket low-resolution: ${n} interval(s) attributed to decode (coverage ${cov}/${nom} s = ${Math.round((100 * cov) / nom)}%)${LOWRES_TAIL}`;

// 1.2 W before t=12, 0.4 W from t=12 on, 0.8 W through rep 2, 2.0 W tail
// after the last mark. decode_s = 7 tok / 2.0 t/s = 3.5 s -> decode_start is
// 12.5 (rep 1) and 20.5 (rep 2): both land MID-INTERVAL, so the straddling
// interval must land in j_pre.
const TWO_REP_CSV = csv([
  row(10, 300000), row(11, 300000),
  row(12, 100000), row(13, 100000), row(14, 100000), row(15, 100000),
  row(17, 200000), row(18, 200000), row(19, 200000), row(20, 200000),
  row(21, 200000), row(22, 200000), row(23, 200000),
  row(25, 500000),
]);
const PERF_TXT =
  "llama_perf_context_print: prompt eval time =    1500.00 ms /    10 tokens" +
  "   (  150.00 ms per token,     6.67 tokens per second)\n" +
  "llama_perf_context_print:        eval time =    2500.00 ms /     4 runs" +
  "   ( 625.00 ms per token,     1.60 tokens per second)\n";

// The tracked-format manifest the e2e run consumes. perf_line carries WRONG
// counts (8/16): the run's own perf lines (10/4) must win. edge_empty gets
// gen 3 (decode_s 1.5 s) so its decode_start lands past the last sample
// without tripping the decode>=window guard (window is 2 s).
const MANIFEST = [
  COUNTS_MANIFEST_COLUMNS.join(","),
  "two_rep,8,7,2.0,2.0,2.0,2.0,two_rep_counts.txt",
  "perf_line,8,16,1.6,1.6,1.6,1.6,perf_line_counts.txt",
  "edge_missing,8,7,2.0,2.0,2.0,2.0,edge_missing_counts.txt",
  "edge_empty,8,3,2.0,2.0,2.0,2.0,edge_empty_counts.txt",
  "edge_single,8,7,2.0,2.0,2.0,2.0,edge_single_counts.txt",
  "tps_mismatch,8,7,9.9,9.9,2.0,2.0,tps_mismatch_counts.txt",
  "wrongcounts_rep,72,256,8.4,8.4,8.4,8.4,wc_counts.txt",
  "",
].join("\n");

function readCsvRows(p) {
  return readFileSync(p, "utf8").split("\n");
}

function main() {
  // ── 1. parseSpeedLine: the guaranteed harness format ────────────────
  {
    const s = parseSpeedLine("noise\n[ Prompt: 11.2 t/s | Generation: 9.1 t/s ]\n");
    check("speed: real-format line parsed", !!s && s.promptTps === 11.2 && s.genTps === 9.1, JSON.stringify(s));
    check("speed: malformed (NaN) rejected", parseSpeedLine("[ Prompt: NaN t/s | Generation: 9.1 t/s ]") === null);
    check("speed: absent rejected", parseSpeedLine("Loading model...\nExiting...") === null);
    check("speed: non-positive tps rejected", parseSpeedLine("[ Prompt: 0 t/s | Generation: 9.1 t/s ]") === null);
  }

  // ── 2. parsePerfLines: upstream llama_perf_context_print ────────────
  {
    const both = parsePerfLines(PERF_TXT);
    check(
      "perf: prompt eval ms + tokens parsed",
      both.promptEvalMs === 1500.0 && both.promptTokens === 10,
      JSON.stringify(both),
    );
    check("perf: eval ms + gen tokens from runs", both.evalMs === 2500.0 && both.genTokens === 4, JSON.stringify(both));
    const onlyPrompt = parsePerfLines(PERF_TXT.split("\n")[0] + "\n");
    check(
      "perf: prompt-eval line does not satisfy the eval-time pattern",
      onlyPrompt.promptEvalMs === 1500.0 && onlyPrompt.evalMs === null && onlyPrompt.genTokens === null,
      JSON.stringify(onlyPrompt),
    );
    check("perf: absent everywhere", parsePerfLines(SPEED).genTokens === null);
  }

  // ── 3. parseMarks: real campaign sidecar text ───────────────────────
  {
    const { marks, skipped } = parseMarks("r1 554225.50\nr2 554241.86\n");
    check("marks: real sidecar parsed", marks.get(1) === 554225.5 && marks.get(2) === 554241.86, JSON.stringify([...marks]));
    check("marks: nothing skipped", skipped === 0);
    const bad = parseMarks("r1 554225.50\nnot a mark\n");
    check("marks: garbage line counted", bad.marks.size === 1 && bad.skipped === 1);
  }

  // ── 4. parseCountsManifest: tracked format ──────────────────────────
  {
    const { byStem, errors } = parseCountsManifest(MANIFEST);
    check("manifest: every stem parsed", byStem.size === 7 && errors.length === 0, JSON.stringify(errors));
    const e = byStem.get("two_rep");
    check(
      "manifest: fields land per stem",
      e.promptTokens === 8 && e.genTokens === 7 && e.countRunGenTps === "2.0" &&
        e.campaignGenTps[0] === "2.0" && e.countRunOutput === "two_rep_counts.txt",
      JSON.stringify(e),
    );
    check(
      "manifest: bad header refused",
      parseCountsManifest("stem,counts\nx,1\n").errors[0].includes("header mismatch"),
    );
    check(
      "manifest: short row refused",
      parseCountsManifest(`${COUNTS_MANIFEST_COLUMNS.join(",")}\nx,1,2,3\n`).errors[0].includes("expected 8 fields"),
    );
    check(
      "manifest: non-integer counts refused",
      parseCountsManifest(`${COUNTS_MANIFEST_COLUMNS.join(",")}\nx,1.5,2,3,4,5,6,f\n`).errors[0].includes("non-negative integers"),
    );
    const zero = parseCountsManifest(`${COUNTS_MANIFEST_COLUMNS.join(",")}\nx,51,0,3,4,5,6,f\n`);
    check("manifest: gen_tokens=0 kept for the guard", zero.errors.length === 0 && zero.byStem.get("x").genTokens === 0);
  }

  // ── 5. sampleCadence: median/max inter-sample interval ──────────────
  {
    const cad = sampleCadence([{ t: 10 }, { t: 11 }, { t: 13.5 }, { t: 14 }]);
    check("cadence: median/max of [1, 2.5, 0.5]", cad.median === 1 && cad.max === 2.5, JSON.stringify(cad));
    check("cadence: single sample is NaN", Number.isNaN(sampleCadence([{ t: 1 }]).max));
    const spread = sampleCadence([{ t: 0 }, { t: 1 }, { t: 3 }, { t: 6 }, { t: 10 }]);
    check("cadence: even dt count averages the middle pair", spread.median === 2.5 && spread.max === 4, JSON.stringify(spread));
  }

  // ── 6. splitStem: not-derivable decode (no counts anywhere) ─────────
  {
    const { rows, notes } = splitStem("solo", {
      csvText: csv([row(10, 250000), row(11, 250000)]),
      marksText: "r1 14.00\n",
      repTexts: new Map([[1, SPEED]]),
      manifestEntry: undefined,
      cliPromptTokens: undefined,
      cliGenTokens: undefined,
    });
    check("noderiv: one row emitted, rep not skipped", rows.length === 1, JSON.stringify(rows));
    const r = rows[0];
    check(
      "noderiv: phase columns stay empty (never a guess)",
      r.duration === "1.000" && r.decode_s === "" && r.decode_s_int === "" && r.j_pre === "" && r.j_decode === "" &&
        r.j_per_tok_decode === "" && r.prompt_tokens === "" && r.gen_tokens === "",
      JSON.stringify(r),
    );
    check(
      "noderiv: warning names the count sources",
      r.warnings.includes("decode duration not derivable") && r.warnings.includes("counts manifest"),
      r.warnings,
    );
    check("noderiv: cadence columns still filled", r.cadence_median_s === "1.000" && r.cadence_max_s === "1.000", JSON.stringify(r));
    check("noderiv: no notes (row is emitted, not skipped)", notes.length === 0, JSON.stringify(notes));
  }

  // ── 7. splitStem: marks hygiene is fatal (audit F7) ─────────────────
  {
    const base = { csvText: csv([row(10, 250000), row(11, 250000), row(12, 250000)]), repTexts: new Map([[1, SPEED]]) };
    const oo = splitStem("oo", { ...base, marksText: "r1 16.00\nr2 14.00\n" });
    check("marks: out-of-order is fatal", oo.fatal !== null && oo.fatal.includes("marks out of order: r2 (14) <= r1 (16)"), oo.fatal ?? "");
    check("marks: fatal stem emits no rows", oo.rows.length === 0);
    const eq = splitStem("eq", { ...base, marksText: "r1 14.00\nr2 14.00\n" });
    check("marks: equal marks are fatal", eq.fatal !== null && eq.fatal.includes("r2 (14) <= r1 (14)"), eq.fatal ?? "");
    const pre = splitStem("pre", { ...base, marksText: "r1 9.00\n" });
    check(
      "marks: mark before the first CSV sample is fatal",
      pre.fatal !== null && pre.fatal.includes("mark r1 (9) precedes the first CSV sample (10)"),
      pre.fatal ?? "",
    );
  }

  // ── 8. end-to-end over a fixture campaign dir (counts manifest) ─────
  const tmp = mkdtempSync(path.join(tmpdir(), "energyPhase-"));
  try {
    const dir = path.join(tmp, "campaign");
    mkdirSync(dir);
    writeFileSync(path.join(dir, "two_rep.csv"), TWO_REP_CSV);
    writeFileSync(path.join(dir, "two_rep.marks"), "r1 16.00\nr2 24.00\n");
    writeFileSync(path.join(dir, "two_rep_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "two_rep_r2.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "perf_line.csv"), csv([row(100, 250000), row(101, 250000), row(102, 250000), row(103, 250000)]));
    writeFileSync(path.join(dir, "perf_line.marks"), "r1 104.00\n");
    writeFileSync(path.join(dir, "perf_line_r1.txt"), PERF_TXT);
    writeFileSync(path.join(dir, "edge_nospeed.csv"), csv([row(10, 250000), row(11, 250000)]));
    writeFileSync(path.join(dir, "edge_nospeed.marks"), "r1 14.00\n");
    writeFileSync(path.join(dir, "edge_nospeed_r1.txt"), "[ Prompt: NaN t/s | Generation: 9.1 t/s ]\n");
    writeFileSync(path.join(dir, "edge_missing.csv"), csv([
      row(50, 250000), row(51, 250000), row(52, 250000), row(53, 250000),
      row(56, 100000), row(57, 100000), row(58, 100000), row(59, 100000),
      row(60, 100000), row(61, 100000), row(62, 100000), row(63, 100000),
      row(64, 100000), row(65, 100000),
    ]));
    writeFileSync(path.join(dir, "edge_missing.marks"), "r1 54.00\nr2 66.00\n");
    writeFileSync(path.join(dir, "edge_missing_r2.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_empty.csv"), csv([row(90, 250000), row(91, 250000), row(92, 250000)]));
    writeFileSync(path.join(dir, "edge_empty.marks"), "r1 96.00\nr2 100.00\n");
    writeFileSync(path.join(dir, "edge_empty_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_empty_r2.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_single.csv"), csv([row(55, 250000)]));
    writeFileSync(path.join(dir, "edge_single.marks"), "r1 58.00\n");
    writeFileSync(path.join(dir, "edge_single_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "tps_mismatch.csv"), csv([
      row(10, 250000), row(11, 250000), row(12, 250000), row(13, 250000),
      row(14, 250000), row(15, 250000), row(16, 250000),
    ]));
    writeFileSync(path.join(dir, "tps_mismatch.marks"), "r1 17.00\n");
    writeFileSync(path.join(dir, "tps_mismatch_r1.txt"), `banner\n${SPEED}`);
    // wrongcounts_rep (audit R3): REP-like stem — 40 s window of 1 s samples
    // at 1.0 W, 8.4 t/s speed line. The 8.9x direction: PURE-style counts
    // (30 tok) keep decode_s plausible (3.571 s), so no guard can fire.
    writeFileSync(
      path.join(dir, "wrongcounts_rep.csv"),
      csv(Array.from({ length: 40 }, (_, i) => row(10 + i, 250000))),
    );
    writeFileSync(path.join(dir, "wrongcounts_rep.marks"), "r1 50.00\n");
    writeFileSync(path.join(dir, "wrongcounts_rep_r1.txt"), `banner\n${SPEED84}`);
    writeFileSync(path.join(dir, "lonely.csv"), csv([row(10, 250000), row(11, 250000)]));
    const manifestPath = path.join(tmp, "manifest.csv");
    writeFileSync(manifestPath, MANIFEST);

    const tool = path.join(__dirname, "energyPhaseSplit.mjs");
    const runManifest = (stems) =>
      spawnSync(
        process.execPath,
        [tool, dir, ...stems, "--counts-manifest", manifestPath],
        { encoding: "utf8" },
      );
    const r = runManifest(["two_rep", "perf_line", "edge_nospeed", "edge_missing", "edge_empty", "edge_single", "tps_mismatch"]);

    check("e2e: exits 0 with per-rep warnings", r.status === 0, `status=${r.status} stderr=${r.stderr}`);
    check("e2e: manifest named as preferred count source", r.stderr.includes("counts from manifest") && r.stderr.includes("preferred"), r.stderr);
    check("e2e: six phases files written", ["two_rep", "perf_line", "edge_missing", "edge_empty", "edge_single", "tps_mismatch"].every((s) => existsSync(path.join(dir, `${s}.phases.csv`))));
    check("e2e: unparsable speed line -> no file, rep skipped", !existsSync(path.join(dir, "edge_nospeed.phases.csv")) && r.stderr.includes("edge_nospeed: r1: no parsable speed/perf line"), r.stderr);
    check("e2e: wrote-notes go to stderr only", !r.stdout.includes("wrote"), r.stdout);

    // Golden header + hand-computed rep rows. Hand math (4 V, right-Riemann:
    // an interval's power is its right-endpoint sample's), decode_s =
    // 7/2.0 = 3.5 s anchored at the rep END:
    // rep1 window [10,16), decode_start 12.5 -> j_pre integrates {10,11,12,13}:
    // intervals [10,11)=1.2 J, [11,12)=0.4 J (t=12 is already 0.4 W),
    // [12,13)=0.4 J — the straddling interval starts BEFORE 12.5, so it
    // belongs to j_pre: J = 2.0. decode {13,14,15}: J = 0.8, per-tok
    // 0.8/7 = 0.114. Whole-window J = 2.8 = 2.0 + 0.8 exactly. Tail t=25
    // (2.0 W) must NOT appear. decode_s_int = 15 - 13 = 2.000 s (coverage
    // 2.0/3.5 = 57%, 2 intervals < 3) -> the low-resolution warning fires.
    // rep2 window [16,24), decode_start 20.5 -> pre {17..21} intervals:
    // J = 4*0.8 = 3.2; decode {21,22,23}: J = 1.6, per-tok 0.229.
    const lines = readCsvRows(path.join(dir, "two_rep.phases.csv"));
    check("golden: header is PHASES_COLUMNS", lines[0] === PHASES_COLUMNS.join(","), lines[0]);
    const r1 = lines[1].split(",");
    const r2 = lines[2].split(",");
    check(
      "golden rep1: window/decode-anchor/straddle-to-j_pre exact",
      r1[1] === "1" && r1[2] === "10.00" && r1[3] === "16.00" && r1[4] === "5.000" &&
        r1[5] === "3.500" && r1[6] === "2.000" && r1[7] === "2.000" && r1[8] === "2.000" && r1[9] === "0.800",
      lines[1],
    );
    check(
      "golden rep1: per-token, w_decode, sample split, cadence, low-resolution warning",
      r1[10] === "0.114" && r1[11] === "8" && r1[12] === "7" && r1[13] === "0.400" &&
        r1[14] === "3" && r1[15] === "3" && r1[16] === "1.000" && r1[17] === "2.000" &&
        r1[18] === lowres(2, "2.00", "3.50"),
      lines[1],
    );
    check(
      "golden rep2: straddle at 20.5 lands in j_pre, decode takes the tail",
      r2[2] === "16.00" && r2[3] === "24.00" && r2[4] === "6.000" && r2[5] === "3.500" &&
        r2[6] === "2.000" && r2[8] === "3.200" && r2[9] === "1.600" && r2[10] === "0.229" &&
        r2[14] === "4" && r2[15] === "3",
      lines[2],
    );
    // Partition invariant: the printed cells reproduce the independently
    // integrated window J (exact inside the tool — j_decode is computed as
    // whole minus j_pre; the CSV cells are 3-decimal rounded).
    const wholeJ1 = integrate(parseEnergyCsv(TWO_REP_CSV).rows.filter((s) => s.t >= 10 && s.t < 16)).joules;
    const wholeJ2 = integrate(parseEnergyCsv(TWO_REP_CSV).rows.filter((s) => s.t >= 16 && s.t < 24)).joules;
    check(
      "partition: j_pre + j_decode reproduces the whole-window J (both reps)",
      Math.abs(Number(r1[8]) + Number(r1[9]) - wholeJ1) < 1e-9 &&
        Math.abs(Number(r2[8]) + Number(r2[9]) - wholeJ2) < 1e-9,
      `${Number(r1[8]) + Number(r1[9])} vs ${wholeJ1}; ${Number(r2[8]) + Number(r2[9])} vs ${wholeJ2}`,
    );
    check(
      "marks join: window_end_s equals the raw mark value (uptime, no conversion)",
      r1[3] === "16.00" && r2[3] === "24.00",
      `r1=${r1[3]} r2=${r2[3]}`,
    );

    // perf_line: decode_s from the run's own eval-time ms (2.5 s, not
    // 16/1.6 = 10 s from the manifest), tokens 10/4 from the perf lines
    // (beating the manifest 8/16). decode_start 101.5 -> pre {100,101} +
    // straddle [101,102): J = 2.0; decode {102,103}: decode_s_int 1.000,
    // J = 1.0, per-tok 0.25. 1 interval / 40% coverage -> low-resolution.
    const pl = readCsvRows(path.join(dir, "perf_line.phases.csv"))[1].split(",");
    check(
      "perf line: run's own ms/tokens beat the manifest",
      pl[4] === "3.000" && pl[5] === "2.500" && pl[6] === "1.000" && pl[7] === "1.500" &&
        pl[8] === "2.000" && pl[9] === "1.000" && pl[10] === "0.250" && pl[11] === "10" && pl[12] === "4",
      readCsvRows(path.join(dir, "perf_line.phases.csv"))[1],
    );

    // edge_missing: rep1's window [50,54) is valid but _r1.txt is missing
    // (skipped on stderr); rep2 window [54,66), decode_start 62.5 -> pre
    // 7 intervals (2.8 J), decode 3 samples / 2 intervals (decode_s_int
    // 2.000, 0.8 J). Max dt 3 s > 2 s -> cadence warning + low-resolution.
    check("missing txt: stderr note names the rep", r.stderr.includes("edge_missing: r1: missing _r1.txt"), r.stderr);
    const em = readCsvRows(path.join(dir, "edge_missing.phases.csv"));
    check(
      "missing txt: only rep 2 row, anchored split exact",
      em.length === 3 && em[1].split(",")[1] === "2" && em[1].split(",")[4] === "9.000" &&
        em[1].split(",")[6] === "2.000" && em[1].split(",")[8] === "2.800" && em[1].split(",")[9] === "0.800" &&
        em[1].split(",")[14] === "7" && em[1].split(",")[15] === "3",
      em[1],
    );
    check(
      "cadence warning: max dt 3 s > 2 s lands in the row warnings",
      em[1].split(",")[18] ===
        `sampler cadence max 3.000 s exceeds 2 s (edge uncertainty up to one interval); ${lowres(2, "2.00", "3.50")}`,
      em[1],
    );

    // edge_empty: rep1's decode_start (96 - 1.5 = 94.5) is past the last
    // sample (92) — decode segment has no samples (decode_s_int empty, no
    // low-resolution warning — the no-samples warning covers it); rep2's
    // mark window holds no samples.
    const ee = readCsvRows(path.join(dir, "edge_empty.phases.csv"));
    check(
      "empty window: rep1 keeps j_pre, decode empty + warning",
      ee[1].split(",")[4] === "2.000" && ee[1].split(",")[5] === "1.500" && ee[1].split(",")[6] === "" &&
        ee[1].split(",")[8] === "2.000" && ee[1].split(",")[9] === "" &&
        ee[1].split(",")[14] === "3" && ee[1].split(",")[15] === "0" &&
        ee[1].split(",")[18] === "decode segment has no samples (decode_s shorter than the tail gap to the mark)",
      ee[1],
    );
    check(
      "empty window: rep2 row keeps only what is true",
      ee[2].split(",")[2] === "96.00" && ee[2].split(",")[4] === "" && ee[2].split(",")[6] === "" &&
        ee[2].split(",")[8] === "" &&
        ee[2].split(",")[14] === "0" && ee[2].split(",")[15] === "0" &&
        ee[2].split(",")[18] === "rep window has no samples",
      ee[2],
    );

    // edge_single: 1-sample window [55,58), decode_start 54.5 before the
    // only sample -> decode takes the (degenerate) window, pre has no
    // interval. decode_s_int 0.000 / 0 intervals -> low-resolution fires.
    const es = readCsvRows(path.join(dir, "edge_single.phases.csv"))[1].split(",");
    check(
      "degenerate window: decode_start before first sample, warnings joined",
      es[4] === "0.000" && es[6] === "0.000" && es[9] === "0.000" && es[13] === "1.000" &&
        es[14] === "0" && es[15] === "1" &&
        es[18] ===
          `decode_start at/before the first window sample — pre phase has no interval; ${lowres(0, "0.00", "3.50")}; ` +
            "window has 1 sample(s); integration degenerate; implied decode power 0.00 W (j_decode / decode_s) outside the 0.1-20 W sanity band — counts wrong?",
      readCsvRows(path.join(dir, "edge_single.phases.csv"))[1],
    );

    // tps_mismatch: the manifest's campaign t/s disagrees with the rep's own
    // speed line -> loud row warning (wrong manifest/campaign pairing?),
    // plus the low-resolution warning (2 intervals for the 3.5 s decode).
    const tm = readCsvRows(path.join(dir, "tps_mismatch.phases.csv"))[1].split(",");
    check(
      "manifest pairing: campaign t/s mismatch warns",
      tm[18] ===
        `manifest campaign_gen_tps_r1 (9.9) differs from this run's speed line (2) — wrong manifest/campaign pairing?; ${lowres(2, "2.00", "3.50")}`,
      readCsvRows(path.join(dir, "tps_mismatch.phases.csv"))[1],
    );

    // ── 9. flags fallback: works, but says the manifest is preferred ───
    const rf = spawnSync(
      process.execPath,
      [tool, dir, "two_rep", "--prompt-tokens", "4", "--gen-tokens", "6"],
      { encoding: "utf8" },
    );
    check("flags: exits 0", rf.status === 0, `status=${rf.status} stderr=${rf.stderr}`);
    check("flags: preferred-source warning on stderr", rf.stderr.includes("WARNING") && rf.stderr.includes("--counts-manifest is the preferred count source"), rf.stderr);
    const fr = readCsvRows(path.join(dir, "two_rep.phases.csv"))[1].split(",");
    // decode_s = 6/2 = 3.0 -> decode_start 13.0: j_pre = 2.8, j_decode = 0.8,
    // per-tok 0.8/6 = 0.133 (vs 0.114 under the manifest's counts — the
    // divider matters, which is exactly why the manifest is pinned).
    check(
      "flags: counts applied to the split",
      fr[5] === "3.000" && fr[6] === "2.000" && fr[10] === "0.133" && fr[11] === "4" && fr[12] === "6",
      readCsvRows(path.join(dir, "two_rep.phases.csv"))[1],
    );

    // ── 10. audit F4/R3: the MIRROR of the 8.9x direction is rejected ──
    // Counts implying decode_s >= window (30 tok at 2.0 t/s on the 5 s
    // window) are incoherent and exit 1. The auditor's actual 8.9x direction
    // (PURE counts, plausible decode_s) is NOT rejected — see 10b below.
    const rx = spawnSync(
      process.execPath,
      [tool, dir, "two_rep", "--prompt-tokens", "51", "--gen-tokens", "30"],
      { encoding: "utf8" },
    );
    check("mirror: counts implying decode_s >= window exit 1", rx.status === 1, `status=${rx.status} stderr=${rx.stderr}`);
    check(
      "mirror: guard names the incoherence",
      rx.stderr.includes("FATAL two_rep") && rx.stderr.includes("decode duration (15.000 s) >= window duration (5.000 s)"),
      rx.stderr,
    );

    // ── 10b. audit R3: the 8.9x direction is damped and flagged, NOT
    // rejected. PURE-style counts (30 tok) on the REP stem at 8.4 t/s ->
    // decode_s 3.571 s on the 40 s window: plausible, so exit 0.
    // decode_start 46.43 -> decode samples {47,48,49}: 2 intervals,
    // decode_s_int 2.000 (coverage 2.00/3.57 s, 56%) -> the low-resolution
    // warning fires; j_decode = 2 J, per-tok 2/30 = 0.067.
    const rw = spawnSync(
      process.execPath,
      [tool, dir, "wrongcounts_rep", "--prompt-tokens", "51", "--gen-tokens", "30"],
      { encoding: "utf8" },
    );
    check(
      "8.9x: PURE counts on the REP stem exit 0 (damped and flagged, not rejected)",
      rw.status === 0,
      `status=${rw.status} stderr=${rw.stderr}`,
    );
    const wc = readCsvRows(path.join(dir, "wrongcounts_rep.phases.csv"))[1].split(",");
    check(
      "8.9x: low-resolution warning fires on the wrong-counts decode bucket",
      wc[5] === "3.571" && wc[6] === "2.000" && wc[9] === "2.000" && wc[10] === "0.067" &&
        wc[14] === "37" && wc[15] === "3" && wc[18] === lowres(2, "2.00", "3.57"),
      readCsvRows(path.join(dir, "wrongcounts_rep.phases.csv"))[1],
    );
    // The same stem under its own manifest counts: decode_start 19.52,
    // decode_s_int 29.000, j_decode 29 J, per-tok 29/256 = 0.113 — the
    // wrong-counts figure above is 41% low (the auditor's damped error) and
    // no low-resolution warning fires on the honest row.
    const rm = spawnSync(
      process.execPath,
      [tool, dir, "wrongcounts_rep", "--counts-manifest", manifestPath],
      { encoding: "utf8" },
    );
    const wm = readCsvRows(path.join(dir, "wrongcounts_rep.phases.csv"))[1].split(",");
    check(
      "8.9x: correct counts give the undamped figure (-41% damping on the wrong ones)",
      rm.status === 0 && wm[5] === "30.476" && wm[6] === "29.000" && wm[10] === "0.113" &&
        wm[14] === "10" && wm[15] === "30" && !wm[18].includes("low-resolution"),
      readCsvRows(path.join(dir, "wrongcounts_rep.phases.csv"))[1],
    );

    // ── 11. guards: decode>=window via manifest, band warnings ─────────
    writeFileSync(path.join(dir, "guard_dur.csv"), csv([
      row(10, 250000), row(11, 250000), row(12, 250000), row(13, 250000),
    ]));
    writeFileSync(path.join(dir, "guard_dur.marks"), "r1 14.00\n");
    writeFileSync(path.join(dir, "guard_dur_r1.txt"), `banner\n${SPEED}`);
    const gd = spawnSync(
      process.execPath,
      [tool, dir, "guard_dur", "--prompt-tokens", "8", "--gen-tokens", "7"],
      { encoding: "utf8" },
    );
    check("guard: decode duration >= window duration exits 1", gd.status === 1, `status=${gd.status} stderr=${gd.stderr}`);
    check(
      "guard: message names both durations",
      gd.stderr.includes("decode duration (3.500 s) >= window duration (3.000 s)"),
      gd.stderr,
    );

    // 40 W decode-side data, decode_s = 5/2 = 2.5 s -> decode_start 14.5,
    // decode segment = {14.5,16}: 1 interval, J = 40*1.5 = 60, implied
    // power 60/2.5 = 24 W > 20 W band -> loud warning, exit 0.
    writeFileSync(path.join(dir, "guard_band_hi.csv"), csv([
      row(10, 10000000), row(11, 10000000), row(12, 10000000), row(14.5, 10000000), row(16, 10000000),
    ]));
    writeFileSync(path.join(dir, "guard_band_hi.marks"), "r1 17.00\n");
    writeFileSync(path.join(dir, "guard_band_hi_r1.txt"), `banner\n${SPEED}`);
    const bh = spawnSync(
      process.execPath,
      [tool, dir, "guard_band_hi", "--prompt-tokens", "8", "--gen-tokens", "5"],
      { encoding: "utf8" },
    );
    check("guard: implied 24 W -> exit 0 (warning, not failure)", bh.status === 0, `status=${bh.status} stderr=${bh.stderr}`);
    check(
      "guard: implied power warning on stderr and in the row",
      bh.stderr.includes("implied decode power 24.00 W (j_decode / decode_s) outside the 0.1-20 W sanity band") &&
        readCsvRows(path.join(dir, "guard_band_hi.phases.csv"))[1].split(",")[18].includes("implied decode power 24.00 W"),
      bh.stderr,
    );

    // decode_s = 2/2 = 1.0 s -> decode_start 14.0 -> decode segment {14}:
    // no interval integrates -> j_decode 0 -> implied 0 W < 0.1 W band ->
    // loud warning, exit 0.
    writeFileSync(path.join(dir, "guard_band_lo.csv"), csv([
      row(10, 250000), row(11, 250000), row(12, 250000), row(13, 250000), row(14, 250000),
    ]));
    writeFileSync(path.join(dir, "guard_band_lo.marks"), "r1 15.00\n");
    writeFileSync(path.join(dir, "guard_band_lo_r1.txt"), `banner\n${SPEED}`);
    const bl = spawnSync(
      process.execPath,
      [tool, dir, "guard_band_lo", "--prompt-tokens", "8", "--gen-tokens", "2"],
      { encoding: "utf8" },
    );
    check("guard: implied 0 W -> exit 0 (warning, not failure)", bl.status === 0, `status=${bl.status} stderr=${bl.stderr}`);
    check(
      "guard: low-side band warning fires",
      bl.stderr.includes("implied decode power 0.00 W (j_decode / decode_s) outside the 0.1-20 W sanity band"),
      bl.stderr,
    );

    // ── 12. manifest hygiene: gen_tokens = 0 and malformed rows exit 1 ──
    const badZero = path.join(tmp, "manifest_zero.csv");
    writeFileSync(badZero, `${COUNTS_MANIFEST_COLUMNS.join(",")}\ntwo_rep,8,0,2.0,2.0,2.0,2.0,x.txt\n`);
    const rz = spawnSync(process.execPath, [tool, dir, "two_rep", "--counts-manifest", badZero], { encoding: "utf8" });
    check("manifest guard: gen_tokens = 0 exits 1", rz.status === 1, `status=${rz.status} stderr=${rz.stderr}`);
    check(
      "manifest guard: message names the zero count",
      rz.stderr.includes("gen_tokens = 0 <= 0 with a count source present — incoherent input"),
      rz.stderr,
    );
    const badRow = path.join(tmp, "manifest_bad.csv");
    writeFileSync(badRow, `${COUNTS_MANIFEST_COLUMNS.join(",")}\ntwo_rep,8,7\n`);
    const rr = spawnSync(process.execPath, [tool, dir, "two_rep", "--counts-manifest", badRow], { encoding: "utf8" });
    check("manifest: malformed row refuses the run", rr.status === 1 && rr.stderr.includes("expected 8 fields"), rr.stderr ?? "");
    const missing = spawnSync(process.execPath, [tool, dir, "two_rep", "--counts-manifest", path.join(tmp, "nope.csv")], { encoding: "utf8" });
    check("manifest: unreadable file exits 1", missing.status === 1 && missing.stderr.includes("cannot read counts manifest"), missing.stderr);

    // ── 13. marks hygiene e2e: fatal leaves no file, fails the run ─────
    const badDir = path.join(tmp, "badmarks");
    mkdirSync(badDir);
    writeFileSync(path.join(badDir, "oo.csv"), csv([row(10, 250000), row(11, 250000), row(12, 250000)]));
    writeFileSync(path.join(badDir, "oo.marks"), "r1 16.00\nr2 14.00\n");
    writeFileSync(path.join(badDir, "oo_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(badDir, "oo_r2.txt"), `banner\n${SPEED}`);
    const ro = spawnSync(process.execPath, [tool, badDir, "oo"], { encoding: "utf8" });
    check("marks e2e: out-of-order marks exit 1", ro.status === 1, `status=${ro.status} stderr=${ro.stderr}`);
    check("marks e2e: FATAL line names the stem, no file written", ro.stderr.includes("FATAL oo: marks out of order") && !existsSync(path.join(badDir, "oo.phases.csv")), ro.stderr);

    // ── 14. exit 1: nothing produced / unknown stem ───────────────────
    const lonely = runManifest(["lonely"]);
    check("exit1: lonely stem (no marks, no txt) exits 1", lonely.status === 1, `status=${lonely.status}`);
    check("exit1: reason on stderr", lonely.stderr.includes("nothing produced") && lonely.stderr.includes("lonely: no .marks file"), lonely.stderr);
    const nope = runManifest(["nope"]);
    check("exit1: unknown stem exits 1", nope.status === 1, `status=${nope.status}`);
    check("exit1: unknown stem named on stderr", nope.stderr.includes("nope: no nope.csv"), nope.stderr);
  } finally {
    try {
      rmSync(tmp, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }

  console.log("");
  console.log(
    `=== OVERALL: ${failed === 0 ? "PASS" : "FAIL"} (${passed} passed, ${failed} failed) ===`,
  );
  if (failed > 0) process.exit(1);
}

main();
