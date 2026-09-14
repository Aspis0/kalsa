/**
 * OpenAI chat completions over XHR (POST + onprogress). No auto-reconnect.
 *
 * Success requires onload (HTTP 2xx only, status !== 0) AND a terminal marker
 * (`data: [DONE]` or a chunk with finish_reason stop/length/content_filter).
 * RN 0.86 fires readystatechange(DONE) before onerror — onerror/ontimeout win
 * via a microtask delay on the success path.
 */
import {
  isTerminalFinishReason,
  isTruncatingFinishReason,
  newRequestId,
  parseSseFrame,
  splitSseFrames,
  type OpenAiSseEvent,
} from "./openaiSse";

export type RemoteChatRequest = {
  /** @deprecated T6 replaces this with joinRemoteApiUrl */
  baseUrl?: string;
  completionsUrl?: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens: number;
  temperature: number;
  token?: string | null;
  signal?: AbortSignal;
  requestId?: string;
  inactivityMs?: number;
};

export type RemoteFinishKind = "complete" | "truncated" | "interrupted" | "error";

export type RemoteFinish = {
  kind: RemoteFinishKind;
  finishReason: string | null;
  error?: Error;
};

export type RemoteChatHandlers = {
  onDelta: (delta: OpenAiSseEvent) => void;
  onFinish: (finish: RemoteFinish) => void;
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
const LOADING = 3;
const DONE = 4;

function isHttp2xx(status: number): boolean {
  return status >= 200 && status < 300;
}

export function streamOpenAiChat(
  req: RemoteChatRequest,
  handlers: RemoteChatHandlers,
  createXhr?: XhrFactory,
): { requestId: string; abort: () => void; xhr: XhrLike } {
  const requestId = req.requestId ?? newRequestId();
  const xhr = createXhr
    ? createXhr()
    : (new XMLHttpRequest() as unknown as XhrLike);

  let buffer = "";
  let cursor = 0;
  let closed = false;
  let sawTerminal = false;
  let lastFinishReason: string | null = null;
  let abortListener: (() => void) | null = null;
  let successTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const inactivityMs =
    typeof req.inactivityMs === "number" ? req.inactivityMs : 120_000;

  const cleanup = () => {
    if (abortListener && req.signal) {
      req.signal.removeEventListener("abort", abortListener);
      abortListener = null;
    }
    if (successTimer != null) {
      clearTimeout(successTimer);
      successTimer = null;
    }
    if (idleTimer != null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const bumpIdle = () => {
    if (idleTimer != null) clearTimeout(idleTimer);
    idleTimer = null;
    if (inactivityMs <= 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      emitFinish({
        kind: "error",
        finishReason: lastFinishReason,
        error: new Error("remote_brain_timeout"),
      });
    }, inactivityMs);
  };

  const emitFinish = (finish: RemoteFinish) => {
    if (closed) return;
    closed = true;
    cleanup();
    try {
      xhr.abort();
    } catch {
      // ignore
    }
    handlers.onFinish(finish);
  };

  const consume = () => {
    bumpIdle();
    const text = xhr.responseText ?? "";
    if (text.length <= cursor) return;
    buffer += text.slice(cursor);
    cursor = text.length;
    const split = splitSseFrames(buffer);
    buffer = split.rest;
    for (const frame of split.frames) {
      if (closed) return;
      for (const event of parseSseFrame(frame)) {
        if (closed) return;
        if (event.kind === "ignore") continue;
        if (event.kind === "error") {
          emitFinish({
            kind: "error",
            finishReason: lastFinishReason,
            error: new Error(event.message || "remote_sse_error"),
          });
          return;
        }
        if (event.finishReason) {
          // Explicit finish_reason wins over a later [DONE] (null reason).
          lastFinishReason = event.finishReason;
        }
        if (event.kind === "done" || isTerminalFinishReason(event.finishReason)) {
          sawTerminal = true;
        }
        if (event.kind === "delta") handlers.onDelta(event);
        if (closed) return;
      }
    }
  };

  const finishFromOnload = () => {
    if (closed) return;
    consume();
    if (!isHttp2xx(xhr.status)) {
      emitFinish({
        kind: "error",
        finishReason: lastFinishReason,
        error: new Error(`remote_brain_http_${xhr.status}`),
      });
      return;
    }
    const kind: RemoteFinishKind = !sawTerminal
      ? "interrupted"
      : isTruncatingFinishReason(lastFinishReason)
        ? "truncated"
        : "complete";
    // RN 0.86: readystatechange(DONE) runs before onerror. Defer so onerror wins.
    successTimer = setTimeout(() => {
      successTimer = null;
      if (closed) return;
      emitFinish({ kind, finishReason: lastFinishReason });
    }, 0);
  };

  if (req.signal?.aborted) {
    handlers.onFinish({ kind: "interrupted", finishReason: null });
    return {
      requestId,
      xhr,
      abort: () => undefined,
    };
  }

  const url =
    req.completionsUrl ||
    `${(req.baseUrl ?? "").replace(/\/+$/, "")}/v1/chat/completions`;
  xhr.timeout = 0;
  xhr.open("POST", url);
  xhr.setRequestHeader("Content-Type", "application/json");
  xhr.setRequestHeader("Accept", "text/event-stream");
  xhr.setRequestHeader("X-Request-Id", requestId);
  if (req.token) {
    xhr.setRequestHeader("Authorization", `Bearer ${req.token}`);
  }

  xhr.onprogress = () => {
    if (closed) return;
    consume();
  };
  xhr.onreadystatechange = () => {
    if (closed) return;
    if (xhr.readyState === HEADERS_RECEIVED && xhr.status !== 0 && !isHttp2xx(xhr.status)) {
      emitFinish({
        kind: "error",
        finishReason: lastFinishReason,
        error: new Error(`remote_brain_http_${xhr.status}`),
      });
      return;
    }
    if (xhr.readyState === LOADING) consume();
    if (xhr.readyState === DONE) finishFromOnload();
  };
  xhr.onerror = () => {
    emitFinish({
      kind: "error",
      finishReason: lastFinishReason,
      error: new Error("remote_brain_network"),
    });
  };
  xhr.ontimeout = () => {
    emitFinish({
      kind: "error",
      finishReason: lastFinishReason,
      error: new Error("remote_brain_timeout"),
    });
  };
  xhr.onabort = () => {
    if (closed) return;
    consume();
    emitFinish({ kind: "interrupted", finishReason: lastFinishReason });
  };

  abortListener = () => {
    consume();
    emitFinish({ kind: "interrupted", finishReason: lastFinishReason });
  };
  req.signal?.addEventListener("abort", abortListener);
  bumpIdle();

  try {
    xhr.send(
      JSON.stringify({
        model: req.model,
        messages: req.messages,
        stream: true,
        max_tokens: req.maxTokens,
        temperature: req.temperature,
      }),
    );
  } catch (err) {
    emitFinish({
      kind: "error",
      finishReason: lastFinishReason,
      error: err instanceof Error ? err : new Error("remote_brain_send"),
    });
  }

  return {
    requestId,
    xhr,
    abort: () => {
      consume();
      emitFinish({ kind: "interrupted", finishReason: lastFinishReason });
    },
  };
}
