/**
 * Minimal OpenAI-compatible client. Fetch + SSE only, no dependencies.
 *
 * Honesty rules: every failure carries the URL that was actually called;
 * a stream that ends without [DONE] is reported (truncated vs empty), never
 * announced as complete; a reply that is not a stream is read as a plain
 * JSON completion before giving up.
 */

export type ChatErrorKind =
  | "network"
  | "unauthorized"
  | "http"
  | "bad-response"
  | "truncated"
  | "timeout"
  | "aborted";

export class ChatRequestError extends Error {
  kind: ChatErrorKind;
  status?: number;
  url?: string;

  constructor(kind: ChatErrorKind, message: string, status?: number, url?: string) {
    super(message);
    this.name = "ChatRequestError";
    this.kind = kind;
    this.status = status;
    this.url = url;
  }
}

export interface WireMessage {
  role: string;
  content: string;
}

export interface StreamOptions {
  endpoint: string;
  token: string;
  model: string;
  messages: WireMessage[];
  signal: AbortSignal;
  onToken: (text: string) => void;
  /** Reasoning tokens. A separate buffer, never concatenated with content. */
  onReasoning: (text: string) => void;
}

/** No new words for this long means the server is gone, not slow. */
export const IDLE_TIMEOUT_MS = 60_000;

/**
 * Accepts a base URL (with or without /v1), or a full /chat/completions URL.
 * Never doubles /v1: https://api.openai.com/v1 -> .../v1/chat/completions.
 */
export function completionsUrl(endpoint: string): string {
  const base = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function firstPresent(values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value !== "") return value;
  }
  return null;
}

function nestedReasoning(value: unknown): unknown[] {
  if (value && typeof value === "object") {
    const nested = value as Record<string, unknown>;
    return [nested.content, nested.text];
  }
  return [];
}

/**
 * Deterministic pick across the two field names (llama.cpp/DeepSeek send
 * reasoning_content, vLLM sends reasoning): reasoning_content wins, then its
 * one-level nestings, then reasoning and its nestings. Empty strings never
 * win — a server emitting every key with an empty default must not silence
 * the populated one. Unknown shapes are dropped, never merged into content.
 */
function pickReasoning(scope: Record<string, unknown>): string | null {
  const direct = [scope.reasoning_content, ...nestedReasoning(scope.reasoning_content)];
  const found = firstPresent(direct);
  if (found !== null) return found;
  return firstPresent([scope.reasoning, ...nestedReasoning(scope.reasoning)]);
}

function extractReasoning(payload: string): string | null {
  try {
    const delta = (JSON.parse(payload) as { choices?: Array<{ delta?: unknown }> }).choices?.[0]
      ?.delta;
    if (!delta || typeof delta !== "object") return null;
    return pickReasoning(delta as Record<string, unknown>);
  } catch {
    return null;
  }
}

/** Same pick, but over a non-streaming message shape (no delta there). */
function extractMessageReasoning(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const message = (choices[0] as { message?: unknown } | undefined)?.message;
  if (!message || typeof message !== "object") return null;
  return pickReasoning(message as Record<string, unknown>);
}

// NOTE: only delta.content ever becomes answer text. Unknown fields are
// ignored (see extractReasoning): never merged into content.
function extractDelta(payload: string): string | null {
  try {
    const data = JSON.parse(payload) as {
      choices?: Array<{ delta?: { content?: unknown } }>;
    };
    const content = data.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

function extractMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return null;
  const content = (choices[0] as { message?: { content?: unknown } } | undefined)?.message
    ?.content;
  return typeof content === "string" ? content : null;
}

export async function streamChatCompletion(options: StreamOptions): Promise<void> {
  const { token, model, messages, signal, onToken, onReasoning } = options;
  const url = completionsUrl(options.endpoint);

  // The user's signal (Stop) and our idle timer share one controller so a
  // stalled read() can be released without confusing the two causes.
  const linked = new AbortController();
  let timedOut = false;
  const fireIdle = () => {
    timedOut = true;
    linked.abort();
  };
  let idle: number | undefined = window.setTimeout(fireIdle, IDLE_TIMEOUT_MS);
  const poke = () => {
    window.clearTimeout(idle);
    idle = window.setTimeout(fireIdle, IDLE_TIMEOUT_MS);
  };
  const forwardAbort = () => linked.abort();
  if (signal.aborted) linked.abort();
  else signal.addEventListener("abort", forwardAbort, { once: true });

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal: linked.signal,
    });
  } catch (error) {
    window.clearTimeout(idle);
    signal.removeEventListener("abort", forwardAbort);
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    throw new ChatRequestError("network", "Network failure", undefined, url);
  }

  const finish = () => {
    window.clearTimeout(idle);
    signal.removeEventListener("abort", forwardAbort);
  };

  if (response.status === 401 || response.status === 403) {
    finish();
    throw new ChatRequestError("unauthorized", "Unauthorized", response.status, url);
  }
  if (!response.ok) {
    finish();
    throw new ChatRequestError("http", `HTTP ${response.status}`, response.status, url);
  }
  // A 200 with an empty body is not an error status — it is simply not a
  // stream. (Chromium reports response.body as null for these.)
  if (!response.body) {
    finish();
    throw new ChatRequestError("bad-response", "Empty body", response.status, url);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/event-stream")) {
    // A server ignoring stream:true answers plain JSON (or an HTML login
    // page with status 200). Read it as a completion before giving up.
    try {
      const raw: unknown = await response.json();
      const text = extractMessage(raw);
      const thought = extractMessageReasoning(raw);
      finish();
      if (text === null && thought === null) throw new Error("not a completion");
      if (thought) onReasoning(thought);
      if (text) onToken(text);
      return;
    } catch {
      finish();
      throw new ChatRequestError("bad-response", "Not a stream", response.status, url);
    }
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let gotToken = false;
  let gotReasoning = false;
  let sawDone = false;

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      return;
    }
    // One delta may carry both fields; each goes to its own buffer.
    const thought = extractReasoning(payload);
    if (thought) {
      gotReasoning = true;
      poke();
      onReasoning(thought);
    }
    const delta = extractDelta(payload);
    if (delta) {
      gotToken = true;
      poke();
      onToken(delta);
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) handleLine(line);
      if (sawDone) {
        finish();
        return;
      }
    }
    // The final frame may arrive without a trailing newline: drain it.
    buffer += decoder.decode();
    if (buffer.trim()) handleLine(buffer);
    if (sawDone) {
      finish();
      return;
    }
    finish();
    // Partial text stays with the caller either way; only the diagnosis
    // differs: accidental cut vs nothing arrived at all. Reasoning alone
    // (no content, clean close) is a complete thinking-only answer, not
    // an error — the thread says so.
    if (gotToken || gotReasoning) {
      throw new ChatRequestError("truncated", "Cut without [DONE]", undefined, url);
    }
    throw new ChatRequestError("bad-response", "Empty stream", undefined, url);
  } catch (error) {
    finish();
    if (error instanceof ChatRequestError) throw error;
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    // The socket died mid-answer (reset, proxy cut): anything arrived but
    // no [DONE]. That is a truncation, not an unreachable server.
    if ((gotToken || gotReasoning) && !sawDone) {
      throw new ChatRequestError("truncated", "Connection dropped", undefined, url);
    }
    throw new ChatRequestError("network", "Network failure", undefined, url);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Already released or cancelled; nothing to do.
    }
  }
}
