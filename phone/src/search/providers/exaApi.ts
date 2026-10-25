/**
 * Exa Search REST API (requires API key).
 * Docs: https://docs.exa.ai/reference/search
 * POST https://api.exa.ai/search — header x-api-key, body { query, numResults, contents }
 *
 * Highlights form (verified 2026-08-02 against docs.exa.ai/reference/search and
 * contents-retrieval guide): `contents: { highlights: true }` is the official
 * default; object form is only needed for custom query / maxCharacters caps.
 */
import type { Locale } from "../../i18n";
import { httpStatusError, invalidResponseError, withTimeoutSignal } from "../http";
import type { SearchOptions, SearchProvider, SearchResult } from "../SearchProvider";

const EXA_API_URL = "https://api.exa.ai/search";
const PROVIDER_LABEL = "Exa API";

type ExaApiHit = {
  title?: unknown;
  url?: unknown;
  publishedDate?: unknown;
  text?: unknown;
  highlights?: unknown;
};

function mapHits(raw: unknown, locale: Locale): SearchResult[] {
  if (!raw || typeof raw !== "object") {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }
  const results = (raw as { results?: unknown }).results;
  if (!Array.isArray(results)) {
    throw invalidResponseError(PROVIDER_LABEL, locale);
  }

  const out: SearchResult[] = [];
  for (const hit of results) {
    if (!hit || typeof hit !== "object") continue;
    const row = hit as ExaApiHit;
    if (typeof row.title !== "string" || typeof row.url !== "string") continue;
    if (!row.title || !row.url) continue;

    const mapped: SearchResult = { title: row.title, url: row.url };
    if (typeof row.publishedDate === "string" && row.publishedDate) {
      mapped.publishedDate = row.publishedDate;
    }
    if (Array.isArray(row.highlights)) {
      const highlights = row.highlights.filter((h): h is string => typeof h === "string");
      if (highlights.length) mapped.highlights = highlights;
    }
    if (typeof row.text === "string" && row.text) {
      mapped.text = row.text;
    }
    out.push(mapped);
  }
  return out;
}

export function createExaApiProvider(apiKey: string, locale: Locale): SearchProvider {
  return {
    async search(query: string, opts?: SearchOptions): Promise<SearchResult[]> {
      return withTimeoutSignal(opts?.signal, async (signal) => {
        const response = await fetch(EXA_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
          },
          body: JSON.stringify({
            query,
            numResults: opts?.numResults ?? 5,
            // Official docs example: contents.highlights = true (boolean).
            contents: { highlights: true },
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
