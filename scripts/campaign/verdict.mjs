#!/usr/bin/env node
// T20C acceptance verdict, read from a finished run directory.
//
// Why this exists: until now the pass conditions lived only in PLAN.md prose
// and were counted by hand with grep at the end of a 96-minute run. That is
// where the counting trap bites -- the markers are JSON, so
// `grep 'window_align.*to:0'` reads 0 while `grep '"to":0'` reads 1 on the very
// same file. A verdict decided by remembering a quoting subtlety at 2am is not
// a verdict.
//
// Usage: node scripts/campaign/verdict.mjs <run-dir> [--turns N]
// Exit 0 = PASS, 1 = FAIL, 2 = could not read the run.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const EXPECTED_TURNS_DEFAULT = 20;

/** Parse the JSON payload that follows a marker on a logcat line. */
function payloadsFor(text, marker) {
  const out = [];
  for (const line of text.split("\n")) {
    const at = line.indexOf(marker);
    if (at === -1) continue;
    const brace = line.indexOf("{", at);
    if (brace === -1) continue;
    try {
      out.push(JSON.parse(line.slice(brace)));
    } catch {
      // A truncated logcat line is not a marker; count it nowhere rather than
      // guessing what it would have said.
    }
  }
  return out;
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function readRun(dir) {
  const logcat = join(dir, "logcat.txt");
  if (!existsSync(logcat)) throw new Error(`no logcat.txt in ${dir}`);
  const records = [];
  for (const arm of readdirSync(dir, { withFileTypes: true })) {
    if (!arm.isDirectory()) continue;
    for (const f of readdirSync(join(dir, arm.name))) {
      if (!f.endsWith(".jsonl")) continue;
      const text = readFileSync(join(dir, arm.name, f), "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          records.push(JSON.parse(line));
        } catch {
          /* a half-written final line is not a turn */
        }
      }
    }
  }
  return { logcat: readFileSync(logcat, "utf8"), records };
}

function evaluate(run, expectedTurns) {
  // Match the OUTER marker and filter on op: the payload brace precedes
  // "op":"window_align" on the line, so keying on the inner field finds no
  // object and silently reports zero aligns -- a vacuous PASS, which is the
  // exact failure this file exists to prevent. It happened while writing it.
  const aligns = payloadsFor(run.logcat, "KALSA_SESSION ").filter(
    (p) => p.op === "window_align",
  );
  const slides = payloadsFor(run.logcat, "KALSA_WINDOW_SLIDE ");
  const truncations = payloadsFor(run.logcat, "KALSA_ANSWER_TRUNCATED ");
  // The flag rides every KALSA_TELEMETRY line once the app emits it, so its
  // presence there — not the absence of the rarer marker — is what proves the
  // build could have reported a truncation at all.
  const instrumented = payloadsFor(run.logcat, "KALSA_TELEMETRY ").some(
    (t) => t.truncated !== undefined,
  );
  const alignsToZero = aligns.filter((a) => a.to === 0);

  // A skipped turn still writes a record; only a record carrying assistant text
  // and no recovery reason is a turn the model actually answered.
  const complete = run.records.filter((r) => r.assistant && !r.recovery);
  const recovered = run.records.filter((r) => r.recovery);

  const starts = slides.map((s) => s.newStart);
  const regressions = [];
  for (let i = 1; i < starts.length; i++) {
    if (starts[i] < starts[i - 1]) regressions.push(`${starts[i - 1]}->${starts[i]}`);
  }

  const checks = [
    {
      name: `all ${expectedTurns} turns answered`,
      pass: complete.length === expectedTurns,
      detail: `${complete.length}/${expectedTurns} complete, ${recovered.length} recovery, ${run.records.length} records`,
    },
    {
      name: "at most one window_align to 0",
      pass: alignsToZero.length <= 1,
      detail: `${alignsToZero.length} of ${aligns.length} aligns land on 0`,
    },
    {
      name: "slide boundaries never go backwards",
      pass: regressions.length === 0,
      detail: starts.length ? `${starts.join(" -> ")}` : "no slides",
    },
    {
      // A truncated answer means generation reached n_ctx and the K-shift was
      // refused: the turn returned something, but it is not the answer the
      // script asked for. The ceiling slide and the tool-round guard exist
      // precisely so this never happens, so one occurrence means a guard
      // failed and the run measured a mutilated conversation.
      //
      // "No occurrences" only counts when the build could have reported one.
      // A run recorded before the instrumentation landed cannot produce the
      // marker, and scoring that as PASS would be the vacuous pass this file
      // exists to refuse.
      name: instrumented
        ? "no answer was truncated at the context ceiling"
        : "truncation UNVERIFIABLE — build predates the instrumentation",
      pass: instrumented && truncations.length === 0,
      detail: !instrumented
        ? "no KALSA_TELEMETRY payload carries a truncated field"
        : truncations.length
          ? truncations
              .map((t) => `${t.turnId}/r${t.round} cached=${t.tokensCached}`)
              .join(", ")
          : "none",
    },
  ];

  const reported = {
    "window_reconcile": countOccurrences(run.logcat, "window_reconcile"),
    "KALSA_STALL": countOccurrences(run.logcat, "KALSA_STALL"),
    "model.unload idle": countOccurrences(run.logcat, '"reason":"idle"'),
    "slides advanced": slides.filter((s) => s.advanced).length,
    "slides that cleared KV": slides.filter((s) => s.kvCleared).length,
  };

  return { checks, reported, missing: expectedTurns - complete.length };
}

function main() {
  const args = process.argv.slice(2);
  const dir = args.find((a) => !a.startsWith("--"));
  if (!dir) {
    console.error("usage: node scripts/campaign/verdict.mjs <run-dir> [--turns N]");
    process.exit(2);
  }
  const turnsFlag = args.indexOf("--turns");
  const expectedTurns =
    turnsFlag === -1 ? EXPECTED_TURNS_DEFAULT : Number(args[turnsFlag + 1]);

  let run;
  try {
    run = readRun(dir);
  } catch (err) {
    console.error(`cannot read run: ${err.message}`);
    process.exit(2);
  }

  const { checks, reported, missing } = evaluate(run, expectedTurns);

  console.log(`T20C verdict for ${dir}\n`);
  for (const c of checks) {
    console.log(`  ${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`        ${c.detail}`);
  }
  console.log("\n  reported, not asserted:");
  for (const [k, v] of Object.entries(reported)) {
    console.log(`        ${k}: ${v}`);
  }
  if (reported["window_reconcile"] === 0) {
    console.log(
      "        (0 reconcile means held+unknown was never reached, so that\n" +
        "         path is unexercised -- it is not evidence that it works)",
    );
  }

  const failed = checks.filter((c) => !c.pass);
  console.log(
    `\n  ${failed.length === 0 ? "PASS" : `FAIL (${failed.length})`}` +
      (missing > 0 ? ` -- ${missing} turns never answered` : ""),
  );
  process.exit(failed.length === 0 ? 0 : 1);
}

main();
