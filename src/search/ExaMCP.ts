import type { SearchProvider, SearchResult } from "./SearchProvider";

/**
 * Client minimale MCP streamable-http verso l'endpoint hosted di Exa.
 *
 * Verificato il 2026-08-01: NESSUNA API key richiesta (free plan per-IP,
 * ~1000 richieste/mese; oltre il limite il server risponde 429).
 *
 * Protocollo (JSON-RPC 2.0 + SSE):
 *   1. POST initialize          → header di risposta `mcp-session-id`
 *   2. POST notifications/initialized
 *   3. POST tools/call          → name "web_search_exa", arguments { query, numResults }
 *
 * Le risposte sono event-stream: linee `event: message` + `data: {...}`.
 * Il tool web_search_exa restituisce testo piatto "Title: ...\nURL: ...".
 */

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION = "2025-03-26";

type JsonRpcResult = {
  result?: unknown;
  error?: { code?: number; message?: string };
};

function parseSsePayload(text: string): JsonRpcResult {
  const dataLines: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
  }
  const candidates = dataLines.length ? dataLines : [text.trim()];
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed = JSON.parse(candidate) as JsonRpcResult;
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // riga non-JSON (es. commenti SSE): ignora
    }
  }
  return {};
}

function parseExaTextResults(text: string): SearchResult[] {
  const results: SearchResult[] = [];
  let current: Partial<SearchResult> | null = null;

  const flush = () => {
    if (current && current.title && current.url) {
      results.push(current as SearchResult);
    }
    current = null;
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith("Title:")) {
      flush();
      current = { title: line.slice("Title:".length).trim() };
    } else if (line.startsWith("URL:")) {
      if (current) current.url = line.slice("URL:".length).trim();
    } else if (line.startsWith("Published:")) {
      if (current) current.publishedDate = line.slice("Published:".length).trim();
    } else if (line.startsWith("Author:") || line.startsWith("Highlights:")) {
      // salta header; le righe seguenti sono highlight
    } else if (current) {
      current.highlights = [...(current.highlights ?? []), line];
    }
  }
  flush();
  return results;
}

export class ExaMCP implements SearchProvider {
  private sessionId: string | null = null;
  private nextId = 1;

  private async call<T>(method: string, params: unknown): Promise<T> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: this.nextId++, method, params }),
    });

    if (response.status === 429) {
      throw new Error(
        "Exa free-plan rate limit reached (429). Retry later, or add an API key in Settings.",
      );
    }
    if (!response.ok) {
      throw new Error(`Exa MCP error: HTTP ${response.status}`);
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const text = await response.text();
    const payload = parseSsePayload(text);
    if (payload.error) {
      throw new Error(payload.error.message ?? `Exa MCP error: ${payload.error.code ?? "unknown"}`);
    }
    return payload.result as T;
  }

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    await this.call("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "ai-chat", version: "0.1.0" },
    });
    // notifications/initialized — best effort, nessuna risposta attesa
    try {
      await fetch(EXA_MCP_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
    } catch {
      // non bloccante
    }
  }

  async search(query: string, opts?: { numResults?: number }): Promise<SearchResult[]> {
    await this.ensureSession();
    const result = await this.call<{ content?: Array<{ type?: string; text?: string }> }>(
      "tools/call",
      {
        name: "web_search_exa",
        arguments: { query, numResults: opts?.numResults ?? 5 },
      },
    );
    const text = result?.content?.[0]?.text;
    if (!text) return [];
    return parseExaTextResults(text);
  }
}

export const exaSearch: SearchProvider = new ExaMCP();
