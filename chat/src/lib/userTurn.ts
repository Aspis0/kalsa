import { sentDatePhrase } from "./sentDate";
import type { ChatMessage } from "./types";

/** The user turn a send creates: its words, the moment it was sent, and the day
    it was sent on. Riders (pictures, videos, bound documents) come ready-made,
    and only the ones that exist are passed, so no key is written as undefined. */
export function newUserTurn(
  id: string,
  text: string,
  sentAt: Date,
  riders: Partial<Pick<ChatMessage, "images" | "videos" | "docs" | "docTokens">> = {},
): ChatMessage {
  return {
    id,
    role: "user",
    content: text,
    createdAt: sentAt.getTime(),
    sentOn: sentDatePhrase(sentAt),
    ...riders,
  };
}
