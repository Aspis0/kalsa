const mockGetItemAsync = jest.fn(async () => null as string | null);
const mockSetItemAsync = jest.fn(async () => undefined);
const mockGetRandomBytes = jest.fn((length: number) => new Uint8Array(length).fill(0x11));

jest.mock("expo-secure-store", () => ({
  getItemAsync: mockGetItemAsync,
  setItemAsync: mockSetItemAsync,
}));
jest.mock("expo-crypto", () => ({
  getRandomBytes: (length: number) => mockGetRandomBytes(length),
}));

import { PairingSession, type PairingFetch } from "./pairingTransport";
import { derivePairingInstallId } from "./pairingInstallId";
import { phoneMacHex, type PairingPhoneDeclaration } from "./pairingWire";

const phone: PairingPhoneDeclaration = {
  weights_bytes: 0,
  parameters: null,
  measured_tokens_per_second: null,
  battery_powered: true,
};

describe("install id on the complete request", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetItemAsync.mockResolvedValue(null);
    mockSetItemAsync.mockResolvedValue(undefined);
    mockGetRandomBytes.mockImplementation((length: number) => new Uint8Array(length).fill(0x11));
  });

  test("sends the id top-level without changing the pre-existing MAC input", async () => {
    const square = {
      reachable: "http://127.0.0.1:8132",
      code: "31".repeat(16),
      nonce: "32".repeat(32),
      node: "22".repeat(32),
      tailnet: "",
    };
    const bodies: string[] = [];
    const fetcher: PairingFetch = async (url, init) => {
      if (url.endsWith("/pair/claim")) return { status: 200, json: async () => ({}) };
      bodies.push(init.body);
      return { status: 403, json: async () => ({}) };
    };
    const methods: Array<"log" | "info" | "warn" | "error" | "debug"> = [
      "log", "info", "warn", "error", "debug",
    ];
    const logSpies = methods.map((method) =>
      jest.spyOn(console, method).mockImplementation(() => undefined),
    );
    const session = new PairingSession({
      deskUrl: "https://desk.example",
      square,
      phone,
      fetcher,
      randomBytes: () => new Uint8Array(16).fill(0xc0),
    });

    await expect(session.begin()).resolves.toBeNull();
    const body = JSON.parse(bodies[0]) as Record<string, unknown>;
    const installId = derivePairingInstallId(new Uint8Array(16).fill(0x11), square.node);
    expect(body).toEqual({
      phone,
      mac: phoneMacHex(square.code, square.nonce, {
        reachable: square.reachable,
        node: square.node,
        deliveryToken: "c0".repeat(16),
        phone,
      }),
      delivery_token: "c0".repeat(16),
      install_id: installId,
    });
    const logged = JSON.stringify(logSpies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain("11".repeat(16));
    expect(logged).not.toContain(installId);
    for (const spy of logSpies) spy.mockRestore();
  });
});
