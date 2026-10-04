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

  test("no seeing desk: every picture is the sentence, and no part is built", () => {
    const plan = planRemoteTurn({
      messages: [history, current],
      vision: false,
      pictures: new Map([
        ["file:///old.jpg", picture("file:///old.jpg")],
        ["file:///now.jpg", picture("file:///now.jpg")],
      ]),
      bodyBytes,
    });
    expect(plan).toEqual({
      ok: true,
      messages: [
        { role: "user", content: `older\n${IMAGE_PLACEHOLDER}` },
        { role: "user", content: `look\n${IMAGE_PLACEHOLDER}` },
      ],
    });
  });

  test("with vision both pictures ride, against the body the transport will send", () => {
    const plan = planRemoteTurn({
      messages: [history, current],
      system: "sys",
      vision: true,
      pictures: new Map([
        ["file:///old.jpg", picture("file:///old.jpg")],
        ["file:///now.jpg", picture("file:///now.jpg")],
      ]),
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

  test("a body already at the ceiling demotes the oldest first, never the current turn", () => {
    // The port stands in for the serializer: what this case needs is a body
    // whose weight leaves room for the current turn's small picture only.
    const plan = planRemoteTurn({
      messages: [history, current],
      vision: true,
      pictures: new Map([
        ["file:///old.jpg", picture("file:///old.jpg", 4 * 1024 * 1024)],
        ["file:///now.jpg", picture("file:///now.jpg")],
      ]),
      bodyBytes: () => WIRE_BODY_BUDGET - 1_000,
    });
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

  test("the current turn's own picture alone too heavy: the send is refused, not trimmed", () => {
    const heavy = picture("file:///now.jpg", 12 * 1024 * 1024);
    expect(wireImageBytes(heavy.bytes)).toBeGreaterThan(WIRE_BODY_BUDGET);
    const plan = planRemoteTurn({
      messages: [current],
      vision: true,
      pictures: new Map([["file:///now.jpg", heavy]]),
      bodyBytes,
    });
    expect(plan).toEqual({ ok: false, reason: "images_too_big" });
  });

  test("a picture whose file is gone is a placeholder, never an empty part", () => {
    const plan = planRemoteTurn({
      messages: [current],
      vision: true,
      pictures: new Map(),
      bodyBytes,
    });
    expect(plan).toEqual({
      ok: true,
      messages: [{ role: "user", content: `look\n${IMAGE_PLACEHOLDER}` }],
    });
  });
});
