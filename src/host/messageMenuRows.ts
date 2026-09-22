/**
 * Which rows the message action sheet may show — the controller's visibility
 * rules as a pure function, so the menu cannot grow a row that cannot run.
 *
 * The controller's sheet drew five actions plus cancel (`AiChatPage.tsx:
 * 4415-4495`); this build ships all five, in its order:
 *
 * - **copy** — gated by the controller's own `sheetCopyVisible(text)` (its
 *   own file, called not rebuilt: a caption-less message keeps Copy out).
 * - **save-to-notes** — always here: the host mounts the NotesStore path
 *   the controller called behind an always-passed prop.
 * - **translate** — always, as the controller drew it (`Chat:4446-4454`):
 *   the opener's own gate already guarantees non-empty text, mid-turn or
 *   busy states never reach the sheet at all.
 * - **edit** — user bubbles only, idle only (the controller's
 *   `Chat:4455`); it opens the edit modal, which re-enters the send path.
 * - **regenerate** — gated by the controller's `canRegen(role, sending)`:
 *   assistant bubbles only, never mid-turn.
 * - **cancel** — always.
 *
 * Read-aloud never had a sheet row (the controller's either); it rides the
 * inline chip under an answer.
 *
 * Both gates and all label keys come from files/catalogues the controller
 * already shipped; `messageMenu.test.ts` proves every `labelKey` resolves in
 * BOTH catalogues.
 */
import type { TranslationKey } from "../i18n";
import type { MessageMenuRowId } from "../ui/shell/MessageMenu";
import { canRegen } from "../screens/regenTarget";
import { sheetCopyVisible } from "../screens/sheetCopyVisible";

export type MessageMenuRowSpec = {
  id: MessageMenuRowId;
  labelKey: TranslationKey;
  testID: string;
};

/**
 * The sheet's rows for one message, in draw order. `testID`s follow the
 * controller's for copy, edit and regenerate; save, translate and cancel get
 * names because this project requires a testID on every interactive node and
 * the controller's rows had none.
 */
export function messageMenuRows(
  role: "user" | "assistant",
  text: string,
  sending: boolean,
): MessageMenuRowSpec[] {
  const rows: MessageMenuRowSpec[] = [];
  if (sheetCopyVisible(text)) {
    rows.push({ id: "copy", labelKey: "common.copy", testID: "message-action-copy" });
  }
  rows.push({ id: "notes", labelKey: "notes.saveToNotes", testID: "message-action-notes" });
  rows.push({ id: "translate", labelKey: "translate.title", testID: "message-action-translate" });
  if (role === "user" && !sending) {
    rows.push({ id: "edit", labelKey: "chat.edit", testID: "message-action-edit" });
  }
  if (canRegen(role, sending)) {
    rows.push({ id: "regenerate", labelKey: "chat.regen", testID: "message-action-regen" });
  }
  rows.push({ id: "cancel", labelKey: "common.cancel", testID: "message-action-cancel" });
  return rows;
}

/**
 * The caption above the rows: this build's own line — it names EVERY action
 * the sheet can show across the two roles (Edit appears on user bubbles,
 * Regenerate on answers), so the hint a finger reads before it presses is
 * never a promise of an action that is not there. The controller's own line
 * (`chat.a11yLongPress`) omitted Edit and Regenerate. During the copied
 * flash the caption is `common.copied`, as the controller's was.
 */
export function messageMenuCaption(copied: boolean): TranslationKey {
  return copied ? "common.copied" : "chat.a11yMessageActions";
}
