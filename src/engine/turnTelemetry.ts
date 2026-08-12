/**
 * Per-turn completion telemetry (counters + timings only).
 *
 * WHY these fields:
 * - tokensCached vs tokensEvaluated: KV-cache health (reuse vs full re-eval).
 * - tokensPredicted: generation length; also a hidden-token detector when UI
 *   token count diverges from native predicted count.
 * - draftTokens / draftAccepted: multi-token prediction (MTP) acceptance rate.
 * - promptMs / predictedMs / predictedPerSecond: prefill vs decode split.
 *
 * NEVER log user text or completion content — counters and timings only.
 */

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
   * Optional: tool name actually invoked earlier in this turn
   * (e.g. "document_chat" / "web_search" / "web_fetch").
   * Omitted when no tool ran yet (backward-compatible JSON).
   */
  tool?: string;
  /**
   * Optional: retrieval strategy from document_chat
   * (hybrid / bm25_only / full_context / vision_fallback / error).
   * Omitted when not a document_chat turn.
   */
  strategy?: string;
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
 * Prefix is stable; payload is counters+timings only — NEVER user text.
 */
export function formatTelemetryLine(turnId: string, r: RoundTelemetry): string {
  // Spread keeps optional tool/strategy only when set (undefined keys drop out of JSON).
  return `KALSA_TELEMETRY ${JSON.stringify({ turnId, ...r })}`;
}
