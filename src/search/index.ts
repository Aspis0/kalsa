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
import {
  searchConsentRefusalText,
  searchFallbackRefusalText,
  type SearchConsentVerdict,
} from "./firstSearchNotice";
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
// way for a caller to reach a provider without the consent gate.

/** Hard ceiling for a full search (primary + optional fallback). */
const TOTAL_DEADLINE_MS = 20_000;

export type WebSearchOptions = {
  locale: Locale;
  numResults?: number;
  signal?: AbortSignal;
  /**
   * The one-time per-provider consent, asked once per recipient BEFORE its
   * query leaves the phone: the active provider, and again for the free Exa
   * MCP fallback when the active provider fails — a user who agreed to send
   * queries to Brave has not agreed to send them to Exa.
   *
   * REQUIRED. There is no ungated path: a caller that cannot ask must not
   * reach a network call by leaving an option out.
   */
  consent: (providerId: SearchProviderId) => Promise<SearchConsentVerdict>;
};

export type WebSearchOutcome = {
  results: SearchResult[];
  /** Provider that produced the results (may differ when fallback is used). */
  provider: SearchProviderId;
  fallbackUsed: boolean;
  /** Localized/primary error message when fallback kicked in. */
  primaryError?: string;
  /**
   * Set when a consent gate said no: NOTHING was sent, and this is the
   * model-facing refusal. Never combined with results — a refused search
   * returns no results because it made no request.
   */
  refused?: string;
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
 * `opts.consent` is REQUIRED: every recipient is named to the user before its
 * query leaves the phone, the free Exa MCP fallback included. A caller that
 * cannot ask must not be able to reach this function by forgetting an option.
 *
 * The network budget (TOTAL_DEADLINE_MS) covers the two requests only. The
 * user's time in a consent dialog is not the network's: both consent waits sit
 * outside every timer, and each request runs under its own timer with the
 * budget left after the previous one.
 *
 * A refusal at any gate returns `refused` with no results rather than an error,
 * because "the user said no" is an answer the model should relay, not a failure
 * it should retry around.
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

  // Before the budget starts: however long the user takes to answer is theirs.
  const primaryVerdict = await opts.consent(activeId);
  if (primaryVerdict !== "allow") {
    return {
      results: [],
      provider: activeId,
      fallbackUsed: false,
      refused: searchConsentRefusalText(primaryVerdict, locale),
    };
  }

  let deadlineAt = Date.now() + TOTAL_DEADLINE_MS;
  const budgetLeft = (): number => Math.max(0, deadlineAt - Date.now());
  const spent = (): Error => new Error(strings.errors.searchDeadline);

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
    if (opts.signal?.aborted) throw err;
    // Already on free fallback — surface the original error.
    if (activeId === DEFAULT_PROVIDER_ID) throw err;
    const primaryError = errorMessage(err);
    const primaryLabel = PROVIDERS[activeId]?.label ?? activeId;

    // The fallback is a SECOND recipient the notice has never named. Ask for
    // it now — again outside the timer — and a "no" skips the fallback instead
    // of quietly handing the query to a provider the user did not agree to.
    // Asking when the budget is already spent would put a question on screen
    // whose answer we cannot act on, so the deadline wins first.
    // The budget pauses while the dialog is open: the remainder resumes after.
    const remaining = budgetLeft();
    if (remaining <= 0) throw spent();
    const fallbackVerdict = await opts.consent(DEFAULT_PROVIDER_ID);
    deadlineAt = Date.now() + remaining;
    if (fallbackVerdict !== "allow") {
      return {
        results: [],
        provider: DEFAULT_PROVIDER_ID,
        fallbackUsed: false,
        primaryError,
        refused: searchFallbackRefusalText(locale, activeId, DEFAULT_PROVIDER_ID),
      };
    }

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
      if (opts.signal?.aborted) throw fallbackErr;
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
