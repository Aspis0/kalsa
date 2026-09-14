import {
  disposeRemoteEngine,
  initRemoteEngine,
  remoteNativeWorkInFlight,
  streamRemoteAssistantTurn,
} from "./RemoteEngine";
import { getRemoteBrainToken } from "./remoteSecret";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
  };
});

jest.mock("./remoteSecret", () => ({
  getRemoteBrainToken: jest.fn(async () => null),
}));

jest.mock("./openaiTransport", () => ({
  streamOpenAiChat: jest.fn(),
}));

const fetchMock = jest.fn();
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

describe("RemoteEngine lifecycle", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ornith" }] }),
    });
  });

  afterEach(async () => {
    await disposeRemoteEngine();
  });

  test("overlapping streams are rejected", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: null }) => void },
    ) => ({
      requestId: "r1",
      abort: () => handlers.onFinish({ kind: "interrupted", finishReason: null }),
      xhr: {},
    }));
    const first = streamRemoteAssistantTurn(
      [{ role: "user", content: "hi" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    const errors: string[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hi2" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (e) => {
          errors.push(e.message);
        },
      },
      undefined,
      { locale: "en" },
    );
    expect(errors).toContain("remote_brain_busy");
    await disposeRemoteEngine();
    await first.catch(() => undefined);
  });

  test("dispose during pending token then start B does not clobber B", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const tokenMock = getRemoteBrainToken as jest.Mock;
    let releaseA: ((value: null) => void) | undefined;
    tokenMock.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          releaseA = resolve;
        }),
    );
    const pA = streamRemoteAssistantTurn(
      [{ role: "user", content: "a" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(remoteNativeWorkInFlight()).toBe(true);
    await disposeRemoteEngine();
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    tokenMock.mockResolvedValue(null);
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let bOpened = 0;
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: null }) => void },
    ) => {
      bOpened += 1;
      return {
        requestId: `b${bOpened}`,
        abort: () => handlers.onFinish({ kind: "interrupted", finishReason: null }),
        xhr: {},
      };
    });
    const pB = streamRemoteAssistantTurn(
      [{ role: "user", content: "b" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    await Promise.resolve();
    await Promise.resolve();
    expect(bOpened).toBe(1);
    expect(remoteNativeWorkInFlight()).toBe(true);
    releaseA?.(null);
    await pA;
    expect(remoteNativeWorkInFlight()).toBe(true);
    expect(bOpened).toBe(1);
    await disposeRemoteEngine();
    await pB;
  });
});
