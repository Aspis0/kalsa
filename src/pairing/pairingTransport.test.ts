import { bytesToHex, sha256 } from "./sha256";
import {
  PairingSession,
  postPairingJson,
  type PairingFetch,
  type PairingResponse,
} from "./pairingTransport";
import type { PairingPhoneDeclaration } from "./pairingWire";
import { phoneMacPayload } from "./pairingWire";

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

describe("PairingSession delivery-token lifecycle", () => {
  test("a lost complete response retries complete with the same token and only one claim", async () => {
    const requests: Array<{ url: string; init: Parameters<PairingFetch>[1] }> = [];
    let completeCount = 0;
    const fetcher: PairingFetch = async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/pair/claim")) return response(200);
      completeCount += 1;
      if (completeCount === 1) throw new Error("response lost");
      return response(200, seal);
    };
    const session = new PairingSession({
      deskUrl: "https://computer.example:8443/ignored",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
    });

    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(true);
    await expect(session.retryComplete()).resolves.toEqual(new Uint8Array(32).fill(0xab));
    expect(session.needsCompletionRetry()).toBe(false);
    expect(requests.map(({ url }) => url)).toEqual([
      "https://computer.example:8443/pair/claim",
      "https://computer.example:8443/pair/complete",
      "https://computer.example:8443/pair/complete",
    ]);
    expect(requests[0].init.body).toBe('{"code":"' + square.code + '"}');
    expect(requests[1].init.body).toBe(requests[2].init.body);
    expect(requests[1].init.body).toContain(`"delivery_token":"${"c0".repeat(16)}"`);
    expect(requests[1].init.headers).toEqual({
      "Content-Type": "application/json",
      Connection: "close",
      "Content-Length": String(new TextEncoder().encode(requests[1].init.body).byteLength),
    });
    expect(requests[1].init.body).toContain(
      '"phone":{"weights_bytes":2200000000,"parameters":{"total":7600000000,"active":2400000000},"measured_tokens_per_second":9.5,"battery_powered":true}',
    );
  });

  test("a refused retry after a lost response records the fresh-square recovery", async () => {
    let completeCount = 0;
    const diagnostics: unknown[] = [];
    const fetcher: PairingFetch = async (url) => {
      if (url.endsWith("/pair/claim")) return response(200);
      completeCount += 1;
      if (completeCount === 1) throw new Error("response lost");
      return response(403, "");
    };
    const session = new PairingSession({
      deskUrl: "https://computer.example:8443",
      square,
      phone,
      fetcher,
      randomBytes: random(0xc0),
      onDiagnostic: (record) => diagnostics.push(record),
    });

    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(true);
    await expect(session.retryComplete()).resolves.toBeNull();
    expect(diagnostics[diagnostics.length - 1]).toEqual({
      event: "pairing.retry_refused_after_timeout",
      diagnosis: "desk_may_have_spent_delivery_after_lost_response",
      recovery: "request_fresh_square",
    });
    expect(session.needsCompletionRetry()).toBe(false);
  });

  test("a received 200 ends the ceremony and a fresh refusal starts with a new token", async () => {
    const requestBodies: string[] = [];
    let completeCount = 0;
    const fetcher: PairingFetch = async (_url, init) => {
      requestBodies.push(init.body);
      if (init.body.includes('"code"')) return response(200);
      completeCount += 1;
      return completeCount === 1 ? response(200, seal) : response(403, "");
    };
    const first = new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher, randomBytes: random(0xc0) });
    await expect(first.begin()).resolves.toEqual(new Uint8Array(32).fill(0xab));
    await expect(first.retryComplete()).resolves.toBeNull();
    expect(requestBodies).toHaveLength(2);

    const refused = new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher, randomBytes: random(0xc0) });
    await expect(refused.begin()).resolves.toBeNull();
    expect(refused.needsCompletionRetry()).toBe(false);
    const fresh = new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher, randomBytes: random(0x01) });
    await expect(fresh.begin()).resolves.toBeNull();
    const completeBodies = requestBodies.filter((body) => body.includes("delivery_token"));
    expect(completeBodies).toHaveLength(3);
    expect(completeBodies.map((body) => body.match(/"delivery_token":"([0-9a-f]+)"/)?.[1])).toEqual([
      "c0".repeat(16),
      "c0".repeat(16),
      "01".repeat(16),
    ]);
  });

  test("random bytes become exactly 16 lowercase hex bytes once per session", () => {
    const randomBytes = jest.fn(random(0x0a));
    new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher: jest.fn(), randomBytes });
    expect(randomBytes).toHaveBeenCalledTimes(1);
    expect(randomBytes).toHaveBeenCalledWith(16);
    expect(bytesToHex(randomBytes.mock.results[0].value)).toBe("0a".repeat(16));
  });

  test("optional diagnostics include signed wire bytes and only a credential fingerprint", async () => {
    const diagnostics: unknown[] = [];
    const bodies: string[] = [];
    const fetcher: PairingFetch = async (url, init) => {
      bodies.push(init.body);
      return url.endsWith("/pair/claim") ? response(200) : response(200, seal);
    };
    const session = new PairingSession({
      deskUrl: "https://computer.example:8443",
      square: { ...square, reachable: "http://127.0.0.1:8132" },
      phone,
      fetcher,
      randomBytes: random(0xc0),
      onDiagnostic: (record) => diagnostics.push(record),
    });
    const credential = await session.begin();

    expect(credential).toEqual(new Uint8Array(32).fill(0xab));
    expect(diagnostics).toHaveLength(2);
    expect(diagnostics[0]).toMatchObject({
      event: "pairing.signed_request",
      delivery_token_hex: "c0".repeat(16),
    });
    const signedRequest = diagnostics[0] as {
      payload_hex: string;
      mac_hex: string;
    };
    expect(signedRequest.payload_hex).toBe(bytesToHex(phoneMacPayload({
      reachable: "http://127.0.0.1:8132",
      node: "",
      deliveryToken: "c0".repeat(16),
      phone,
    })));
    expect(signedRequest.mac_hex).toBe((JSON.parse(bodies[1]) as { mac: string }).mac);
    expect(diagnostics[1]).toEqual({
      event: "pairing.sealed_response",
      ciphertext_hex: seal.credential_ciphertext,
      credential_sha256_hex: bytesToHex(sha256(new Uint8Array(32).fill(0xab))),
    });
    expect(JSON.stringify(diagnostics)).not.toContain("ab".repeat(32));
  });
});

describe("pairing request boundary", () => {
  test("an over-limit body is refused before fetch", async () => {
    const fetcher = jest.fn();
    await expect(postPairingJson("https://computer.example/pair/claim", "x".repeat(8193), fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("an over-limit request head is refused before fetch", async () => {
    const fetcher = jest.fn();
    const url = `https://computer.example/${"x".repeat(8192)}`;
    await expect(postPairingJson(url, "{}", fetcher)).resolves.toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  test("all non-200 claim responses collapse to the same refusal result", async () => {
    const fetcher: PairingFetch = async () => response(403, "");
    const session = new PairingSession({ deskUrl: "http://127.0.0.1:8443", square, phone, fetcher, randomBytes: random(0xc0) });
    await expect(session.begin()).resolves.toBeNull();
    expect(session.needsCompletionRetry()).toBe(false);
  });
});
