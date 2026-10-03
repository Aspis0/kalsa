/**
 * A pairing that saved no address (paired over iroh, `doorUrl: ""`) end
 * to end through RemoteEngine: the probe's GETs and the chat turn's POST
 * ride door tunnels and name the iroh stand-in origin — the request
 * line's path is all the desk reads — while the module-absent install
 * fails both with `remote_brain_iroh_missing` before anything dials.
 */

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
    __reset: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
});
jest.mock("./remoteSecret", () => ({ getRemoteBrainToken: jest.fn(async () => null) }));
jest.mock("../../pairing/pairingCredentialStore", () => ({ getPairingCredential: jest.fn() }));
jest.mock("../../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => true),
  openIrohTunnel: jest.fn(),
}));

import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn, testRemoteConnection } from "./RemoteEngine";
import { irohModulePresent, openIrohTunnel } from "../../remote/irohBridge";
import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import { setRemoteServerModelId } from "./remoteSettings";
import { IROH_TUNNEL_URL } from "../../pairing/pairingUrls";
import type { IrohTunnel } from "../../remote/irohHttp";

const NODE = "ab".repeat(32);
const CREDENTIAL = "cd".repeat(32);

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

function jsonResponse(body: string): Uint8Array {
  return ascii(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
}

/** One SSE reply, chunked so no single read carries the whole body. */
function sseResponse(frames: string[]): Uint8Array {
  const head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\n\r\n";
  const body = frames
    .map((frame) => `${frame.length.toString(16)}\r\n${frame}\r\n`)
    .join("");
  return ascii(`${head}${body}0\r\n\r\n`);
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

/** A read blocks until shutdown: the turn stays in flight until aborted. */
class HangingTunnel implements IrohTunnel {
  readonly writes: Uint8Array[] = [];
  shutdowns = 0;
  private release: (() => void) | null = null;

  async write(bytes: Uint8Array, _timeoutMs: number): Promise<void> {
    this.writes.push(bytes);
  }

  async read(_max: number, _timeoutMs: number): Promise<Uint8Array> {
    await new Promise<void>((resolve) => {
      this.release = resolve;
    });
    return new Uint8Array(0);
  }

  async shutdown(): Promise<void> {
    this.shutdowns++;
    this.release?.();
  }
}

const fetchSpy = jest.fn();

async function until(predicate: () => boolean): Promise<void> {
  for (let i = 0; i < 200 && !predicate(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("a doorless iroh pairing through RemoteEngine", () => {
  const hadFetch = "fetch" in globalThis;
  const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;

  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchSpy.mockReset();
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    (irohModulePresent as jest.Mock).mockReturnValue(true);
    (openIrohTunnel as jest.Mock).mockReset();
    (getPairingCredential as jest.Mock).mockResolvedValue({
      doorUrl: "",
      credential: CREDENTIAL,
      node: NODE,
      pairedVia: "iroh",
    });
    await setRemoteServerModelId("ornith");
  });

  afterEach(async () => {
    await disposeRemoteEngine();
    if (hadFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
  });

  test("probe and chat turn ride door tunnels naming the stand-in origin", async () => {
    const propsTunnel = new FakeTunnel([jsonResponse("{}")]);
    const modelsTunnel = new FakeTunnel([jsonResponse('{"data":[{"id":"ornith"}]}')]);
    const chatTunnel = new FakeTunnel([
      sseResponse([
        'data: {"choices":[{"delta":{"content":"ciao mondo"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n',
        "data: [DONE]\n\n",
      ]),
    ]);
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(propsTunnel)
      .mockResolvedValueOnce(modelsTunnel)
      .mockResolvedValueOnce(chatTunnel);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });

    const deltas: string[] = [];
    let done = false;
    let failure: Error | null = null;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: (_full, all) => deltas.push(all),
        onDone: () => {
          done = true;
        },
        onError: (error) => {
          failure = error;
        },
      },
      undefined,
      { locale: "en", turnId: "t-doorless" },
    );
    log.mockRestore();

    expect(failure).toBeNull();
    expect(done).toBe(true);
    expect(deltas.join("")).toBe("ciao mondo");

    // The desk lane, one dial per request, on the paired node.
    expect(
      (openIrohTunnel as jest.Mock).mock.calls.map((call: unknown[]) => call.slice(0, 2)),
    ).toEqual([
      [NODE, "door"],
      [NODE, "door"],
      [NODE, "door"],
    ]);
    // The request lines name the stand-in origin, and its host is what the
    // desk never reads — no request line names a real address, because the
    // record saved none.
    expect(text(propsTunnel.writes[0])).toContain("GET /props HTTP/1.1\r\n");
    expect(text(propsTunnel.writes[0])).toContain("Host: iroh.kalsa.invalid\r\n");
    expect(text(propsTunnel.writes[0])).toContain(`Authorization: Bearer ${CREDENTIAL}\r\n`);
    expect(text(modelsTunnel.writes[0])).toContain("GET /v1/models HTTP/1.1\r\n");
    expect(text(modelsTunnel.writes[0])).toContain("Host: iroh.kalsa.invalid\r\n");
    expect(text(chatTunnel.writes[0])).toContain("POST /v1/chat/completions HTTP/1.1\r\n");
    expect(text(chatTunnel.writes[0])).toContain("Host: iroh.kalsa.invalid\r\n");
    expect(text(chatTunnel.writes[0])).toContain(`Authorization: Bearer ${CREDENTIAL}\r\n`);

    // Not one byte took the network: the stand-in origin never reaches fetch.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("an aborted turn interrupts and closes its tunnel", async () => {
    const chatTunnel = new HangingTunnel();
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse("{}")]))
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse('{"data":[{"id":"ornith"}]}')]))
      .mockResolvedValueOnce(chatTunnel);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);

    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    log.mockRestore();

    const signal = new AbortController();
    const errors: Error[] = [];
    const turned = streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => errors.push(error),
      },
      signal.signal,
      { locale: "en", turnId: "t-doorless-abort" },
    );
    await until(() => chatTunnel.writes.length > 0);
    signal.abort();
    await turned;

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error & { code?: string }).code).toBe("interrupted");
    expect(chatTunnel.shutdowns).toBeGreaterThanOrEqual(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("with the module absent the probe and the turn name the missing road", async () => {
    (irohModulePresent as jest.Mock).mockReturnValue(false);

    const probe = await testRemoteConnection();
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("remote_brain_iroh_missing");
    expect(openIrohTunnel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();

    const errors: Error[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => errors.push(error),
      },
      undefined,
      { locale: "en", turnId: "t-doorless-nomodule" },
    );
    expect(errors.map((error) => error.message)).toEqual(["remote_brain_iroh_missing"]);
    expect(openIrohTunnel).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("the stand-in origin is the same string the pairing probe names", () => {
    expect(IROH_TUNNEL_URL).toBe("https://iroh.kalsa.invalid");
  });
});
