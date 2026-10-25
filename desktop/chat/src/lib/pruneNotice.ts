import type { RecapWords } from "./browser/recap";

/**
 * The line the thread draws when the fit left turns behind. The count is the
 * fit's own answer (`buildPinnedContext().dropped`), stored on the turn, and
 * this is the one place that decides whether a row exists at all: nothing was
 * left behind, so there is no row to draw.
 *
 * It only words the number. Nothing it returns reaches the wire.
 */
export function pruneNotice(dropped: number, words: RecapWords): string | null {
  if (dropped <= 0) return null;
  return words.leftBehind(dropped);
}
