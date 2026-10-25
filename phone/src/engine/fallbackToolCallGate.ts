/**
 * Pure decisions about a round's fallback-dialect tool calls: may they be
 * parsed and run, how many the model asked for while the gate said no, and what
 * such a round closes with.
 *
 * Extracted from LlamaService.ts so the conditions can be exercised without
 * llama.rn or a loaded model. The parsing, the execution and the I/O stay in
 * LlamaService.ts; this module holds only the questions of whether they may run.
 *
 * A round whose tool_choice is "none" is a round that was told not to call a
 * tool: the final tool round, a forceTextOnly round, a turn with no tools, or a
 * bench arm in "none". Parsing fallback markup there would execute a tool the
 * completion was explicitly forbidden from asking for — the round's own
 * telemetry then reports executed calls it was never allowed to make. The
 * markup is still stripped from the visible text either way; that is the
 * stripper's job, not this gate's.
 */
import type { CompletionToolChoice } from "../bench/benchConfig";
import {
  hasToolCallMarkup,
  parseFallbackToolCalls,
  stripToolCallTagsFinal,
} from "./toolCallParser";
import { arbitrateThinkTags } from "./thinkStream";

export function shouldParseFallbackCalls(args: {
  /** Tool calling is available to this turn at all (a bench arm or model that
   *  has tools switched on). */
  toolCallingEnabled: boolean;
  /** Structured tool_calls the binding already returned for this round. */
  structuredCount: number;
  /** The tool_choice this round's completion was called with. */
  toolChoice: CompletionToolChoice;
  /** The turn carries an executor to run a call with. */
  hasExecutor: boolean;
}): boolean {
  if (!args.toolCallingEnabled || !args.hasExecutor) return false;
  if (args.toolChoice === "none") return false;
  return args.structuredCount === 0;
}

/**
 * The calls this round's raw text carried that the gate refused to run.
 *
 * Counted, never executed. A "none" round that asked for a tool anyway is the
 * failure this gate exists for, and a telemetry line reporting fallbackCalls 0
 * for it would hide exactly the round that needs looking at.
 *
 * Zero whenever the gate allowed the parse (those calls were parsed normally
 * and are counted on that path) and whenever tool calling was off for the turn:
 * a bench "none" arm and a tool-less turn are untouched here.
 */
export function countSuppressedFallbackCalls(args: {
  /** shouldParseFallbackCalls' answer for this round. */
  gateAllowedParse: boolean;
  toolCallingEnabled: boolean;
  toolChoice: CompletionToolChoice;
  /** This round's raw model text, markup not yet stripped. */
  rawText: string;
}): number {
  if (args.gateAllowedParse || !args.toolCallingEnabled) return 0;
  if (args.toolChoice !== "none") return 0;
  if (!hasToolCallMarkup(args.rawText)) return 0;
  return parseFallbackToolCalls(args.rawText).length;
}

/**
 * True when a round that ran no tool call must close through the blank-reply
 * fallback instead of returning as it stands.
 *
 * The round answered the only way it knew how — with a tool call — on a round
 * that was told not to make one, so the markup is stripped and nothing is left
 * to show. Returning here would be the empty bubble (or, with a reasoning span
 * in the same text, the "Generation was interrupted." marker); the text-only
 * fallback is what turns "I wanted to call a tool" into an answer.
 *
 * A round that produced any visible text keeps the early return: the user
 * already has an answer, and a second completion would only say more.
 */
export function shouldRunBlankReplyFallback(args: {
  /** countSuppressedFallbackCalls for this round. Zero means nothing was
   *  suppressed, so there is nothing this routing is for. */
  suppressedCalls: number;
  /** Visible text the turn has streamed so far, all rounds. */
  streamedText: string;
  /** This round's raw model text, markup not yet stripped. */
  rawText: string;
}): boolean {
  if (args.suppressedCalls === 0) return false;
  // Same order the fallback round uses: think arbitration first, tool markup
  // second. Stripping only the tool tags would leave the reasoning span behind
  // and read this blank round as one that said something.
  const visible = stripToolCallTagsFinal(arbitrateThinkTags(args.rawText));
  // Both halves count: a backend that returns its text without ever firing the
  // token callback still produced prose, and the fallback would repeat it.
  return args.streamedText.trim().length === 0 && visible.trim().length === 0;
}