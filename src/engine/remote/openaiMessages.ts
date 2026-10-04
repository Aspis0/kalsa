import type { EngineMessage } from "../LlamaService";
import {
  fitsWireBody,
  selectWireImages,
  type WireImage,
} from "./wireBudget";

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export type OpenAiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string | OpenAiContentPart[];
};

/**
 * One staged picture as the wire needs it: the stored file's URI (the key the
 * engine messages carry), the sanitized JPEG's own length, and the `data:`
 * URI it becomes. Bytes only ever exist for the send that read the file —
 * history keeps URIs, never base64.
 */
export interface RemotePicture {
  uri: string;
  bytes: number;
  dataUri: string;
}

/** Where a picture the model cannot be given would have been: one sentence
    per picture, inside the text part. English on purpose — it is wire text
    the model reads, like the desktop's own line. */
export const IMAGE_PLACEHOLDER = "[an image the current AI cannot see]";

function messageText(msg: EngineMessage): string {
  const raw =
    msg.role === "assistant" &&
    typeof msg.modelEmittedText === "string" &&
    msg.modelEmittedText.length > 0
      ? msg.modelEmittedText
      : msg.content;
  return typeof raw === "string" ? raw : "";
}

function placeholderText(text: string, count: number): string {
  const lines = new Array<string>(count).fill(IMAGE_PLACEHOLDER);
  return [text, ...lines].filter((line) => line.length > 0).join("\n");
}

function isUserOrAssistant(role: string): role is "user" | "assistant" {
  return role === "user" || role === "assistant";
}

/**
 * Map engine history to OpenAI chat messages. Without `media` every picture
 * becomes the placeholder sentence — the shape a model that cannot see is
 * asked in. With `media`, the pictures `rides` names ride as parts after a
 * text part that always comes first.
 */
export function toOpenAiMessages(
  messages: readonly EngineMessage[],
  system?: string,
  media?: {
    pictures: ReadonlyMap<string, RemotePicture>;
    rides: ReadonlySet<number>;
  },
): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  if (typeof system === "string" && system.trim().length > 0) {
    out.push({ role: "system", content: system.trim() });
  }
  // The occurrence index a picture would get in `collectWireImages`: both
  // walks visit the same messages in the same order, so a part can never
  // disagree with the budget that chose it.
  let at = 0;
  for (const msg of messages) {
    if (!isUserOrAssistant(msg.role)) continue;
    const text = messageText(msg);
    const uris = msg.role === "user" ? msg.images ?? [] : [];
    if (uris.length === 0) {
      out.push({ role: msg.role, content: text });
      continue;
    }
    const parts: OpenAiContentPart[] = [];
    let placeholders = 0;
    for (const uri of uris) {
      const picture = media?.pictures.get(uri);
      if (picture === undefined) {
        placeholders += 1;
        continue;
      }
      const occurrence = at;
      at += 1;
      if (media?.rides.has(occurrence)) {
        parts.push({ type: "image_url", image_url: { url: picture.dataUri } });
      } else {
        placeholders += 1;
      }
    }
    const composed = placeholderText(text, placeholders);
    if (parts.length === 0) {
      out.push({ role: msg.role, content: composed });
      continue;
    }
    out.push({
      role: msg.role,
      content: [
        ...(composed.length > 0 ? [{ type: "text", text: composed } as const] : []),
        ...parts,
      ],
    });
  }
  return out;
}

/**
 * Every picture a turn's messages carry, in the order the mapper reaches them
 * (message by message, URI by URI), and how many trailing ones are THIS
 * turn's own — the last message's — which a budget is never allowed to
 * demote. A URI without prepared bytes is not a candidate: it can only be a
 * placeholder.
 */
export function collectWireImages(
  messages: readonly EngineMessage[],
  pictures: ReadonlyMap<string, RemotePicture>,
): { images: WireImage[]; protect: number } {
  const images: WireImage[] = [];
  let protect = 0;
  messages.forEach((msg, index) => {
    if (msg.role !== "user") return;
    let here = 0;
    for (const uri of msg.images ?? []) {
      const picture = pictures.get(uri);
      if (picture === undefined) continue;
      images.push({ bytes: picture.bytes });
      here += 1;
    }
    if (index === messages.length - 1) protect = here;
  });
  return { images, protect };
}

export type RemoteTurnPlan =
  | { ok: true; messages: OpenAiChatMessage[] }
  | { ok: false; reason: "images_too_big" };

/**
 * The turn's messages with the pictures the door can take, chosen against the
 * body's REAL weight (`bodyBytes` measures the very JSON the transport will
 * send): newest first, the current turn's own never demoted, and a refusal
 * when even those cannot fit. A picture that was demoted, whose file is gone,
 * or that faces a model which cannot see becomes the placeholder sentence.
 */
export function planRemoteTurn(args: {
  messages: readonly EngineMessage[];
  system?: string;
  vision: boolean;
  pictures: ReadonlyMap<string, RemotePicture>;
  bodyBytes: (messages: OpenAiChatMessage[]) => number;
}): RemoteTurnPlan {
  const { messages, system, vision, pictures, bodyBytes } = args;
  const textOnly = toOpenAiMessages(messages, system);
  if (!vision) return { ok: true, messages: textOnly };
  const { images, protect } = collectWireImages(messages, pictures);
  if (images.length === 0) return { ok: true, messages: textOnly };
  const nonImageBytes = bodyBytes(textOnly);
  const pick = selectWireImages(images, nonImageBytes, protect);
  if (!fitsWireBody(nonImageBytes, pick.imageBytes)) {
    return { ok: false, reason: "images_too_big" };
  }
  return {
    ok: true,
    messages: toOpenAiMessages(messages, system, { pictures, rides: pick.rides }),
  };
}

/**
 * The JSON `streamOpenAiChat` sends. One constructor for the body, so a budget
 * that measures against it measures the bytes the door will actually read.
 */
export function remoteChatBodyJson(args: {
  model: string;
  messages: readonly OpenAiChatMessage[];
  maxTokens: number;
  temperature: number;
}): string {
  return JSON.stringify({
    model: args.model,
    messages: args.messages,
    stream: true,
    max_tokens: args.maxTokens,
    temperature: args.temperature,
  });
}
