/**
 * The door road fallback rule: HTTPS is a road only for a credential
 * whose pairing went over HTTPS (pairedVia "https") — that ceremony
 * proved the saved URL; a credential paired over iroh rides iroh only,
 * and a failed connect is a connection error, never a road switch. One
 * connect decides per operation; one KALSA_ROAD line records it.
 */

jest.mock("./irohBridge", () => ({
  irohModulePresent: jest.fn(),
  openIrohTunnel: jest.fn(),
}));

import { irohModulePresent, openIrohTunnel } from "./irohBridge";
import { doorFetchFor, establishDoorRoad } from "./doorRoad";
import type { IrohTunnel } from "./irohHttp";

const NODE = "ab".repeat(32);
const openTunnelMock = openIrohTunnel as jest.MockedFunction<typeof openIrohTunnel>;
const presentMock = irohModulePresent as jest.MockedFunction<typeof irohModulePresent>;

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

const jsonGet = (body: string) =>
  ascii(`HTTP/1.1 200 OK\r\nContent-Length: ${body.length}\r\n\r\n${body}`);

let log: jest.SpyInstance;

const roadLines = (): Array<{ road: string; reason: string; node8?: string }> =>
  log.mock.calls
    .filter((args) => args[0] === "KALSA_ROAD")
    .map((args) => JSON.parse(args[1] as string));

beforeEach(() => {
  openTunnelMock.mockReset();
  presentMock.mockReset();
  log = jest.spyOn(console, "log").mockImplementation(() => undefined);
});
afterEach(() => log.mockRestore());

describe("which credential may fall back to HTTPS", () => {
  test("a credential without a node logs one no_node line and dials nothing", async () => {
    const road = await establishDoorRoad({ node: null, pairedVia: null });

    expect(road).toEqual({ road: "https" });
    expect(presentMock).not.toHaveBeenCalled();
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([{ road: "https", reason: "no_node" }]);
  });

  test("a credential paired over HTTPS rides HTTPS while the module is absent", async () => {
    presentMock.mockReturnValue(false);

    const road = await establishDoorRoad({ node: NODE, pairedVia: "https" });

    expect(road).toEqual({ road: "https" });
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([
      { road: "https", reason: "module_absent", node8: NODE.slice(0, 8) },
    ]);
  });

  test("an iroh-paired credential with no module has no road: connection error, no dial", async () => {
    presentMock.mockReturnValue(false);

    await expect(establishDoorRoad({ node: NODE, pairedVia: "iroh" })).rejects.toThrow(
      "remote_brain_network",
    );
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([
      { road: "iroh", reason: "module_absent", node8: NODE.slice(0, 8) },
    ]);
  });

  test("a credential whose pairing road is unknown never falls back either", async () => {
    presentMock.mockReturnValue(true);
    openTunnelMock.mockRejectedValue(new Error("dial refused"));

    await expect(establishDoorRoad({ node: NODE, pairedVia: null })).rejects.toThrow(
      "remote_brain_network",
    );
    expect(roadLines()).toEqual([]);
  });

  test("a failed connect falls back for a credential paired over HTTPS", async () => {
    presentMock.mockReturnValue(true);
    openTunnelMock.mockRejectedValue(new Error("dial refused"));

    const road = await establishDoorRoad({ node: NODE, pairedVia: "https" });

    expect(road).toEqual({ road: "https" });
    expect(roadLines()).toEqual([]);
  });

  test("a failed connect for an iroh-paired credential is a connection error, logged as one iroh line", async () => {
    presentMock.mockReturnValue(true);
    openTunnelMock.mockRejectedValue(new Error("dial refused"));

    await expect(establishDoorRoad({ node: NODE, pairedVia: "iroh" })).rejects.toThrow(
      "remote_brain_network",
    );
    expect(roadLines()).toEqual([]);
  });
});

describe("establishing the road", () => {
  test("a successful connect is the iroh road, logged once with only the node's first 8 hex", async () => {
    presentMock.mockReturnValue(true);
    const tunnel = new FakeTunnel([]);
    openTunnelMock.mockResolvedValue(tunnel);

    const road = await establishDoorRoad({ node: NODE, pairedVia: "iroh" });

    expect(road.road).toBe("iroh");
    if (road.road !== "iroh") throw new Error("unreachable");
    expect(road.node).toBe(NODE);
    expect(road.firstTunnel).toBe(tunnel);
    expect(openTunnelMock).toHaveBeenCalledWith(NODE, "door");
    expect(await road.openTunnel()).toBe(tunnel);
    expect(roadLines()).toEqual([]);
  });

  test("an already-aborted signal never dials and logs no road", async () => {
    presentMock.mockReturnValue(true);
    const controller = new AbortController();
    controller.abort();

    const error = await establishDoorRoad(
      { node: NODE, pairedVia: "iroh" },
      controller.signal,
    ).catch((caught: Error & { code?: string }) => caught);

    expect((error as { code?: string }).code).toBe("interrupted");
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([]);
  });

  test("a signal aborted during the dial shuts the fresh tunnel down and rides nothing", async () => {
    presentMock.mockReturnValue(true);
    const controller = new AbortController();
    const tunnel = new FakeTunnel([]);
    openTunnelMock.mockImplementation(async () => {
      controller.abort();
      return tunnel;
    });

    const error = await establishDoorRoad(
      { node: NODE, pairedVia: "iroh" },
      controller.signal,
    ).catch((caught: Error & { code?: string }) => caught);

    expect((error as { code?: string }).code).toBe("interrupted");
    expect(tunnel.shutdowns).toBeGreaterThan(0);
    expect(roadLines()).toEqual([]);
  });
});

describe("the probe fetcher on each road", () => {
  test("the first request rides the establishment tunnel, later ones open their own", async () => {
    presentMock.mockReturnValue(true);
    const first = new FakeTunnel([jsonGet("{}")]);
    const second = new FakeTunnel([jsonGet('{"data":[]}')]);
    openTunnelMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const road = await establishDoorRoad({ node: NODE, pairedVia: "iroh" });
    const fetcher = doorFetchFor(road);
    const headers = { Accept: "application/json", Authorization: "Bearer abab" };

    const props = await fetcher("https://desktop.example:9443/props", { method: "GET", headers });
    expect(props.ok).toBe(true);
    await expect(props.json()).resolves.toEqual({});
    expect(text(first.writes[0])).toContain("GET /props HTTP/1.1\r\n");
    expect(text(first.writes[0])).toContain("Authorization: Bearer abab\r\n");

    const models = await fetcher("https://desktop.example:9443/v1/models", {
      method: "GET",
      headers,
    });
    await expect(models.json()).resolves.toEqual({ data: [] });
    expect(openTunnelMock).toHaveBeenLastCalledWith(NODE, "door");
    expect(text(second.writes[0])).toContain("GET /v1/models HTTP/1.1\r\n");
    // One request per tunnel: both are drained and closed, never reused.
    expect(first.shutdowns).toBeGreaterThan(0);
    expect(second.shutdowns).toBeGreaterThan(0);
  });

  test("the https road keeps using the global fetch, under the door-fetch shape", async () => {
    const original = globalThis.fetch;
    const fetchSpy = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ saved: true }),
      text: async () => "",
    }));
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const response = await doorFetchFor({ road: "https" })("https://desktop.example/props", {
        method: "GET",
        headers: {},
      });
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(response).toMatchObject({ ok: true, status: 200 });
      await expect(response.json()).resolves.toEqual({ saved: true });
      await expect(response.isBodyEmpty()).resolves.toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
