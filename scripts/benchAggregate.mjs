#!/usr/bin/env node
/**
 * Aggregates PIANO V4.2 bench results (Fase 0 + Fase 4).
 *
 * Reads every file literally named `result.json` found recursively under the
 * given directories (default: current directory — matches how
 * actions/download-artifact lays out `all-results/<artifact-name>/result.json`
 * when downloading every arm's artifact without a `name` filter).
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
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PERM_ITERATIONS = Number(process.env.BENCH_PERM_ITERATIONS || 10_000);
const PERM_SEED = Number(process.env.BENCH_PERM_SEED || 42);
const ALPHA = 0.05;

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
  // Add-one smoothing (standard practice): a permutation test can never
  // report p=0, since the observed assignment is itself one permutation.
  const p = (countGE + 1) / (iterations + 1);
  return { observed, p, iterations };
}

// ── Fase 0 aggregation ───────────────────────────────────────────────────

function aggregateFase0(results) {
  const fase0 = results.filter((r) => r.phase === "fase0");
  if (fase0.length === 0) return { rows: [], winner: null, raw: [] };

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

function aggregateFase4(results) {
  const fase4 = results.filter((r) => r.phase === "fase4");
  if (fase4.length === 0) return { rows: [], perArmProbes: new Map(), permutation: null };

  const groups = new Map(); // key = arm
  for (const r of fase4) {
    const key = String(r.arm);
    if (!groups.has(key)) {
      groups.set(key, {
        arm: key,
        probesFound: 0,
        probesTotal: 0,
        elapsedSum: 0,
        elapsedCount: 0,
        seeds: new Set(),
        probeOutcomes: [], // flat 0/1 across all seeds — unit of the permutation test
      });
    }
    const g = groups.get(key);
    g.seeds.add(String(r.seed));
    for (const probe of r.probes ?? []) {
      g.probesTotal += 1;
      const hit = probe.found === true ? 1 : 0;
      if (hit) g.probesFound += 1;
      g.probeOutcomes.push(hit);
    }
    for (const turn of r.turns ?? []) {
      if (typeof turn.elapsed_s === "number") {
        g.elapsedSum += turn.elapsed_s;
        g.elapsedCount += 1;
      }
    }
  }

  const rows = [...groups.values()].map((g) => ({
    arm: g.arm,
    recall: g.probesTotal > 0 ? g.probesFound / g.probesTotal : 0,
    meanSecPerTurn: g.elapsedCount > 0 ? g.elapsedSum / g.elapsedCount : 0,
    seeds: g.seeds.size,
    probesFound: g.probesFound,
    probesTotal: g.probesTotal,
  }));

  let permutation = null;
  const baseline = groups.get("baseline");
  const v42 = groups.get("v42");
  if (baseline && v42) {
    permutation = permutationTestOneSided(
      baseline.probeOutcomes,
      v42.probeOutcomes,
      PERM_ITERATIONS,
      PERM_SEED,
    );
  }

  return { rows, permutation, baselineRow: rows.find((r) => r.arm === "baseline"), v42Row: rows.find((r) => r.arm === "v42") };
}

// ── Markdown rendering ────────────────────────────────────────────────────

function fmt(n, digits = 3) {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function renderFase0(agg) {
  const lines = [];
  lines.push("## Fase 0 — block format × thinking A/B");
  if (agg.rows.length === 0) {
    lines.push("", "_No fase0 result.json files found._", "");
    return lines.join("\n");
  }
  lines.push("", "| blockFormat | thinking | recall | avg s/turn | avg reply len | probes | runs |", "|---|---|---|---|---|---|---|");
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
  if (agg.rows.length === 0) {
    lines.push("", "_No fase4 result.json files found._", "");
    return lines.join("\n");
  }
  lines.push("", "| arm | recall | mean s/turn | seeds | probes |", "|---|---|---|---|---|");
  for (const r of agg.rows) {
    lines.push(`| ${r.arm} | ${fmt(r.recall)} (${r.probesFound}/${r.probesTotal}) | ${fmt(r.meanSecPerTurn, 1)} | ${r.seeds} | ${r.probesTotal} |`);
  }

  lines.push("");
  if (!agg.permutation) {
    lines.push(
      "_Permutation test skipped: need both a `baseline` and a `v42` arm with at least one probe each._",
    );
    return lines.join("\n");
  }

  const { observed, p, iterations } = agg.permutation;
  lines.push(
    `**One-sided permutation test (v42 recall > baseline recall):** observed Δrecall = ${observed >= 0 ? "+" : ""}${fmt(observed)}, p = ${fmt(p, 4)} (${iterations} permutations, seed=${PERM_SEED}, deterministic mulberry32 PRNG).`,
  );

  const gateMet =
    agg.v42Row &&
    agg.baselineRow &&
    agg.v42Row.recall > agg.baselineRow.recall &&
    p < ALPHA;

  lines.push("");
  if (gateMet) {
    lines.push(
      `**V4.2 gate:** v42 recall (${fmt(agg.v42Row.recall)}) > baseline (${fmt(agg.baselineRow.recall)}) AND p=${fmt(p, 4)} < ${ALPHA} → **MET** — compaction can be enabled by default.`,
    );
  } else {
    lines.push(
      `**V4.2 gate:** ${agg.v42Row && agg.baselineRow ? `v42 recall (${fmt(agg.v42Row.recall)}) vs baseline (${fmt(agg.baselineRow.recall)}), p=${fmt(p, 4)}` : "insufficient data"} → gate NOT met — keep default OFF.`,
    );
  }
  return lines.join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────

function main() {
  const dirs = process.argv.slice(2);
  const searchDirs = dirs.length > 0 ? dirs : ["."];
  const results = loadResults(searchDirs);

  const fase0 = aggregateFase0(results);
  const fase4 = aggregateFase4(results);

  const md = [
    "# PIANO V4.2 — Bench Aggregate",
    "",
    `_Sources scanned: ${searchDirs.join(", ")} — ${results.length} result.json file(s) found._`,
    "",
    renderFase0(fase0),
    "",
    renderFase4(fase4),
    "",
  ].join("\n");

  console.log(md);

  const outDir = "bench-out";
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(path.join(outDir, "AGGREGATE.md"), md, "utf8");
}

main();
