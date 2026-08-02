/**
 * Wiring dei provider di ricerca — Fase 0: solo interfaccia.
 * L'unica implementazione è ExaMCP (gratis, senza API key). Provider futuri
 * (SearXNG, DDG, ...) implementano SearchProvider e si registrano qui.
 */

export type SearchResult = {
  title: string;
  url: string;
  publishedDate?: string;
  highlights?: string[];
  text?: string;
};

export interface SearchProvider {
  search(query: string, opts?: { numResults?: number }): Promise<SearchResult[]>;
}
