/**
 * The doorless room call with the REAL road: no mock between the base
 * verdict and the dial, so the record `{doorUrl: "", pairedVia: "iroh"}`
 * is proven to name the stand-in origin and ride the tunnel it dials in
 * one piece — and the two corrupted doorless shapes (a https-paired
 * record with no URL, a node-less record still marked iroh) fail closed
 * before anything dials or fetches.
 */

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));
jest.mock("../engine/remote/remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(async () => null),
}));
jest.mock("../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(),
  getPairing: jest.fn(),
  bindPairingRoom: jest.fn(),
  markPairingRemoved: jest.fn(),
}));
jest.mock("../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => true),
  openIrohTunnel: jest.fn(),
}));

import { irohModulePresent, openIrohTunnel } from "../remote/irohBridge";
import { getPairingCredential } from "../pairing/pairingCredentialStore";
import infoFixture from "./fixtures/info.json";
import { resetRoomEpochs } from "./roomEpochs";
import { IROH_MISSING_MESSAGE } from "./roomError";
import { fetchRoomInfo } from "./roomApi";
import type { IrohTunnel } from "../remote/irohHttp";
import { IROH_TUNNEL_URL } from "../pairing/pairingUrls";

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

const activeRecord = (overrides: Partial<{ doorUrl: string; node: string | null; pairedVia: string | null }>) => ({
  doorUrl: "",
  credential: CREDENTIAL,
  node: NODE,
  pairedVia: "iroh",
  ...overrides,
});

const originalFetch = globalThis.fetch;
let fetchSpy: jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  (irohModulePresent as jest.Mock).mockReturnValue(true);
  resetRoomEpochs();
  fetchSpy = jest.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test("a doorless record dials the node its base verdict names: one tunnel, no network", async () => {
  (getPairingCredential as jest.Mock).mockResolvedValue(activeRecord({}));
  const tunnel = new FakeTunnel([
    ascii(`HTTP/1.1 200 OK\r\nContent-Length: ${JSON.stringify(infoFixture).length}\r\n\r\n${JSON.stringify(infoFixture)}`),
  ]);
  (openIrohTunnel as jest.Mock).mockResolvedValueOnce(tunnel);

  const result = await fetchRoomInfo();

  // The road and the base were decided together, from the same record.
  expect(result).toMatchObject({ ok: true, value: { roomName: "This computer" } });
  expect(openIrohTunnel).toHaveBeenCalledTimes(1);
  expect(openIrohTunnel).toHaveBeenCalledWith(NODE, "door");
  const request = text(tunnel.writes[0]);
  expect(request).toContain("GET /kalsa/room/info HTTP/1.1\r\n");
  expect(request).toContain(`Host: ${new URL(IROH_TUNNEL_URL).host}\r\n`);
  expect(request).toContain(`Authorization: Bearer ${CREDENTIAL}\r\n`);
  expect(fetchSpy).not.toHaveBeenCalled();
});

test.each([
  ["a doorless https-paired record", { pairedVia: "https" }],
  ["a doorless record whose node is gone", { node: null }],
])("%s fails closed before the road or the network", async (_name, overrides) => {
  (getPairingCredential as jest.Mock).mockResolvedValue(activeRecord(overrides));

  await expect(fetchRoomInfo()).resolves.toEqual({
    ok: false,
    error: { code: "door_unusable", message: IROH_MISSING_MESSAGE },
  });
  expect(openIrohTunnel).not.toHaveBeenCalled();
  expect(fetchSpy).not.toHaveBeenCalled();
});
