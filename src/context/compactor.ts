/**
 * ConversationCompactor — two-tier context for cache-friendly prompts (PIANO V4.2).
 *
 * Pure TypeScript: no React Native / AsyncStorage imports. Callers inject storage.
 *
 * KV-prefix design (growing recent window):
 * - `boundaryIndex` marks where older (retrieval corpus) ends and the verbatim
 *   window begins. It moves ONLY at boundary rebuild (every K user turns).
 * - Between boundary rebuilds the verbatim window is ALL messages from
 *   boundaryIndex onward — append-only growth (~R up to ~R+2K). That keeps the
 *   token prefix after the system prompt byte-identical so llama.rn reuses the
 *   KV cache.
 * - At boundary rebuild: set boundary so the remaining window is the most recent
 *   R messages; rolling LLM summary is refreshed on this same K-turn cadence.
 *
 * Query-time BM25 digest (2026-08-03 reverse of freeze):
 * - Digest is rebuilt EVERY user turn with the CURRENT user message as query
 *   against the compacted ("older") corpus. It is NOT frozen for K turns.
 * - Rationale: the operative block (digest+summary) is stapled to the last user
 *   message (format B / user-prefix). Everything after the last stable token is
 *   re-encoded every turn anyway, so freezing the digest saved zero prefill and
 *   cost recall (benchmark: frozen digest 33.3% vs CisWire 100% — see
 *   docs/RESEARCH_CONTEXT_LOSS.md).
 * - Callers should hold one warm RetrieverIndex per chat (append older units as
 *   the boundary advances); throwaway rebuild every turn is wasteful at scale.
 *
 * Accepted caveats (revisit after Fase 4 bench):
 * (1) Per-message char cap flips 4000↔2000 when the current turn has images,
 *     which breaks the byte-identical prefix for that turn (same class as legacy).
 * (2) The rolling summary lags one rebuild behind the boundary: the chunk
 *     [boundary_T, boundary_T+K) can leave the window without ever entering a
 *     summary — covered only by the query-time digest.
 */

import {
  RetrieverIndex,
  type RetrievalUnit,
  type RetrieveOptions,
  type RetrievedSnippet,
} from "./retriever";

// ── Types ──────────────────────────────────────────────────────────────────

export interface CompactorState {
  /**
   * Last query-time BM25 digest (may be ""). Refreshed every user turn with the
   * current query; field name kept for AsyncStorage wire compatibility.
   */
  frozenDigest: string;
  /** LLM rolling summary (may be ""). Frozen between boundary rebuilds (K turns). */
  rollingSummary: string;
  /** User-turn counter when the boundary / summary were last rebuilt. */
  builtAtUserTurn: number;
  /**
   * Absolute history index where older (retrieval corpus) ends and the verbatim
   * window begins. Moves ONLY at boundary rebuild. -1 = never set (treat as 0).
   */
  boundaryIndex: number;
  chatId: string;
}

export interface CompactorConfig {
  /** Advance boundary + refresh rolling summary every K user turns (default 3). */
  rebuildEveryKUserTurns: number;
  /** Recent messages kept verbatim without images (default 6). */
  recentWindow: number;
  /** Recent messages kept verbatim when the turn has images (default 4). */
  recentWindowWithImages: number;
  /** Max chars for the query-time digest block (default 900). */
  digestBudgetChars: number;
  /**
   * Max chars of the verbatim recent window before forcing an early boundary rebuild
   * (~4k tokens at ~4 chars/token). Default 16000.
   */
  windowCharBudget: number;
}

/** Minimal index surface used by buildDigest (RetrieverIndex satisfies this). */
export interface DigestIndex {
  retrieve(
    query: string | null | undefined,
    options?: RetrieveOptions,
  ): RetrievedSnippet[];
  readonly documentCount?: number;
}

export type HistoryRoleMessage = {
  role: "user" | "assistant";
  text: string;
  /** Terminal partial kept after kill/abort — exclude from BM25/summary corpus. */
  interrupted?: boolean;
};

export type EngineHistoryMessage = {
  role: "user" | "assistant";
  content: string;
};

// ── Defaults & storage key layout ──────────────────────────────────────────

/** Default verbatim-window char budget (~4k tokens). See CompactorConfig.windowCharBudget. */
export const WINDOW_CHAR_BUDGET = 16_000;

export const DEFAULT_COMPACTOR_CONFIG: CompactorConfig = {
  rebuildEveryKUserTurns: 3,
  recentWindow: 6,
  recentWindowWithImages: 4,
  digestBudgetChars: 900,
  windowCharBudget: WINDOW_CHAR_BUDGET,
};

/** AsyncStorage key: compaction feature toggle (default OFF). */
export const COMPACTION_ENABLED_KEY = "kalsa.context.compaction";

/**
 * Three-valued context regime from COMPACTION_ENABLED_KEY.
 * - off: legacy sliding window, no digest/summary
 * - v42: boundary→end window + digest/summary
 * - ciswire: legacy sliding window + digest/summary (retrieval additive)
 */
export type ContextMode = "off" | "v42" | "ciswire";

/** Parse raw AsyncStorage value; unknown / null → "off". */
export function parseContextMode(raw: string | null): ContextMode {
  if (raw === "1" || raw === "true") return "v42";
  if (raw === "ciswire") return "ciswire";
  return "off";
}

/**
 * Start index of the legacy sliding window used by assembleEngineHistory when
 * compaction is off. Messages before this index fall outside the engine window
 * (ciswire uses this as the BM25/summary corpus boundary).
 */
export function legacyWindowStartIndex(
  historyLength: number,
  hasImages: boolean,
): number {
  const len = Number.isFinite(historyLength)
    ? Math.max(0, Math.floor(historyLength))
    : 0;
  const maxHistory = hasImages ? LEGACY_MAX_HISTORY_IMAGES : LEGACY_MAX_HISTORY;
  return Math.max(0, len - maxHistory);
}

/** Per-chat compactor state (last digest + boundary + summary meta). */
export function compactorStorageKey(chatId: string): string {
  return `kalsa.chat.compactor.${chatId || "default"}`;
}

/** Per-chat rolling LLM summary string. */
export function summaryStorageKey(chatId: string): string {
  return `kalsa.chat.summary.${chatId || "default"}`;
}

export const DEFAULT_CHAT_ID = "default";

/** Legacy sliding-window limits (must stay byte-identical when compaction is OFF). */
export const LEGACY_MAX_HISTORY = 20;
export const LEGACY_MAX_HISTORY_IMAGES = 8;
export const LEGACY_MAX_CHARS = 4000;
export const LEGACY_MAX_CHARS_IMAGES = 2000;

/** Cap on rolling summary injected into the operative block. */
export const SUMMARY_BUDGET_CHARS = 600;

const DEFAULT_DIGEST_TOP_N = 4;
const DEFAULT_DIGEST_SNIPPET_CHARS = 220;

// ── Pure helpers ───────────────────────────────────────────────────────────

/**
 * Replace every occurrence of `token` in `template` with `value` without
 * interpreting `$&`, `$$`, `$``, `$'` in the replacement (unlike String.replace
 * with a string pattern when the replacement contains those sequences).
 */
export function replaceLiteral(
  template: string,
  token: string,
  value: string,
): string {
  if (!token) return template;
  return template.split(token).join(value);
}

export function mergeConfig(
  partial?: Partial<CompactorConfig> | null,
): CompactorConfig {
  if (!partial) return { ...DEFAULT_COMPACTOR_CONFIG };
  return {
    rebuildEveryKUserTurns:
      typeof partial.rebuildEveryKUserTurns === "number" &&
      Number.isFinite(partial.rebuildEveryKUserTurns) &&
      partial.rebuildEveryKUserTurns > 0
        ? Math.floor(partial.rebuildEveryKUserTurns)
        : DEFAULT_COMPACTOR_CONFIG.rebuildEveryKUserTurns,
    recentWindow:
      typeof partial.recentWindow === "number" &&
      Number.isFinite(partial.recentWindow) &&
      partial.recentWindow > 0
        ? Math.floor(partial.recentWindow)
        : DEFAULT_COMPACTOR_CONFIG.recentWindow,
    recentWindowWithImages:
      typeof partial.recentWindowWithImages === "number" &&
      Number.isFinite(partial.recentWindowWithImages) &&
      partial.recentWindowWithImages > 0
        ? Math.floor(partial.recentWindowWithImages)
        : DEFAULT_COMPACTOR_CONFIG.recentWindowWithImages,
    digestBudgetChars:
      typeof partial.digestBudgetChars === "number" &&
      Number.isFinite(partial.digestBudgetChars) &&
      partial.digestBudgetChars > 0
        ? Math.floor(partial.digestBudgetChars)
        : DEFAULT_COMPACTOR_CONFIG.digestBudgetChars,
    windowCharBudget:
      typeof partial.windowCharBudget === "number" &&
      Number.isFinite(partial.windowCharBudget) &&
      partial.windowCharBudget > 0
        ? Math.floor(partial.windowCharBudget)
        : DEFAULT_COMPACTOR_CONFIG.windowCharBudget,
  };
}

export function emptyCompactorState(chatId: string): CompactorState {
  return {
    frozenDigest: "",
    rollingSummary: "",
    builtAtUserTurn: -1,
    boundaryIndex: -1,
    chatId: chatId || DEFAULT_CHAT_ID,
  };
}

/**
 * Sum of text lengths in the verbatim recent window (cheap proxy for tokens).
 * Accepts either history-shaped `{ text }` or engine-shaped `{ content }`.
 */
export function estimateWindowChars(
  recent:
    | Array<{ text?: string; content?: string } | null | undefined>
    | null
    | undefined,
): number {
  if (!Array.isArray(recent) || recent.length === 0) return 0;
  let n = 0;
  for (const m of recent) {
    if (!m) continue;
    if (typeof m.text === "string") n += m.text.length;
    else if (typeof m.content === "string") n += m.content.length;
  }
  return n;
}

/**
 * Whether to advance the boundary / refresh the rolling summary.
 * True when there is no prior state, never-built marker, ≥ K user turns have
 * elapsed since the last boundary rebuild, or the verbatim window exceeds
 * windowCharBudget (when `recent` is provided).
 *
 * Does NOT gate the BM25 digest — that is query-time every turn.
 */
export function shouldRebuild(
  state: CompactorState | null | undefined,
  userTurnCount: number,
  config?: Partial<CompactorConfig> | null,
  recent?: Array<{ text?: string; content?: string } | null | undefined> | null,
): boolean {
  const cfg = mergeConfig(config);
  if (!state) return true;
  if (typeof state.builtAtUserTurn !== "number" || state.builtAtUserTurn < 0) {
    return true;
  }
  // Size trigger: long verbatim window forces early rebuild (before K).
  if (recent != null && estimateWindowChars(recent) > cfg.windowCharBudget) {
    return true;
  }
  const turns = Number.isFinite(userTurnCount) ? Math.floor(userTurnCount) : 0;
  return turns - state.builtAtUserTurn >= cfg.rebuildEveryKUserTurns;
}

/** Count user-role messages in history (+ optional current turn not yet in list). */
export function countUserTurns(
  history: Array<{ role?: string }> | null | undefined,
  includeCurrentUser = true,
): number {
  let n = 0;
  if (Array.isArray(history)) {
    for (const m of history) {
      if (m && m.role === "user") n += 1;
    }
  }
  if (includeCurrentUser) n += 1;
  return n;
}

/** Truncate to max code units without splitting a surrogate pair; append … if cut. */
export function truncateBudget(s: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (s.length <= maxChars) return s;
  if (maxChars === 1) return "…";
  let end = maxChars - 1;
  if (end > 0) {
    const c = s.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  }
  if (end <= 0) return "…";
  return s.slice(0, end) + "…";
}

/**
 * Deterministic query-time digest from retriever top-N snippets.
 * Joined with " · ", capped at digestBudgetChars.
 *
 * Call every user turn with the CURRENT user message as `currentQuery`. Prefer a
 * warm per-chat RetrieverIndex (append older units as the boundary advances);
 * if `index` is empty/null a throwaway index is built from `oldTurns`.
 *
 * @param index Warm RetrieverIndex (or compatible) holding older turns.
 * @param oldTurns Turns before the boundary (retrieval corpus; fallback only).
 * @param currentQuery Current user message (retrieval query).
 */
export function buildDigest(
  index: DigestIndex | null | undefined,
  oldTurns: RetrievalUnit[] | null | undefined,
  currentQuery: string | null | undefined,
  config?: Partial<CompactorConfig> | null,
): string {
  const cfg = mergeConfig(config);
  const q = typeof currentQuery === "string" ? currentQuery : "";
  if (!q.trim()) return "";

  const opts: RetrieveOptions = {
    topN: DEFAULT_DIGEST_TOP_N,
    maxCharsPerSnippet: DEFAULT_DIGEST_SNIPPET_CHARS,
  };

  let snippets: RetrievedSnippet[] = [];
  const hasIndexDocs =
    index &&
    typeof index.retrieve === "function" &&
    (typeof index.documentCount !== "number" || index.documentCount > 0);

  if (hasIndexDocs && index) {
    snippets = index.retrieve(q, opts);
  } else if (Array.isArray(oldTurns) && oldTurns.length > 0) {
    const tmp = new RetrieverIndex();
    tmp.append(oldTurns);
    snippets = tmp.retrieve(q, opts);
  }

  if (!snippets.length) return "";

  const parts: string[] = [];
  for (const sn of snippets) {
    const t = typeof sn.text === "string" ? sn.text.trim() : "";
    if (t) parts.push(t);
  }
  if (parts.length === 0) return "";

  const joined = parts.join(" · ");
  return truncateBudget(joined, cfg.digestBudgetChars);
}

/** Size of the recent verbatim window at rebuild (images shrink the target R). */
export function recentWindowSize(
  hasImages: boolean,
  config?: Partial<CompactorConfig> | null,
): number {
  const cfg = mergeConfig(config);
  return hasImages ? cfg.recentWindowWithImages : cfg.recentWindow;
}

/**
 * Resolve a usable boundary index from state.
 * -1 / missing → 0 (whole history is verbatim until first rebuild).
 * Clamped to [0, historyLength].
 */
export function resolveBoundaryIndex(
  state: CompactorState | null | undefined,
  historyLength: number,
): number {
  const len = Number.isFinite(historyLength) ? Math.max(0, Math.floor(historyLength)) : 0;
  if (!state || typeof state.boundaryIndex !== "number" || !Number.isFinite(state.boundaryIndex)) {
    return 0;
  }
  if (state.boundaryIndex < 0) return 0;
  return Math.min(Math.floor(state.boundaryIndex), len);
}

/**
 * Compute the boundary index for a rebuild so the remaining verbatim window
 * is the most recent R messages (or all messages if history is shorter).
 */
export function computeRebuildBoundary(
  historyLength: number,
  hasImages: boolean,
  config?: Partial<CompactorConfig> | null,
): number {
  const len = Number.isFinite(historyLength) ? Math.max(0, Math.floor(historyLength)) : 0;
  const R = recentWindowSize(hasImages, config);
  if (len <= R) return 0;
  return len - R;
}

/**
 * Split history at a fixed boundary (not a sliding last-R each turn).
 * older = messages[0..boundary), recent = messages[boundary..] (grows append-only).
 */
export function splitAtBoundary<T>(
  messages: T[],
  boundaryIndex: number,
): { older: T[]; recent: T[] } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { older: [], recent: [] };
  }
  const b =
    typeof boundaryIndex === "number" && Number.isFinite(boundaryIndex)
      ? Math.max(0, Math.min(Math.floor(boundaryIndex), messages.length))
      : 0;
  return {
    older: messages.slice(0, b),
    recent: messages.slice(b),
  };
}

/**
 * @deprecated Prefer splitAtBoundary + CompactorState.boundaryIndex.
 * Kept for callers that only need a one-shot last-R split (e.g. first rebuild).
 */
export function splitRecentWindow<T>(
  messages: T[],
  hasImages: boolean,
  config?: Partial<CompactorConfig> | null,
): { older: T[]; recent: T[] } {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { older: [], recent: [] };
  }
  const boundary = computeRebuildBoundary(messages.length, hasImages, config);
  return splitAtBoundary(messages, boundary);
}

/**
 * Assemble engine history messages.
 * - compaction OFF → legacy sliding window (20/8 × 4000/2000) — byte-identical path.
 * - compaction ON  → ALL messages from boundaryIndex onward (append-only growth).
 *
 * Images caveat: if the current turn has images and the grown window exceeds
 * Rimg=4, we do NOT shrink retroactively (that would break the KV prefix
 * mid-window). We only cap per-message chars (LEGACY_MAX_CHARS_IMAGES) and let
 * the NEXT rebuild normalize the boundary. Documented intentionally.
 */
export function assembleEngineHistory(
  messages: HistoryRoleMessage[],
  options: {
    compactionEnabled: boolean;
    hasImages: boolean;
    /** Required when compactionEnabled — absolute index into messages. */
    boundaryIndex?: number;
    config?: Partial<CompactorConfig> | null;
  },
): EngineHistoryMessage[] {
  const hasImages = Boolean(options.hasImages);
  // Cap per-message chars; with images use the tighter cap even if the window
  // grew past Rimg (see images caveat above — do not slice the window).
  const maxChars = hasImages ? LEGACY_MAX_CHARS_IMAGES : LEGACY_MAX_CHARS;

  if (!options.compactionEnabled) {
    const start = legacyWindowStartIndex((messages ?? []).length, hasImages);
    return (messages ?? [])
      .slice(start)
      .map((m) => ({
        role: m.role,
        content: m.text.slice(0, maxChars),
      }));
  }

  const boundary = resolveBoundaryIndex(
    {
      boundaryIndex:
        typeof options.boundaryIndex === "number" ? options.boundaryIndex : 0,
      frozenDigest: "",
      rollingSummary: "",
      builtAtUserTurn: 0,
      chatId: "",
    },
    (messages ?? []).length,
  );
  const { recent } = splitAtBoundary(messages ?? [], boundary);
  return recent.map((m) => ({
    role: m.role,
    content: m.text.slice(0, maxChars),
  }));
}

/** Convert history messages to RetrievalUnit[] for digest. */
export function toRetrievalUnits(
  messages: HistoryRoleMessage[],
  startTurnIndex = 0,
): RetrievalUnit[] {
  const out: RetrievalUnit[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (!m || (m.role !== "user" && m.role !== "assistant")) continue;
    if (typeof m.text !== "string") continue;
    out.push({
      turnIndex: startTurnIndex + i,
      role: m.role,
      text: m.text,
    });
  }
  return out;
}

/**
 * Advance the compaction boundary and optionally promote the rolling summary.
 * Cadence: every K user turns (or early size trigger). Does NOT recompute the
 * BM25 digest — call `refreshQueryDigest` every turn for that.
 */
export function advanceCompactionBoundary(
  prev: CompactorState | null | undefined,
  args: {
    chatId: string;
    userTurnCount: number;
    /** Absolute history length at rebuild time (prior messages, no current user). */
    historyLength: number;
    hasImages: boolean;
    config?: Partial<CompactorConfig> | null;
    /** If set, becomes the new rollingSummary; else keep previous. */
    nextSummary?: string | null;
  },
): CompactorState {
  const chatId = args.chatId || DEFAULT_CHAT_ID;
  const boundaryIndex = computeRebuildBoundary(
    args.historyLength,
    args.hasImages,
    args.config,
  );
  const prevSummary =
    typeof args.nextSummary === "string"
      ? args.nextSummary
      : (prev?.rollingSummary ?? "");
  return {
    frozenDigest: prev?.frozenDigest ?? "",
    rollingSummary: truncateBudget(prevSummary, SUMMARY_BUDGET_CHARS),
    builtAtUserTurn: Math.floor(args.userTurnCount),
    boundaryIndex,
    chatId,
  };
}

/**
 * Refresh the BM25 digest for the current user query (every turn).
 * Leaves boundary, builtAtUserTurn, and rollingSummary unchanged.
 */
export function refreshQueryDigest(
  prev: CompactorState | null | undefined,
  args: {
    chatId?: string;
    index: DigestIndex | null | undefined;
    oldTurns: RetrievalUnit[];
    currentQuery: string;
    config?: Partial<CompactorConfig> | null;
  },
): CompactorState {
  const base = prev ?? emptyCompactorState(args.chatId || DEFAULT_CHAT_ID);
  const digest = buildDigest(
    args.index,
    args.oldTurns,
    args.currentQuery,
    args.config,
  );
  return {
    ...base,
    frozenDigest: digest,
    chatId: args.chatId || base.chatId || DEFAULT_CHAT_ID,
  };
}

/**
 * Boundary rebuild + query-time digest in one step (harness / one-shot callers).
 * Production path prefers `advanceCompactionBoundary` (K-turn) +
 * `refreshQueryDigest` (every turn) so the digest can change without moving
 * the boundary.
 */
export function rebuildFrozenDigest(
  prev: CompactorState | null | undefined,
  args: {
    chatId: string;
    userTurnCount: number;
    /** Absolute history length at rebuild time (prior messages, no current user). */
    historyLength: number;
    hasImages: boolean;
    index: DigestIndex | null | undefined;
    oldTurns: RetrievalUnit[];
    currentQuery: string;
    config?: Partial<CompactorConfig> | null;
    /** If set, becomes the new rollingSummary; else keep previous. */
    nextSummary?: string | null;
  },
): CompactorState {
  const advanced = advanceCompactionBoundary(prev, {
    chatId: args.chatId,
    userTurnCount: args.userTurnCount,
    historyLength: args.historyLength,
    hasImages: args.hasImages,
    config: args.config,
    nextSummary: args.nextSummary,
  });
  return refreshQueryDigest(advanced, {
    chatId: args.chatId,
    index: args.index,
    oldTurns: args.oldTurns,
    currentQuery: args.currentQuery,
    config: args.config,
  });
}

/** Serialize / parse helpers for AsyncStorage (caller-owned I/O). */
export function serializeCompactorState(state: CompactorState): string {
  return JSON.stringify({
    frozenDigest: state.frozenDigest ?? "",
    rollingSummary: state.rollingSummary ?? "",
    builtAtUserTurn:
      typeof state.builtAtUserTurn === "number" ? state.builtAtUserTurn : -1,
    boundaryIndex:
      typeof state.boundaryIndex === "number" ? state.boundaryIndex : -1,
    chatId: state.chatId || DEFAULT_CHAT_ID,
  });
}

export function parseCompactorState(
  raw: string | null | undefined,
  chatId: string,
): CompactorState {
  if (!raw || typeof raw !== "string") return emptyCompactorState(chatId);
  try {
    const obj = JSON.parse(raw) as Partial<CompactorState>;
    if (!obj || typeof obj !== "object") return emptyCompactorState(chatId);
    return {
      frozenDigest:
        typeof obj.frozenDigest === "string" ? obj.frozenDigest : "",
      rollingSummary:
        typeof obj.rollingSummary === "string" ? obj.rollingSummary : "",
      builtAtUserTurn:
        typeof obj.builtAtUserTurn === "number" &&
        Number.isFinite(obj.builtAtUserTurn)
          ? Math.floor(obj.builtAtUserTurn)
          : -1,
      boundaryIndex:
        typeof obj.boundaryIndex === "number" &&
        Number.isFinite(obj.boundaryIndex)
          ? Math.floor(obj.boundaryIndex)
          : -1,
      chatId: chatId || DEFAULT_CHAT_ID,
    };
  } catch {
    return emptyCompactorState(chatId);
  }
}

/**
 * Build a short plain-text transcript for the background summarizer.
 * Caps total chars so the job stays within the 30s / 400-token budget.
 */
export function buildSummaryTranscript(
  messages: HistoryRoleMessage[],
  maxChars = 6000,
): string {
  if (!Array.isArray(messages) || messages.length === 0) return "";
  const lines: string[] = [];
  let total = 0;
  // Prefer more recent older-turns (end of the older slice).
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (!m || typeof m.text !== "string") continue;
    const body = m.text.trim();
    if (!body) continue;
    const role = m.role === "assistant" ? "ASSISTANT" : "USER";
    const line = `${role}: ${body}`;
    if (total + line.length + 1 > maxChars) break;
    lines.push(line);
    total += line.length + 1;
  }
  lines.reverse();
  return lines.join("\n");
}
