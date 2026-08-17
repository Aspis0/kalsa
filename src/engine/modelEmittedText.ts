/**
 * Separate "what the model emitted" from "what the user reads".
 * Prompt assembly replays modelEmittedText when present; UI keeps cleaned text.
 * No template-specific tokens — just replay whatever was produced.
 */

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
 * Whitespace-only → absent (matches readModelEmittedText).
 */
export function normalizeModelEmittedTextForSave(
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
 * Can this history window re-render the native KV byte-for-byte?
 *
 * False when any assistant message lacks captured emission (legacy history,
 * interrupted turn without capture, or whitespace-only field). Reason is the
 * same named string for all of those — restore refuses with one cold prefill.
 */
export function historyWindowReproducesKv(
  messages: ReadonlyArray<unknown> | null | undefined,
): { accept: true } | { accept: false; reason: string } {
  const list = Array.isArray(messages) ? messages : [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const m = item as {
      role?: unknown;
      modelEmittedText?: unknown;
    };
    if (m.role !== "assistant") continue;
    const emitted =
      typeof m.modelEmittedText === "string" ? m.modelEmittedText.trim() : "";
    if (emitted.length === 0) {
      return { accept: false, reason: HISTORY_NOT_REPRODUCIBLE };
    }
  }
  return { accept: true };
}
