/**
 * Export/share the conversation — the old nav's action, lifted from
 * `AiChatPage.tsx:3206-3218` (`exportChat`) with its button at `:4757-4769`
 * (PARITY-STATUS gap 3 / D1 row 2): the transcript as Markdown, `You` / `AI`
 * turns separated by a rule, through React Native's `Share` sheet.
 *
 * The three copy keys (`chat.exportYou`, `chat.exportAi`, `chat.exportTitle`)
 * already live in both catalogues — the controller used the same ones, so the
 * two apps cannot drift apart on what an export says. Empty transcript → no
 * sheet, as the old callback did. The rejection of the share sheet is
 * swallowed on purpose: dismissing it is not an error the user asked to see.
 *
 * Split into a pure builder so the format is testable without the sheet
 * (`shareConversation.test.ts` drives `Share` through a mock).
 */
import { Share } from "react-native";
import type { TranslateFn } from "../i18n";
import type { Message } from "./hostMessage";

/** The exported conversation: one labelled turn per line pair, `---` between. */
export function buildExportMarkdown(
  messages: readonly Message[],
  t: TranslateFn,
): string {
  return messages
    .map(
      (message) =>
        `${message.role === "user" ? t("chat.exportYou") : t("chat.exportAi")}:\n${message.text}`,
    )
    .join("\n\n---\n\n");
}

/** Share the conversation; nothing to export → no sheet. */
export function shareConversation(
  messages: readonly Message[],
  t: TranslateFn,
): void {
  if (!messages.length) return;
  void Share.share({
    message: buildExportMarkdown(messages, t),
    title: t("chat.exportTitle"),
  }).catch(() => undefined);
}
