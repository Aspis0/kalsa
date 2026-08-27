/**
 * Keyword AND filter shared by conversation list and notes.
 *
 * Tokens shorter than 3 chars are ignored when any token is ≥3 chars.
 * Empty / whitespace query → match-all (caller still owns sort).
 * Non-empty query whose tokens were all dropped → match-none.
 */

export function tokensFromQuery(query: string): string[] | null {
  const q = typeof query === "string" ? query.trim().toLowerCase() : "";
  if (!q) return null;
  const long = q.split(/\s+/).filter((tok) => tok.length >= 3);
  const tokens = long.length > 0 ? long : q.split(/\s+/).filter(Boolean);
  return tokens;
}

/** True when every token appears in at least one haystack field. */
export function matchesTokens(tokens: string[], fields: Array<string | null | undefined>): boolean {
  if (!Array.isArray(tokens) || tokens.length === 0) return false;
  const hay = (Array.isArray(fields) ? fields : []).map((field) =>
    typeof field === "string" ? field.toLowerCase() : "",
  );
  return tokens.every((tok) => hay.some((field) => field.includes(tok)));
}

export function filterByTokens<T>(
  items: T[],
  query: string,
  fieldsOf: (item: T) => Array<string | null | undefined>,
): T[] {
  const list = Array.isArray(items) ? items : [];
  const tokens = tokensFromQuery(query);
  if (tokens === null) return list;
  if (tokens.length === 0) return [];
  return list.filter((item) => matchesTokens(tokens, fieldsOf(item)));
}
