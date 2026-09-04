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

function selectionProbe(found, callCount) {
  return {
    name: "tool_selection",
    family: "tool_selection",
    turnIndex: callCount,
    expected: "web_search",
    found,
    callCount,
    noCall: callCount === 0,
  };
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
    // Mode string contract: "off" | "anchored" | "ciswire" (not boolean).
    compactionActive: "off",
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
 * Full 3 modes × seeds campaign (baseline/off, anchored, ciswire).
 * identicalPrompts: same promptTokensByTurn on turns ≥ 2 AND zero mechanism
 * (digest/boundary) on treatment arms → MEASURING NOTHING for both pairs.
 * identicalCiswire: ciswire matches baseline while anchored still differs → primary
 * pair fails even if secondary passes.
 * Default: treatment digest/boundary present → ARMS DIFFER on both pairs.
 * (Token divergence alone is generation noise and does not pass the gate.)
 */
function writeCompleteCampaign(
  root,
  {
    anchoredActive = true,
    ciswireActive = true,
    identicalPrompts = false,
    identicalCiswire = false,
    seeds = [1, 2, 3],
    // Observed gate on baseline. "omit" → old artifact (no toolGateActive).
    baselineToolGate = true,
  } = {},
) {
  for (const seed of seeds) {
    writeResult(
      root,
      "baseline",
      seed,
      baseResult({
        arm: "baseline",
        seed,
        compaction: "off",
        compactionPrefRaw: "0",
        compactionActive: "off",
        ...(baselineToolGate === "omit" ? {} : { toolGateActive: baselineToolGate }),
        positiveControl: {
          promptTokensByTurn: {
            "1": 800,
            "2": 900,
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
      "anchored",
      seed,
      baseResult({
        arm: "anchored",
        seed,
        compaction: "anchored",
        compactionPrefRaw: anchoredActive ? "anchored" : "0",
        // Wrong mode string when anchoredActive=false → invalidCompaction gate.
        compactionActive: anchoredActive ? "anchored" : "off",
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
            "2": identicalPrompts ? 900 : 950 + seed,
          },
          reusedTokensByTurn: { "1": 0, "2": 120 },
          completionsByTurn: { "1": 1, "2": 1 },
          // Mechanism evidence (token divergence alone is generation noise).
          digestCharsByTurn: identicalPrompts
            ? { "1": 0, "2": 0 }
            : { "1": 0, "2": 40 + seed },
          boundaryByTurn: identicalPrompts
            ? { "1": 0, "2": 0 }
            : { "1": 0, "2": 8 },
          compactorChars: identicalPrompts ? 0 : 400 + seed,
          summaryChars: identicalPrompts ? 0 : 50,
        },
        notes: seed === 1 ? ["anchored note seed1"] : [],
      }),
    );
    const cisSame = identicalPrompts || identicalCiswire;
    writeResult(
      root,
      "ciswire",
      seed,
      baseResult({
        arm: "ciswire",
        seed,
        compaction: "ciswire",
        compactionPrefRaw: ciswireActive ? "ciswire" : "0",
        compactionActive: ciswireActive ? "ciswire" : "off",
        probes: [
          probe("fact_A", "fact_recall", true),
          probe("fact_B", "fact_recall", true),
          probe("tool_call", "tool_call", true),
          probe("miniapp", "miniapp", true),
          probe("language", "language", true),
          probe("honesty", "honesty", true),
        ],
        recall: 1,
        byFamily: {
          fact_recall: { found: 2, total: 2, rate: 1 },
          tool_call: { found: 1, total: 1, rate: 1 },
          miniapp: { found: 1, total: 1, rate: 1 },
          language: { found: 1, total: 1, rate: 1 },
          honesty: { found: 1, total: 1, rate: 1 },
        },
        positiveControl: {
          promptTokensByTurn: {
            "1": 800,
            // Differ from baseline unless the identical-ciswire control is on.
            "2": cisSame ? 900 : 970 + seed,
          },
          reusedTokensByTurn: { "1": 0, "2": 130 },
          completionsByTurn: { "1": 1, "2": 1 },
          // ciswire: only digest is valid mechanism evidence.
          digestCharsByTurn: cisSame
            ? { "1": 0, "2": 0 }
            : { "1": 0, "2": 50 + seed },
          boundaryByTurn: cisSame
            ? { "1": 0, "2": 0 }
            : { "1": 0, "2": 10 },
          compactorChars: cisSame ? 0 : 500 + seed,
          summaryChars: cisSame ? 0 : 40,
        },
        notes: seed === 1 ? ["ciswire note seed1"] : [],
      }),
    );
  }
}

/** Exploratory gate-off arm (compaction off, same cell as baseline). */
function writeNogateArms(root, seeds, extra = {}) {
  const { omitToolGate, toolGateActive, ...timing } = extra;
  for (const seed of seeds) {
    writeResult(
      root,
      "nogate",
      seed,
      baseResult({
        arm: "nogate",
        seed,
        compaction: "off",
        compactionPrefRaw: "0",
        compactionActive: "off",
        toolgate: "0",
        ...(omitToolGate
          ? {}
          : { toolGateActive: toolGateActive ?? false }),
        toolPrecision: timing.toolPrecision ?? 0.25,
        toolRecall: timing.toolRecall ?? 1,
        spuriousCalls: timing.spuriousCalls ?? 3,
        missedCalls: timing.missedCalls ?? 0,
        privacyBlocks: timing.privacyBlocks ?? 1,
        positiveControl: {
          promptTokensByTurn: { "1": 800, "2": 900 },
          reusedTokensByTurn: { "1": 0, "2": 100 },
          completionsByTurn: { "1": 1, "2": 1 },
          compactorChars: 0,
          summaryChars: 0,
        },
      }),
    );
  }
}

/** nA/nB from the primary pairwise row (ciswire vs off | yes |). */
function primaryPairNs(markdown) {
  // Assert column ORDER: find the header row and verify treatment-first order
  // Header: | comparison | primary? | mean treatment | mean control | Δ | p (raw) | p (Holm) | n treatment | n control | design floor | method |
  const headerRow = markdown
    .split("\n")
    .find((l) => l.includes("mean treatment") && l.includes("mean control"));
  if (headerRow) {
    const headerCells = headerRow
      .split("|")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    // Treatment (index 2) must come before control (index 3)
    if (!headerCells[2]?.includes("treatment") || !headerCells[3]?.includes("control")) {
      throw new Error(`primaryPairNs: header column order wrong - expected treatment-first at [2],[3], got [${headerCells[2]}] [${headerCells[3]}]`);
    }
    // n treatment (index 7) must come before n control (index 8)
    if (!headerCells[7]?.includes("treatment") || !headerCells[8]?.includes("control")) {
      throw new Error(`primaryPairNs: n-column order wrong - expected [n treatment] [n control] at [7],[8], got [${headerCells[7]}] [${headerCells[8]}]`);
    }
  }

  const row = markdown
    .split("\n")
    .find((l) => l.includes("ciswire vs off") && l.includes("| yes |"));
  if (!row) return null;
  const cells = row
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // After treatment-first reorder:
  // [0]=label, [1]=yes, [2]=mean treatment, [3]=mean control, [4]=Δ, [5]=p, [6]=pHolm, [7]=n treatment, [8]=n control, [9]=floor, [10]=method
  return { nA: cells[8], nB: cells[7] };
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
    // ── Tools selection is conditional on making a call ────────────────
    {
      const cases = [
        {
          name: "3 no-calls",
          probes: [selectionProbe(false, 0), selectionProbe(false, 0), selectionProbe(false, 0)],
          expected: "| baseline | n/a (0/0) | n/a (0/0) | n/a (0/0) | 3 | 1 |",
        },
        {
          name: "2 correct, 1 wrong",
          probes: [selectionProbe(true, 1), selectionProbe(true, 1), selectionProbe(false, 1)],
          expected: "| baseline | n/a (0/0) | n/a (0/0) | 0.667 (2/3) | 0 | 1 |",
        },
        {
          name: "1 correct, 1 wrong, 1 no-call",
          probes: [selectionProbe(true, 1), selectionProbe(false, 1), selectionProbe(false, 0)],
          expected: "| baseline | n/a (0/0) | n/a (0/0) | 0.500 (1/2) | 1 | 1 |",
        },
      ];
      for (const [i, c] of cases.entries()) {
        const d = path.join(tmp, `tools-selection-${i}`);
        mkdirSync(d, { recursive: true });
        writeResult(d, "baseline", 1, baseResult({
          phase: "tools",
          probes: c.probes,
        }));
        const { markdown } = runAggregate([d]);
        check(`${c.name}: tools table`, markdown.includes(c.expected), markdown);
      }
    }

    // ── 1. Complete 3 modes × 3 seeds fase4 campaign → tables, exit 0 ─
    {
      const d = path.join(tmp, "complete");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d);
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check("complete 3×3 exits 0", exitCode === 0, `exitCode=${exitCode}`);
      check(
        "complete renders per-family table header",
        markdown.includes("| arm | family | rate | found/total | excluded | seeds |"),
      );
      check(
        "complete renders conversation-level primary",
        /fact recall, unit = conversation/i.test(markdown) ||
          /Pairwise tests: fact recall/i.test(markdown),
      );
      check(
        "complete renders probe-level NOT the gate",
        markdown.includes("probe-level, pseudo-replicated — NOT the gate"),
      );
      check(
        "complete family tables include ciswire primary pair",
        /ciswire vs off/i.test(markdown),
      );
      check(
        "complete renders prefill table",
        markdown.includes("mean prefill ms (promptMs)") ||
          markdown.includes("Prefill"),
      );
      // reuseFrac was computed and silently dropped from the table until
      // 2026-08-21 — the campaign could not answer its own central question
      // (does the anchored window keep the KV cache) without hand-deriving it
      // from raw artifacts. Assert it renders so it cannot vanish again.
      check(
        "complete renders KV reuse header",
        markdown.includes("mean KV reuse (reuseFrac)"),
      );
      check(
        "complete renders the reuseFrac value, not just the header",
        /0\.150 \(n=\d+\)/.test(markdown),
      );
      check(
        "complete renders mean prompt tokens header",
        markdown.includes("mean prompt tokens"),
      );
      check(
        "reuseFrac note warns the mean is a hit rate on LFM2",
        markdown.includes("hit RATE, not a fraction of a prompt"),
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
        markdown.includes("Caveats") && markdown.includes("anchored note seed1"),
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
        "anchored",
        1,
        baseResult({
          arm: "anchored",
          seed: 1,
          compaction: "anchored",
          compactionActive: "anchored",
          compactionPrefRaw: "anchored",
        }),
      );
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check("one-arm exits non-zero", exitCode !== 0, `exitCode=${exitCode}`);
      check("one-arm has ## INCOMPLETE", markdown.includes("## INCOMPLETE"));
      // Missing modes: off 1..3, anchored 2..3, ciswire 1..3 (table uses mode names).
      const missingOff = (markdown.match(/\| off \|/g) || []).length;
      const missingAnchored = (markdown.match(/\| anchored \|/g) || []).length;
      const missingCis = (markdown.match(/\| ciswire \|/g) || []).length;
      check(
        "one-arm lists missing pairs across 3 modes",
        missingOff >= 3 && missingAnchored >= 2 && missingCis >= 3,
        `off≈${missingOff} anchored≈${missingAnchored} ciswire≈${missingCis}`,
      );
      check(
        "one-arm still renders partial data above gate",
        markdown.indexOf("## Fase 4") < markdown.indexOf("## INCOMPLETE"),
      );
    }

    // ── 3. compactionActive:false on anchored fails ────────────────────────
    {
      const d = path.join(tmp, "bad-compaction");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d, { anchoredActive: false });
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
        "bad compaction names anchored",
        /anchored/.test(markdown) && markdown.includes("## INCOMPLETE"),
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
      // Pairing anchored seeds so completeness can pass if we disable gate; here we
      // only care about prefill numbers — set expect seeds 0.
      writeResult(
        d,
        "anchored",
        1,
        baseResult({
          arm: "anchored",
          seed: 1,
          compaction: "anchored",
          compactionActive: "anchored",
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
        "prefill does not invent 0.0 when only nulls (anchored)",
        // anchored has no numeric prefill — either n=0 n/a or absent fake measurement
        !/\| anchored \| 0\.0 \(n=/.test(markdown),
      );
    }

    // ── 7. Schema-1 result (no family on probes) still aggregates ─────
    {
      const d = path.join(tmp, "schema1");
      mkdirSync(d, { recursive: true });
      const schema1 = {
        phase: "fase4",
        arm: "anchored",
        seed: 1,
        blockFormat: "none",
        thinking: "budget256",
        compaction: "anchored",
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
      writeResult(d, "anchored", 1, schema1);
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
      // probe outcomes: baseline 3×(1+0)= three 1s and three 0s; anchored six 1s
      // Those p-values must not be identical when printed as primary vs probe-level.
      const d = path.join(tmp, "units");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d);
      const { markdown } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      // Pairwise table: p (raw) is the 6th pipe cell on the primary row.
      const primaryRow = markdown
        .split("\n")
        .find((l) => l.includes("ciswire vs off") && l.includes("| yes |"));
      const primaryMatch = primaryRow
        ? primaryRow.match(
            /\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\| ([0-9.]+) \|/,
          )
        : null;
      const probeMatch = markdown.match(
        /fact_recall \(probe-level[^|]*\|[^|]*\|[^|]*\|[^|]*\| ([0-9.]+)/,
      );
      check(
        "C1: primary conversation p is present",
        primaryMatch != null,
        `primaryMatch=${primaryMatch} row=${primaryRow ?? "?"}`,
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

      // 6 vs 6 × 3 modes: write seeds 1..6, expect no UNDERPOWERED
      const d6 = path.join(tmp, "six");
      mkdirSync(d6, { recursive: true });
      writeCompleteCampaign(d6, { seeds: [1, 2, 3, 4, 5, 6] });
      const r6 = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d6]),
      );
      check(
        "C1: 6vs6 does NOT show underpowered line",
        !/UNDERPOWERED/i.test(r6.markdown),
      );
      check("C1: 6vs6 complete exits 0", r6.exitCode === 0, `exit=${r6.exitCode}`);
      check(
        "C1: 6vs6 method label is exact enumeration",
        /exact \(\d+ assignments\)/.test(r6.markdown),
        `snippet: ${(r6.markdown.match(/ciswire vs off[^\n]*/)?.[0] ?? "").slice(0, 200)}`,
      );
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
          baseResult({ arm: "baseline", seed: 1, compactionActive: "off" }),
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
        "anchored",
        1,
        baseResult({
          arm: "anchored",
          seed: 1,
          compaction: "anchored",
          compactionActive: "anchored",
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
        "anchored",
        1,
        baseResult({
          arm: "anchored",
          seed: 1,
          compaction: "anchored",
          compactionActive: "anchored",
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
          arm: "anchored",
          seed,
          compaction: "anchored",
          compactionActive: "anchored",
          positiveControl: {
            promptTokensByTurn: { "1": 100, "2": 250 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 50,
            summaryChars: 0,
          },
        });
        delete v.compactionActive;
        writeResult(miss, "anchored", seed, v);
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
        "anchored",
        1,
        baseResult({ arm: "anchored", seed: 1, compaction: "anchored", compactionActive: "anchored" }),
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

    // ── C3: positive control fail closed (3 modes) ───────────────────
    {
      const writeTriplet = (root, seed, { basePc, anchoredPc, cisPc, extra = {} }) => {
        writeResult(
          root,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            compactionActive: "off",
            positiveControl: basePc,
            ...extra.baseline,
          }),
        );
        writeResult(
          root,
          "anchored",
          seed,
          baseResult({
            arm: "anchored",
            seed,
            compaction: "anchored",
            compactionPrefRaw: "anchored",
            compactionActive: "anchored",
            positiveControl: anchoredPc,
            ...extra.anchored,
          }),
        );
        writeResult(
          root,
          "ciswire",
          seed,
          baseResult({
            arm: "ciswire",
            seed,
            compaction: "ciswire",
            compactionPrefRaw: "ciswire",
            compactionActive: "ciswire",
            positiveControl: cisPc,
            probes: [
              probe("fact_A", "fact_recall", true),
              probe("fact_B", "fact_recall", true),
            ],
            recall: 1,
            byFamily: {
              fact_recall: { found: 2, total: 2, rate: 1 },
            },
            ...extra.ciswire,
          }),
        );
      };

      // Absent positive control on all arms
      const abs = path.join(tmp, "pos-absent");
      mkdirSync(abs, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(abs, seed, {
          basePc: null,
          anchoredPc: null,
          cisPc: null,
        });
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
        const pc = {
          promptTokensByTurn: { "1": 100 },
          reusedTokensByTurn: {},
          completionsByTurn: {},
          compactorChars: 0,
          summaryChars: 0,
        };
        writeTriplet(t1only, seed, { basePc: pc, anchoredPc: pc, cisPc: pc });
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

      // Real mechanism on both treatments (anchored boundary / ciswire digest) → pass. Token divergence
      // alone is generation noise and is covered by the fail scenarios below.
      const t2diff = path.join(tmp, "t2diff");
      mkdirSync(t2diff, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(t2diff, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            boundaryByTurn: { "1": null, "2": null },
            compactorChars: 0,
            summaryChars: 0,
          },
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 250 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 40 },
            boundaryByTurn: { "1": 0, "2": 8 },
            compactorChars: 0,
            summaryChars: 0,
          },
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 260 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 55 },
            boundaryByTurn: { "1": 0, "2": 0 },
            compactorChars: 0,
            summaryChars: 0,
          },
        });
      }
      const rT2 = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([t2diff]),
      );
      check(
        "C3: real mechanism (digest) passes (ARMS DIFFER, exit 0)",
        rT2.exitCode === 0 && rT2.markdown.includes("ARMS DIFFER"),
        `exit=${rT2.exitCode}`,
      );

      // Equal token counts on turns ≥ 2, but treatment boundaryByTurn > 0 → pass
      // (real anchored signal; hollow compactorChars alone must NOT pass — see hollow-compactor)
      const viaDigest = path.join(tmp, "via-digest");
      mkdirSync(viaDigest, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(viaDigest, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            compactorChars: 0,
            summaryChars: 0,
          },
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            boundaryByTurn: { "1": 0, "2": 8 },
            compactorChars: 777,
            summaryChars: 12,
          },
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 55 },
            compactorChars: 888,
            summaryChars: 12,
          },
        });
      }
      const rDigest = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([viaDigest]),
      );
      check(
        "C3: equal tokens but anchored boundaryByTurn>0 passes (ARMS DIFFER)",
        rDigest.exitCode === 0 && rDigest.markdown.includes("ARMS DIFFER"),
        `exit=${rDigest.exitCode}\n${rDigest.markdown.split("\n").filter((l) => /ARMS|MEASURING|compactor|digest/i.test(l)).join("\n")}`,
      );

      // Hollow evidence: identical prompt tokens, compactorChars>0 (serialized
      // state present), digestCharsByTurn all zero → MEASURING NOTHING / exit 1.
      // Pre-fix, scorePositivePair treated compactorChars alone as ARMS DIFFER.
      // 3 modes × 6 seeds = 18 gated files.
      const hollow = path.join(tmp, "hollow-compactor");
      mkdirSync(hollow, { recursive: true });
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        writeTriplet(hollow, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            boundaryByTurn: { "1": null, "2": null },
            compactorChars: 0,
            summaryChars: 0,
          },
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            boundaryByTurn: { "1": 0, "2": 0 },
            compactorChars: 100,
            summaryChars: 0,
          },
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 200 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0 },
            boundaryByTurn: { "1": 0, "2": 0 },
            compactorChars: 120,
            summaryChars: 0,
          },
        });
      }
      const rHollow = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([hollow]),
      );
      check(
        "C3: hollow compactorChars (digest all 0, tokens identical) fails gate",
        rHollow.exitCode !== 0 &&
          rHollow.markdown.includes("MEASURING NOTHING"),
        `exit=${rHollow.exitCode}\n${rHollow.markdown.split("\n").filter((l) => /ARMS|MEASURING|positive control/i.test(l)).join("\n")}`,
      );

      // Scenario 1: ciswire boundary advanced, digest all 0, tokens DIFFER
      // (generation noise). Boundary is NOT valid ciswire evidence → fail.
      // Pre-fix this passed green via different > 0.
      const cisBoundOnly = path.join(tmp, "ciswire-boundary-no-digest");
      mkdirSync(cisBoundOnly, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(cisBoundOnly, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200, "3": 300 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": null, "2": null, "3": null },
            compactorChars: 0,
            summaryChars: 0,
          },
          // anchored has a real boundary so its pair can pass; ciswire is the defect case.
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 250, "3": 350 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 40, "3": 40 },
            boundaryByTurn: { "1": 0, "2": 8, "3": 10 },
            compactorChars: 96,
            summaryChars: 0,
          },
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 260, "3": 360 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": 0, "2": 8, "3": 12 },
            compactorChars: 96,
            summaryChars: 0,
          },
        });
      }
      const rCisBound = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([cisBoundOnly]),
      );
      check(
        "C3: ciswire boundary-only (no digest) fails despite token noise",
        rCisBound.exitCode !== 0 &&
          rCisBound.markdown.includes("MEASURING NOTHING"),
        `exit=${rCisBound.exitCode}\n${rCisBound.markdown.split("\n").filter((l) => /ARMS|MEASURING|positive control|baseline↔ciswire/i.test(l)).join("\n")}`,
      );

      // Scenario 2: anchored with neither digest nor boundary advance; tokens differ
      // → fail (generation noise is not mechanism).
      const anchoredNoMech = path.join(tmp, "anchored-no-mechanism");
      mkdirSync(anchoredNoMech, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(anchoredNoMech, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200, "3": 300 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": null, "2": null, "3": null },
            compactorChars: 0,
            summaryChars: 0,
          },
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 250, "3": 350 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": 0, "2": 0, "3": 0 },
            compactorChars: 96,
            summaryChars: 0,
          },
          // ciswire has digest so primary can pass; anchored pair is the defect.
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 260, "3": 360 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 55, "3": 55 },
            boundaryByTurn: { "1": 0, "2": 0, "3": 0 },
            compactorChars: 96,
            summaryChars: 0,
          },
        });
      }
      const rAnchoredNo = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([anchoredNoMech]),
      );
      check(
        "C3: anchored neither digest nor boundary fails despite token noise",
        rAnchoredNo.exitCode !== 0 &&
        rAnchoredNo.markdown.includes("MEASURING NOTHING"),
        `exit=${rAnchoredNo.exitCode}\n${rAnchoredNo.markdown.split("\n").filter((l) => /ARMS|MEASURING|positive control|baseline↔anchored/i.test(l)).join("\n")}`,
      );

      // Scenario 3: anchored advanced boundary, no digest — legitimate truncation.
      const anchoredBound = path.join(tmp, "anchored-boundary-no-digest");
      mkdirSync(anchoredBound, { recursive: true });
      for (const seed of [1, 2, 3]) {
        writeTriplet(anchoredBound, seed, {
          basePc: {
            promptTokensByTurn: { "1": 100, "2": 200, "3": 300 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": null, "2": null, "3": null },
            compactorChars: 0,
            summaryChars: 0,
          },
          anchoredPc: {
            promptTokensByTurn: { "1": 100, "2": 250, "3": 350 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 0, "3": 0 },
            boundaryByTurn: { "1": 0, "2": 8, "3": 12 },
            compactorChars: 96,
            summaryChars: 0,
          },
          cisPc: {
            promptTokensByTurn: { "1": 100, "2": 260, "3": 360 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            digestCharsByTurn: { "1": 0, "2": 55, "3": 55 },
            boundaryByTurn: { "1": 0, "2": 0, "3": 0 },
            compactorChars: 96,
            summaryChars: 0,
          },
        });
      }
      const rAnchoredBound = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([anchoredBound]),
      );
      check(
        "C3: anchored boundary advance (no digest) is legitimate ARMS DIFFER",
        rAnchoredBound.exitCode === 0 &&
          rAnchoredBound.markdown.includes("ARMS DIFFER"),
        `exit=${rAnchoredBound.exitCode}`,
      );

      // Equal tokens + zero compactor on all arms → MEASURING NOTHING
      const nothing = path.join(tmp, "measuring-nothing");
      mkdirSync(nothing, { recursive: true });
      for (const seed of [1, 2, 3]) {
        const pc = {
          promptTokensByTurn: { "1": 100, "2": 200 },
          reusedTokensByTurn: {},
          completionsByTurn: {},
          compactorChars: 0,
          summaryChars: 0,
        };
        writeTriplet(nothing, seed, { basePc: pc, anchoredPc: pc, cisPc: pc });
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

      // Primary pair identical (ciswire==baseline) while anchored still differs → fail
      const cisSame = path.join(tmp, "ciswire-identical");
      mkdirSync(cisSame, { recursive: true });
      writeCompleteCampaign(cisSame, { identicalCiswire: true });
      const rCisSame = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([cisSame]),
      );
      check(
        "C3: identical ciswire vs baseline fails gate",
        rCisSame.exitCode !== 0 &&
          (/MEASURING NOTHING/i.test(rCisSame.markdown) ||
            /primary pair/i.test(rCisSame.markdown)),
        `exit=${rCisSame.exitCode}`,
      );
    }

    // ── C4: usable-conversation gate + empty summary capture ─────────
    {
      // Full files present but one mode has null primary rates → fail
      const thin = path.join(tmp, "thin-usable");
      mkdirSync(thin, { recursive: true });
      writeCompleteCampaign(thin);
      // Overwrite ciswire seed 1 with all fact probes excluded (null rate)
      writeResult(
        thin,
        "ciswire",
        1,
        baseResult({
          arm: "ciswire",
          seed: 1,
          compaction: "ciswire",
          compactionPrefRaw: "ciswire",
          compactionActive: "ciswire",
          probes: [
            probe("fact_A", "fact_recall", null),
            probe("fact_B", "fact_recall", null),
          ],
          recall: null,
          byFamily: {
            fact_recall: { found: 0, total: 0, rate: null, excluded: 2 },
          },
          positiveControl: {
            promptTokensByTurn: { "1": 800, "2": 971 },
            reusedTokensByTurn: {},
            completionsByTurn: {},
            compactorChars: 501,
            summaryChars: 40,
          },
        }),
      );
      const rThin = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([thin]),
      );
      check(
        "C4: mode with fewer usable conversations fails",
        rThin.exitCode !== 0 &&
          /Insufficient usable conversations/i.test(rThin.markdown),
        `exit=${rThin.exitCode}`,
      );

    }

    // ── early/late fact families: primary = mean; fall back to plain ──
    {
      // New layout: all modes have fact_recall_early + fact_recall_late.
      // Primary = mean(early, late) per conversation.
      // early rates equal (both pass); late: off 0, ciswire 1
      // → off mean 0.5, ciswire mean 1.0 (primary pair).
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
            compactionActive: "off",
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
          "anchored",
          seed,
          baseResult({
            arm: "anchored",
            seed,
            compaction: "anchored",
            compactionPrefRaw: "anchored",
            compactionActive: "anchored",
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
        writeResult(
          d,
          "ciswire",
          seed,
          baseResult({
            arm: "ciswire",
            seed,
            compaction: "ciswire",
            compactionPrefRaw: "ciswire",
            compactionActive: "ciswire",
            probes: [
              probe("fact_A_early", "fact_recall_early", true),
              probe("fact_B_early", "fact_recall_early", true),
              probe("fact_A_late", "fact_recall_late", true),
              probe("fact_B_late", "fact_recall_late", true),
            ],
            recall: 1,
            byFamily: {
              fact_recall_early: { found: 2, total: 2, rate: 1, excluded: 0 },
              fact_recall_late: { found: 2, total: 2, rate: 1, excluded: 0 },
            },
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 970 + seed },
              reusedTokensByTurn: {},
              completionsByTurn: {},
              boundaryByTurn: { "1": 0, "2": 10 },
              digestCharsByTurn: { "1": 0, "2": 50 + seed },
              compactorChars: 120,
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
      // Primary pair: ciswire mean 1.0 > off mean 0.5
      check(
        "early/late: primary uses mean (ciswire 1.0 > off 0.5)",
        /ciswire \(1(?:\.0+)?\)/.test(r.markdown) &&
          /off \(0\.5/.test(r.markdown),
        `snippet: ${r.markdown.match(/Primary gate[\s\S]{0,250}/)?.[0] ?? r.markdown.slice(0, 400)}`,
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
          "anchored",
          seed,
          baseResult({
            arm: "anchored",
            seed,
            compaction: "anchored",
            compactionActive: "anchored",
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
        "anchored",
        1,
        baseResult({
          arm: "anchored",
          seed: 1,
          compaction: "anchored",
          compactionActive: "anchored",
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

    // ── Exploratory tool-call timing: null mode must still render ─────
    {
      const d = path.join(tmp, "tool-timing-null");
      mkdirSync(d, { recursive: true });
      writeCompleteCampaign(d);
      for (const seed of [1, 2, 3]) {
        writeResult(
          d,
          "baseline",
          seed,
          baseResult({
            arm: "baseline",
            seed,
            compaction: "off",
            compactionPrefRaw: "0",
            compactionActive: "off",
            toolPrecision: 0.5,
            toolRecall: 1,
            spuriousCalls: 2,
            missedCalls: 0,
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 900 },
              reusedTokensByTurn: { "1": 0, "2": 100 },
              completionsByTurn: { "1": 1, "2": 1 },
              compactorChars: 0,
              summaryChars: 0,
            },
          }),
        );
        writeResult(
          d,
          "anchored",
          seed,
          baseResult({
            arm: "anchored",
            seed,
            compaction: "anchored",
            compactionPrefRaw: "anchored",
            compactionActive: "anchored",
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
            toolPrecision: null,
            toolRecall: null,
            spuriousCalls: 0,
            missedCalls: 0,
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 950 + seed },
              reusedTokensByTurn: { "1": 0, "2": 120 },
              completionsByTurn: { "1": 1, "2": 1 },
              digestCharsByTurn: { "1": 0, "2": 40 + seed },
              boundaryByTurn: { "1": 0, "2": 8 },
              compactorChars: 400 + seed,
              summaryChars: 50,
            },
          }),
        );
        writeResult(
          d,
          "ciswire",
          seed,
          baseResult({
            arm: "ciswire",
            seed,
            compaction: "ciswire",
            compactionPrefRaw: "ciswire",
            compactionActive: "ciswire",
            probes: [
              probe("fact_A", "fact_recall", true),
              probe("fact_B", "fact_recall", true),
              probe("tool_call", "tool_call", true),
              probe("miniapp", "miniapp", true),
              probe("language", "language", true),
              probe("honesty", "honesty", true),
            ],
            recall: 1,
            byFamily: {
              fact_recall: { found: 2, total: 2, rate: 1 },
              tool_call: { found: 1, total: 1, rate: 1 },
              miniapp: { found: 1, total: 1, rate: 1 },
              language: { found: 1, total: 1, rate: 1 },
              honesty: { found: 1, total: 1, rate: 1 },
            },
            toolPrecision: 1,
            toolRecall: 1,
            spuriousCalls: 0,
            missedCalls: 0,
            positiveControl: {
              promptTokensByTurn: { "1": 800, "2": 970 + seed },
              reusedTokensByTurn: { "1": 0, "2": 130 },
              completionsByTurn: { "1": 1, "2": 1 },
              digestCharsByTurn: { "1": 0, "2": 50 + seed },
              boundaryByTurn: { "1": 0, "2": 10 },
              compactorChars: 500 + seed,
              summaryChars: 40,
            },
          }),
        );
      }
      const { markdown, exitCode } = withEnv(
        { BENCH_EXPECT_SEEDS: "3", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([d]),
      );
      check(
        "exploratory tool-timing: null mode still renders, gate intact",
        exitCode === 0 &&
          /### Exploratory: tool-call timing/.test(markdown) &&
          /\| anchored \| n\/a \| n\/a \|/.test(markdown),
        `exit=${exitCode}\n${markdown.split("\n").filter((l) => /Exploratory|precision|^\| (off|anchored|ciswire) \|/.test(l)).join("\n")}`,
      );
    }

    // ── nogate is exploratory: no (mode, seed) collision with baseline ─
    {
      const seeds6 = [1, 2, 3, 4, 5, 6];
      const without = path.join(tmp, "six-no-nogate");
      mkdirSync(without, { recursive: true });
      writeCompleteCampaign(without, { seeds: seeds6 });
      const rWithout = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([without]),
      );

      const withNg = path.join(tmp, "six-plus-nogate");
      mkdirSync(withNg, { recursive: true });
      writeCompleteCampaign(withNg, { seeds: seeds6 });
      writeNogateArms(withNg, seeds6);
      const rWith = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([withNg]),
      );
      check(
        "nogate + 3 modes × 6 seeds exits 0 (no duplicate cell)",
        rWith.exitCode === 0,
        `exit=${rWith.exitCode}\n${rWith.markdown.split("\n").filter((l) => /INCOMPLETE|Duplicate|Missing/i.test(l)).join("\n")}`,
      );
      const nsWith = primaryPairNs(rWith.markdown);
      const nsWithout = primaryPairNs(rWithout.markdown);
      check(
        "primary n unchanged by adding nogate arms",
        nsWith != null &&
          nsWithout != null &&
          nsWith.nA === nsWithout.nA &&
          nsWith.nB === nsWithout.nB,
        `with=${JSON.stringify(nsWith)} without=${JSON.stringify(nsWithout)}`,
      );
      check(
        "exploratory section renders baseline vs nogate",
        /baseline vs nogate/i.test(rWith.markdown) &&
          /\| nogate \|/.test(rWith.markdown),
        `snippet:\n${rWith.markdown.split("\n").filter((l) => /nogate|Gate A\/B|baseline \|/.test(l)).join("\n")}`,
      );

      check(
        "missing nogate does not fail the run",
        rWithout.exitCode === 0 &&
          !/## INCOMPLETE/.test(rWithout.markdown),
        `exit=${rWithout.exitCode}`,
      );

      check(
        "toolGateActive present and differing → the exploratory pair renders",
        /baseline vs nogate/i.test(rWith.markdown) &&
          /\| nogate \|/.test(rWith.markdown) &&
          !/not interpretable/.test(rWith.markdown),
        `snippet:\n${rWith.markdown.split("\n").filter((l) => /nogate|Gate A\/B|not interpretable|skipped/.test(l)).join("\n")}`,
      );

      const sameGate = path.join(tmp, "same-toolgate");
      mkdirSync(sameGate, { recursive: true });
      writeCompleteCampaign(sameGate, { seeds: seeds6, baselineToolGate: true });
      writeNogateArms(sameGate, seeds6, { toolGateActive: true });
      const rSame = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([sameGate]),
      );
      check(
        "toolGateActive present and identical → not interpretable, no table",
        rSame.exitCode === 0 &&
          /not interpretable/.test(rSame.markdown) &&
          !/\| nogate \|/.test(rSame.markdown),
        `exit=${rSame.exitCode}\n${rSame.markdown.split("\n").filter((l) => /Gate A\/B|nogate|not interpretable|skipped|\| arm \|/.test(l)).join("\n")}`,
      );

      const absentGate = path.join(tmp, "absent-toolgate");
      mkdirSync(absentGate, { recursive: true });
      writeCompleteCampaign(absentGate, {
        seeds: seeds6,
        baselineToolGate: "omit",
      });
      writeNogateArms(absentGate, seeds6, { omitToolGate: true });
      const rAbsent = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([absentGate]),
      );
      check(
        "toolGateActive absent → skipped with a note, run does not fail",
        rAbsent.exitCode === 0 &&
          /toolGateActive absent/.test(rAbsent.markdown) &&
          !/\| nogate \|/.test(rAbsent.markdown) &&
          !/## INCOMPLETE/.test(rAbsent.markdown),
        `exit=${rAbsent.exitCode}\n${rAbsent.markdown.split("\n").filter((l) => /Gate A\/B|nogate|skipped|not interpretable/.test(l)).join("\n")}`,
      );

      const dupBase = path.join(tmp, "dup-baseline-with-nogate");
      mkdirSync(dupBase, { recursive: true });
      writeCompleteCampaign(dupBase, { seeds: seeds6 });
      writeNogateArms(dupBase, seeds6);
      const extra = path.join(
        dupBase,
        "bench-result-fase4-baseline-seed1-copy",
      );
      mkdirSync(extra, { recursive: true });
      writeFileSync(
        path.join(extra, "result.json"),
        JSON.stringify(
          baseResult({ arm: "baseline", seed: 1, compactionActive: "off" }),
          null,
          2,
        ),
      );
      const rDup = withEnv(
        { BENCH_EXPECT_SEEDS: "6", BENCH_EXPECT_PHASE: "fase4" },
        () => runAggregate([dupBase]),
      );
      check(
        "genuine duplicate baseline still fails",
        rDup.exitCode !== 0 && /Duplicate/i.test(rDup.markdown),
        `exit=${rDup.exitCode}`,
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
