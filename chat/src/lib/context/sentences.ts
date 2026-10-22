/** The longest unit the digest carries, in characters. A page with no full stop
    would otherwise be one unit as long as the page, and one pick would eat the
    whole budget. */
export const MAX_UNIT_CHARS = 300;

/**
 * A text cut into sentences, verbatim: a line break or a full stop followed by
 * a space ends one. A sentence longer than the cap is cut again at a space,
 * so no piece is larger than the cap and no word is split, unless it is longer
 * than the cap itself.
 */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?…])\s+/u)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "")
    .flatMap(cut);
}

function cut(sentence: string): string[] {
  if (sentence.length <= MAX_UNIT_CHARS) return [sentence];
  const pieces: string[] = [];
  let rest = sentence;
  while (rest.length > MAX_UNIT_CHARS) {
    const space = rest.lastIndexOf(" ", MAX_UNIT_CHARS);
    // A word longer than the cap has no space to cut at: it is cut where the cap
    // falls, which is the one place a unit is not a whole word.
    const at = space > 0 ? space : MAX_UNIT_CHARS;
    pieces.push(rest.slice(0, at).trim());
    rest = rest.slice(at).trim();
  }
  if (rest !== "") pieces.push(rest);
  return pieces;
}
