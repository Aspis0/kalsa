/**
 * Pure decision: should the tool-round-exhausted fallback fire?
 *
 * Extracted from LlamaService.ts so a Node harness can exercise the shipped
 * decision without needing llama.rn or a loaded model. The I/O (extra
 * completion, localized message) stays in LlamaService.ts; this module holds
 * only the condition that determines whether that I/O runs.
 *
 * The harness imports this compiled module directly — a mutation here turns
 * the harness red. No re-implementation copies.
 */

/**
 * True when the streamed text (after think-tag and tool-call markup stripping)
 * carries no user-visible content. Fires the two-tier fallback: one extra
 * text-only completion, then a localized honest message if that also produces
 * nothing.
 *
 * Trimmed comparison: whitespace-only output (spaces, newlines, tabs) counts
 * as empty — the user would see a blank bubble otherwise.
 */
export function shouldFireToolRoundFallback(streamedText: string): boolean {
  return streamedText.trim().length === 0;
}
