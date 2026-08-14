/**
 * Per-round tool-call telemetry (counters + enums + booleans only).
 *
 * Distinguishes: never emitted / unreadable / fallback-recovered / skipped /
 * executed / failed / privacy-blocked. This line is a CI artifact and passes
 * through logcat.
 *
 * NEVER log tool arguments, query strings, URLs, tool results, or user text.
 * A count of characters is acceptable; a string of content is a leak.
 */

export type ToolRoundTelemetry = {
  round: number;
  toolChoice: string; // value actually passed to the engine ("auto" / "none" / …)
  structuredCalls: number; // result.tool_calls?.length ?? 0
  fallbackCalls: number; // recovered by the fallback text parser
  fallbackDialect: "qwen" | "lfm" | "openai" | "none";
  executed: number; // calls actually executed this round
  skippedCap: number; // dropped by the per-round slice
  skippedDup: number; // skipped by the dedup ledger
  skippedFailedRepeat: number; // skipped by the failed-repeat rule
  failed: number; // executions that threw or returned an error
  blockedPrivacy: number; // refused by the web-search echo guard
  namesValid: boolean; // every emitted call named a tool that exists
  argsParsed: boolean; // every emitted call had args that parsed as an object
};

/**
 * Telemetry for the "tool rounds exhausted without text" fallback path.
 * Fires when the tool loop uses all MAX_TOOL_ROUNDS but no round produced
 * user-visible text (blank bubble case). Counters-only: no model or user text.
 */
export type ToolRoundExhaustedTelemetry = {
  roundsUsed: number;      // MAX_TOOL_ROUNDS (should be 3)
  streamedLen: number;     // length of streamed text before fallback (should be 0)
  fallbackFired: boolean;  // did we try the extra text-only completion?
  fallbackOk: boolean;     // did the extra completion produce text?
};

/**
 * Machine-parseable single line for adb logcat / CI.
 * Fields listed by name so extra properties on `r` cannot leak into the payload.
 */
export function formatToolRoundExhaustedLine(turnId: string, r: ToolRoundExhaustedTelemetry): string {
  return `KALSA_TOOLROUND_EXHAUSTED ${JSON.stringify({
    turnId,
    roundsUsed: r.roundsUsed,
    streamedLen: r.streamedLen,
    fallbackFired: r.fallbackFired,
    fallbackOk: r.fallbackOk,
  })}`;
}

/**
 * Machine-parseable single line for adb logcat / CI.
 * Fields listed by name so extra properties on `r` cannot leak into the payload.
 */
export function formatToolCallLine(turnId: string, r: ToolRoundTelemetry): string {
  return `KALSA_TOOLCALL ${JSON.stringify({
    turnId,
    round: r.round,
    toolChoice: r.toolChoice,
    structuredCalls: r.structuredCalls,
    fallbackCalls: r.fallbackCalls,
    fallbackDialect: r.fallbackDialect,
    executed: r.executed,
    skippedCap: r.skippedCap,
    skippedDup: r.skippedDup,
    skippedFailedRepeat: r.skippedFailedRepeat,
    failed: r.failed,
    blockedPrivacy: r.blockedPrivacy,
    namesValid: r.namesValid,
    argsParsed: r.argsParsed,
  })}`;
}
