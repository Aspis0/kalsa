/**
 * The one record the confirmation reads before anything leaves the computer.
 * Recipient, subject and body are built together from the same mail's id, so
 * the message that goes out is the message that was on screen: a body typed for
 * one mail can never ride along under another mail's address.
 */

export interface PendingSend {
  /** The mail being answered; the command derives the recipient from it, so the
      `to` shown here is the same address and only for reading. */
  replyToId: string;
  to: string;
  subject: string;
  body: string;
}

/** A reply follows the mail it answers, and never doubles its own Re:. */
export function replySubject(subject: string): string {
  return `Re: ${subject.replace(/^Re:\s*/i, "")}`;
}

/** Nothing to confirm means nothing to send: no mail, no recipient or no words
    gives no record, and the send button stays out of reach. */
export function pendingSend(input: {
  replyToId: string;
  to: string;
  subject: string;
  body: string;
}): PendingSend | null {
  const to = input.to.trim();
  const body = input.body.trim();
  if (input.replyToId === "" || to === "" || body === "") return null;
  return { replyToId: input.replyToId, to, subject: input.subject, body };
}