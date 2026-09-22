/**
 * Which rows the message action sheet may show — the controller's visibility
 * rules as a pure function, so the menu cannot grow a row that cannot run.
 *
 * The controller's sheet drew five actions plus cancel; this build ships
 * three of them:
 *
 * - **copy** — gated by the controller's own `sheetCopyVisible(text)` (its
 *   own file, called not rebuilt: a caption-less message keeps Copy out).
 * - **save-to-notes** — always here: the host mounts the NotesStore path the
 *   controller called behind an always-passed prop.
 * - **regenerate** — gated by the controller's `canRegen(role, sending)`:
 *   assistant bubbles only, never mid-turn.
 * - **cancel** — always.
 *
 * **translate and edit are ABSENT, not present and inert** — deferred with
 * their systems (the translate path + expanding block, the edit modal + its
 * regen fencing), reported as deferred rather than stubbed with a row that
 * does nothing. Read-aloud never had a sheet row; its absence is reported
 * with the inline chip.
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
 * controller's for copy and regenerate; save and cancel get names because
 * this project requires a testID on every interactive node and the
 * controller's two rows had none.
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
  if (canRegen(role, sending)) {
    rows.push({ id: "regenerate", labelKey: "chat.regen", testID: "message-action-regen" });
  }
  rows.push({ id: "cancel", labelKey: "common.cancel", testID: "message-action-cancel" });
  return rows;
}

/**
 * The caption above the rows: the controller's own choice of line — its hint
 * while idle, `common.copied` during the flash. The hint key is THIS build's,
 * not the controller's `chat.a11yLongPress`, because that sentence promises
 * translate, which this menu deliberately does not contain.
 */
export function messageMenuCaption(copied: boolean): TranslationKey {
  return copied ? "common.copied" : "chat.a11yMessageActions";
}
