/**
 * The picture road through the remote engine, end to end at the seams a
 * jest run can hold: /props is re-read for the send, the prepared bytes
 * become `data:` parts after the text, a text-only desk gets the placeholder
 * sentence instead, and every way a picture can fail is a refusal the user
 * can read. The file reader and the stored sizes are mocked — they are expo's.
 */
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

jest.mock("./remoteImageBytes", () => ({
  readRemotePictures: jest.fn(async () => new Map()),
  storedPictureSizes: jest.fn(async () => new Map()),
}));

jest.mock("../thinkStream", () => ({
  createThinkStreamCleaner: jest.fn(() => ({
    cleanDelta: (text: string) => text,
    finalize: (text: string) => text,
  })),
}));

import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn } from "./RemoteEngine";
import { getRemoteVision } from "./modalities";
import { PROBE_JSON_TIMEOUT_MS } from "../../remote/doorRoad";
import { setRemoteBrainUrl, setRemoteServerModelId } from "./remoteSettings";
import type { OpenAiChatMessage, RemotePicture } from "./openaiMessages";

const DATA_URI = "data:image/jpeg;base64,AAAA";
const PICTURE_URI = "file:///a.jpg";
const PICTURE: RemotePicture = { uri: PICTURE_URI, bytes: 3, dataUri: DATA_URI };

const fetchMock = jest.fn();
const hadFetch = "fetch" in globalThis;
const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  if (hadFetch) (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  else delete (globalThis as { fetch?: typeof fetch }).fetch;
});

function mocked(name: string): jest.Mock {
  const module = jest.requireMock("./remoteImageBytes") as Record<string, jest.Mock>;
  return module[name];
}

function streamOpenAiChat(): jest.Mock {
  return (jest.requireMock("./openaiTransport") as { streamOpenAiChat: jest.Mock })
    .streamOpenAiChat;
}

/** One complete answer, so the turn settles. */
function completeStreamMock(): void {
  streamOpenAiChat().mockImplementation((
    _req: unknown,
    handlers: { onFinish: (f: { kind: string; finishReason: string }) => void },
  ) => {
    queueMicrotask(() => handlers.onFinish({ kind: "complete", finishReason: "stop" }));
    return { requestId: "images-turn", abort: jest.fn(), xhr: {}, isClosed: () => false };
  });
}

/** The probe answers /props with `vision`; every other read is the model list. */
function answerPropsAndModels(vision: boolean): void {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith("/props")) {
      return { ok: true, status: 200, json: async () => ({ modalities: { vision } }) };
    }
    return { ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) };
  });
}

async function sendWithPicture(onError: jest.Mock = jest.fn()): Promise<OpenAiChatMessage[]> {
  await streamRemoteAssistantTurn(
    [{ role: "user", content: "look", images: [PICTURE_URI] }],
    { onDelta: () => undefined, onDone: () => undefined, onError },
    undefined,
    { locale: "en", turnId: "t-images" },
  );
  const request = streamOpenAiChat().mock.calls[0]?.[0] as { messages: OpenAiChatMessage[] };
  return request?.messages ?? [];
}

describe("the remote picture road", () => {
  beforeEach(async () => {
    (jest.requireMock("@react-native-async-storage/async-storage") as { __reset: () => void }).__reset();
    fetchMock.mockReset();
    streamOpenAiChat().mockReset();
    mocked("storedPictureSizes").mockReset().mockResolvedValue(new Map([[PICTURE_URI, 300_000]]));
    mocked("readRemotePictures").mockReset().mockResolvedValue(new Map([[PICTURE_URI, PICTURE]]));
    answerPropsAndModels(true);
    await setRemoteBrainUrl("http://127.0.0.1:8000");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
  });

  afterEach(async () => {
    await disposeRemoteEngine();
    jest.useRealTimers();
  });

  test("the send re-reads /props and rides the picture as a part after the text", async () => {
    completeStreamMock();
    fetchMock.mockClear();
    const messages = await sendWithPicture();

    // Freshness: the desk's own word is asked again for the turn that carries
    // a picture, not trusted from the init probe.
    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://127.0.0.1:8000/props",
    ]);
    expect(getRemoteVision()).toBe(true);
    // Only the rider's bytes are ever read, and the system prompt rides first.
    expect(mocked("readRemotePictures")).toHaveBeenCalledWith([PICTURE_URI]);
    expect(messages[0].role).toBe("system");
    expect(messages.filter((message) => message.role === "user")).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: DATA_URI } },
        ],
      },
    ]);
  });

  test("a desk whose model cannot see refuses the picture the user is waiting on", async () => {
    answerPropsAndModels(false);
    const onError = jest.fn();
    await sendWithPicture(onError);

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect(mocked("readRemotePictures")).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_no_vision");
  });

  test("a picture the phone cannot read refuses the send with its own sentence", async () => {
    mocked("readRemotePictures").mockResolvedValue(new Map());
    const onError = jest.fn();
    await sendWithPicture(onError);

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_image_unreadable");
  });

  test("the current turn's own picture over the ceiling refuses it before any read", async () => {
    mocked("storedPictureSizes").mockResolvedValue(new Map([[PICTURE_URI, 12 * 1024 * 1024]]));
    const onError = jest.fn();
    await sendWithPicture(onError);

    expect(mocked("readRemotePictures")).not.toHaveBeenCalled();
    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_images_too_big");
  });

  test("a desk that cannot be reached refuses the picture rather than send it blind", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).endsWith("/props")) {
        return { ok: false, status: 503, json: async () => null };
      }
      return { ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) };
    });
    const onError = jest.fn();
    await sendWithPicture(onError);

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_network");
  });

  test("a /props read that never answers is bounded, and the picture is refused", async () => {
    jest.useFakeTimers();
    fetchMock.mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
      if (String(url).endsWith("/props")) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [{ id: "ornith" }] }) });
    });
    const onError = jest.fn();
    const turn = sendWithPicture(onError);
    await jest.advanceTimersByTimeAsync(PROBE_JSON_TIMEOUT_MS + 1);
    await turn;

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_network");
  });

  test("a model edited while the pictures were being read supersedes the turn", async () => {
    completeStreamMock();
    // The door changes under the turn's feet — the verdict and the plan
    // describe the server it started with, and neither may be acted on.
    mocked("readRemotePictures").mockImplementation(async () => {
      await setRemoteServerModelId("another-model");
      return new Map([[PICTURE_URI, PICTURE]]);
    });
    const onError = jest.fn();
    await sendWithPicture(onError);

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_stale_init");
    // And the stale verdict was not written back as this phone's capability.
    expect(getRemoteVision()).toBe(false);
  });
});
