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
import type { SavedPairingCredential } from "./pairingCredentialStore";
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
    expect(openIrohTunnel).toHaveBeenNthCalledWith(1, PAIRED.node, "door");
    // Exactly one request per tunnel: the closed firstTunnel is never replayed.
    for (const tunnel of [tunnel1, tunnel2, tunnel3]) {
      expect(tunnel.writes).toHaveLength(1);
      expect(text(tunnel.writes[0])).toContain("GET /props HTTP/1.1\r\n");
      expect(tunnel.shutdowns).toBeGreaterThan(0);
    }
  });
});
