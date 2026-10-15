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
import { cardsFrom, CARDS_PER_GROUP } from "../mail/cards";
import { fencedBody } from "../mail/fence";
import { mailRecord, mailRecords } from "../mail/records";
import * as lastList from "../mail/lastList";
import { unsignedInteger } from "../mail/wholeNumber";
import type { MailCards, MailDraft, MailRecord, MailResponse } from "../mail/types";

/** What the model reads when a call did not run. English, like every other
    refusal on the wire. The cause is already on the screen as Kalsa's own
    notice, so the model is told to stop rather than left to invent a fix. */
const INBOX = "INBOX";
const NOT_MAIL = "No mail was shown: it is not set up, or the server could not be reached.";
const ALREADY_TOLD = "Kalsa has already told the reader what failed; do not add advice or a fix.";
/** Read before the sidecar's own block, which is a stranger's text: the rule has
    to be weighed before the senders and subjects are, or the model answers the
    block instead of the person. */
const SHORT_ANSWER = "Answer in at most 1–3 lines on what matters.";
const DAYS_NOT_WHOLE = "days must be a whole number of days.";
const ID_NOT_WHOLE = "The mail id must be the whole number mail_list gave for that mail.";

/**
 * What the person is looking at right now, in the one shape that is true of
 * every list: how many cards are drawn, how many are behind the line that shows
 * more, and the newsletters, which are a count and never a card. A model told
 * "the mails are on screen" when only two cards and a count are there answers
 * about eight mails that nobody is reading.
 */
function onScreen(cards: MailCards): string {
  const total = cards.items.length;
  const bulk = cards.bulk;
  const noRepeat = " Do not repeat their senders and subjects as a list.";
  if (total === 0) {
    const all = bulk === 1 ? "the only mail is a newsletter" : `all ${bulk} of the mails are newsletters`;
    return `No card is drawn: ${all}, and a newsletter is shown as a count only.${noRepeat}`;
  }
  const drawn = Math.min(total, CARDS_PER_GROUP);
  const cards_line =
    drawn === 1 ? "One of them is drawn as a card on the screen." : `${drawn} of them are drawn as cards on the screen.`;
  const behind = total - drawn;
  const more = behind > 0 ? ` The other ${behind} are behind the line that shows more.` : "";
  const news = bulk > 0 ? ` ${bulk} ${bulk === 1 ? "newsletter is" : "newsletters are"} a count, never a card.` : "";
  return `${cards_line}${more}${news}${noRepeat}`;
}

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
    answered with prose has nothing for the notice card to say. A host that
    refuses a command throws its code; a sidecar that names its own cause puts
    it in the structured answer, which arrives as a call that did run. */
function codeOf(response: Answer): { code?: string } {
  const code = response.code ?? namedCode(response.for_ui);
  return code === undefined ? {} : { code };
}

/** The code a failed call carries in its own answer, if it named one. */
function namedCode(forUi: unknown): string | undefined {
  const code = object(forUi).code;
  return typeof code === "string" && code !== "" ? code : undefined;
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
export async function runMailList(model: Record<string, unknown>, conversation: object): Promise<{ text: string; ok: boolean; records: MailRecord[]; code?: string; cards?: MailCards }> {
  const built = listArgs(model);
  if (!built.ok) return { text: built.text, ok: false, records: [] };
  const response = await call("brain_mail_list", built.args);
  const records = mailRecords(response.for_ui);
  lastList.remember(records, conversation);
  if (response.is_error) return { text: failure(response), ok: false, records, ...codeOf(response) };
  // The cards are the app's own: the person sees them whether or not a model
  // goes on to call mail_show, which only ever adds its one line per card. The
  // rule above the block says how many of them there really are, because a
  // newsletter is a count and the list draws only the first page of the rest.
  const cards = cardsFrom(records);
  const shown =
    records.length === 0 ? answerText(response) || NOT_MAIL : `${onScreen(cards)}\n${answerText(response) || NOT_MAIL}\n${SHORT_ANSWER}`;
  return { text: shown, ok: true, records, cards };
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
export async function runMailDraft(model: Record<string, unknown>, openedFor?: string): Promise<{ text: string; ok: boolean; draft: MailDraft | null; code?: string }> {
  const built = draftArgs(model);
  if (!built.ok) return { text: built.text, ok: false, draft: null };
  // The person pressed a button on one mail: the reply is for that one, and a
  // model answering with any other id is refused here rather than downstream.
  if (openedFor !== undefined && String(built.args.reply_to_id) !== openedFor) {
    return {
      text: `No draft was written: this turn is for the mail with id ${openedFor}, and the reply_to_id was ${built.args.reply_to_id}. Write the reply for ${openedFor}.`,
      ok: false,
      draft: null,
    };
  }
  const response = await call("brain_mail_draft", built.args);
  if (response.is_error) return { text: failure(response), ok: false, draft: null, ...codeOf(response) };
  const r = object(response.for_ui);
  const to = typeof r.to === "string" ? r.to : "";
  if (to === "") return { text: NOT_MAIL, ok: false, draft: null };
  const body = typeof r.body === "string" ? r.body : "";
  return {
    // The model reads this and answers the person in their own words, so it has
    // to say what is true: a draft is waiting for the person, and nobody sent.
    text: "The draft is ready for the person to review and send. Nothing was sent: never say that you replied or that the reply was sent.",
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
