/**
 * Long-conversation nudge estimate (V4.2 §Fase 3.5).
 *
 * Pure helpers — no React / RN imports. Used by AiChatPage to decide when to
 * show "this conversation is getting long". Not a real tokenizer: llama.rn does
 * not expose vision (or text) token counts from the loaded model.
 */

import { DEFAULT_N_CTX } from "../engine/contextProfile";

/** Message-count trigger — independent of the token estimate. */
export const LONG_CHAT_MESSAGE_THRESHOLD = 40;

/**
 * Fallback n_ctx when the host has not yet resolved a loaded-model profile.
 * Re-exports contextProfile.DEFAULT_N_CTX so the ceiling shares one source of truth.
 */
export const LONG_CHAT_DEFAULT_N_CTX = DEFAULT_N_CTX;

/**
 * Fire the token-based nudge when estimated tokens exceed this fraction of the
 * resolved n_ctx. ~2/3 leaves headroom for the user to finish the current
 * exchange (one more user turn + model reply, including a few vision images)
 * before the hard context ceiling. Warning slightly early is preferable to
 * going straight to the "context full" error.
 */
export const LONG_CHAT_CTX_FRACTION = 2 / 3;

/**
 * Rough per-image token cost for the long-chat warning only (not a measurement).
 *
 * llama.rn does not expose vision token usage; the true figure depends on the
 * mmproj / vision encoder and the image resolution. Public ranges for VL models
 * are often ~500-1500 tokens per image, higher for large images.
 *
 * UNVALIDATED — nobody has measured this on a device. It is the weakest number
 * in this file and deserves a real measurement before it is trusted further.
 *
 * Why mid-range rather than the top: most catalog entries run n_ctx 8192
 * (ModelRegistry), so the threshold is ~5.4k tokens. At 1500/image a single
 * attachment turn (capped at 5 images) scores 7500 and would nag the user the
 * first time they attach one PDF — which reads as the app being broken, and is
 * the complaint this whole change started from. The design constraint is
 * therefore: ONE attachment turn must not trigger the nudge on an 8192 model;
 * two should. 800 satisfies that (4000 vs 8000 against a 5461 threshold) while
 * still over-estimating relative to the low end of the range.
 */
export const ESTIMATED_TOKENS_PER_IMAGE = 800;

/** Minimal attachment shape needed for the estimate (matches LocalAttachment). */
export type EstimateAttachment = {
  kind: "image" | "pdf" | string;
  pageCount?: number;
  /** In-session only (not persisted); each page is one vision image. */
  pages?: string[];
};

/** Minimal message shape for the estimate. */
export type EstimateMessage = {
  text?: string | null;
  attachments?: EstimateAttachment[] | null;
  /**
   * ResultImage[] on the chat Message type are RNA-seq artifact thumbnails
   * shown in the UI — they are NOT fed to the vision encoder. Do not count them.
   * (Engine vision images live only on the ephemeral EngineMessage for the
   * current turn, derived from attachments.)
   */
};

/**
 * How many vision image slots an attachment consumes.
 * - image → 1
 * - pdf → pageCount (persisted), else pages.length (live session), else 1
 */
export function imageSlotsFromAttachment(a: EstimateAttachment): number {
  if (a.kind === "pdf") {
    if (typeof a.pageCount === "number" && Number.isFinite(a.pageCount) && a.pageCount > 0) {
      return Math.floor(a.pageCount);
    }
    if (Array.isArray(a.pages) && a.pages.length > 0) {
      return a.pages.length;
    }
    // Attached PDF with unknown page count still costs vision capacity.
    return 1;
  }
  if (a.kind === "image") return 1;
  return 0;
}

/**
 * Vision images the engine actually sends for one message.
 *
 * LlamaService caps a turn at MAX_IMAGES_PER_TURN (`images.slice(0, N)`), so a
 * 20-page PDF costs 5 images, not 20. Counting every page over-estimated by 4x
 * and would have fired the nudge on the first moderately long PDF.
 * Kept in sync deliberately: this is an estimate, not a second source of truth.
 */
export const MAX_IMAGE_SLOTS_PER_MESSAGE = 5;

export function imageSlotsForMessage(m: EstimateMessage): number {
  const atts = m.attachments;
  if (!atts?.length) return 0;
  let slots = 0;
  for (const a of atts) slots += imageSlotsFromAttachment(a);
  return Math.min(slots, MAX_IMAGE_SLOTS_PER_MESSAGE);
}

/** Total vision image slots across a conversation history. */
export function countConversationImageSlots(messages: EstimateMessage[]): number {
  let slots = 0;
  for (const m of messages) slots += imageSlotsForMessage(m);
  return slots;
}

/**
 * Estimate total conversation tokens: text (chars/4) + attachments
 * (ESTIMATED_TOKENS_PER_IMAGE × image slots).
 */
export function estimateConversationTokens(messages: EstimateMessage[]): number {
  let tokens = 0;
  for (const m of messages) {
    tokens += Math.ceil((m.text?.length ?? 0) / 4);
    tokens += imageSlotsForMessage(m) * ESTIMATED_TOKENS_PER_IMAGE;
  }
  return tokens;
}

/**
 * Whether the long-chat nudge should show.
 * Message-count and token-estimate are independent OR conditions.
 */
export function shouldShowLongChatNudge(
  messages: EstimateMessage[],
  engineCtx: number = LONG_CHAT_DEFAULT_N_CTX,
): boolean {
  if (messages.length > LONG_CHAT_MESSAGE_THRESHOLD) return true;
  const nCtx =
    typeof engineCtx === "number" && Number.isFinite(engineCtx) && engineCtx > 0
      ? engineCtx
      : LONG_CHAT_DEFAULT_N_CTX;
  const threshold = nCtx * LONG_CHAT_CTX_FRACTION;
  return estimateConversationTokens(messages) > threshold;
}
