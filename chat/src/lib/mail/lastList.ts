/**
 * The last `mail.list`, kept in memory only. `mail_show` draws its cards from
 * here rather than from the model's answer, so a model that invents an id, a
 * sender or a subject cannot put one on a card. Nothing here is written to
 * storage: a reopened chat re-reads the mailbox.
 */

import type { MailRecord } from "./types";

interface LastList {
  byId: Map<string, MailRecord>;
  /** The bulk mails of that list, counted by the code and not by the model. */
  bulk: number;
}

let last: LastList | null = null;

/** Remembers the records a list returned, and how many of them are bulk. */
export function remember(records: MailRecord[]): void {
  last = {
    byId: new Map(records.map((record) => [record.id, record])),
    bulk: records.filter((record) => record.labels.label === "bulk").length,
  };
}

export function bulk(): number {
  return last?.bulk ?? 0;
}

/** The record this id names, or null when it is not from the last list. */
export function find(id: string): MailRecord | null {
  return last?.byId.get(id) ?? null;
}

export function listed(): boolean {
  return last !== null;
}