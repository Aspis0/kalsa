import type { ChatMessage } from "./types";

/** The stored messages that reach the wire. An empty assistant row is the turn
    being written, not something the model said, so it never goes out. */
export function wireTurns(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !(m.role === "assistant" && m.content === ""))
    .filter((m) => m.content.length > 0 || m.role === "user");
}
