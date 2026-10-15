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
    order the mailbox already decided, not in one the app re-sorts.

    A newsletter never becomes a card. The badge the code gave it is a count, and
    a card would turn that count back into one screenful per mail — the opposite
    of what the badge is for. `bulk` still counts the whole list, so the line
    under the cards is not wrong by the number of cards.

    How many of these are drawn at once is `MailCards`' own rule, not this one's:
    what the wire carries is the whole list, and the app decides what fits. */
export function cardsFrom(records: MailRecord[]): MailCards {
  const normal = records.filter((record) => record.labels.label !== "bulk");
  return {
    kind: "cards",
    items: normal.map((record) => ({
      id: record.id,
      from: record.from,
      subject: record.subject,
      gist: "",
      date: record.date,
      labels: record.labels,
    })),
    bulk: records.length - normal.length,
  };
}

/** The ids a card set carries, in the order they arrived. What a turn draws from
    those — the list's own cards, and whether a later set joins them or stands
    beside them — is the thread's call, not this one's. */
export function cardIds(cards: MailCards): string[] {
  return cards.items.map((item: MailCardItem) => item.id);
}