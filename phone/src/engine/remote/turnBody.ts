/**
 * The wire body of a turn to the computer (PHONE-CHAT-PROTOCOL §2): the
 * conversation as `user`/`assistant` words, the mail a reply is for, the
 * phone's own language, and what this phone can draw.
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

/** What this phone can draw on a turn: the browser confirm card. The computer
 *  reads it to know a card may be sent to this phone at all (§3.1). */
export const TURN_CAPABILITIES = ["browser_card"] as const;

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
 *  it did not invent. `capabilities` says what this phone can draw, so the
 *  computer knows a card it holds may be drawn here.
 *
 *  **No `device`, and there is nowhere to put one** (PHONE-CHAT-PROTOCOL §2):
 *  the pairing seal hands back a credential and nothing else, so a phone
 *  cannot name itself or another phone. Which device is asking is resolved by
 *  the door from the `Authorization` header before the body is even parsed,
 *  and a `device` in here would be dropped like any other unknown field. That
 *  is also what makes a card drawable on this turn's phone and no desktop. */
export function turnBodyJson(args: {
  messages: readonly OpenAiChatMessage[];
  replyFor?: string;
  language?: string;
  capabilities: readonly string[];
}): string {
  return JSON.stringify({
    messages: args.messages,
    ...(args.replyFor ? { reply_for: args.replyFor } : {}),
    ...(args.language ? { language: args.language } : {}),
    capabilities: args.capabilities,
  });
}