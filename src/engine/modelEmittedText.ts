/**
 * Separate "what the model emitted" from "what the user reads".
 * Prompt assembly replays modelEmittedText when present; UI keeps cleaned text.
 * History field shaping adds only the template token required to reproduce
 * the seeded LFM think prefix.
 */

import { THINK_CLOSE, THINK_OPEN } from "./thinkStream";

/** Named restore refusal: history cannot re-render the saved KV byte-for-byte. */
export const HISTORY_NOT_REPRODUCIBLE = "history_not_reproducible";

/** Prompt content for a history turn. Assistant prefers model-emitted text. */
export function promptContentForHistoryMessage(message: {
  role: string;
  content: string;
  modelEmittedText?: string;
}): string {
  if (
    message.role === "assistant" &&
    typeof message.modelEmittedText === "string" &&
    message.modelEmittedText.length > 0
  ) {
    return message.modelEmittedText;
  }
  return message.content;
}

export type LlamaHistoryAssistantFields = {
  content: string;
  reasoning_content?: string;
};

/**
 * How history think is handed to llama.rn Jinja.
 *
 * - `reasoning_content`: LFM / `preserveThinking` history is replayed through
 *   `content` with the seeded `<think>` prefix restored explicitly.
 * - `content_span`: Qwen 3.5 history (`loop.index0 <= last_query_index`)
 *   emits `content` only. If `reasoning_content` is absent it splits
 *   `</think>` out of content and drops the KV think tokens (S23 9151f78
 *   t6: embd=8009 text_tokens=4438 n_common=0). An empty-string field
 *   skips that split so the raw span stays in `content`.
 */
export type HistoryThinkPlacement = "reasoning_content" | "content_span";

/** LFM restores the seeded prefix; Qwen 3.5 history must keep the span. */
export function historyThinkPlacementForModel(
  preserveThinking: boolean | undefined,
): HistoryThinkPlacement {
  return preserveThinking === true ? "reasoning_content" : "content_span";
}

/**
 * LFM history needs the seeded `<think>` prefix in `content`; Qwen 3.5
 * history needs the raw span in `content` instead (see HistoryThinkPlacement).
 */
export function llamaHistoryAssistantFields(
  message: {
    role: string;
    content: string;
    modelEmittedText?: string;
  },
  opts?: { historyThink?: HistoryThinkPlacement },
): LlamaHistoryAssistantFields {
  if (message.role !== "assistant") {
    return { content: message.content };
  }
  const emitted =
    typeof message.modelEmittedText === "string" && message.modelEmittedText.length > 0
      ? message.modelEmittedText
      : undefined;
  const source = emitted ?? message.content;
  if (opts?.historyThink === "content_span") {
    const split = splitClosedLeadingThink(source);
    if (!split) return { content: source };
    return { content: source, reasoning_content: "" };
  }
  // The LFM generation prompt has already seeded one `<think>` before this
  // raw completion. Prefix every raw shape verbatim, including a raw value
  // that already starts with `<think>`: the result is `<think><think>…`,
  // which is byte-identical if the model emitted that second tag itself.
  return { content: THINK_OPEN + source };
}

/** Char length the engine window must charge (replay text, not UI `text`). */
export function historyReplayCharLength(
  message: {
    role?: string;
    text?: string;
    content?: string;
    modelEmittedText?: string;
  },
  opts: { historyThink: HistoryThinkPlacement },
): number {
  let length: number;
  if (
    message.role === "assistant" &&
    typeof message.modelEmittedText === "string" &&
    message.modelEmittedText.length > 0
  ) {
    length = message.modelEmittedText.length;
  } else if (typeof message.text === "string") {
    length = message.text.length;
  } else if (typeof message.content === "string") {
    length = message.content.length;
  } else {
    length = 0;
  }
  if (message.role === "assistant" && opts.historyThink === "reasoning_content") {
    return length + THINK_OPEN.length;
  }
  return length;
}

function splitClosedLeadingThink(
  raw: string,
): { inner: string; after: string } | null {
  const leading = raw.match(/^[ \t\r\n]*<think>/);
  if (!leading) return null;
  const afterOpen = raw.slice(leading[0].length);
  const closeIdx = afterOpen.indexOf(THINK_CLOSE);
  if (closeIdx < 0) return null;
  return {
    inner: afterOpen.slice(0, closeIdx),
    after: afterOpen.slice(closeIdx + THINK_CLOSE.length),
  };
}

/**
 * Restore modelEmittedText from a persisted/history record.
 * Assistant-only; empty/whitespace strings are treated as absent.
 */
export function readModelEmittedText(
  role: string,
  value: unknown,
): string | undefined {
  if (role !== "assistant") return undefined;
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0) return undefined;
  return value;
}

/**
 * Normalise modelEmittedText at save time.
 * Whitespace-only → absent (matches readModelEmittedText); otherwise preserve
 * the raw emission byte-for-byte, including leading/trailing whitespace.
 */
export function normalizeModelEmittedTextForSave(
  role: string,
  value: unknown,
): string | undefined {
  if (role !== "assistant") return undefined;
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0) return undefined;
  return value;
}

/**
 * Model reasoning (think-block span) persisted purely for UI display — the
 * collapsed block above the answer. Assistant-only, like the modelEmittedText
 * twins above. NEVER used for prompt assembly: the raw think span already
 * rides inside modelEmittedText for KV replay, and re-adding it here would
 * double-wrap history.
 */
export function readThinkingText(
  role: string,
  value: unknown,
): string | undefined {
  if (role !== "assistant") return undefined;
  if (typeof value !== "string") return undefined;
  if (value.trim().length === 0) return undefined;
  return value;
}

/** Assistant-only; whitespace-only → absent (matches readThinkingText). */
export function normalizeThinkingTextForSave(
  role: string,
  value: unknown,
): string | undefined {
  if (role !== "assistant") return undefined;
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Fallback round: attach raw emission only when cleaned visible text survived.
 * Markup-only rounds show a canned message — never store the raw scraps.
 */
export function modelEmittedTextForVisibleReply(
  cleanedVisibleText: string,
  rawEmitted: string | undefined | null,
): string | undefined {
  if (typeof cleanedVisibleText !== "string" || cleanedVisibleText.trim().length === 0) {
    return undefined;
  }
  if (typeof rawEmitted !== "string" || rawEmitted.length === 0) {
    return undefined;
  }
  return rawEmitted;
}

/**
 * Can this history window re-render the native KV?
 *
 * Assemble already falls back to `text`/`content` when emitted is missing
 * (`promptContentForHistoryMessage`). G1 interrupted turns with body text
 * were saved that way (S23 4454-token KV). Empty assistants still refuse.
 */
export function historyWindowReproducesKv(
  messages: ReadonlyArray<unknown> | null | undefined,
): { accept: true } | { accept: false; reason: string } {
  const list = Array.isArray(messages) ? messages : [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const m = item as {
      role?: unknown;
      text?: unknown;
      content?: unknown;
      modelEmittedText?: unknown;
    };
    if (m.role !== "assistant") continue;
    const emitted =
      typeof m.modelEmittedText === "string" ? m.modelEmittedText.trim() : "";
    if (emitted.length > 0) continue;
    const text = typeof m.text === "string" ? m.text.trim() : "";
    const content = typeof m.content === "string" ? m.content.trim() : "";
    if (text.length === 0 && content.length === 0) {
      return { accept: false, reason: HISTORY_NOT_REPRODUCIBLE };
    }
  }
  return { accept: true };
}
