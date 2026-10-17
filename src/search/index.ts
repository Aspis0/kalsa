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
export { buildWebSearchSnippet, NO_PREVIEW_SNIPPET } from "./SearchProvider";
export type { SearchProviderId, ProviderMeta } from "./registry";
export {
  PROVIDERS,
  PROVIDER_IDS,
  DEFAULT_PROVIDER_ID,
  PROVIDER_STORAGE_KEY,
  getActiveProviderId,
  setActiveProviderId,
} from "./registry";
export { secretStore, getSecret, setSecret, deleteSecret } from "./secretStore";
// getProvider and exaSearch stay module-internal: nothing outside this file
// needs the pieces of the search this façade owns, and a re-export is a second
// way for a caller to reach a provider directly.

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
 *
 * There is no per-query gate here. What a search leaves the phone is disclosed
 * permanently in Settings, under the Web switch, and the switch itself is the
 * user's on/off for it.
 *
 * The network budget (TOTAL_DEADLINE_MS) covers the primary request and the
 * fallback, and each runs under its own timer with the budget left after the
 * previous one.
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

  const deadlineAt = Date.now() + TOTAL_DEADLINE_MS;
  const budgetLeft = (): number => Math.max(0, deadlineAt - Date.now());
  const spent = (): Error => new Error(strings.errors.searchDeadline);
  // A turn cancelled before a request leaves never reaches a provider; the
  // model gets the same cancelled text as any other cancelled tool.
  const cancelled = (): Error => new Error(strings.errors.searchCancelled);
  const throwIfCancelled = (): void => {
    if (opts.signal?.aborted) throw cancelled();
  };

  throwIfCancelled();
  try {
    const results = await withTimeoutSignal(
      opts.signal,
      (signal) =>
        getProvider(activeId, secretStore, locale).then((provider) =>
          provider.search(query, { numResults, signal }),
        ),
      budgetLeft(),
    );
    return { results, provider: activeId, fallbackUsed: false };
  } catch (err) {
    if (opts.signal?.aborted) throw cancelled();
    // Already on free fallback — surface the original error.
    if (activeId === DEFAULT_PROVIDER_ID) throw err;
    const primaryError = errorMessage(err);
    const primaryLabel = PROVIDERS[activeId]?.label ?? activeId;

    // No budget left for a second request — say so instead of firing one that
    // would be aborted before it leaves.
    if (budgetLeft() <= 0) throw spent();
    throwIfCancelled();

    try {
      const results = await withTimeoutSignal(
        opts.signal,
        (signal) => exaSearch.search(query, { numResults, signal }),
        budgetLeft(),
      );
      return {
        results,
        provider: DEFAULT_PROVIDER_ID,
        fallbackUsed: true,
        primaryError,
      };
    } catch (fallbackErr) {
      if (opts.signal?.aborted) throw cancelled();
      if (budgetLeft() <= 0) throw spent();
      const fallbackError = errorMessage(fallbackErr);
      throw new Error(
        strings.errors.searchBothFailed
          .replace("{primary}", `${primaryLabel}: ${primaryError}`)
          .replace("{fallback}", fallbackError),
      );
    }
  }
}
