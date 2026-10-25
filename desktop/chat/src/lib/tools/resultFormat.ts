// The shape a web_search answer has on the wire: the provider's own result
// text, then the page blocks this app appends underneath it (searchPages.ts).
// One place knows both shapes, because a page is a stranger's words and
// everything here is about keeping them out of what the app decides.

/** How exa.rs writes one result's own address line: three spaces, `URL: `, the
    address. A search's prose is text the query steered, so only these lines'
    addresses are the provider's. */
export const URL_LINE = "   URL: ";

/** The start of a block this app appended for a page it read: a blank line,
    then `Page <n> (<the address it was read at>):`. Deliberately narrow — a
    provider's own text can contain anything, so a line that does not match
    this shape is never taken for one. */
const HEADER = /\n\nPage \d+ \((https?:\/\/[^)\n]+)\):\n/;

/** Where the provider's part of a search's answer ends, and what each of the
    blocks after it holds. Not a security boundary: a boundary mistake can only
    move text between "URL lines only" and "fetch-level trust" (fetchProvenance
    reads both), and fetch-level trust is what the model already gets by opening
    the page itself — so no mistake here grants more than `web_fetch` does. */
const PAGE_BLOCK = HEADER;

/** The same block anywhere in the text, with the address it was read at. */
export const PAGE_HEADERS = new RegExp(HEADER.source, "g");

/**
 * Each page block's text, without its header. These are the pages the app read
 * on the model's behalf, and the provenance rule trusts them as it trusts a
 * page the model opened itself.
 */
export function pageTexts(result: string): string[] {
  const starts: number[] = [];
  const ends: number[] = [];
  for (const match of result.matchAll(PAGE_HEADERS)) {
    starts.push(match.index);
    ends.push(match.index + match[0].length);
  }
  return ends.map((end, index) => result.slice(end, starts[index + 1] ?? result.length));
}

/**
 * The address as a block header can carry it: parentheses percent-encoded, plus
 * the whitespace `encodeURIComponent` does handle. `encodeURIComponent` alone
 * would leave `(` and `()` exactly as they are, and a Wikipedia address would
 * close the header early. Nothing here is ever decoded back — the encoded form
 * is the form every comparison uses, so a real `%28` in a path stays itself.
 */
export function encodeAddress(url: string): string {
  return url.replace(/[()\s]/g, (character) => (character === "(" ? "%28" : character === ")" ? "%29" : encodeURIComponent(character)));
}

/** The provider's part of a search's answer: everything before the first block
    this app appended. */
export function providerText(result: string): string {
  const at = result.search(PAGE_BLOCK);
  return at < 0 ? result : result.slice(0, at);
}