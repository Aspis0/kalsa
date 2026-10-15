/**
 * The cards a list draws, built by the app and not by the model.
 *
 * The person asked to see their mail, so the cards exist the moment the list
 * comes back — whether or not a model goes on to call `mail_show`. Every field
 * is the sidecar's own record, the badge is the code's, and the gist is empty
 * until a model writes one.
 */

import type { MailCardItem, MailCards, MailRecord } from "./types";

/** The sidecar lists newest first and that order is kept: a card reads in the
    order the mailbox already decided, not in one the app re-sorts. */
export function cardsFrom(records: MailRecord[]): MailCards {
  return {
    kind: "cards",
    items: records.map((record) => ({
      id: record.id,
      from: record.from,
      subject: record.subject,
      gist: "",
      date: record.date,
      labels: record.labels,
    })),
    bulk: records.filter((record) => record.labels.label === "bulk").length,
  };
}

/** The ids a card set carries, for deciding that a later set replaces it. */
export function cardIds(cards: MailCards): string[] {
  return cards.items.map((item: MailCardItem) => item.id);
}