import { THINK_CLOSE } from "./thinkStream";

export type QwenHistoryAssistantFields = {
  content: string;
  reasoning_content?: string;
};

// A single space is asserted never rendered by the current template, measured
// against the catalogue GGUF with --jinja --reasoning-format none on
// 18/09/2026; it only prevents Qwen's older content span from being split.
export const QWEN_HISTORY_OLDER_REASONING_SENTINEL = " ";

// This rstrip is measured at 195 vs 235 reused tokens over one newline: the
// template's |trim does not take effect on this path (same GGUF and flags,
// measured 18/09/2026).
function stripTrailingReasoningNewlines(value: string): string {
  return value.replace(/\n+$/, "");
}

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
  if (!isFinal) {
    return {
      content: source,
      reasoning_content: QWEN_HISTORY_OLDER_REASONING_SENTINEL,
    };
  }

  const leading = source.match(/^[ \t\r\n]*<think>/);
  const opening = leading?.[0];
  const inner = opening ? source.slice(opening.length, closeIndex) : "";
  if (!opening || inner.length < 2 || !inner.startsWith("\n")) {
    // A zero-separator block cannot round-trip through a template that always
    // adds its newline wrappers; the raw older shape preserves the prefix.
    return {
      content: source,
      reasoning_content: QWEN_HISTORY_OLDER_REASONING_SENTINEL,
    };
  }
  const reasoning_content = stripTrailingReasoningNewlines(inner.slice(1));
  const afterClose = source.slice(closeIndex + THINK_CLOSE.length);
  const content = afterClose.startsWith("\n\n") ? afterClose.slice(2) : afterClose;
  return { content, reasoning_content };
}
