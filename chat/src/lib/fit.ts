/** What the panel's fit note says: nothing, that the fit is unknown, that
    there is too much, or that the room is nearly gone. */
export type FitView = "hidden" | "unknown" | "over" | "almost" | "quiet";

/** The share of the window that must stay free before the panel says the
    conversation is almost full. */
export const ALMOST_FULL_SHARE = 0.15;

/**
 * The fit note's state. "Kalsa can't check whether these files fit" is about
 * files: with none attached there is nothing to fit and nothing to warn
 * about, so an unknown context size says nothing then — whatever the history
 * weighs, and however little an attached file weighs. Too much is still too
 * much without files when the size is known — earlier messages alone can fill
 * the room. A known size that still has room keeps quiet: one sentence, and
 * only when the free share falls below a sixth of the window.
 */
export function fitView(
  contextTokens: number | null,
  fileCount: number,
  docTokens: number,
  historyTokens: number,
  reserve: number,
): FitView {
  if (contextTokens === null) return fileCount > 0 ? "unknown" : "hidden";
  const free = contextTokens - docTokens - historyTokens - reserve;
  if (free < 0) return "over";
  return free < contextTokens * ALMOST_FULL_SHARE ? "almost" : "quiet";
}
