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
  const { token, model, messages, signal, onToken } = options;
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
      const text = extractMessage(await response.json());
      finish();
      if (text === null) throw new Error("not a completion");
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
  let sawDone = false;

  function handleLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      return;
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
    // differs: accidental cut vs nothing arrived at all.
    if (gotToken) throw new ChatRequestError("truncated", "Cut without [DONE]", undefined, url);
    throw new ChatRequestError("bad-response", "Empty stream", undefined, url);
  } catch (error) {
    finish();
    if (error instanceof ChatRequestError) throw error;
    if (timedOut) throw new ChatRequestError("timeout", "Idle too long", undefined, url);
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped", undefined, url);
    }
    // The socket died mid-answer (reset, proxy cut): tokens arrived but no
    // [DONE]. That is a truncation, not an unreachable server.
    if (gotToken && !sawDone) {
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
