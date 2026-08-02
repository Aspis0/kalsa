/**
 * Public search façade — provider-agnostic web search with free Exa MCP fallback.
 */
import { getStrings, type Locale } from "../i18n";
import { exaSearch } from "./ExaMCP";
import { withTimeoutSignal } from "./http";
import {
  DEFAULT_PROVIDER_ID,
  getActiveProviderId,
  getProvider,
  PROVIDERS,
  type SearchProviderId,
} from "./registry";
import type { SearchResult } from "./SearchProvider";
import { secretStore } from "./secretStore";

export type { SearchResult, SearchOptions, SearchProvider } from "./SearchProvider";
export type { SearchProviderId, ProviderMeta } from "./registry";
export {
  PROVIDERS,
  PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
  PROVIDER_STORAGE_KEY,
  getActiveProviderId,
  setActiveProviderId,
  getProvider,
} from "./registry";
export { secretStore, getSecret, setSecret, deleteSecret } from "./secretStore";
export { exaSearch } from "./ExaMCP";

/** Hard ceiling for a full search (primary + optional fallback). */
const TOTAL_DEADLINE_MS = 20_000;

export type WebSearchOptions = {
  locale: Locale;
  numResults?: number;
  signal?: AbortSignal;
};

export type WebSearchOutcome = {
  results: SearchResult[];
  /** Provider that produced the results (may differ when fallback is used). */
  provider: SearchProviderId;
  fallbackUsed: boolean;
  /** Localized/primary error message when fallback kicked in. */
  primaryError?: string;
};

/** Clamp requested result count for every provider (1..5). */
export function normalizeNumResults(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return 4;
  return Math.max(1, Math.min(5, n));
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Search with the active provider. On failure (bad key / 429 / network),
 * falls back to free Exa MCP unless that was already the active provider.
 * Does not throw when fallback succeeds.
 * Total wall-clock budget: TOTAL_DEADLINE_MS (shared across primary + fallback).
 */
export async function searchWeb(
  query: string,
  opts: WebSearchOptions,
): Promise<WebSearchOutcome> {
  const locale = opts.locale;
  const strings = getStrings(locale);
  const numResults = normalizeNumResults(opts.numResults);

  // Storage failure → operational default (free MCP); UI paths surface the error themselves.
  let activeId: SearchProviderId = DEFAULT_PROVIDER_ID;
  try {
    activeId = await getActiveProviderId(locale);
  } catch {
    activeId = DEFAULT_PROVIDER_ID;
  }

  return withTimeoutSignal(
    opts.signal,
    async (deadlineSignal) => {
      try {
        const provider = await getProvider(activeId, secretStore, locale);
        const results = await provider.search(query, {
          numResults,
          signal: deadlineSignal,
        });
        return { results, provider: activeId, fallbackUsed: false };
      } catch (err) {
        if (opts.signal?.aborted) throw err;
        if (deadlineSignal.aborted) {
          throw new Error(strings.errors.searchDeadline);
        }
        // Already on free fallback — surface the original error.
        if (activeId === DEFAULT_PROVIDER_ID) throw err;

        const primaryError = errorMessage(err);
        const primaryLabel = PROVIDERS[activeId]?.label ?? activeId;

        try {
          const results = await exaSearch.search(query, {
            numResults,
            signal: deadlineSignal,
          });
          return {
            results,
            provider: DEFAULT_PROVIDER_ID,
            fallbackUsed: true,
            primaryError,
          };
        } catch (fallbackErr) {
          if (opts.signal?.aborted) throw fallbackErr;
          if (deadlineSignal.aborted) {
            throw new Error(strings.errors.searchDeadline);
          }
          const fallbackError = errorMessage(fallbackErr);
          throw new Error(
            strings.errors.searchBothFailed
              .replace("{primary}", `${primaryLabel}: ${primaryError}`)
              .replace("{fallback}", fallbackError),
          );
        }
      }
    },
    TOTAL_DEADLINE_MS,
  );
}
