import {
  disposeRemoteEngine,
  initRemoteEngine,
  isRemoteEngineReady,
  isSupersededRemoteOp,
  remoteNativeWorkInFlight,
  streamRemoteAssistantTurn,
  testRemoteConnection,
} from "./RemoteEngine";
import { setRemoteBrainUrl } from "./remoteSettings";
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
  beforeEach(async () => {
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
    await setRemoteBrainUrl("http://127.0.0.1:8000");
  });

  afterEach(async () => {
    await disposeRemoteEngine();
  });

  test("empty URL is url_missing not https_required", async () => {
    await setRemoteBrainUrl("");
    const probe = await testRemoteConnection();
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("remote_brain_url_missing");
  });

  test("the server's own context window replaces our default", async () => {
    const { getRemoteContextSize, setRemoteServerModelId, setRemoteContextSize } =
      await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await setRemoteContextSize(32768);
    // /props is where llama-server says what it will actually answer within.
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/props")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ default_generation_settings: { n_ctx: 8192 } }),
        };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) };
    });

    const probe = await testRemoteConnection();
    expect(probe.ok).toBe(true);
    // Sizing prompts to 32768 against a server that answers 8192 fails with
    // something the user cannot act on; the client now uses what the server says.
    expect(getRemoteContextSize()).toBe(8192);
  });

  test("a backend that does not expose /props keeps the default", async () => {
    const { getRemoteContextSize, setRemoteServerModelId, setRemoteContextSize } =
      await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await setRemoteContextSize(32768);
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/props")) {
        return { ok: false, status: 404, json: async () => null };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) };
    });

    expect((await testRemoteConnection()).ok).toBe(true);
    expect(getRemoteContextSize()).toBe(32768);
  });

  test("empty URL does not read SecureStore", async () => {
    await setRemoteBrainUrl("");
    (getRemoteBrainToken as jest.Mock).mockClear();
    (getRemoteBrainToken as jest.Mock).mockRejectedValue(
      new Error("secure_store_down"),
    );
    const probe = await testRemoteConnection();
    expect(probe.error).toBe("remote_brain_url_missing");
    expect(getRemoteBrainToken).not.toHaveBeenCalled();
    (getRemoteBrainToken as jest.Mock).mockResolvedValue(null);
  });

  test("stream with empty URL errors url_missing", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    await setRemoteBrainUrl("");
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
    expect(errors).toContain("remote_brain_url_missing");
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

  test("active A mid-stream dispose then B is not clobbered by A's finish", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let finishA: (() => void) | undefined;
    streamOpenAiChat.mockImplementationOnce((
      _req: unknown,
      handlers: { onFinish: (f: { kind: string; finishReason: string }) => void },
    ) => {
      finishA = () => handlers.onFinish({ kind: "complete", finishReason: "stop" });
      return {
        requestId: "a-mid",
        abort: jest.fn(),
        xhr: {},
        isClosed: () => false,
      };
    });
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
    finishA?.();
    await pA;
    expect(remoteNativeWorkInFlight()).toBe(true);
    expect(bOpened).toBe(1);
    await disposeRemoteEngine();
    await pB;
  });

  test("an inherited superseded marker is not a verdict", () => {
    // A current error whose prototype carries the marker must not vanish.
    const inherited = Object.create({ superseded: true }) as Error;
    expect(isSupersededRemoteOp(inherited)).toBe(false);

    const own = new Error("remote_brain_network") as Error & {
      superseded?: true;
    };
    own.superseded = true;
    expect(isSupersededRemoteOp(own)).toBe(true);
    expect(isSupersededRemoteOp(new Error("remote_brain_network"))).toBe(false);
  });

  test("a superseded init does not clobber the init that won", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    // A's probe hangs; B starts and succeeds; A then resolves and fails.
    let releaseA!: () => void;
    const hungA = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    fetchMock.mockImplementationOnce(async () => {
      await hungA;
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) };
    });
    const a = initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    await Promise.resolve();
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    releaseA();
    const err = await a.then(
      () => null,
      (e: unknown) => e,
    );
    // The verdict must be readable by the UI, and the winner's state must stand.
    expect(isSupersededRemoteOp(err)).toBe(true);
    expect(isRemoteEngineReady()).toBe(true);
  });

  test("a superseded stream marks its failure and reports no success", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let failA: ((err: Error) => void) | undefined;
    streamOpenAiChat.mockImplementationOnce((
      _req: unknown,
      handlers: {
        onFinish: (f: { kind: string; finishReason: null; error: Error }) => void;
      },
    ) => {
      failA = (err) => handlers.onFinish({ kind: "error", finishReason: null, error: err });
      return { requestId: "a", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });
    const done: string[] = [];
    const errors: unknown[] = [];
    const pA = streamRemoteAssistantTurn(
      [{ role: "user", content: "a" }],
      {
        onDelta: () => undefined,
        onDone: () => done.push("done"),
        onError: (e) => errors.push(e),
      },
      undefined,
      { locale: "en" },
    );
    await Promise.resolve();
    await Promise.resolve();
    await disposeRemoteEngine();
    failA?.(new Error("remote_brain_network"));
    await pA;
    expect(done).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(isSupersededRemoteOp(errors[0])).toBe(true);
  });

  test("a superseded stream reports no success", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let completeA: (() => void) | undefined;
    streamOpenAiChat.mockImplementationOnce((
      _req: unknown,
      handlers: {
        onFinish: (f: { kind: string; finishReason: string }) => void;
      },
    ) => {
      completeA = () => handlers.onFinish({ kind: "complete", finishReason: "stop" });
      return { requestId: "a", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });
    const done: string[] = [];
    const pA = streamRemoteAssistantTurn(
      [{ role: "user", content: "a" }],
      {
        onDelta: () => undefined,
        onDone: () => done.push("done"),
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    await Promise.resolve();
    await Promise.resolve();
    await disposeRemoteEngine();
    completeA?.();
    await pA;
    expect(done).toEqual([]);
  });

  test("a stream that is still current delivers an unmarked failure", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    errorStreamMock("current", "remote_brain_network");
    const errors: unknown[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "a" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (e) => errors.push(e),
      },
      undefined,
      { locale: "en" },
    );
    expect(errors).toHaveLength(1);
    expect(isSupersededRemoteOp(errors[0])).toBe(false);
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
