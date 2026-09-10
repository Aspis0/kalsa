/**
 * Pure gate for the message action-sheet Copy row. Kept out of AiChatPage so
 * it is testable in the node Jest env (no component mounting), mirroring
 * regenTarget.ts.
 */

/** The sheet Copy row is shown only when the message has copyable text. */
export function sheetCopyVisible(text: string): boolean {
  return !!text.trim();
}
