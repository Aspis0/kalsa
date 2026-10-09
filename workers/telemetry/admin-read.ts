/**
 * Read-only maintainer view of the DO buffer: query parsing and the
 * newest-first, cursor-paged listing. Nothing here writes to storage.
 */

import type { BufferEntry, BufferState } from "./schema";

const READ_LIMIT_DEFAULT = 100;
const READ_LIMIT_MAX = 500;

/** `since` is inclusive, `before` is exclusive, both on receive time in ms. */
export type ReadQuery = { since: number | null; before: number | null; limit: number };

export function parseReadQuery(params: URLSearchParams):
  | { ok: true; query: ReadQuery }
  | { ok: false; reason: string } {
  const sinceRaw = params.get("since");
  const since = sinceRaw === null ? null : Date.parse(sinceRaw);
  if (since !== null && Number.isNaN(since)) return { ok: false, reason: "invalid_since" };

  const beforeRaw = params.get("before");
  const before = beforeRaw === null ? null : Date.parse(beforeRaw);
  if (before !== null && Number.isNaN(before)) return { ok: false, reason: "invalid_before" };

  const limitRaw = params.get("limit");
  let limit = READ_LIMIT_DEFAULT;
  if (limitRaw !== null) {
    if (!/^\d+$/.test(limitRaw) || Number(limitRaw) < 1) {
      return { ok: false, reason: "invalid_limit" };
    }
    limit = Math.min(Number(limitRaw), READ_LIMIT_MAX);
  }
  return { ok: true, query: { since, before, limit } };
}

/** A missing or malformed JSON body yields the default query, never an error. */
export function toReadQuery(raw: unknown): ReadQuery {
  const o = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const bound = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const limit =
    typeof o.limit === "number" && Number.isInteger(o.limit) && o.limit >= 1
      ? Math.min(o.limit, READ_LIMIT_MAX)
      : READ_LIMIT_DEFAULT;
  return { since: bound(o.since), before: bound(o.before), limit };
}

/** Entries that cannot be served (bad timestamp, missing fields) are skipped and counted. */
function isMs(t: unknown): boolean {
  return typeof t === "number" && !Number.isNaN(new Date(t).getTime());
}

/** Entries stored before counting have no `count`: they were one occurrence. */
function countOf(count: number | undefined): number {
  return count !== undefined && Number.isInteger(count) && count >= 1 ? count : 1;
}

function isServable(e: BufferEntry): boolean {
  return (
    isMs(e.createdAt) &&
    (e.lastSeenAt === undefined || isMs(e.lastSeenAt)) &&
    typeof e.sig === "string" &&
    typeof e.reviewAck === "boolean" &&
    typeof e.report === "object" &&
    e.report !== null
  );
}

/**
 * How many of `sorted` (newest first) form the page. A page never splits one
 * receive-time millisecond, so the `before` cursor cannot skip a sibling. A
 * millisecond that alone exceeds the limit is returned whole.
 */
function pageEnd(sorted: BufferEntry[], limit: number): number {
  if (sorted.length <= limit || sorted[limit].createdAt !== sorted[limit - 1].createdAt) {
    return Math.min(limit, sorted.length);
  }
  const ms = sorted[limit - 1].createdAt;
  let end = limit;
  while (end > 0 && sorted[end - 1].createdAt === ms) end--;
  if (end > 0) return end;
  while (end < sorted.length && sorted[end].createdAt === ms) end++;
  return end;
}

export function listReports(st: BufferState, query: ReadQuery) {
  const servable = st.entries.filter(isServable);
  const matched = servable
    .filter(
      (e) =>
        (query.since === null || e.createdAt >= query.since) &&
        (query.before === null || e.createdAt < query.before),
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  const page = matched.slice(0, pageEnd(matched, query.limit)).map((e) => ({
    sig: e.sig,
    receivedAt: new Date(e.createdAt).toISOString(),
    lastSeenAt: new Date(e.lastSeenAt ?? e.createdAt).toISOString(),
    count: countOf(e.count),
    logRefs: e.logRefs ?? [],
    reviewAck: e.reviewAck,
    report: e.report,
  }));
  return {
    total: matched.length,
    count: page.length,
    skipped: st.entries.length - servable.length,
    nextBefore: page.length > 0 ? page[page.length - 1].receivedAt : null,
    entries: page,
  };
}
