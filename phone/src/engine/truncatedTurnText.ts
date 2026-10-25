/**
 * A turn must never end with an empty bubble.
 *
 * A forced-open round that truncates inside its think block (n_predict
 * exhausted, abort, stall) strips to ZERO visible text while its reasoning
 * exists. The arbitration in thinkStream correctly refuses to serve reasoning
 * as the answer — so the turn would close with nothing: no delta ever fired
 * (the abort path deletes the placeholder wholesale) and the final emit is
 * gated on non-empty text. The coherent answer: emit the localized
 * interruption marker as the visible text and let the reasoning ride in the
 * thinking field.
 */
export function visibleTurnText(args: {
  /** Cleaned text this round produced after think/tool arbitration. */
  finalText: string;
  /** Total visible text already streamed this turn (all rounds). */
  streamedVisibleLength: number;
  /** Reasoning captured for the turn (the thinking field). */
  thinking: string;
  /** Localized marker emitted when the turn would otherwise be empty. */
  interruptedMarker: string;
}): string {
  if (args.finalText.length > 0) return args.finalText;
  if (args.streamedVisibleLength > 0) return args.finalText;
  if (args.thinking.trim().length === 0) return args.finalText;
  return args.interruptedMarker;
}
