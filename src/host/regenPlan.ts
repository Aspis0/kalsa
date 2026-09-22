/**
 * What a regenerate or an edit drops, decided before anything is mutated —
 * the pure half of the controller's truncate-and-resend, shared by the
 * regenerate row and the edit modal (the controller kept both in
 * `editMessage`, `AiChatPage.tsx:3329-3465`).
 *
 * The rule: keep the messages BEFORE the target user turn, drop the target
 * user turn and EVERYTHING after it (the assistant answer being replaced and
 * any turns that followed it), then `send` re-appends the user text — with
 * `edited: false`-absent for a regenerate (never badged as edited) and
 * `edited: true` for an edit save.
 *
 * Each plan returns null when the controller showed `chat.regenFailed` and
 * did nothing: no such message, wrong role, no preceding user turn
 * (`findRegenTarget`), or a target whose text `send()` would refuse anyway —
 * decided HERE so the refusal happens before the truncate, not after it.
 */
import { findRegenTarget } from "../screens/regenTarget";
import type { Message } from "./hostMessage";

export type RegenPlan = {
  /** The answer being replaced. */
  assistantId: string;
  /** The user turn it answers, which is also re-sent. */
  userId: string;
  text: string;
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
  // `send`'s own first gate is a non-empty trimmed draft; failing here keeps
  // the truncate from ever happening for a send that would refuse.
  if (!target.text.trim()) return null;
  const index = messages.findIndex((message) => message.id === target.id);
  if (index < 0) return null;
  return {
    assistantId,
    userId: target.id,
    text: target.text,
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
  // `send`'s own first gate is a non-empty trimmed draft; failing here keeps
  // the truncate from ever happening for a send that would refuse.
  const text = newText.trim();
  if (!text) return null;
  return { userId, text, base: messages.slice(0, index) };
}
