/** What the fit bar says: nothing, that the fit is unknown, that there is too
    much, or the bar itself. */
export type FitView = "hidden" | "unknown" | "over" | "bar";

/**
 * The fit bar's state. "Kalsa can't check whether these files fit" is about
 * files: with none attached there is nothing to fit and nothing to warn
 * about, so an unknown context size says nothing then — whatever the history
 * weighs, and however little an attached file weighs. Too much is still too
 * much without files when the size is known — earlier messages alone can fill
 * the room.
 */
export function fitView(
  contextTokens: number | null,
  fileCount: number,
  docTokens: number,
  historyTokens: number,
  reserve: number,
): FitView {
  if (contextTokens === null) return fileCount > 0 ? "unknown" : "hidden";
  return contextTokens - docTokens - historyTokens - reserve < 0 ? "over" : "bar";
}
