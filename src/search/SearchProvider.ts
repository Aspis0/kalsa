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
