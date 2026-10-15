/**
 * The mail a remote answer brings, kept only in the shape a card draws.
 *
 * Everything here crosses a wire the phone does not own: `gist`, `subject`
 * and `from` are a stranger's words. They are plain text and the card never
 * renders markup, but the fields themselves are checked once, here, so a
 * computer that sends a card missing its sender draws nothing instead of a
 * broken card.
 *
 * A card that names no id is dropped rather than shown: every action it
 * offers — open, draft a reply — acts on that id, and a card the phone
 * cannot act on is a card that misleads.
 */
import type { MailReadPayload } from "../engine/remote/mailApi";

export type MailSender = { name: string; address: string };

export type MailCardItem = {
  id: string;
  from: MailSender;
  subject: string;
  gist: string;
  date: string;
  /** The computer's own word for this mail; the app never guesses one. */
  label: string;
  /** Warning reasons as codes: a code with no words in the app's language is
   *  dropped rather than shown as itself. */
  reasons: string[];
};

export type MailCards = {
  kind: "cards";
  items: MailCardItem[];
  /** Mails that matched without being shown; a line, not a card each. */
  bulk: number;
};

export type MailDraft = {
  draftId: string;
  to: string;
  toName: string;
  subject: string;
  body: string;
};

/** One mail opened from a card: the card's own record, fence-free body. */
export type OpenedMail = {
  record: MailCardItem;
  body: string;
};

function asObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(obj: Record<string, unknown>, key: string): string {
  const value = obj[key];
  return typeof value === "string" ? value : "";
}

function sender(raw: unknown): MailSender | null {
  const from = asObject(raw);
  if (from === null) return null;
  const address = text(from, "address");
  return address === "" ? null : { name: text(from, "name"), address };
}

/** A card's id is what every action on it needs, so it is the one field a
 *  card cannot be drawn without. */
function cardItem(raw: unknown): MailCardItem | null {
  const item = asObject(raw);
  if (item === null) return null;
  const id = text(item, "id");
  const from = sender(item.from);
  if (id === "" || from === null) return null;
  const labels = asObject(item.labels);
  const reasons = Array.isArray(labels?.reasons)
    ? labels.reasons.filter((reason): reason is string => typeof reason === "string")
    : [];
  return {
    id,
    from,
    subject: text(item, "subject"),
    gist: text(item, "gist"),
    date: text(item, "date"),
    label: labels === null ? "" : text(labels, "label"),
    reasons,
  };
}

export function normalizeMailCards(raw: unknown): MailCards | null {
  const cards = asObject(raw);
  const items = cards === null ? null : cards.items;
  if (!Array.isArray(items)) return null;
  const parsed = items.map(cardItem).filter((item): item is MailCardItem => item !== null);
  if (parsed.length === 0) return null;
  const bulk = cards?.bulk;
  return {
    kind: "cards",
    items: parsed,
    bulk: typeof bulk === "number" && Number.isFinite(bulk) && bulk > 0 ? Math.floor(bulk) : 0,
  };
}

export function normalizeMailDraft(raw: unknown): MailDraft | null {
  const draft = asObject(raw);
  if (draft === null) return null;
  const draftId = text(draft, "draft_id");
  const to = text(draft, "to");
  if (draftId === "" || to === "") return null;
  return {
    draftId,
    to,
    toName: text(draft, "to_name"),
    subject: text(draft, "subject"),
    body: text(draft, "body"),
  };
}

export function normalizeMailRead(payload: MailReadPayload): OpenedMail | null {
  const record = cardItem(payload.record);
  if (record === null) return null;
  return { record, body: payload.body };
}

/** The sender as one line: the computer's own name when it gave one, the
 *  address alone when it did not. */
export function senderLine(from: MailSender): string {
  return from.name === "" ? from.address : `${from.name} <${from.address}>`;
}