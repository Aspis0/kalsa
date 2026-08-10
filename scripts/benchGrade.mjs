#!/usr/bin/env node
/**
 * Grades one arm's bench-out/raw.json (schema 2) into result.json on stdout.
 *
 * WHY a separate Node grader (not bash):
 *   ci-bench.sh only records *facts* (replies, sources, sidecars). Grading
 *   lives here so it can be unit-tested offline without an emulator — the
 *   escaped-quote false negative in run 30863711482 (sed truncated the
 *   reply at the first `"`) is exactly the class of bug this boundary exists
 *   to catch.
 *
 * Text primitives and family graders live in benchGraders.mjs.
 *
 * Sidecar evidence (same dir as raw.json): turn<N>/telemetry.jsonl,
 * turn<N>/loadprompt.txt, turn<N>/prompt_meta.txt. Missing → nulls, never throw.
 *
 * Usage:
 *   node scripts/benchGrade.mjs bench-out/raw.json > bench-out/result.json
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stripThink,
  matchesFact,
  isFactProbeTurn,
  gradeAllProbes,
} from "./benchGraders.mjs";

const REPLY_EXCERPT_LEN = 300;

// ── Compaction active gate ──────────────────────────────────────────────

/**
 * Mirror of src/app/AppShell.tsx:1359 — the whole compaction subsystem gates
 * on raw === "1" || raw === "true". Anything else (numeric 1, string "on",
 * empty) reads as DISABLED. This field is the arm's proof of what the app
 * actually saw, not what the arm name claims.
 */
function isCompactionActive(compactionPrefRaw) {
  return compactionPrefRaw === "1" || compactionPrefRaw === "true";
}

// ── Sidecar readers (never throw) ───────────────────────────────────────

function sumPositive(values) {
  let sum = 0;
  let any = false;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      sum += v;
      any = true;
    }
  }
  return any ? sum : null;
}

/**
 * Group telemetry lines by turnId; report the FIRST group (lowest turnId =
 * the chat turn) as this turn's metrics, plus extraCompletions = other groups.
 * WHY: with settle+capture after idle, background summarize logs into the SAME
 * turn directory. Its prefill is a different completion and must not be summed
 * into the chat turn's measurement.
 */
function readTelemetryMetrics(turnDir) {
  const file = path.join(turnDir, "telemetry.jsonl");
  if (!existsSync(file)) return null;
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return null;
  }
  /** @type {Map<string, object[]>} */
  const byTurnId = new Map();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      const tid =
        obj.turnId != null && obj.turnId !== ""
          ? String(obj.turnId)
          : "__none__";
      if (!byTurnId.has(tid)) byTurnId.set(tid, []);
      byTurnId.get(tid).push(obj);
    } catch {
      // skip unparseable lines
    }
  }
  if (byTurnId.size === 0) return null;

  // Lowest turnId group first (numeric compare when both look like numbers).
  const keys = [...byTurnId.keys()].sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });
  const chatKey = keys[0];
  const rounds = byTurnId.get(chatKey);
  const extraCompletions = keys.length - 1;

  const last = rounds[rounds.length - 1];
  const pps = last?.predictedPerSecond;
  return {
    promptMs: sumPositive(rounds.map((r) => r.promptMs)),
    predictedMs: sumPositive(rounds.map((r) => r.predictedMs)),
    tokensEvaluated: sumPositive(rounds.map((r) => r.tokensEvaluated)),
    tokensPredicted: sumPositive(rounds.map((r) => r.tokensPredicted)),
    predictedPerSecond:
      typeof pps === "number" && Number.isFinite(pps) && pps >= 0 ? pps : null,
    rounds: rounds.length,
    extraCompletions,
  };
}

function readLoadpromptMetrics(turnDir) {
  const file = path.join(turnDir, "loadprompt.txt");
  if (!existsSync(file)) {
    return { reusedTokens: null, promptTokens: null, reuseFrac: null };
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { reusedTokens: null, promptTokens: null, reuseFrac: null };
  }
  // First "Input processed" line only. loadprompt has no turnId — A1's
  // ordering (capture after idle, logcat -c between turns) is what makes the
  // first line the chat turn's, not a later summarize.
  const m = raw.match(/Input processed:\s*n_past=(\d+),\s*embd\.size=(\d+)/);
  if (!m) {
    return { reusedTokens: null, promptTokens: null, reuseFrac: null };
  }
  const reusedTokens = Number(m[1]);
  const promptTokens = Number(m[2]);
  const reuseFrac =
    Number.isFinite(promptTokens) && promptTokens > 0
      ? reusedTokens / promptTokens
      : null;
  return { reusedTokens, promptTokens, reuseFrac };
}

function readPromptMeta(turnDir) {
  const file = path.join(turnDir, "prompt_meta.txt");
  if (!existsSync(file)) {
    return { promptSha256: null, promptTokenCount: null };
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return { promptSha256: null, promptTokenCount: null };
  }
  const first = raw.split("\n").find((l) => l.trim());
  if (!first) return { promptSha256: null, promptTokenCount: null };
  const tm = first.match(/tokens=(\d+)/);
  const sm = first.match(/sha256=([0-9a-fA-F]+)/);
  return {
    promptTokenCount: tm ? Number(tm[1]) : null,
    promptSha256: sm ? sm[1] : null,
  };
}

function metricsForTurn(baseDir, turnIndex) {
  const turnDir = path.join(baseDir, `turn${turnIndex}`);
  const empty = {
    promptMs: null,
    predictedMs: null,
    tokensEvaluated: null,
    tokensPredicted: null,
    predictedPerSecond: null,
    rounds: null,
    extraCompletions: null,
    reusedTokens: null,
    promptTokens: null,
    reuseFrac: null,
    promptSha256: null,
    promptTokenCount: null,
    _hadTelemetry: false,
  };
  if (!existsSync(turnDir)) return empty;

  const tel = readTelemetryMetrics(turnDir);
  const load = readLoadpromptMetrics(turnDir);
  const meta = readPromptMeta(turnDir);
  return {
    promptMs: tel?.promptMs ?? null,
    predictedMs: tel?.predictedMs ?? null,
    tokensEvaluated: tel?.tokensEvaluated ?? null,
    tokensPredicted: tel?.tokensPredicted ?? null,
    predictedPerSecond: tel?.predictedPerSecond ?? null,
    rounds: tel?.rounds ?? null,
    extraCompletions: tel?.extraCompletions ?? null,
    reusedTokens: load.reusedTokens,
    promptTokens: load.promptTokens,
    reuseFrac: load.reuseFrac,
    promptSha256: meta.promptSha256,
    promptTokenCount: meta.promptTokenCount,
    _hadTelemetry: tel !== null,
  };
}

// ── Summaries ───────────────────────────────────────────────────────────

function familyStats(probes) {
  const by = {};
  for (const p of probes) {
    if (!by[p.family]) by[p.family] = { found: 0, total: 0, rate: 0 };
    by[p.family].total += 1;
    if (p.found) by[p.family].found += 1;
  }
  for (const k of Object.keys(by)) {
    const g = by[k];
    g.rate = g.total === 0 ? 0 : g.found / g.total;
  }
  return by;
}

function mean(nums) {
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function median(nums) {
  if (nums.length === 0) return null;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
}

function buildPrefill(turnMetrics) {
  const promptMs = turnMetrics
    .map((m) => m.promptMs)
    .filter((v) => typeof v === "number");
  const reuseFrac = turnMetrics
    .map((m) => m.reuseFrac)
    .filter((v) => typeof v === "number");
  const promptTokens = turnMetrics
    .map((m) => m.promptTokens)
    .filter((v) => typeof v === "number");
  const turnsWithTelemetry = turnMetrics.filter((m) => m._hadTelemetry).length;
  return {
    meanPromptMs: mean(promptMs),
    medianPromptMs: median(promptMs),
    meanReuseFrac: mean(reuseFrac),
    meanPromptTokens: mean(promptTokens),
    turnsWithTelemetry,
  };
}

function collectNotes(raw, turns, turnMetrics, compactionActive, extraNotes) {
  const notes = [...(extraNotes ?? [])];

  for (const turn of turns) {
    if (isFactProbeTurn(turn) && (turn.sources ?? 0) >= 1) {
      notes.push(
        "fact probe turn had web sources (recall may be tool-assisted, not context recall)",
      );
      break;
    }
  }

  // Arm claims compaction "on" but AppShell gate saw it as off (or reverse).
  const prefStr = String(raw.compactionPrefRaw ?? "");
  if (raw.compaction === "on" && !compactionActive) {
    notes.push(
      `compaction pref on device was ${prefStr}, which the app reads as DISABLED`,
    );
  } else if (raw.compaction !== "on" && compactionActive) {
    notes.push(
      `compaction pref on device was ${prefStr}, which the app reads as DISABLED`,
    );
  }

  const missingTel = turnMetrics.filter((m) => !m._hadTelemetry).length;
  if (missingTel > 0) {
    notes.push(`no telemetry sidecar found for ${missingTel} turn(s)`);
  }

  return notes;
}

// ── Main grade ──────────────────────────────────────────────────────────

/**
 * Grade a parsed raw.json object.
 * @param {object} raw - schema-2 raw object
 * @param {string} baseDir - directory containing turn<N>/ sidecars
 */
function gradeRaw(raw, baseDir) {
  if (!raw || typeof raw !== "object") {
    throw new Error("raw.json is not an object");
  }
  const turns = Array.isArray(raw.turns) ? raw.turns : null;
  if (!turns || turns.length === 0) {
    throw new Error("raw.json has no turns");
  }
  const facts = Array.isArray(raw.facts) ? raw.facts : [];

  const compactionActive = isCompactionActive(raw.compactionPrefRaw);

  const turnMetrics = turns.map((t) => metricsForTurn(baseDir, t.index));

  const outTurns = turns.map((turn, i) => {
    const m = turnMetrics[i];
    const reply = turn.reply ?? "";
    const replyLen =
      typeof turn.replyLen === "number" ? turn.replyLen : String(reply).length;
    const { _hadTelemetry, ...metrics } = m;
    return {
      // Default every copied field: JSON.stringify drops undefined keys, so a
      // malformed raw would omit fields instead of nulling them (B7).
      index: turn.index ?? null,
      kind: turn.kind ?? null,
      id: turn.id ?? null,
      prompt: turn.prompt ?? null,
      elapsed_s: turn.elapsed_s ?? null,
      reply_len: replyLen,
      replyExcerpt: String(reply).slice(0, REPLY_EXCERPT_LEN),
      sources: turn.sources ?? null,
      hasMiniapp: turn.hasMiniapp ?? null,
      ...metrics,
    };
  });

  const { probes, notes: probeNotes } = gradeAllProbes(turns, facts);
  const byFamily = familyStats(probes);

  // recall = fact_recall rate ONLY. null when no fact probes — 0 would be
  // indistinguishable from "everything missed" (B6). Aggregator skips null.
  const fr = byFamily.fact_recall;
  let recall;
  const notes = collectNotes(
    raw,
    turns,
    turnMetrics,
    compactionActive,
    probeNotes,
  );
  if (!fr) {
    recall = null;
    notes.push("no fact_recall probes in this arm");
  } else {
    recall = fr.rate;
  }

  const promptShaByTurn = {};
  const promptTokensByTurn = {};
  for (let i = 0; i < turns.length; i++) {
    const idx = String(turns[i].index);
    const m = turnMetrics[i];
    if (m.promptSha256 != null) promptShaByTurn[idx] = m.promptSha256;
    if (m.promptTokenCount != null) promptTokensByTurn[idx] = m.promptTokenCount;
  }

  return {
    schema: 2,
    phase: raw.phase ?? null,
    arm: raw.arm ?? null,
    seed: raw.seed ?? null,
    blockFormat: raw.blockFormat ?? null,
    thinking: raw.thinking ?? null,
    compaction: raw.compaction ?? null,
    compactionPrefRaw: raw.compactionPrefRaw ?? null,
    compactionActive,
    model: raw.model ?? null,
    fillerRotation: raw.fillerRotation ?? null,
    historyChars: raw.historyChars ?? null,
    turns: outTurns,
    probes,
    recall,
    byFamily,
    prefill: buildPrefill(turnMetrics),
    positiveControl: {
      promptShaByTurn,
      promptTokensByTurn,
    },
    notes,
  };
}

function gradeFile(rawJsonPath) {
  let text;
  try {
    text = readFileSync(rawJsonPath, "utf8");
  } catch (err) {
    throw new Error(`cannot read raw.json at ${rawJsonPath}: ${err.message}`);
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new Error(`raw.json unparseable at ${rawJsonPath}: ${err.message}`);
  }
  const baseDir = path.dirname(path.resolve(rawJsonPath));
  return gradeRaw(raw, baseDir);
}

// ── CLI ─────────────────────────────────────────────────────────────────

function main() {
  const rawPath = process.argv[2];
  if (!rawPath) {
    console.error("usage: node scripts/benchGrade.mjs <raw.json>");
    process.exit(1);
  }
  try {
    const result = gradeFile(rawPath);
    process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  } catch (err) {
    console.error(`[benchGrade] ${err.message}`);
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}

export {
  stripThink,
  matchesFact,
  isCompactionActive,
  gradeRaw,
  gradeFile,
};
