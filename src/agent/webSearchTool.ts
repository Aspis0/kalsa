import { getStrings, type Locale } from "../i18n";
import { normalizeNumResults, PROVIDERS, searchWeb, type SearchProviderId } from "../search";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

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
) => Promise<EngineToolResult> {
  return async (name, args, signal) => {
    const strings = getStrings(locale);
    if (name !== "web_search") {
      return { text: strings.errors.unknownTool.replace("{name}", name) };
    }
    const query = String(args.query ?? "").trim();
    if (!query) return { text: strings.errors.emptySearchQuery };

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

    return { text: `${note}${body}`, sources };
  };
}

/** Map search sources onto chat MessageSource (title/authors/doi/provider). */
export function mapSearchSourcesToChat(
  sources: unknown[],
  locale: Locale,
): Array<{ title: string; authors?: string; doi?: string; provider?: string }> {
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
      ...(source.publishedDate ? { authors: source.publishedDate.slice(0, 10) } : {}),
      ...(typeof source.provider === "string" && source.provider
        ? { provider: source.provider }
        : {}),
    }));
}

/** @deprecated Use mapSearchSourcesToChat */
export const mapExaSourcesToChat = mapSearchSourcesToChat;
