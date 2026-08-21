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
 * turn<N>/toolcall.jsonl, turn<N>/loadprompt.txt,
 * turn<N>/prompt_meta.txt, turn<N>/compactor_state.json.
 * Missing → nulls/empty, never throw.
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
  isEmptyReplyText,
  gradeAllProbes,
} from "./benchGraders.mjs";

const REPLY_EXCERPT_LEN = 300;

// ── Context mode from on-device pref ────────────────────────────────────

/**
 * Mirror of parseContextMode in src/context/compactor.ts — the arm's proof of
 * what the app actually saw, not what the arm name claims.
 * raw "1"|"true" are retired stored values and fall back to "off";
 * "anchored" → "anchored"; "ciswire" → "ciswire"; anything else → "off".
 * @returns {"off"|"anchored"|"ciswire"}
 */
function parseContextModeFromPref(compactionPrefRaw) {
  const raw =
    compactionPrefRaw == null ? "" : String(compactionPrefRaw);
  if (raw === "anchored") return "anchored";
  if (raw === "ciswire") return "ciswire";
  return "off";
}

/**
 * Observed tool-gate state from the on-device read-back (raw.toolgatePrefRaw /
 * ci-bench TOOLGATE_PREF_RAW). Not derived from the arm label.
 * "1" → true, "0" → false, absent/unknown → null (never assumed).
 */
function parseToolGateActive(toolgatePrefRaw) {
  if (toolgatePrefRaw == null) return null;
  const raw = String(toolgatePrefRaw).trim();
  if (raw === "1") return true;
  if (raw === "0") return false;
  return null;
}

/** @deprecated Use parseContextModeFromPref; kept as alias for harness import. */
function isCompactionActive(compactionPrefRaw) {
  return parseContextModeFromPref(compactionPrefRaw);
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
  // contextFull: turnTelemetry.ts carries it per round; nothing else read it.
  // Direct evidence the arm hit the context wall (the phenomenon under test).
  // Surface only — do not change any probe outcome.
  const contextFull = rounds.some((r) => r.contextFull === true);
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
      contextFull,
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
    contextFull: false,
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
    // false when no telemetry; true only if an attributed round had it.
    contextFull: tel?.contextFull === true,
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
    if (!by[p.family]) by[p.family] = { found: 0, total: 0, excluded: 0, declined: 0, abstained: 0, rate: null };
    // found === null: empty-reply exclusion (run 31379031892 blank bubble).
    // Must not enter total — a rate over fewer observations than it appears
    // is a silent lie; `excluded` makes the shrinkage visible.
    if (p.found === null || p.found === undefined) {
      by[p.family].excluded += 1;
      // Track declined probes separately: model refused to assert facts
      // (e.g., "non ho memoria delle conversazioni precedenti").
      // These are excluded from the denominator like empty replies,
      // but we count them so we can report the decline rate.
      if (p.declined === true) {
        by[p.family].declined += 1;
      }
      // Track abstained probes separately: grader abstained because locale
      // is not in the validated set (it/en/ja). These are excluded from the
      // denominator like empty replies, but we count them so an arm graded
      // mostly by abstention is visible.
      if (p.abstained === true) {
        by[p.family].abstained += 1;
      }
      continue;
    }
    by[p.family].total += 1;
    if (p.found === true) by[p.family].found += 1;
  }
  for (const k of Object.keys(by)) {
    const g = by[k];
    g.rate = g.total === 0 ? null : g.found / g.total;
  }
  return by;
}

/**
 * Primary recall for one conversation.
 * WHY mean(early, late): the product's promise is that facts survive a long
 * conversation, and the two probes measure that promise at two distances —
 * turn 11 (OFF arm still holds plants in last-20; ON arm has moved boundary
 * past them) and turn 16 (neither arm holds them). Reporting only late would
 * answer half the question; pooling raw probes instead of averaging per
 * conversation would count correlated observations twice.
 * Fall back to plain fact_recall when neither early nor late is present
 * (older artifacts / fase0).
 */
function primaryRecall(byFamily) {
  const usable = (fam) => {
    const g = byFamily[fam];
    if (!g || g.total === 0 || g.rate == null || !Number.isFinite(g.rate)) {
      return null;
    }
    return g.rate;
  };
  const earlyR = usable("fact_recall_early");
  const lateR = usable("fact_recall_late");
  const hasEarlyLateLayout =
    byFamily.fact_recall_early != null || byFamily.fact_recall_late != null;
  if (hasEarlyLateLayout) {
    const rates = [earlyR, lateR].filter((r) => r != null);
    if (rates.length === 0) return null;
    return rates.reduce((a, b) => a + b, 0) / rates.length;
  }
  return usable("fact_recall");
}

/**
 * Parse turn<N>/compactor_state.json (AsyncStorage dump of CompactorState).
 * WHY worth a read per turn: only direct evidence of whether boundaryIndex
 * ever advanced and how much retrieved text (frozenDigest — field name kept
 * for wire compat, holds last query-time digest) the arm was given;
 * everything else is inference from prompt sizes.
 * Empty / absent / unparseable → nulls and 0 chars, never throw.
 */
function readCompactorState(baseDir, turnIndex) {
  const empty = {
    boundaryIndex: null,
    builtAtUserTurn: null,
    digestChars: 0,
    summaryChars: 0,
  };
  const p = path.join(baseDir, `turn${turnIndex}`, "compactor_state.json");
  if (!existsSync(p)) return empty;
  let text;
  try {
    text = readFileSync(p, "utf8").trim();
  } catch {
    return empty;
  }
  if (!text) return empty;
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return empty;
  }
  if (!obj || typeof obj !== "object") return empty;
  return {
    boundaryIndex:
      typeof obj.boundaryIndex === "number" && Number.isFinite(obj.boundaryIndex)
        ? obj.boundaryIndex
        : null,
    builtAtUserTurn:
      typeof obj.builtAtUserTurn === "number" &&
      Number.isFinite(obj.builtAtUserTurn)
        ? obj.builtAtUserTurn
        : null,
    digestChars:
      typeof obj.frozenDigest === "string" ? obj.frozenDigest.length : 0,
    summaryChars:
      typeof obj.rollingSummary === "string" ? obj.rollingSummary.length : 0,
  };
}

/**
 * Turns whose capture_turn_evidence wrote turn<N>/capture_failed (logcat dump
 * failed). Distinct from an empty capture — evidence was lost, not absent.
 * @returns {number[]}
 */
function findCaptureFailedTurns(baseDir, turns) {
  const failed = [];
  for (const turn of turns) {
    if (turn.index == null) continue;
    const marker = path.join(baseDir, `turn${turn.index}`, "capture_failed");
    if (existsSync(marker)) failed.push(turn.index);
  }
  return failed;
}

/**
 * Parse turn<N>/toolcall.jsonl (KALSA_TOOLCALL counters). Missing / unreadable
 * / empty → []. Never throw. Each line is one tool-round object.
 */
function readToolRounds(turnDir) {
  const file = path.join(turnDir, "toolcall.jsonl");
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const rounds = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") rounds.push(obj);
    } catch {
      // skip unparseable lines
    }
  }
  return rounds;
}

/**
 * Parse turn<N>/digest.jsonl (KALSA_DIGEST timing). Missing / unreadable
 * / empty → []. Never throw. Each line is one digest-build telemetry object
 * with { durationMs, corpusSize, selectedCount }.
 */
function readDigestTelemetry(turnDir) {
  const file = path.join(turnDir, "digest.jsonl");
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") {
        const durationMs = typeof obj.durationMs === "number" ? obj.durationMs : null;
        const corpusSize = typeof obj.corpusSize === "number" ? obj.corpusSize : null;
        const selectedCount = typeof obj.selectedCount === "number" ? obj.selectedCount : null;
        if (durationMs != null || corpusSize != null || selectedCount != null) {
          records.push({ durationMs, corpusSize, selectedCount });
        }
      }
    } catch {
      // skip unparseable lines
    }
  }
  return records;
}

/**
 * Parse turn<N>/session-init.jsonl (KALSA_SESSION lines). Missing / unreadable
 * / empty → []. Never throw. Keeps op:init rows with a 0|1 no_extra_bufts so
 * the arm's result can name the repack mode the engine actually loaded with.
 */
function readSessionInitTelemetry(turnDir) {
  const file = path.join(turnDir, "session-init.jsonl");
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (!obj || typeof obj !== "object") continue;
      if (obj.op !== "init") continue;
      const n = obj.no_extra_bufts;
      if (n === 0 || n === 1) {
        records.push({ op: "init", no_extra_bufts: n });
      }
    } catch {
      // skip unparseable lines
    }
  }
  return records;
}

/**
 * First KALSA_SESSION op:init no_extra_bufts across turn sidecars, or null.
 * Init fires once per real engine load — usually turn 1 after logcat clear.
 */
function resolveNoExtraBufts(baseDir, turns) {
  if (!Array.isArray(turns)) return null;
  for (const turn of turns) {
    if (turn == null || turn.index == null) continue;
    const recs = readSessionInitTelemetry(
      path.join(baseDir, `turn${turn.index}`),
    );
    for (const r of recs) {
      if (r.no_extra_bufts === 0 || r.no_extra_bufts === 1) {
        return r.no_extra_bufts;
      }
    }
  }
  return null;
}

/**
 * Parse turn<N>/memory.jsonl (KALSA_MEMORY telemetry). Missing / unreadable
 * / empty → []. Never throw. The turn-end object carries only turn-owned
 * fields; extraction fields are authoritative in readMemoryExtractTelemetry.
 */
function readMemoryTelemetry(turnDir) {
  const file = path.join(turnDir, "memory.jsonl");
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") {
        const memoryEnabled = typeof obj.memoryEnabled === "number" ? obj.memoryEnabled : null;
        const factsInjected = typeof obj.factsInjected === "number" ? obj.factsInjected : null;
        if (memoryEnabled != null || factsInjected != null) {
          records.push({ memoryEnabled, factsInjected });
        }
      }
    } catch {
      // skip unparseable lines
    }
  }
  return records;
}

/**
 * Parse turn<N>/memory-extract.jsonl (KALSA_MEMORY_EXTRACT telemetry — settled/
 * late figures, emitted when the extract job completes). Missing / unreadable
 * / empty → []. Never throw. This is authoritative for extraction counters,
 * totalFactsInStore, and all extract lifecycle codes.
 */
function readMemoryExtractTelemetry(turnDir) {
  const file = path.join(turnDir, "memory-extract.jsonl");
  if (!existsSync(file)) return [];
  let raw;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const records = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const obj = JSON.parse(t);
      if (obj && typeof obj === "object") {
        const memoryEnabled = typeof obj.memoryEnabled === "number" ? obj.memoryEnabled : null;
        const factsExtracted = typeof obj.factsExtracted === "number" ? obj.factsExtracted : null;
        const factsStored = typeof obj.factsStored === "number" ? obj.factsStored : null;
        const factsRejectedSensitive = typeof obj.factsRejectedSensitive === "number" ? obj.factsRejectedSensitive : null;
        const factsRejectedFull = typeof obj.factsRejectedFull === "number" ? obj.factsRejectedFull : null;
        const factsInjected = typeof obj.factsInjected === "number" ? obj.factsInjected : null;
        const totalFactsInStore = typeof obj.totalFactsInStore === "number" ? obj.totalFactsInStore : null;
        const extractParseOutcome = typeof obj.extractParseOutcome === "number" ? obj.extractParseOutcome : null;
        const extractGateSource = typeof obj.extractGateSource === "number" ? obj.extractGateSource : null;
        const extractStopReason = typeof obj.extractStopReason === "number" ? obj.extractStopReason : null;
        if (memoryEnabled != null || factsExtracted != null || factsStored != null || factsRejectedSensitive != null || factsRejectedFull != null || factsInjected != null || totalFactsInStore != null || extractParseOutcome != null || extractGateSource != null || extractStopReason != null) {
          records.push({ memoryEnabled, factsExtracted, factsStored, factsRejectedSensitive, factsRejectedFull, factsInjected, totalFactsInStore, extractParseOutcome, extractGateSource, extractStopReason });
        }
      }
    } catch {
      // skip unparseable lines
    }
  }
  return records;
}

function emptyToolAggregates() {
  return {
    emittedAnyToolCall: false,
    firstTryValid: false,
    recoveredByFallback: 0,
    toolCallsSkipped: 0,
    toolCallsFailed: 0,
    privacyBlocks: 0,
    forcedCalls: 0,
    forcedThenBlocked: 0,
  };
}

/**
 * Per-arm aggregates from per-turn toolRounds.
 * firstTryValid: a turn whose first recorded round had ≥1 structured call,
 * namesValid && argsParsed, and no fallback.
 */
function aggregateToolRounds(roundsByTurn) {
  const out = emptyToolAggregates();
  for (const rounds of roundsByTurn) {
    if (!Array.isArray(rounds) || rounds.length === 0) continue;
    const sorted = [...rounds].sort(
      (a, b) => (Number(a.round) || 0) - (Number(b.round) || 0),
    );
    for (const r of rounds) {
      const emitted = (r.structuredCalls ?? 0) + (r.fallbackCalls ?? 0);
      if (emitted >= 1) out.emittedAnyToolCall = true;
      out.recoveredByFallback += Number(r.fallbackCalls) || 0;
      out.toolCallsSkipped +=
        (Number(r.skippedCap) || 0) +
        (Number(r.skippedDup) || 0) +
        (Number(r.skippedFailedRepeat) || 0);
      out.toolCallsFailed += Number(r.failed) || 0;
      out.privacyBlocks += Number(r.blockedPrivacy) || 0;
      if (r.toolChoice === "required") {
        out.forcedCalls += emitted;
        out.forcedThenBlocked += Number(r.blockedPrivacy) || 0;
      }
    }
    const first = sorted[0];
    if (
      first &&
      (first.structuredCalls ?? 0) >= 1 &&
      first.namesValid === true &&
      first.argsParsed === true &&
      (first.fallbackCalls ?? 0) === 0
    ) {
      out.firstTryValid = true;
    }
  }
  return out;
}

function executedCallCount(rounds) {
  let n = 0;
  for (const r of rounds ?? []) {
    n += Number(r.executed) || 0;
  }
  return n;
}

/**
 * Tool-call timing vs the plan's per-turn expectation (must | must_not | either).
 * A call on `must` is correct; a call on `must_not` is not. `either` and
 * missing/unknown expectation are excluded from both metrics.
 * Empty denominator → null, never 0 or 1.
 */
function scoreToolTiming(turns, roundsByTurn) {
  let correctCalls = 0;
  let allCalls = 0;
  let mustTurns = 0;
  let mustHits = 0;
  let spuriousCalls = 0;
  let missedCalls = 0;

  for (let i = 0; i < turns.length; i++) {
    const exp = turns[i]?.expectation;
    if (exp !== "must" && exp !== "must_not") continue;
    const n = executedCallCount(roundsByTurn[i]);
    if (exp === "must") {
      mustTurns += 1;
      if (n >= 1) mustHits += 1;
      else missedCalls += 1;
      correctCalls += n;
      allCalls += n;
    } else {
      spuriousCalls += n;
      allCalls += n;
    }
  }

  return {
    toolPrecision: allCalls === 0 ? null : correctCalls / allCalls,
    toolRecall: mustTurns === 0 ? null : mustHits / mustTurns,
    spuriousCalls,
    missedCalls,
  };
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

/**
 * Expected context mode from the arm's COMPACTION env (anchored|off|ciswire).
 * @returns {"off"|"anchored"|"ciswire"|null} null when compaction field is absent
 */
function expectedModeFromCompaction(compaction) {
  if (compaction === "anchored") return "anchored";
  if (compaction === "off") return "off";
  if (compaction === "ciswire") return "ciswire";
  return null;
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

  // Arm claims one mode but on-device pref parsed as another.
  const prefStr = String(raw.compactionPrefRaw ?? "");
  const expected = expectedModeFromCompaction(raw.compaction);
  if (expected != null && compactionActive !== expected) {
    notes.push(
      `compaction pref on device was ${prefStr} (mode ${compactionActive}), arm expected ${expected}`,
    );
  }

  // Locale confounder (CI run 31379031892): DEFAULT_LOCALE is "en"; unseeded
  // kalsa.locale leaves English operative-block language rule on the
  // compaction arm only, while bench probes are Italian. Absent field (pre-
  // seed raw.json) also counts as untrustworthy — same signal as "".
  // Do NOT change the language grader; the note is the signal.
  const localePrefStr =
    raw.localePrefRaw == null ? "" : String(raw.localePrefRaw);
  if (localePrefStr !== "it") {
    notes.push(
      `locale on device was '${localePrefStr}' — bench probes are Italian, so the operative block's language rule contradicts them (this arm's language probe is not trustworthy)`,
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

  const compactionActive = parseContextModeFromPref(raw.compactionPrefRaw);
  const toolGateActive = parseToolGateActive(raw.toolgatePrefRaw);
  const captureFailedTurns = findCaptureFailedTurns(baseDir, turns);

  const toolRoundsPerTurn = turns.map((t) =>
    t.index == null
      ? []
      : readToolRounds(path.join(baseDir, `turn${t.index}`)),
  );
  const {
    emittedAnyToolCall,
    firstTryValid,
    recoveredByFallback,
    toolCallsSkipped,
    toolCallsFailed,
    privacyBlocks,
    forcedCalls,
    forcedThenBlocked,
  } = aggregateToolRounds(toolRoundsPerTurn);
  const { toolPrecision, toolRecall, spuriousCalls, missedCalls } =
    scoreToolTiming(turns, toolRoundsPerTurn);

  const digestTelemetryPerTurn = turns.map((t) =>
    t.index == null
      ? []
      : readDigestTelemetry(path.join(baseDir, `turn${t.index}`)),
  );

  const memoryTelemetryPerTurn = turns.map((t) =>
    t.index == null
      ? []
      : readMemoryTelemetry(path.join(baseDir, `turn${t.index}`)),
  );

  // memoryExtractTelemetry: settled/late figures (emitted when extract job completes).
  // Keys off this, not the turn-end snapshot, for the NOT-RUN verdict.
  const memoryExtractTelemetryPerTurn = turns.map((t) =>
    t.index == null
      ? []
      : readMemoryExtractTelemetry(path.join(baseDir, `turn${t.index}`)),
  );

  // Engine load mode from KALSA_SESSION op:init (once per real load).
  // null when capture missed it — never invent from the NOREPACK env label.
  const no_extra_bufts = resolveNoExtraBufts(baseDir, turns);

  const turnMetrics = turns.map((t) => metricsForTurn(baseDir, t.index));

  // contextFullTurns / errorTurns: product signals the harness used to ignore.
  // Listed + noted only — never change a probe's found flag because of them.
  const contextFullTurns = [];
  const errorTurns = [];
  const emptyReplyTurns = [];

  // Per-turn boundary/digest — only direct evidence of whether the boundary
  // advanced and how much digest text the arm was given (see readCompactorState).
  const boundaryByTurn = {};
  const digestCharsByTurn = {};

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
    // AppShell.tsx:1163 renders engine errors as "⚠️ <message>"; :183-195
    // SKIPS those assistant messages when rebuilding history. So an error
    // turn is invisible to the engine but would still be graded as the
    // turn's reply if we did not flag it. Surface only — do not re-score.
    const isErrorReply = String(reply).startsWith("⚠️");
    // Blank bubble (run 31379031892 baseline seed 5 turn 11): not a model miss.
    const isEmptyReply = isEmptyReplyText(reply);
    if (metrics.contextFull === true && turn.index != null) {
      contextFullTurns.push(turn.index);
    }
    if (isErrorReply && turn.index != null) {
      errorTurns.push(turn.index);
    }
    if (isEmptyReply && turn.index != null) {
      emptyReplyTurns.push(turn.index);
    }
    const csTurn = readCompactorState(baseDir, turn.index);
    if (turn.index != null) {
      const idx = String(turn.index);
      boundaryByTurn[idx] = csTurn.boundaryIndex;
      digestCharsByTurn[idx] = csTurn.digestChars;
    }
    return {
      // Default every copied field: JSON.stringify drops undefined keys, so a
      // malformed raw would omit fields instead of nulling them (B7).
      index: turn.index ?? null,
      kind: turn.kind ?? null,
      id: turn.id ?? null,
      expectation: turn.expectation ?? null,
      prompt: turn.prompt ?? null,
      elapsed_s: elapsed,
      ttftApprox_s: elapsed,
      settled_s: settled,
      reply_len: replyLen,
      replyExcerpt: String(reply).slice(0, REPLY_EXCERPT_LEN),
      sources: turn.sources ?? null,
      hasMiniapp: turn.hasMiniapp ?? null,
      isErrorReply,
      isEmptyReply,
      boundaryIndex: csTurn.boundaryIndex,
      builtAtUserTurn: csTurn.builtAtUserTurn,
      digestChars: csTurn.digestChars,
      summaryChars: csTurn.summaryChars,
      toolRounds: toolRoundsPerTurn[i],
      ...metrics,
    };
  });

  const { probes, notes: probeNotes } = gradeAllProbes(
    turns.map((t, i) => ({ ...t, toolRounds: toolRoundsPerTurn[i] })),
    facts,
    raw.localePrefRaw,
  );
  const byFamily = familyStats(probes);

  // Untagged reasoning leaked as the reply (run 31367691176). Do NOT change
  // found/not-found — note only, so the probe stays honest as unmeasurable.
  // Skip empty replies: already excluded; "looks like reasoning" is N/A.
  const reasoningLeakTurns = [];
  for (const turn of turns) {
    if (turn.kind !== "probe") continue;
    if (isEmptyReplyText(turn.reply)) continue;
    if (!looksLikeReasoningLeak(turn.reply ?? "")) continue;
    const n = turn.index;
    const id = turn.id ?? "?";
    reasoningLeakTurns.push(n);
    probeNotes.push(
      `turn ${n} (${id}): reply looks like reasoning, not an answer — probe result is not trustworthy`,
    );
  }

  if (contextFullTurns.length > 0) {
    probeNotes.push(
      `contextFull on turn(s) ${contextFullTurns.join(", ")} — arm hit the context wall (product signal; probe outcomes unchanged)`,
    );
  }
  if (errorTurns.length > 0) {
    probeNotes.push(
      `errorTurns ${errorTurns.join(", ")} (reply starts with ⚠️) — those probe results are not trustworthy (engine skipped the message; outcomes unchanged)`,
    );
  }
  if (emptyReplyTurns.length > 0) {
    // Evidence: run 31379031892 baseline seed 5 turn 11 (probe_facts, replyLen 0).
    probeNotes.push(
      `emptyReplyTurns ${emptyReplyTurns.join(", ")} — blank assistant bubble; probes on those turns are excluded (found=null), not scored as misses`,
    );
  }
  if (captureFailedTurns.length > 0) {
    // Failed logcat dump — not an empty capture. Silent evidence loss lies.
    probeNotes.push(
      `captureFailedTurns ${captureFailedTurns.join(", ")} — logcat dump failed; telemetry for those turns is unrecoverable (failed capture, not empty)`,
    );
  }

  // Top-level recall = mean(fact_recall_early, fact_recall_late) per conversation
  // (see primaryRecall). Fallback plain fact_recall for older artifacts. null
  // when no usable fact family remains after exclusions.
  const recall = primaryRecall(byFamily);
  const notes = collectNotes(
    raw,
    turns,
    turnMetrics,
    compactionActive,
    probeNotes,
  );
  if (
    recall == null &&
    !byFamily.fact_recall_early &&
    !byFamily.fact_recall_late &&
    !byFamily.fact_recall
  ) {
    notes.push("no fact_recall probes in this arm");
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
    // Pass-through of on-device locale (ci-bench set_prefs seeds "it").
    // null when absent so old campaign raw.json still grades without crash.
    localePrefRaw: raw.localePrefRaw ?? null,
    // Observed context mode from pref read-back: "off" | "anchored" | "ciswire".
    compactionActive,
    // Observed tool-gate from pref read-back. null when the field is absent
    // on an old raw.json — aggregator must not assume from the arm label.
    toolGateActive,
    emittedAnyToolCall,
    firstTryValid,
    recoveredByFallback,
    toolCallsSkipped,
    toolCallsFailed,
    privacyBlocks,
    forcedCalls,
    forcedThenBlocked,
    toolPrecision,
    toolRecall,
    spuriousCalls,
    missedCalls,
    digestTelemetry: digestTelemetryPerTurn,
    memoryTelemetry: memoryTelemetryPerTurn,
    memoryExtractTelemetry: memoryExtractTelemetryPerTurn,
    // Observed engine load mode from session-init capture (0|1), or null.
    no_extra_bufts,
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
      // WHY per-turn boundary/digest: only direct evidence of whether the
      // boundary advanced and how much retrieved text the arm was given —
      // everything else is inference from assembled prompt sizes.
      boundaryByTurn,
      digestCharsByTurn,
      compactorChars,
      summaryChars,
    },
    notes,
    reasoningLeakTurns,
    contextFullTurns,
    errorTurns,
    emptyReplyTurns,
    captureFailedTurns,
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
    // Fase4: a failed capture is not a green arm — evidence was lost.
    if (
      result.phase === "fase4" &&
      Array.isArray(result.captureFailedTurns) &&
      result.captureFailedTurns.length > 0
    ) {
      console.error(
        `[benchGrade] capture failed on turn(s) ${result.captureFailedTurns.join(", ")} — failing fase4 arm`,
      );
      process.exit(1);
    }
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
  parseContextModeFromPref,
  isCompactionActive,
  readMemoryTelemetry,
  readMemoryExtractTelemetry,
  readSessionInitTelemetry,
  resolveNoExtraBufts,
  gradeRaw,
  gradeFile,
};
