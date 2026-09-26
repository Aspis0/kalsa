/**
 * streamOpenAiChat's XHR over iroh: `open`/`setRequestHeader` record what
 * the transport sets, `send` writes the POST on an open door tunnel, then
 * the response feeds the transport's onreadystatechange/onprogress exactly
 * like RN's XHR — status at HEADERS_RECEIVED, body text as it arrives,
 * DONE when the body ends. One tunnel, one request: this shim closes the
 * tunnel on body end, error, or abort, and never reports events after any
 * of those.
 */

import { openIrohHttpRequest, type IrohTunnel } from "./irohHttp";
import { serializeHttpRequest, type IrohHttpRequest } from "./irohHttpRequest";
import type { XhrLike } from "../engine/remote/openaiTransport";

/**
 * The transport's XHR states (openaiTransport's HEADERS_RECEIVED/LOADING/
 * DONE): the wire sees the same sequence RN's XHR produces.
 */
const HEADERS_RECEIVED = 2;
const LOADING = 3;
const DONE = 4;

/**
 * Per-read deadline above the transport's 120 s inactivity window, so a
 * silent desktop still finishes as the transport's own remote_brain_timeout
 * — the same copy the HTTPS road shows — never as an earlier iroh error.
 */
const CHAT_TIMEOUT_MS = 130_000;

/**
 * An XhrLike that owns `acquireTunnel`'s tunnel from `send` onward. The
 * tunnel reaches the shim only when send actually runs, so a stream the
 * transport aborts before sending leaves the tunnel with its opener.
 */
export function createIrohChatXhr(
  acquireTunnel: () => IrohTunnel,
  timeoutMs: number = CHAT_TIMEOUT_MS,
): XhrLike {
  let method = "";
  let url = "";
  const requestHeaders: Record<string, string> = {};
  let tunnel: IrohTunnel | null = null;
  let finished = false;

  const stop = () => {
    if (finished) return;
    finished = true;
    if (tunnel !== null) void tunnel.shutdown();
  };

  const run = async (bodyText: string): Promise<void> => {
    try {
      const parsed = new URL(url);
      const request: IrohHttpRequest = {
        method,
        path: `${parsed.pathname}${parsed.search}`,
        host: parsed.host,
        headers: { ...requestHeaders },
        body: new TextEncoder().encode(bodyText),
      };
      // Ownership crosses here, synchronously inside send(): from this
      // point only this shim closes the tunnel.
      const owned = acquireTunnel();
      if (finished) {
        await owned.shutdown();
        return;
      }
      tunnel = owned;
      const response = await openIrohHttpRequest(owned, request, { timeoutMs });
      if (finished) {
        await response.close();
        return;
      }
      xhr.status = response.status;
      xhr.readyState = HEADERS_RECEIVED;
      // The transport finishes a non-2xx here (and aborts us); a 2xx falls
      // through to the body.
      xhr.onreadystatechange?.();
      if (finished) {
        await response.close();
        return;
      }
      const decoder = new TextDecoder("utf-8");
      for await (const chunk of response.bodyChunks()) {
        if (finished) return;
        // stream:true keeps a multi-byte character split across two reads
        // from ever reaching the SSE parser cut in half.
        xhr.responseText += decoder.decode(chunk, { stream: true });
        xhr.readyState = LOADING;
        xhr.onprogress?.();
        xhr.onreadystatechange?.();
      }
      if (finished) return;
      xhr.responseText += decoder.decode();
      xhr.readyState = DONE;
      xhr.onreadystatechange?.();
    } catch {
      if (finished) return;
      // openIrohHttpRequest closes its own tunnel on failure; a failure
      // before it ran (URL or header serialization) still owes a close.
      if (tunnel !== null) void tunnel.shutdown();
      xhr.onerror?.();
    }
  };

  const xhr: XhrLike = {
    readyState: 0,
    status: 0,
    responseText: "",
    timeout: 0,
    open: (nextMethod, nextUrl) => {
      method = nextMethod;
      url = nextUrl;
    },
    setRequestHeader: (name, value) => {
      requestHeaders[name] = value;
    },
    send: (bodyText) => {
      void run(bodyText ?? "");
    },
    abort: () => {
      // Also reached from the transport's own emitFinish (already finished
      // by then), so the guard is what keeps abort from double-reporting.
      if (finished) return;
      stop();
      xhr.onabort?.();
    },
    onreadystatechange: null,
    onprogress: null,
    onerror: null,
    ontimeout: null,
    onabort: null,
  };
  return xhr;
}
