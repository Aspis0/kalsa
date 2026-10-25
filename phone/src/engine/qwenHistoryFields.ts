import { THINK_CLOSE, THINK_OPEN } from "./thinkStream";

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

  const opening = `${THINK_OPEN}\n`;
  if (!source.startsWith(opening)) {
    // A zero-separator block cannot round-trip through a template that always
    // adds its newline wrappers; the raw older shape preserves the prefix.
    return {
      content: source,
      reasoning_content: QWEN_HISTORY_OLDER_REASONING_SENTINEL,
    };
  }
  const inner = source.slice(opening.length, closeIndex);
  const reasoning_content = stripTrailingReasoningNewlines(inner);
  const afterClose = source.slice(closeIndex + THINK_CLOSE.length);
  const content = afterClose.startsWith("\n\n") ? afterClose.slice(2) : afterClose;
  const rendered = `${opening}${reasoning_content}\n${THINK_CLOSE}\n\n${content}`;
  if (rendered !== source) {
    // A non-canonical separator cannot round-trip through the template; the
    // raw older shape preserves the prefix.
    return {
      content: source,
      reasoning_content: QWEN_HISTORY_OLDER_REASONING_SENTINEL,
    };
  }
  return { content, reasoning_content };
}
