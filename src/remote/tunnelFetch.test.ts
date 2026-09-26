/**
 * The JSON-over-tunnel boundary: the request a caller hands over leaves
 * byte-exact, every exit path closes the tunnel it was given, and a desk
 * that drips forever dies at the total deadline — the per-read timeout
 * alone would reset on every byte.
 */

import { fetchJsonOverTunnel } from "./tunnelFetch";
import type { IrohTunnel } from "./irohHttp";

function ascii(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function text(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

class FakeTunnel implements IrohTunnel {
  readonly writes: Uint8Array[] = [];
  shutdowns = 0;

  constructor(private readonly reads: Uint8Array[]) {}

  async write(bytes: Uint8Array, _timeoutMs: number): Promise<void> {
    this.writes.push(bytes);
  }

  async read(max: number, _timeoutMs: number): Promise<Uint8Array> {
    if (this.reads.length === 0) return new Uint8Array(0);
    const next = this.reads.shift() as Uint8Array;
    if (next.length <= max) return next;
    this.reads.unshift(next.subarray(max));
    return next.subarray(0, max);
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
  }
}

/** A read that never answers until the tunnel is shut down. */
class DripTunnel implements IrohTunnel {
  shutdowns = 0;
  private release!: () => void;
  private readonly blocked = new Promise<void>((resolve) => {
    this.release = resolve;
  });

  async write(): Promise<void> {}

  async read(): Promise<Uint8Array> {
    await this.blocked;
    throw new Error("tunnel closed");
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
    this.release();
  }
}

const URL_UNDER_TEST = "https://desktop.example:8443/pair/claim";
const POST = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };

describe("fetchJsonOverTunnel", () => {
  test("the request leaves byte-exact and the tunnel closes behind the response", async () => {
    const head = "HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}";
    const tunnel = new FakeTunnel([ascii(head)]);

    const response = await fetchJsonOverTunnel(tunnel, URL_UNDER_TEST, POST, {
      timeoutMs: 1_000,
    });

    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toEqual({});
    expect(text(tunnel.writes[0])).toBe(
      "POST /pair/claim HTTP/1.1\r\n" +
        "Host: desktop.example:8443\r\n" +
        "Content-Type: application/json\r\n" +
        "Content-Length: 2\r\n\r\n{}",
    );
    expect(tunnel.shutdowns).toBeGreaterThan(0);
  });

  test("the total deadline shuts a never-answering desk down and fails the request", async () => {
    const tunnel = new DripTunnel();

    await expect(
      fetchJsonOverTunnel(tunnel, URL_UNDER_TEST, POST, {
        timeoutMs: 5_000,
        totalTimeoutMs: 20,
      }),
    ).rejects.toThrow();
    expect(tunnel.shutdowns).toBeGreaterThan(0);
  });

  test("an already-aborted signal closes the tunnel without writing a byte", async () => {
    const tunnel = new FakeTunnel([]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      fetchJsonOverTunnel(tunnel, URL_UNDER_TEST, POST, {
        timeoutMs: 1_000,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(tunnel.writes).toHaveLength(0);
    expect(tunnel.shutdowns).toBeGreaterThan(0);
  });

  test("a URL the tunnel must not carry closes it before anything is written", async () => {
    const unparseable = new FakeTunnel([]);
    await expect(
      fetchJsonOverTunnel(unparseable, "::::not-a-url", POST, { timeoutMs: 1_000 }),
    ).rejects.toThrow();
    expect(unparseable.writes).toHaveLength(0);
    expect(unparseable.shutdowns).toBeGreaterThan(0);

    const wrongScheme = new FakeTunnel([]);
    await expect(
      fetchJsonOverTunnel(wrongScheme, "ftp://desktop.example/pair/claim", POST, {
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow("unsupported URL scheme");
    expect(wrongScheme.writes).toHaveLength(0);
    expect(wrongScheme.shutdowns).toBeGreaterThan(0);
  });
});
