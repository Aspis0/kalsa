/**
 * The one failure line per failed remote chat/init (`remote.brain.failure`):
 * the engine-level half of the contract — the codes normalize in
 * `remoteBrainFailureLog.test.ts`, here the engine's own paths must PRODUCE
 * the lines, with the road the failure actually rode.
 */
import {
  disposeRemoteEngine,
  initRemoteEngine,
  streamRemoteAssistantTurn,
} from "./RemoteEngine";
import { setRemoteBrainUrl } from "./remoteSettings";

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

describe("remote.brain.failure lines from the engine paths", () => {
  let logSpy: jest.SpyInstance;

  beforeEach(async () => {
    logSpy = jest.spyOn(console, "log").mockImplementation(() => undefined);
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ornith" }] }),
    });
    await setRemoteBrainUrl("http://127.0.0.1:8000");
  });

  afterEach(async () => {
    logSpy.mockRestore();
    await disposeRemoteEngine();
  });

  test("a failed init probe logs stage init with the road it rode", async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({}),
    });
    // The probe speaks the same 401 code the chat transport produces, so
    // init and chat map to one message downstream.
    await expect(
      initRemoteEngine("", "kalsa-remote-mac", { locale: "en" }),
    ).rejects.toThrow("remote_brain_http_401");
    expect(failureLines(logSpy)).toEqual([
      { road: "https", stage: "init", reason: "remote_brain_http_401" },
    ]);
  });

  test("a failed stream logs stage stream with the turn's road", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    logSpy.mockClear();

    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: null; error: Error }) => void },
    ) => {
      queueMicrotask(() => {
        handlers.onFinish({
          kind: "error",
          finishReason: null,
          error: new Error("remote_brain_http_500"),
        });
      });
      return { requestId: "r-fail", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });

    const errors: string[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (e) => {
          errors.push(e.message);
        },
      },
      undefined,
      { locale: "en", turnId: "t-fail-log" },
    );
    expect(errors).toEqual(["remote_brain_http_500"]);
    expect(failureLines(logSpy)).toEqual([
      { road: "https", stage: "stream", reason: "remote_brain_http_500" },
    ]);
  });

  test("a user stop logs no failure line", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    logSpy.mockClear();

    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: null }) => void },
    ) => {
      queueMicrotask(() => {
        handlers.onFinish({ kind: "interrupted", finishReason: null });
      });
      return { requestId: "r-stop", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });

    const errors: string[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (e) => {
          errors.push(e.message);
        },
      },
      undefined,
      { locale: "en", turnId: "t-stop-log" },
    );
    expect(failureLines(logSpy)).toEqual([]);
  });
});
