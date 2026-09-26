/**
 * Response parsing over a fake tunnel: status and headers, the three body
 * framings (SSE rides chunked, streamed), the size caps, the framing
 * refusals, the no-body statuses, and the tunnel's shutdown lifecycle.
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

describe("body framings", () => {
  test("a Content-Length body split across reads is delivered whole, then the tunnel closes", async () => {
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
    expect(text(await response.readBody(1024))).toBe("kalsa-roundtrip!");
    expect(tunnel.shutdowns).toBe(1);
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
    expect(tunnel.shutdowns).toBe(1);
  });

  test("a huge declared chunk size streams to EOF instead of buffering", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
    // Declares 1 GiB, delivers 5 bytes, then the stream ends: the parser
    // must hand those bytes out and hit EOF — never try to hold 1 GiB.
    const tunnel = new FakeTunnel([
      head,
      ascii("40000000\r\nhello\r\n"),
    ]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    await expect(response.readBody(1024)).rejects.toThrow(
      /EOF inside the body framing/,
    );
    expect(tunnel.shutdowns).toBe(1);
  });

  test("a chunk split mid-frame across reads still reassembles", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
    const tunnel = new FakeTunnel([
      head,
      ascii("10\r\nkalsa-"),
      ascii("round"),
      ascii("trip!\r\n0\r\n\r\n"),
    ]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    expect(text(await response.readBody(1024))).toBe("kalsa-roundtrip!");
  });

  test("a body with no length is delivered until EOF (close-delimited)", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n");
    const tunnel = new FakeTunnel([head, ascii("plain"), ascii(" body")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    const chunks: string[] = [];
    for await (const chunk of response.bodyChunks()) chunks.push(text(chunk));
    expect(chunks).toEqual(["plain", " body"]);
    expect(tunnel.shutdowns).toBe(1);
  });
});

describe("size caps", () => {
  test("a response head past 16 KiB is refused, and the tunnel closes", async () => {
    const head = ascii(
      "HTTP/1.1 200 OK\r\nX-Long: " + "a".repeat(20 * 1024) + "\r\n\r\n",
    );
    const tunnel = new FakeTunnel([head]);
    await expect(openIrohHttpRequest(tunnel, REQUEST)).rejects.toThrow(
      /head exceeds/,
    );
    expect(tunnel.shutdowns).toBe(1);
  });

  test("readBody refuses to buffer past its budget", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n");
    const tunnel = new FakeTunnel([head, ascii("a".repeat(100))]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    await expect(response.readBody(50)).rejects.toThrow(/exceeds/);
    expect(tunnel.shutdowns).toBe(1);
  });
});

describe("framing refusals", () => {
  test("a duplicate Content-Length is refused", async () => {
    const head = ascii(
      "HTTP/1.1 200 OK\r\nContent-Length: 5\r\nContent-Length: 6\r\n\r\n",
    );
    const tunnel = new FakeTunnel([head, ascii("hello")]);
    await expect(openIrohHttpRequest(tunnel, REQUEST)).rejects.toThrow(
      /duplicate Content-Length/,
    );
  });

  test("Transfer-Encoding is judged by its final coding token, case-insensitively", async () => {
    const head = ascii(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: gzip, Chunked\r\n\r\n",
    );
    const tunnel = new FakeTunnel([head, ascii("1\r\nx\r\n0\r\n\r\n")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    expect(text(await response.readBody(16))).toBe("x");
  });

  test("chunked is not assumed when another coding comes last", async () => {
    // "chunked, gzip" cannot be dechunked by this client: it must not
    // pretend the body is plain chunked framing.
    const head = ascii(
      "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked, gzip\r\nContent-Length: 4\r\n\r\n",
    );
    const tunnel = new FakeTunnel([head, ascii("abcd")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    expect(text(await response.readBody(16))).toBe("abcd");
  });

  test("a missing CRLF after chunk data is refused", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n");
    // 5 bytes declared, only 4 delivered before the next size line.
    const tunnel = new FakeTunnel([head, ascii("5\r\nhelloXY\r\n0\r\n\r\n")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    await expect(response.readBody(64)).rejects.toThrow(
      /not terminated by CRLF/,
    );
    expect(tunnel.shutdowns).toBe(1);
  });

  test("an obs-fold header line is refused", async () => {
    const head = ascii(
      "HTTP/1.1 200 OK\r\nX-A: 1\r\n  folded-continuation\r\n\r\n",
    );
    const tunnel = new FakeTunnel([head]);
    await expect(openIrohHttpRequest(tunnel, REQUEST)).rejects.toThrow(
      /folding/,
    );
    expect(tunnel.shutdowns).toBe(1);
  });

  test("EOF before the response head is a refusal, not a hang", async () => {
    const tunnel = new FakeTunnel([ascii("HTTP/1.1 200")]);
    await expect(openIrohHttpRequest(tunnel, REQUEST)).rejects.toThrow(
      /EOF before the response head/,
    );
    expect(tunnel.shutdowns).toBe(1);
  });

  test("a torn Content-Length body is refused at EOF", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nContent-Length: 10\r\n\r\n");
    const tunnel = new FakeTunnel([head, ascii("short")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    await expect(response.readBody(64)).rejects.toThrow(/bytes owed/);
    expect(tunnel.shutdowns).toBe(1);
  });
});

describe("no-body responses", () => {
  test.each([204, 304])("status %i carries no body and closes the tunnel at once", async (status) => {
    const head = ascii(`HTTP/1.1 ${status} x\r\nContent-Length: 5\r\n\r\n`);
    const tunnel = new FakeTunnel([head, ascii("never")]);
    const response = await openIrohHttpRequest(tunnel, REQUEST);
    expect(text(await response.readBody(64))).toBe("");
    expect(tunnel.shutdowns).toBe(1);
  });

  test("a HEAD request reads no body even when a length is declared", async () => {
    const head = ascii("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\n");
    const tunnel = new FakeTunnel([head, ascii("never")]);
    const response = await openIrohHttpRequest(tunnel, {
      ...REQUEST,
      method: "HEAD",
    });
    expect(text(await response.readBody(64))).toBe("");
    expect(tunnel.shutdowns).toBe(1);
  });
});
