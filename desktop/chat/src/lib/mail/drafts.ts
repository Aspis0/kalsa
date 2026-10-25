import { pendingSend } from "./pending";
import type { PendingSend } from "./pending";

/**
 * One reply per mail. A single string shared by the whole conversation would
 * answer the wrong person: the person writes to John, opens a mail from Studio
 * Ferraro, and John's words would still be in the box. The recipient and the
 * subject are kept beside the words for the same reason — they come from the
 * sidecar's own draft, which is what the backend will send to, so what the
 * confirmation shows is the message that leaves.
 */

export interface DraftRecord {
  /** The address the backend will send to, from the draft it wrote. */
  to: string;
  subject: string;
  body: string;
}

/** The replies in hand, by the id of the mail each one answers. */
export type Drafts = Record<string, DraftRecord>;

/** The reply written for one mail, or null when nobody wrote one. */
export function draftFor(drafts: Drafts, id: string): DraftRecord | null {
  return id === "" ? null : drafts[id] ?? null;
}

/** Writes one mail's reply, leaving every other reply alone. An emptied reply
    drops rather than lingering as a blank entry. */
export function withDraft(drafts: Drafts, id: string, record: DraftRecord): Drafts {
  if (id === "" || record.to.trim() === "") return drafts;
  if (record.body.trim() === "" && record.subject.trim() === "") {
    const { [id]: _dropped, ...rest } = drafts;
    return rest;
  }
  return { ...drafts, [id]: record };
}

/** The same reply with new words: the recipient and subject stay the ones the
    sidecar chose, because typing must not be able to redirect a reply. */
export function withBody(drafts: Drafts, id: string, body: string): Drafts {
  const before = draftFor(drafts, id);
  if (before === null) return drafts;
  return withDraft(drafts, id, { ...before, body });
}

/** What the confirmation may offer for this mail. Nothing, unless the reply
    knows the address the backend will use. */
export function pendingFor(drafts: Drafts, id: string): PendingSend | null {
  const record = draftFor(drafts, id);
  if (record === null) return null;
  return pendingSend({ replyToId: id, to: record.to, subject: record.subject, body: record.body });
}

/** Where each reply went, by the mail it answered — a sent mail is sent, its
    neighbours are not. */
export type SentTo = Record<string, string>;

export function sentToFor(sent: SentTo, id: string): string | null {
  return id === "" ? null : sent[id] ?? null;
}

export function withSent(sent: SentTo, id: string, to: string): SentTo {
  return id === "" ? sent : { ...sent, [id]: to };
}