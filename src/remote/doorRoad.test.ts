/**
 * The door road fallback rule: iroh only when a paired node meets a
 * present module, one connect decides the road before any request byte,
 * and a failed connect becomes exactly one HTTPS KALSA_ROAD line — never
 * a mid-request switch.
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

describe("establishing the door road", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    openTunnelMock.mockReset();
    presentMock.mockReset();
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  const roadLines = (): Array<{ road: string; reason: string; node8?: string }> =>
    log.mock.calls
      .filter((args) => args[0] === "KALSA_ROAD")
      .map((args) => JSON.parse(args[1] as string));

  test("a credential without a node logs one no_node line and dials nothing", async () => {
    const road = await establishDoorRoad(null);

    expect(road).toEqual({ road: "https" });
    expect(presentMock).not.toHaveBeenCalled();
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([{ road: "https", reason: "no_node" }]);
  });

  test("a paired node on a build without the module logs module_absent and dials nothing", async () => {
    presentMock.mockReturnValue(false);

    const road = await establishDoorRoad(NODE);

    expect(road).toEqual({ road: "https" });
    expect(openTunnelMock).not.toHaveBeenCalled();
    expect(roadLines()).toEqual([
      { road: "https", reason: "module_absent", node8: NODE.slice(0, 8) },
    ]);
  });

  test("a successful connect is the iroh road, logged once with only the node's first 8 hex", async () => {
    presentMock.mockReturnValue(true);
    const tunnel = new FakeTunnel([]);
    openTunnelMock.mockResolvedValue(tunnel);

    const road = await establishDoorRoad(NODE);

    expect(road.road).toBe("iroh");
    if (road.road !== "iroh") throw new Error("unreachable");
    expect(road.node).toBe(NODE);
    expect(road.firstTunnel).toBe(tunnel);
    expect(openTunnelMock).toHaveBeenCalledWith(NODE, "door");
    expect(await road.openTunnel()).toBe(tunnel);
    const lines = roadLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({ road: "iroh", reason: "connected", node8: NODE.slice(0, 8) });
    expect(JSON.stringify(lines[0])).not.toContain(NODE);
  });

  test("a failed connect falls back to one https line — the road rule in one log", async () => {
    presentMock.mockReturnValue(true);
    openTunnelMock.mockRejectedValue(new Error("dial refused"));

    const road = await establishDoorRoad(NODE);

    expect(road).toEqual({ road: "https" });
    const lines = roadLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      road: "https",
      reason: "connect_failed",
      node8: NODE.slice(0, 8),
    });
    expect(JSON.stringify(lines[0])).not.toContain(NODE);
  });
});

describe("the probe fetcher on each road", () => {
  beforeEach(() => {
    openTunnelMock.mockReset();
    presentMock.mockReset();
    jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  test("the first request rides the establishment tunnel, later ones open their own", async () => {
    presentMock.mockReturnValue(true);
    const first = new FakeTunnel([jsonGet("{}")]);
    const second = new FakeTunnel([jsonGet('{"data":[]}')]);
    openTunnelMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const road = await establishDoorRoad(NODE);
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

  test("the https road keeps using the global fetch, untouched", () => {
    expect(doorFetchFor({ road: "https" })).toBe(globalThis.fetch);
  });
});
