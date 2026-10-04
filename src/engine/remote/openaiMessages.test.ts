import {
  IMAGE_PLACEHOLDER,
  planRemoteTurn,
  remoteChatBodyJson,
  toOpenAiMessages,
  type OpenAiChatMessage,
  type RemotePicture,
} from "./openaiMessages";
import { WIRE_BODY_BUDGET, wireBodyBytes, wireImageBytes } from "./wireBudget";
import type { EngineMessage } from "../LlamaService";

const DATA_URI = "data:image/jpeg;base64,AAAA";

/** A prepared picture: `bytes` is what the budget counts, the URI what the
    part carries (short here — the decision never reads the string). */
function picture(uri: string, bytes = 3): RemotePicture {
  return { uri, bytes, dataUri: DATA_URI };
}

/** The real serializer, as the engine wires it: the budget measures the very
    JSON the transport sends. */
const bodyBytes = (messages: readonly OpenAiChatMessage[]) =>
  wireBodyBytes(remoteChatBodyJson({ model: "m", messages, maxTokens: 512, temperature: 0.7 }));

/** Prepares whatever it is handed, at the size the test declared. */
function reader(sizes: ReadonlyMap<string, number>, prepared: Map<string, RemotePicture>) {
  return async (uris: readonly string[]): Promise<Map<string, RemotePicture>> => {
    for (const uri of uris) prepared.set(uri, picture(uri, sizes.get(uri) ?? 3));
    return prepared;
  };
}

describe("toOpenAiMessages", () => {
  test("maps user and assistant, prefers modelEmittedText", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: "hi" },
      { role: "assistant", content: "cleaned", modelEmittedText: "raw" },
    ];
    expect(toOpenAiMessages(messages, "sys")).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "hi" },
      { role: "assistant", content: "raw" },
    ]);
  });

  test("drops empty system and unknown roles", () => {
    const messages = [
      { role: "user", content: "q" },
    ] as EngineMessage[];
    expect(toOpenAiMessages(messages, "  ")).toEqual([
      { role: "user", content: "q" },
    ]);
  });

  test("a picture rides as a part AFTER the text, and only when its ride is chosen", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: "look", images: ["file:///a.jpg"] },
    ];
    const pictures = new Map([["file:///a.jpg", picture("file:///a.jpg")]]);
    expect(toOpenAiMessages(messages, "sys", { pictures, rides: new Set([0]) })).toEqual([
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "look" },
          { type: "image_url", image_url: { url: DATA_URI } },
        ],
      },
    ]);
  });

  test("the text-only shape never carries a part: each picture becomes the sentence", () => {
    const messages: EngineMessage[] = [
      { role: "user", content: "", images: ["file:///a.jpg"] },
      { role: "user", content: "and this", images: ["file:///b.jpg", "file:///c.jpg"] },
    ];
    expect(toOpenAiMessages(messages)).toEqual([
      { role: "user", content: IMAGE_PLACEHOLDER },
      { role: "user", content: `and this\n${IMAGE_PLACEHOLDER}\n${IMAGE_PLACEHOLDER}` },
    ]);
  });
});

describe("planRemoteTurn", () => {
  const history: EngineMessage = { role: "user", content: "older", images: ["file:///old.jpg"] };
  const current: EngineMessage = { role: "user", content: "look", images: ["file:///now.jpg"] };

  test("with vision both pictures ride, against the body the transport will send", async () => {
    const sizes = new Map([
      ["file:///old.jpg", 3],
      ["file:///now.jpg", 3],
    ]);
    const plan = await planRemoteTurn({
      messages: [history, current],
      system: "sys",
      vision: true,
      sizes,
      readPictures: reader(sizes, new Map()),
      bodyBytes,
    });
    expect(plan).toEqual({
      ok: true,
      messages: [
        { role: "system", content: "sys" },
        {
          role: "user",
          content: [
            { type: "text", text: "older" },
            { type: "image_url", image_url: { url: DATA_URI } },
          ],
        },
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: DATA_URI } },
          ],
        },
      ],
    });
  });

  test("a body at the ceiling demotes the oldest first — and never reads it", async () => {
    const sizes = new Map([
      ["file:///old.jpg", 4 * 1024 * 1024],
      ["file:///now.jpg", 3],
    ]);
    const read: string[][] = [];
    const prepared = new Map<string, RemotePicture>();
    const plan = await planRemoteTurn({
      messages: [history, current],
      vision: true,
      sizes,
      readPictures: async (uris) => {
        read.push([...uris]);
        return reader(sizes, prepared)(uris);
      },
      // The port stands in for the serializer: what this case needs is a body
      // whose weight leaves room for the current turn's small picture only.
      bodyBytes: () => WIRE_BODY_BUDGET - 1_000,
    });
    // Only the rider was read, and the current turn came first.
    expect(read).toEqual([["file:///now.jpg"]]);
    expect(plan).toEqual({
      ok: true,
      messages: [
        { role: "user", content: `older\n${IMAGE_PLACEHOLDER}` },
        {
          role: "user",
          content: [
            { type: "text", text: "look" },
            { type: "image_url", image_url: { url: DATA_URI } },
          ],
        },
      ],
    });
  });

  test("the current turn's own picture alone too heavy: refused before anything is read", async () => {
    const sizes = new Map([["file:///now.jpg", 12 * 1024 * 1024]]);
    expect(wireImageBytes(12 * 1024 * 1024)).toBeGreaterThan(WIRE_BODY_BUDGET);
    const readPictures = jest.fn(async () => new Map<string, RemotePicture>());
    const plan = await planRemoteTurn({
      messages: [current],
      vision: true,
      sizes,
      readPictures,
      bodyBytes,
    });
    expect(readPictures).not.toHaveBeenCalled();
    expect(plan).toEqual({ ok: false, reason: "images_too_big" });
  });

  test("a picture of this turn that cannot be read refuses the send, never text-only", async () => {
    const gone = await planRemoteTurn({
      messages: [current],
      vision: true,
      sizes: new Map(),
      readPictures: jest.fn(async () => new Map<string, RemotePicture>()),
      bodyBytes,
    });
    // The file was there when it was attached, and the bytes are gone now.
    expect(gone).toEqual({ ok: false, reason: "image_unreadable" });
    const failed = await planRemoteTurn({
      messages: [current],
      vision: true,
      sizes: new Map([["file:///now.jpg", 3]]),
      readPictures: jest.fn(async () => new Map<string, RemotePicture>()),
      bodyBytes,
    });
    expect(failed).toEqual({ ok: false, reason: "image_unreadable" });
  });

  test("a seeing model or a readable file is required for THIS turn, not for the past", async () => {
    const blind = await planRemoteTurn({
      messages: [history, current],
      vision: false,
      sizes: new Map([["file:///now.jpg", 3]]),
      readPictures: jest.fn(async () => new Map<string, RemotePicture>()),
      bodyBytes,
    });
    expect(blind).toEqual({ ok: false, reason: "vision_off" });

    const past = await planRemoteTurn({
      messages: [history, { role: "user", content: "and now" }],
      vision: false,
      sizes: new Map(),
      readPictures: jest.fn(async () => new Map<string, RemotePicture>()),
      bodyBytes,
    });
    expect(past).toEqual({
      ok: true,
      messages: [
        { role: "user", content: `older\n${IMAGE_PLACEHOLDER}` },
        { role: "user", content: "and now" },
      ],
    });
  });
});
