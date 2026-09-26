/**
 * The pairing ceremony over the iroh desk lane: claim and complete ride
 * one fake tunnel each with the byte-exact HTTPS wire, and a tunnel that
 * refuses to open maps into the two existing network stages — no new
 * stage name appears.
 */

jest.mock("../remote/irohBridge", () => ({ openIrohTunnel: jest.fn() }));

import { openIrohTunnel } from "../remote/irohBridge";
import type { IrohTunnel } from "../remote/irohHttp";
import { createDeskPairingFetch } from "./pairingDeskFetch";
import { PairingSession } from "./pairingTransport";
import type { PairingPhoneDeclaration } from "./pairingWire";

const NODE = "cd".repeat(32);
const square = {
  reachable: "http://127.0.0.1:8132",
  code: "41".repeat(16),
  nonce: "42".repeat(32),
  node: NODE,
};
const phone: PairingPhoneDeclaration = {
  weights_bytes: 2_200_000_000,
  parameters: null,
  measured_tokens_per_second: null,
  battery_powered: true,
};
const seal = {
  credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
  mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
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

function httpResponse(statusLine: string, body: string): Uint8Array {
  const bodyBytes = ascii(body);
  return ascii(`HTTP/1.1 ${statusLine}\r\nContent-Length: ${bodyBytes.length}\r\n\r\n${body}`);
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

const openTunnelMock = openIrohTunnel as jest.MockedFunction<typeof openIrohTunnel>;

function consoleLogSpy(): jest.SpyInstance {
  return jest.spyOn(console, "log").mockImplementation(() => undefined);
}

function failingStages(log: jest.SpyInstance): string[] {
  return log.mock.calls
    .filter((args) => args[0] === "KALSA_PAIRING_FAIL")
    .map((args) => (JSON.parse(args[1] as string) as { stage: string }).stage);
}

function newSession(): PairingSession {
  return new PairingSession({
    deskUrl: "https://desktop.example:8443",
    square,
    phone,
    fetcher: createDeskPairingFetch(NODE),
    randomBytes: () => new Uint8Array(16).fill(0xc0),
  });
}

describe("pairing over the desk lane", () => {
  beforeEach(() => openTunnelMock.mockReset());

  test("claim and complete ride desk tunnels carrying the byte-exact HTTPS wire", async () => {
    const claimTunnel = new FakeTunnel([httpResponse("200 OK", "")]);
    const completeTunnel = new FakeTunnel([httpResponse("200 OK", JSON.stringify(seal))]);
    openTunnelMock
      .mockResolvedValueOnce(claimTunnel)
      .mockResolvedValueOnce(completeTunnel);

    const credential = await newSession().begin();

    expect(credential).toEqual(new Uint8Array(32).fill(0xab));
    expect(openTunnelMock).toHaveBeenCalledTimes(2);
    expect(openTunnelMock).toHaveBeenNthCalledWith(1, NODE, "desk");
    expect(openTunnelMock).toHaveBeenNthCalledWith(2, NODE, "desk");

    const claimBody = `{"code":"${square.code}"}`;
    const claimHead =
      "POST /pair/claim HTTP/1.1\r\n" +
      "Host: desktop.example:8443\r\n" +
      "Content-Type: application/json\r\n" +
      "Connection: close\r\n" +
      `Content-Length: ${claimBody.length}\r\n\r\n`;
    expect(text(claimTunnel.writes[0])).toBe(claimHead + claimBody);
    expect(claimTunnel.shutdowns).toBeGreaterThan(0);

    const complete = text(completeTunnel.writes[0]);
    expect(complete.startsWith("POST /pair/complete HTTP/1.1\r\n")).toBe(true);
    expect(complete).toContain("Host: desktop.example:8443\r\n");
    expect(complete).toContain(`"delivery_token":"${"c0".repeat(16)}"`);
    expect(complete).toContain('"battery_powered":true');
    expect(completeTunnel.shutdowns).toBeGreaterThan(0);
  });

  test("a desk tunnel that refuses to open fails the claim at claim_network", async () => {
    const log = consoleLogSpy();
    openTunnelMock.mockRejectedValue(new Error("dial refused"));

    await expect(newSession().begin()).resolves.toBeNull();

    expect(failingStages(log)).toEqual(["claim_network"]);
    log.mockRestore();
  });

  test("a tunnel dying between claim and complete lands in complete_network and stays retryable", async () => {
    const log = consoleLogSpy();
    const claimTunnel = new FakeTunnel([httpResponse("200 OK", "")]);
    openTunnelMock.mockResolvedValueOnce(claimTunnel).mockRejectedValueOnce(new Error("dial refused"));
    const session = newSession();

    await expect(session.begin()).resolves.toBeNull();

    expect(failingStages(log)).toEqual(["complete_network"]);
    expect(session.needsCompletionRetry()).toBe(true);
    log.mockRestore();
  });
});
