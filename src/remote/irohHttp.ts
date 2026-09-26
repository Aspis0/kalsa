/**
 * HTTP/1.1 over an iroh tunnel: serializes exactly one request (method,
 * path, Host, headers, Content-Length once, body) and parses the response
 * (status line, headers, Content-Length or chunked body). The body is an
 * async iterator of raw chunks — a streamed SSE response arrives chunk by
 * chunk, never buffered whole. One request per tunnel; not wired into
 * pairing or chat yet.
 */

import { ByteWindow, HEAD_TERMINATOR } from "./byteStream";

const CRLF = "\r\n";
const CRLF_BYTES = new Uint8Array([13, 10]);

/** What the iroh module's tunnels look like to this parser. */
export interface IrohTunnel {
  write(bytes: Uint8Array, timeoutMs: number): Promise<void>;
  /** At most `max` bytes; empty = EOF. */
  read(max: number, timeoutMs: number): Promise<Uint8Array>;
  shutdown(): Promise<void>;
}

export interface IrohHttpRequest {
  method: string;
  path: string;
  host: string;
  headers?: Record<string, string>;
  body?: Uint8Array | null;
}

export interface IrohHttpResponse {
  status: number;
  statusText: string;
  /** Header names lowercased; on duplicates the last one wins. */
  headers: Record<string, string>;
  /** Raw body chunks: dechunked when chunked, as delivered otherwise.
   * Single pass — the tunnel carries the body once. */
  bodyChunks(): AsyncIterable<Uint8Array>;
  readBody(): Promise<Uint8Array>;
}

export interface IrohHttpOptions {
  /** One read's byte ceiling and every call's deadline. */
  readMax?: number;
  timeoutMs?: number;
}

/** Latin-1 bytes for the ASCII-only request head (header values too). */
function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function asciiString(bytes: Uint8Array): string {
  let out = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + CHUNK) as unknown as number[],
    );
  }
  return out;
}

export function serializeHttpRequest(request: IrohHttpRequest): Uint8Array {
  for (const name of Object.keys(request.headers ?? {})) {
    const lower = name.toLowerCase();
    if (lower === "content-length") {
      throw new Error("Content-Length is computed here, never passed in");
    }
    if (lower === "host") {
      throw new Error("Host comes from request.host, never from headers");
    }
  }
  const body = request.body ?? null;
  const lines = [
    `${request.method} ${request.path} HTTP/1.1`,
    `Host: ${request.host}`,
    ...Object.entries(request.headers ?? {}).map(
      ([name, value]) => `${name}: ${value}`,
    ),
  ];
  if (body) lines.push(`Content-Length: ${body.length}`);
  const head = asciiBytes(lines.join(CRLF) + CRLF + CRLF);
  if (!body) return head;
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

/** Parse the status line and headers of one response head (ASCII). */
export function parseResponseHead(head: string): {
  status: number;
  statusText: string;
  headers: Record<string, string>;
} {
  const lines = head.split(CRLF);
  const statusMatch = /^HTTP\/\d\.\d (\d{3})(?: (.*))?$/.exec(lines[0] ?? "");
  if (!statusMatch) {
    throw new Error(`not an HTTP status line: ${lines[0] ?? "(empty)"}`);
  }
  const headers: Record<string, string> = {};
  for (const line of lines.slice(1)) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    headers[line.slice(0, at).trim().toLowerCase()] = line
      .slice(at + 1)
      .trim();
  }
  return {
    status: Number(statusMatch[1]),
    statusText: statusMatch[2] ?? "",
    headers,
  };
}

/**
 * Send one request on `tunnel` and parse the response head. The returned
 * body iterators continue reading the same tunnel; `readBody` collects.
 */
export async function openIrohHttpRequest(
  tunnel: IrohTunnel,
  request: IrohHttpRequest,
  options: IrohHttpOptions = {},
): Promise<IrohHttpResponse> {
  const readMax = options.readMax ?? 16384;
  const timeoutMs = options.timeoutMs ?? 30000;
  await tunnel.write(serializeHttpRequest(request), timeoutMs);

  const window = new ByteWindow();
  while (window.indexOf(HEAD_TERMINATOR) < 0) {
    const chunk = await tunnel.read(readMax, timeoutMs);
    if (chunk.length === 0) {
      throw new Error("tunnel EOF before the response head");
    }
    window.push(chunk);
  }
  const headBytes = window.take(window.indexOf(HEAD_TERMINATOR));
  window.take(HEAD_TERMINATOR.length);
  const { status, statusText, headers } = parseResponseHead(
    asciiString(headBytes),
  );

  const isChunked = (headers["transfer-encoding"] ?? "").includes("chunked");
  const bodyChunks = isChunked
    ? dechunked(tunnel, window, readMax, timeoutMs)
    : lengthOrCloseDelimited(
        tunnel,
        window,
        headers["content-length"],
        readMax,
        timeoutMs,
      );

  return {
    status,
    statusText,
    headers,
    bodyChunks: () => bodyChunks,
    readBody: async () => {
      const parts: Uint8Array[] = [];
      for await (const chunk of bodyChunks) parts.push(chunk);
      let size = 0;
      for (const part of parts) size += part.length;
      const out = new Uint8Array(size);
      let at = 0;
      for (const part of parts) {
        out.set(part, at);
        at += part.length;
      }
      return out;
    },
  };
}

/** Chunked framing: size line, bytes, CRLF; a zero size ends with trailers. */
async function* dechunked(
  tunnel: IrohTunnel,
  window: ByteWindow,
  readMax: number,
  timeoutMs: number,
): AsyncGenerator<Uint8Array> {
  while (true) {
    const size = await readChunkSize(tunnel, window, readMax, timeoutMs);
    if (size === 0) {
      await drainTrailers(tunnel, window, readMax, timeoutMs);
      return;
    }
    let remaining = size;
    while (remaining > 0) {
      if (window.length === 0) {
        await refill(tunnel, window, readMax, timeoutMs);
      }
      const piece = window.take(Math.min(remaining, window.length));
      remaining -= piece.length;
      yield piece;
    }
    // The CRLF that closes this chunk's data must be consumed before the
    // next size line is parsed; it may not have arrived yet.
    while (window.length < CRLF_BYTES.length) {
      await refill(tunnel, window, readMax, timeoutMs);
    }
    window.take(CRLF_BYTES.length);
  }
}

async function readChunkSize(
  tunnel: IrohTunnel,
  window: ByteWindow,
  readMax: number,
  timeoutMs: number,
): Promise<number> {
  while (window.indexOf(CRLF_BYTES) < 0) {
    await refill(tunnel, window, readMax, timeoutMs);
  }
  const line = asciiString(window.take(window.indexOf(CRLF_BYTES)));
  window.take(CRLF_BYTES.length);
  const digits = line.split(";")[0].trim();
  const size = /^([0-9a-fA-F]+)$/.test(digits)
    ? Number.parseInt(digits, 16)
    : Number.NaN;
  if (!Number.isFinite(size) || size < 0) {
    throw new Error(`not a chunk size: ${line}`);
  }
  return size;
}

/** Trailers run to an empty line; anything EOFs early is a torn body. */
async function drainTrailers(
  tunnel: IrohTunnel,
  window: ByteWindow,
  readMax: number,
  timeoutMs: number,
): Promise<void> {
  while (true) {
    const at = window.indexOf(CRLF_BYTES);
    if (at === 0) {
      window.take(CRLF_BYTES.length);
      return;
    }
    if (at > 0) {
      window.take(at + CRLF_BYTES.length);
      continue;
    }
    await refill(tunnel, window, readMax, timeoutMs);
  }
}

/** Content-Length bounded, or close-delimited when no length was sent. */
async function* lengthOrCloseDelimited(
  tunnel: IrohTunnel,
  window: ByteWindow,
  contentLength: string | undefined,
  readMax: number,
  timeoutMs: number,
): AsyncGenerator<Uint8Array> {
  const total = contentLength === undefined ? null : Number(contentLength);
  if (total !== null && (!Number.isFinite(total) || total < 0)) {
    throw new Error(`not a Content-Length: ${contentLength}`);
  }
  let remaining = total;
  while (remaining === null || remaining > 0) {
    if (window.length === 0) {
      const chunk = await tunnel.read(readMax, timeoutMs);
      if (chunk.length === 0) {
        if (remaining !== null && remaining > 0) {
          throw new Error(`tunnel EOF with ${remaining} body bytes owed`);
        }
        return;
      }
      window.push(chunk);
    }
    const piece = window.take(
      remaining === null ? window.length : Math.min(remaining, window.length),
    );
    if (remaining !== null) remaining -= piece.length;
    yield piece;
  }
}

async function refill(
  tunnel: IrohTunnel,
  window: ByteWindow,
  readMax: number,
  timeoutMs: number,
): Promise<void> {
  const chunk = await tunnel.read(readMax, timeoutMs);
  if (chunk.length === 0) {
    throw new Error("tunnel EOF inside the body framing");
  }
  window.push(chunk);
}
