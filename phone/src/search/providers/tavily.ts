/**
 * Tavily Search API (requires API key).
 * Docs: https://docs.tavily.com/documentation/api-reference/endpoint/search
 * POST https://api.tavily.com/search — header Authorization: Bearer <key>, body { query, max_results }
 */
import type { Locale } from "../../i18n";
import { httpStatusError, invalidResponseError, withTimeoutSignal } from "../http";
import type { SearchOptions, SearchProvider, SearchResult } from "../SearchProvider";

const TAVILY_API_URL = "https://api.tavily.com/search";
const PROVIDER_LABEL = "Tavily";

type TavilyHit = {
  title?: unknown;
  url?: unknown;
  content?: unknown;
  published_date?: unknown;
};

function mapHits(raw: unknown, locale: Locale): SearchResult[] {
  if (!raw || typeof raw !== "object") {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }
  const results = (raw as { results?: unknown }).results;
  if (results == null) return [];
  if (!Array.isArray(results)) {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }

  const out: SearchResult[] = [];
  for (const hit of results) {
    if (!hit || typeof hit !== "object") continue;
    const row = hit as TavilyHit;
    if (typeof row.title !== "string" || typeof row.url !== "string") continue;
    if (!row.title || !row.url) continue;

    const mapped: SearchResult = { title: row.title, url: row.url };
    if (typeof row.published_date === "string" && row.published_date) {
      mapped.publishedDate = row.published_date;
    }
    if (typeof row.content === "string" && row.content) {
      mapped.highlights = [row.content];
      mapped.text = row.content;
    }
    out.push(mapped);
  }
  return out;
}

export function createTavilyProvider(apiKey: string, locale: Locale): SearchProvider {
  return {
    async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
      return withTimeoutSignal(opts?.signal, async (signal) => {
        const response = await fetch(TAVILY_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            query,
            max_results: Math.max(1, Math.min(5, opts?.numResults ?? 5)),
            search_depth: "basic",
            include_answer: false,
          }),
          signal,
        });

        if (!response.ok) {
          throw httpStatusError(response.status, PROVIDER_LABEL, locale);
        }

        let data: unknown;
        try {
          data = await response.json();
        } catch {
          throw invalidResponseError(PROVIDER_LABEL, locale);
        }
        return mapHits(data, locale);
      });
    },
  };
}