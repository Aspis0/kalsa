// Text as a reader counts it: a character is a grapheme where the platform
// segments them (an emoji family is one) and a code point elsewhere, so a cut
// never leaves half a surrogate pair behind.

let cachedSegmenter: Intl.Segmenter | null | undefined;

function segmenterFor(): Intl.Segmenter {
  cachedSegmenter ??= new Intl.Segmenter(undefined, { granularity: "grapheme" });
  return cachedSegmenter;
}

/** The characters a reader counts, not UTF-16 units. */
function graphemes(text: string): string[] {
  const segmenter = typeof Intl !== "undefined" && "Segmenter" in Intl ? segmenterFor() : null;
  if (segmenter === null) return Array.from(text);
  const out: string[] = [];
  for (const { segment } of segmenter.segment(text)) out.push(segment);
  return out;
}

/** The first `count` characters of `text`, where a character is a grapheme
    when the platform segments them and a code point otherwise — never half a
    surrogate pair. */
export function firstCharacters(text: string, count: number): string {
  const characters = graphemes(text);
  return characters.length <= count ? text : characters.slice(0, count).join("");
}

/** The first `count` code points of `text`: what a cut spends, never half a
    surrogate pair. Not graphemes — an emoji family is one character to a
    reader and seven here, and a bound paid by the engine is paid in these. */
export function firstCodePoints(text: string, count: number): string {
  const points = Array.from(text);
  return points.length <= count ? text : points.slice(0, count).join("");
}

/** Whether a cut at `count` would drop anything — the measure `firstCodePoints`
    cuts on. A caller that asks this in UTF-16 units instead would keep a whole
    string and then claim it had dropped the rest. */
export function exceedsCodePoints(text: string, count: number): boolean {
  return Array.from(text).length > count;
}

export function titleFor(firstText: string, fallback = "New conversation"): string {
  const oneLine = firstText.replace(/\s+/g, " ").trim();
  if (!oneLine) return fallback;
  const cut = firstCharacters(oneLine, 46);
  return cut === oneLine ? oneLine : `${cut.trimEnd()}…`;
}