import { exaSearch } from "../search/ExaMCP";
import type { EngineTool, EngineToolResult } from "../engine/LlamaService";

/**
 * Tool websearch (Fase 2) — esposto al modello locale come function calling.
 * Esegue la ricerca tramite Exa MCP (gratis, senza API key) e restituisce al
 * modello titoli/URL/highlights, propagando le sorgenti alla UI.
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

export function makeWebSearchExecutor(): (
  name: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<EngineToolResult> {
  return async (name, args, signal) => {
    if (name !== "web_search") {
      return { text: `Unknown tool: ${name}` };
    }
    const query = String(args.query ?? "").trim();
    if (!query) return { text: "Empty search query." };

    const numResults = Math.max(1, Math.min(5, Math.floor(Number(args.numResults) || 4)));
    const results = await exaSearch.search(query, { numResults, signal });

    const sources = results.map((result) => ({
      title: result.title,
      url: result.url,
      ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
    }));

    const text = results.length
      ? results
          .map(
            (result, index) =>
              `${index + 1}. ${result.title}\n   URL: ${result.url}\n   ${(result.highlights ?? [])
                .join(" ")
                .slice(0, 500)}`,
          )
          .join("\n\n")
      : "No results found.";

    return { text, sources };
  };
}

/** Mappa le sorgenti Exa sul formato chat (MessageSource: title/authors/doi). */
export function mapExaSourcesToChat(
  sources: unknown[],
): Array<{ title: string; authors?: string; doi?: string }> {
  return (sources as Array<{ title?: string; url?: string; publishedDate?: string }>)
    .filter((source) => source && typeof source === "object")
    .map((source) => ({
      title: source.title || source.url || "Source",
      ...(source.publishedDate ? { authors: source.publishedDate.slice(0, 10) } : {}),
    }));
}
