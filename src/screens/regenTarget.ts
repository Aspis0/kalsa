/**
 * Pure logic behind the assistant action-sheet "Regenerate" row and the
 * truncate-and-resend path it shares with Edit. Kept out of AiChatPage so it
 * is testable in the node Jest env (no component mounting).
 */

export type RegenCandidate = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

/**
 * `edited` badge flag for the shared truncate-and-resend path. Edit → Save
 * keeps the badge (default true); Regenerate resends the same user text, so
 * its bubble must not be labelled as edited.
 */
export function editedFlagForResend(opts?: { edited?: boolean }): boolean {
  return opts?.edited ?? true;
}

/** Regenerate is offered only for assistant bubbles while the turn is idle. */
export function canRegen(role: RegenCandidate["role"], sending: boolean): boolean {
  return role === "assistant" && !sending;
}

/**
 * Resolve the user turn that produced `assistantId`: the nearest preceding
 * user message. Returns null when the assistant message is absent or no user
 * message precedes it, so the caller shows regenFailed and does nothing.
 */
export function findRegenTarget(
  messages: readonly RegenCandidate[],
  assistantId: string,
): { id: string; text: string } | null {
  const idx = messages.findIndex((m) => m.id === assistantId);
  if (idx < 0) return null;
  for (let i = idx - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === "user") return { id: m.id, text: m.text };
  }
  return null;
}
