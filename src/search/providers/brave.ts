/**
 * Brave Web Search API (requires API key).
 * Docs: https://api-dashboard.search.brave.com/app/documentation/web-search/get-started
 * GET https://api.search.brave.com/res/v1/web/search — header X-Subscription-Token, params q, count
 *
 * Note: `age` / `page_age` are relative freshness strings (e.g. "2 days ago"),
 * not ISO dates — do not map them to publishedDate.
 */
import type { Locale } from "../../i18n";
import { httpStatusError, invalidResponseError, withTimeoutSignal } from "../http";
import type { SearchOptions, SearchProvider, SearchResult } from "../SearchProvider";

const BRAVE_API_URL = "https://api.search.brave.com/res/v1/web/search";
const PROVIDER_LABEL = "Brave Search";

type BraveHit = {
  title?: unknown;
  url?: unknown;
  description?: unknown;
  extra_snippets?: unknown;
};

function mapHits(raw: unknown, locale: Locale): SearchResult[] {
  if (!raw || typeof raw !== "object") {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }
  const web = (raw as { web?: unknown }).web;
  if (web == null) return [];
  if (typeof web !== "object") {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }
  const results = (web as { results?: unknown }).results;
  if (results == null) return [];
  if (!Array.isArray(results)) {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }

  const out: SearchResult[] = [];
  for (const hit of results) {
    if (!hit || typeof hit !== "object") continue;
    const row = hit as BraveHit;
    if (typeof row.title !== "string" || typeof row.url !== "string") continue;
    if (!row.title || !row.url) continue;

    const highlights: string[] = [];
    if (typeof row.description === "string" && row.description) {
      highlights.push(row.description);
    }
    if (Array.isArray(row.extra_snippets)) {
      for (const snip of row.extra_snippets) {
        if (typeof snip === "string" && snip) highlights.push(snip);
      }
    }

    const mapped: SearchResult = { title: row.title, url: row.url };
    if (highlights.length) mapped.highlights = highlights;
    if (typeof row.description === "string" && row.description) {
      mapped.text = row.description;
    }
    out.push(mapped);
  }
  return out;
}

export function createBraveProvider(apiKey: string, locale: Locale): SearchProvider {
  return {
    async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
      return withTimeoutSignal(opts?.signal, async (signal) => {
        const count = Math.max(1, Math.min(5, opts?.numResults ?? 5));
        const url = `${BRAVE_API_URL}?q=${encodeURIComponent(query)}&count=${count}`;
        const response = await fetch(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
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
