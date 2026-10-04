import type { EngineMessage } from "../LlamaService";
import {
  fitsWireBody,
  selectWireImages,
  type WireImage,
} from "./wireBudget";

export type OpenAiContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/** A picture the wire may carry: what it weighs, and the stored URI the
    messages and the reader name it by. */
interface WireImageCandidate extends WireImage {
  uri: string;
}

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
 * demote. `sizeOf` answers what the picture weighs; a URI it cannot answer
 * for is not a candidate: it can only be a placeholder.
 */
export function collectWireImages(
  messages: readonly EngineMessage[],
  sizeOf: (uri: string) => number | undefined,
): { images: WireImageCandidate[]; protect: number } {
  const images: WireImageCandidate[] = [];
  let protect = 0;
  messages.forEach((msg, index) => {
    if (msg.role !== "user") return;
    let here = 0;
    for (const uri of msg.images ?? []) {
      const bytes = sizeOf(uri);
      if (bytes === undefined) continue;
      images.push({ uri, bytes });
      here += 1;
    }
    if (index === messages.length - 1) protect = here;
  });
  return { images, protect };
}

/** The pictures of the turn being sent — the last message's own, which the
    person is waiting on and which may not be dropped in silence. */
function currentTurnImages(messages: readonly EngineMessage[]): readonly string[] {
  const last = messages[messages.length - 1];
  return last?.role === "user" ? last.images ?? [] : [];
}

/** Why a turn's pictures cannot go as they are: the body ceiling, a picture
    this phone could not read, or a desk whose model cannot see. */
export type RemoteImageRefusal = "images_too_big" | "image_unreadable" | "vision_off";

export type RemoteTurnPlan =
  | { ok: true; messages: OpenAiChatMessage[] }
  | { ok: false; reason: RemoteImageRefusal };

/**
 * The turn's messages with the pictures the door can take. The STORED sizes
 * decide first, so a picture the budget would demote is never read or
 * encoded; the prepared sizes decide again, because encoding can change a
 * picture's weight. The current turn's own pictures are read first and are
 * never demoted — a turn that cannot carry them is refused instead, because
 * the person attached them and would otherwise send blind.
 *
 * `bodyBytes` measures the very JSON the transport will send, and `readPictures`
 * prepares exactly the URIs it is handed, in the order it receives them.
 */
export async function planRemoteTurn(args: {
  messages: readonly EngineMessage[];
  system?: string;
  /** The fresh /props verdict: a text-only desk keeps the past as sentences
      and refuses a picture attached to THIS turn. */
  vision: boolean;
  /** What each stored picture weighs, by URI, without reading any bytes. */
  sizes: ReadonlyMap<string, number>;
  readPictures: (uris: readonly string[]) => Promise<ReadonlyMap<string, RemotePicture>>;
  bodyBytes: (messages: OpenAiChatMessage[]) => number;
}): Promise<RemoteTurnPlan> {
  const { messages, system, vision, sizes, readPictures, bodyBytes } = args;
  const textOnly = toOpenAiMessages(messages, system);
  const currentTurn = currentTurnImages(messages);
  if (!vision) {
    // A model that cannot see may keep the past as sentences, but the picture
    // the person just attached must not vanish without a word.
    return currentTurn.length > 0
      ? { ok: false, reason: "vision_off" }
      : { ok: true, messages: textOnly };
  }
  const wanted = collectWireImages(messages, (uri) => sizes.get(uri));
  if (wanted.images.length === 0) {
    return currentTurn.length > 0
      ? { ok: false, reason: "image_unreadable" }
      : { ok: true, messages: textOnly };
  }
  const nonImageBytes = bodyBytes(textOnly);
  const guarded = selectWireImages(wanted.images, nonImageBytes, wanted.protect);
  // The current turn's own pictures alone over the ceiling: refused here, on
  // their stored weight, so nobody reads bytes that cannot be sent anyway.
  if (!fitsWireBody(nonImageBytes, guarded.imageBytes)) {
    return { ok: false, reason: "images_too_big" };
  }
  // Read the riders newest-first — this turn's own before any of the past —
  // and only them: a picture the budget demoted is never read at all.
  const riding: string[] = [];
  for (let index = wanted.images.length - 1; index >= 0; index -= 1) {
    if (guarded.rides.has(index)) riding.push(wanted.images[index].uri);
  }
  const pictures = await readPictures(riding);
  if (currentTurn.some((uri) => !pictures.has(uri))) {
    return { ok: false, reason: "image_unreadable" };
  }
  const settled = collectWireImages(messages, (uri) => pictures.get(uri)?.bytes);
  const pick = selectWireImages(settled.images, nonImageBytes, settled.protect);
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
