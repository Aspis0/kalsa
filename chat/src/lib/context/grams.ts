/**
 * The one form every text takes before it is matched: accents folded,
 * lowercase, letters and digits only. «Caffè» and «caffe» are the same word,
 * and «89,99 €» reads as the two numbers it is.
 */
export function foldWords(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== "");
}

/**
 * The character grams of a text: each word padded with a space on both sides,
 * then cut into its 3-grams and 4-grams. Grams never cross a word boundary,
 * and the padding is what marks where a word starts and ends, so a typo costs
 * a few grams instead of the whole word.
 */
export function grams(text: string): string[] {
  return gramsOf(foldWords(text));
}

/**
 * The grams of words that are already folded: the same grams, without folding
 * them again. A unit's words are folded once and read by the matcher, by the
 * shape and by the score, and a fold per read is a fold per unit.
 */
export function gramsOf(words: string[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    const padded = ` ${word} `;
    for (let size = 3; size <= 4; size++) {
      for (let at = 0; at + size <= padded.length; at++) {
        out.push(padded.slice(at, at + size));
      }
    }
  }
  return out;
}
