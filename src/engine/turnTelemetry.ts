/**
 * Per-turn completion telemetry (counters + timings + optional tool metadata).
 *
 * WHY these fields:
 * - tokensCached vs tokensEvaluated: KV-cache health (reuse vs full re-eval).
 * - tokensPredicted: generation length; also a hidden-token detector when UI
 *   token count diverges from native predicted count.
 * - draftTokens / draftAccepted: multi-token prediction (MTP) acceptance rate.
 * - promptMs / predictedMs / predictedPerSecond: prefill vs decode split.
 * - tool / strategy: last SUCCESSFUL tool earlier in this turn (see
 *   ToolAttributionTracker). Omitted when no successful tool has run yet.
 *
 * NEVER log user text, completion content, document paths, or document text —
 * counters, timings, and tool-name / strategy labels only.
 */

/**
 * Retrieval strategy labels emitted by document_chat (and related tools).
 * Keep in sync with DocumentChatToolResult.strategy in documentChatTool.ts.
 * null / absent on RoundTelemetry = no successful document tool this turn.
 */
export type ToolRetrievalStrategy =
  | "hybrid"
  | "bm25_only"
  | "full_context"
  | "vision_fallback"
  | "retrieve"
  | "error"
  | null;

const STRATEGY_SET: ReadonlySet<string> = new Set([
  "hybrid",
  "bm25_only",
  "full_context",
  "vision_fallback",
  "retrieve",
  "error",
]);

/** Narrow an unknown strategy string to the shared union (or null). */
export function normalizeToolStrategy(
  value: unknown,
): ToolRetrievalStrategy {
  if (typeof value !== "string" || !value) return null;
  return STRATEGY_SET.has(value) ? (value as ToolRetrievalStrategy) : null;
}

/**
 * Pure state machine for last-successful-tool attribution within one turn.
 *
 * Event-order contract (also documented at the KALSA_TELEMETRY emission site):
 * - snapshot() reflects the last SUCCESSFUL tool before the current completion.
 * - A first tool-call round has no fields yet (tool/strategy null).
 * - Failed tools (structured error results or thrown failures) must NOT
 *   overwrite a prior successful attribution.
 * - Call reset() at the start of each new user turn.
 */
export type ToolAttributionSnapshot = {
  tool: string | null;
  strategy: ToolRetrievalStrategy;
};

export class ToolAttributionTracker {
  private tool: string | null = null;
  private strategy: ToolRetrievalStrategy = null;

  /**
   * Record a genuinely successful tool outcome.
   * Callers must only invoke this when the result is not an error
   * (no result.error and strategy !== "error").
   */
  onToolSuccess(name: string, strategy?: unknown): void {
    if (!name) return;
    this.tool = name;
    // Non-document tools clear strategy so synthesis does not carry a stale
    // document_chat strategy from an earlier tool in the same turn.
    this.strategy = normalizeToolStrategy(strategy);
  }

  /**
   * A tool threw or returned a structured failure.
   * Does not clear a prior successful attribution (last success still stands
   * for the synthesis telemetry line).
   */
  onToolFailure(): void {
    // Intentionally a no-op for attribution: failed tools must not be recorded
    // as the "last successful tool". Kept as an explicit method so call sites
    // and harnesses document the failure path.
  }

  snapshot(): ToolAttributionSnapshot {
    return { tool: this.tool, strategy: this.strategy };
  }

  reset(): void {
    this.tool = null;
    this.strategy = null;
  }
}

/**
 * True when an EngineToolResult-like object is a genuine success for
 * tool/strategy attribution. Structured error results (document_chat with
 * strategy:"error" or an error field) are treated as failures even when the
 * executor did not throw.
 */
export function isSuccessfulToolOutcome(result: {
  error?: unknown;
  strategy?: unknown;
}): boolean {
  if (result == null) return false;
  if (result.error != null && result.error !== "") return false;
  if (result.strategy === "error") return false;
  return true;
}

export type RoundTelemetry = {
  round: number;
  tokensCached: number; // result.tokens_cached
  tokensEvaluated: number; // result.tokens_evaluated (prompt tokens processed)
  tokensPredicted: number; // result.tokens_predicted
  draftTokens: number; // result.draft_tokens ?? 0
  draftAccepted: number; // result.draft_tokens_accepted ?? 0
  promptMs: number; // timings.prompt_ms ?? -1
  predictedMs: number; // timings.predicted_ms ?? -1
  predictedPerSecond: number; // timings.predicted_per_second ?? -1
  contextFull: boolean;
  interrupted: boolean;
  /**
   * Optional: tool name actually invoked successfully earlier in this turn
   * (e.g. "document_chat" / "web_search" / "web_fetch").
   * Omitted when no successful tool ran yet (backward-compatible JSON).
   */
  tool?: string;
  /**
   * Optional: retrieval strategy from a successful document_chat call.
   * Omitted when not a document_chat success this turn.
   */
  strategy?: Exclude<ToolRetrievalStrategy, null>;
};

/** Loose completion-like shape (llama.rn NativeCompletionResult field names). */
export type CompletionLikeResult = {
  tokens_cached?: number;
  tokens_evaluated?: number;
  tokens_predicted?: number;
  draft_tokens?: number;
  draft_tokens_accepted?: number;
  context_full?: boolean;
  interrupted?: boolean;
  timings?: {
    prompt_ms?: number;
    predicted_ms?: number;
    predicted_per_second?: number;
  } | null;
};

/**
 * Build RoundTelemetry from a completion-like result.
 * Defaults: token/draft counts → 0; missing timings → -1; booleans → false.
 */
export function roundTelemetryFromResult(
  result: CompletionLikeResult,
  round: number,
): RoundTelemetry {
  const timings = result.timings ?? null;
  return {
    round,
    tokensCached: result.tokens_cached ?? 0,
    tokensEvaluated: result.tokens_evaluated ?? 0,
    tokensPredicted: result.tokens_predicted ?? 0,
    draftTokens: result.draft_tokens ?? 0,
    draftAccepted: result.draft_tokens_accepted ?? 0,
    promptMs: timings?.prompt_ms ?? -1,
    predictedMs: timings?.predicted_ms ?? -1,
    predictedPerSecond: timings?.predicted_per_second ?? -1,
    contextFull: result.context_full ?? false,
    interrupted: result.interrupted ?? false,
  };
}

/**
 * Machine-parseable single line for adb logcat / CI.
 * Prefix is stable; payload is counters+timings (+ optional tool metadata) only
 * — NEVER user text or document paths.
 */
export function formatTelemetryLine(turnId: string, r: RoundTelemetry): string {
  // Spread keeps optional tool/strategy only when set (undefined keys drop out of JSON).
  return `KALSA_TELEMETRY ${JSON.stringify({ turnId, ...r })}`;
}
