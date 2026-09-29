/**
 * A removed pairing never presents its bearer to chat either: the probe
 * answers the bare "removed" token and init rejects with it before any
 * request exists, and the turn reports the room's own verdict
 * (room/roomError's removedRoomError) through the control-code boundary
 * while the failure line keeps the token instead of "other".
 */
import {
  disposeRemoteEngine,
  initRemoteEngine,
  streamRemoteAssistantTurn,
  testRemoteConnection,
} from "./RemoteEngine";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
    __reset: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
});

jest.mock("./remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(async () => null),
}));

jest.mock("../../pairing/pairingCredentialStore", () => ({
  getPairingCredential: jest.fn(async () => null),
}));

jest.mock("./openaiTransport", () => ({
  streamOpenAiChat: jest.fn(),
}));

jest.mock("../../remote/irohBridge", () => ({
  irohModulePresent: jest.fn(() => false),
  openIrohTunnel: jest.fn(),
}));

jest.mock("../thinkStream", () => ({
  createThinkStreamCleaner: jest.fn(() => ({
    cleanDelta: (text: string) => text,
    finalize: (text: string) => text,
  })),
}));

import { getPairingCredential } from "../../pairing/pairingCredentialStore";

const fetchMock = jest.fn();
const hadFetch = "fetch" in globalThis;
const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  if (hadFetch) {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

function failureLines(logSpy: jest.SpyInstance): Array<Record<string, string>> {
  return logSpy.mock.calls
    .filter((call) => call[0] === "remote.brain.failure")
    .map((call) => JSON.parse(call[1] as string) as Record<string, string>);
}

const REMOVED = {
  localId: "p-lid-gone",
  doorUrl: "https://desktop.tailnet.ts.net:9443",
  credential: "ab".repeat(32),
  node: null,
  pairedVia: null,
  roomId: "1f0a3b9c2d4e5f60718293a4b5c6d7e8",
  removed: true,
};

describe("a removed pairing on the chat path", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchMock.mockReset();
    (getPairingCredential as jest.Mock).mockResolvedValue(REMOVED);
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await disposeRemoteEngine();
  });

  test("the probe answers removed without a single request", async () => {
    const probe = await testRemoteConnection();

    expect(probe).toMatchObject({ ok: false, error: "removed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("init rejects with the same token, still without a request", async () => {
    await expect(
      initRemoteEngine("", "kalsa-remote-mac", { locale: "en" }),
    ).rejects.toThrow("removed");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failureLines(logSpy)).toEqual([
      { road: "unknown", stage: "init", reason: "removed" },
    ]);
  });

  test("the turn reports the room's own verdict and logs its token", async () => {
    const errors: Array<{ message: string; code?: string }> = [];

    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (error) => {
          errors.push({ message: error.message, code: (error as { code?: string }).code });
        },
      },
      undefined,
      { locale: "en", turnId: "t-removed" },
    );

    expect(errors).toEqual([
      { message: "This phone is no longer a member of the room.", code: "removed" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(failureLines(logSpy)).toEqual([
      { road: "unknown", stage: "stream", reason: "removed" },
    ]);
  });
});
