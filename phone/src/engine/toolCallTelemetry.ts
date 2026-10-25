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

import { ALL_TOOL_NAMES } from "../agent/toolNames";

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
  blockedPrivacy: number; // web_search refused by the tool gate (memory echo or sensitive pattern)
  namesValid: boolean; // every emitted call named a tool that exists
  argsParsed: boolean; // every emitted call had args that parsed as an object
  /** Tool names emitted this round (for bench tool-selection grading). Privacy-safe: names only, no arguments. */
  toolNames: string[];
};

/**
 * Known tool names that Kalsa exposes to the model.
 * This is the same list exported by toolRegistry, without loading tool
 * definitions or React Native/provider modules into telemetry.
 */
const KNOWN_TOOL_NAMES = new Set<string>(ALL_TOOL_NAMES);

/**
 * Placeholder for tool names the model produced but Kalsa does not recognize.
 * Single fixed token so an unknown name is visible as a count, not its content.
 */
const UNKNOWN_TOOL_PLACEHOLDER = "other";

/**
 * Telemetry for the "tool rounds done without text" rescue path. Fires when no
 * tool round produced user-visible text: the loop used all MAX_TOOL_ROUNDS, or
 * it left early because a "none" round's only output was a tool call it was not
 * allowed to run (blank bubble case). Counters-only: no model or user text.
 *
 * The three ways a turn can close after that are reported separately, because
 * they are three different bugs: a rescue that answered (fine), a rescue that
 * did not and the floor spoke from the sources (the model stayed silent), and
 * a rescue that did not with nothing gathered (nothing was found at all).
 */
export type ToolRoundExhaustedTelemetry = {
  /** Rounds the turn actually ran: MAX_TOOL_ROUNDS, or fewer when it left
   *  early. Must stay the real count — this line is what bench reads. */
  roundsUsed: number;
  streamedLen: number;     // length of streamed text before fallback (should be 0)
  fallbackFired: boolean;  // did we try the text-only completion(s)?
  /** Did a rescue attempt produce words in the model's own voice? */
  fallbackAnswered: boolean;
  /** Text-only attempts actually spent (0 when the round bailed, 1 or 2 when it
   *  ran; MAX_TEXT_ONLY_ATTEMPTS is the bound). */
  fallbackAttempts: number;
  /** What closed the turn when no attempt answered: the never-empty floor over
   *  the gathered sources, or the honest canned message when there were none.
   *  "none" when the model answered (or when the rescue never ran). */
  floor: "none" | "sources" | "canned";
  /** Length of the LAST attempt's raw text. Zero when it never ran or threw
   *  before producing one. A count, never the text. */
  rawLen: number;
  /** Did the LAST attempt's think arbitration see think markup (or a
   * template-opened block)? With `sawToolMarkup` false this is what
   * separates "answered" from "thought and got cut". */
  sawThink: boolean;
  /** Did the LAST attempt's raw text carry fallback-dialect tool markup? */
  sawToolMarkup: boolean;
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
    fallbackAnswered: r.fallbackAnswered,
    fallbackAttempts: r.fallbackAttempts,
    floor: r.floor,
    rawLen: r.rawLen,
    sawThink: r.sawThink,
    sawToolMarkup: r.sawToolMarkup,
  })}`;
}

/**
 * Clamp tool names to the known set. Unknown names become the placeholder,
 * so an arbitrary model-invented string never reaches the log.
 * The count is preserved: each input name maps to exactly one output token.
 */
export function clampToolNames(names: string[]): string[] {
  if (!Array.isArray(names)) return [];
  return names.map(clampToolName);
}

/**
 * Single-name form of the same clamp, for lines that carry one tool. The tool
 * name on a completion comes from the model (`call.function?.name`), so a
 * prompt-injected document can make it arbitrary text; every log that prints it
 * must clamp, not just this file's own line.
 */
export function clampToolName(name: unknown): string {
  return typeof name === "string" && KNOWN_TOOL_NAMES.has(name)
    ? name
    : UNKNOWN_TOOL_PLACEHOLDER;
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
