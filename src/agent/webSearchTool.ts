import { getStrings, type Locale } from "../i18n";
import { normalizeNumResults, PROVIDERS, searchWeb, type SearchProviderId } from "../search";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";
import { isSafeHttpUrl } from "../util/url";

/**
 * Tool websearch — esposto al modello locale come function calling.
 * Il modello non sa quale provider è attivo; searchWeb risolve il provider
 * (con fallback automatico su Exa MCP gratis se il primario fallisce).
 */

export const WEB_SEARCH_TOOL: EngineTool = {
  type: "function",
  function: {
    name: "web_search",
    description:
      "Search the web for current information: news, facts, prices, events, people — anything the local model may not know. Returns top results with title, url and highlights.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query — describe the ideal page, not just keywords.",
        },
        numResults: {
          type: "number",
          description: "Number of results to return (default 4, max 5).",
        },
      },
      required: ["query"],
    },
  },
};

/**
 * Minimal, deterministic leading-interrogative word list (it/en) — NOT an
 * exhaustive grammar, just enough to tell a genuine question apart from a
 * flat statement of facts for the privacy guard below.
 */
const INTERROGATIVE_LEAD_WORDS = new Set([
  // EN wh- / yes-no starters
  "who", "what", "when", "where", "why", "how", "which", "whose", "whom",
  "is", "are", "am", "was", "were", "do", "does", "did",
  "can", "could", "would", "will", "should", "shall", "may", "might",
  // IT wh- / yes-no starters
  "chi", "cosa", "che", "come", "quando", "dove", "perché", "perche",
  "quale", "quali", "quanto", "quanti", "quante",
  "puoi", "potresti", "posso", "possiamo", "devo", "dobbiamo",
  "è", "sono", "hai", "ha",
]);

function normalizeForMatch(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** True if `message` reads as a question (explicit '?' or a leading interrogative word). */
function isQuestion(message: string): boolean {
  const trimmed = message.trim();
  if (!trimmed) return false;
  if (trimmed.includes("?")) return true;
  const firstWord = normalizeForMatch(trimmed).split(" ")[0] ?? "";
  const stripped = firstWord.replace(/[^\p{L}]+/gu, "");
  return INTERROGATIVE_LEAD_WORDS.has(stripped);
}

/** True if `a` and `b` (normalized) share a contiguous run of ≥ minLen chars. */
function hasSharedSubstring(a: string, b: string, minLen: number): boolean {
  const na = normalizeForMatch(a);
  const nb = normalizeForMatch(b);
  if (na.length < minLen || nb.length < minLen) return false;
  for (let i = 0; i + minLen <= na.length; i += 1) {
    if (nb.includes(na.slice(i, i + minLen))) return true;
  }
  return false;
}

/**
 * Privacy guard (BUG2, V4.2 bench): block a web_search call whose query looks
 * like it is echoing facts the user just stated about themselves rather than
 * asking a question. Minimal deterministic heuristic — no LLM classifier:
 * blocks when the query shares a ≥12-char substring with the last user
 * message AND that last user message does not itself read as a question.
 * Never logs query / message content.
 */
export function looksLikeEchoOfUserFacts(query: string, lastUserMessage: string): boolean {
  const q = query.trim();
  const u = (lastUserMessage ?? "").trim();
  if (!q || !u) return false;
  if (isQuestion(u)) return false;
  return hasSharedSubstring(q, u, 12);
}

function labelForPrimaryFailure(
  primaryError: string | undefined,
  usedProvider: SearchProviderId,
): string {
  if (primaryError) {
    // Messages look like "Invalid API key for Brave Search. …" or "Brave Search: …"
    for (const id of Object.keys(PROVIDERS) as SearchProviderId[]) {
      if (id === usedProvider) continue;
      const label = PROVIDERS[id].label;
      if (primaryError.includes(label)) return label;
    }
    const beforeColon = primaryError.split(":")[0]?.trim();
    if (beforeColon) return beforeColon;
  }
  return "Primary";
}

export function makeWebSearchExecutor(locale: Locale): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  lastUserMessage?: string,
) => Promise<EngineToolResult> {
  return async (name, args, signal, lastUserMessage) => {
    const strings = getStrings(locale);
    if (name !== "web_search") {
      return { text: strings.errors.unknownTool.replace("{name}", name) };
    }
    const query = String(args.query ?? "").trim();
    if (!query) return { text: strings.errors.emptySearchQuery };

    // Privacy guard (BUG2, V4.2 bench): never let the model ship the user's
    // own stated facts to a search provider. Deterministic heuristic, no
    // network call made, no content logged either way.
    if (looksLikeEchoOfUserFacts(query, lastUserMessage ?? "")) {
      return { text: strings.errors.webSearchPrivacyBlocked };
    }

    // searchWeb also clamps; tool-level default is 4.
    const numResults = normalizeNumResults(args.numResults ?? 4);
    const outcome = await searchWeb(query, { locale, numResults, signal });

    const sources = outcome.results.map((result) => ({
      title: result.title,
      url: result.url,
      provider: outcome.provider,
      ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    }));

    const body = outcome.results.length
      ? outcome.results
          .map((result, index) => {
            const snippetParts =
              result.highlights && result.highlights.length > 0
                ? result.highlights
                : result.text
                  ? [result.text]
                  : [];
            const snippet = snippetParts.join(" ").slice(0, 500);
            return `${index + 1}. ${result.title}\n   URL: ${result.url}\n   ${snippet}`;
          })
          .join("\n\n")
      : strings.errors.noResultsFound;

    // Model-facing note when free MCP replaced a paid/primary provider.
    // UI also shows "via {provider}" on source cards (mapSearchSourcesToChat).
    const note = outcome.fallbackUsed
      ? `${strings.errors.searchFallbackUsedNamed.replace(
          "{provider}",
          labelForPrimaryFailure(outcome.primaryError, outcome.provider),
        )}\n\n`
      : "";

    // Cite instruction with absolute source numbers is appended by LlamaService
    // after per-turn source accumulation (search + fetch share one [N] space).
    return { text: `${note}${body}`, sources };
  };
}

/** Map search sources onto chat MessageSource (title/url/authors/doi/provider). */
export function mapSearchSourcesToChat(
  sources: unknown[],
  locale: Locale,
): Array<{ title: string; url?: string; authors?: string; doi?: string; provider?: string }> {
  const fallback = getStrings(locale).errors.source;
  return (
    sources as Array<{
      title?: string;
      url?: string;
      publishedDate?: string;
      provider?: string;
    }>
  )
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      title: source.title || source.url || fallback,
      // Boundary gate: provider responses are untrusted. Only persist http(s)
      // URLs that pass isSafeHttpUrl — drop the field otherwise (no placeholder).
      ...(typeof source.url === "string" && isSafeHttpUrl(source.url)
        ? { url: source.url.trim() }
        : {}),
      ...(source.publishedDate ? { authors: source.publishedDate.slice(0, 10) } : {}),
      ...(typeof source.provider === "string" && source.provider
        ? { provider: source.provider }
        : {}),
    }));
}

/** @deprecated Use mapSearchSourcesToChat */
export const mapExaSourcesToChat = mapSearchSourcesToChat;
