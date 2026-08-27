import type { SearchProvider, SearchResult } from "./SearchProvider";
import { withTimeoutSignal } from "./http";

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

/** Exa placeholder strings that must not become publishedDate (UI would show "— N/A"). */
const PLACEHOLDER_META = /^(n\/a|-|unknown)$/i;

/**
 * Parse flat Exa MCP tool text ("Title: …\nURL: …\nPublished: …\nHighlights:\n…")
 * into SearchResult[]. Exported for harness coverage of metadata sanitization.
 */
export function parseExaTextResults(text: string): SearchResult[] {
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
    // Bare section separators between results must not enter highlights.
    if (line === "---") continue;
    if (line.startsWith("Title:")) {
      flush();
      current = { title: line.slice("Title:".length).trim() };
    } else if (line.startsWith("URL:")) {
      if (current) current.url = line.slice("URL:".length).trim();
    } else if (line.startsWith("Published:")) {
      if (current) {
        const value = line.slice("Published:".length).trim();
        // Only keep values that plausibly look like a date (contain a digit);
        // drop Exa placeholders like "N/A", "-", "unknown".
        if (value && !PLACEHOLDER_META.test(value) && /\d/.test(value)) {
          current.publishedDate = value;
        }
      }
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
  /** Set when a 400/404 cleared a live session — triggers one search retry. */
  private sessionInvalidated = false;

  private async ensureSession(signal?: AbortSignal): Promise<void> {
    if (this.sessionId) return;
    // Serializza: due search() concorrenti non devono fare due initialize.
    if (!this.sessionPromise) {
      this.sessionPromise = this.openSession(signal).finally(() => {
        this.sessionPromise = null;
      });
    }
    return this.sessionPromise;
  }

  private async openSession(signal?: AbortSignal): Promise<void> {
    const initialize = await this.post(
      {
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: "ai-chat", version: "0.1.0" },
        },
      },
      1,
      signal,
    );
    if (initialize.error) {
      throw new Error(initialize.error.message ?? "Exa MCP initialize failed");
    }
    if (!this.sessionId) {
      throw new Error("Exa MCP did not return a session id");
    }
    // notifications/initialized — handshake must share the same timeout/abort.
    await withTimeoutSignal(signal, async (combined) => {
      const response = await fetch(EXA_MCP_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json, text/event-stream",
          "Content-Type": "application/json",
          "mcp-session-id": this.sessionId!,
        },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
        signal: combined,
      });
      if (!response.ok) {
        throw new Error(`Exa MCP handshake failed: HTTP ${response.status}`);
      }
    });
  }

  private async post(
    body: { jsonrpc: "2.0"; id?: number; method: string; params?: unknown },
    expectedId: number,
    signal?: AbortSignal,
  ): Promise<JsonRpcEnvelope> {
    return withTimeoutSignal(signal, (combined) =>
      this.postInner(body, expectedId, combined),
    );
  }

  private async postInner(
    body: { jsonrpc: "2.0"; id?: number; method: string; params?: unknown },
    expectedId: number,
    signal: AbortSignal,
  ): Promise<JsonRpcEnvelope> {
    const response = await fetch(EXA_MCP_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal,
    });

    if (response.status === 429) {
      const retryAfter = response.headers.get("retry-after");
      const detail = retryAfter ? ` Retry after ${retryAfter}s.` : " Retry later.";
      throw new Error(`Exa free-plan rate limit reached (429).${detail}`);
    }
    if (!response.ok) {
      // Sessione scaduta/invalida: azzera e lascia che search() ritenti una volta.
      if ((response.status === 400 || response.status === 404) && this.sessionId) {
        this.sessionId = null;
        this.sessionInvalidated = true;
      }
      throw new Error(`Exa MCP error: HTTP ${response.status}`);
    }

    const sessionId = response.headers.get("mcp-session-id");
    if (sessionId) this.sessionId = sessionId;

    const text = await response.text();
    // Solo envelope con id === expectedId; notifiche (id assente) e altri id vengono ignorati.
    for (const eventText of parseSseEvents(text)) {
      const envelope = parseJsonRpcEnvelope(eventText);
      if (envelope && envelope.id === expectedId) {
        return envelope;
      }
    }
    // Body JSON non-SSE (fallback per server che rispondono JSON diretto).
    const direct = parseJsonRpcEnvelope(text);
    if (direct && direct.id === expectedId) return direct;
    return {};
  }

  private async callSearch(
    query: string,
    opts?: { numResults?: number; signal?: AbortSignal },
  ): Promise<SearchResult[]> {
    await this.ensureSession(opts?.signal);
    if (opts?.signal?.aborted) throw new Error("Search cancelled");
    const id = this.nextId++;
    const result = await this.post(
      {
        jsonrpc: "2.0",
        id,
        method: "tools/call",
        params: {
          name: "web_search_exa",
          arguments: { query, numResults: opts?.numResults ?? 5 },
        },
      },
      id,
      opts?.signal,
    );
    if (result.error) {
      throw new Error(result.error.message ?? "Exa MCP search failed");
    }
    const content = (result.result as { content?: Array<{ type?: string; text?: string }> })
      ?.content;
    const text = content?.[0]?.text;
    if (!text) return [];
    return parseExaTextResults(text);
  }

  async search(
    query: string,
    opts?: { numResults?: number; signal?: AbortSignal },
  ): Promise<SearchResult[]> {
    this.sessionInvalidated = false;
    try {
      return await this.callSearch(query, opts);
    } catch (err) {
      // Una sola volta: sessione scaduta (400/404) → re-handshake e retry.
      if (this.sessionInvalidated && !opts?.signal?.aborted) {
        this.sessionInvalidated = false;
        return await this.callSearch(query, opts);
      }
      throw err;
    }
  }
}

export const exaSearch: SearchProvider = new ExaMCP();
