/**
 * The fallback rule on the wire, through RemoteEngine: a credential
 * paired over HTTPS falls back to the paired URL — chat request URL and
 * bearer asserted — while a credential paired over iroh never sends a
 * byte over HTTPS: a dead dial surfaces like any unreachable desk.
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

import {
  disposeRemoteEngine,
  initRemoteEngine,
  streamRemoteAssistantTurn,
  testRemoteConnection,
} from "./RemoteEngine";
import { irohModulePresent, openIrohTunnel } from "../../remote/irohBridge";
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

function jsonResponse(body: string): Uint8Array {
  return ascii(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);
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

type XhrWire = { method: string; url: string; headers: Array<[string, string]> };

/** The XHR the transport creates when no factory is given — the HTTPS road. */
class FakeXhr {
  static sent: XhrWire[] = [];
  readyState = 0;
  status = 0;
  responseText = "";
  timeout = 0;
  onreadystatechange: (() => void) | null = null;
  onprogress: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private wire: XhrWire = { method: "", url: "", headers: [] };

  open(method: string, url: string): void {
    this.wire = { method, url, headers: [] };
  }

  setRequestHeader(name: string, value: string): void {
    this.wire.headers.push([name, value]);
  }

  send(_body?: string): void {
    FakeXhr.sent.push(this.wire);
    queueMicrotask(() => {
      this.status = 200;
      this.responseText = 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n';
      this.readyState = 2;
      this.onreadystatechange?.();
      this.readyState = 4;
      this.onreadystatechange?.();
    });
  }

  abort(): void {
    // The transport aborts after its terminal finish; nothing is in flight.
  }
}

const fetchSpy = jest.fn();
let log: jest.SpyInstance;

const roadLines = () =>
  log.mock.calls
    .filter((args) => args[0] === "KALSA_ROAD")
    .map((args) => JSON.parse(args[1] as string) as { road: string; reason: string });

describe("the door road fallback through RemoteEngine", () => {
  const hadFetch = "fetch" in globalThis;
  const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
  const hadXhr = "XMLHttpRequest" in globalThis;
  const originalXhr = (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;

  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchSpy.mockReset();
    FakeXhr.sent = [];
    (globalThis as { fetch: typeof fetch }).fetch = fetchSpy as unknown as typeof fetch;
    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = FakeXhr;
    (irohModulePresent as jest.Mock).mockReturnValue(true);
    (openIrohTunnel as jest.Mock).mockReset();
    await setRemoteServerModelId("ornith");
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await disposeRemoteEngine();
    log.mockRestore();
    if (hadFetch) {
      (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    } else {
      delete (globalThis as { fetch?: typeof fetch }).fetch;
    }
    if (hadXhr) {
      (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = originalXhr;
    } else {
      delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
    }
  });

  function pairWith(pairedVia: "iroh" | "https") {
    (getPairingCredential as jest.Mock).mockResolvedValue({
      doorUrl: DOOR_URL,
      credential: CREDENTIAL,
      node: NODE,
      pairedVia,
    });
  }

  test("an HTTPS-paired credential falls back: chat rides the paired URL with its bearer", async () => {
    pairWith("https");
    (openIrohTunnel as jest.Mock).mockRejectedValue(new Error("dial refused"));
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ornith" }] }),
    });

    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });

    // The probe fell back to the paired URL, bearer included.
    expect(fetchSpy.mock.calls[0][0]).toBe(`${DOOR_URL}/props`);
    const probeHeaders = fetchSpy.mock.calls[0][1] as RequestInit;
    expect((probeHeaders.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${CREDENTIAL}`,
    );

    const errors: string[] = [];
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          done = true;
        },
        onError: (error) => {
          errors.push(error.message);
        },
      },
      undefined,
      { locale: "en", turnId: "t-fallback" },
    );

    expect(errors).toEqual([]);
    expect(done).toBe(true);
    expect(FakeXhr.sent).toHaveLength(1);
    const wire = FakeXhr.sent[0];
    expect(wire.method).toBe("POST");
    expect(wire.url).toBe(`${DOOR_URL}/v1/chat/completions`);
    expect(wire.headers).toContainEqual(["Authorization", `Bearer ${CREDENTIAL}`]);
    // One connect attempt per operation, then the paired URL each time. The
    // fallback is silent at engine level: the road line belongs to the
    // native dial bridge (mocked out here).
    expect(openTunnelMockCalls()).toEqual([
      [NODE, "door"],
      [NODE, "door"],
    ]);
    expect(roadLines()).toEqual([]);
  });

  test("an iroh-paired credential never sends its bearer over HTTPS when the dial fails", async () => {
    pairWith("iroh");
    (openIrohTunnel as jest.Mock).mockRejectedValue(new Error("dial refused"));

    const probe = await testRemoteConnection();

    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("remote_brain_network");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(FakeXhr.sent).toHaveLength(0);
    // The refusal is silent at engine level too — and not one HTTPS byte
    // carried the bearer.
    expect(roadLines()).toEqual([]);
  });

  test("a dial that dies after a successful probe fails the turn like an unreachable desk", async () => {
    pairWith("iroh");
    // Probe: props + models on two fresh tunnels; the turn's dial then dies.
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse("{}")]))
      .mockResolvedValueOnce(new FakeTunnel([jsonResponse('{"data":[{"id":"ornith"}]}')]))
      .mockRejectedValueOnce(new Error("dial refused"));

    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    expect(fetchSpy).not.toHaveBeenCalled();

    const errors: string[] = [];
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          done = true;
        },
        onError: (error) => {
          errors.push(error.message);
        },
      },
      undefined,
      { locale: "en", turnId: "t-dead-dial" },
    );

    expect(errors).toEqual(["remote_brain_network"]);
    expect(done).toBe(false);
    // No HTTPS byte anywhere: not the probe, not the failed turn. The dial
    // outcomes ride the bridge's own road lines, none at engine level.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(FakeXhr.sent).toHaveLength(0);
    expect(roadLines()).toEqual([]);
  });
});

function openTunnelMockCalls(): unknown[][] {
  // (node, lane) pairs only: the signal rides as the third argument and a
  // patched AbortSignal cannot go through jest's deep equality.
  return ((openIrohTunnel as jest.Mock).mock.calls as unknown[][]).map((call) =>
    call.slice(0, 2),
  );
}
