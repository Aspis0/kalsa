import { getStrings, type Locale } from "../i18n";
import {
  buildWebSearchSnippet,
  normalizeNumResults,
  PROVIDERS,
  searchWeb,
  type SearchProviderId,
} from "../search";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";
import { evaluateTurn } from "../rules/evaluate";
import { TOOL_GATE_TABLE } from "../rules/toolGate";
import { isSafeHttpUrl } from "../util/url";

export { buildWebSearchSnippet, NO_PREVIEW_SNIPPET } from "../search";

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
      "Search the web for current information: news, facts, prices, events, people — anything the local model may not know. Returns top results with title, url and highlights. Results without preview text are worth opening with web_fetch.",
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

export function makeWebSearchExecutor(
  locale: Locale,
  options?: { getMemoryFacts?: () => readonly string[] },
): (
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

    // Privacy gate: block queries that echo the last user message or an
    // injected memory fact. No network call, no content logged either way.
    const facts = options?.getMemoryFacts?.() ?? [];
    const gate = evaluateTurn(
      {
        toolName: "web_search",
        input: {
          query,
          lastUserMessage: lastUserMessage ?? "",
          memoryFacts: facts.slice(0, 10),
        },
      },
      TOOL_GATE_TABLE,
    );
    if (gate.blocked) {
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
            const snippet = buildWebSearchSnippet(result);
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
