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
 * Where a stored modelEmittedText came from. It records the MECHANISM that
 * produced the string, written at the same moment as the string:
 * - "parsed": the native parse of a COMPLETED turn. With `reasoning_format:
 *   "none"` (thinkingBudgets.ts) the PEG parser keeps the reasoning markers
 *   inside content, so the stored string already carries the tag the
 *   generation prompt seeded — the KV holds exactly ONE.
 * - "raw": the raw token accumulation of an INTERRUPTED turn. The seed is
 *   prompt, not payload — the KV holds it BEFORE the first generated token —
 *   and if the model echoed the seeded tag the KV holds TWO.
 * Absent = unknown provenance (stored before this field existed): the
 * renderer falls back to the syntactic predicate, which is exactly the
 * pre-flag behaviour, so there is no migration and no invalidation.
 */
export type EmissionSource = "parsed" | "raw";

/**
 * Whether the replay text already carries the seeded `<think>`. ONE place
 * decides what provenance implies — "parsed implies the seed is included" is
 * only true while reasoning_format stays "none". Raw accumulations never
 * include the seed itself: the model may echo the tag, but the seeded one is
 * prompt bytes, so the renderer must restore it unconditionally (even when
 * that means the KV legitimately holds two).
 */
function emissionAlreadySeeded(
  source: string,
  emissionSource?: EmissionSource,
): boolean {
  return emissionSource === "raw" ? false : source.startsWith(THINK_OPEN);
}

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
    emissionSource?: EmissionSource;
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
  // The GGUF generation prompt seeds one `<think>` unconditionally (lines
  // 123–125), so the KV already holds exactly one opening tag. Whether the
  // replay text already carries it is emissionAlreadySeeded's decision —
  // provenance-aware, with the syntactic startsWith as the fallback for
  // unknown provenance. Stored emissions without the flag are live in both
  // shapes: some carry that tag and some do not; the tag-less shape is
  // associated with interrupted/never-closed turns, such as a user pressing
  // Stop. The observed counts are 133 with / 12 without / 0 with whitespace
  // before it, so the fallback stays a strict startsWith, not a
  // trim-tolerant match. A closed `</think>` block is strongly correlated
  // with the tag being present, but that is only a correlation: the fallback
  // is purely syntactic and must not depend on whether a close appears.
  return {
    content: emissionAlreadySeeded(source, message.emissionSource)
      ? source
      : THINK_OPEN + source,
  };
}

/** Char length the engine window must charge (replay text, not UI `text`). */
export function historyReplayCharLength(
  message: {
    role?: string;
    text?: string;
    content?: string;
    modelEmittedText?: string;
    emissionSource?: EmissionSource;
  },
  opts: { historyThink: HistoryThinkPlacement },
): number {
  let replayText: string;
  if (
    message.role === "assistant" &&
    typeof message.modelEmittedText === "string" &&
    message.modelEmittedText.length > 0
  ) {
    replayText = message.modelEmittedText;
  } else if (typeof message.text === "string") {
    replayText = message.text;
  } else if (typeof message.content === "string") {
    replayText = message.content;
  } else {
    replayText = "";
  }
  if (message.role === "assistant" && opts.historyThink === "reasoning_content") {
    return emissionAlreadySeeded(replayText, message.emissionSource)
      ? replayText.length
      : replayText.length + THINK_OPEN.length;
  }
  return replayText.length;
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
 * Delegates to readModelEmittedText on purpose: save and load are two moments
 * of ONE policy — whitespace-only → absent, otherwise preserve the raw
 * emission byte-for-byte, including leading/trailing whitespace. A third
 * predicate here is how load and save drift apart (the AppShell load path
 * trimmed while this preserved, and every boot then re-saved the trimmed
 * value).
 */
export function normalizeModelEmittedTextForSave(
  role: string,
  value: unknown,
): string | undefined {
  return readModelEmittedText(role, value);
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
