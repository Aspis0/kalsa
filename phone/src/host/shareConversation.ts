/**
 * Export/share the conversation — the old nav's action: the transcript as
 * Markdown, `You` / `AI` turns separated by a rule, through React Native's
 * `Share` sheet (PARITY-STATUS gap 3 / D1 row 2).
 *
 * The three copy keys (`chat.exportYou`, `chat.exportAi`, `chat.exportTitle`)
 * already live in both catalogues — the controller used the same ones, so the
 * two apps cannot drift on what an export says. Empty transcript → no sheet.
 * The rejection of the share sheet is swallowed on purpose: dismissing it is
 * not an error the user asked to see.
 *
 * Split into a pure builder so the format is testable without the sheet
 * (`shareConversation.test.ts` drives `Share` through a mock).
 */
import { Share } from "react-native";
import { getDefaultConversationsStorage, messagesKey } from "../conversations/ConversationsStore";
import type { Locale, TranslateFn } from "../i18n";
import { sanitizeHistoryMessages } from "./historyMessages";
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

export type ConversationMessagesReader = (id: string, locale: Locale) => Promise<Message[]>;

async function readPersistedConversationMessages(id: string, locale: Locale): Promise<Message[]> {
  try {
    const raw = await getDefaultConversationsStorage().getItem(messagesKey(id));
    return raw === null ? [] : sanitizeHistoryMessages(JSON.parse(raw) as unknown, locale);
  } catch {
    return [];
  }
}

/** Export this row's stored history; the active row uses its live in-memory copy. */
export async function shareConversationById(
  id: string,
  activeId: string,
  activeMessages: readonly Message[],
  locale: Locale,
  t: TranslateFn,
  readMessages: ConversationMessagesReader = readPersistedConversationMessages,
): Promise<void> {
  let messages: readonly Message[] = activeMessages;
  if (id !== activeId) {
    try {
      messages = await readMessages(id, locale);
    } catch {
      return;
    }
  }
  shareConversation(messages, t);
}
