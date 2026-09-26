/**
 * The chat XHR shim over a fake tunnel: the transport's header wire goes
 * out byte-exact, the SSE body streams back through the same event
 * callbacks RN's XHR fires (including a multi-byte character split across
 * two reads), and abort closes the tunnel without a second event.
 */

import { createIrohChatXhr } from "./irohChatXhr";
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

/** One canned response per read; an exhausted queue is EOF. */
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

const drain = () => new Promise((resolve) => setImmediate(resolve));

function makeXhr(tunnel: IrohTunnel) {
  const acquire = jest.fn(() => tunnel);
  const xhr = createIrohChatXhr(acquire);
  const states: number[] = [];
  let progress = 0;
  const events: string[] = [];
  xhr.onreadystatechange = () => states.push(xhr.readyState);
  xhr.onprogress = () => {
    progress++;
  };
  xhr.onerror = () => events.push("error");
  xhr.ontimeout = () => events.push("timeout");
  xhr.onabort = () => events.push("abort");
  return { acquire, xhr, states, events, progress: () => progress };
}

const COMPLETIONS_URL = "https://desktop.example:9443/v1/chat/completions";

describe("the iroh chat XHR", () => {
  test("writes the transport's request byte-exact and streams the SSE body back", async () => {
    const head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
    // "data: a" + 0xC3 (8 bytes), then the 0xA8 continuation + "b\n\n" (4):
    // the two halves of "è" live in different reads on purpose.
    const frame1 = "8\r\ndata: a\xC3\r\n";
    const frame2 = "4\r\n\xA8b\n\n\r\n";
    const tunnel = new FakeTunnel([ascii(head), ascii(frame1), ascii(frame2), ascii("0\r\n\r\n")]);
    const { acquire, xhr, states, events, progress } = makeXhr(tunnel);

    xhr.open("POST", COMPLETIONS_URL);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.setRequestHeader("Accept", "text/event-stream");
    xhr.setRequestHeader("Authorization", "Bearer abab");
    xhr.send('{"stream":true}');
    expect(acquire).toHaveBeenCalledTimes(1);
    await drain();

    const body = '{"stream":true}';
    expect(text(tunnel.writes[0])).toBe(
      "POST /v1/chat/completions HTTP/1.1\r\n" +
        "Host: desktop.example:9443\r\n" +
        "Content-Type: application/json\r\n" +
        "Accept: text/event-stream\r\n" +
        "Authorization: Bearer abab\r\n" +
        `Content-Length: ${body.length}\r\n\r\n${body}`,
    );
    expect(xhr.status).toBe(200);
    expect(states).toEqual([2, 3, 3, 4]);
    expect(progress()).toBe(2);
    expect(xhr.responseText).toBe("data: aèb\n\n");
    expect(events).toEqual([]);
    expect(tunnel.shutdowns).toBeGreaterThan(0);
  });

  test("a non-2xx response stops at the head without reading or reporting the body", async () => {
    const head = "HTTP/1.1 503 Busy\r\nContent-Length: 4\r\n\r\n";
    const tunnel = new FakeTunnel([ascii(head), ascii("oops")]);
    const { acquire, xhr, states, events, progress } = makeXhr(tunnel);
    // What the transport does at HEADERS_RECEIVED with a non-2xx: finish
    // and abort the XHR before a body ever matters.
    xhr.onreadystatechange = () => {
      states.push(xhr.readyState);
      if (xhr.readyState === 2 && !(xhr.status >= 200 && xhr.status < 300)) xhr.abort();
    };

    xhr.open("POST", COMPLETIONS_URL);
    xhr.send("{}");
    await drain();

    expect(acquire).toHaveBeenCalledTimes(1);
    expect(xhr.status).toBe(503);
    expect(states).toEqual([2]);
    expect(progress()).toBe(0);
    expect(xhr.responseText).toBe("");
    expect(events).toEqual(["abort"]);
    expect(tunnel.shutdowns).toBeGreaterThan(0);
    await drain();
    expect(events).toEqual(["abort"]);
  });

  test("an abort before send leaves the tunnel with its opener", () => {
    const tunnel = new FakeTunnel([]);
    const { acquire, xhr, events } = makeXhr(tunnel);

    xhr.open("POST", COMPLETIONS_URL);
    xhr.abort();

    expect(events).toEqual(["abort"]);
    expect(acquire).not.toHaveBeenCalled();
    expect(tunnel.shutdowns).toBe(0);
  });

  test("a URL the shim cannot parse fails as an error before any tunnel exists", async () => {
    const tunnel = new FakeTunnel([]);
    const { acquire, xhr, events } = makeXhr(tunnel);

    xhr.open("POST", "not a url");
    xhr.send("{}");
    await drain();

    expect(events).toEqual(["error"]);
    expect(acquire).not.toHaveBeenCalled();
    expect(tunnel.shutdowns).toBe(0);
  });
});
