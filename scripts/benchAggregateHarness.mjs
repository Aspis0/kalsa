#!/usr/bin/env node
/**
 * Offline harness for scripts/benchAggregate.mjs.
 *
 * Builds result.json trees in a temp dir, calls runAggregate / the
 * permutation test, and asserts completeness gate, per-family tables,
 * positive-control verdicts, prefill null-skipping, and schema-1 fallback.
 *
 * Zero npm deps. Exit 1 on any failure.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

// ── Fixture helpers ─────────────────────────────────────────────────────

function probe(name, family, found, turnIndex = 1) {
  return { name, family, turnIndex, expected: name, found };
}

function baseResult(overrides = {}) {
  return {
    schema: 2,
    phase: "fase4",
    arm: "baseline",
    seed: 1,
    blockFormat: "none",
    thinking: "budget256",
    compaction: "off",
    compactionPrefRaw: "0",
    compactionActive: false,
    turns: [
      {
        index: 1,
        kind: "plant",
        id: "plant_a",
        elapsed_s: 10,
        reply_len: 20,
        promptMs: 100,
        reuseFrac: 0.1,
        promptTokens: 800,
      },
      {
        index: 2,
        kind: "probe",
        id: "probe_facts",
        elapsed_s: 12,
        reply_len: 30,
        promptMs: 200,
        reuseFrac: 0.2,
        promptTokens: 900,
      },
    ],
    probes: [
      probe("fact_A", "fact_recall", true),
      probe("fact_B", "fact_recall", false),
      probe("tool_call", "tool_call", true),
    ],
    recall: 0.5,
    byFamily: {
      fact_recall: { found: 1, total: 2, rate: 0.5 },
      tool_call: { found: 1, total: 1, rate: 1 },
    },
    prefill: {
      meanPromptMs: 150,
      medianPromptMs: 150,
      meanReuseFrac: 0.15,
      meanPromptTokens: 850,
      turnsWithTelemetry: 2,
    },
    // post-31358530713 shape: no promptSha*; embd.size + on-device chars
    positiveControl: {
      promptTokensByTurn: { "1": 800, "2": 900 },
      reusedTokensByTurn: { "1": 0, "2": 100 },
      completionsByTurn: { "1": 1, "2": 1 },
      compactorChars: 0,
      summaryChars: 0,
    },
    notes: [],
    ...overrides,
  };
}

function writeResult(root, arm, seed, result) {
  const dir = path.join(root, `bench-result-fase4-${arm}-seed${seed}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "result.json"), JSON.stringify(result, null, 2));
  return dir;
}

/**
 * Full 2 arms × 3 seeds campaign.
 * identicalPrompts: same promptTokensByTurn on turns ≥ 2 AND zero compactorChars
 * on both arms → MEASURING NOTHING.
 * Default: differing turn-2 token counts → ARMS DIFFER.
 */
function writeCompleteCampaign(root, { v42Active = true, identicalPrompts = false } = {}) {
  for (const seed of [1, 2, 3]) {
    writeResult(
      root,
      "baseline",
      seed,
      baseResult({
        arm: "baseline",
        seed,
        compaction: "off",
        compactionActive: false,
        positiveControl: {
          promptTokensByTurn: {
            "1": 800,
            "2": identicalPrompts ? 900 : 900,
          },
          reusedTokensByTurn: { "1": 0, "2": 100 },
          completionsByTurn: { "1": 1, "2": 1 },
          compactorChars: 0,
          summaryChars: 0,
        },
        notes: seed === 1 ? ["baseline note seed1"] : [],
      }),
    );
    writeResult(
      root,
      "v42",
      seed,
      baseResult({
        arm: "v42",
        seed,
        compaction: "on",
        compactionPrefRaw: v42Active ? "1" : "0",
        compactionActive: v42Active,
        probes: [
          probe("fact_A", "fact_recall", true),
          probe("fact_B", "fact_recall", true),
          probe("tool_call", "tool_call", false),
          probe("miniapp", "miniapp", true),
          probe("language", "language", true),
          probe("honesty", "honesty", true),
        ],
        recall: 1,
        byFamily: {
          fact_recall: { found: 2, total: 2, rate: 1 },
          tool_call: { found: 0, total: 1, rate: 0 },
          miniapp: { found: 1, total: 1, rate: 1 },
          language: { found: 1, total: 1, rate: 1 },
          honesty: { found: 1, total: 1, rate: 1 },
        },
        positiveControl: {
          promptTokensByTurn: {
            "1": 800,
            // identical → same as baseline turn 2; else differ
            "2": identicalPrompts ? 900 : 950 + seed,
          },
          reusedTokensByTurn: { "1": 0, "2": 120 },
          completionsByTurn: { "1": 1, "2": 1 },
          // Only non-zero when arms actually differ via tokens; for identical
          // campaign leave 0 so MEASURING NOTHING fires.
          compactorChars: identicalPrompts ? 0 : 400 + seed,
          summaryChars: identicalPrompts ? 0 : 50,
        },
        notes: seed === 1 ? ["v42 note seed1"] : [],
      }),
    );
  }
}

function withEnv(envPatch, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(envPatch)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return fn();
  } finally {
    for (const [k, prev] of Object.entries(saved)) {
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const modPath = path.join(__dirname, "benchAggregate.mjs");
  const { runAggregate, permutationTestOneSided } = await import(
    pathToFileURL(modPath).href
  );

  const tmp = mkdtempSync(path.join(tmpdir(), "benchAggregate-"));
  console.log("temp dir:", tmp);

  try {
    // ── 1. Complete 2×3 fase4 campaign → tables, exit 0 ───────────────
    {
      const d = path.join(tmp, "complete");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d);
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check("complete 2×3 exits 0", exitCode === 0, `exitCode=${exitCode}`);
      check(
        "complete renders per-family table header",
        markdown.includes("| arm | family | rate | found/total | excluded | seeds |"),
      );
      check(
        "complete renders conversation-level primary",
        /Primary endpoint: fact recall, unit = conversation/i.test(markdown),
      );
      check(
        "complete renders probe-level NOT the gate",
        markdown.includes("probe-level, pseudo-replicated — NOT the gate"),
      );
      check(
        "complete renders prefill table",
        markdown.includes("mean prefill ms (promptMs)") ||
          markdown.includes("Prefill"),
      );
      // Honest labels: TTFT not "mean s/turn"; turn compute separate; no p.
      check(
        "complete renders mean TTFT s (UI, ±15 s) header",
        markdown.includes("mean TTFT s (UI, ±15 s)"),
      );
      check(
        "complete renders mean turn compute ms header",
        markdown.includes("mean turn compute ms (prefill+decode)"),
      );
      check(
        "prefill/TTFT table omits p-value (descriptive only)",
        !/mean TTFT[\s\S]{0,400}\|[^|\n]*p\s*\(/i.test(markdown) &&
          markdown.includes("no p-value"),
        "expected footnote saying no p-value near the timing table",
      );
      check(
        "complete renders ARMS DIFFER",
        markdown.includes("ARMS DIFFER"),
      );
      check(
        "complete has no INCOMPLETE block",
        !markdown.includes("## INCOMPLETE"),
      );
      check(
        "complete caveats passthrough",
        markdown.includes("Caveats") && markdown.includes("v42 note seed1"),
      );
      // 3 vs 3: exhaustive floor 2/21 ≈ 0.095 ≥ α=0.05 → underpowered line
      check(
        "complete 3vs3 shows underpowered design line",
        /UNDERPOWERED/i.test(markdown),
      );
    }

    // ── 2. Run-30863711482 shape: one arm, one seed → INCOMPLETE ──────
    {
      const d = path.join(tmp, "one-arm");
      mkdirSync(d, { recursive: true });
      writeResult(
        d,
        "v42",
        1,
        baseResult({
          arm: "v42",
          seed: 1,
          compaction: "on",
          compactionActive: true,
        }),
      );
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check("one-arm exits non-zero", exitCode !== 0, `exitCode=${exitCode}`);
      check("one-arm has ## INCOMPLETE", markdown.includes("## INCOMPLETE"));
      // 5 missing: baseline 1,2,3 + v42 2,3
      const missingBaseline = (markdown.match(/\| baseline \|/g) || []).length;
      const missingV42 = (markdown.match(/\| v42 \| [23] \|/g) || []).length;
      check(
        "one-arm lists 5 missing pairs (3 baseline + v42 seeds 2,3)",
        missingBaseline >= 3 && missingV42 >= 2,
        `baseline rows≈${missingBaseline} v42-2/3≈${missingV42}`,
      );
      check(
        "one-arm still renders partial data above gate",
        markdown.indexOf("## Fase 4") < markdown.indexOf("## INCOMPLETE"),
      );
    }

    // ── 3. compactionActive:false on v42 fails ────────────────────────
    {
      const d = path.join(tmp, "bad-compaction");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d, { v42Active: false });
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check("bad compaction exits non-zero", exitCode !== 0);
      check(
        "bad compaction mentions compactionActive",
        markdown.includes("compactionActive"),
      );
      check(
        "bad compaction names v42",
        /v42/.test(markdown) && markdown.includes("## INCOMPLETE"),
      );
    }

    // ── 4. Positive control: identical token counts vs differing ──────
    {
      const same = path.join(tmp, "same-prompt");
      mkdirSync(same, { recursive: true });
      writeCompleteCampaign(same, { identicalPrompts: true });
      const rSame = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([same]),
      );
      check(
        "identical token counts + zero compactor → MEASURING NOTHING",
        rSame.markdown.includes("MEASURING NOTHING"),
      );
      check("identical prompts exits non-zero", rSame.exitCode !== 0);

      const diff = path.join(tmp, "diff-prompt");
      mkdirSync(diff, { recursive: true });
      writeCompleteCampaign(diff, { identicalPrompts: false });
      const rDiff = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([diff]),
      );
      check(
        "differing turn-2 token counts → ARMS DIFFER",
        rDiff.markdown.includes("ARMS DIFFER"),
      );
      check(
        "differing token counts exits 0",
        rDiff.exitCode === 0,
        `exit=${rDiff.exitCode}`,
      );
    }

    // ── 5. Permutation test determinism + perfect separation ──────────
    {
      const a = [0, 0, 0, 0, 0, 0, 0, 0];
      const b = [1, 1, 1, 1, 1, 1, 1, 1];
      const r1 = permutationTestOneSided(a, b, 10_000, 42);
      const r2 = permutationTestOneSided(a, b, 10_000, 42);
      check("permutation p is deterministic", r1.p === r2.p, `p1=${r1.p} p2=${r2.p}`);
      check(
        "perfect separation yields small p",
        r1.p < 0.01,
        `p=${r1.p}`,
      );
      check("perfect separation observed Δ === 1", r1.observed === 1, `Δ=${r1.observed}`);
    }

    // ── 6. Prefill means skip nulls and report sample count ───────────
    {
      const d = path.join(tmp, "prefill-nulls");
      mkdirSync(d, { recursive: true });
      // Two baseline seeds with mixed null promptMs so mean is over non-null only.
      writeResult(
        d,
        "baseline",
        1,
        baseResult({
          arm: "baseline",
          seed: 1,
          turns: [
            {
              index: 1,
              kind: "plant",
              id: "p",
              elapsed_s: 10,
              ttftApprox_s: 10,
              turnComputeMs: 1000,
              reply_len: 1,
              promptMs: 100,
              reuseFrac: 0.5,
              promptTokens: 10,
            },
            {
              index: 2,
              kind: "probe",
              id: "q",
              elapsed_s: 20,
              ttftApprox_s: 20,
              turnComputeMs: null,
              reply_len: 1,
              promptMs: null,
              reuseFrac: null,
              promptTokens: null,
            },
          ],
          positiveControl: {
            promptTokensByTurn: { "1": 10, "2": 20 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      writeResult(
        d,
        "baseline",
        2,
        baseResult({
          arm: "baseline",
          seed: 2,
          turns: [
            {
              index: 1,
              kind: "plant",
              id: "p",
              elapsed_s: 30,
              ttftApprox_s: 30,
              turnComputeMs: 3000,
              reply_len: 1,
              promptMs: 300,
              reuseFrac: 0.1,
              promptTokens: 30,
            },
          ],
          positiveControl: {
            promptTokensByTurn: { "1": 30 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      // Pairing v42 seeds so completeness can pass if we disable gate; here we
      // only care about prefill numbers — set expect seeds 0.
      writeResult(
        d,
        "v42",
        1,
        baseResult({
          arm: "v42",
          seed: 1,
          compaction: "on",
          compactionActive: true,
          turns: [
            {
              index: 1,
              kind: "plant",
              id: "p",
              elapsed_s: 5,
              reply_len: 1,
              promptMs: null,
              reuseFrac: null,
              promptTokens: null,
            },
          ],
          positiveControl: {
            promptTokensByTurn: {},
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      const { markdown } = withEnv(
        { BENCH_EXPECT_SEEDS: "0", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      // baseline promptMs samples: 100, 300 → mean 200, n=2 (null skipped)
      check(
        "prefill mean promptMs skips nulls (n=2)",
        /baseline.*200\.0 \(n=2\)/.test(markdown.replace(/\n/g, " ")) ||
          markdown.includes("200.0 (n=2)"),
        `snippet around baseline:\n${markdown.split("\n").filter((l) => l.includes("baseline") || l.includes("promptMs") || l.includes("prefill")).join("\n")}`,
      );
      // turnComputeMs: 1000, null, 3000 → mean 2000, n=2
      check(
        "prefill mean turn compute ms skips nulls (n=2)",
        markdown.includes("2000.0 (n=2)"),
        `snippet:\n${markdown.split("\n").filter((l) => l.includes("baseline")).join("\n")}`,
      );
      check(
        "prefill does not invent 0.0 when only nulls (v42)",
        // v42 has no numeric prefill — either n=0 n/a or absent fake measurement
        !/\| v42 \| 0\.0 \(n=/.test(markdown),
      );
    }

    // ── 7. Schema-1 result (no family on probes) still aggregates ─────
    {
      const d = path.join(tmp, "schema1");
      mkdirSync(d, { recursive: true });
      const schema1 = {
        phase: "fase4",
        arm: "v42",
        seed: 1,
        blockFormat: "none",
        thinking: "budget256",
        compaction: "on",
        turns: [
          { index: "1", elapsed_s: 100, reply_len: 50 },
          { index: "2", elapsed_s: 90, reply_len: 40 },
        ],
        probes: [
          { name: "fact_Leopoldo", expected: "Leopoldo", found: false },
          { name: "fact_4500", expected: "4500", found: true },
        ],
        recall: 0.5,
        // no byFamily, no family field, no positiveControl, no notes
      };
      writeResult(d, "v42", 1, schema1);
      let threw = null;
      let markdown = "";
      let exitCode = 0;
      try {
        const r = withEnv(
          { BENCH_EXPECT_SEEDS: "0", BENCH_EXPECT_PHASE: "fase4" },
          () => runAggregate([d]),
        );
        markdown = r.markdown;
        exitCode = r.exitCode;
      } catch (err) {
        threw = err;
      }
      check("schema-1 does not throw", threw === null, threw ? String(threw) : "");
      check(
        "schema-1 pools probes under unknown family",
        markdown.includes("unknown"),
        `exit=${exitCode}`,
      );
    }

    // ── Prefill entirely absent → message, not 0.0 ────────────────────
    {
      const d = path.join(tmp, "no-prefill");
      mkdirSync(d, { recursive: true });
      writeResult(
        d,
        "baseline",
        1,
        baseResult({
          arm: "baseline",
          seed: 1,
          // No promptMs / TTFT / turnComputeMs — table must stay absent, not 0.0.
          turns: [{ index: 1, kind: "plant", id: "p", reply_len: 1 }],
          positiveControl: {
            promptTokensByTurn: {},
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      const { markdown } = withEnv(
        { BENCH_EXPECT_SEEDS: "0" },
        () => runAggregate([d]),
      );
      check(
        "no prefill data → absent message",
        /prefill telemetry is absent/i.test(markdown),
      );
    }

    // ── C1: conversation-unit p vs probe-unit p; 6vs6 not underpowered ─
    {
      // Same data, different units: conversation rates [0.5,0.5,0.5] vs [1,1,1]
      // probe outcomes: baseline 3×(1+0)= three 1s and three 0s; v42 six 1s
      // Those p-values must not be identical when printed as primary vs probe-level.
      const d = path.join(tmp, "units");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d);
      const { markdown } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      const primaryMatch = markdown.match(
        /Primary endpoint \(fact recall, unit = conversation\):[^]*?p = ([0-9.]+)/,
      );
      const probeMatch = markdown.match(
        /fact_recall \(probe-level[^|]*\|[^|]*\|[^|]*\|[^|]*\| ([0-9.]+)/,
      );
      check(
        "C1: primary conversation p is present",
        primaryMatch != null,
        `primaryMatch=${primaryMatch}`,
      );
      check(
        "C1: probe-level p is present",
        probeMatch != null,
        `probeMatch=${probeMatch}`,
      );
      if (primaryMatch && probeMatch) {
        check(
          "C1: conversation-unit p differs from probe-unit p on same data",
          primaryMatch[1] !== probeMatch[1],
          `conv=${primaryMatch[1]} probe=${probeMatch[1]}`,
        );
      }

      // 6 vs 6: write seeds 1..6, expect no UNDERPOWERED
      const d6 = path.join(tmp, "six");
      mkdirSync(d6, { recursive: true });
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        writeResult(
          d6,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            recall: 0.5,
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 900 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          d6,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            recall: 1,
            probes: [
              probe("fact_A", "fact_recall", true),
              probe("fact_B", "fact_recall", true),
            ],
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 950 + seed },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 100,
              summaryChars: 10,
            },
          }),
        );
      }
      const r6 = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d6]),
      );
      check(
        "C1: 6vs6 does NOT show underpowered line",
        !/UNDERPOWERED/i.test(r6.markdown),
      );
      check("C1: 6vs6 complete exits 0", r6.exitCode === 0, `exit=${r6.exitCode}`);
    }

    // ── C2: completeness hardening ────────────────────────────────────
    {
      // Duplicate (arm, seed)
      const dup = path.join(tmp, "dup");
      mkdirSync(dup, { recursive: true });
      writeCompleteCampaign(dup);
      // Second copy of baseline seed 1 under another artifact dir name
      const extra = path.join(dup, "bench-result-fase4-baseline-seed1-copy");
      mkdirSync(extra, { recursive: true });
      writeFileSync(
        path.join(extra, "result.json"),
        JSON.stringify(
          baseResult({ arm: "baseline", seed: 1, compactionActive: false }),
          null,
          2,
        ),
      );
      const rDup = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([dup]),
      );
      check("C2: duplicate pair fails", rDup.exitCode !== 0);
      check(
        "C2: duplicate listed in INCOMPLETE",
        /Duplicate/i.test(rDup.markdown),
      );

      // Zero-probe file
      const zp = path.join(tmp, "zeroprobe");
      mkdirSync(zp, { recursive: true });
      writeCompleteCampaign(zp);
      writeResult(
        zp,
        "baseline",
        1,
        baseResult({ arm: "baseline", seed: 1, probes: [], recall: null }),
      );
      // Overwrite by writing again — writeResult uses same path so we need a
      // full campaign with one zero-probe. Simpler: only two files, one empty.
      const zp2 = path.join(tmp, "zeroprobe2");
      mkdirSync(zp2, { recursive: true });
      writeResult(
        zp2,
        "baseline",
        1,
        baseResult({ arm: "baseline", seed: 1, probes: [] }),
      );
      writeResult(
        zp2,
        "v42",
        1,
        baseResult({
          arm: "v42",
          seed: 1,
          compaction: "on",
          compactionActive: true,
          probes: [probe("fact_A", "fact_recall", true)],
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 50,
            summaryChars: 0,
          },
        }),
      );
      // Differing turn-2 token counts so pos control can pass; expect 1 seed.
      writeResult(
        zp2,
        "baseline",
        1,
        baseResult({
          arm: "baseline",
          seed: 1,
          probes: [],
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      writeResult(
        zp2,
        "v42",
        1,
        baseResult({
          arm: "v42",
          seed: 1,
          compaction: "on",
          compactionActive: true,
          probes: [probe("fact_A", "fact_recall", true)],
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 250 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 50,
            summaryChars: 0,
          },
        }),
      );
      const rZp = withEnv(
        { BENCH_EXPECT_SEEDS: "1", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([zp2]),
      );
      check("C2: zero-probe file fails", rZp.exitCode !== 0);
      check(
        "C2: zero probes mentioned",
        /zero probes/i.test(rZp.markdown),
      );

      // Missing compactionActive on schema 2
      const miss = path.join(tmp, "miss-ca");
      mkdirSync(miss, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          miss,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        const v = baseResult({
          arm: "v42",
          seed,
          compaction: "on",
          compactionActive: true,
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 250 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 50,
            summaryChars: 0,
          },
        });
        delete v.compactionActive;
        writeResult(miss, "v42", seed, v);
      }
      const rMiss = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([miss]),
      );
      check(
        "C2: missing compactionActive on schema 2 fails",
        rMiss.exitCode !== 0 && /compactionActive missing/i.test(rMiss.markdown),
      );

      // Empty / garbage BENCH_EXPECT_SEEDS still gates with default 3
      const emptySeeds = path.join(tmp, "empty-seeds");
      mkdirSync(emptySeeds, { recursive: true });
      writeResult(
        emptySeeds,
        "v42",
        1,
        baseResult({ arm: "v42", seed: 1, compaction: "on", compactionActive: true }),
      );
      const rEmpty = withEnv(
        { BENCH_EXPECT_SEEDS: "", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([emptySeeds]),
      );
      check("C2: empty BENCH_EXPECT_SEEDS still gates", rEmpty.exitCode !== 0);
      check(
        "C2: empty seeds prints default used",
        /default n=3/i.test(rEmpty.markdown) || /BENCH_EXPECT_SEEDS/.test(rEmpty.markdown),
      );
      const rGarbage = withEnv(
        { BENCH_EXPECT_SEEDS: "nope", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([emptySeeds]),
      );
      check("C2: garbage BENCH_EXPECT_SEEDS still gates", rGarbage.exitCode !== 0);
    }

    // ── C3: positive control fail closed ──────────────────────────────
    {
      // Absent positive control in both arms
      const abs = path.join(tmp, "pos-absent");
      mkdirSync(abs, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          abs,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: null,
          }),
        );
        writeResult(
          abs,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            positiveControl: null,
          }),
        );
      }
      const rAbs = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([abs]),
      );
      check("C3: absent positive control fails", rAbs.exitCode !== 0);
      check(
        "C3: absent PC message",
        /positive control absent/i.test(rAbs.markdown),
      );

      // Turn-1-only overlap + zero compactor → insufficient
      const t1only = path.join(tmp, "t1only");
      mkdirSync(t1only, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          t1only,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          t1only,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            positiveControl: {
              promptTokensByTurn: { "1": 100 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
      }
      const rT1 = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([t1only]),
      );
      check("C3: turn-1-only overlap fails", rT1.exitCode !== 0);
      check(
        "C3: turn-1-only INSUFFICIENT verdict",
        /INSUFFICIENT/i.test(rT1.markdown) || /turn 1 only/i.test(rT1.markdown),
      );

      // Differing turn 2 (turn 1 same) → pass
      const t2diff = path.join(tmp, "t2diff");
      mkdirSync(t2diff, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          t2diff,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          t2diff,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 250 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
      }
      const rT2 = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([t2diff]),
      );
      check(
        "C3: differing turn 2 passes (ARMS DIFFER, exit 0)",
        rT2.exitCode === 0 && rT2.markdown.includes("ARMS DIFFER"),
        `exit=${rT2.exitCode}`,
      );

      // Equal token counts on turns ≥ 2, but compactorChars > 0 only on v42 → pass
      const viaComp = path.join(tmp, "via-compactor");
      mkdirSync(viaComp, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          viaComp,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          viaComp,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 777,
              summaryChars: 12,
            },
          }),
        );
      }
      const rComp = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([viaComp]),
      );
      check(
        "C3: equal tokens but v42 compactorChars>0 passes (ARMS DIFFER)",
        rComp.exitCode === 0 && rComp.markdown.includes("ARMS DIFFER"),
        `exit=${rComp.exitCode}\n${rComp.markdown.split("\n").filter((l) => /ARMS|MEASURING|compactor/i.test(l)).join("\n")}`,
      );

      // Equal tokens + zero compactor on both → MEASURING NOTHING
      const nothing = path.join(tmp, "measuring-nothing");
      mkdirSync(nothing, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          nothing,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          nothing,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
      }
      const rNothing = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([nothing]),
      );
      check(
        "C3: equal tokens + zero compactor → MEASURING NOTHING",
        rNothing.exitCode !== 0 &&
          rNothing.markdown.includes("MEASURING NOTHING"),
        `exit=${rNothing.exitCode}`,
      );
    }

    // ── early/late fact families: primary = mean; fall back to plain ──
    {
      // New layout: both arms have fact_recall_early + fact_recall_late.
      // Primary = mean(early, late) per conversation.
      // early rates equal (both pass); late: baseline 0, v42 1
      // → baseline mean 0.5, v42 mean 1.0.
      const d = path.join(tmp, "early-late");
      mkdirSync(d, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeResult(
          d,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            probes: [
              probe("fact_A_early", "fact_recall_early", true),
              probe("fact_B_early", "fact_recall_early", true),
              probe("fact_A_late", "fact_recall_late", false),
              probe("fact_B_late", "fact_recall_late", false),
            ],
            // mean(1.0, 0.0) = 0.5
            recall: 0.5,
            byFamily: {
              fact_recall_early: { found: 2, total: 2, rate: 1, excluded: 0 },
              fact_recall_late: { found: 0, total: 2, rate: 0, excluded: 0 },
            },
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 900 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              boundaryByTurn: { "1": null, "2": null },
              digestCharsByTurn: { "1": 0, "2": 0 },
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          d,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            probes: [
              probe("fact_A_early", "fact_recall_early", true),
              probe("fact_B_early", "fact_recall_early", true),
              probe("fact_A_late", "fact_recall_late", true),
              probe("fact_B_late", "fact_recall_late", true),
            ],
            // mean(1.0, 1.0) = 1.0
            recall: 1,
            byFamily: {
              fact_recall_early: { found: 2, total: 2, rate: 1, excluded: 0 },
              fact_recall_late: { found: 2, total: 2, rate: 1, excluded: 0 },
            },
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 950 + seed },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              boundaryByTurn: { "1": 0, "2": 12 },
              digestCharsByTurn: { "1": 0, "2": 40 + seed },
              compactorChars: 100,
              summaryChars: 10,
            },
          }),
        );
      }
      const r = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check(
        "early/late: both families appear in per-family table",
        r.markdown.includes("fact_recall_early") &&
          r.markdown.includes("fact_recall_late"),
      );
      check(
        "early/late: decay-curve one-liner (mean is primary)",
        /decay curve/i.test(r.markdown) &&
          /per-conversation mean/i.test(r.markdown),
      );
      check(
        "early/late: no single-family PRIMARY mark on early or late",
        !/fact_recall_late \*\*\(PRIMARY\)\*\*/.test(r.markdown) &&
          !/fact_recall_early \*\*\(PRIMARY\)\*\*/.test(r.markdown),
      );
      check(
        "early/late: primary endpoint names mean(early, late)",
        /Primary endpoint: `mean\(fact_recall_early, fact_recall_late\)`/.test(
          r.markdown,
        ),
      );
      check(
        "early/late: trajectory table present with boundaryIndex",
        r.markdown.includes("Compactor state trajectory") &&
          r.markdown.includes("boundaryIndex") &&
          r.markdown.includes("digestChars"),
      );
      // Baseline mean 0.5, v42 mean 1.0 → gate can meet if p ok
      check(
        "early/late: primary uses mean (v42 1.0 > baseline 0.5)",
        /v42 \(1(?:\.0+)?\)/.test(r.markdown) &&
          /baseline \(0\.5/.test(r.markdown),
        `snippet: ${r.markdown.match(/baseline mean[\s\S]{0,200}/)?.[0] ?? r.markdown.slice(0, 400)}`,
      );

      // Older artifacts: only plain fact_recall → primary falls back.
      const legacy = path.join(tmp, "legacy-fact");
      mkdirSync(legacy, { recursive: true });
      writeCompleteCampaign(legacy);
      const rLeg = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([legacy]),
      );
      check(
        "legacy fact_recall still PRIMARY when early/late absent",
        /fact_recall \*\*\(PRIMARY\)\*\*/.test(rLeg.markdown) &&
          !rLeg.markdown.includes("fact_recall_late"),
      );
    }

    // ── null probe outcomes excluded from family rates + permutations ─
    {
      const d = path.join(tmp, "null-exclude");
      mkdirSync(d, { recursive: true });
      // baseline seed 1: 2 scored facts (1 found) + 2 null (empty reply)
      writeResult(
        d,
        "baseline",
        1,
        baseResult({
          arm: "baseline",
          seed: 1,
          probes: [
            probe("fact_A", "fact_recall", true),
            probe("fact_B", "fact_recall", false),
            probe("fact_C", "fact_recall", null),
            probe("fact_D", "fact_recall", null),
          ],
          recall: 0.5,
          byFamily: {
            fact_recall: { found: 1, total: 2, rate: 0.5, excluded: 2 },
          },
          emptyReplyTurns: [11],
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            boundaryByTurn: { "1": null, "2": null },
            digestCharsByTurn: { "1": 0, "2": 0 },
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      // Need a full campaign for the gate; fill remaining pairs with complete.
      for (const seed of [2, 3]) {
        writeResult(
          d,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 200 },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              boundaryByTurn: { "1": null, "2": null },
              digestCharsByTurn: { "1": 0, "2": 0 },
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
      }
      for (const seed of [1, 2, 3]) {
        writeResult(
          d,
          "v42",
          seed,
          baseResult({
            arm: "v42",
            seed,
            compaction: "on",
            compactionActive: true,
            probes: [
              probe("fact_A", "fact_recall", true),
              probe("fact_B", "fact_recall", true),
            ],
            recall: 1,
            byFamily: {
              fact_recall: { found: 2, total: 2, rate: 1, excluded: 0 },
            },
            positiveControl: {
              promptTokensByTurn: { "1": 100, "2": 250 + seed },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              boundaryByTurn: { "1": 0, "2": 8 },
              digestCharsByTurn: { "1": 0, "2": 30 },
              compactorChars: 50,
              summaryChars: 5,
            },
          }),
        );
      }
      const r = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      // baseline seed1: 1/2 scored + 2 excluded; seeds 2,3 default 1/2 → found 1+1+1=3, total 2+2+2=6, excluded 2
      check(
        "null outcomes: excluded count shown in family table",
        /fact_recall[^|]*\|[^|]*\|[^|]*\|[^|]*\| 2 \|/.test(r.markdown) ||
          r.markdown.includes("| 2 |"), // excluded column
        `markdown family section: ${r.markdown.match(/Per-family[\s\S]{0,600}/)?.[0] ?? "?"}`,
      );
    }

    // ── contextFullTurns / errorTurns caveats ─────────────────────────
    {
      const d = path.join(tmp, "product-signals");
      mkdirSync(d, { recursive: true });
      writeResult(
        d,
        "baseline",
        1,
        baseResult({
          arm: "baseline",
          seed: 1,
          contextFullTurns: [9, 12],
          errorTurns: [13],
          notes: [],
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 0,
            summaryChars: 0,
          },
        }),
      );
      writeResult(
        d,
        "v42",
        1,
        baseResult({
          arm: "v42",
          seed: 1,
          compaction: "on",
          compactionActive: true,
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 250 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 50,
            summaryChars: 0,
          },
        }),
      );
      const { markdown } = withEnv(
        { BENCH_EXPECT_SEEDS: "0", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check(
        "caveat line for contextFullTurns",
        /contextFullTurns \[9, 12\]/.test(markdown) ||
          /contextFullTurns/.test(markdown),
        `snippet:\n${markdown.split("\n").filter((l) => /context|Caveat|error/i.test(l)).join("\n")}`,
      );
      check(
        "caveat line for errorTurns",
        /errorTurns \[13\]/.test(markdown) || /errorTurns/.test(markdown),
      );
    }
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

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
