/**
 * The messages the tool-round fallback completion sends.
 *
 * The fallback asks the model to answer from the tool results already in the
 * turn, with no tools bound. It must not send the turn's own system prompt: that
 * prompt is built with tools and orders the model to reach for web_search on
 * exactly the questions the fallback is trying to close ("usalo SEMPRE ... notizie
 * recenti ... cerca online"), so a text-only round still comes back as LFM tool
 * markup and the user gets the canned error instead of an answer. S23, LFM2.5
 * 2.6B: round 2 was markup only, the fallback was markup only again
 * (KALSA_TOOLROUND_EXHAUSTED fallbackOk:false).
 *
 * So the fallback swaps the system message for the no-tools one plus the
 * results note, and changes nothing else. Only the tool instructions move: the
 * operative block never lives in this message (applyOperativeBlockFormat puts
 * it in the last user message, in a second system message, or in a synthetic
 * user note), and the memory facts either ride the last user message or are
 * appended by buildSystemPrompt itself, so both survive the swap untouched.
 *
 * The note carries back the two rules the no-tools prompt drops along with the
 * tool rules — answer from the results, say so if they don't cover it, cite by
 * title — because answering from those results is the only reason this round
 * runs.
 *
 * Pure, like toolRoundFallback.ts beside it: the turn's transcript is never
 * mutated, because the same messages feed the rounds that come after it and
 * the history that gets persisted.
 */

export type SystemChatMessage = { role: "system"; content: string };

export type FallbackSystemPrompt = {
  /** buildSystemPrompt(locale, false, facts): the turn's prompt minus the tool rules. */
  systemText: string;
  /** "Answer from the results above, and cite by title" — what that prompt drops. */
  resultsNote: string;
};

/**
 * `messages` with the fallback's system message in front, same order and the
 * same message objects everywhere else. A first message that is not a system one
 * is returned as a copy, unchanged: there is nothing to swap, and the fallback
 * must still not send the turn's array by reference.
 *
 * The note is appended to the END of buildSystemPrompt's own output, so the
 * legacy memory-facts block (the MEMORY_FACTS_ON_USER_TAIL false path, appended
 * inside that function) stays exactly where buildSystemPrompt put it, between
 * the prompt and the note.
 */
export function buildFallbackMessages<TMessage extends { role: string }>(
  messages: readonly (TMessage | SystemChatMessage)[],
  prompt: FallbackSystemPrompt,
): Array<TMessage | SystemChatMessage> {
  const head = messages[0];
  if (head === undefined || head.role !== "system") return messages.slice();
  return [
    { role: "system", content: `${prompt.systemText}\n\n${prompt.resultsNote}` },
    ...messages.slice(1),
  ];
}