/**
 * The buffer's retention rule as pure functions over a stored snapshot.
 *
 * `createdAt` is the Worker clock at accept time (index.ts handleReport), never
 * a client value, so an entry's age does not depend on what the phone sent.
 * `dropExpired` runs inside the DO alarm; `nextExpiryAt` says when to arm it.
 */
import type { BufferState } from "./schema";

export const RETENTION_DAYS = 90;
export const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

/**
 * A duplicate refreshes `lastSeenAt` but must not extend retention: the stored
 * report is the copy first accepted, so `createdAt` is what ages out. Exactly
 * at the mark is not "older than" it and stays.
 *
 * An entry whose `createdAt` cannot be read as a number is dropped rather than
 * kept: its age is unknowable, and keeping it would break the 90-day promise
 * for good. Entries this Worker writes always carry a finite `createdAt`
 * (`Date.now()` at accept time).
 */
export function isExpired(createdAt: number, now: number): boolean {
  if (!Number.isFinite(createdAt)) return true;
  return now - createdAt > RETENTION_MS;
}

export function dropExpired(
  st: BufferState,
  now: number,
): { state: BufferState; expired: number } {
  const kept = st.entries.filter((e) => !isExpired(e.createdAt, now));
  if (kept.length === st.entries.length) return { state: st, expired: 0 };
  return { state: { ...st, entries: kept }, expired: st.entries.length - kept.length };
}

/**
 * When the oldest stored entry falls due, as an absolute epoch ms, or null when
 * nothing is stored — a buffer with nothing to expire must arm no alarm.
 *
 * The mark sits one millisecond past `createdAt + RETENTION_MS`, because expiry
 * means strictly older: armed at the mark itself, that wake would drop nothing
 * and arm the same instant again.
 *
 * An entry already past its mark falls due at `now` — the earliest future time
 * `setAlarm` accepts, and what "as soon as possible" has to be written as. An
 * entry whose `createdAt` is unreadable is due now too; the sweep drops it.
 */
export function nextExpiryAt(st: BufferState, now: number): number | null {
  let due: number | null = null;
  for (const e of st.entries) {
    const at = Number.isFinite(e.createdAt) ? e.createdAt + RETENTION_MS + 1 : now;
    const candidate = at > now ? at : now;
    if (due === null || candidate < due) due = candidate;
  }
  return due;
}