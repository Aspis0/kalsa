/**
 * `mail_show` executed: the model proposed ids and gists, and this is where the
 * cards are actually drawn. Every field of a card comes from the last
 * `mail_list`'s own record, so an invented id draws nothing and a model that
 * calls a mail important cannot hide the badge the code gave it.
 */

import type { ToolOutcome } from "../chat";
import * as lastList from "../mail/lastList";
import { mailId } from "../mail/mailId";
import type { MailCardItem } from "../mail/types";

const NO_LIST = "mail_show: there is no list in this conversation. Call mail_list first.";
const GIST_CHARS = 160;
/** A day's important mail is a handful; a model proposing dozens is not being
    read, and the screen has no room for it. */
const MAX_CARDS = 12;

function oneLine(gist: unknown): string {
  if (typeof gist !== "string") return "";
  return gist.replace(/\s+/g, " ").trim().slice(0, GIST_CHARS);
}

export function runMailShow(args: unknown, conversation: object): ToolOutcome {
  if (!lastList.listed(conversation)) return { text: NO_LIST, ok: false };
  const items = args && typeof args === "object" ? (args as Record<string, unknown>).items : null;
  if (!Array.isArray(items)) return { text: "mail_show: no items were given.", ok: false };

  const cards: MailCardItem[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  let newsletters = 0;
  for (const proposed of items.slice(0, MAX_CARDS)) {
    const pair = proposed && typeof proposed === "object" ? (proposed as Record<string, unknown>) : {};
    const id = mailId(pair.id);
    const record = id === null ? null : lastList.find(id, conversation);
    if (record === null || seen.has(record.id)) {
      dropped += 1;
      continue;
    }
    // A newsletter is the badge the code gave it: a count under the cards, never
    // a card of its own. Naming one here does not change what it is.
    if (record.labels.label === "bulk") {
      newsletters += 1;
      continue;
    }
    seen.add(record.id);
    cards.push({
      id: record.id,
      from: record.from,
      subject: record.subject,
      gist: oneLine(pair.gist),
      date: record.date,
      labels: record.labels,
    });
  }

  const drawn = cards.length;
  const said = `Drew ${drawn} mail ${drawn === 1 ? "card" : "cards"}.`;
  const lost = dropped > 0 ? ` ${dropped} proposed ${dropped === 1 ? "id was" : "ids were"} not in the last list and ${dropped === 1 ? "was" : "were"} dropped.` : "";
  const newslettersLeft = newsletters > 0 ? ` ${newsletters} ${newsletters === 1 ? "id names a newsletter and stays" : "ids name newsletters and stay"} in the count under the cards.` : "";
  return { text: `${said}${lost}${newslettersLeft}`, ok: drawn > 0, mail: { kind: "cards", items: cards, bulk: lastList.bulk(conversation) } };
}