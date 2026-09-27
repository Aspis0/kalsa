/**
 * The iroh door road end to end through RemoteEngine: with a paired node
 * and the module present, the probe's GETs and the chat turn's POST ride
 * fake door tunnels — the bearer credential on the tunnel wire, real SSE
 * parsing, zero global fetch — and each operation logs one iroh line.
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

import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn } from "./RemoteEngine";
import { openIrohTunnel } from "../../remote/irohBridge";
import { getPairingCredential } from "../../pairing/pairingCredentialStore";
import { setRemoteServerModelId } from "./remoteSettings";
import type { IrohTunnel } from "../../remote/irohHttp";

const NODE = "ab".repeat(32);
const CREDENTIAL = "cd".repeat(32);
const DOOR_URL = "https://desktop.tailnet.ts.net:9443";

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

describe("the iroh road through RemoteEngine", () => {
  const hadFetch = "fetch" in globalThis;
  const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
  const fetchSpy = jest.fn();

  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchSpy.mockReset();
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    (getPairingCredential as jest.Mock).mockResolvedValue({
      doorUrl: DOOR_URL,
      credential: CREDENTIAL,
      node: NODE,
      pairedVia: "iroh",
    });
    (openIrohTunnel as jest.Mock).mockReset();
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

  test("probe and chat turn both ride door tunnels and the bearer goes on the wire", async () => {
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
      { locale: "en", turnId: "t-iroh" },
    );

    expect(failure).toBeNull();
    expect(done).toBe(true);
    expect(deltas.join("")).toBe("ciao mondo");

    // The paired credential left the phone exactly on the iroh wire.
    // The (node, lane) pairs — the third argument is the operation's
    // signal, which equality on a patched AbortSignal cannot digest.
    expect(
      (openIrohTunnel as jest.Mock).mock.calls.map((call: unknown[]) => call.slice(0, 2)),
    ).toEqual([
      [NODE, "door"],
      [NODE, "door"],
      [NODE, "door"],
    ]);
    expect(text(propsTunnel.writes[0])).toContain("GET /props HTTP/1.1\r\n");
    expect(text(propsTunnel.writes[0])).toContain(`Authorization: Bearer ${CREDENTIAL}\r\n`);
    expect(text(chatTunnel.writes[0])).toContain("POST /v1/chat/completions HTTP/1.1\r\n");
    expect(text(chatTunnel.writes[0])).toContain(`Authorization: Bearer ${CREDENTIAL}\r\n`);
    expect(chatTunnel.writes[0].byteLength).toBeGreaterThan(0);

    // Not one byte took the HTTPS road.
    expect(fetchSpy).not.toHaveBeenCalled();
    const lines = log.mock.calls
      .filter((args) => args[0] === "KALSA_ROAD")
      .map((args) => args[1] as string);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { road: "iroh", reason: "connected", node8: NODE.slice(0, 8) },
      { road: "iroh", reason: "connected", node8: NODE.slice(0, 8) },
    ]);
    expect(lines.join("")).not.toContain(NODE);
    log.mockRestore();
  });
});
