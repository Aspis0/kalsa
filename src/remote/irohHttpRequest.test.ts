/**
 * Request serialization: the exact bytes one request becomes, and the
 * rules that keep it one well-formed request — header ownership and the
 * CR/LF/NUL and token-charset refusals.
 */

import { serializeHttpRequest } from "./irohHttpRequest";

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

function text(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const BASE = {
  method: "GET",
  path: "/v1/models",
  host: "kalsa",
} as const;

test("a GET without a body carries no Content-Length", () => {
  expect(text(serializeHttpRequest(BASE))).toBe(
    "GET /v1/models HTTP/1.1\r\nHost: kalsa\r\n\r\n",
  );
});

test("a POST body gets exactly one Content-Length, after the caller's headers", () => {
  const body = ascii('{"claim":"abc"}');
  expect(
    text(
      serializeHttpRequest({
        method: "POST",
        path: "/pair/claim",
        host: "kalsa",
        headers: { "Content-Type": "application/json" },
        body,
      }),
    ),
  ).toBe(
    "POST /pair/claim HTTP/1.1\r\n" +
      "Host: kalsa\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${body.length}\r\n\r\n` +
      '{"claim":"abc"}',
  );
});

test("caller-supplied Content-Length and Host are refused, not duplicated", () => {
  expect(() =>
    serializeHttpRequest({ ...BASE, headers: { "content-length": "5" } }),
  ).toThrow(/Content-Length/);
  expect(() =>
    serializeHttpRequest({ ...BASE, headers: { Host: "other" } }),
  ).toThrow(/Host/);
});

describe("request smuggling refusals", () => {
  test("CR, LF, and NUL are refused in the path, host, and header values", () => {
    expect(() =>
      serializeHttpRequest({ ...BASE, path: "/x\r\nHost: evil" }),
    ).toThrow(/path/);
    expect(() =>
      serializeHttpRequest({ ...BASE, path: "/x\nHost: evil" }),
    ).toThrow(/path/);
    expect(() => serializeHttpRequest({ ...BASE, path: "/x\0" })).toThrow(
      /path/,
    );
    expect(() => serializeHttpRequest({ ...BASE, host: "kalsa\r\n" })).toThrow(
      /host/,
    );
    expect(() =>
      serializeHttpRequest({
        ...BASE,
        headers: { Authorization: "Bearer a\r\nX-Extra: 1" },
      }),
    ).toThrow(/value/);
  });

  test("the method and header names must be HTTP token characters", () => {
    expect(() => serializeHttpRequest({ ...BASE, method: "GE T" })).toThrow(
      /token/,
    );
    expect(() => serializeHttpRequest({ ...BASE, method: "G\tT" })).toThrow(
      /token/,
    );
    expect(() =>
      serializeHttpRequest({ ...BASE, headers: { "Bad Name": "v" } }),
    ).toThrow(/token/);
    expect(() =>
      serializeHttpRequest({ ...BASE, headers: { "Bad:Name": "v" } }),
    ).toThrow(/token/);
  });
});
