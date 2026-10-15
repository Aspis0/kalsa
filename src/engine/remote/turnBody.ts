/**
 * The wire body of a turn to the computer (PHONE-CHAT-PROTOCOL §2): the
 * conversation as `user`/`assistant` words, the mail a reply is for, and the
 * phone's own language.
 *
 * No system message rides here and no phone prompt does: the computer adds
 * its own, and a second personality on the wire would fight it. That is also
 * why this is not `toOpenAiMessages` — that maps pictures and a system
 * prompt, which this route has no use for.
 */
import type { EngineMessage } from "../LlamaService";
import type { OpenAiChatMessage } from "./openaiMessages";

/** The route a text-only turn asks for before anything else is tried. */
export const TURN_ROUTE_PATH = "/kalsa/chat/turn";

/** The conversation as the contract names it: `EngineMessage` carries no
 *  system message at all, so nothing to strip — the phone's prompt rides the
 *  OpenAI route and never this one. */
export function toTurnMessages(messages: readonly EngineMessage[]): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  for (const message of messages) {
    const raw =
      message.role === "assistant" && typeof message.modelEmittedText === "string"
        ? message.modelEmittedText
        : message.content;
    if (typeof raw !== "string" || raw.trim() === "") continue;
    out.push({ role: message.role, content: raw });
  }
  return out;
}

/** The JSON `POST /kalsa/chat/turn` sends. `reply_for` is a mail id; the
 *  computer refuses anything but digits, so the phone never checks a shape
 *  it did not invent. */
export function turnBodyJson(args: {
  messages: readonly OpenAiChatMessage[];
  replyFor?: string;
  language?: string;
}): string {
  return JSON.stringify({
    messages: args.messages,
    ...(args.replyFor ? { reply_for: args.replyFor } : {}),
    ...(args.language ? { language: args.language } : {}),
  });
}