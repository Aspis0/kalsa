import type { EngineMessage } from "../LlamaService";

export type OpenAiChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/** Map engine history to OpenAI chat messages. Images are dropped (text-only). */
export function toOpenAiMessages(
  messages: EngineMessage[],
  system?: string,
): OpenAiChatMessage[] {
  const out: OpenAiChatMessage[] = [];
  if (typeof system === "string" && system.trim().length > 0) {
    out.push({ role: "system", content: system.trim() });
  }
  for (const msg of messages) {
    if (msg.role !== "user" && msg.role !== "assistant") continue;
    const raw =
      msg.role === "assistant" &&
      typeof msg.modelEmittedText === "string" &&
      msg.modelEmittedText.length > 0
        ? msg.modelEmittedText
        : msg.content;
    out.push({
      role: msg.role,
      content: typeof raw === "string" ? raw : "",
    });
  }
  return out;
}
