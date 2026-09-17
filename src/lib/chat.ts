/** Minimal OpenAI-compatible streaming client. Fetch + SSE only. */

export type ChatErrorKind = "network" | "unauthorized" | "http" | "aborted";

export class ChatRequestError extends Error {
  kind: ChatErrorKind;
  status?: number;

  constructor(kind: ChatErrorKind, message: string, status?: number) {
    super(message);
    this.name = "ChatRequestError";
    this.kind = kind;
    this.status = status;
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

/** Accepts a base URL or a full /chat/completions URL, returns the POST URL. */
export function completionsUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/.test(trimmed)) return trimmed;
  return `${trimmed}/v1/chat/completions`;
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

export async function streamChatCompletion(options: StreamOptions): Promise<void> {
  const { token, model, messages, signal, onToken } = options;
  let response: Response;
  try {
    response = await fetch(completionsUrl(options.endpoint), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token.trim() ? { Authorization: `Bearer ${token.trim()}` } : {}),
      },
      body: JSON.stringify({ model, messages, stream: true }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped");
    }
    throw new ChatRequestError("network", "Network failure");
  }

  if (response.status === 401 || response.status === 403) {
    throw new ChatRequestError("unauthorized", "Unauthorized", response.status);
  }
  if (!response.ok || !response.body) {
    throw new ChatRequestError("http", `HTTP ${response.status}`, response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === "[DONE]") return;
        const delta = extractDelta(payload);
        if (delta) onToken(delta);
      }
    }
  } catch (error) {
    if (error instanceof ChatRequestError) throw error;
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ChatRequestError("aborted", "Stopped");
    }
    // A mid-stream connection drop: not fatal by itself if text arrived,
    // but the caller treats any throw as failure — it keeps partial text.
    throw new ChatRequestError("network", "Network failure");
  } finally {
    reader.releaseLock();
  }
}
