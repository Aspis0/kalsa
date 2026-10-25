/**
 * The one place a stored mail envelope becomes a `Mail`. A card is drawn from
 * fields a stranger wrote, so nothing here passes through unchecked: a field
 * that is not the right shape is dropped rather than rendered, and a card
 * without an id — which could not be opened — is not built at all.
 */

import type { Mail, MailCardItem, MailDraft, MailFrom, MailLabels } from "./types";

const LABELS = new Set(["normal", "suspicious", "bulk"]);

/** The sidecar answers a list with at most this many mails (`mcp::MAX_ITEMS`), so
    this bound drops nothing the list drew. It matters on the way in and not on
    the way out: `cleanToolRuns` normalises on every store write, so a list is
    shortened while the person is still looking at it, not only after a reload.
    What a reload offers is the count the envelope left behind, not the cards. */
const MAX_ITEMS = 50;

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown, cap: number): string {
  return typeof value === "string" ? value.slice(0, cap) : "";
}

function sender(value: unknown): MailFrom {
  const r = record(value);
  return { name: text(r?.name, 200), address: text(r?.address, 320) };
}

function labels(value: unknown): MailLabels {
  const r = record(value);
  const name = text(r?.label, 20);
  const reasons = Array.isArray(r?.reasons)
    ? r.reasons.filter((x): x is string => typeof x === "string").slice(0, 8)
    : [];
  return { label: LABELS.has(name) ? (name as MailLabels["label"]) : "normal", reasons };
}

function card(value: unknown): MailCardItem | null {
  const r = record(value);
  const id = text(r?.id, 40);
  if (r === null || id === "") return null;
  return {
    id,
    from: sender(r.from),
    subject: text(r.subject, 500),
    gist: text(r.gist, 400),
    date: typeof r.date === "string" ? r.date : null,
    labels: labels(r.labels),
  };
}

function draft(value: unknown): MailDraft | null {
  const r = record(value);
  const to = text(r?.to, 320);
  if (r === null || to === "") return null;
  return {
    kind: "draft",
    replyToId: text(r.replyToId, 40),
    to,
    toName: text(r.toName, 200),
    subject: text(r.subject, 500),
    body: text(r.body, 20_000),
  };
}

/** Null when the stored value is not a card set this build can draw. */
export function normalizeMail(value: unknown): Mail | null {
  const r = record(value);
  if (r === null) return null;
  if (r.kind === "draft") return draft(r);
  if (r.kind !== "cards" || !Array.isArray(r.items)) return null;
  const items = r.items.slice(0, MAX_ITEMS).map(card).filter((x): x is MailCardItem => x !== null);
  return {
    kind: "cards",
    items,
    bulk: typeof r.bulk === "number" && r.bulk >= 0 ? Math.round(r.bulk) : 0,
  };
}

/** How many cards a stored envelope holds, for the count a reload keeps. */
export function mailCount(value: unknown): number {
  const mail = normalizeMail(value);
  return mail !== null && mail.kind === "cards" ? mail.items.length : 0;
}
