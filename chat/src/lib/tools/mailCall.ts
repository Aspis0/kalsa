/**
 * `mail_list`, `mail_read` and `mail_draft` run: one Tauri command each, the
 * model answered with `for_model` and nothing else, and the record the cards
 * are drawn from read from `for_ui`. What the model reads is the fenced text
 * the sidecar built — never our own wording of the same mail.
 *
 * The model's arguments are never forwarded. Each tool builds its backend
 * arguments from the keys it names, coerced to the types Rust reads; a key
 * that is not named is dropped, and a value of the wrong kind is refused with
 * a sentence the model can act on.
 */

import { invoke } from "../tauri";
import * as attachments from "../mail/attachments";
import { fencedBody } from "../mail/fence";
import { mailRecord, mailRecords } from "../mail/records";
import * as lastList from "../mail/lastList";
import { unsignedInteger } from "../mail/wholeNumber";
import type { MailDraft, MailRecord, MailResponse } from "../mail/types";

/** What the model reads when a call did not run. English, like every other
    refusal on the wire. The cause is already on the screen as Kalsa's own
    notice, so the model is told to stop rather than left to invent a fix. */
const INBOX = "INBOX";
const NOT_MAIL = "No mail was shown: it is not set up, or the server could not be reached.";
const ALREADY_TOLD = "Kalsa has already told the reader what failed; do not add advice or a fix.";
const DAYS_NOT_WHOLE = "days must be a whole number of days.";
const ID_NOT_WHOLE = "The mail id must be the whole number mail_list gave for that mail.";

/** The backend arguments a tool call was built into, or the refusal to show the model. */
type Built = { ok: true; args: Record<string, unknown> } | { ok: false; text: string };

function refused(text: string): Built {
  return { ok: false, text };
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/** The fenced text of a call, as one block for the transcript. */
function answerText(response: MailResponse): string {
  return response.for_model.join("\n");
}

/** An answer, or the code of a command that rejected. A rejection is `{ code }`, or a
    plain string when Tauri could not read the arguments; the string is not echoed,
    because it can carry the values that were sent. */
type Answer = MailResponse & { code?: string };

async function call(command: string, args: Record<string, unknown>): Promise<Answer> {
  let raw: unknown;
  try {
    raw = await invoke<unknown>(command, { args });
  } catch (error) {
    const code = typeof error === "string" ? "mail.bad_arguments" : (object(error).code as unknown);
    return { for_model: [], for_ui: undefined, is_error: true, code: typeof code === "string" ? code : "mail.call_failed" };
  }
  const r = object(raw);
  const forModel = Array.isArray(r.for_model) ? r.for_model.filter((x): x is string => typeof x === "string") : [];
  return { for_model: forModel, for_ui: r.for_ui, is_error: r.is_error === true };
}

/** The rejection's code, only when the screen has a cause to word: a call that
    answered with prose has nothing for the notice card to say. */
function codeOf(response: Answer): { code?: string } {
  return response.code === undefined ? {} : { code: response.code };
}

/** What the model reads when a call did not run, in one line: the code the
    command rejected with and the fact that the reader has been told. The
    screen words the cause itself from `code`. */
function failure(response: Answer): string {
  const cause = response.code ?? (response.for_model[0] ?? "").slice(0, 120);
  return `${cause === "" ? NOT_MAIL : `No mail was shown: ${cause}`} ${ALREADY_TOLD}`;
}

function listArgs(model: Record<string, unknown>): Built {
  const args: Record<string, unknown> = { folder: INBOX };
  if (model.days !== undefined) {
    const days = unsignedInteger(model.days);
    if (days === null) return refused(DAYS_NOT_WHOLE);
    args.days = days;
  }
  for (const key of ["from", "query"]) {
    const value = model[key];
    if (value === undefined) continue;
    if (typeof value !== "string") return refused(`${key} must be text.`);
    args[key] = value;
  }
  return { ok: true, args };
}

function readArgs(model: Record<string, unknown>): Built {
  const id = unsignedInteger(model.id);
  return id === null ? refused(ID_NOT_WHOLE) : { ok: true, args: { id, folder: INBOX } };
}

function draftArgs(model: Record<string, unknown>): Built {
  const replyToId = unsignedInteger(model.reply_to_id);
  if (replyToId === null) return refused(ID_NOT_WHOLE);
  if (typeof model.body !== "string") return refused("body must be text.");
  return { ok: true, args: { reply_to_id: replyToId, body: model.body, folder: INBOX } };
}

/**
 * The mails a list returned, remembered for `mail_show` to draw from.
 *
 * INBOX, always: a UID is only unique inside its folder, and every id this
 * page carries afterwards — the card, the panel, the confirmation, the send —
 * is that bare UID, so a second folder would let one folder's id name another's
 * mail. One folder is the only way those ids mean what they say.
 */
export async function runMailList(model: Record<string, unknown>): Promise<{ text: string; ok: boolean; records: MailRecord[]; code?: string }> {
  const built = listArgs(model);
  if (!built.ok) return { text: built.text, ok: false, records: [] };
  const response = await call("brain_mail_list", built.args);
  const records = mailRecords(response.for_ui);
  lastList.remember(records);
  if (response.is_error) return { text: failure(response), ok: false, records, ...codeOf(response) };
  return { text: answerText(response) || NOT_MAIL, ok: true, records };
}

/** One mail in full: the record for the card, the body for the Mail tab. */
export async function runMailRead(model: Record<string, unknown>): Promise<{
  text: string;
  ok: boolean;
  record: MailRecord | null;
  body: string;
  code?: string;
}> {
  const built = readArgs(model);
  if (!built.ok) return { text: built.text, ok: false, record: null, body: "" };
  const response = await call("brain_mail_read", built.args);
  const record = mailRecord(response.for_ui);
  if (record !== null) attachments.remember(record.id, record.attachments.map((a) => a.name));
  return {
    text: response.is_error ? failure(response) : answerText(response),
    ok: !response.is_error,
    record,
    body: fencedBody(response.for_model),
    ...(response.is_error ? codeOf(response) : {}),
  };
}

/** A reply as an object. The recipient came from the mail, never from the model. */
export async function runMailDraft(model: Record<string, unknown>): Promise<{ text: string; ok: boolean; draft: MailDraft | null; code?: string }> {
  const built = draftArgs(model);
  if (!built.ok) return { text: built.text, ok: false, draft: null };
  const response = await call("brain_mail_draft", built.args);
  if (response.is_error) return { text: failure(response), ok: false, draft: null, ...codeOf(response) };
  const r = object(response.for_ui);
  const to = typeof r.to === "string" ? r.to : "";
  if (to === "") return { text: NOT_MAIL, ok: false, draft: null };
  const body = typeof r.body === "string" ? r.body : "";
  return {
    text: `Draft written for ${to}. Nothing was sent.`,
    ok: !response.is_error,
    draft: {
      kind: "draft",
      replyToId: String(built.args.reply_to_id),
      to,
      // The name is the panel's to find, from the record of the mail answered.
      toName: "",
      subject: typeof r.subject === "string" ? r.subject : "",
      body,
    },
  };
}
