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

jest.mock("../thinkStream", () => ({
  createThinkStreamCleaner: jest.fn(() => ({
    cleanDelta: (text: string) => text,
    finalize: (text: string) => text,
  })),
}));

const fetchMock = jest.fn();
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

function completeStreamMock(requestId: string) {
  const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
    streamOpenAiChat: jest.Mock;
  };
  streamOpenAiChat.mockImplementation((
    _req: unknown,
    handlers: {
      onDelta: (d: { kind: string; content: string; reasoning: string; finishReason: null }) => void;
      onFinish: (f: { kind: string; finishReason: string }) => void;
    },
  ) => {
    queueMicrotask(() => {
      handlers.onDelta({
        kind: "delta",
        content: "hi",
        reasoning: "",
        finishReason: null,
      });
      handlers.onFinish({ kind: "complete", finishReason: "stop" });
    });
    return { requestId, abort: jest.fn(), xhr: {}, isClosed: () => false };
  });
}

function errorStreamMock(requestId: string, message: string) {
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
        error: new Error(message),
      });
    });
    return { requestId, abort: jest.fn(), xhr: {}, isClosed: () => false };
  });
}

describe("RemoteEngine lifecycle", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ornith" }] }),
    });
    const { createThinkStreamCleaner } = jest.requireMock("../thinkStream") as {
      createThinkStreamCleaner: jest.Mock;
    };
    createThinkStreamCleaner.mockReset();
    createThinkStreamCleaner.mockImplementation(() => ({
      cleanDelta: (text: string) => text,
      finalize: (text: string) => text,
    }));
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
      isClosed: () => false,
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
        isClosed: () => false,
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

  test("onDelta throw still settles and clears inFlight", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: {
        onDelta: (d: { kind: string; content: string; reasoning: string; finishReason: null }) => void;
        onFinish: (f: { kind: string; finishReason: string }) => void;
      },
    ) => {
      queueMicrotask(() => {
        handlers.onDelta({
          kind: "delta",
          content: "hi",
          reasoning: "",
          finishReason: null,
        });
        handlers.onFinish({ kind: "complete", finishReason: "stop" });
      });
      return { requestId: "throw-delta", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => {
          throw new Error("ui boom");
        },
        onDone: () => {
          done = true;
        },
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    expect(done).toBe(true);
    expect(remoteNativeWorkInFlight()).toBe(false);
  });

  test("sync setup failure does not publish a closed handle as activeStream", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let abortCount = 0;
    streamOpenAiChat.mockImplementation((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: null; error: Error }) => void },
    ) => {
      handlers.onFinish({
        kind: "error",
        finishReason: null,
        error: new Error("open_boom"),
      });
      return {
        requestId: "closed",
        abort: () => {
          abortCount += 1;
        },
        xhr: {},
        isClosed: () => true,
      };
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
      { locale: "en" },
    );
    expect(errors).toContain("open_boom");
    expect(remoteNativeWorkInFlight()).toBe(false);
    await disposeRemoteEngine();
    expect(abortCount).toBe(0);
  });

  test("finalize throw still fires onDone", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { createThinkStreamCleaner } = jest.requireMock("../thinkStream") as {
      createThinkStreamCleaner: jest.Mock;
    };
    createThinkStreamCleaner.mockImplementation(() => ({
      cleanDelta: (text: string) => text,
      finalize: () => {
        throw new Error("finalize_boom");
      },
    }));
    completeStreamMock("finalize-throw");
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          done = true;
        },
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    expect(done).toBe(true);
    expect(remoteNativeWorkInFlight()).toBe(false);
  });

  test("onModelEmittedText throw still fires onDone", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    completeStreamMock("onmodel-throw");
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          done = true;
        },
        onError: () => undefined,
        onModelEmittedText: () => {
          throw new Error("onmodel_boom");
        },
      },
      undefined,
      { locale: "en" },
    );
    expect(done).toBe(true);
    expect(remoteNativeWorkInFlight()).toBe(false);
  });

  test("onDone throw still settles", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    completeStreamMock("ondone-throw");
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          throw new Error("ondone_boom");
        },
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    expect(remoteNativeWorkInFlight()).toBe(false);
  });

  test("onError throw still settles", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    errorStreamMock("onerror-throw", "net_boom");
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => {
          throw new Error("onerror_boom");
        },
      },
      undefined,
      { locale: "en" },
    );
    expect(remoteNativeWorkInFlight()).toBe(false);
  });

  test("onStatus throw does not block the stream", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    completeStreamMock("onstatus-throw");
    let done = false;
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => {
          done = true;
        },
        onError: () => undefined,
        onStatus: () => {
          throw new Error("onstatus_boom");
        },
      },
      undefined,
      { locale: "en" },
    );
    expect(done).toBe(true);
    expect(remoteNativeWorkInFlight()).toBe(false);
  });
});
