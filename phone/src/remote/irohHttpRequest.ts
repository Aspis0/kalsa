/**
 * One HTTP/1.1 request, serialized to exact bytes: method, path, Host,
 * headers, Content-Length computed once, body. Everything the peer could
 * use to smuggle a second request — CR, LF, NUL, non-token characters
 * where tokens are required — is refused here, not sanitized.
 */

const CRLF = "\r\n";

/** RFC 7230 tchar: what a method and a header name may be made of. */
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/** CR, LF, and NUL — the bytes that could split or end a header line. */
const FORBIDDEN = /[\r\n\0]/;

export interface IrohHttpRequest {
  method: string;
  path: string;
  host: string;
  headers?: Record<string, string>;
  body?: Uint8Array | null;
}

/** Latin-1 bytes for the ASCII-only request head (header values too). */
export function asciiBytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function rejectControlChars(value: string, what: string): void {
  if (FORBIDDEN.test(value)) {
    throw new Error(`${what} must not contain CR, LF, or NUL`);
  }
}

export function serializeHttpRequest(request: IrohHttpRequest): Uint8Array {
  rejectControlChars(request.method, "the method");
  rejectControlChars(request.path, "the path");
  rejectControlChars(request.host, "the host");
  if (!TOKEN.test(request.method)) {
    throw new Error(`the method must be HTTP token characters: ${request.method}`);
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    rejectControlChars(name, "a header name");
    rejectControlChars(value, `the value of ${name}`);
    if (!TOKEN.test(name)) {
      throw new Error(`a header name must be HTTP token characters: ${name}`);
    }
    if (name.toLowerCase() === "content-length") {
      throw new Error("Content-Length is computed here, never passed in");
    }
    if (name.toLowerCase() === "host") {
      throw new Error("Host comes from request.host, never from headers");
    }
    if (name.toLowerCase() === "transfer-encoding") {
      throw new Error("Transfer-Encoding is not supported on requests");
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
