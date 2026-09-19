import { THINK_CLOSE, THINK_OPEN } from "./thinkStream";

export type QwenHistoryAssistantFields = {
  content: string;
  reasoning_content?: string;
};

/**
 * Older turns keep the raw span and use a non-empty sentinel; the final turn
 * moves the answer and trimmed reasoning into the fields the template reads.
 */
export function qwenHistoryAssistantFields(
  message: { content: string; modelEmittedText?: string },
  isFinal: boolean,
): QwenHistoryAssistantFields {
  const source =
    typeof message.modelEmittedText === "string" && message.modelEmittedText.length > 0
      ? message.modelEmittedText
      : message.content;
  const closeIndex = source.indexOf(THINK_CLOSE);
  if (closeIndex < 0) return { content: source };
  if (!isFinal) return { content: source, reasoning_content: " " };

  const opening = `${THINK_OPEN}\n`;
  const reasoningStart = source.startsWith(opening)
    ? opening.length
    : source.startsWith(THINK_OPEN)
      ? THINK_OPEN.length
      : 0;
  const reasoning_content = source
    .slice(reasoningStart, closeIndex)
    .replace(/\n+$/, "");
  const afterClose = source.slice(closeIndex + THINK_CLOSE.length);
  const content = afterClose.startsWith("\n\n") ? afterClose.slice(2) : afterClose;
  return { content, reasoning_content };
}
