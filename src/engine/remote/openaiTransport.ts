/**
 * OpenAI chat completions over XHR (POST + onprogress). No auto-reconnect.
 * react-native-sse was skipped: it reconnects by default; this path matches
 * unifiedChatClient.js and is unit-testable with a fake XHR.
 */
import {
  newRequestId,
  parseSseFrame,
  splitSseFrames,
  type OpenAiChatDelta,
} from "./openaiSse";

export type RemoteChatRequest = {
  baseUrl: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  token?: string | null;
  signal?: AbortSignal;
  requestId?: string;
};

export type RemoteChatHandlers = {
  onDelta: (delta: OpenAiChatDelta) => void;
  onError: (error: Error) => void;
  onDone: () => void;
};

export type XhrLike = {
  readyState: number;
  status: number;
  responseText: string;
  timeout: number;
  open: (method: string, url: string) => void;
  setRequestHeader: (name: string, value: string) => void;
  send: (body?: string) => void;
  abort: () => void;
  onreadystatechange: ((this: XhrLike) => void) | null;
  onprogress: ((this: XhrLike) => void) | null;
  onerror: ((this: XhrLike) => void) | null;
  ontimeout: ((this: XhrLike) => void) | null;
  onabort: ((this: XhrLike) => void) | null;
};

export type XhrFactory = () => XhrLike;

const HEADERS_RECEIVED = 2;
const DONE = 4;

export function streamOpenAiChat(
  req: RemoteChatRequest,
  handlers: RemoteChatHandlers,
  createXhr?: XhrFactory,
): { requestId: string; abort: () => void } {
  const requestId = req.requestId ?? newRequestId();
  const xhr = createXhr
    ? createXhr()
    : (new XMLHttpRequest() as unknown as XhrLike);

  let buffer = "";
  let cursor = 0;
  let closed = false;
  let sawDone = false;

  const finish = (err?: Error) => {
    if (closed) return;
    closed = true;
    try {
      xhr.abort();
    } catch {
      // ignore
    }
    if (err) handlers.onError(err);
    else handlers.onDone();
  };

  const consume = () => {
    const text = xhr.responseText ?? "";
    if (text.length <= cursor) return;
    buffer += text.slice(cursor);
    cursor = text.length;
    const split = splitSseFrames(buffer);
    buffer = split.rest;
    for (const frame of split.frames) {
      for (const delta of parseSseFrame(frame)) {
        if (delta.done) {
          sawDone = true;
          finish();
          return;
        }
        handlers.onDelta(delta);
      }
    }
  };

  xhr.timeout = 0;
  xhr.open("POST", `${req.baseUrl.replace(/\/+$/, "")}/v1/chat/completions`);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Accept", "text/event-stream");
  xhr.setRequestHeader("X-Request-Id", requestId);
  if (req.token) {
    xhr.setRequestHeader("Authorization", `Bearer ${req.token}`);
  }

  xhr.onprogress = () => consume();
  xhr.onreadystatechange = () => {
    if (xhr.readyState === HEADERS_RECEIVED && xhr.status >= 400) {
      finish(new Error(`remote_brain_http_${xhr.status}`));
      return;
    }
    if (xhr.readyState === DONE) {
      if (closed) return;
      consume();
      if (xhr.status >= 400) {
        finish(new Error(`remote_brain_http_${xhr.status}`));
        return;
      }
      if (!sawDone) finish();
    }
  };
  xhr.onerror = () => finish(new Error("remote_brain_network"));
  xhr.ontimeout = () => finish(new Error("remote_brain_timeout"));
  xhr.onabort = () => {
    if (!closed) finish();
  };

  const onAbort = () => finish();
  req.signal?.addEventListener("abort", onAbort, { once: true });

  xhr.send(
    JSON.stringify({
      model: req.model,
      messages: req.messages,
      stream: true,
      max_tokens: req.maxTokens,
      temperature: req.temperature,
    }),
  );

  return {
    requestId,
    abort: () => finish(),
  };
}
