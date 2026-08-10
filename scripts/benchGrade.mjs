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
  looksLikeReasoningLeak,
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
 * Group telemetry lines by turnId and pick the group that belongs to the chat
 * turn. Matching rule (same idea as capture_kv_reuse in ci-lib.sh): summed
 * tokensEvaluated of a group equals embd.size of the FIRST "Input processed"
 * line in this turn's loadprompt.txt. Fallback: first group (lowest turnId)
 * plus a note — caller merges attributionNote.
 *
 * WHY not "first group wins": settle_turn_reply no longer waits for the
 * background summarize job (smoke run 31358530713: wait_ui_idle hung on the
 * collapsed "Thinking" header). Summarize telemetry can therefore land in
 * THIS turn's file or the NEXT turn's file; file order is no longer a safe
 * attribution key.
 *
 * @param {string} turnDir
 * @param {number|null} targetEmbSize - embd.size of first Input processed, or null
 * @returns {{ metrics: object, attributionNote: string|null } | null}
 */
function readTelemetryMetrics(turnDir, targetEmbSize) {
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

  // Lowest turnId first (numeric compare when both look like numbers).
  const keys = [...byTurnId.keys()].sort((a, b) => {
    if (a === "__none__") return 1;
    if (b === "__none__") return -1;
    const na = Number(a);
    const nb = Number(b);
    if (Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
  });

  let chatKey = keys[0];
  let attributionNote = null;
  if (typeof targetEmbSize === "number" && Number.isFinite(targetEmbSize)) {
    let matched = null;
    for (const k of keys) {
      const sum = sumPositive(
        (byTurnId.get(k) ?? []).map((r) => r.tokensEvaluated),
      );
      if (sum === targetEmbSize) {
        matched = k;
        break;
      }
    }
    if (matched != null) {
      chatKey = matched;
    } else {
      attributionNote = "telemetry attribution fell back to first group";
    }
  }

  const rounds = byTurnId.get(chatKey);
  const extraCompletions = keys.length - 1;

  const last = rounds[rounds.length - 1];
  const pps = last?.predictedPerSecond;
  // Turn work time = Σ(promptMs + predictedMs) over attributed rounds.
  // WHY not elapsed_s: ci-bench SAW_ELAPSED is UI time-to-first-token
  // (assistant message persists at first token, smoke run 31358530713:
  // elapsed_s tracks promptMs not decode). Excludes UI/storage overhead
  // → lower bound on wall time.
  const turnComputeMs = sumPositive(
    rounds.flatMap((r) => [r.promptMs, r.predictedMs]),
  );
  return {
    metrics: {
      promptMs: sumPositive(rounds.map((r) => r.promptMs)),
      predictedMs: sumPositive(rounds.map((r) => r.predictedMs)),
      turnComputeMs,
      tokensEvaluated: sumPositive(rounds.map((r) => r.tokensEvaluated)),
      tokensPredicted: sumPositive(rounds.map((r) => r.tokensPredicted)),
      predictedPerSecond:
        typeof pps === "number" && Number.isFinite(pps) && pps >= 0
          ? pps
          : null,
      rounds: rounds.length,
      extraCompletions,
    },
    attributionNote,
  };
}

function readLoadpromptMetrics(turnDir) {
  const file = path.join(turnDir, "loadprompt.txt");
  if (!existsSync(file)) {
    return {
      reusedTokens: null,
      promptTokens: null,
      reuseFrac: null,
      completions: null,
    };
  }
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return {
      reusedTokens: null,
      promptTokens: null,
      reuseFrac: null,
      completions: null,
    };
  }
  // All "Input processed" lines: first = chat turn (logcat -c between turns);
  // later lines are background jobs (summarize). completions counts them.
  const re = /Input processed:\s*n_past=(\d+),\s*embd\.size=(\d+)/g;
  const matches = [...raw.matchAll(re)];
  if (matches.length === 0) {
    return {
      reusedTokens: null,
      promptTokens: null,
      reuseFrac: null,
      completions: null,
    };
  }
  const reusedTokens = Number(matches[0][1]);
  const promptTokens = Number(matches[0][2]);
  const reuseFrac =
    Number.isFinite(promptTokens) && promptTokens > 0
      ? reusedTokens / promptTokens
      : null;
  return {
    reusedTokens,
    promptTokens,
    reuseFrac,
    completions: matches.length,
  };
}

/**
 * prompt_meta.txt format after smoke run 31358530713 fix:
 *   reused=<n_past> total=<embd.size>
 * one line per Input processed. Older tokens=/sha256= lines are ignored
 * (that hash was constant by construction — see ci-bench.sh).
 */
function readPromptMeta(turnDir) {
  const empty = {
    reusedTokens: null,
    promptTokens: null,
    completions: null,
  };
  const file = path.join(turnDir, "prompt_meta.txt");
  if (!existsSync(file)) return empty;
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return empty;
  }
  const lines = [];
  for (const line of raw.split("\n")) {
    const m = line.trim().match(/^reused=(\d+)\s+total=(\d+)\s*$/);
    if (m) lines.push({ reused: Number(m[1]), total: Number(m[2]) });
  }
  if (lines.length === 0) return empty;
  return {
    reusedTokens: lines[0].reused,
    promptTokens: lines[0].total,
    completions: lines.length,
  };
}

function metricsForTurn(baseDir, turnIndex) {
  const turnDir = path.join(baseDir, `turn${turnIndex}`);
  const empty = {
    promptMs: null,
    predictedMs: null,
    turnComputeMs: null,
    tokensEvaluated: null,
    tokensPredicted: null,
    predictedPerSecond: null,
    rounds: null,
    extraCompletions: null,
    reusedTokens: null,
    promptTokens: null,
    reuseFrac: null,
    completions: null,
    _hadTelemetry: false,
    _attributionNote: null,
  };
  if (!existsSync(turnDir)) return empty;

  const load = readLoadpromptMetrics(turnDir);
  const meta = readPromptMeta(turnDir);
  // Prefer loadprompt for the chat-turn embd.size (same first-line rule);
  // fall back to prompt_meta if loadprompt is missing.
  const promptTokens = load.promptTokens ?? meta.promptTokens;
  const reusedTokens = load.reusedTokens ?? meta.reusedTokens;
  const completions = load.completions ?? meta.completions;
  const reuseFrac =
    load.reuseFrac != null
      ? load.reuseFrac
      : Number.isFinite(promptTokens) &&
          promptTokens > 0 &&
          Number.isFinite(reusedTokens)
        ? reusedTokens / promptTokens
        : null;

  const telResult = readTelemetryMetrics(turnDir, promptTokens);
  const tel = telResult?.metrics ?? null;
  return {
    promptMs: tel?.promptMs ?? null,
    predictedMs: tel?.predictedMs ?? null,
    // null with no telemetry; actual work time (not UI TTFT). See comment
    // on turnComputeMs in readTelemetryMetrics — smoke run 31358530713.
    turnComputeMs: tel?.turnComputeMs ?? null,
    tokensEvaluated: tel?.tokensEvaluated ?? null,
    tokensPredicted: tel?.tokensPredicted ?? null,
    predictedPerSecond: tel?.predictedPerSecond ?? null,
    rounds: tel?.rounds ?? null,
    extraCompletions: tel?.extraCompletions ?? null,
    reusedTokens,
    promptTokens,
    reuseFrac,
    completions,
    _hadTelemetry: tel !== null,
    _attributionNote: telResult?.attributionNote ?? null,
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

function buildPrefill(turnMetrics, outTurns) {
  const promptMs = turnMetrics
    .map((m) => m.promptMs)
    .filter((v) => typeof v === "number");
  const reuseFrac = turnMetrics
    .map((m) => m.reuseFrac)
    .filter((v) => typeof v === "number");
  const promptTokens = turnMetrics
    .map((m) => m.promptTokens)
    .filter((v) => typeof v === "number");
  // turnComputeMs / ttftApprox_s: sample counts are independent (nulls skipped).
  const turnCompute = turnMetrics
    .map((m) => m.turnComputeMs)
    .filter((v) => typeof v === "number");
  const ttft = (outTurns ?? [])
    .map((t) => t.ttftApprox_s)
    .filter((v) => typeof v === "number");
  const turnsWithTelemetry = turnMetrics.filter((m) => m._hadTelemetry).length;
  return {
    meanPromptMs: mean(promptMs),
    medianPromptMs: median(promptMs),
    meanReuseFrac: mean(reuseFrac),
    meanPromptTokens: mean(promptTokens),
    // Lower-bound wall work from telemetry; not elapsed_s (see turnComputeMs).
    meanTurnComputeMs: mean(turnCompute),
    nTurnComputeMs: turnCompute.length,
    // UI-observed TTFT (same samples as elapsed_s); poll granularity 15 s.
    meanTtftApproxS: mean(ttft),
    nTtftApproxS: ttft.length,
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

  for (let i = 0; i < turns.length; i++) {
    const note = turnMetrics[i]?._attributionNote;
    if (note) {
      notes.push(`turn ${turns[i].index}: ${note}`);
    }
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
    const { _hadTelemetry, _attributionNote, ...metrics } = m;
    // elapsed_s kept raw for compatibility. It is UI-observed TTFT
    // (15 s poll), not turn duration — corroborated by promptMs on every
    // turn of run 31358530713. Mirror as ttftApprox_s so the honest name
    // is available without renaming the raw field mid-campaign.
    const elapsed = turn.elapsed_s ?? null;
    // settled_s: Send → last history change (ci-bench wait_history_stable).
    // null when absent so the running campaign's raw.json still grades.
    const settled =
      typeof turn.settled_s === "number" && Number.isFinite(turn.settled_s)
        ? turn.settled_s
        : null;
    return {
      // Default every copied field: JSON.stringify drops undefined keys, so a
      // malformed raw would omit fields instead of nulling them (B7).
      index: turn.index ?? null,
      kind: turn.kind ?? null,
      id: turn.id ?? null,
      prompt: turn.prompt ?? null,
      elapsed_s: elapsed,
      ttftApprox_s: elapsed,
      settled_s: settled,
      reply_len: replyLen,
      replyExcerpt: String(reply).slice(0, REPLY_EXCERPT_LEN),
      sources: turn.sources ?? null,
      hasMiniapp: turn.hasMiniapp ?? null,
      ...metrics,
    };
  });

  const { probes, notes: probeNotes } = gradeAllProbes(turns, facts);
  const byFamily = familyStats(probes);

  // Untagged reasoning leaked as the reply (run 31367691176). Do NOT change
  // found/not-found — note only, so the probe stays honest as unmeasurable.
  const reasoningLeakTurns = [];
  for (const turn of turns) {
    if (turn.kind !== "probe") continue;
    if (!looksLikeReasoningLeak(turn.reply ?? "")) continue;
    const n = turn.index;
    const id = turn.id ?? "?";
    reasoningLeakTurns.push(n);
    probeNotes.push(
      `turn ${n} (${id}): reply looks like reasoning, not an answer — probe result is not trustworthy`,
    );
  }

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

  // Positive control: real, non-truncated signals (smoke run 31358530713
  // proved the old promptSha was constant by construction). No promptSha*.
  const promptTokensByTurn = {};
  const reusedTokensByTurn = {};
  const completionsByTurn = {};
  for (let i = 0; i < turns.length; i++) {
    const idx = String(turns[i].index);
    const m = turnMetrics[i];
    if (m.promptTokens != null) promptTokensByTurn[idx] = m.promptTokens;
    if (m.reusedTokens != null) reusedTokensByTurn[idx] = m.reusedTokens;
    if (m.completions != null) completionsByTurn[idx] = m.completions;
  }
  const cs =
    raw.compactorState && typeof raw.compactorState === "object"
      ? raw.compactorState
      : {};
  const compactorChars =
    typeof cs.compactorChars === "number" && Number.isFinite(cs.compactorChars)
      ? cs.compactorChars
      : 0;
  const summaryChars =
    typeof cs.summaryChars === "number" && Number.isFinite(cs.summaryChars)
      ? cs.summaryChars
      : 0;

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
    prefill: buildPrefill(turnMetrics, outTurns),
    positiveControl: {
      promptTokensByTurn,
      reusedTokensByTurn,
      completionsByTurn,
      compactorChars,
      summaryChars,
    },
    notes,
    reasoningLeakTurns,
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
