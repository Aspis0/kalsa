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
 * Le risposte sono event-stream: eventi separati da riga vuota, ogni evento
 * con linee `event: <name>` e `data: <json>` (anche multilinea).
 * Il tool web_search_exa restituisce testo piatto "Title: ...\nURL: ...".
 */

const EXA_MCP_ENDPOINT = "https://mcp.exa.ai/mcp";
const PROTOCOL_VERSION = "2025-03-26";

type JsonRpcEnvelope = {
  id?: number;
  jsonrpc?: string;
  result?: unknown;
  error?: { code?: number; message?: string };
};

/** Splitta un body SSE in eventi e concatena le righe `data:` (multilinea). */
function parseSseEvents(text: string): string[] {
  const events: string[] = [];
  const frames = text.split(/\r?\n\r?\n/);
  for (const frame of frames) {
    const dataLines: string[] = [];
    for (const line of frame.split(/\r?\n/)) {
      if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length) events.push(dataLines.join("\n"));
  }
  return events;
}

function parseJsonRpcEnvelope(text: string): JsonRpcEnvelope | null {
  try {
    const parsed = JSON.parse(text) as JsonRpcEnvelope;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
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
  private sessionPromise: Promise<void> | null = null;

  private async ensureSession(): Promise<void> {
    if (this.sessionId) return;
    // Serializza: due search() concorrenti non devono fare due initialize.
    if (!this.sessionPromise) {
      this.sessionPromise = this.openSession().finally(() => {
        this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  private async openSession(): Promise<void> {
    const initialize = await this.post({ jsonrpc: "2.0", method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "ai-chat", version: "0.1.0" } } }, 1);
    if (initialize.error) {
      throw new Error(initialize.error.message ?? "Exa MCP initialize failed");
    }
    if (!this.sessionId) {
      throw new Error("Exa MCP did not return a session id");
    }
    // notifications/initialized — parte dell'handshake: propaghiamo gli errori HTTP.
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        "mcp-session-id": this.sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    if (!response.ok) {
      throw new Error(`Exa MCP handshake failed: HTTP ${response.status}`);
    }
  }

  private async post(
    body: { jsonrpc: "2.0"; id?: number; method: string; params?: unknown },
    expectedId: number,
  ): Promise<JsonRpcEnvelope> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const detail = retryAfter ? ` Retry after ${retryAfter}s.` : " Retry later.";
      throw new Error(`Exa free-plan rate limit reached (429).${detail}`);
    }
    if (!response.ok) {
      // Sessione scaduta/invalida: azzera e lascia che il chiamante re-inizializzi.
      if ((response.status === 400 || response.status === 404) && this.sessionId) {
        this.sessionId = null;
      }
      throw new Error(`Exa MCP error: HTTP ${response.status}`);
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const text = await response.text();
    // Seleziona l'evento JSON-RPC con l'id della nostra chiamata; gli eventi
    // di progress/notifica precedenti vengono ignorati.
    for (const eventText of parseSseEvents(text)) {
      const envelope = parseJsonRpcEnvelope(eventText);
      if (envelope && (envelope.id === expectedId || envelope.id === undefined)) {
        return envelope;
      }
    }
    // Body JSON non-SSE (fallback per server che rispondono JSON diretto).
    const direct = parseJsonRpcEnvelope(text);
    if (direct) return direct;
    return {};
  }

  async search(query: string, opts?: { numResults?: number }): Promise<SearchResult[]> {
    await this.ensureSession();
    const id = this.nextId++;
    const result = await this.post(
      { jsonrpc: "2.0", id, method: "tools/call", params: { name: "web_search_exa", arguments: { query, numResults: opts?.numResults ?? 5 } } },
      id,
    );
    if (result.error) {
      throw new Error(result.error.message ?? "Exa MCP search failed");
    }
    const content = (result.result as { content?: Array<{ type?: string; text?: string }> })?.content;
    const text = content?.[0]?.text;
    if (!text) return [];
    return parseExaTextResults(text);
  }
}

export const exaSearch: SearchProvider = new ExaMCP();
