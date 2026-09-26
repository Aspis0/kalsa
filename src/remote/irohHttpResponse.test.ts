/**
 * Response parsing over a fake tunnel: status and headers, Content-Length
 * and chunked bodies (SSE is a chunked stream read incrementally), and
 * the torn-stream refusals.
 */

import { openIrohHttpRequest, type IrohTunnel } from "./irohHttp";

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

/** Queues what the "server" sends, read by read; an exhausted queue is EOF. */
class FakeTunnel implements IrohTunnel {
  readonly writes: Uint8Array[] = [];
  shutdowns = 0;

  constructor(private readonly reads: Uint8Array[]) {}

  async write(bytes: Uint8Array, timeoutMs: number): Promise<void> {
    expect(timeoutMs).toBeGreaterThan(0);
    this.writes.push(bytes);
  }

  async read(max: number, timeoutMs: number): Promise<Uint8Array> {
    expect(timeoutMs).toBeGreaterThan(0);
    if (this.reads.length === 0) return new Uint8Array(0);
    const next = this.reads.shift() as Uint8Array;
    // One read delivers at most `max` bytes; split the rest for later.
    if (next.length <= max) return next;
    this.reads.unshift(next.subarray(max));
    return next.subarray(0, max);
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
}

const REQUEST = { method: "GET", path: "/v1/models", host: "kalsa" } as const;

test("a Content-Length body split across reads is delivered whole", async () => {
  const head = ascii(
    "HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 16\r\n\r\n",
  );
  const tunnel = new FakeTunnel([
    head.subarray(0, 20),
    head.subarray(20),
    ascii("kalsa-"),
    ascii("roundtrip!"),
  ]);
  const response = await openIrohHttpRequest(tunnel, REQUEST);
  expect(response.status).toBe(200);
  expect(response.statusText).toBe("OK");
  expect(response.headers["content-type"]).toBe("text/plain");
  expect(text(await response.readBody())).toBe("kalsa-roundtrip!");
  expect(text(tunnel.writes[0])).toBe(
    "GET /v1/models HTTP/1.1\r\nHost: kalsa\r\n\r\n",
  );
});

test("a chunked SSE body arrives as its chunks, in order, not buffered whole", async () => {
  const head = ascii(
    "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n",
  );
  const tunnel = new FakeTunnel([
    head,
    // "data: " is 6 bytes (0x6); "offer-abc\n" is 10 (0xa).
    ascii("6\r\ndata: \r\n"),
    ascii("a\r\noffer-abc\n\r\n"),
    ascii("0\r\n\r\n"),
  ]);
  const response = await openIrohHttpRequest(tunnel, REQUEST);
  const chunks: string[] = [];
  for await (const chunk of response.bodyChunks()) {
    chunks.push(text(chunk));
  }
  expect(chunks).toEqual(["data: ", "offer-abc\n"]);
});

test("a chunk split mid-frame across reads still reassembles", async () => {
  const head = ascii(
    "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n",
  );
  const tunnel = new FakeTunnel([
    head,
    // The whole body "kalsa-roundtrip!" is one 16-byte (0x10) chunk,
    // split mid-frame across three reads.
    ascii("10\r\nkalsa-"),
    ascii("round"),
    ascii("trip!\r\n0\r\n\r\n"),
  ]);
  const response = await openIrohHttpRequest(tunnel, REQUEST);
  expect(text(await response.readBody())).toBe("kalsa-roundtrip!");
});

test("a body with no length is delivered until EOF (close-delimited)", async () => {
  const head = ascii("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
  const tunnel = new FakeTunnel([head, ascii("plain"), ascii(" body")]);
  const response = await openIrohHttpRequest(tunnel, REQUEST);
  const chunks: string[] = [];
  for await (const chunk of response.bodyChunks()) chunks.push(text(chunk));
  expect(chunks).toEqual(["plain", " body"]);
});

test("EOF before the response head is a refusal, not a hang", async () => {
  const tunnel = new FakeTunnel([ascii("HTTP/1.1 200")]);
  await expect(openIrohHttpRequest(tunnel, REQUEST)).rejects.toThrow(
    /EOF before the response head/,
  );
});

test("a torn Content-Length body is refused at EOF", async () => {
  const head = ascii("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n");
  const tunnel = new FakeTunnel([head, ascii("short")]);
  const response = await openIrohHttpRequest(tunnel, REQUEST);
  await expect(response.readBody()).rejects.toThrow(/bytes owed/);
});
