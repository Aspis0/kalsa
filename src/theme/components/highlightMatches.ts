export type HighlightPart = {
  text: string;
  highlighted: boolean;
};

type MatchRange = {
  start: number;
  end: number;
};

/** Return case-preserving text segments, merging overlapping token matches. */
export function highlightMatches(text: string, tokens: string[]): HighlightPart[] {
  if (!text || tokens.length === 0) return [{ text, highlighted: false }];

  const lowerText = text.toLowerCase();
  const ranges: MatchRange[] = [];
  for (const token of tokens) {
    if (!token) continue;
    let start = lowerText.indexOf(token);
    while (start >= 0) {
      ranges.push({ start, end: start + token.length });
      start = lowerText.indexOf(token, start + 1);
    }
  }
  if (ranges.length === 0) return [{ text, highlighted: false }];

  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const parts: HighlightPart[] = [];
  let cursor = 0;
  for (const range of merged) {
    if (range.start > cursor) {
      parts.push({ text: text.slice(cursor, range.start), highlighted: false });
    }
    parts.push({ text: text.slice(Math.max(cursor, range.start), range.end), highlighted: true });
    cursor = range.end;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), highlighted: false });
  return parts;
}
