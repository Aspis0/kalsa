const mockSecureValues: Record<string, string> = {};

jest.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => mockSecureValues[key] ?? null,
  setItemAsync: async (key: string, value: string) => { mockSecureValues[key] = value; },
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: async () => null,
  setItem: async () => undefined,
}));

import { savePairingCredential } from "./pairingCredentialStore";
import { PairingSession, type PairingFetch } from "./pairingTransport";
import { getRemoteDoorConfig, getRemoteDoorToken } from "../engine/remote/remoteDoorConfig";
import { streamOpenAiChat, type XhrLike } from "../engine/remote/openaiTransport";

function response(status: number, body: unknown = {}) {
  return { status, json: async () => body };
}

describe("paired credential reaches the live door header", () => {
  beforeEach(() => {
    for (const key of Object.keys(mockSecureValues)) delete mockSecureValues[key];
  });

  test("the credential opened by ceremony is sent once, byte-identically, as lowercase hex", async () => {
    const doorUrl = "https://desktop.tailnet.ts.net:9443";
    const credential = "ab".repeat(32);
    const seal = {
      credential_ciphertext: "19d0b3455e311a70ba202aea83ea569e8127f2f1936f67bdc557439a82222ba7",
      mac: "6d86a29391e258de9bb13dae9ceb3612143c4448050562a36ad2e6ac8dd4a849",
    };
    const fetcher: PairingFetch = async (url) =>
      url.endsWith("/pair/claim") ? response(200) : response(200, seal);
    const session = new PairingSession({
      deskUrl: "https://desktop.tailnet.ts.net:8443",
      square: {
        reachable: "http://127.0.0.1:8132",
        code: "41".repeat(16),
        nonce: "42".repeat(32),
        node: "",
      },
      phone: {
        weights_bytes: 2_200_000_000,
        parameters: null,
        measured_tokens_per_second: null,
        battery_powered: true,
      },
      fetcher,
      randomBytes: () => new Uint8Array(16).fill(0xc0),
    });
    const opened = await session.begin();
    expect(opened).toEqual(new Uint8Array(32).fill(0xab));
    await savePairingCredential(opened!, doorUrl);

    const selected = await getRemoteDoorConfig();
    const token = await getRemoteDoorToken(selected);
    expect(selected.url).toBe(doorUrl);
    expect(token).toBe(credential);
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    const headers: Array<[string, string]> = [];
    const xhr: XhrLike = {
      readyState: 0,
      status: 0,
      responseText: "",
      timeout: 0,
      open: () => undefined,
      setRequestHeader: (name, value) => headers.push([name, value]),
      send: () => undefined,
      abort: () => undefined,
      onreadystatechange: null,
      onprogress: null,
      onerror: null,
      ontimeout: null,
      onabort: null,
    };
    const request = streamOpenAiChat(
      {
        completionsUrl: `${selected.url}/v1/chat/completions`,
        model: "server-model",
        messages: [{ role: "user", content: "hello" }],
        maxTokens: 8,
        temperature: 0,
        token,
        inactivityMs: 0,
      },
      { onDelta: () => undefined, onFinish: () => undefined },
      () => xhr,
    );

    const authorization = headers.filter(([name]) => name.toLowerCase() === "authorization");
    expect(authorization).toEqual([["Authorization", `Bearer ${credential}`]]);
    expect(request.isClosed()).toBe(false);
    request.abort();
  });
});
