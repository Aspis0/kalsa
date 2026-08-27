/**
 * Unified AI gateway transport (protocol v1 SSE) → the app's existing chat
 * callbacks.
 *
 * This is the DORMANT path behind the `UNIFIED_AI_CHAT` flag (default OFF). It
 * speaks the canonical v1 wire format produced by the gateway's `V1Serializer`
 * (see cloudflare/aspis-bio-api/src/ai/gateway/sse.ts):
 *
 *   real SSE frames — each `event: <name>\n` + `data: <json>\n\n`, separated by
 *   a blank line. Vocabulary: meta / status / token / tool / sources / miniapp
 *   / action / error / done.
 *
 * It maps those events onto the SAME callbacks the legacy clients
 * (`askFreeAiStream`, `streamAnalysisChat`) already invoke, so the chat UI
 * (`AiChatPage`) consumes them unchanged.
 *
 * Following the codebase convention (each client inlines its own reader; there
 * is no shared SSE helper), the reader logic here mirrors `streamAnalysisChat`:
 * buffer partial frames across chunks, tolerate `\r\n`, ignore unknown events.
 */

function parseAuthors(authors) {
  if (Array.isArray(authors)) return authors;
  if (typeof authors === "string" && authors.trim()) return [authors];
  return undefined;
}

/**
 * Stream a chat turn from the unified gateway.
 *
 * @param {{
 *   endpoint: string,
 *   token?: string | null,
 *   surface: string,
 *   context?: unknown,
 *   messages: Array<{ role: string, content: string }>,
 *   attachments?: Array<{ title: string, text: string }>,
 *   fetchImpl?: typeof fetch,
 * }} params
 * @param {{
 *   onDelta?: (delta: string, full: string) => void,
 *   onStatus?: (status: { label: string }) => void,
 *   onSources?: (items: any[]) => void,
 *   onMiniapp?: (miniapp: any) => void,
 *   onActions?: (payload: any) => void,
 *   onCta?: (payload: any) => void,
 *   onUsage?: (usage: any) => void,
 *   onError?: (error: Error) => void,
 *   onDone?: () => void,
 * }} callbacks
 * @param {{ signal?: AbortSignal }} [options]
 * @returns {Promise<{ answer: string, usage: any, finish: string | null, ok: boolean }>}
 */
async function streamUnifiedChat(
  { endpoint, token, surface, context, messages, attachments = [], fetchImpl = fetch },
  callbacks = {},
  options = {},
) {
  // Ephemeral attachments (e.g. extracted PDF text). Shape-checked + bounded
  // here as well as server-side (gateway caps 5 items × 6000 chars).
  const safeAttachments = Array.isArray(attachments)
    ? attachments
        .filter((a) => a && typeof a === "object" && typeof a.text === "string" && a.text.trim())
        .slice(0, 5)
        .map((a) => ({
          title: typeof a.title === "string" && a.title.trim() ? a.title.slice(0, 200) : "Attachment",
          text: a.text.slice(0, 6000),
        }))
    : [];

  const body = JSON.stringify({
    messages: Array.isArray(messages)
      ? messages.map((m) => ({ role: m.role, content: String(m.content ?? "") }))
      : [],
    surface,
    ...(context !== undefined ? { context } : {}),
    ...(safeAttachments.length > 0 ? { attachments: safeAttachments } : {}),
  });

  const response = await fetchImpl(endpoint, {
    body,
    headers: {
      Accept: "text/event-stream",
      "Accept-Profile": "v1",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    method: "POST",
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (!response.ok) {
    const error = new Error(`unified_chat_http_${response.status}`);
    error.error = `unified_chat_http_${response.status}`;
    error.status = response.status;
    throw error;
  }

  let answer = "";
  let usage = null;
  let finish = null;
  let streamError = null;

  const makeError = (payload) => {
    const code = (payload && payload.code) || "unified_chat_failed";
    const message =
      payload && typeof payload.message === "string" && payload.message.trim() ? payload.message : code;
    const error = new Error(message);
    error.code = code;
    error.error = code;
    return error;
  };

  const consumePayload = (eventName, payload) => {
    switch (eventName) {
      case "token":
        if (payload && typeof payload.text === "string") {
          answer += payload.text;
          callbacks.onDelta?.(payload.text, answer);
        }
        break;
      case "status":
        if (payload && typeof payload.label === "string") {
          callbacks.onStatus?.({ label: payload.label });
        }
        break;
      case "sources": {
        const items = Array.isArray(payload?.items) ? payload.items : [];
        callbacks.onSources?.(
          items.map((s) => ({
            ...s,
            authors: parseAuthors(s?.authors),
          })),
        );
        break;
      }
      case "miniapp":
        if (payload && typeof payload === "object") {
          callbacks.onMiniapp?.({
            kind: payload.kind,
            title: payload.title,
            blocks: Array.isArray(payload.blocks) ? payload.blocks : [],
          });
        }
        break;
      case "action":
        if (payload && typeof payload === "object") {
          // Forward both ways: the app's RNA-seq actions handler expects an
          // `{ proposed_actions: [...] }` shape, while the CTA handler expects a
          // single CTA object. We pass the raw action through both — the App
          // adapter decides which to honor.
          callbacks.onActions?.(payload);
          callbacks.onCta?.(payload);
        }
        break;
      case "error":
        streamError = makeError(payload);
        break;
      case "done":
        finish = payload?.finish ?? null;
        usage = payload?.usage ?? usage;
        if (usage) callbacks.onUsage?.(usage);
        break;
      case "meta":
      case "tool":
      default:
        // No app-side UI for meta/tool or unknown events — ignore.
        break;
    }
  };

  const consumeFrame = (frameText) => {
    let eventName = "message";
    const dataLines = [];
    for (const line of String(frameText || "").split(/\r?\n/)) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim() || "message";
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
    }
    if (!dataLines.length) return;
    const data = dataLines.join("\n");
    if (!data || data === "[DONE]") return;
    let payload;
    try {
      payload = JSON.parse(data);
    } catch {
      return;
    }
    consumePayload(eventName, payload);
    if (streamError) throw streamError;
  };

  if (response.body?.getReader) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() || "";
        for (const frame of frames) consumeFrame(frame);
      }
    } catch (error) {
      await reader.cancel?.().catch(() => undefined);
      throw error;
    } finally {
      reader.releaseLock?.();
    }
    if (buffer) consumeFrame(buffer);
  } else if (typeof response.text === "function") {
    const text = await response.text();
    for (const frame of String(text).split(/\r?\n\r?\n/)) consumeFrame(frame);
  }

  if (streamError) {
    callbacks.onError?.(streamError);
    throw streamError;
  }

  callbacks.onDone?.();
  return { answer, usage, finish, ok: true };
}

module.exports = {
  streamUnifiedChat,
};
