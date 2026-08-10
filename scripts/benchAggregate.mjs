#!/usr/bin/env node
/**
 * Aggregates PIANO V4.2 bench results (Fase 0 + Fase 4).
 *
 * Reads every file literally named `result.json` found recursively under the
 * given directories (default: current directory — matches how
 * actions/download-artifact lays out `all-results/<artifact-name>/result.json`
 * when downloading every arm's artifact without a `name` filter).
 *
 * Schema 2 (from benchGrade.mjs) adds per-family probes, prefill telemetry,
 * positive-control prompt hashes, and notes. Schema-1 files (no `byFamily`,
 * probes without `family`) still aggregate: probes fall back to family
 * `unknown`.
 *
 * Completeness gate (Fase 4 only): every expected (arm, seed) pair must be
 * present, compactionActive must match the arm under test, and identical
 * prompt hashes across arms fail the run — an A/B that assembles the same
 * prompt is a broken experiment, not a null result. Smoke is never gated.
 *
 * Zero npm dependencies (Node builtins only): fs/path for the file walk, a
 * hand-rolled deterministic PRNG (mulberry32) for the permutation test —
 * Math.random() is NEVER used so a run is byte-for-byte reproducible.
 *
 * Usage:
 *   node scripts/benchAggregate.mjs [dir ...]
 *
 * Output:
 *   - Markdown to stdout (the workflow pipes this into $GITHUB_STEP_SUMMARY)
 *   - bench-out/AGGREGATE.md (same content, for the uploaded artifact)
 *   - exit 1 when the Fase 4 gate fails (incomplete / bad compaction / identical prompts)
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PERM_ITERATIONS = Number(process.env.BENCH_PERM_ITERATIONS || 10_000);
const PERM_SEED = Number(process.env.BENCH_PERM_SEED || 42);
const ALPHA = 0.05;
const FASE4_ARMS = ["baseline", "v42"];
const PRIMARY_FAMILY = "fact_recall";

// ── File discovery ──────────────────────────────────────────────────────

function findResultFiles(root) {
  const out = [];
  if (!existsSync(root)) return out;
  const stack = [root];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(p);
      } else if (entry.isFile() && entry.name === "result.json") {
        out.push(p);
      }
    }
  }
  return out;
}

function loadResults(dirs) {
  const files = dirs.flatMap((d) => findResultFiles(d));
  const results = [];
  for (const f of files) {
    try {
      const raw = readFileSync(f, "utf8");
      const parsed = JSON.parse(raw);
      results.push({ __file: f, ...parsed });
    } catch (err) {
      console.error(`[benchAggregate] skipping unparseable ${f}: ${err.message}`);
    }
  }
  return results;
}

// ── Deterministic PRNG (mulberry32) — no Math.random ────────────────────

function mulberry32(seed) {
  let t = seed >>> 0;
  return function rand() {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** One-sided permutation test: is mean(groupB) > mean(groupA)? */
function permutationTestOneSided(groupA, groupB, iterations, seed) {
  const mean = (arr) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
  const observed = mean(groupB) - mean(groupA);
  if (groupA.length === 0 || groupB.length === 0) {
    return { observed, p: 1, iterations: 0 };
  }
  const rand = mulberry32(seed);
  const pooled = groupA.concat(groupB);
  const nB = groupB.length;
  let countGE = 0;
  for (let it = 0; it < iterations; it++) {
    const arr = pooled.slice();
    // Fisher–Yates shuffle with the deterministic PRNG.
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const tmp = arr[i];
      arr[i] = arr[j];
      arr[j] = tmp;
    }
    const permB = arr.slice(0, nB);
    const permA = arr.slice(nB);
    const diff = mean(permB) - mean(permA);
    // Small epsilon guards against float rounding hiding an exact tie.
    if (diff >= observed - 1e-9) countGE++;
  }
  // Add-one smoothing is standard and slightly conservative for Monte-Carlo
  // sampling. (The "observed assignment is itself one permutation" justification
  // holds for exhaustive enumeration; for sampling the formula is still the
  // usual Phipson–Smyth-style estimator.)
  const p = (countGE + 1) / (iterations + 1);
  return { observed, p, iterations };
}

/** Exact binomial coefficient C(n, k) via BigInt. */
function binomial(n, k) {
  const N = BigInt(n);
  let K = BigInt(k);
  if (K < 0n || K > N) return 0n;
  if (K > N - K) K = N - K;
  let num = 1n;
  let den = 1n;
  for (let i = 1n; i <= K; i++) {
    num *= N - K + i;
    den *= i;
  }
  return num / den;
}

/**
 * Smallest p the design can return under one-sided exhaustive enumeration:
 * floor = (1+1)/(C(nA+nB, nB)+1). Compare with Monte-Carlo floor 1/(iterations+1)
 * and take the larger (weaker) of the two as the achievable floor.
 */
function permutationFloor(nA, nB, iterations) {
  if (nA <= 0 || nB <= 0) return 1;
  const comb = binomial(nA + nB, nB);
  const exhaustive = Number(2n) / Number(comb + 1n);
  const mc = 1 / (iterations + 1);
  return Math.max(exhaustive, mc);
}

// ── Shared helpers ──────────────────────────────────────────────────────

function probeFamily(probe) {
  // Schema-1 files lack family; pool them under a single fallback name.
  if (probe && typeof probe.family === "string" && probe.family.length > 0) {
    return probe.family;
  }
  return "unknown";
}

function meanOf(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

const DEFAULT_EXPECT_SEEDS = 3;

/**
 * BENCH_EXPECT_SEEDS: fail closed on empty / non-numeric / negative — treat as
 * "gate enabled with the default". Returns { n, usedDefault, raw }.
 */
function expectSeedsInfo() {
  const raw = process.env.BENCH_EXPECT_SEEDS;
  if (raw === undefined || raw === null) {
    return { n: DEFAULT_EXPECT_SEEDS, usedDefault: true, raw: raw ?? "(unset)" };
  }
  const trimmed = String(raw).trim();
  if (trimmed === "") {
    return { n: DEFAULT_EXPECT_SEEDS, usedDefault: true, raw: "(empty)" };
  }
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      n: DEFAULT_EXPECT_SEEDS,
      usedDefault: true,
      raw: trimmed,
    };
  }
  return { n, usedDefault: false, raw: trimmed };
}

function expectSeeds() {
  return expectSeedsInfo().n;
}

/**
 * Completeness / compaction / identical-prompt gates apply only to Fase 4
 * measurement campaigns. Smoke is a harness self-test. Other phases set
 * BENCH_EXPECT_SEEDS=0 in CI. When BENCH_EXPECT_PHASE is set, gate only if
 * it is "fase4" (case-insensitive, trimmed).
 */
function shouldGateFase4() {
  const phaseRaw = process.env.BENCH_EXPECT_PHASE;
  if (phaseRaw != null && phaseRaw !== "") {
    const phase = String(phaseRaw).trim().toLowerCase();
    if (phase === "smoke") return false;
    if (phase !== "fase4") return false;
  }
  return expectSeeds() > 0;
}

// ── Fase 0 aggregation ───────────────────────────────────────────────────

function aggregateFase0(results) {
  const fase0 = results.filter((r) => r.phase === "fase0");
  if (fase0.length === 0) return { rows: [], winner: null };

  const groups = new Map(); // key = `${blockFormat}|${thinking}`
  for (const r of fase0) {
    const key = `${r.blockFormat}|${r.thinking}`;
    if (!groups.has(key)) {
      groups.set(key, {
        blockFormat: r.blockFormat,
        thinking: r.thinking,
        probesFound: 0,
        probesTotal: 0,
        elapsedSum: 0,
        elapsedCount: 0,
        replyLenSum: 0,
        replyLenCount: 0,
        files: 0,
      });
    }
    const g = groups.get(key);
    g.files += 1;
    for (const probe of r.probes ?? []) {
      g.probesTotal += 1;
      if (probe.found === true) g.probesFound += 1;
    }
    for (const turn of r.turns ?? []) {
      if (typeof turn.elapsed_s === "number") {
        g.elapsedSum += turn.elapsed_s;
        g.elapsedCount += 1;
      }
      if (typeof turn.reply_len === "number") {
        g.replyLenSum += turn.reply_len;
        g.replyLenCount += 1;
      }
    }
  }

  const rows = [...groups.values()].map((g) => ({
    blockFormat: g.blockFormat,
    thinking: g.thinking,
    recall: g.probesTotal > 0 ? g.probesFound / g.probesTotal : 0,
    avgSecPerTurn: g.elapsedCount > 0 ? g.elapsedSum / g.elapsedCount : 0,
    avgReplyLen: g.replyLenCount > 0 ? g.replyLenSum / g.replyLenCount : 0,
    files: g.files,
    probesFound: g.probesFound,
    probesTotal: g.probesTotal,
  }));

  // Winner: highest recall, tie-broken by lowest avg s/turn (faster wins).
  const winner = rows
    .slice()
    .sort((a, b) => b.recall - a.recall || a.avgSecPerTurn - b.avgSecPerTurn)[0];

  return { rows, winner };
}

// ── Fase 4 aggregation ───────────────────────────────────────────────────

function listFase4(results) {
  return results.filter((r) => r.phase === "fase4");
}

/** Present (arm, seed) pairs from loaded fase4 results. */
function presentPairs(fase4) {
  const set = new Set();
  for (const r of fase4) {
    set.add(`${String(r.arm)}|${String(r.seed)}`);
  }
  return set;
}

function findMissingPairs(fase4) {
  const n = expectSeeds();
  if (n <= 0) return [];
  const present = presentPairs(fase4);
  const missing = [];
  for (const arm of FASE4_ARMS) {
    for (let s = 1; s <= n; s++) {
      const key = `${arm}|${s}`;
      if (!present.has(key)) missing.push({ arm, seed: s });
    }
  }
  return missing;
}

/**
 * An arm that did not actually run the mechanism under test is not a valid
 * observation: v42 must have compactionActive, baseline must not.
 * Schema-1 files omit the field — skip them. Schema >= 2: missing
 * compactionActive is a failure (not only an explicit false mismatch).
 */
function findInvalidCompaction(fase4) {
  const bad = [];
  for (const r of fase4) {
    const arm = String(r.arm);
    const seed = r.seed;
    const schema = r.schema ?? 1;
    if (typeof r.compactionActive !== "boolean") {
      if (schema >= 2) {
        bad.push({
          arm,
          seed,
          reason: "compactionActive missing (required for schema >= 2)",
        });
      }
      continue;
    }
    if (arm === "v42" && r.compactionActive !== true) {
      bad.push({
        arm,
        seed,
        reason: `compactionActive=${r.compactionActive} (expected true for v42)`,
      });
    } else if (arm === "baseline" && r.compactionActive !== false) {
      bad.push({
        arm,
        seed,
        reason: `compactionActive=${r.compactionActive} (expected false for baseline)`,
      });
    }
  }
  return bad;
}

/** Same (arm, seed) more than once → list duplicate files. */
function findDuplicatePairs(fase4) {
  const map = new Map(); // key -> files[]
  for (const r of fase4) {
    const key = `${String(r.arm)}|${String(r.seed)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.__file ?? "(unknown)");
  }
  const dups = [];
  for (const [key, files] of map) {
    if (files.length > 1) {
      const [arm, seed] = key.split("|");
      dups.push({ arm, seed, files });
    }
  }
  return dups;
}

/** result.json present but probes array empty or missing. */
function findZeroProbeFiles(fase4) {
  const bad = [];
  for (const r of fase4) {
    const probes = r.probes;
    if (!Array.isArray(probes) || probes.length === 0) {
      bad.push({
        arm: String(r.arm),
        seed: r.seed,
        file: r.__file ?? "(unknown)",
      });
    }
  }
  return bad;
}

function familyStatsPerArm(fase4) {
  // arm -> family -> { found, total, seeds: Set }
  const byArm = new Map();
  const allFamilies = new Set();

  for (const r of fase4) {
    const arm = String(r.arm);
    if (!byArm.has(arm)) byArm.set(arm, new Map());
    const famMap = byArm.get(arm);

    for (const probe of r.probes ?? []) {
      const fam = probeFamily(probe);
      allFamilies.add(fam);
      if (!famMap.has(fam)) {
        famMap.set(fam, { found: 0, total: 0, seeds: new Set() });
      }
      const g = famMap.get(fam);
      g.total += 1;
      if (probe.found === true) g.found += 1;
      g.seeds.add(String(r.seed));
    }
  }

  // Prefer a stable family order; unknown last.
  const preferred = ["fact_recall", "tool_call", "miniapp", "language", "honesty"];
  const families = [
    ...preferred.filter((f) => allFamilies.has(f)),
    ...[...allFamilies].filter((f) => !preferred.includes(f)).sort(),
  ];

  const rows = [];
  for (const arm of [...byArm.keys()].sort()) {
    const famMap = byArm.get(arm);
    for (const family of families) {
      const g = famMap.get(family);
      if (!g) continue;
      rows.push({
        arm,
        family,
        rate: g.total > 0 ? g.found / g.total : 0,
        found: g.found,
        total: g.total,
        seeds: g.seeds.size,
      });
    }
  }
  return { rows, families };
}

/** Flat 0/1 outcomes per family per arm for the probe-level (pseudo-replicated) test. */
function familyOutcomes(fase4) {
  // arm -> family -> number[]
  const out = new Map();
  for (const r of fase4) {
    const arm = String(r.arm);
    if (!out.has(arm)) out.set(arm, new Map());
    const famMap = out.get(arm);
    for (const probe of r.probes ?? []) {
      const fam = probeFamily(probe);
      if (!famMap.has(fam)) famMap.set(fam, []);
      famMap.get(fam).push(probe.found === true ? 1 : 0);
    }
  }
  return out;
}

/**
 * Conversation-level fact_recall rates (unit = one result.json).
 * Skip conversations whose recall is null (no fact probes).
 */
function conversationRecallRates(fase4) {
  const byArm = new Map();
  for (const r of fase4) {
    const arm = String(r.arm);
    let rate = r.recall;
    if (rate == null || !Number.isFinite(rate)) {
      // Derive from probes if recall missing (schema-1 or old grader).
      const facts = (r.probes ?? []).filter(
        (p) => probeFamily(p) === PRIMARY_FAMILY,
      );
      if (facts.length === 0) continue;
      rate = facts.filter((p) => p.found === true).length / facts.length;
    }
    if (!byArm.has(arm)) byArm.set(arm, []);
    byArm.get(arm).push(rate);
  }
  return byArm;
}

function runFamilyPermutations(fase4, families) {
  const outcomes = familyOutcomes(fase4);
  const baseline = outcomes.get("baseline") ?? new Map();
  const v42 = outcomes.get("v42") ?? new Map();
  const rows = [];
  for (const family of families) {
    const a = baseline.get(family) ?? [];
    const b = v42.get(family) ?? [];
    const perm =
      a.length > 0 && b.length > 0
        ? permutationTestOneSided(a, b, PERM_ITERATIONS, PERM_SEED)
        : null;
    const mean = (arr) =>
      arr.length === 0 ? null : arr.reduce((s, x) => s + x, 0) / arr.length;
    rows.push({
      family,
      baselineRate: mean(a),
      v42Rate: mean(b),
      nA: a.length,
      nB: b.length,
      permutation: perm,
      // Probe-level is never the primary gate (see conversationPrimary).
      primary: false,
      probeLevel: true,
    });
  }
  return rows;
}

/**
 * PRIMARY test: unit = conversation, value = fact_recall rate in [0,1].
 */
function runConversationPrimary(fase4) {
  const byArm = conversationRecallRates(fase4);
  const a = byArm.get("baseline") ?? [];
  const b = byArm.get("v42") ?? [];
  const mean = (arr) =>
    arr.length === 0 ? null : arr.reduce((s, x) => s + x, 0) / arr.length;
  const perm =
    a.length > 0 && b.length > 0
      ? permutationTestOneSided(a, b, PERM_ITERATIONS, PERM_SEED)
      : null;
  const floor = permutationFloor(a.length, b.length, PERM_ITERATIONS);
  return {
    family: PRIMARY_FAMILY,
    unit: "conversation",
    baselineRate: mean(a),
    v42Rate: mean(b),
    nA: a.length,
    nB: b.length,
    permutation: perm,
    floor,
    underpowered: ALPHA <= floor,
    primary: true,
  };
}

function collectPrefill(fase4) {
  // arm -> arrays of numeric samples (nulls never pushed)
  const byArm = new Map();
  for (const r of fase4) {
    const arm = String(r.arm);
    if (!byArm.has(arm)) {
      byArm.set(arm, {
        arm,
        promptMs: [],
        reuseFrac: [],
        promptTokens: [],
        elapsed_s: [],
      });
    }
    const g = byArm.get(arm);
    for (const turn of r.turns ?? []) {
      if (typeof turn.promptMs === "number") g.promptMs.push(turn.promptMs);
      if (typeof turn.reuseFrac === "number") g.reuseFrac.push(turn.reuseFrac);
      if (typeof turn.promptTokens === "number") g.promptTokens.push(turn.promptTokens);
      // Also accept promptTokenCount if present without promptTokens
      else if (typeof turn.promptTokenCount === "number") {
        g.promptTokens.push(turn.promptTokenCount);
      }
      if (typeof turn.elapsed_s === "number") g.elapsed_s.push(turn.elapsed_s);
    }
    // Prefer result-level prefill summary only when turn-level is empty? Spec says
    // aggregate over turns across seeds — turn-level is the source of truth.
  }

  const rows = [...byArm.values()].map((g) => ({
    arm: g.arm,
    meanPromptMs: meanOf(g.promptMs),
    nPromptMs: g.promptMs.length,
    meanReuseFrac: meanOf(g.reuseFrac),
    nReuseFrac: g.reuseFrac.length,
    meanPromptTokens: meanOf(g.promptTokens),
    nPromptTokens: g.promptTokens.length,
    meanElapsed: meanOf(g.elapsed_s),
    nElapsed: g.elapsed_s.length,
  }));

  const anyPrefill = rows.some(
    (r) => r.nPromptMs > 0 || r.nReuseFrac > 0 || r.nPromptTokens > 0,
  );
  return { rows, anyPrefill };
}

function collectPositiveControl(fase4) {
  // seed -> arm -> positiveControl
  // After smoke run 31358530713: compare promptTokensByTurn (embd.size) and
  // compactorChars — never promptSha* (logcat 4 KB truncation made hashes constant).
  const bySeed = new Map();
  for (const r of fase4) {
    const seed = String(r.seed);
    const arm = String(r.arm);
    if (!bySeed.has(seed)) bySeed.set(seed, {});
    bySeed.get(seed)[arm] = r.positiveControl ?? null;
  }

  const rows = [];
  let anyIdentical = false;
  let anyPass = false;
  let anyFail = false;
  let seedsWithBothArms = 0;

  for (const seed of [...bySeed.keys()].sort()) {
    const pair = bySeed.get(seed);
    if (!pair.baseline || !pair.v42) continue;
    seedsWithBothArms += 1;
    const tokensA = pair.baseline.promptTokensByTurn ?? {};
    const tokensB = pair.v42.promptTokensByTurn ?? {};
    const compA =
      typeof pair.baseline.compactorChars === "number"
        ? pair.baseline.compactorChars
        : 0;
    const compB =
      typeof pair.v42.compactorChars === "number"
        ? pair.v42.compactorChars
        : 0;

    const allCommon = Object.keys(tokensA)
      .filter((t) => Object.prototype.hasOwnProperty.call(tokensB, t))
      .sort((a, b) => Number(a) - Number(b));

    // Turn 1 is assembled before any compaction has happened and is EXPECTED
    // to match across arms — exclude it from the identical/differ verdict.
    // If turn 1 is the only common turn, that is INSUFFICIENT and fails.
    const commonTurns = allCommon.filter((t) => Number(t) !== 1);

    let different = 0;
    for (const t of commonTurns) {
      if (tokensA[t] !== tokensB[t]) different += 1;
    }

    // Compactor state: expect > 0 on v42, 0 on baseline (reset_chat clears it).
    const compactorDiffersExpected = compB > 0 && compA === 0;

    let verdict;
    if (allCommon.length === 0 && !(compA > 0 || compB > 0)) {
      // No overlapping prompt-token turns and no compactor signal → fail closed.
      verdict = "NO OVERLAPPING PROMPT TOKENS";
      anyFail = true;
    } else if (commonTurns.length === 0 && !compactorDiffersExpected) {
      verdict = "INSUFFICIENT — turn 1 only (excluded; pre-compaction)";
      anyFail = true;
    } else if (different > 0 || compactorDiffersExpected) {
      // PASS: at least one common turn ≥ 2 differs in prompt token count,
      // OR compactorChars differs in the expected direction (v42 > 0, baseline 0).
      verdict = "ARMS DIFFER";
      anyPass = true;
    } else if (different === 0 && compA === 0 && compB === 0) {
      // Every common turn ≥ 2 matches AND compactor never ran on either arm.
      verdict = "MEASURING NOTHING";
      anyIdentical = true;
      anyFail = true;
    } else {
      // Token counts match and compactorChars not in expected direction
      // (e.g. both non-zero, or only baseline non-zero) — still not a valid A/B.
      verdict = "MEASURING NOTHING";
      anyIdentical = true;
      anyFail = true;
    }

    rows.push({
      seed,
      compared: commonTurns.length,
      different,
      verdict,
      v42CompactorChars: compB,
      baselineCompactorChars: compA,
    });
  }

  // Fail closed when no seed has positiveControl in both arms.
  const absentBothArms = seedsWithBothArms === 0;

  return {
    rows,
    anyIdentical,
    anyFail,
    anyPass,
    absentBothArms,
    // Gate fails if absent, any fail, or no seed passed ARMS DIFFER.
    gateFailed: absentBothArms || anyFail || !anyPass,
  };
}

function collectNotes(fase4) {
  // Dedupe by note text; keep every (arm, seed) that produced it.
  const map = new Map(); // note -> [{arm, seed}]
  for (const r of fase4) {
    for (const note of r.notes ?? []) {
      const text = String(note);
      if (!map.has(text)) map.set(text, []);
      map.get(text).push({ arm: String(r.arm), seed: r.seed });
    }
  }
  return [...map.entries()].map(([note, sources]) => ({ note, sources }));
}

function aggregateFase4(results) {
  const fase4 = listFase4(results);
  const { rows: familyRows, families } = familyStatsPerArm(fase4);
  const permutations = runFamilyPermutations(fase4, families);
  const conversationPrimary = runConversationPrimary(fase4);
  const prefill = collectPrefill(fase4);
  const positiveControl = collectPositiveControl(fase4);
  const notes = collectNotes(fase4);

  const gated = shouldGateFase4();
  const seedsInfo = expectSeedsInfo();
  const missing = gated ? findMissingPairs(fase4) : [];
  const invalidCompaction = gated ? findInvalidCompaction(fase4) : [];
  const duplicates = gated ? findDuplicatePairs(fase4) : [];
  const zeroProbes = gated ? findZeroProbeFiles(fase4) : [];

  // V4.2 gate uses conversation-level p ONLY (not probe-level).
  const primary = conversationPrimary;
  let gateMet = false;
  if (
    primary &&
    primary.permutation &&
    primary.baselineRate != null &&
    primary.v42Rate != null &&
    !primary.underpowered
  ) {
    gateMet =
      primary.v42Rate > primary.baselineRate && primary.permutation.p < ALPHA;
  }

  return {
    fase4,
    familyRows,
    families,
    permutations,
    conversationPrimary,
    prefill,
    positiveControl,
    notes,
    missing,
    invalidCompaction,
    duplicates,
    zeroProbes,
    seedsInfo,
    primary,
    gateMet,
    gated,
  };
}

// ── Markdown rendering ────────────────────────────────────────────────────

function fmt(n, digits = 3) {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function fmtMean(mean, n, digits = 1) {
  if (mean == null || n === 0) return "n/a (n=0)";
  return `${fmt(mean, digits)} (n=${n})`;
}

function renderFase0(agg) {
  const lines = [];
  lines.push("## Fase 0 — block format × thinking A/B");
  if (agg.rows.length === 0) {
    lines.push("", "_No fase0 result.json files found._", "");
    return lines.join("\n");
  }
  lines.push(
    "",
    "| blockFormat | thinking | recall | avg s/turn | avg reply len | probes | runs |",
    "|---|---|---|---|---|---|---|",
  );
  const sorted = agg.rows
    .slice()
    .sort((a, b) => b.recall - a.recall || a.avgSecPerTurn - b.avgSecPerTurn);
  for (const r of sorted) {
    lines.push(
      `| ${r.blockFormat} | ${r.thinking} | ${fmt(r.recall)} (${r.probesFound}/${r.probesTotal}) | ${fmt(r.avgSecPerTurn, 1)} | ${fmt(r.avgReplyLen, 0)} | ${r.probesTotal} | ${r.files} |`,
    );
  }
  if (agg.winner) {
    lines.push(
      "",
      `**Winner (recall, then speed):** blockFormat=\`${agg.winner.blockFormat}\`, thinking=\`${agg.winner.thinking}\` — recall=${fmt(agg.winner.recall)}, ${fmt(agg.winner.avgSecPerTurn, 1)}s/turn.`,
    );
  }
  return lines.join("\n");
}

function renderFase4(agg) {
  const lines = [];
  lines.push("## Fase 4 — compaction-survival (baseline vs v42)");
  if (agg.fase4.length === 0) {
    lines.push("", "_No fase4 result.json files found._", "");
    // Still show incompleteness below when gated with zero files.
    return { body: lines.join("\n"), failParts: renderGateFailures(agg) };
  }

  // ── Per-family rates ────────────────────────────────────────────────
  lines.push("", "### Per-family recall", "");
  lines.push("| arm | family | rate | found/total | seeds |", "|---|---|---|---|---|");
  if (agg.familyRows.length === 0) {
    lines.push("| — | — | n/a | 0/0 | 0 |");
  } else {
    for (const r of agg.familyRows) {
      const mark = r.family === PRIMARY_FAMILY ? " **(PRIMARY)**" : "";
      lines.push(
        `| ${r.arm} | ${r.family}${mark} | ${fmt(r.rate)} | ${r.found}/${r.total} | ${r.seeds} |`,
      );
    }
  }

  // ── Primary: conversation-level fact recall ─────────────────────────
  const cp = agg.conversationPrimary;
  lines.push(
    "",
    `### Primary endpoint: fact recall, unit = conversation (n=${cp?.nA ?? 0} vs ${cp?.nB ?? 0})`,
    "",
  );
  if (cp?.permutation) {
    const { observed, p, iterations } = cp.permutation;
    const floor = cp.floor;
    lines.push(
      `| baseline mean | v42 mean | Δ | p (one-sided) | design floor |`,
      `|---|---|---|---|---|`,
      `| ${fmt(cp.baselineRate)} | ${fmt(cp.v42Rate)} | ${observed >= 0 ? "+" : ""}${fmt(observed)} | ${fmt(p, 4)} | ${fmt(floor, 4)} |`,
      "",
      `**Primary endpoint (fact recall, unit = conversation):** observed Δ = ${observed >= 0 ? "+" : ""}${fmt(observed)}, p = ${fmt(p, 4)} (${iterations} permutations, seed=${PERM_SEED}, deterministic mulberry32 PRNG). Design floor = ${fmt(floor, 4)} = max( exhaustive (1+1)/(C(nA+nB,nB)+1), Monte-Carlo 1/(iterations+1) ).`,
    );
    if (cp.underpowered) {
      lines.push(
        "",
        `> **⚠ DESIGN UNDERPOWERED FOR α=${ALPHA}:** achievable floor = ${fmt(floor, 4)} ≥ α. The gate cannot be met regardless of effect size. Increase seeds (e.g. 6 vs 6 → exhaustive floor 2/C(12,6)+1 ≈ 0.0022, then MC floor dominates).`,
      );
    }
    lines.push("");
    if (agg.gateMet) {
      lines.push(
        `**V4.2 gate (conversation-level fact_recall only):** v42 (${fmt(cp.v42Rate)}) > baseline (${fmt(cp.baselineRate)}) AND p=${fmt(p, 4)} < ${ALPHA} → **MET** — compaction can be enabled by default.`,
      );
    } else {
      lines.push(
        `**V4.2 gate (conversation-level fact_recall only):** ${
          cp.v42Rate != null && cp.baselineRate != null
            ? `v42 (${fmt(cp.v42Rate)}) vs baseline (${fmt(cp.baselineRate)}), p=${fmt(p, 4)}`
            : "insufficient data"
        } → gate NOT met — keep default OFF.`,
      );
    }
  } else {
    lines.push(
      "_Permutation test skipped for primary endpoint: need both a `baseline` and a `v42` arm with at least one conversation that has a non-null fact_recall rate._",
    );
  }

  // ── Probe-level (pseudo-replicated — NOT the gate) ──────────────────
  lines.push(
    "",
    "### Probe-level rates (pseudo-replicated — NOT the gate)",
    "",
    "Probes inside one conversation share model, context and seed, so they are correlated; this p is optimistic and must not be used as the V4.2 gate.",
    "",
  );
  lines.push(
    "| family | baseline | v42 | Δ | p (one-sided) |",
    "|---|---|---|---|---|",
  );
  for (const row of agg.permutations) {
    const label =
      row.family === PRIMARY_FAMILY
        ? `fact_recall (probe-level, pseudo-replicated — NOT the gate)`
        : `${row.family} (secondary, not multiplicity-corrected)`;
    if (!row.permutation) {
      lines.push(
        `| ${label} | ${row.baselineRate == null ? "n/a" : fmt(row.baselineRate)} | ${row.v42Rate == null ? "n/a" : fmt(row.v42Rate)} | n/a | n/a (missing arm) |`,
      );
      continue;
    }
    const { observed, p } = row.permutation;
    const delta = `${observed >= 0 ? "+" : ""}${fmt(observed)}`;
    const pNote =
      row.family === PRIMARY_FAMILY
        ? `${fmt(p, 4)} — optimistic; probes in one conversation are correlated`
        : `${fmt(p, 4)} — not multiplicity-corrected; a single secondary p < 0.05 among four is not evidence on its own`;
    lines.push(
      `| ${label} | ${fmt(row.baselineRate)} | ${fmt(row.v42Rate)} | ${delta} | ${pNote} |`,
    );
  }

  // ── Prefill / TTFT ──────────────────────────────────────────────────
  lines.push("", "### Prefill / TTFT", "");
  if (!agg.prefill.anyPrefill) {
    lines.push("_Prefill telemetry is absent (no arm has promptMs / reuseFrac / promptTokens)._");
  } else {
    lines.push(
      "| arm | mean promptMs (prefill) | mean reuseFrac | mean promptTokens | mean elapsed_s |",
      "|---|---|---|---|---|",
    );
    for (const r of agg.prefill.rows) {
      lines.push(
        `| ${r.arm} | ${fmtMean(r.meanPromptMs, r.nPromptMs, 1)} | ${fmtMean(r.meanReuseFrac, r.nReuseFrac, 3)} | ${fmtMean(r.meanPromptTokens, r.nPromptTokens, 0)} | ${fmtMean(r.meanElapsed, r.nElapsed, 1)} |`,
      );
    }
  }

  // ── Positive control ────────────────────────────────────────────────
  // Compare embd.size (promptTokensByTurn) + on-device compactorState — not
  // prompt hashes (smoke run 31358530713: logcat 4 KB truncation).
  lines.push(
    "",
    "### Positive control (prompt tokens + compactor state)",
    "",
    "_Turn 1 is excluded from the verdict: it is assembled before compaction and is expected to match across arms._",
    "",
  );
  if (agg.positiveControl.absentBothArms || agg.positiveControl.rows.length === 0) {
    lines.push(
      "**positive control absent — cannot prove the arms differed** (no seed with `positiveControl` in both baseline and v42).",
    );
  } else {
    lines.push(
      "| seed | turns compared | turns differing | v42 compactorChars | baseline compactorChars | verdict |",
      "|---|---|---|---|---|---|",
    );
    for (const r of agg.positiveControl.rows) {
      lines.push(
        `| ${r.seed} | ${r.compared} | ${r.different} | ${r.v42CompactorChars} | ${r.baselineCompactorChars} | ${r.verdict} |`,
      );
    }
  }

  // ── Caveats ─────────────────────────────────────────────────────────
  if (agg.notes.length > 0) {
    lines.push("", "### Caveats", "");
    for (const { note, sources } of agg.notes) {
      const who = sources
        .map((s) => `arm=${s.arm} seed=${s.seed}`)
        .join(", ");
      lines.push(`- (${who}) ${note}`);
    }
  }

  return { body: lines.join("\n"), failParts: renderGateFailures(agg) };
}

function renderGateFailures(agg) {
  // Only fail the process when the Fase 4 completeness gate is enabled.
  if (!agg.gated) {
    return { markdown: "", exitCode: 0 };
  }

  const lines = [];
  const hasMissing = agg.missing.length > 0;
  const hasBadCompaction = agg.invalidCompaction.length > 0;
  const hasDuplicates = (agg.duplicates ?? []).length > 0;
  const hasZeroProbes = (agg.zeroProbes ?? []).length > 0;
  const posCtrlFailed = agg.positiveControl.gateFailed === true;
  const seedsInfo = agg.seedsInfo;

  if (
    !hasMissing &&
    !hasBadCompaction &&
    !hasDuplicates &&
    !hasZeroProbes &&
    !posCtrlFailed
  ) {
    return { markdown: "", exitCode: 0 };
  }

  lines.push("", "## INCOMPLETE", "");

  if (seedsInfo?.usedDefault) {
    lines.push(
      `_BENCH_EXPECT_SEEDS was empty/non-numeric/negative ("${seedsInfo.raw}") — gate enabled with default n=${seedsInfo.n}._`,
      "",
    );
  } else if (seedsInfo) {
    lines.push(`_BENCH_EXPECT_SEEDS=${seedsInfo.n} (gate enabled)._`, "");
  }

  if (hasMissing) {
    lines.push(
      "**Missing expected (arm, seed) result.json files.** A campaign that reports success with only a subset of arms is invalid (see run 30863711482).",
      "",
      "| arm | seed |",
      "|---|---|",
    );
    for (const m of agg.missing) {
      lines.push(`| ${m.arm} | ${m.seed} |`);
    }
    lines.push("");
  }

  if (hasDuplicates) {
    lines.push(
      "**Duplicate (arm, seed) pairs** — the same observation appears more than once:",
      "",
      "| arm | seed | files |",
      "|---|---|---|",
    );
    for (const d of agg.duplicates) {
      lines.push(`| ${d.arm} | ${d.seed} | ${d.files.join("; ")} |`);
    }
    lines.push("");
  }

  if (hasZeroProbes) {
    lines.push(
      "**result.json with zero probes** — cannot grade an empty observation:",
      "",
      "| arm | seed | file |",
      "|---|---|---|",
    );
    for (const z of agg.zeroProbes) {
      lines.push(`| ${z.arm} | ${z.seed} | ${z.file} |`);
    }
    lines.push("");
  }

  if (hasBadCompaction) {
    lines.push(
      "**compactionActive missing or disagrees with arm label** — observation is not valid for the mechanism under test:",
      "",
      "| arm | seed | detail |",
      "|---|---|---|",
    );
    for (const b of agg.invalidCompaction) {
      lines.push(`| ${b.arm} | ${b.seed} | ${b.reason} |`);
    }
    lines.push("");
  }

  if (posCtrlFailed) {
    if (agg.positiveControl.absentBothArms) {
      lines.push(
        "**Positive control absent — cannot prove the arms differed** (no seed with positiveControl in both baseline and v42).",
        "",
      );
    } else if (agg.positiveControl.anyIdentical) {
      lines.push(
        "**Positive control failed:** at least one seed has matching `promptTokensByTurn` on every turn ≥ 2 and `compactorChars` is 0 on both arms (or not in the expected v42>0 / baseline=0 direction). The A/B is measuring nothing. This is a broken experiment, not a null result.",
        "",
      );
    } else {
      lines.push(
        "**Positive control failed:** empty/no-overlap prompt token maps, turn-1-only overlap (insufficient), or no seed with ARMS DIFFER on turns ≥ 2 or via compactorChars.",
        "",
      );
    }
  }

  return { markdown: lines.join("\n"), exitCode: 1 };
}

// ── Public entry used by harness + CLI ───────────────────────────────────

/**
 * Aggregate results under `dirs` and return markdown + exit code without
 * writing files or exiting the process (harness needs this).
 * @param {string[]} dirs
 * @returns {{ markdown: string, exitCode: number }}
 */
function runAggregate(dirs) {
  const searchDirs = dirs.length > 0 ? dirs : ["."];
  const results = loadResults(searchDirs);

  const fase0 = aggregateFase0(results);
  const fase4 = aggregateFase4(results);
  const rendered4 = renderFase4(fase4);

  const parts = [
    "# PIANO V4.2 — Bench Aggregate",
    "",
    `_Sources scanned: ${searchDirs.join(", ")} — ${results.length} result.json file(s) found._`,
    "",
    renderFase0(fase0),
    "",
    rendered4.body,
  ];

  // Gate failures go BELOW the partial data so a broken campaign is still
  // diagnosable from the step summary.
  if (rendered4.failParts.markdown) {
    parts.push(rendered4.failParts.markdown);
  }
  parts.push("");

  return {
    markdown: parts.join("\n"),
    exitCode: rendered4.failParts.exitCode,
  };
}

function main() {
  const dirs = process.argv.slice(2);
  const { markdown, exitCode } = runAggregate(dirs);

  console.log(markdown);

  const outDir = "bench-out";
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "AGGREGATE.md"), markdown, "utf8");

  if (exitCode !== 0) process.exit(exitCode);
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}

export { runAggregate, permutationTestOneSided };
