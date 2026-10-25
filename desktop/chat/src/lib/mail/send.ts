/**
 * Sending a reply, and nothing else. There is no send tool: the model can
 * write the words of a reply but cannot send one, on its own or because a mail
 * asked it to. Only `ConfirmSend` calls this, and only after the person has
 * read the exact message and pressed the second button.
 *
 * The recipient never crosses this boundary: the command takes the id of the
 * mail being answered and derives the address in Rust, so a caller cannot
 * point a confirmed send at somebody else.
 */

import { invoke } from "../tauri";
import type { English } from "../../i18n/en/all";
import { unsignedInteger } from "./wholeNumber";

export interface SentMail {
  sentTo: string;
}

export type SendFailure =
  | { ok: false; code: string; words: string }
  | { ok: true; sentTo: string };

/** A refusal the command answers with, said in the person's language. A code
    this build has no words for is shown as itself: a hidden refusal is worse
    than a bare code. */
function wordsFor(t: English["mail"], code: string): string {
  return t.sendErrors[code] ?? code;
}

export async function sendReply(
  replyToId: string,
  subject: string,
  body: string,
  t: English["mail"],
): Promise<SendFailure> {
  const id = unsignedInteger(replyToId);
  if (id === null) return { ok: false, code: "mail.send_failed", words: wordsFor(t, "mail.send_failed") };
  try {
    const answer = await invoke<{ sentTo?: unknown }>("brain_mail_send", {
      args: { replyToId: id, subject, body },
    });
    const sentTo = typeof answer?.sentTo === "string" ? answer.sentTo : "";
    if (sentTo === "") return { ok: false, code: "mail.send_failed", words: wordsFor(t, "mail.send_failed") };
    return { ok: true, sentTo };
  } catch (error) {
    const coded = error as { code?: unknown };
    const code = typeof coded?.code === "string" ? coded.code : "mail.send_failed";
    return { ok: false, code, words: wordsFor(t, code) };
  }
}