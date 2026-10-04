/**
 * The picture road through the remote engine, end to end at the seams a
 * jest run can hold: /props is re-read for the send, the prepared bytes
 * become `data:` parts after the text, a text-only desk gets the placeholder
 * sentence instead, and a turn whose own pictures break the body ceiling is
 * refused with its own code. The file reader is mocked — it is expo's.
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
}));

jest.mock("../thinkStream", () => ({
  createThinkStreamCleaner: jest.fn(() => ({
    cleanDelta: (text: string) => text,
    finalize: (text: string) => text,
  })),
}));

import { disposeRemoteEngine, initRemoteEngine, streamRemoteAssistantTurn } from "./RemoteEngine";
import { getRemoteVision } from "./modalities";
import { setRemoteBrainUrl } from "./remoteSettings";
import type { OpenAiChatMessage } from "./openaiMessages";
import type { RemotePicture } from "./openaiMessages";
import type { EngineMessage } from "../LlamaService";

const DATA_URI = "data:image/jpeg;base64,AAAA";
const PICTURE: RemotePicture = { uri: "file:///a.jpg", bytes: 3, dataUri: DATA_URI };

const fetchMock = jest.fn();
const hadFetch = "fetch" in globalThis;
const originalFetch = (globalThis as { fetch: typeof fetch }).fetch;
(globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

afterAll(() => {
  if (hadFetch) (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
  else delete (globalThis as { fetch?: typeof fetch }).fetch;
});

function readRemotePictures(): jest.Mock {
  return (jest.requireMock("./remoteImageBytes") as { readRemotePictures: jest.Mock })
    .readRemotePictures;
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

async function sendWithPicture(): Promise<OpenAiChatMessage[]> {
  const picture: EngineMessage = {
    role: "user",
    content: "look",
    images: ["file:///a.jpg"],
  };
  await streamRemoteAssistantTurn(
    [picture],
    { onDelta: () => undefined, onDone: () => undefined, onError: () => undefined },
    undefined,
    { locale: "en", turnId: "t-images" },
  );
  const request = streamOpenAiChat().mock.calls[0][0] as { messages: OpenAiChatMessage[] };
  return request.messages;
}

describe("the remote picture road", () => {
  beforeEach(async () => {
    (jest.requireMock("@react-native-async-storage/async-storage") as { __reset: () => void }).__reset();
    fetchMock.mockReset();
    streamOpenAiChat().mockReset();
    readRemotePictures().mockReset().mockResolvedValue(new Map([["file:///a.jpg", PICTURE]]));
    answerPropsAndModels(true);
    await setRemoteBrainUrl("http://127.0.0.1:8000");
    await initRemoteEngine("", "kalsa-remote-mac", { locale: "en" });
  });

  afterEach(async () => {
    await disposeRemoteEngine();
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
    // The system prompt rides first, then the user turn with text before the
    // picture part.
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

  test("a desk that cannot see gets the placeholder sentence and no file is read", async () => {
    completeStreamMock();
    answerPropsAndModels(false);
    const messages = await sendWithPicture();

    expect(readRemotePictures()).not.toHaveBeenCalled();
    expect(getRemoteVision()).toBe(false);
    expect(messages.filter((message) => message.role === "user")).toEqual([
      { role: "user", content: "look\n[an image the current AI cannot see]" },
    ]);
  });

  test("the current turn's own picture over the body ceiling refuses the send, with its code", async () => {
    streamOpenAiChat().mockImplementation(() => {
      throw new Error("the transport must not be reached");
    });
    readRemotePictures().mockResolvedValue(
      new Map([["file:///a.jpg", { ...PICTURE, bytes: 12 * 1024 * 1024 }]]),
    );
    const onError = jest.fn();
    await streamRemoteAssistantTurn(
      [{ role: "user", content: "look", images: ["file:///a.jpg"] }],
      { onDelta: () => undefined, onDone: () => undefined, onError },
      undefined,
      { locale: "en", turnId: "t-images-big" },
    );

    expect(streamOpenAiChat()).not.toHaveBeenCalled();
    expect((onError.mock.calls[0][0] as Error).message).toBe("remote_brain_images_too_big");
  });
});
