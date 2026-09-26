/**
 * One JSON HTTP request/response over one iroh tunnel: the byte-exact
 * request the HTTPS path would send (Content-Length recomputed, never
 * forwarded), a bounded response body, and a tunnel that is always closed
 * before this resolves or throws — callers never shut tunnels themselves.
 */

import { openIrohHttpRequest, type IrohTunnel } from "./irohHttp";
import { serializeHttpRequest, type IrohHttpRequest } from "./irohHttpRequest";

/** Control responses (probe JSON, pairing seal), never documents. */
const MAX_RESPONSE_BYTES = 512 * 1024;

export type TunnelJsonInit = {
  method: string;
  headers?: Record<string, string>;
  body?: string;
};

export type TunnelJsonResponse = {
  ok: boolean;
  status: number;
  /** Whether the drained body was empty — the desk's 403-busy signal. */
  isBodyEmpty(): Promise<boolean>;
  json(): Promise<unknown>;
};

export type TunnelFetchOptions = {
  /** One write/read deadline; the caller picks it per operation. */
  timeoutMs: number;
  /**
   * Deadline for the whole request. Per-read timeouts reset on every byte,
   * so a peer that drips can outlive them; when this fires the tunnel
   * shuts down and the in-flight read fails the request.
   */
  totalTimeoutMs?: number;
  /** Aborting mid-flight shuts the tunnel down, which fails the in-flight read. */
  signal?: AbortSignal;
};

export async function fetchJsonOverTunnel(
  tunnel: IrohTunnel,
  url: string,
  init: TunnelJsonInit,
  options: TunnelFetchOptions,
): Promise<TunnelJsonResponse> {
  // Everything before the request is written can still throw, and the
  // caller already opened the tunnel: each of those paths closes it here.
  let parsed: URL;
  try {
    parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("unsupported URL scheme");
    }
  } catch (error) {
    await tunnel.shutdown();
    throw error;
  }
  if (options.signal?.aborted === true) {
    await tunnel.shutdown();
    throw new Error("aborted");
  }
  // serializeHttpRequest computes Content-Length and refuses a forwarded one;
  // dropping the caller's copy recomputes the identical number for the same
  // body, so the bytes on the tunnel match the HTTPS request.
  const headers = { ...init.headers };
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() === "content-length") delete headers[name];
  }
  const request: IrohHttpRequest = {
    method: init.method,
    path: `${parsed.pathname}${parsed.search}`,
    host: parsed.host,
    headers,
    body: init.body === undefined ? null : new TextEncoder().encode(init.body),
  };
  const onAbort = () => {
    void tunnel.shutdown();
  };
  options.signal?.addEventListener("abort", onAbort);
  const totalDeadline =
    options.totalTimeoutMs === undefined
      ? null
      : setTimeout(() => {
          void tunnel.shutdown();
        }, options.totalTimeoutMs);
  try {
    const response = await openIrohHttpRequest(tunnel, request, {
      timeoutMs: options.timeoutMs,
    });
    // Drained eagerly: a caller that only checks the status (the pairing
    // claim does) must still leave the tunnel closed, never half-read.
    const bytes = await response.readBody(MAX_RESPONSE_BYTES);
    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      isBodyEmpty: async () => bytes.length === 0,
      json: async () => JSON.parse(new TextDecoder("utf-8").decode(bytes)),
    };
  } finally {
    if (totalDeadline !== null) clearTimeout(totalDeadline);
    options.signal?.removeEventListener("abort", onAbort);
  }
}
