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
  /** Tool names emitted this round (for bench tool-selection grading). Privacy-safe: names only, no arguments. */
  toolNames: string[];
};

/**
 * Known tool names that Kalsa exposes to the model.
 * MUST stay in sync with src/app/AppShell.tsx:1698 (the tools array).
 * Adding a fourth tool requires updating BOTH files, or unknown tools
 * silently become "other" and selection grading breaks.
 */
const KNOWN_TOOL_NAMES = Object.freeze(["web_search", "web_fetch", "document_chat"]);

/**
 * Placeholder for tool names the model produced but Kalsa does not recognize.
 * Single fixed token so an unknown name is visible as a count, not its content.
 */
const UNKNOWN_TOOL_PLACEHOLDER = "other";

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
 * Clamp tool names to the known set. Unknown names become the placeholder,
 * so an arbitrary model-invented string never reaches the log.
 * The count is preserved: each input name maps to exactly one output token.
 */
export function clampToolNames(names: string[]): string[] {
  if (!Array.isArray(names)) return [];
  return names.map((name) =>
    KNOWN_TOOL_NAMES.includes(name) ? name : UNKNOWN_TOOL_PLACEHOLDER,
  );
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
    toolNames: clampToolNames(r.toolNames),
  })}`;
}
