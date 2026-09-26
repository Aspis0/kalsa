/**
 * Request serialization: the exact bytes one request becomes, and the
 * header rules that keep it one well-formed request.
 */

import { serializeHttpRequest } from "./irohHttp";

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

test("a GET without a body carries no Content-Length", () => {
  const request = serializeHttpRequest({
    method: "GET",
    path: "/v1/models",
    host: "kalsa",
  });
  expect(text(request)).toBe("GET /v1/models HTTP/1.1\r\nHost: kalsa\r\n\r\n");
});

test("a POST body gets exactly one Content-Length, after the caller's headers", () => {
  const body = ascii('{"claim":"abc"}');
  const request = serializeHttpRequest({
    method: "POST",
    path: "/pair/claim",
    host: "kalsa",
    headers: { "Content-Type": "application/json" },
    body,
  });
  expect(text(request)).toBe(
    "POST /pair/claim HTTP/1.1\r\n" +
      "Host: kalsa\r\n" +
      "Content-Type: application/json\r\n" +
      `Content-Length: ${body.length}\r\n\r\n` +
      '{"claim":"abc"}',
  );
});

test("caller-supplied Content-Length and Host are refused, not duplicated", () => {
  expect(() =>
    serializeHttpRequest({
      method: "GET",
      path: "/",
      host: "kalsa",
      headers: { "content-length": "5" },
    }),
  ).toThrow(/Content-Length/);
  expect(() =>
    serializeHttpRequest({
      method: "GET",
      path: "/",
      host: "kalsa",
      headers: { Host: "other" },
    }),
  ).toThrow(/Host/);
});
