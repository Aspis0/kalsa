/**
 * The draft-preservation rule of one send: the field loses only the words the
 * field itself sent.
 *
 * A suggestion card (`welcomeBlock.tsx`) and a regenerate (`messageActions.ts`)
 * send THEIR text through the same `send()` the send face uses. Clearing the
 * draft on foreign text destroys input the user never submitted. The controller
 * cleared unconditionally (`AiChatPage.tsx:2523`, reached from the card's own
 * `handleSendTracked(s.text, …)` at `:4102`) and ate the typed words — a
 * device capture proved it — so this rule is a DELIBERATE IMPROVEMENT over
 * parity, not parity: the words are the user's.
 *
 * Own file so the rule is testable without importing `sendHost.ts`, whose
 * import graph reaches the native engine (`sendDraft.test.ts`).
 */
export function sendClearsDraft(draft: string, sent: string): boolean {
  return draft.trim() === sent;
}
