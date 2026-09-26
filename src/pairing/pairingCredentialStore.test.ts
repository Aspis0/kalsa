import * as SecureStore from "expo-secure-store";
import { getPairingCredential, savePairingCredential } from "./pairingCredentialStore";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
}));

const secureStore = SecureStore as jest.Mocked<typeof SecureStore>;

describe("pairing credential storage boundary", () => {
  beforeEach(() => {
    secureStore.getItemAsync.mockReset();
    secureStore.setItemAsync.mockReset();
  });

  test("stores the 32-byte credential as lowercase hex beside the door address", async () => {
    secureStore.setItemAsync.mockResolvedValue();
    await savePairingCredential(new Uint8Array(32).fill(0xab), "https://desktop.tailnet.ts.net");
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "kalsa.pairing.credential.v3",
      JSON.stringify({ credential: "ab".repeat(32), doorUrl: "https://desktop.tailnet.ts.net" }),
    );
  });

  test("reads a saved credential; malformed data is not treated as a credential", async () => {
    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ credential: "12".repeat(32), doorUrl: "https://desktop.tailnet.ts.net" }),
    );
    // A record saved before the iroh step: no node, HTTPS road ahead.
    await expect(getPairingCredential()).resolves.toEqual({
      credential: "12".repeat(32),
      doorUrl: "https://desktop.tailnet.ts.net",
      node: null,
    });
    secureStore.getItemAsync.mockResolvedValue(JSON.stringify({ credential: "bad", doorUrl: "x" }));
    await expect(getPairingCredential()).resolves.toBeNull();
  });

  test("a valid node round-trips; a malformed stored node degrades to null, not to a refusal", async () => {
    const node = "ab".repeat(32);
    secureStore.setItemAsync.mockResolvedValue();
    await savePairingCredential(new Uint8Array(32).fill(0xab), "https://desktop.example", node);
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "kalsa.pairing.credential.v3",
      JSON.stringify({ credential: "ab".repeat(32), doorUrl: "https://desktop.example", node }),
    );

    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ credential: "12".repeat(32), doorUrl: "https://desktop.example", node: "nope" }),
    );
    await expect(getPairingCredential()).resolves.toMatchObject({ node: null });
  });

  test("a node that is not 64 lowercase hex is dropped at save time", async () => {
    secureStore.setItemAsync.mockResolvedValue();
    await savePairingCredential(
      new Uint8Array(32).fill(0xab),
      "https://desktop.example",
      "AB".repeat(32),
    );
    expect(secureStore.setItemAsync).toHaveBeenCalledWith(
      "kalsa.pairing.credential.v3",
      JSON.stringify({ credential: "ab".repeat(32), doorUrl: "https://desktop.example" }),
    );
  });

  test("reading the credential is side-effect-free", async () => {
    secureStore.getItemAsync.mockResolvedValue(
      JSON.stringify({ credential: "12".repeat(32), doorUrl: "https://desktop.tailnet.ts.net" }),
    );
    await expect(getPairingCredential()).resolves.toMatchObject({ credential: "12".repeat(32) });
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });

  test("a malformed credential is rejected before any secure-store write", async () => {
    await expect(savePairingCredential(new Uint8Array(31), "https://desktop.example")).rejects.toThrow(
      "invalid pairing credential",
    );
    expect(secureStore.setItemAsync).not.toHaveBeenCalled();
  });
});
