/**
 * HTTP/1.1 responses over an iroh tunnel: parses the head (bounded),
 * then hands out the body as a single-pass async iterator of raw chunks
 * — a streamed SSE response arrives chunk by chunk, never buffered
 * whole. The tunnel is shut down when the body ends, errors, or the
 * response carries no body: one request per tunnel. Not wired into
 * pairing or chat yet.
 */

import { ByteWindow, HEAD_TERMINATOR } from "./byteStream";
import { serializeHttpRequest, type IrohHttpRequest } from "./irohHttpRequest";

const CRLF = "\r\n";
const CRLF_BYTES = new Uint8Array([13, 10]);

/** The response head is refused past this size — headers, not a document. */
const MAX_HEAD_BYTES = 16 * 1024;

export type { IrohHttpRequest };

/** What the iroh module's tunnels look like to this parser. */
export interface IrohTunnel {
  write(bytes: Uint8Array, timeoutMs: number): Promise<void>;
  /** At most `max` bytes; empty = EOF. */
  read(max: number, timeoutMs: number): Promise<Uint8Array>;
  shutdown(): Promise<void>;
}

export interface IrohHttpResponse {
  status: number;
  statusText: string;
  /** Header names lowercased; on duplicates the last one wins (and some
   * duplicates — Content-Length — are refused outright). */
  headers: Record<string, string>;
  /** Raw body chunks, each no larger than one tunnel read. Single pass —
   * the tunnel carries the body once. */
  bodyChunks(): AsyncIterable<Uint8Array>;
  /** The whole body, refused past `maxTotalBytes` (SSE callers iterate
   * bodyChunks instead of buffering). */
  readBody(maxTotalBytes: number): Promise<Uint8Array>;
}

export interface IrohHttpOptions {
  /** One read's byte ceiling and every call's deadline. */
  readMax?: number;
  timeoutMs?: number;
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

/** Statuses whose responses are defined to have no body. */
function statusHasNoBody(status: number): boolean {
  return (status >= 100 && status < 200) || status === 204 || status === 304;
}

/** Chunked when the FINAL Transfer-Encoding coding token is "chunked". */
function isChunked(headers: Record<string, string>): boolean {
  const codings = (headers["transfer-encoding"] ?? "")
    .toLowerCase()
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  return codings.length > 0 && codings[codings.length - 1] === "chunked";
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
    // obs-fold (a line starting with SP/HTAB continuing the previous
    // header) died in RFC 7230; accepting it would let a header value
    // smuggle whatever the folded line carries.
    if (line.startsWith(" ") || line.startsWith("\t")) {
      throw new Error("obsolete header line folding in the response head");
    }
    const at = line.indexOf(":");
    if (at <= 0) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    if (name === "content-length" && headers["content-length"] !== undefined) {
      throw new Error("duplicate Content-Length in the response head");
    }
    headers[name] = line.slice(at + 1).trim();
  }
  return {
    status: Number(statusMatch[1]),
    statusText: statusMatch[2] ?? "",
    headers,
  };
}

/**
 * Send one request on `tunnel` and parse the response head. The tunnel is
 * shut down when the body ends (or errors, or the response has no body);
 * callers do not close it themselves.
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
  let status: number;
  let statusText: string;
  let headers: Record<string, string>;
  try {
    while (window.indexOf(HEAD_TERMINATOR) < 0) {
      const chunk = await tunnel.read(readMax, timeoutMs);
      if (chunk.length === 0) {
        throw new Error("tunnel EOF before the response head");
      }
      window.push(chunk);
      if (window.length > MAX_HEAD_BYTES) {
        throw new Error(`response head exceeds ${MAX_HEAD_BYTES} bytes`);
      }
    }
    const headBytes = window.take(window.indexOf(HEAD_TERMINATOR));
    window.take(HEAD_TERMINATOR.length);
    ({ status, statusText, headers } = parseResponseHead(
      asciiString(headBytes),
    ));
  } catch (error) {
    await tunnel.shutdown();
    throw error;
  }

  const headOnly =
    statusHasNoBody(status) || request.method.toUpperCase() === "HEAD";
  if (headOnly) {
    await tunnel.shutdown();
  }
  const chunks = headOnly
    ? emptyChunks()
    : isChunked(headers)
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
    bodyChunks: () => chunks,
    readBody: (maxTotalBytes) => collectBounded(chunks, maxTotalBytes),
  };
}

async function* emptyChunks(): AsyncGenerator<Uint8Array> {}

/** Collects the single-pass iterator under a total-byte budget. An early
 * exit (budget or transport error) auto-returns the generator, whose
 * finally closes the tunnel — no second shutdown here. */
async function collectBounded(
  chunks: AsyncIterable<Uint8Array>,
  maxTotalBytes: number,
): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  let size = 0;
  for await (const part of chunks) {
    size += part.length;
    if (size > maxTotalBytes) {
      throw new Error(`response body exceeds ${maxTotalBytes} bytes`);
    }
    parts.push(part);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Chunked framing: size line, data, CRLF; a zero size ends with trailers.
 * Every yielded piece is bounded by one tunnel read (`readMax`) — a huge
 * declared chunk size streams through the window, it is never allocated.
 */
async function* dechunked(
  tunnel: IrohTunnel,
  window: ByteWindow,
  readMax: number,
  timeoutMs: number,
): AsyncGenerator<Uint8Array> {
  try {
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
      // The chunk's data must end with CRLF; a missing one is a torn or
      // hostile frame, and skipping blind would desync the stream.
      while (window.length < CRLF_BYTES.length) {
        await refill(tunnel, window, readMax, timeoutMs);
      }
      const terminator = window.take(CRLF_BYTES.length);
      if (terminator[0] !== CRLF_BYTES[0] || terminator[1] !== CRLF_BYTES[1]) {
        throw new Error("chunk data not terminated by CRLF");
      }
    }
  } finally {
    // Completion, error, or an early return from the consumer: the
    // one-request tunnel is done either way.
    await tunnel.shutdown();
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

/** Trailers run to an empty line; an EOF before it is a torn body. */
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
    await tunnel.shutdown();
    throw new Error(`not a Content-Length: ${contentLength}`);
  }
  let remaining = total;
  try {
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
  } finally {
    await tunnel.shutdown();
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
