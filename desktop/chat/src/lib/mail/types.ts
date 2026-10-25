/**
 * What a mail card shows and what the sidecar's own record carries. A card is
 * drawn from the record, never from the model's text: the model proposes ids
 * and gists, the code looks the rest up (`tools/mailShow.ts`).
 */

export interface MailLabels {
  label: "normal" | "suspicious" | "bulk";
  /** Stable codes from `kalsa-mail`'s `Reason`, worded for a person by
      `reasons.ts` — the raw code never reaches a screen. */
  reasons: string[];
}

export interface MailFrom {
  name: string;
  address: string;
}

export interface MailAttachment {
  name: string;
  size: number;
}

/** One card's mail, as the sidecar's `mail.read` record carries it. The body
    is not here: it travels only in the fenced text, which the panel reads. */
export interface MailRecord {
  id: string;
  from: MailFrom;
  subject: string;
  /** RFC 3339, or null when the Date header was missing or unreadable. */
  date: string | null;
  snippet: string;
  threadIds: string[];
  attachments: MailAttachment[];
  labels: MailLabels;
}

export interface MailCardItem {
  id: string;
  from: MailFrom;
  subject: string;
  /** The model's one line, written in the app's language. */
  gist: string;
  date: string | null;
  labels: MailLabels;
}

/** Cards in the chat, and the bulk count the line under them reads from. */
export interface MailCards {
  kind: "cards";
  items: MailCardItem[];
  bulk: number;
}

/** A reply written here. Sending is a person's second press, never a tool:
    the id below is what the send command resolves the recipient from. */
export interface MailDraft {
  kind: "draft";
  /** The mail being answered, as the model named it for `mail_draft`. */
  replyToId: string;
  to: string;
  toName: string;
  subject: string;
  body: string;
}

export type Mail = MailCards | MailDraft;

/** What a `brain_mail_*` command answers with: the fenced text a model may
    read, and the record the cards are drawn from. */
export interface MailResponse {
  for_model: string[];
  for_ui: unknown;
  is_error: boolean;
}