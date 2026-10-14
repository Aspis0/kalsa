/**
 * `mail_list`, `mail_read` and `mail_draft` run: one Tauri command each, the
 * model answered with `for_model` and nothing else, and the record the cards
 * are drawn from read from `for_ui`. What the model reads is the fenced text
 * the sidecar built — never our own wording of the same mail.
 */

import { invoke } from "../tauri";
import * as attachments from "../mail/attachments";
import { fencedBody } from "../mail/fence";
import { mailRecord, mailRecords } from "../mail/records";
import * as lastList from "../mail/lastList";
import type { MailDraft, MailRecord, MailResponse } from "../mail/types";

/** The words the model reads when a mail command did not run. English, like
    every other refusal on the wire; the screen words its own from `is_error`. */
const NO_MAILBOX = "Mail is not set up. The person has to add an account in Settings → Mail.";
const INBOX = "INBOX";
const NOT_MAIL = "No mail was shown: it is not set up, or the server could not be reached.";

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The fenced text of a call, as one block for the transcript. */
function answerText(response: MailResponse): string {
  return response.for_model.join("\n");
}

async function call(command: string, args: Record<string, unknown>): Promise<MailResponse | null> {
  const raw = await invoke<unknown>(command, { args });
  const r = object(raw);
  const forModel = Array.isArray(r.for_model) ? r.for_model.filter((x): x is string => typeof x === "string") : [];
  return { for_model: forModel, for_ui: r.for_ui, is_error: r.is_error === true };
}

/**
 * The mails a list returned, remembered for `mail_show` to draw from.
 *
 * INBOX, always: a UID is only unique inside its folder, and every id this
 * page carries afterwards — the card, the panel, the confirmation, the send —
 * is that bare UID, so a second folder would let one folder's id name another's
 * mail. One folder is the only way those ids mean what they say.
 */
export async function runMailList(args: Record<string, unknown>): Promise<{ text: string; ok: boolean; records: MailRecord[] }> {
  const response = await call("brain_mail_list", { ...args, folder: INBOX });
  if (response === null) return { text: NOT_MAIL, ok: false, records: [] };
  const records = mailRecords(response.for_ui);
  lastList.remember(records);
  const body = answerText(response) || NOT_MAIL;
  return { text: response.is_error ? NOT_MAIL : body, ok: !response.is_error, records };
}

/** One mail in full: the record for the card, the body for the Mail tab. */
export async function runMailRead(args: Record<string, unknown>): Promise<{
  text: string;
  ok: boolean;
  record: MailRecord | null;
  body: string;
}> {
  const response = await call("brain_mail_read", { ...args, folder: INBOX });
  if (response === null) return { text: NOT_MAIL, ok: false, record: null, body: "" };
  const record = mailRecord(response.for_ui);
  if (record !== null) attachments.remember(record.id, record.attachments.map((a) => a.name));
  return {
    text: response.is_error ? NOT_MAIL : answerText(response),
    ok: !response.is_error,
    record,
    body: fencedBody(response.for_model),
  };
}

/** A reply as an object. The recipient came from the mail, never from the model. */
export async function runMailDraft(args: Record<string, unknown>): Promise<{ text: string; ok: boolean; draft: MailDraft | null }> {
  const response = await call("brain_mail_draft", args);
  if (response === null) return { text: NO_MAILBOX, ok: false, draft: null };
  const r = object(response.for_ui);
  const to = typeof r.to === "string" ? r.to : "";
  if (to === "") return { text: NOT_MAIL, ok: false, draft: null };
  const body = typeof r.body === "string" ? r.body : "";
  return {
    text: response.is_error ? NOT_MAIL : `Draft written for ${to}. Nothing was sent.`,
    ok: !response.is_error,
    draft: {
      kind: "draft",
      replyToId: String(args.reply_to_id ?? ""),
      to,
      // The name is the panel's to find, from the record of the mail answered.
      toName: "",
      subject: typeof r.subject === "string" ? r.subject : "",
      body,
    },
  };
}