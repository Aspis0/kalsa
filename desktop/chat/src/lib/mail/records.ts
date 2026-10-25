/**
 * The one place the sidecar's record becomes a `MailRecord`. Rust already
 * strips control characters and folds headers to one line before serialising,
 * but the value arrives from a boundary, so every field is bounded here: a
 * record that cannot be read whole is dropped rather than half-drawn.
 */

import type { MailAttachment, MailFrom, MailLabels, MailRecord } from "./types";

const LABELS = new Set(["normal", "suspicious", "bulk"]);

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function sender(value: unknown): MailFrom {
  const r = record(value);
  return { name: text(r?.name), address: text(r?.address) };
}

function labels(value: unknown): MailLabels {
  const r = record(value);
  const name = text(r?.label);
  const reasons = Array.isArray(r?.reasons) ? r.reasons.filter((x): x is string => typeof x === "string") : [];
  return { label: LABELS.has(name) ? (name as MailLabels["label"]) : "normal", reasons };
}

function attachments(value: unknown): MailAttachment[] {
  if (!Array.isArray(value)) return [];
  const out: MailAttachment[] = [];
  for (const raw of value) {
    const r = record(raw);
    if (r === null) continue;
    out.push({ name: text(r.name), size: typeof r.size === "number" && r.size >= 0 ? r.size : 0 });
  }
  return out;
}

/** One mail of a list, or the mail a read answered with. Null when the record
    does not name one — a card with no id could not be opened, so it is not drawn. */
export function mailRecord(value: unknown): MailRecord | null {
  const r = record(value);
  const id = text(r?.id);
  if (r === null || id === "") return null;
  const threadIds = Array.isArray(r.thread_ids) ? r.thread_ids.filter((x): x is string => typeof x === "string") : [];
  return {
    id,
    from: sender(r.from),
    subject: text(r.subject),
    date: typeof r.date === "string" ? r.date : null,
    snippet: text(r.snippet),
    threadIds,
    attachments: attachments(r.attachments),
    labels: labels(r.labels),
  };
}

/** Every mail of a `mail.list` record. A list is capped at fifty upstream, and
    a shorter list simply draws fewer cards. */
export function mailRecords(value: unknown): MailRecord[] {
  const r = record(value);
  if (r === null || !Array.isArray(r.items)) return [];
  const out: MailRecord[] = [];
  for (const item of r.items) {
    const one = mailRecord(item);
    if (one !== null) out.push(one);
  }
  return out;
}