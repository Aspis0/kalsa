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
 * Completeness gate (Fase 4 only): every expected (mode, seed) pair must be
 * present (modes: off / anchored / ciswire), compactionActive must match the mode
 * the matrix asked for, and identical prompt hashes across arms fail the run
 * — an A/B that assembles the same prompt is a broken experiment, not a null
 * result. Exploratory arms whose `arm` is not a compaction mode (e.g. nogate)
 * are excluded from this gate and from the primary comparison — they share
 * compaction `off` with baseline and would otherwise duplicate a (mode, seed)
 * cell. Smoke is never gated.
 *
 * Primary comparison is ciswire vs off (retrieval additive). Also reports
 * anchored vs off and ciswire vs anchored. Three pairwise p-values are NOT corrected
 * for multiplicity in the raw column; Holm-adjusted p-values are printed
 * alongside.
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
/** Workflow arm labels (artifact names / result.arm). */
const FASE4_ARMS = ["baseline", "anchored", "ciswire"];
/** Context modes under test (result.compactionActive). */
const FASE4_MODES = ["off", "anchored", "ciswire"];
/** arm label → expected compactionActive mode. */
const ARM_TO_MODE = {
  baseline: "off",
  anchored: "anchored",
  ciswire: "ciswire",
};
/**
 * Pairwise comparisons (conversation-level). Order: primary first.
 * modeA is control, modeB is treatment; one-sided test is mean(B) > mean(A).
 */
const PAIRWISE_SPECS = [
  { id: "ciswire_vs_off", label: "ciswire vs off", modeA: "off", modeB: "ciswire", primary: true },
  { id: "anchored_vs_off", label: "anchored vs off", modeA: "off", modeB: "anchored", primary: false },
  { id: "ciswire_vs_anchored", label: "ciswire vs anchored", modeA: "anchored", modeB: "ciswire", primary: false },
];
// Primary endpoint = mean(fact_recall_early, fact_recall_late) per conversation
// when the early/late layout is present; plain fact_recall for older artifacts.
// WHY mean: see conversationPrimaryRate. Early/late still reported separately
// in the family table (decay curve is the point of the layout).
const PRIMARY_ENDPOINT_MEAN = "mean(fact_recall_early, fact_recall_late)";
const PRIMARY_FAMILY_LEGACY = "fact_recall";

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

/**
 * Exact one-sided enumeration over every assignment of nB labels out of n.
 * Same add-one smoothing as the Monte-Carlo path: p = (countGE+1)/(N+1).
 */
function permutationExactOneSided(pooled, nB, observed, meanFn) {
  const n = pooled.length;
  let countGE = 0;
  let assignments = 0;
  const chosen = [];
  function visit(start) {
    if (chosen.length === nB) {
      assignments += 1;
      const inB = new Array(n).fill(false);
      for (const i of chosen) inB[i] = true;
      const permB = [];
      const permA = [];
      for (let i = 0; i < n; i++) {
        if (inB[i]) permB.push(pooled[i]);
        else permA.push(pooled[i]);
      }
      const diff = meanFn(permB) - meanFn(permA);
      if (diff >= observed - 1e-9) countGE += 1;
      return;
    }
    const need = nB - chosen.length;
    for (let i = start; i <= n - need; i++) {
      chosen.push(i);
      visit(i + 1);
      chosen.pop();
    }
  }
  visit(0);
  const p = (countGE + 1) / (assignments + 1);
  return { countGE, assignments, p };
}

/** One-sided permutation test: is mean(groupB) > mean(groupA)? */
function permutationTestOneSided(groupA, groupB, iterations, seed) {
  const mean = (arr) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
  const observed = mean(groupB) - mean(groupA);
  if (groupA.length === 0 || groupB.length === 0) {
    return {
      observed,
      p: 1,
      iterations: 0,
      method: "none",
      methodLabel: "n/a",
    };
  }
  const pooled = groupA.concat(groupB);
  const nB = groupB.length;
  const comb = binomial(pooled.length, nB);

  // Exact enumeration when the design fits in the iteration budget.
  if (comb <= BigInt(iterations) && comb > 0n) {
    const exact = permutationExactOneSided(pooled, nB, observed, mean);
    return {
      observed,
      p: exact.p,
      iterations: exact.assignments,
      method: "exact",
      methodLabel: `exact (${exact.assignments} assignments)`,
    };
  }

  const rand = mulberry32(seed);
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
  return {
    observed,
    p,
    iterations,
    method: "montecarlo",
    methodLabel: `Monte Carlo (${iterations} draws)`,
  };
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

/**
 * PRIMARY endpoint label for the campaign.
 * early/late layout → mean of the two rates per conversation;
 * else plain fact_recall (older artifacts / fase0 re-grades).
 */
function resolvePrimaryEndpoint(fase4) {
  for (const r of fase4) {
    if (
      r.byFamily &&
      (r.byFamily.fact_recall_early || r.byFamily.fact_recall_late)
    ) {
      return PRIMARY_ENDPOINT_MEAN;
    }
    for (const p of r.probes ?? []) {
      const f = probeFamily(p);
      if (f === "fact_recall_early" || f === "fact_recall_late") {
        return PRIMARY_ENDPOINT_MEAN;
      }
    }
  }
  return PRIMARY_FAMILY_LEGACY;
}

/** True when found is a scored boolean; null/undefined = excluded (empty reply). */
function isScoredProbe(probe) {
  return probe != null && probe.found !== null && probe.found !== undefined;
}

/**
 * Rate of a fact family for one conversation, skipping null outcomes.
 * Prefers byFamily when total > 0; else derives from scored probes.
 */
function familyRateForResult(r, fam) {
  const bf = r.byFamily?.[fam];
  if (
    bf &&
    typeof bf.total === "number" &&
    bf.total > 0 &&
    typeof bf.rate === "number" &&
    Number.isFinite(bf.rate)
  ) {
    return bf.rate;
  }
  const facts = (r.probes ?? []).filter(
    (p) => probeFamily(p) === fam && isScoredProbe(p),
  );
  if (facts.length === 0) return null;
  return facts.filter((p) => p.found === true).length / facts.length;
}

/**
 * Per-conversation primary value in [0,1].
 * WHY mean(early, late): the product's promise is that facts survive a long
 * conversation; the two probes measure that at two distances (turn 11 vs 16).
 * Reporting only late answers half the question; pooling raw probes instead
 * of averaging per conversation would count correlated observations twice.
 * Fall back to plain fact_recall when neither early nor late is present.
 * Recomputes from byFamily/probes so re-aggregating campaigns graded under
 * the old late-only primary still get the mean endpoint.
 */
function conversationPrimaryRate(r) {
  const earlyR = familyRateForResult(r, "fact_recall_early");
  const lateR = familyRateForResult(r, "fact_recall_late");
  const hasEarlyLateLayout =
    r.byFamily?.fact_recall_early != null ||
    r.byFamily?.fact_recall_late != null ||
    (r.probes ?? []).some((p) => {
      const f = probeFamily(p);
      return f === "fact_recall_early" || f === "fact_recall_late";
    });
  if (hasEarlyLateLayout) {
    const rates = [earlyR, lateR].filter((x) => x != null);
    if (rates.length === 0) return null;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }
  const plain = familyRateForResult(r, PRIMARY_FAMILY_LEGACY);
  if (plain != null) return plain;
  if (r.recall != null && Number.isFinite(r.recall)) return r.recall;
  return null;
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
      // Skip null outcomes (empty-reply exclusions) — not scored misses.
      if (!isScoredProbe(probe)) continue;
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

/**
 * Observed context mode for a result. Prefers compactionActive mode string;
 * accepts legacy boolean (true→off, false→off).
 * Gated fase4 (schema >= 2): no arm-label fallback — absent compactionActive
 * returns null so a stale schema-1-shaped artifact cannot enter a mode cell.
 * Non-gated phases keep the arm-label fallback for partial / smoke trees.
 * @returns {"off"|"anchored"|"ciswire"|null}
 */
function modeOf(r) {
  if (!isCompactionModeResult(r)) return null;
  const ca = r?.compactionActive;
  if (ca === "off" || ca === "anchored" || ca === "ciswire") return ca;
  if (ca === true) return "off";
  if (ca === false) return "off";
  // Gated fase4 schema>=2: missing/unknown compactionActive is invalid, not
  // "whatever the arm label says".
  if (shouldGateFase4()) return null;
  const arm = String(r?.arm ?? "");
  if (Object.prototype.hasOwnProperty.call(ARM_TO_MODE, arm)) {
    return ARM_TO_MODE[arm];
  }
  return null;
}

/** Expected mode from arm label (matrix intent). */
function expectedModeForArm(arm) {
  const a = String(arm ?? "");
  if (Object.prototype.hasOwnProperty.call(ARM_TO_MODE, a)) return ARM_TO_MODE[a];
  return null;
}

/**
 * Compaction-campaign observation? Field: `result.arm` (ci-bench writes
 * raw.arm from the matrix `arm` key; benchGrade passes it through).
 * Only ARM_TO_MODE labels occupy a (mode, seed) cell. Exploratory arms
 * (nogate, future tool-axis) stay out — not a deny-list of names.
 */
function isCompactionModeResult(r) {
  return expectedModeForArm(r.arm) != null;
}

/**
 * Holm–Bonferroni step-down adjustment.
 * @param {number[]} pValues raw p-values
 * @returns {number[]} adjusted p-values in the same order as input
 */
function holmAdjust(pValues) {
  const m = pValues.length;
  if (m === 0) return [];
  const indexed = pValues.map((p, i) => ({ p, i }));
  indexed.sort((a, b) => a.p - b.p);
  const adj = new Array(m);
  let running = 0;
  for (let rank = 0; rank < m; rank++) {
    const { p, i } = indexed[rank];
    const h = Math.min(1, Math.max(running, (m - rank) * p));
    running = h;
    adj[i] = h;
  }
  return adj;
}

/** Present (mode, seed) pairs from loaded fase4 results. */
function presentModePairs(fase4) {
  const set = new Set();
  for (const r of fase4) {
    const mode = modeOf(r);
    if (mode) set.add(`${mode}|${String(r.seed)}`);
  }
  return set;
}

function findMissingPairs(fase4) {
  const n = expectSeeds();
  if (n <= 0) return [];
  const present = presentModePairs(fase4);
  const missing = [];
  for (const mode of FASE4_MODES) {
    for (let s = 1; s <= n; s++) {
      const key = `${mode}|${s}`;
      if (!present.has(key)) missing.push({ mode, arm: mode, seed: s });
    }
  }
  return missing;
}

/**
 * An observation whose compactionActive disagrees with the mode the matrix
 * asked for (via arm label) is not valid for the mechanism under test.
 * Schema-1 files omit the field — skip them. Schema >= 2: missing
 * compactionActive is a failure (not only an explicit mismatch).
 */
function findInvalidCompaction(fase4) {
  const bad = [];
  for (const r of fase4) {
    const arm = String(r.arm);
    const seed = r.seed;
    const schema = r.schema ?? 1;
    if (schema < 2) {
      // Gated fase4 accepts no schema-1 artifact: it carries no compactionActive,
      // so its mode would be taken from the arm label — a stale file labelled
      // "ciswire" that actually ran as baseline would enter the primary cell.
      if (shouldGateFase4()) {
        bad.push({ arm, seed, reason: `schema ${schema} (gated fase4 requires >= 2)` });
      }
      continue;
    }

    const ca = r.compactionActive;
    if (ca === undefined || ca === null) {
      bad.push({
        arm,
        seed,
        reason: "compactionActive missing (required for schema >= 2)",
      });
      continue;
    }

    const isModeStr = ca === "off" || ca === "anchored" || ca === "ciswire";
    const isLegacyBool = typeof ca === "boolean";
    if (!isModeStr && !isLegacyBool) {
      bad.push({
        arm,
        seed,
        reason: `compactionActive=${JSON.stringify(ca)} (expected "off"|"anchored"|"ciswire")`,
      });
      continue;
    }

    const observed = modeOf(r);
    const expected = expectedModeForArm(arm);
    if (expected != null && observed !== expected) {
      bad.push({
        arm,
        seed,
        reason: `compactionActive=${JSON.stringify(ca)} (expected ${expected} for arm ${arm})`,
      });
    }
  }
  return bad;
}

/** Same (mode, seed) more than once → list duplicate files. */
function findDuplicatePairs(fase4) {
  const map = new Map(); // key -> files[]
  for (const r of fase4) {
    if (!isCompactionModeResult(r)) continue;
    const mode = modeOf(r) ?? String(r.arm);
    const key = `${mode}|${String(r.seed)}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r.__file ?? "(unknown)");
  }
  const dups = [];
  for (const [key, files] of map) {
    if (files.length > 1) {
      const [mode, seed] = key.split("|");
      dups.push({ arm: mode, mode, seed, files });
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
  // arm -> family -> { found, total, excluded, seeds: Set }
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
        famMap.set(fam, { found: 0, total: 0, excluded: 0, seeds: new Set() });
      }
      const g = famMap.get(fam);
      // null found = empty-reply exclusion: not in total, not a miss.
      if (!isScoredProbe(probe)) {
        g.excluded += 1;
        g.seeds.add(String(r.seed));
        continue;
      }
      g.total += 1;
      if (probe.found === true) g.found += 1;
      g.seeds.add(String(r.seed));
    }
  }

  // Prefer a stable family order; early then late (decay curve) then legacy
  // plain fact_recall; unknown last. Neither early nor late is the primary
  // alone — the primary endpoint is their per-conversation mean.
  const preferred = [
    "fact_recall_early",
    "fact_recall_late",
    "fact_recall",
    "tool_call",
    "miniapp",
    "language",
    "honesty",
  ];
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
        rate: g.total > 0 ? g.found / g.total : null,
        found: g.found,
        total: g.total,
        excluded: g.excluded,
        seeds: g.seeds.size,
      });
    }
  }
  return { rows, families };
}

/** Flat 0/1 outcomes per family per arm for the probe-level (pseudo-replicated) test. */
function familyOutcomes(fase4) {
  // arm -> family -> number[]  (null outcomes excluded — empty-reply turns)
  const out = new Map();
  for (const r of fase4) {
    const arm = String(r.arm);
    if (!out.has(arm)) out.set(arm, new Map());
    const famMap = out.get(arm);
    for (const probe of r.probes ?? []) {
      if (!isScoredProbe(probe)) continue;
      const fam = probeFamily(probe);
      if (!famMap.has(fam)) famMap.set(fam, []);
      famMap.get(fam).push(probe.found === true ? 1 : 0);
    }
  }
  return out;
}

/**
 * Conversation-level primary rates (unit = one result.json), grouped by mode.
 * Uses conversationPrimaryRate (mean early+late, else plain fact_recall).
 * Skip conversations with no usable fact family (null rate).
 */
function conversationRecallRatesByMode(fase4) {
  const byMode = new Map();
  for (const r of fase4) {
    const mode = modeOf(r);
    if (!mode) continue;
    const rate = conversationPrimaryRate(r);
    if (rate == null || !Number.isFinite(rate)) continue;
    if (!byMode.has(mode)) byMode.set(mode, []);
    byMode.get(mode).push(rate);
  }
  return byMode;
}

/**
 * Probe-level (pseudo-replicated) permutations for every pairwise comparison
 * that the conversation gate also reports — including the primary ciswire arm.
 * Emits one row set per pair so the primary comparison is never missing.
 */
function runFamilyPermutations(fase4, families) {
  const outcomes = familyOutcomes(fase4);
  // mode → arm label used in result.arm for that mode's matrix cell
  const modeToArm = { off: "baseline", anchored: "anchored", ciswire: "ciswire" };
  const mean = (arr) =>
    arr.length === 0 ? null : arr.reduce((s, x) => s + x, 0) / arr.length;
  const tables = [];
  for (const spec of PAIRWISE_SPECS) {
    const armA = modeToArm[spec.modeA];
    const armB = modeToArm[spec.modeB];
    const mapA = outcomes.get(armA) ?? new Map();
    const mapB = outcomes.get(armB) ?? new Map();
    const rows = [];
    for (const family of families) {
      const a = mapA.get(family) ?? [];
      const b = mapB.get(family) ?? [];
      const perm =
        a.length > 0 && b.length > 0
          ? permutationTestOneSided(a, b, PERM_ITERATIONS, PERM_SEED)
          : null;
      rows.push({
        family,
        comparison: spec.label,
        comparisonId: spec.id,
        modeA: spec.modeA,
        modeB: spec.modeB,
        primaryComparison: spec.primary === true,
        // Keep both control/treatment names and the generic rate fields so
        // older schema-2 artifacts remain readable.
        baselineRate: mean(a),
        anchoredRate: mean(b),
        rateA: mean(a),
        rateB: mean(b),
        nA: a.length,
        nB: b.length,
        permutation: perm,
        primary: false,
        probeLevel: true,
      });
    }
    tables.push({
      id: spec.id,
      label: spec.label,
      primary: spec.primary === true,
      modeA: spec.modeA,
      modeB: spec.modeB,
      rows,
    });
  }
  // Flat rows: primary pair first, then others — used by render + harness.
  const flat = tables.flatMap((t) => t.rows);
  return { tables, rows: flat };
}

/**
 * Three pairwise conversation-level tests (same permutation method each).
 * Primary = ciswire vs off. Holm-adjusted p printed alongside raw (no silent
 * multiplicity correction of the raw column).
 */
function runPairwiseConversation(fase4) {
  const primaryEndpoint = resolvePrimaryEndpoint(fase4);
  const byMode = conversationRecallRatesByMode(fase4);
  const mean = (arr) =>
    arr.length === 0 ? null : arr.reduce((s, x) => s + x, 0) / arr.length;

  const pairwise = PAIRWISE_SPECS.map((spec) => {
    const a = byMode.get(spec.modeA) ?? [];
    const b = byMode.get(spec.modeB) ?? [];
    const perm =
      a.length > 0 && b.length > 0
        ? permutationTestOneSided(a, b, PERM_ITERATIONS, PERM_SEED)
        : null;
    const floor = permutationFloor(a.length, b.length, PERM_ITERATIONS);
    const rateA = mean(a);
    const rateB = mean(b);
    return {
      id: spec.id,
      label: spec.label,
      modeA: spec.modeA,
      modeB: spec.modeB,
      primary: spec.primary,
      family: primaryEndpoint,
      unit: "conversation",
      rateA,
      rateB,
      // Legacy field names for the primary pair (modeA=off, modeB=ciswire).
      baselineRate: rateA,
      anchoredRate: rateB,
      nA: a.length,
      nB: b.length,
      permutation: perm,
      floor,
      underpowered: ALPHA <= floor,
      pRaw: perm != null ? perm.p : null,
      pHolm: null,
    };
  });

  const withP = pairwise
    .map((row, i) => ({ i, p: row.pRaw }))
    .filter((x) => x.p != null && Number.isFinite(x.p));
  const adjusted = holmAdjust(withP.map((x) => x.p));
  withP.forEach((x, j) => {
    pairwise[x.i].pHolm = adjusted[j];
  });

  const primary = pairwise.find((r) => r.primary) ?? pairwise[0];
  return { pairwise, primary };
}

/** @deprecated Prefer runPairwiseConversation; kept for primary-only shape. */
function runConversationPrimary(fase4) {
  return runPairwiseConversation(fase4).primary;
}

/**
 * Exploratory per-mode tool-call timing. Null rates are excluded from the
 * mean, never coerced to 0. Counts sum only over results that carry the fields.
 */
function collectToolTimingByMode(fase4) {
  const acc = new Map();
  for (const mode of FASE4_MODES) {
    acc.set(mode, { prec: [], rec: [], spurious: 0, missed: 0, nWithFields: 0 });
  }
  for (const r of fase4) {
    const mode = modeOf(r);
    if (!mode || !acc.has(mode)) continue;
    const row = acc.get(mode);
    const has =
      Object.prototype.hasOwnProperty.call(r, "toolPrecision") ||
      Object.prototype.hasOwnProperty.call(r, "toolRecall") ||
      Object.prototype.hasOwnProperty.call(r, "spuriousCalls") ||
      Object.prototype.hasOwnProperty.call(r, "missedCalls");
    if (!has) continue;
    row.nWithFields += 1;
    if (typeof r.toolPrecision === "number" && Number.isFinite(r.toolPrecision)) {
      row.prec.push(r.toolPrecision);
    }
    if (typeof r.toolRecall === "number" && Number.isFinite(r.toolRecall)) {
      row.rec.push(r.toolRecall);
    }
    if (typeof r.spuriousCalls === "number" && Number.isFinite(r.spuriousCalls)) {
      row.spurious += r.spuriousCalls;
    }
    if (typeof r.missedCalls === "number" && Number.isFinite(r.missedCalls)) {
      row.missed += r.missedCalls;
    }
  }
  return FASE4_MODES.map((mode) => {
    const row = acc.get(mode);
    return {
      mode,
      toolPrecision: row.prec.length === 0 ? null : meanOf(row.prec),
      toolRecall: row.rec.length === 0 ? null : meanOf(row.rec),
      spuriousCalls: row.nWithFields > 0 ? row.spurious : null,
      missedCalls: row.nWithFields > 0 ? row.missed : null,
    };
  });
}

/**
 * Per-mode digest-build timing. The digest ranking runs on every compaction
 * turn. Measured on-device (Hermes on mid-range Android), this is the baseline
 * the CisWire hybrid leg has to be judged against.
 * 
 * digestTelemetry is an array (one entry per turn) of arrays of {durationMs, corpusSize, selectedCount}.
 * We flatten and compute mean/max durationMs per mode.
 */
function collectDigestTimingByMode(fase4) {
  const acc = new Map();
  for (const mode of FASE4_MODES) {
    acc.set(mode, { durations: [], corpus: [], selected: [] });
  }
  for (const r of fase4) {
    const mode = modeOf(r);
    if (!mode || !acc.has(mode)) continue;
    const row = acc.get(mode);
    const telemetry = r.digestTelemetry;
    if (!Array.isArray(telemetry)) continue;
    // digestTelemetry is per-turn array of per-digest arrays
    for (const turnDigest of telemetry) {
      if (!Array.isArray(turnDigest)) continue;
      for (const d of turnDigest) {
        if (typeof d.durationMs === "number" && Number.isFinite(d.durationMs)) {
          row.durations.push(d.durationMs);
        }
        if (typeof d.corpusSize === "number" && Number.isFinite(d.corpusSize)) {
          row.corpus.push(d.corpusSize);
        }
        if (typeof d.selectedCount === "number" && Number.isFinite(d.selectedCount)) {
          row.selected.push(d.selectedCount);
        }
      }
    }
  }
  return FASE4_MODES.map((mode) => {
    const row = acc.get(mode);
    const durations = row.durations;
    return {
      mode,
      meanDurationMs: durations.length === 0 ? null : meanOf(durations),
      maxDurationMs: durations.length === 0 ? null : Math.max(...durations),
      nSamples: durations.length,
      meanCorpusSize: row.corpus.length === 0 ? null : meanOf(row.corpus),
      meanSelectedCount: row.selected.length === 0 ? null : meanOf(row.selected),
    };
  });
}

function findEmptyStoreFailures(rows) {
  return rows.filter((row) => row.hasData && row.totalStored === 0);
}

function collectMemoryTelemetryByMode(fase4) {
  const acc = new Map();
  for (const mode of FASE4_MODES) {
    acc.set(mode, { injected: 0, hasData: false, arm: null });
  }

  for (const r of fase4) {
    const mode = modeOf(r);
    if (!mode || !acc.has(mode)) continue;
    const row = acc.get(mode);
    row.arm = r.arm;
    const telemetry = r.memoryTelemetry;
    if (!Array.isArray(telemetry)) continue;

    // The turn-end line owns memoryEnabled and factsInjected only. All
    // extraction counters are intentionally absent from this aggregate.
    for (const turnTelemetry of telemetry) {
      if (!Array.isArray(turnTelemetry)) continue;
      for (const m of turnTelemetry) {
        if (m.memoryEnabled === 1) row.hasData = true;
        if (typeof m.factsInjected === "number" && m.factsInjected >= 0) {
          row.injected += m.factsInjected;
        }
      }
    }
  }

  return FASE4_MODES.map((mode) => {
    const row = acc.get(mode);
    return {
      mode,
      arm: row.arm,
      hasData: row.hasData,
      totalExtracted: null,
      totalStored: null,
      totalRejectedSensitive: null,
      totalRejectedFull: null,
      totalInjected: row.injected,
      maxFactsInStore: null,
    };
  });
}

/**
 * Settled/late memory telemetry (KALSA_MEMORY_EXTRACT, emitted when extract
 * job completes). Same shape as collectMemoryTelemetryByMode but reads from
 * memoryExtractTelemetry. This is the figure the NOT-RUN verdict keys off,
 * because the turn-end snapshot is known to be premature.
 */
function collectMemoryExtractTelemetryByMode(fase4) {
  const acc = new Map();
  for (const mode of FASE4_MODES) {
    acc.set(mode, {
      extracted: 0,
      stored: 0,
      rejectedSensitive: 0,
      rejectedFull: 0,
      maxInStore: 0,
      parseOutcomes: [],
      gateSources: [],
      stopReasons: [],
      hasData: false,
      arm: null,
    });
  }
  
  for (const r of fase4) {
    const mode = modeOf(r);
    if (!mode || !acc.has(mode)) continue;
    const row = acc.get(mode);
    row.arm = r.arm;
    const telemetry = r.memoryExtractTelemetry;
    if (!Array.isArray(telemetry)) continue;
    
    for (const turnTelemetry of telemetry) {
      if (!Array.isArray(turnTelemetry)) continue;
      for (const m of turnTelemetry) {
        if (m.memoryEnabled === 1) {
          row.hasData = true;
        }
        if (typeof m.factsExtracted === "number" && m.factsExtracted >= 0) row.extracted += m.factsExtracted;
        if (typeof m.factsStored === "number" && m.factsStored >= 0) row.stored += m.factsStored;
        if (typeof m.factsRejectedSensitive === "number" && m.factsRejectedSensitive >= 0) row.rejectedSensitive += m.factsRejectedSensitive;
        if (typeof m.factsRejectedFull === "number" && m.factsRejectedFull >= 0) row.rejectedFull += m.factsRejectedFull;
        if (typeof m.totalFactsInStore === "number" && m.totalFactsInStore >= 0) {
          row.maxInStore = Math.max(row.maxInStore, m.totalFactsInStore);
        }
        for (const [field, values] of [
          ["extractParseOutcome", row.parseOutcomes],
          ["extractGateSource", row.gateSources],
          ["extractStopReason", row.stopReasons],
        ]) {
          const value = m[field];
          if (typeof value === "number" && value >= 0 && !values.includes(value)) {
            values.push(value);
          }
        }
      }
    }
  }
  
  return FASE4_MODES.map((mode) => {
    const row = acc.get(mode);
    return {
      mode,
      arm: row.arm,
      hasData: row.hasData,
      totalExtracted: row.extracted,
      totalStored: row.stored,
      totalRejectedSensitive: row.rejectedSensitive,
      totalRejectedFull: row.rejectedFull,
      maxFactsInStore: row.maxInStore,
      extractParseOutcomes: row.parseOutcomes,
      extractGateSources: row.gateSources,
      extractStopReasons: row.stopReasons,
    };
  });
}

function accumulateToolTiming(results) {
  const acc = { prec: [], rec: [], spurious: 0, missed: 0, blocked: 0, n: 0 };
  for (const r of results) {
    const has =
      Object.prototype.hasOwnProperty.call(r, "toolPrecision") ||
      Object.prototype.hasOwnProperty.call(r, "toolRecall") ||
      Object.prototype.hasOwnProperty.call(r, "spuriousCalls") ||
      Object.prototype.hasOwnProperty.call(r, "missedCalls") ||
      Object.prototype.hasOwnProperty.call(r, "privacyBlocks");
    if (!has) continue;
    acc.n += 1;
    if (typeof r.toolPrecision === "number" && Number.isFinite(r.toolPrecision)) {
      acc.prec.push(r.toolPrecision);
    }
    if (typeof r.toolRecall === "number" && Number.isFinite(r.toolRecall)) {
      acc.rec.push(r.toolRecall);
    }
    if (typeof r.spuriousCalls === "number" && Number.isFinite(r.spuriousCalls)) {
      acc.spurious += r.spuriousCalls;
    }
    if (typeof r.missedCalls === "number" && Number.isFinite(r.missedCalls)) {
      acc.missed += r.missedCalls;
    }
    if (typeof r.privacyBlocks === "number" && Number.isFinite(r.privacyBlocks)) {
      acc.blocked += r.privacyBlocks;
    }
  }
  return {
    toolPrecision: acc.prec.length === 0 ? null : meanOf(acc.prec),
    toolRecall: acc.rec.length === 0 ? null : meanOf(acc.rec),
    spuriousCalls: acc.n > 0 ? acc.spurious : null,
    missedCalls: acc.n > 0 ? acc.missed : null,
    blockedCalls: acc.n > 0 ? acc.blocked : null,
  };
}

/**
 * Observed toolGateActive on one arm. A missing field is not "false" —
 * old artifacts omit it and must not be assumed from the arm label.
 * @returns {{kind: "missing_arm"|"absent"|"mixed"|"value", value?: boolean}}
 */
function uniqueObservedToolGate(fase4, arm) {
  const rows = fase4.filter((r) => String(r.arm) === arm);
  if (rows.length === 0) return { kind: "missing_arm" };
  const values = [];
  for (const r of rows) {
    if (!Object.prototype.hasOwnProperty.call(r, "toolGateActive")) {
      return { kind: "absent" };
    }
    const v = r.toolGateActive;
    if (v === null || v === undefined) return { kind: "absent" };
    values.push(v);
  }
  const first = values[0];
  for (let i = 1; i < values.length; i++) {
    if (!Object.is(values[i], first)) return { kind: "mixed" };
  }
  return { kind: "value", value: first };
}

/**
 * Exploratory gate A/B: baseline (gate on) vs nogate (toolgate 0).
 * Not gated. Missing nogate → n/a row, never a completeness failure.
 * Pair only when observed toolGateActive values actually differ.
 */
function collectToolTimingGateAB(fase4) {
  const ofArm = (arm) =>
    accumulateToolTiming(fase4.filter((r) => String(r.arm) === arm));
  const baseGate = uniqueObservedToolGate(fase4, "baseline");
  const nogateGate = uniqueObservedToolGate(fase4, "nogate");
  let status = "incomplete";
  if (baseGate.kind === "missing_arm" || nogateGate.kind === "missing_arm") {
    status = "incomplete";
  } else if (baseGate.kind === "absent" || nogateGate.kind === "absent") {
    status = "absent";
  } else if (
    baseGate.kind === "value" &&
    nogateGate.kind === "value" &&
    !Object.is(baseGate.value, nogateGate.value)
  ) {
    status = "ok";
  } else {
    status = "same";
  }
  return {
    status,
    baseGate,
    nogateGate,
    baseline: { arm: "baseline", ...ofArm("baseline") },
    nogate: { arm: "nogate", ...ofArm("nogate") },
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
        // UI TTFT (elapsed_s / ttftApprox_s) — not wall turn duration.
        // Evidence: smoke run 31358530713, elapsed_s ≈ promptMs/1000.
        ttftApprox_s: [],
        // Σ(promptMs+predictedMs) telemetry lower bound on turn work.
        turnComputeMs: [],
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
      // Prefer honest name; fall back to elapsed_s for older result.json.
      if (typeof turn.ttftApprox_s === "number") {
        g.ttftApprox_s.push(turn.ttftApprox_s);
      } else if (typeof turn.elapsed_s === "number") {
        g.ttftApprox_s.push(turn.elapsed_s);
      }
      if (typeof turn.turnComputeMs === "number") {
        g.turnComputeMs.push(turn.turnComputeMs);
      }
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
    meanTtftApproxS: meanOf(g.ttftApprox_s),
    nTtftApproxS: g.ttftApprox_s.length,
    meanTurnComputeMs: meanOf(g.turnComputeMs),
    nTurnComputeMs: g.turnComputeMs.length,
  }));

  const anyPrefill = rows.some(
    (r) =>
      r.nPromptMs > 0 ||
      r.nReuseFrac > 0 ||
      r.nPromptTokens > 0 ||
      r.nTtftApproxS > 0 ||
      r.nTurnComputeMs > 0,
  );
  return { rows, anyPrefill };
}

/**
 * Compare one control/treatment pair on a single seed's positiveControl blobs.
 *
 * Prompt-token divergence (`different`) is rendered only: different reply
 * lengths at turn 1 make later histories diverge even when no compaction
 * mechanism ran (generation noise). Real mechanism evidence is mode-dependent:
 *   - ciswire: only digestCharsByTurn[t] > 0 for some t ≥ 2
 *     (boundary still advances in state but is not used for history assembly)
 *   - anchored: boundaryByTurn[t] > 0 for some t ≥ 2 (the advanced boundary
 *     is exactly the truncation that defines this arm)
 * `compactorChars` alone is hollow and must not yield ARMS DIFFER.
 */
function scorePositivePair(pcA, pcB, { treatmentArm }) {
  const tokensA = pcA.promptTokensByTurn ?? {};
  const tokensB = pcB.promptTokensByTurn ?? {};
  const compA =
    typeof pcA.compactorChars === "number" ? pcA.compactorChars : 0;
  const compB =
    typeof pcB.compactorChars === "number" ? pcB.compactorChars : 0;

  const allCommon = Object.keys(tokensA)
    .filter((t) => Object.prototype.hasOwnProperty.call(tokensB, t))
    .sort((a, b) => Number(a) - Number(b));

  // Turn 1 is assembled before any compaction has happened and is EXPECTED
  // to match across arms — exclude it from the identical/differ verdict.
  const commonTurns = allCommon.filter((t) => Number(t) !== 1);

  // Rendered column only — not mechanism evidence (generation noise).
  let different = 0;
  for (const t of commonTurns) {
    if (tokensA[t] !== tokensB[t]) different += 1;
  }

  // Real retrieval signal for ciswire: frozenDigest length on some turn ≥ 2.
  const digestB = pcB.digestCharsByTurn ?? {};
  let hasTreatmentDigest = false;
  for (const t of Object.keys(digestB)) {
    if (Number(t) >= 2 && typeof digestB[t] === "number" && digestB[t] > 0) {
      hasTreatmentDigest = true;
      break;
    }
  }

  // Real mechanism signal for anchored: boundary advanced on some turn ≥ 2.
  const boundaryB = pcB.boundaryByTurn ?? {};
  let hasTreatmentBoundary = false;
  for (const t of Object.keys(boundaryB)) {
    if (Number(t) >= 2 && typeof boundaryB[t] === "number" && boundaryB[t] > 0) {
      hasTreatmentBoundary = true;
      break;
    }
  }

  // Mode-dependent: token divergence never contributes to the verdict.
  const mode = ARM_TO_MODE[treatmentArm] ?? String(treatmentArm);
  const realMechanism =
    mode === "ciswire"
      ? hasTreatmentDigest
      : hasTreatmentBoundary;

  let verdict;
  if (allCommon.length === 0 && !realMechanism && !(compA > 0 || compB > 0)) {
    verdict = "NO OVERLAPPING PROMPT TOKENS";
  } else if (commonTurns.length === 0 && !realMechanism) {
    verdict = "INSUFFICIENT — turn 1 only (excluded; pre-compaction)";
  } else if (realMechanism) {
    verdict = "ARMS DIFFER";
  } else {
    verdict = "MEASURING NOTHING";
  }

  return {
    compared: commonTurns.length,
    different,
    verdict,
    treatmentArm,
    treatmentCompactorChars: compB,
    baselineCompactorChars: compA,
    // Legacy column name used by the markdown table for the anchored pair.
    anchoredCompactorChars: compB,
  };
}

function collectPositiveControl(fase4) {
  // seed -> arm -> positiveControl
  // After smoke run 31358530713: compare promptTokensByTurn (embd.size) and
  // compactorChars — never promptSha* (logcat 4 KB truncation made hashes constant).
  // Primary pair is baseline↔ciswire (the declared comparison); also check
  // baseline↔anchored so a silent ciswire no-op cannot hide behind a green anchored control.
  const bySeed = new Map();
  for (const r of fase4) {
    const seed = String(r.seed);
    const arm = String(r.arm);
    if (!bySeed.has(seed)) bySeed.set(seed, {});
    bySeed.get(seed)[arm] = r.positiveControl ?? null;
  }

  /** @type {{ armA: string, armB: string, primary: boolean }[]} */
  const pairs = [
    { armA: "baseline", armB: "ciswire", primary: true },
    { armA: "baseline", armB: "anchored", primary: false },
  ];

  const rows = [];
  let anyIdentical = false;
  let anyPass = false;
  let anyFail = false;
  let seedsWithPrimaryPair = 0;
  let seedsWithAnyPair = 0;
  let primaryIdentical = false;

  for (const seed of [...bySeed.keys()].sort()) {
    const arms = bySeed.get(seed);
    let seedHadPair = false;
    for (const { armA, armB, primary } of pairs) {
      if (!arms[armA] || !arms[armB]) continue;
      seedHadPair = true;
      if (primary) seedsWithPrimaryPair += 1;
      const scored = scorePositivePair(arms[armA], arms[armB], {
        treatmentArm: armB,
      });
      const pass = scored.verdict === "ARMS DIFFER";
      const fail = !pass;
      if (pass) anyPass = true;
      if (fail) {
        anyFail = true;
        if (
          scored.verdict === "MEASURING NOTHING" ||
          scored.verdict === "NO OVERLAPPING PROMPT TOKENS" ||
          scored.verdict.startsWith("INSUFFICIENT")
        ) {
          anyIdentical = true;
        }
        // Primary pair identical prompts = the single worst outcome.
        if (primary && scored.verdict === "MEASURING NOTHING") {
          primaryIdentical = true;
        }
      }
      rows.push({
        seed,
        pair: `${armA}↔${armB}`,
        primary,
        compared: scored.compared,
        different: scored.different,
        verdict: scored.verdict,
        anchoredCompactorChars: scored.anchoredCompactorChars,
        baselineCompactorChars: scored.baselineCompactorChars,
        treatmentArm: armB,
        treatmentCompactorChars: scored.treatmentCompactorChars,
      });
    }
    if (seedHadPair) seedsWithAnyPair += 1;
  }

  // Fail closed when the primary pair never appears (ciswire arm missing).
  const absentBothArms = seedsWithPrimaryPair === 0 && seedsWithAnyPair === 0;
  const absentPrimary = seedsWithPrimaryPair === 0;

  return {
    rows,
    anyIdentical,
    anyFail,
    anyPass,
    absentBothArms: absentBothArms || absentPrimary,
    primaryIdentical,
    // Gate fails if primary absent, any fail, primary identical, or no pass.
    gateFailed:
      absentBothArms ||
      absentPrimary ||
      anyFail ||
      primaryIdentical ||
      !anyPass,
  };
}

function collectNotes(fase4) {
  // Dedupe by note text; keep every (arm, seed) that produced it.
  const map = new Map(); // note -> [{arm, seed}]
  const add = (text, arm, seed) => {
    if (!map.has(text)) map.set(text, []);
    map.get(text).push({ arm: String(arm), seed });
  };
  for (const r of fase4) {
    for (const note of r.notes ?? []) {
      add(String(note), r.arm, r.seed);
    }
    // Product signals the grader surfaces as arrays; always caveat them even
    // if notes were stripped or from an older partial result shape.
    if (Array.isArray(r.contextFullTurns) && r.contextFullTurns.length > 0) {
      add(
        `contextFullTurns [${r.contextFullTurns.join(", ")}] — arm hit the context wall`,
        r.arm,
        r.seed,
      );
    }
    if (Array.isArray(r.errorTurns) && r.errorTurns.length > 0) {
      add(
        `errorTurns [${r.errorTurns.join(", ")}] — probe results on those turns are not trustworthy`,
        r.arm,
        r.seed,
      );
    }
  }
  return [...map.entries()].map(([note, sources]) => ({ note, sources }));
}

/**
 * Usable-conversation completeness: per mode, require BENCH_EXPECT_SEEDS
 * conversations with a non-null primary rate. File presence alone is not
 * enough — null rates (all fact probes excluded) silently shrink n and can
 * leave the primary pair with zero usable conversations while the run exits 0.
 */
function findInsufficientUsable(fase4) {
  const n = expectSeeds();
  if (n <= 0) return { perMode: [], primaryZero: false };
  const byMode = conversationRecallRatesByMode(fase4);
  const perMode = [];
  for (const mode of FASE4_MODES) {
    const usable = (byMode.get(mode) ?? []).length;
    if (usable < n) {
      perMode.push({ mode, usable, expected: n });
    }
  }
  const nOff = (byMode.get("off") ?? []).length;
  const nCis = (byMode.get("ciswire") ?? []).length;
  const primaryZero = nOff === 0 || nCis === 0;
  return { perMode, primaryZero, nOff, nCis };
}

function aggregateFase4(results) {
  const fase4 = listFase4(results);
  // Compaction completeness + primary stay on the three modes only.
  // Exploratory arms (arm not in ARM_TO_MODE) share a mode with baseline.
  const compaction = fase4.filter(isCompactionModeResult);
  const { rows: familyRows, families } = familyStatsPerArm(compaction);
  const familyPerm = runFamilyPermutations(compaction, families);
  const permutations = familyPerm.rows;
  const familyPermTables = familyPerm.tables;
  const { pairwise, primary: conversationPrimary } =
    runPairwiseConversation(compaction);
  const prefill = collectPrefill(compaction);
  const positiveControl = collectPositiveControl(compaction);
  const notes = collectNotes(fase4);
  const toolTimingByMode = collectToolTimingByMode(compaction);
  const digestTimingByMode = collectDigestTimingByMode(compaction);
  const memoryTelemetryByMode = collectMemoryTelemetryByMode(compaction);
  const memoryExtractTelemetryByMode = collectMemoryExtractTelemetryByMode(compaction);
  const toolTimingGateAB = collectToolTimingGateAB(fase4);

  const gated = shouldGateFase4();
  const seedsInfo = expectSeedsInfo();
  const missing = gated ? findMissingPairs(compaction) : [];
  const invalidCompaction = gated ? findInvalidCompaction(compaction) : [];
  const duplicates = gated ? findDuplicatePairs(compaction) : [];
  const zeroProbes = gated ? findZeroProbeFiles(compaction) : [];
  const usableInfo = gated
    ? findInsufficientUsable(compaction)
    : { perMode: [], primaryZero: false };
  const insufficientUsable = usableInfo.perMode;
  const primaryUsableZero = usableInfo.primaryZero === true;
  // Primary gate: ciswire vs off conversation-level p ONLY (not probe-level).
  const primary = conversationPrimary;
  let gateMet = false;
  if (
    primary &&
    primary.permutation &&
    primary.rateA != null &&
    primary.rateB != null &&
    !primary.underpowered
  ) {
    gateMet =
      primary.rateB > primary.rateA && primary.permutation.p < ALPHA;
  }

  return {
    fase4,
    familyRows,
    families,
    permutations,
    familyPermTables,
    conversationPrimary,
    pairwise,
    toolTimingByMode,
    digestTimingByMode,
    memoryTelemetryByMode,
    memoryExtractTelemetryByMode,
    toolTimingGateAB,
    prefill,
    positiveControl,
    notes,
    missing,
    invalidCompaction,
    duplicates,
    zeroProbes,
    insufficientUsable,
    primaryUsableZero,
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
  lines.push(
    "## Fase 4 — compaction-survival (off / anchored / ciswire)",
  );
  if (agg.fase4.length === 0) {
    lines.push("", "_No fase4 result.json files found._", "");
    // Still show incompleteness below when gated with zero files.
    return { body: lines.join("\n"), failParts: renderGateFailures(agg) };
  }

  // ── Per-family rates ────────────────────────────────────────────────
  // Primary endpoint is mean(early, late) when that layout is present —
  // no single family row carries PRIMARY except legacy plain fact_recall.
  const primaryFam =
    agg.conversationPrimary?.family ?? PRIMARY_FAMILY_LEGACY;
  lines.push("", "### Per-family recall", "");
  // early vs late = decay curve (the point of the layout); primary is their
  // per-conversation mean, not either family alone.
  if (
    agg.families.includes("fact_recall_early") ||
    agg.families.includes("fact_recall_late")
  ) {
    lines.push(
      "_fact_recall_early and fact_recall_late are the two distances on the decay curve; the primary endpoint is their per-conversation mean (not either family alone)._",
      "",
    );
  }
  lines.push(
    "| arm | family | rate | found/total | excluded | seeds |",
    "|---|---|---|---|---|---|",
  );
  if (agg.familyRows.length === 0) {
    lines.push("| — | — | n/a | 0/0 | 0 | 0 |");
  } else {
    for (const r of agg.familyRows) {
      const mark =
        r.family === primaryFam && primaryFam === PRIMARY_FAMILY_LEGACY
          ? " **(PRIMARY)**"
          : "";
      const rateStr = r.rate == null ? "n/a" : fmt(r.rate);
      lines.push(
        `| ${r.arm} | ${r.family}${mark} | ${rateStr} | ${r.found}/${r.total} | ${r.excluded ?? 0} | ${r.seeds} |`,
      );
    }
  }

  // ── Pairwise conversation-level tests (3 pairs, Holm alongside raw) ─
  const pairwise = agg.pairwise ?? [];
  const cp = agg.conversationPrimary;
  lines.push(
    "",
    "### Pairwise tests: fact recall, unit = conversation",
    "",
    primaryFam === PRIMARY_ENDPOINT_MEAN
      ? `_Primary endpoint: \`${primaryFam}\` — one number per conversation = mean of that conversation's early and late fact-recall rates._`
      : `_Primary endpoint: \`${primaryFam}\` (legacy plain family; early/late layout absent)._`,
    "",
    "**Three pairwise one-sided permutation tests are run. Raw p-values are NOT corrected for multiplicity.** Holm-adjusted p-values are shown alongside; do not silently pick the best raw p.",
    "",
    // Columns follow the comparison label, treatment first: "ciswire vs off"
    // prints ciswire then off. Generic "mean A / mean B" read backwards against
    // the label (A is the control) and invited exactly one misreading already.
    "| comparison | primary? | mean treatment | mean control | Δ | p (raw) | p (Holm) | n treatment | n control | design floor | method |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );

  let anyPerm = false;
  for (const row of pairwise) {
    const perm = row.permutation;
    if (perm) anyPerm = true;
    const observed = perm ? perm.observed : null;
    const deltaStr =
      observed == null
        ? "n/a"
        : `${observed >= 0 ? "+" : ""}${fmt(observed)}`;
    const pRaw =
      row.pRaw != null ? fmt(row.pRaw, 4) : "n/a";
    const pHolm =
      row.pHolm != null ? fmt(row.pHolm, 4) : "n/a";
    const methodLabel = perm?.methodLabel ?? "n/a";
    lines.push(
      `| ${row.label} | ${row.primary ? "yes" : "no"} | ${fmt(row.rateB)} | ${fmt(row.rateA)} | ${deltaStr} | ${pRaw} | ${pHolm} | ${row.nB} | ${row.nA} | ${fmt(row.floor, 4)} | ${methodLabel} |`,
    );
  }

  if (anyPerm) {
    lines.push(
      "",
      `Permutation methods (per row): exact enumeration when C(nA+nB, nB) ≤ ${PERM_ITERATIONS}, else Monte Carlo with deterministic mulberry32 PRNG (seed=${PERM_SEED}). Add-one smoothing on both paths. Design floor = max( exhaustive (1+1)/(C(nA+nB,nB)+1), Monte-Carlo 1/(iterations+1) ).`,
    );
    const under = pairwise.filter((r) => r.underpowered && r.permutation);
    if (under.length > 0) {
      lines.push(
        "",
        `> **⚠ DESIGN UNDERPOWERED FOR α=${ALPHA}** on: ${under.map((r) => r.label).join(", ")}. Achievable floor ≥ α — gate cannot be met for those pairs regardless of effect size.`,
      );
    }
    lines.push("");
    if (cp?.permutation) {
      const { observed, p } = cp.permutation;
      if (agg.gateMet) {
        lines.push(
          `**Primary gate (ciswire vs off, conversation-level fact_recall only):** ciswire (${fmt(cp.rateB)}) > off (${fmt(cp.rateA)}) AND p_raw=${fmt(p, 4)} < ${ALPHA} → **MET**.`,
        );
      } else {
        lines.push(
          `**Primary gate (ciswire vs off, conversation-level fact_recall only):** ${
            cp.rateB != null && cp.rateA != null
              ? `ciswire (${fmt(cp.rateB)}) vs off (${fmt(cp.rateA)}), p_raw=${fmt(p, 4)}`
              : "insufficient data"
          } → gate NOT met.`,
        );
      }
    }
  } else {
    lines.push(
      "",
      "_Permutation tests skipped: need both modes in each pair with at least one conversation that has a non-null fact_recall rate._",
    );
  }

  // ── Exploratory: tool-call timing (reported only, not gated) ────────
  lines.push(
    "",
    "### Exploratory: tool-call timing",
    "",
    "_Exploratory — not gated, not the primary endpoint. Precision = correct executed calls / all executed calls on `must`/`must_not` turns; recall = `must` turns with ≥1 executed call. `either` turns excluded. Empty denominator → n/a, never 0._",
    "",
    "| mode | precision | recall | spurious | missed |",
    "|---|---|---|---|---|",
  );
  const toolTiming = agg.toolTimingByMode ?? [];
  const timingByMode = new Map(toolTiming.map((r) => [r.mode, r]));
  if (toolTiming.length === 0) {
    lines.push("| — | n/a | n/a | n/a | n/a |");
  } else {
    for (const row of toolTiming) {
      const sp = row.spuriousCalls == null ? "n/a" : String(row.spuriousCalls);
      const miss = row.missedCalls == null ? "n/a" : String(row.missedCalls);
      lines.push(
        `| ${row.mode} | ${fmt(row.toolPrecision)} | ${fmt(row.toolRecall)} | ${sp} | ${miss} |`,
      );
    }
  }
  lines.push(
    "",
    "| comparison | precision A | precision B | recall A | recall B | spurious A | spurious B | missed A | missed B |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const spec of PAIRWISE_SPECS) {
    const a = timingByMode.get(spec.modeA);
    const b = timingByMode.get(spec.modeB);
    const cell = (row, key) => {
      if (!row) return "n/a";
      const v = row[key];
      if (v == null) return "n/a";
      return key === "spuriousCalls" || key === "missedCalls" ? String(v) : fmt(v);
    };
    lines.push(
      `| ${spec.label} | ${cell(a, "toolPrecision")} | ${cell(b, "toolPrecision")} | ${cell(a, "toolRecall")} | ${cell(b, "toolRecall")} | ${cell(a, "spuriousCalls")} | ${cell(b, "spuriousCalls")} | ${cell(a, "missedCalls")} | ${cell(b, "missedCalls")} |`,
    );
  }

  // Gate A/B: baseline vs nogate only — exploratory, never a completeness cell.
  const gateAB = agg.toolTimingGateAB;
  lines.push(
    "",
    "#### Gate A/B (exploratory): baseline vs nogate",
    "",
    "_Same compaction (`off`) and `tool_choice` (auto); gate is the only variable. Not gated. Missing nogate is n/a, not INCOMPLETE._",
  );
  const gateRow = (row, label) => {
    if (!row) {
      return `| ${label} | n/a | n/a | n/a | n/a | n/a |`;
    }
    const sp = row.spuriousCalls == null ? "n/a" : String(row.spuriousCalls);
    const miss = row.missedCalls == null ? "n/a" : String(row.missedCalls);
    const blk = row.blockedCalls == null ? "n/a" : String(row.blockedCalls);
    return `| ${label} | ${fmt(row.toolPrecision)} | ${fmt(row.toolRecall)} | ${sp} | ${miss} | ${blk} |`;
  };
  const pushGateTable = () => {
    lines.push(
      "",
      "| arm | precision | recall | spurious | missed | blocked |",
      "|---|---|---|---|---|---|",
    );
    lines.push(gateRow(gateAB?.baseline, "baseline"));
    lines.push(gateRow(gateAB?.nogate, "nogate"));
  };
  // Pair only on observed toolGateActive, never on the arm label.
  if (gateAB?.status === "ok") {
    pushGateTable();
  } else if (gateAB?.status === "absent") {
    lines.push(
      "",
      "_Gate A/B skipped: toolGateActive absent on at least one arm (old artifact; not assumed from the arm label)._",
    );
  } else if (gateAB?.status === "same") {
    lines.push(
      "",
      "_Gate A/B not interpretable: observed toolGateActive is identical on baseline and nogate (a label is not evidence)._",
    );
  } else {
    // One arm missing — n/a table, not a result that pretends the gate differed.
    pushGateTable();
  }

  // ── Digest-build cost, measured on device ───────────────────────────
  // The digest ranking runs on every compaction turn, and on a phone that is
  // often. Reported so "the ranking is fast enough" is a number from Hermes,
  // not an extrapolation from a laptop.
  lines.push(
    "",
    "### Digest build cost (on-device)",
    "",
    "_Wall-clock ms per `buildDigest` call, from `KALSA_DIGEST`. Absent telemetry is n/a, never 0 — an unmeasured cost must not read as a free one._",
    "",
    "| mode | mean ms | max ms | samples | mean corpus | mean selected |",
    "|---|---|---|---|---|---|",
  );
  const digestTiming = agg.digestTimingByMode ?? [];
  if (digestTiming.length === 0) {
    lines.push("| — | n/a | n/a | 0 | n/a | n/a |");
  } else {
    for (const row of digestTiming) {
      const ms = (v) => (v == null ? "n/a" : v.toFixed(1));
      const n = (v) => (v == null ? "n/a" : v.toFixed(1));
      lines.push(
        `| ${row.mode} | ${ms(row.meanDurationMs)} | ${ms(row.maxDurationMs)} | ${row.nSamples} | ${n(row.meanCorpusSize)} | ${n(row.meanSelectedCount)} |`,
      );
    }
  }

  // ── Memory subsystem telemetry ──────────────────────────────────────
  // Memory is opt-in (MEMORY env var). When enabled, we track extraction,
  // storage, rejection, and injection counters. This proves the mechanism ran.
  //
  // Two rows per mode: turn-end snapshot AND settled (extract-complete).
  // The settled row is the one the NOT-RUN verdict keys off, because the
  // turn-end snapshot is known to be premature.
  lines.push(
    "",
    "### Memory subsystem telemetry",
    "",
    "_Opt-in via `MEMORY=1` env var. Counters prove the extraction/storage/injection path ran. Empty-store with hasData=true means the mechanism was invoked but stored nothing — a broken arm._",
    "",
    "#### Turn-end snapshot",
    "",
    "| mode | arm | has data | injected |",
    "|---|---|---|---|",
  );
  const memoryMetric = (value) => value == null ? "n/a" : value;
  const memoryTelemetry = agg.memoryTelemetryByMode ?? [];
  if (memoryTelemetry.length === 0) {
    lines.push("| — | — | — | — |");
  } else {
    for (const row of memoryTelemetry) {
      const hasData = row.hasData ? "yes" : "no";
      lines.push(
        `| ${row.mode} | ${row.arm || "—"} | ${hasData} | ${memoryMetric(row.totalInjected)} |`,
      );
    }
  }
  
  lines.push(
    "",
    "#### Settled (extract-complete) — keys the NOT-RUN verdict",
    "",
    "| mode | arm | has data | extracted | stored | rejected (sensitive) | rejected (full) | max in store | parse outcomes | gate sources | stop reasons |",
    "|---|---|---|---|---|---|---|---|---|---|---|",
  );
  const memoryExtractTelemetry = agg.memoryExtractTelemetryByMode ?? [];
  if (memoryExtractTelemetry.length === 0) {
    lines.push("| — | — | — | — | — | — | — | — | — | — | — |");
  } else {
    for (const row of memoryExtractTelemetry) {
      const hasData = row.hasData ? "yes" : "no";
      lines.push(
        `| ${row.mode} | ${row.arm || "—"} | ${hasData} | ${memoryMetric(row.totalExtracted)} | ${memoryMetric(row.totalStored)} | ${memoryMetric(row.totalRejectedSensitive)} | ${memoryMetric(row.totalRejectedFull)} | ${memoryMetric(row.maxFactsInStore)} | ${(row.extractParseOutcomes ?? []).join(",") || "n/a"} | ${(row.extractGateSources ?? []).join(",") || "n/a"} | ${(row.extractStopReasons ?? []).join(",") || "n/a"} |`,
      );
    }
  }
  
  // Check for empty-store failures — keyed off the SETTLED figures, not the
  // turn-end snapshot, because the snapshot is known to be premature.
  const emptyStoreFailures = findEmptyStoreFailures(memoryExtractTelemetry);
  if (emptyStoreFailures.length > 0) {
    lines.push(
      "",
      "**⚠ MEMORY SUBSYSTEM FAILURE (NOT-RUN verdict — settled figures):** The following arms have settled memory telemetry data but stored zero facts:",
      "",
      "| mode | arm | extracted | rejected (sensitive) | rejected (full) |",
      "|---|---|---|---|---|",
    );
    for (const row of emptyStoreFailures) {
      lines.push(
        `| ${row.mode} | ${row.arm} | ${row.totalExtracted} | ${row.totalRejectedSensitive} | ${row.totalRejectedFull} |`,
      );
    }
    lines.push(
      "",
      "_This means the extraction job ran but nothing was stored. Check sensitive filter or cap limits. Verdict keyed off settled (extract-complete) figures, not turn-end snapshot._",
    );
  }

  // ── Probe-level (pseudo-replicated — NOT the gate) ──────────────────
  // One table per pairwise comparison so the primary ciswire arm is present.
  lines.push(
    "",
    "### Probe-level rates (pseudo-replicated — NOT the gate)",
    "",
    "Probes inside one conversation share model, context and seed, so they are correlated; this p is optimistic and must not be used as the V4.2 gate.",
    "",
  );
  const famTables =
    agg.familyPermTables ??
    [{ label: "baseline vs anchored", primary: false, rows: agg.permutations ?? [] }];
  for (const table of famTables) {
    const head = table.primary
      ? `#### ${table.label} (primary comparison)`
      : `#### ${table.label}`;
    lines.push(head, "");
    lines.push(
      `| family | ${table.modeB ?? "B"} | ${table.modeA ?? "A"} | Δ | p (one-sided) | method |`,
      "|---|---|---|---|---|---|",
    );
    for (const row of table.rows ?? []) {
      const feedsPrimary =
        primaryFam === PRIMARY_ENDPOINT_MEAN
          ? row.family === "fact_recall_early" ||
            row.family === "fact_recall_late"
          : row.family === primaryFam;
      const label = feedsPrimary
        ? `${row.family} (probe-level, pseudo-replicated — NOT the gate)`
        : `${row.family} (secondary, not multiplicity-corrected)`;
      const rateA = row.rateA ?? row.baselineRate;
      const rateB = row.rateB ?? row.anchoredRate;
      if (!row.permutation) {
        lines.push(
          `| ${label} | ${rateB == null ? "n/a" : fmt(rateB)} | ${rateA == null ? "n/a" : fmt(rateA)} | n/a | n/a (missing arm) | n/a |`,
        );
        continue;
      }
      const { observed, p, methodLabel } = row.permutation;
      const delta = `${observed >= 0 ? "+" : ""}${fmt(observed)}`;
      const pNote = feedsPrimary
        ? `${fmt(p, 4)} — optimistic; probes in one conversation are correlated`
        : `${fmt(p, 4)} — not multiplicity-corrected; a single secondary p < 0.05 among four is not evidence on its own`;
      lines.push(
        `| ${label} | ${rateB == null ? "n/a" : fmt(rateB)} | ${rateA == null ? "n/a" : fmt(rateA)} | ${delta} | ${pNote} | ${methodLabel ?? "n/a"} |`,
      );
    }
    lines.push("");
  }

  // ── Prefill / TTFT ──────────────────────────────────────────────────
  // Labels are honest: elapsed_s was never turn duration (run 31358530713:
  // UI persists assistant at first token; elapsed_s ≈ promptMs). No p-value
  // on these three — descriptive means only, not a hypothesis test.
  lines.push("", "### Prefill / TTFT", "");
  if (!agg.prefill.anyPrefill) {
    lines.push(
      "_Prefill telemetry is absent (no arm has promptMs / TTFT / turnComputeMs)._",
    );
  } else {
    lines.push(
      "| arm | mean KV reuse (reuseFrac) | mean prefill ms (promptMs) | mean prompt tokens | mean TTFT s (UI, ±15 s) | mean turn compute ms (prefill+decode) |",
      "|---|---|---|---|---|---|",
    );
    for (const r of agg.prefill.rows) {
      lines.push(
        `| ${r.arm} | ${fmtMean(r.meanReuseFrac, r.nReuseFrac, 3)} | ${fmtMean(r.meanPromptMs, r.nPromptMs, 1)} | ${fmtMean(r.meanPromptTokens, r.nPromptTokens, 0)} | ${fmtMean(r.meanTtftApproxS, r.nTtftApproxS, 1)} | ${fmtMean(r.meanTurnComputeMs, r.nTurnComputeMs, 1)} |`,
      );
    }
    lines.push(
      "",
      "_`reuseFrac` is the KV prefix the engine reused; on LFM2 it is bimodal (0 or ~0.98, HARNESS_FINDINGS §7.12), so a MEAN of it is a hit RATE, not a fraction of a prompt — read it as \"how often the cache survived\". TTFT is polled at 15 s granularity (UI-observed time to first assistant persistence); turn compute is Σ(promptMs+predictedMs) from telemetry (lower bound on wall work, excludes UI/storage). Neither is a stopwatch on full wall time. Means are descriptive only — no p-value._",
    );
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
      "**positive control absent — cannot prove the arms differed** (no seed with `positiveControl` in both baseline and ciswire, the primary pair).",
    );
  } else {
    lines.push(
      "| seed | pair | primary? | turns compared | turns differing | treatment compactorChars | baseline compactorChars | verdict |",
      "|---|---|---|---|---|---|---|---|",
    );
    for (const r of agg.positiveControl.rows) {
      const treatChars =
        r.treatmentCompactorChars ?? r.anchoredCompactorChars ?? 0;
      lines.push(
        `| ${r.seed} | ${r.pair ?? "baseline↔anchored"} | ${r.primary ? "yes" : "no"} | ${r.compared} | ${r.different} | ${treatChars} | ${r.baselineCompactorChars} | ${r.verdict} |`,
      );
    }
  }

  // ── Compactor state trajectory (per arm) ────────────────────────────
  // WHY: only direct evidence of whether boundaryIndex advanced and how much
  // digest text the arm was given; token sizes alone are ambiguous.
  lines.push(
    "",
    "### Compactor state trajectory (per arm)",
    "",
    "_Per-turn `boundaryIndex` / `digestChars` from `positiveControl` (grader reads `turn<N>/compactor_state.json`). Baseline rows are expected all null/0 — `reset_chat` deletes the key at arm start._",
    "",
  );
  const trajByArm = collectCompactorTrajectory(agg.fase4);
  for (const arm of FASE4_ARMS) {
    const rows = trajByArm.get(arm) ?? [];
    lines.push(`#### arm \`${arm}\``, "");
    if (rows.length === 0) {
      lines.push("_No positiveControl / turns for this arm._", "");
      continue;
    }
    const allNullOrZero = rows.every(
      (r) =>
        (r.boundaryIndex == null || r.boundaryIndex === 0) &&
        (r.digestChars == null || r.digestChars === 0),
    );
    if (arm === "baseline" && allNullOrZero) {
      lines.push(
        "_Baseline: all rows null/0 as expected (compactor key absent)._",
        "",
      );
    }
    lines.push(
      "| seed | turn | boundaryIndex | digestChars | prompt tokens |",
      "|---|---|---|---|---|",
    );
    for (const r of rows) {
      lines.push(
        `| ${r.seed} | ${r.turn} | ${r.boundaryIndex == null ? "null" : r.boundaryIndex} | ${r.digestChars == null ? "0" : r.digestChars} | ${r.promptTokens == null ? "n/a" : r.promptTokens} |`,
      );
    }
    lines.push("");
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

/**
 * Flatten per-arm trajectories: seed × turn → boundary, digest, prompt tokens.
 * Always emit rows when any of the three maps has a turn key (or fall back to
 * result.turns indices) so baseline null/0 rows stay visible.
 */
function collectCompactorTrajectory(fase4) {
  const byArm = new Map();
  for (const r of fase4) {
    const arm = String(r.arm);
    if (!byArm.has(arm)) byArm.set(arm, []);
    const pc = r.positiveControl ?? {};
    const boundary = pc.boundaryByTurn ?? {};
    const digest = pc.digestCharsByTurn ?? {};
    const tokens = pc.promptTokensByTurn ?? {};
    const turnKeys = new Set([
      ...Object.keys(boundary),
      ...Object.keys(digest),
      ...Object.keys(tokens),
    ]);
    // Older artifacts lack boundaryByTurn — still show prompt tokens so the
    // table is not empty when only embd.size was captured.
    if (turnKeys.size === 0 && Array.isArray(r.turns)) {
      for (const t of r.turns) {
        if (t?.index != null) turnKeys.add(String(t.index));
      }
    }
    const seed = r.seed;
    const sorted = [...turnKeys].sort((a, b) => Number(a) - Number(b));
    for (const t of sorted) {
      const b = Object.prototype.hasOwnProperty.call(boundary, t)
        ? boundary[t]
        : null;
      const d = Object.prototype.hasOwnProperty.call(digest, t)
        ? digest[t]
        : Object.keys(digest).length === 0
          ? null
          : 0;
      const pt = Object.prototype.hasOwnProperty.call(tokens, t)
        ? tokens[t]
        : null;
      byArm.get(arm).push({
        seed,
        turn: t,
        boundaryIndex: b,
        digestChars: d,
        promptTokens: pt,
      });
    }
  }
  // Stable order: seed then turn
  for (const [arm, rows] of byArm) {
    rows.sort(
      (a, b) =>
        Number(a.seed) - Number(b.seed) || Number(a.turn) - Number(b.turn),
    );
    byArm.set(arm, rows);
  }
  return byArm;
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
  const hasInsufficientUsable = (agg.insufficientUsable ?? []).length > 0;
  const hasPrimaryUsableZero = agg.primaryUsableZero === true;
  const posCtrlFailed = agg.positiveControl.gateFailed === true;
  // Mirror arm-level benchGrade: a failed logcat dump is lost evidence, not a green arm.
  const captureFailed = (agg.fase4 ?? []).filter(
    (r) =>
      isCompactionModeResult(r) &&
      Array.isArray(r.captureFailedTurns) &&
      r.captureFailedTurns.length > 0,
  );
  const hasCaptureFailed = captureFailed.length > 0;
  // Memory subsystem: fail when hasData=true but totalStored=0 (mechanism invoked but stored nothing)
  const memoryEmptyStore = findEmptyStoreFailures(agg.memoryExtractTelemetryByMode ?? []);
  const hasMemoryEmptyStore = memoryEmptyStore.length > 0;
  const seedsInfo = agg.seedsInfo;

  if (
    !hasMissing &&
    !hasBadCompaction &&
    !hasDuplicates &&
    !hasZeroProbes &&
    !hasInsufficientUsable &&
    !hasPrimaryUsableZero &&
    !posCtrlFailed &&
    !hasCaptureFailed &&
    !hasMemoryEmptyStore
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
      "**Missing expected (mode, seed) result.json files.** A campaign that reports success with only a subset of modes is invalid (see run 30863711482).",
      "",
      "| mode | seed |",
      "|---|---|",
    );
    for (const m of agg.missing) {
      lines.push(`| ${m.mode ?? m.arm} | ${m.seed} |`);
    }
    lines.push("");
  }

  if (hasDuplicates) {
    lines.push(
      "**Duplicate (mode, seed) pairs** — the same observation appears more than once:",
      "",
      "| mode | seed | files |",
      "|---|---|---|",
    );
    for (const d of agg.duplicates) {
      lines.push(`| ${d.mode ?? d.arm} | ${d.seed} | ${d.files.join("; ")} |`);
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

  if (hasInsufficientUsable || hasPrimaryUsableZero) {
    lines.push(
      "**Insufficient usable conversations** — a mode has fewer non-null primary-rate conversations than BENCH_EXPECT_SEEDS (null rates from empty-reply exclusions do not count). Insufficient data is never a green run.",
      "",
    );
    if (hasInsufficientUsable) {
      lines.push("| mode | usable | expected |", "|---|---|---|");
      for (const u of agg.insufficientUsable) {
        lines.push(`| ${u.mode} | ${u.usable} | ${u.expected} |`);
      }
      lines.push("");
    }
    if (hasPrimaryUsableZero) {
      lines.push(
        "**Primary pair (ciswire vs off) has zero usable conversations on at least one side** — permutation would be skipped; fail closed.",
        "",
      );
    }
  }

  if (hasBadCompaction) {
    lines.push(
      "**compactionActive missing or disagrees with mode the matrix asked for** — observation is not valid for the mechanism under test:",
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
        "**Positive control absent — cannot prove the arms differed** (no seed with positiveControl in both baseline and ciswire, the primary pair).",
        "",
      );
    } else if (agg.positiveControl.primaryIdentical) {
      lines.push(
        "**Positive control failed on the primary pair (baseline↔ciswire):** at least one seed has identical prompts / zero compactorChars on both arms. ciswire may be assembling the same legacy window as off — the A/B is measuring nothing.",
        "",
      );
    } else if (agg.positiveControl.anyIdentical) {
      lines.push(
        "**Positive control failed:** at least one seed has matching `promptTokensByTurn` on every turn ≥ 2 and `compactorChars` is 0 on both arms of a compared pair (or not in the expected treatment>0 / baseline=0 direction). The A/B is measuring nothing. This is a broken experiment, not a null result.",
        "",
      );
    } else {
      lines.push(
        "**Positive control failed:** empty/no-overlap prompt token maps, turn-1-only overlap (insufficient), or no seed with ARMS DIFFER on turns ≥ 2 or via real digest / token divergence.",
        "",
      );
    }
  }

  if (hasCaptureFailed) {
    lines.push(
      "**captureFailedTurns non-empty** — logcat dump failed on at least one turn; telemetry for those turns is unrecoverable (failed capture, not empty). Numbers from these arms must not reach a green report.",
      "",
      "| arm | seed | turns |",
      "|---|---|---|",
    );
    for (const r of captureFailed) {
      lines.push(
        `| ${r.arm} | ${r.seed} | ${r.captureFailedTurns.join(", ")} |`,
      );
    }
    lines.push("");
  }

  if (hasMemoryEmptyStore) {
    lines.push(
      "**Memory subsystem stored zero facts despite having telemetry data** — the extraction mechanism was invoked but nothing was stored. This is a broken arm, not a measurement.",
      "",
      "| mode | arm | extracted | rejected (sensitive) | rejected (full) |",
      "|---|---|---|---|---|",
    );
    for (const row of memoryEmptyStore) {
      lines.push(
        `| ${row.mode} | ${row.arm} | ${row.totalExtracted} | ${row.totalRejectedSensitive} | ${row.totalRejectedFull} |`,
      );
    }
    lines.push("");
  }

  return { markdown: lines.join("\n"), exitCode: 1 };
}

// ── Tools phase aggregation ────────────────────────────────────────────────

function aggregateTools(results) {
  const tools = results.filter((r) => r.phase === "tools");
  if (tools.length === 0) return { rows: [] };

  const byArm = new Map();
  for (const r of tools) {
    const arm = r.arm ?? "unknown";
    if (!byArm.has(arm)) {
      byArm.set(arm, {
        arm,
        files: 0,
        toolRequired: { found: 0, total: 0 },
        toolForbidden: { found: 0, total: 0 },
        toolSelection: { found: 0, total: 0, noCall: 0 },
      });
    }
    const g = byArm.get(arm);
    g.files += 1;
    for (const probe of r.probes ?? []) {
      if (probe.family === "tool_required") {
        g.toolRequired.total += 1;
        if (probe.found === true) g.toolRequired.found += 1;
      } else if (probe.family === "tool_forbidden") {
        g.toolForbidden.total += 1;
        if (probe.found === true) g.toolForbidden.found += 1;
      } else if (probe.family === "tool_selection") {
        const noCall = probe.noCall === true || probe.callCount === 0;
        if (noCall) {
          g.toolSelection.noCall += 1;
        } else {
          // Selection is conditional on attempting a call. A no-call turn is
          // a recall failure, not a wrong-tool selection.
          g.toolSelection.total += 1;
          if (probe.found === true) g.toolSelection.found += 1;
        }
      }
    }
  }

  const rows = [...byArm.values()].map((g) => ({
    arm: g.arm,
    files: g.files,
    toolRequiredRate: g.toolRequired.total > 0 ? g.toolRequired.found / g.toolRequired.total : 0,
    toolForbiddenRate: g.toolForbidden.total > 0 ? g.toolForbidden.found / g.toolForbidden.total : 0,
    toolSelectionRate: g.toolSelection.total > 0 ? g.toolSelection.found / g.toolSelection.total : null,
    toolRequired: g.toolRequired,
    toolForbidden: g.toolForbidden,
    toolSelection: g.toolSelection,
  }));

  return { rows };
}

function renderTools(agg) {
  const lines = [];
  lines.push("## Tools phase — tool-use correctness");
  if (agg.rows.length === 0) {
    lines.push("", "_No tools result.json files found._", "");
    return lines.join("\n");
  }
  lines.push(
    "",
    "| arm | tool_required | tool_forbidden | tool_selection | sel_no_call | runs |",
    "|---|---|---|---|---|---|",
  );
  for (const r of agg.rows) {
    const reqStr = r.toolRequired.total > 0
      ? `${fmt(r.toolRequiredRate)} (${r.toolRequired.found}/${r.toolRequired.total})`
      : "n/a (0/0)";
    const forbStr = r.toolForbidden.total > 0
      ? `${fmt(r.toolForbiddenRate)} (${r.toolForbidden.found}/${r.toolForbidden.total})`
      : "n/a (0/0)";
    const selStr = r.toolSelection.total > 0
      ? `${fmt(r.toolSelectionRate)} (${r.toolSelection.found}/${r.toolSelection.total})`
      : "n/a (0/0)";
    lines.push(`| ${r.arm} | ${reqStr} | ${forbStr} | ${selStr} | ${r.toolSelection.noCall} | ${r.files} |`);
  }
  return lines.join("\n");
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
  const tools = aggregateTools(results);
  const rendered4 = renderFase4(fase4);

  const parts = [
    "# PIANO V4.2 — Bench Aggregate",
    "",
    `_Sources scanned: ${searchDirs.join(", ")} — ${results.length} result.json file(s) found._`,
    "",
    renderFase0(fase0),
    "",
    rendered4.body,
    "",
    renderTools(tools),
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

export {
  runAggregate,
  permutationTestOneSided,
  collectMemoryTelemetryByMode,
  collectMemoryExtractTelemetryByMode,
  findEmptyStoreFailures,
};
