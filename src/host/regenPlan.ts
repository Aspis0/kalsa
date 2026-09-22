/**
 * What a regenerate or an edit drops, decided before anything is mutated —
 * the pure half of the controller's truncate-and-resend, shared by the
 * regenerate row and the edit modal (the controller kept both in
 * `editMessage`, `AiChatPage.tsx:3329-3465`).
 *
 * The rule: keep the messages BEFORE the target user turn, drop the target
 * user turn and EVERYTHING after it (the assistant answer being replaced and
 * any turns that followed it), then `send` re-appends the user text WITH the
 * target's own attachments (the controller passed `target.attachments` to
 * `handleSendTracked`, `Chat:3412`) — with `edited: false`-absent for a
 * regenerate (never badged as edited) and `edited: true` for an edit save.
 *
 * Each plan returns null when the controller showed `chat.regenFailed` and
 * did nothing: no such message, wrong role, no preceding user turn
 * (`findRegenTarget`), or a target `send()` would refuse anyway — no text
 * AND no attachments (an attachment-only turn may be resent empty, the
 * controller's `editHasAttachments`, `Chat:3345-3349`) — decided HERE so the
 * refusal happens before the truncate, not after it.
 */
import { findRegenTarget } from "../screens/regenTarget";
import type { LocalAttachment, Message } from "./hostMessage";

export type RegenPlan = {
  /** The answer being replaced. */
  assistantId: string;
  /** The user turn it answers, which is also re-sent. */
  userId: string;
  text: string;
  /** The target turn's attachments, re-sent with it (controller `Chat:3412`). */
  attachments: LocalAttachment[] | undefined;
  /** History BEFORE the target user turn — the truncate target. */
  base: Message[];
};

export function planRegenerate(
  messages: readonly Message[],
  assistantId: string,
): RegenPlan | null {
  // `canRegen(role, …)` already keeps user bubbles out of the sheet, and the
  // old edit path checked its TARGET was a user turn; this is the same role
  // check on the anchor, so a mis-targeted id can never truncate history from
  // the wrong side.
  const anchor = messages.find((message) => message.id === assistantId);
  if (!anchor || anchor.role !== "assistant") return null;
  const target = findRegenTarget(messages, assistantId);
  if (!target) return null;
  const index = messages.findIndex((message) => message.id === target.id);
  if (index < 0) return null;
  const targetMessage = messages[index];
  const attachments = targetMessage.attachments;
  // `send`'s own first gate is (non-empty trimmed text OR attachments);
  // failing here keeps the truncate from ever happening for a send that
  // would refuse.
  if (!target.text.trim() && !(attachments?.length)) return null;
  return {
    assistantId,
    userId: target.id,
    text: target.text,
    attachments,
    base: messages.slice(0, index),
  };
}

/** An edit's truncate, anchored on the USER turn itself: same rule as a
 *  regenerate, different anchor (regenerate resolves assistant → its user
 *  turn through `findRegenTarget`; edit IS on the user turn) and different
 *  text (the edited draft, not the stored one). */
export type EditPlan = {
  userId: string;
  text: string;
  /** The target turn's attachments, re-sent with it (controller `Chat:3412`). */
  attachments: LocalAttachment[] | undefined;
  base: Message[];
};

export function planEdit(
  messages: readonly Message[],
  userId: string,
  newText: string,
): EditPlan | null {
  const index = messages.findIndex((message) => message.id === userId);
  if (index < 0) return null;
  // The role check: only a user bubble may anchor an edit, so a mis-targeted
  // id (an answer) can never truncate history from the wrong side.
  if (messages[index].role !== "user") return null;
  const attachments = messages[index].attachments;
  // `send`'s own first gate is (non-empty trimmed text OR attachments);
  // failing here keeps the truncate from ever happening for a send that
  // would refuse. Empty caption is valid when attachments remain — the
  // controller's `editHasAttachments` (`Chat:3345-3349`).
  const text = newText.trim();
  if (!text && !(attachments?.length)) return null;
  return { userId, text, attachments, base: messages.slice(0, index) };
}
