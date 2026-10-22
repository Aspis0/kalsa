/**
 * What the transcript keeps of a tool's answer: the beginning of it, and the
 * mark that says the rest was left behind.
 *
 * **The mark is the app's sentence, not the answer's words.** Whoever reads a
 * page's words out of a fence takes the mark off: it is what the app said
 * about the page, and a page's text that carries it would say something the
 * page never said. **It comes off where the record put it** — at the end of
 * an answer it cut, and a cut answer is one whose fence was never closed. A
 * page that ends with the same words is keeping its own, and they stay.
 */

/** The characters a stored answer keeps. */
export const KEPT_RESULT_CHARS = 1_200;

/** The mark a cut answer carries, at the end of what was kept. */
export const CUT_MARK = "\n\n[The rest of this result was not kept after the turn.]";
