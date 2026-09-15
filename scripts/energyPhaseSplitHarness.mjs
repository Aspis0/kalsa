#!/usr/bin/env node
/**
 * Offline harness for scripts/energyPhaseSplit.mjs.
 *
 * Feeds synthetic campaign dirs (sampler CSV + .marks + _rN.txt per stem) to
 * the splitter end-to-end and asserts hand-computed phase energies. The main
 * 2-rep fixture uses a piecewise power series (1.2 W prefill-side, 0.4 W
 * decode-side, 0.8 W second rep, 2.0 W post-campaign tail) so every J cell is
 * checkable by hand, including the boundary-straddle interval that the decode
 * side must absorb (right-endpoint rule) and the tail sample that must be
 * excluded. Covered: marks joined as device uptime with NO conversion, run's
 * own llama_perf lines beating the CLI token counts, missing _rN.txt,
 * unparsable speed line, window with no samples, degenerate 1-sample window,
 * the not-derivable-boundary path (phase columns stay empty + warning, the
 * same path current real data takes), the golden phases.csv header, and the
 * exit-1 cases (nothing produced / unknown stem).
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
  parseSpeedLine,
  parsePerfLines,
  parseMarks,
  splitStem,
} from "./energyPhaseSplit.mjs";

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
// 200000=0.8 W, 100000=0.4 W, 500000=2.0 W. t_s always 2-decimal like the
// real sampler — the schema row regex requires a decimal point.
const row = (t, uA) => `${t.toFixed(2)},${uA},4000000,300,Discharging,500000:500000`;
const csv = (rows) => [HEADER, ...rows, ""].join("\n");
const SPEED = "[ Prompt: 4.0 t/s | Generation: 2.0 t/s ]\n"; // 8 tok / 4.0 = 2.0 s prefill

// 1.2 W before t=12, 0.4 W from t=12 on (the boundary lands exactly on the
// t=12 sample), 0.8 W through rep 2, 2.0 W tail after the last mark.
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
    check("perf: gen tokens from runs", both.genTokens === 4, JSON.stringify(both));
    const onlyPrompt = parsePerfLines(PERF_TXT.split("\n")[0] + "\n");
    check(
      "perf: prompt-eval line does not satisfy the eval-time pattern",
      onlyPrompt.promptEvalMs === 1500.0 && onlyPrompt.genTokens === null,
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

  // ── 4. splitStem: not-derivable boundary (current real-data path) ───
  {
    const { rows, notes } = splitStem("solo", {
      csvText: csv([row(10, 250000), row(11, 250000)]),
      marksText: "r1 14.00\n",
      repTexts: new Map([[1, SPEED]]),
      cliPromptTokens: undefined,
      cliGenTokens: undefined,
    });
    check("noderiv: one row emitted, rep not skipped", rows.length === 1, JSON.stringify(rows));
    const r = rows[0];
    check(
      "noderiv: phase columns stay empty (never a guess)",
      r.duration === "1.000" && r.j_prefill === "" && r.j_decode === "" &&
        r.j_per_tok_decode === "" && r.prompt_tokens === "" && r.gen_tokens === "",
      JSON.stringify(r),
    );
    check(
      "noderiv: warning names the fix",
      r.warnings.includes("prompt-eval duration not derivable") && r.warnings.includes("--prompt-tokens"),
      r.warnings,
    );
    check("noderiv: no notes (row is emitted, not skipped)", notes.length === 0, JSON.stringify(notes));
  }

  // ── 5. end-to-end over a fixture campaign dir ───────────────────────
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
      row(50, 100000), row(51, 100000), row(52, 100000), row(53, 100000),
      row(56, 100000), row(57, 100000), row(58, 100000), row(59, 100000),
    ]));
    writeFileSync(path.join(dir, "edge_missing.marks"), "r1 54.00\nr2 62.00\n");
    writeFileSync(path.join(dir, "edge_missing_r2.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_empty.csv"), csv([row(90, 250000), row(91, 250000), row(92, 250000)]));
    writeFileSync(path.join(dir, "edge_empty.marks"), "r1 100.00\nr2 104.00\n");
    writeFileSync(path.join(dir, "edge_empty_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_empty_r2.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "edge_single.csv"), csv([row(55, 250000)]));
    writeFileSync(path.join(dir, "edge_single.marks"), "r1 58.00\n");
    writeFileSync(path.join(dir, "edge_single_r1.txt"), `banner\n${SPEED}`);
    writeFileSync(path.join(dir, "lonely.csv"), csv([row(10, 250000), row(11, 250000)]));

    const tool = path.join(__dirname, "energyPhaseSplit.mjs");
    const run = (stems) =>
      spawnSync(
        process.execPath,
        [tool, dir, ...stems, "--prompt-tokens", "8", "--gen-tokens", "16"],
        { encoding: "utf8" },
      );
    const r = run(["two_rep", "perf_line", "edge_nospeed", "edge_missing", "edge_empty", "edge_single"]);

    check("e2e: exits 0 with per-rep warnings", r.status === 0, `status=${r.status} stderr=${r.stderr}`);
    check("e2e: CLI note on stderr", r.stderr.includes("using --prompt-tokens 8"), r.stderr);
    check("e2e: five phases files written", ["two_rep", "perf_line", "edge_missing", "edge_empty", "edge_single"].every((s) => existsSync(path.join(dir, `${s}.phases.csv`))));
    check("e2e: unparsable speed line -> no file, rep skipped", !existsSync(path.join(dir, "edge_nospeed.phases.csv")) && r.stderr.includes("edge_nospeed: r1: no parsable speed/perf line"), r.stderr);
    check("e2e: wrote-notes go to stderr only", !r.stdout.includes("wrote"), r.stdout);
    check("e2e: stdout table has the two_rep rows", r.stdout.includes("| 1 | 10.00 | 5.000 | 1.000 | 4.000 | 1.200 | 1.600 | 0.150 | 0.100 | 1.200 | 0.400 | 2 | 4 | — |"), r.stdout);

    // Golden header + hand-computed rep rows. Hand math (4 V, 1 Hz):
    // rep1 window [10,16), boundary 10+8/4.0=12.0 -> prefill samples {10,11}
    // own 1.2 W: J = 1.2*1 = 1.2, s = 1.0; decode {12..15} + borrowed 11:
    // J = 0.4*4 = 1.6, s = 5.0-1.0 = 4.0. Tail t=25 (2.0 W) must NOT appear.
    // rep2 window [16,24), boundary 18.0 -> prefill {17}: J = 0 (one sample,
    // no interval); decode {18..23} + borrowed 17: J = 0.8*6 = 4.8, s = 6.0.
    const lines = readCsvRows(path.join(dir, "two_rep.phases.csv"));
    check("golden: header is PHASES_COLUMNS", lines[0] === PHASES_COLUMNS.join(","), lines[0]);
    const r1 = lines[1].split(",");
    const r2 = lines[2].split(",");
    check(
      "golden rep1: window/duration/phases exact",
      r1[2] === "10.00" && r1[3] === "5.000" && r1[4] === "1.000" && r1[5] === "4.000",
      lines[1],
    );
    check(
      "golden rep1: J partition + per-token exact",
      r1[6] === "1.200" && r1[7] === "1.600" && r1[8] === "0.150" && r1[9] === "0.100",
      lines[1],
    );
    check(
      "golden rep1: means, sample counts, tokens, clean warnings",
      r1[10] === "8" && r1[11] === "16" && r1[12] === "1.200" && r1[13] === "0.400" &&
        r1[14] === "2" && r1[15] === "4" && r1[16] === "",
      lines[1],
    );
    check(
      "golden rep2: one-sample prefill keeps J=0 and decode absorbs the straddle",
      r2[2] === "16.00" && r2[3] === "6.000" && r2[4] === "0.000" && r2[5] === "6.000" &&
        r2[6] === "0.000" && r2[7] === "4.800" && r2[8] === "0.000" && r2[9] === "0.300" &&
        r2[12] === "0.800" && r2[13] === "0.800" && r2[14] === "1" && r2[15] === "6",
      lines[2],
    );
    check(
      "marks join: window_start_s equals the raw mark value (uptime, no conversion)",
      r2[2] === "16.00" && r1[2] === "10.00",
      `r1=${r1[2]} r2=${r2[2]}`,
    );

    // perf_line: boundary from the run's own 1500 ms (not CLI 8 tok), tokens
    // 10/4 from the perf lines (beating CLI 8/16). Hand: boundary 101.5 ->
    // prefill {100,101}: J = 1.0, s = 1.0; decode: J = 1.0*2 = 2.0, s = 2.0.
    const pl = readCsvRows(path.join(dir, "perf_line.phases.csv"))[1].split(",");
    check(
      "perf line: run's own tokens/beat CLI + direct ms boundary",
      pl[2] === "100.00" && pl[3] === "3.000" && pl[4] === "1.000" && pl[5] === "2.000" &&
        pl[6] === "1.000" && pl[7] === "2.000" && pl[8] === "0.100" && pl[9] === "0.500" &&
        pl[10] === "10" && pl[11] === "4",
      readCsvRows(path.join(dir, "perf_line.phases.csv"))[1],
    );

    // edge_missing: rep1's window [50,54) is valid but _r1.txt is missing
    // (skipped on stderr); rep2's boundary (54+2=56) lands before the first
    // sample -> prefill empty, decode takes the window: J = 0.4 W * 3 s = 1.2.
    check("missing txt: stderr note names the rep", r.stderr.includes("edge_missing: r1: missing _r1.txt"), r.stderr);
    const em = readCsvRows(path.join(dir, "edge_missing.phases.csv"));
    check(
      "missing txt: only rep 2 row, prefill empty, decode takes window",
      em.length === 3 && em[1].split(",")[1] === "2" && em[1].split(",")[4] === "" &&
        em[1].split(",")[6] === "" && em[1].split(",")[7] === "1.200" &&
        em[1].split(",")[9] === "0.075" && em[1].split(",")[16] === "prefill segment has no samples",
      em[1],
    );

    // edge_empty: rep2's mark window holds no samples at all.
    const ee = readCsvRows(path.join(dir, "edge_empty.phases.csv"));
    check(
      "empty window: rep1 split normally",
      ee[1].split(",")[3] === "2.000" && ee[1].split(",")[6] === "1.000" && ee[1].split(",")[7] === "1.000" && ee[1].split(",")[9] === "0.063",
      ee[1],
    );
    check(
      "empty window: rep2 row keeps only what is true",
      ee[2].split(",")[2] === "100.00" && ee[2].split(",")[3] === "" && ee[2].split(",")[6] === "" &&
        ee[2].split(",")[14] === "0" && ee[2].split(",")[15] === "0" &&
        ee[2].split(",")[16] === "rep window has no samples",
      ee[2],
    );

    // edge_single: 1-sample window, boundary after the only sample.
    const es = readCsvRows(path.join(dir, "edge_single.phases.csv"))[1].split(",");
    check(
      "degenerate window: decode empty, warnings joined",
      es[3] === "0.000" && es[5] === "" && es[7] === "" && es[14] === "1" && es[15] === "0" &&
        es[16] === "decode segment has no samples; window has 1 sample(s); integration degenerate",
      readCsvRows(path.join(dir, "edge_single.phases.csv"))[1],
    );

    // ── 6. exit 1: nothing produced / unknown stem ────────────────────
    const lonely = run(["lonely"]);
    check("exit1: lonely stem (no marks, no txt) exits 1", lonely.status === 1, `status=${lonely.status}`);
    check("exit1: reason on stderr", lonely.stderr.includes("nothing produced") && lonely.stderr.includes("lonely: no .marks file"), lonely.stderr);
    const nope = run(["nope"]);
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
