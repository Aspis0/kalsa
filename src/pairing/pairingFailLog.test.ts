jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => mockGetRandomBytes(length),
}));

// jest.mock factories may only close over "mock"-prefixed bindings; the lazy
// require in secureRandomBytes resolves to this at call time.
let mockGetRandomBytes: (length: number) => Uint8Array = () => {
  throw new Error("mockGetRandomBytes not configured for this test");
};

import {
  PairingSession,
  type PairingFetch,
  type PairingResponse,
} from "./pairingTransport";
import type { PairingPhoneDeclaration } from "./pairingWire";

const square = {
  reachable: "http://127.0.0.1:8132",
  code: "41".repeat(16),
  nonce: "42".repeat(32),
  node: "",
};
const phone: PairingPhoneDeclaration = {
  weights_bytes: 2_200_000_000,
  parameters: { total: 7_600_000_000, active: 2_400_000_000 },
  measured_tokens_per_second: 9.5,
  battery_powered: true,
};
const seal = {
  credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
  mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
};
const response = (status: number, value: unknown = {}) => ({
  status,
  json: async () => value,
}) satisfies PairingResponse;
const random = (fill: number) => (_length: number) => new Uint8Array(16).fill(fill);

const failRecords = (log: jest.SpyInstance): Array<{ stage: string; status: number | null }> =>
  log.mock.calls
    .filter((call) => call[0] === "KALSA_PAIRING_FAIL")
    .map((call) => JSON.parse(String(call[1])));

afterEach(() => {
  jest.restoreAllMocks();
});

describe("pairing failure stages", () => {
  test("an unavailable random source logs stage random before refusing", () => {
    mockGetRandomBytes = () => {
      throw new Error("no CSPRNG in this runtime");
    };
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    expect(
      () => new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone }),
    ).toThrow("secure random source unavailable");
    expect(failRecords(log)).toEqual([{ stage: "random", status: null }]);
  });

  test("with no injected source the delivery token comes from expo-crypto", async () => {
    mockGetRandomBytes = (length) => new Uint8Array(length).fill(0x0a);
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const bodies: string[] = [];
    const fetcher: PairingFetch = async (_url, init) => {
      bodies.push(init.body);
      return response(200, seal);
    };
    const session = new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher });
    await expect(session.begin()).resolves.toEqual(new Uint8Array(32).fill(0xab));
    expect(bodies.some((body) => body.includes(`"delivery_token":"${"0a".repeat(16)}"`))).toBe(true);
    expect(failRecords(log)).toEqual([]);
  });

  test("a square that fails validation logs stage validate and never dials", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = jest.fn();
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square: { ...square, code: `${"41".repeat(15)}zz` },
      phone,
      fetcher: fetcher as unknown as PairingFetch,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(failRecords(log)).toEqual([{ stage: "validate", status: null }]);
  });

  test("an unusable desk address logs stage claim_url and never dials", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher = jest.fn();
    const session = new PairingSession({
      deskUrl: "not a url",
      square,
      phone,
      fetcher: fetcher as unknown as PairingFetch,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
    expect(failRecords(log)).toEqual([{ stage: "claim_url", status: null }]);
  });

  test("a claim fetch that throws logs stage claim_network", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async () => {
      throw new Error("airplane mode");
    };
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(false);
    expect(failRecords(log)).toEqual([{ stage: "claim_network", status: null }]);
  });

  test.each([403, 500])("a claim %i logs stage claim_status with that status", async (status) => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async () => response(status, "");
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(failRecords(log)).toEqual([{ stage: "claim_status", status }]);
  });

  test("a lost complete response logs stage complete_network and keeps the retry", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async (url) => {
      if (url.endsWith("/pair/claim")) return response(200);
      throw new Error("response lost");
    };
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(true);
    expect(failRecords(log)).toEqual([{ stage: "complete_network", status: null }]);
  });

  test("a complete refusal logs stage complete_status with that status", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async (url) =>
      url.endsWith("/pair/claim") ? response(200) : response(403, "");
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(false);
    expect(failRecords(log)).toEqual([{ stage: "complete_status", status: 403 }]);
  });

  test.each([
    ["a body that is not a seal", response(200, { unexpected: true })],
    ["a body that fails to parse", { status: 200, json: async () => { throw new Error("bad json"); } }],
    [
      "a seal that fails to open",
      response(200, { credential_ciphertext: seal.credential_ciphertext, mac: "00".repeat(32) }),
    ],
  ])("%s logs stage seal against the 200", async (_name, completeResponse) => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async (url) =>
      url.endsWith("/pair/claim") ? response(200) : completeResponse;
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(false);
    expect(failRecords(log)).toEqual([{ stage: "seal", status: 200 }]);
  });

  test("the failure line carries only stage and status, never wire material", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const fetcher: PairingFetch = async () => response(403, "");
    const session = new PairingSession({
      deskUrl: "http://127.0.0.1:8443",
      square: { ...square, reachable: "http://192.168.1.50:4952" },
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });
    await expect(session.begin()).resolves.toBeNull();
    const raw = log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
    expect(raw).toContain("KALSA_PAIRING_FAIL");
    expect(raw).not.toContain(square.code);
    expect(raw).not.toContain(square.nonce);
    expect(raw).not.toContain("c0".repeat(16));
    expect(raw).not.toContain("127.0.0.1");
    expect(raw).not.toContain("192.168.1.50");
    expect(failRecords(log)).toEqual([{ stage: "claim_status", status: 403 }]);
  });
});
