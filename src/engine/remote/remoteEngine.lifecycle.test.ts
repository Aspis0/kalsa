import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn } from "./RemoteEngine";

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
});
