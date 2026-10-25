// Reading addresses out of text, and folding one to a shape two spellings of
// it can share. Both halves of the provenance rule stand on this: what counts
// as an address in a page, and what counts as the same address twice.

/** Full addresses and bare `host.tld/…` shapes. The stop class ends a match
    at the quotes and brackets a PDF, a word processor, a chat app or CJK
    prose wraps an address in; sentence punctuation and markdown emphasis
    stuck to the end are trimmed after, so `**…**`, `“…”` and `（…）` give up
    their wrapper. A leading mark can never enter the match: both alternatives
    start at a scheme or a host character.

    `(` and `)` are not in that stop class, because they are legal in a path —
    half the addresses on Wikipedia have one in them — so a parenthesised
    address has to survive the rule. Only an unpaired `)` is given up, and it
    is given up after the match, not during it: "(see https://x.y/z)" arms
    `https://x.y/z`. */
const URL_LIKE = /https?:\/\/[^\s<>"'`\]“”‘’«»（）【】「」]+|\b(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}(?::\d{1,5})?(?:\/[^\s<>"'`\]“”‘’«»（）【】「」]*)?/gi;

/**
 * Sentence punctuation, markdown emphasis, and any closing parenthesis the match
 * has no opening for: "(see https://x.y/z)" gives up its `)`, while
 * `…/Brooklyn_(Queens)` keeps the pair the address itself brought.
 */
function trimMatch(match: string): string {
  const bare = match.replace(/[.,;:!?…*_]+$/, "");
  let depth = 0;
  for (const character of bare) {
    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
  }
  let end = bare.length;
  while (depth < 0 && end > 0 && bare[end - 1] === ")") {
    depth += 1;
    end -= 1;
  }
  return bare.slice(0, end);
}

/** Every address this text holds, in its comparable shape, deduplicated. */
export function addressesIn(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(URL_LIKE)) {
    const key = canonical(trimMatch(match[0]));
    if (key !== null && !found.includes(key)) found.push(key);
  }
  return found;
}

/** Every address this text holds, added to what a conversation has already
    been shown. This is how a text arms provenance: the addresses it prints
    become addresses the model may open. */
export function rememberAddresses(text: string, seen: Set<string>): void {
  for (const key of addressesIn(text)) seen.add(key);
}

/** One comparable shape, mirroring the parsers the request itself goes
    through: scheme and host fold to lower case (the WHATWG parser both sides
    use does that), the fragment falls away (no HTTP request carries it),
    and the path and query stay byte-exact — slash included, because the door
    asks `/private` and `/private/` as two different routes. A bare host
    reads as https. Shared with the page reads under a search, which compare
    the same way so one turn cannot read a page twice under two spellings. */
export function canonical(raw: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
}