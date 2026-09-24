import {
  disposeRemoteEngine,
  initRemoteEngine,
  isRemoteEngineReady,
  isSupersededRemoteOp,
  remoteNativeWorkInFlight,
  streamRemoteAssistantTurn,
  testRemoteConnection,
} from "./RemoteEngine";
import { humanRemoteBrainError } from "./remoteBrainErrors";
import { setRemoteBrainUrl } from "./remoteSettings";
import { getRemoteBrainToken } from "./remoteSecret";
import { getPairingCredential } from "../../pairing/pairingCredentialStore";

jest.mock("@react-native-async-storage/async-storage", () => {
  const store: Record<string, string> = {};
  return {
    getItem: async (key: string) => store[key] ?? null,
    setItem: async (key: string, value: string) => {
      store[key] = value;
    },
    /** Full reset: cases must not share residual settings. */
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
  // Leave globalThis exactly as this file found it — present or absent.
  if (hadFetch) {
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  } else {
    delete (globalThis as { fetch?: typeof fetch }).fetch;
  }
});

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

type StreamFinish = {
  kind: string;
  finishReason: string | null;
  error?: Error;
};

/** One partial delta, then the given terminal finish. */
function partialStreamMock(requestId: string, finish: StreamFinish) {
  const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
    streamOpenAiChat: jest.Mock;
  };
  streamOpenAiChat.mockImplementation((
    _req: unknown,
    handlers: {
      onDelta: (d: { kind: string; content: string; reasoning: string; finishReason: null }) => void;
      onFinish: (f: StreamFinish) => void;
    },
  ) => {
    queueMicrotask(() => {
      handlers.onDelta({
        kind: "delta",
        content: "partial answer",
        reasoning: "",
        finishReason: null,
      });
      handlers.onFinish(finish);
    });
    return { requestId, abort: jest.fn(), xhr: {}, isClosed: () => false };
  });
}

/** Collects EmissionSource values in fire order. */
function emissionRecorder() {
  const sources: string[] = [];
  return {
    sources,
    callbacks: {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
      onModelEmittedText: (_text: string, source: "parsed" | "raw") => {
        sources.push(source);
      },
    },
  };
}

describe("RemoteEngine lifecycle", () => {
  beforeEach(async () => {
    const asyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      __reset: () => void;
    };
    asyncStorage.__reset();
    fetchMock.mockReset();
    (getPairingCredential as jest.Mock).mockReset().mockResolvedValue(null);
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    streamOpenAiChat.mockReset();
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

  test("remote probe and stream use the paired door and paired bearer credential", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    const pairedDoorUrl = "https://desktop.tailnet.ts.net:9443";
    const pairedCredential = "ab".repeat(32);
    (getPairingCredential as jest.Mock).mockResolvedValue({
      doorUrl: pairedDoorUrl,
      credential: pairedCredential,
    });
    await setRemoteServerModelId("ornith");
    fetchMock.mockImplementation(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ id: "ornith" }] }),
    }));

    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      `${pairedDoorUrl}/props`,
      `${pairedDoorUrl}/v1/models`,
    ]);
    expect(fetchMock.mock.calls.every((call) =>
      (call[1] as RequestInit).headers &&
      ((call[1] as RequestInit).headers as Record<string, string>).Authorization === `Bearer ${pairedCredential}`,
    )).toBe(true);

    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    completeStreamMock("paired-door-turn");
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      { onDelta: () => undefined, onDone: () => undefined, onError: (error) => { throw error; } },
      undefined,
      { locale: "en" },
    );
    const request = streamOpenAiChat.mock.calls[0][0] as {
      completionsUrl: string;
      token: string;
    };
    expect(request.completionsUrl).toBe(`${pairedDoorUrl}/v1/chat/completions`);
    expect(request.token).toBe(pairedCredential);
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
    while (!finishA) await Promise.resolve();
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
    while (bOpened === 0) await Promise.resolve();
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
    while (!failA) await Promise.resolve();
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
    while (!completeA) await Promise.resolve();
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
    while (!releaseA) await Promise.resolve();
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
    while (bOpened === 0) await Promise.resolve();
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

  test("a completed turn reports emission source parsed", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    partialStreamMock("emission-complete", {
      kind: "complete",
      finishReason: "stop",
    });
    const { sources, callbacks } = emissionRecorder();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    expect(sources).toEqual(["parsed"]);
  });

  test("an interrupted partial reports emission source raw", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    partialStreamMock("emission-interrupted", {
      kind: "interrupted",
      finishReason: null,
    });
    const { sources, callbacks } = emissionRecorder();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    expect(sources).toEqual(["raw"]);
  });

  test("a truncated partial reports emission source raw", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    partialStreamMock("emission-truncated", {
      kind: "truncated",
      finishReason: "length",
    });
    const { sources, callbacks } = emissionRecorder();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    expect(sources).toEqual(["raw"]);
  });

  test("a failed stream with partial output reports emission source raw", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    partialStreamMock("emission-error", {
      kind: "error",
      finishReason: null,
      error: new Error("remote_brain_network"),
    });
    const { sources, callbacks } = emissionRecorder();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    expect(sources).toEqual(["raw"]);
  });

  test("memory facts ride the last user turn, not the system prompt", async () => {
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let request:
      | { messages: Array<{ role: string; content: string }> }
      | undefined;
    streamOpenAiChat.mockImplementation((
      req: { messages: Array<{ role: string; content: string }> },
      handlers: {
        onDelta: (d: { kind: string; content: string; reasoning: string; finishReason: null }) => void;
        onFinish: (f: { kind: string; finishReason: string }) => void;
      },
    ) => {
      request = req;
      queueMicrotask(() => {
        handlers.onDelta({
          kind: "delta",
          content: "hi",
          reasoning: "",
          finishReason: null,
        });
        handlers.onFinish({ kind: "complete", finishReason: "stop" });
      });
      return { requestId: "facts", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "hello" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      undefined,
      {
        locale: "en",
        memoryFacts: [
          { id: "f1", text: "The cat is named Needle", createdAt: 1_700_000_000_000 },
        ],
      },
    );
    expect(request).toBeDefined();
    const messages = request!.messages;
    const system = messages.find((m) => m.role === "system");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    // Format B: the fact block prefixes the last user message and never
    // rewrites prompt position 0 (ttftFlags.ts:26 is the reason).
    expect(system).toBeDefined();
    expect(system!.content).not.toContain("Needle");
    expect(lastUser).toBeDefined();
    expect(lastUser!.content).toContain("Needle");
    expect(lastUser!.content).toContain("hello");
  });

  test("editing the URL or server model drops remote readiness", async () => {
    // The ready short-circuit must never trust a probe of the PREVIOUS
    // server: a config write invalidates readiness, so the next ensure
    // re-probes (fix round 2, item 4).
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    expect(isRemoteEngineReady()).toBe(true);
    await setRemoteBrainUrl("http://127.0.0.1:9100");
    expect(isRemoteEngineReady()).toBe(false);
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    expect(isRemoteEngineReady()).toBe(true);
    await setRemoteServerModelId("other-model");
    expect(isRemoteEngineReady()).toBe(false);
  });

  test("a native remote exception never reaches the UI verbatim", async () => {
    // getRemoteBrainToken rethrows SecureStore failures; the remote boundary
    // converts them to an internal code so the UI renders generic copy.
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const tokenMock = getRemoteBrainToken as jest.Mock;
    tokenMock.mockRejectedValueOnce(new Error("keystore exploded"));
    const errors: string[] = [];
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: (e) => errors.push(e.message),
      },
      undefined,
      { locale: "en" },
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].startsWith("remote_brain_")).toBe(true);
    expect(errors[0]).not.toContain("keystore");
    expect(humanRemoteBrainError(errors[0], (k) => k)).toBe(
      "settings.remoteBrainFailGeneric",
    );
  });

  test("a config edit during a probe supersedes it — no ready against the old server", async () => {
    // R2-2: the hook bumps initGeneration, so a probe already in flight
    // cannot mark ready after the config changed.
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    let release!: () => void;
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              status: 200,
              json: async () => ({ data: [{ id: "ornith" }] }),
            });
        }),
    );
    const probe = initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    while (!release) await Promise.resolve();
    await setRemoteBrainUrl("http://127.0.0.1:9200");
    release();
    const err = await probe.then(
      () => null,
      (e: unknown) => e,
    );
    expect(isSupersededRemoteOp(err)).toBe(true);
    expect(isRemoteEngineReady()).toBe(false);
  });

  test("a mid-turn config edit cannot mix URL and model in the request", async () => {
    // Item 4: one turn captures ONE server identity (URL + model together, at
    // turn start, before the token await). The edit belongs to the next turn.
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const tokenMock = getRemoteBrainToken as jest.Mock;
    let releaseToken!: () => void;
    tokenMock.mockImplementationOnce(
      () =>
        new Promise<null>((resolve) => {
          releaseToken = () => resolve(null);
        }),
    );
    const { streamOpenAiChat } = jest.requireMock("./openaiTransport") as {
      streamOpenAiChat: jest.Mock;
    };
    let request: { model?: string; completionsUrl?: string } | undefined;
    streamOpenAiChat.mockImplementation((
      req: { model?: string; completionsUrl?: string },
      handlers: {
        onDelta: (d: { kind: string; content: string; reasoning: string; finishReason: null }) => void;
        onFinish: (f: { kind: string; finishReason: string }) => void;
      },
    ) => {
      request = req;
      queueMicrotask(() => {
        handlers.onDelta({
          kind: "delta",
          content: "hi",
          reasoning: "",
          finishReason: null,
        });
        handlers.onFinish({ kind: "complete", finishReason: "stop" });
      });
      return { requestId: "cfg", abort: jest.fn(), xhr: {}, isClosed: () => false };
    });
    const turn = streamRemoteAssistantTurn(
      [{ role: "user", content: "x" }],
      {
        onDelta: () => undefined,
        onDone: () => undefined,
        onError: () => undefined,
      },
      undefined,
      { locale: "en" },
    );
    while (!releaseToken) await Promise.resolve();
    await setRemoteServerModelId("new-model");
    await setRemoteBrainUrl("http://127.0.0.1:9300");
    releaseToken();
    await turn;
    expect(request).toBeDefined();
    expect(request!.model).toBe("ornith");
    expect(String(request!.completionsUrl)).toContain("127.0.0.1:8000");
  });

  test("the boundary passes only its own codes and the control markers", async () => {
    // R2-1: a snake_case token that is NOT ours must not cross verbatim;
    // the interrupted control marker must cross unchanged.
    const { setRemoteServerModelId } = await import("./remoteSettings");
    await setRemoteServerModelId("ornith");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
    const tokenMock = getRemoteBrainToken as jest.Mock;
    const errors: unknown[] = [];
    const callbacks = {
      onDelta: () => undefined,
      onDone: () => undefined,
      onError: (e: unknown) => errors.push(e),
    };
    tokenMock.mockRejectedValueOnce(new Error("not_found"));
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "a" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    expect((errors[0] as Error).message).toBe("remote_brain_internal");
    expect((errors[0] as Error).message).not.toContain("not_found");

    tokenMock.mockRejectedValueOnce(
      Object.assign(new Error("Generation was interrupted."), {
        code: "interrupted",
        preservePartial: true,
      }),
    );
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "b" }],
      callbacks,
      undefined,
      { locale: "en" },
    );
    const interrupted = errors[1] as Error & { code?: string };
    expect(interrupted.message).toBe("Generation was interrupted.");
    expect(interrupted.code).toBe("interrupted");
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
