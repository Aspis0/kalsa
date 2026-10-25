/**
 * Sampling for a round that may only answer in words.
 *
 * A text-only round — the last tool round (tool_choice "none") and the
 * tool-round rescue attempts — is the round that has to LAND. On LFM2.5 2.6B
 * (device log, web question, 2026-10-17) it came back as `<|tool_call_start|>`
 * markup with nothing before it, so the whole round stripped to zero visible
 * text and the turn closed on "Generation was interrupted."
 *
 * Two changes, both local to text-only rounds, neither touching the prompt:
 *  - stop AT the tool-call start token, so prose the model wrote BEFORE the
 *    markup survives as the answer (the stripper would otherwise eat it with
 *    the markup);
 *  - a focused temperature, so the second draw is not another 0.7 roll of the
 *    same markup.
 *
 * Pure, like the modules beside it: no engine, no React Native.
 */

import { LFM_TOOL_CALL_START } from "./toolCallParser";

/**
 * Temperature for a round that can only answer in words. Deliberate heat is
 * right for the search rounds (varied queries, varied phrasing) and wrong here:
 * the job is to summarize what is already in context, and every extra degree
 * buys another chance to reach for a tool the round cannot call.
 */
export const TEXT_ONLY_TEMPERATURE = 0.3;

/**
 * Whether this turn's model speaks the LFM tool dialect, i.e. the one whose
 * tool calls arrive as `<|tool_call_start|>` markup.
 *
 * Matched on the RAW id, never on the resolved catalog record: getModelById
 * falls back to the DEFAULT model for an unknown id, and the default is the
 * LFM one (ModelRegistry.ts:301-304). Matching the resolved record would hand
 * every unknown id — the remote computer model above all — LFM's sampling,
 * which is exactly the model whose turn this fix is not for. Unknown id → false.
 */
export function usesLfmToolDialect(modelId: string | null | undefined): boolean {
  return typeof modelId === "string" && modelId.toLowerCase().startsWith("lfm");
}

/**
 * How many text-only attempts a turn may spend trying to get words out of the
 * model after its tool rounds produced none. Bounded: each one is a full local
 * completion on a phone, so this is 2 and not "until it answers". Past this the
 * never-empty floor closes the turn from the sources it already gathered.
 */
export const MAX_TEXT_ONLY_ATTEMPTS = 2;

/**
 * The round's stop words plus the tool-call start token, so generation ENDS
 * where the markup begins and every token before it is kept.
 *
 * Only the LFM dialect is stopped: it is the dialect this engine's models emit
 * and the one the log caught. The other dialect the parser recovers (Qwen's
 * XML-ish pair) is not in the list on purpose — a stop word that fires on a
 * legitimate mention would cut a good answer, and the floor already covers a
 * round that spends itself on that markup instead.
 */
export function withToolCallStop(stopWords: readonly string[]): string[] {
  return [...stopWords, LFM_TOOL_CALL_START];
}