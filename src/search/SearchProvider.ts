/**
 * Search provider interface + shared result types.
 * Implementations: ExaMCP (free), Exa API, Brave Search, Tavily.
 * Resolve the active provider via registry.getProvider / searchWeb.
 */

export type SearchResult = {
  title: string;
  url: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
};

export type SearchOptions = {
  numResults?: number;
  signal?: AbortSignal;
};

export interface SearchProvider {
  search(query: string, opts?: SearchOptions): Promise<SearchResult[]>;
}

/** Model-facing marker when a result has no highlights/text (nudge toward web_fetch). */
export const NO_PREVIEW_SNIPPET =
  "[no preview for this result — use web_fetch to read it]";

/**
 * Build the model-facing snippet for one search result.
 * highlights → text → no-preview marker (empty snippets are silent failures for 2B models).
 */
export function buildWebSearchSnippet(
  result: Pick<SearchResult, "highlights" | "text">,
): string {
  const snippetParts =
    result.highlights && result.highlights.length > 0
      ? result.highlights
      : result.text
        ? [result.text]
        : [];
  if (snippetParts.length === 0) return NO_PREVIEW_SNIPPET;
  return snippetParts.join(" ").slice(0, 500);
}
