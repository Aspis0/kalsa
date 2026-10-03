/**
 * The confirmation poll over the iroh road with FAKE TUNNELS: the P1 the
 * audit caught — a per-tick DoorFetch replaying the road's already-closed
 * firstTunnel would fail every tick after the first 401 and the owner's
 * Allow could never be seen. One fetcher per poll, one request per
 * tunnel, 401, 401, 200 → paired.
 */

jest.mock("../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => true),
  openIrohTunnel: jest.fn(),
}));

import { openIrohTunnel } from "../remote/irohBridge";
import type { IrohTunnel } from "../remote/irohHttp";
import type { SavedPairingCredential } from "./pairingRecord";
import { pairedPropsProbe, pollForAllowance } from "./pairingConfirmation";

const PAIRED: SavedPairingCredential = {
  credential: "ab".repeat(32),
  doorUrl: "https://desktop.tailnet.ts.net:9443",
  node: "cd".repeat(32),
  pairedVia: "iroh",
};

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

/** One canned response per read; an exhausted queue is EOF (tunnel closed). */
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

const response = (statusLine: string, body: string) =>
  ascii(`HTTP/1.1 ${statusLine}\r\nContent-Length: ${body.length}\r\n\r\n${body}`);

describe("the confirmation poll over the iroh road", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    (openIrohTunnel as jest.Mock).mockReset();
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  test("an iroh-only pairing with no saved door address still probes /props with the bearer", async () => {
    const tunnel = new FakeTunnel([response("200 OK", "{}")]);
    (openIrohTunnel as jest.Mock).mockResolvedValueOnce(tunnel);

    const outcome = pollForAllowance({
      probe: pairedPropsProbe({ ...PAIRED, doorUrl: "" }),
      intervalMs: 1,
      deadlineMs: 60_000,
      perProbeTimeoutMs: 10_000,
      unreachableAfter: 3,
    });

    expect(await outcome).toEqual({ result: "paired" });
    expect(tunnel.writes).toHaveLength(1);
    const request = text(tunnel.writes[0]);
    expect(request).toContain("GET /props HTTP/1.1\r\n");
    expect(request).toContain("Host: iroh.kalsa.invalid\r\n");
    expect(request).toContain(`Authorization: Bearer ${PAIRED.credential}\r\n`);
  });

  test("401, 401, 200 → paired: every tick rides its own fresh tunnel, never a closed one", async () => {
    const tunnel1 = new FakeTunnel([response("401 Unauthorized", "")]);
    const tunnel2 = new FakeTunnel([response("401 Unauthorized", "")]);
    const tunnel3 = new FakeTunnel([response("200 OK", "{}")]);
    (openIrohTunnel as jest.Mock)
      .mockResolvedValueOnce(tunnel1)
      .mockResolvedValueOnce(tunnel2)
      .mockResolvedValueOnce(tunnel3);

    const outcome = pollForAllowance({
      probe: pairedPropsProbe(PAIRED),
      intervalMs: 1,
      deadlineMs: 60_000,
      perProbeTimeoutMs: 10_000,
      unreachableAfter: 3,
    });

    expect(await outcome).toEqual({ result: "paired" });
    // One establishment dial plus one fresh tunnel per later tick.
    expect(openIrohTunnel).toHaveBeenCalledTimes(3);
    expect(openIrohTunnel).toHaveBeenNthCalledWith(1, PAIRED.node, "door", expect.any(AbortSignal));
    // Exactly one request per tunnel: the closed firstTunnel is never replayed.
    for (const tunnel of [tunnel1, tunnel2, tunnel3]) {
      expect(tunnel.writes).toHaveLength(1);
      expect(text(tunnel.writes[0])).toContain("GET /props HTTP/1.1\r\n");
      expect(tunnel.shutdowns).toBeGreaterThan(0);
    }
  });
});

describe("the dial race carries the poll's deadline", () => {
  let log: jest.SpyInstance;

  beforeEach(() => {
    (openIrohTunnel as jest.Mock).mockReset();
    log = jest.spyOn(console, "log").mockImplementation(() => undefined);
  });
  afterEach(() => log.mockRestore());

  test("the deadline ends the poll mid-iroh-dial, with no connect_failed verdict", async () => {
    // The mocked bridge honours its signal exactly like the real one does.
    (openIrohTunnel as jest.Mock).mockImplementation(
      (_node: string, _lane: string, signal?: AbortSignal) =>
        new Promise<number>((_resolve, reject) => {
          if (signal?.aborted === true) reject(new Error("dial aborted"));
          else signal?.addEventListener("abort", () => reject(new Error("dial aborted")));
        }),
    );

    const outcome = pollForAllowance({
      probe: pairedPropsProbe(PAIRED),
      intervalMs: 1,
      deadlineMs: 25,
      // Larger than the deadline: only the deadline may end this dial.
      perProbeTimeoutMs: 60_000,
      unreachableAfter: 3,
    });

    expect(await outcome).toEqual({ result: "not_confirmed" });
    // An aborted dial is the operation ending, never a road verdict.
    const roadLines = log.mock.calls.filter((call) => call[0] === "KALSA_ROAD");
    expect(roadLines).toHaveLength(0);
  });
});
