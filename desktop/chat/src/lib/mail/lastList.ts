/**
 * The last `mail.list`, kept in memory only and only for the turn that read it.
 *
 * `mail_show` draws its cards from here rather than from the model's answer, so
 * a model that invents an id, a sender or a subject cannot put one on a card.
 * The cache belongs to the wire conversation that produced it: one turn asks the
 * model to show what it just listed, and no other turn — another chat, or a
 * later one — can draw from it. Nothing here is written to storage: a reopened
 * chat re-reads the mailbox.
 */

import type { MailRecord } from "./types";

interface LastList {
  byId: Map<string, MailRecord>;
  /** The bulk mails of that list, counted by the code and not by the model. */
  bulk: number;
}

/** Keyed by the conversation array itself, which the tool loop builds once per
    turn and hands to every call of it. */
let lists = new WeakMap<object, LastList>();

/** Remembers the records a list returned, and how many of them are bulk. */
export function remember(records: MailRecord[], conversation: object): void {
  lists.set(conversation, {
    byId: new Map(records.map((record) => [record.id, record])),
    bulk: records.filter((record) => record.labels.label === "bulk").length,
  });
}

export function bulk(conversation: object): number {
  return lists.get(conversation)?.bulk ?? 0;
}

/** The record this id names, or null when it is not from this turn's list. */
export function find(id: string, conversation: object): MailRecord | null {
  return lists.get(conversation)?.byId.get(id) ?? null;
}

export function listed(conversation: object): boolean {
  return lists.has(conversation);
}

/** The account was deleted: nothing cached is true of this machine any more. */
export function forgetAll(): void {
  lists = new WeakMap();
}
