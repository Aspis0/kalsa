import { sign } from "./crypto";

/** One window for every limiter. The privacy notice states this retention, and a test ties the two together. */
export const LIMIT_WINDOW_SECONDS = 3600;

let derived: { secret: string; key: Promise<string> } | null = null;

/** A key of its own, derived from the session key with a domain label: rotating one does not reuse the other. */
function counterKey(secret: string): Promise<string> {
  if (!derived || derived.secret !== secret) derived = { secret, key: sign("abuse-counter-v1", secret) };
  return derived.key;
}

/**
 * The counter key carries a keyed hash of the address, never the address: a database read cannot
 * recover who visited. The key is scoped by the caller, so one route's bucket is not another's.
 */
export async function addressKey(request: Request, secret: string): Promise<string> {
  return sign(request.headers.get("CF-Connecting-IP") ?? "local", await counterKey(secret));
}

/**
 * A fixed window per key: one statement counts this hit and starts a new window when the old one expired.
 * Rows whose window has expired go in the same round trip, so a count lives an hour and no longer.
 */
export async function withinLimit(db: D1Database, key: string, limit: number, now: number): Promise<boolean> {
  const results = await db.batch([
    db.prepare("DELETE FROM abuse_limits WHERE window_start < ?").bind(now - LIMIT_WINDOW_SECONDS),
    db
      .prepare(
        `INSERT INTO abuse_limits (key, window_start, hits) VALUES (?, ?, 1)
         ON CONFLICT (key) DO UPDATE SET
           hits = CASE WHEN ? - abuse_limits.window_start >= ? THEN 1 ELSE abuse_limits.hits + 1 END,
           window_start = CASE WHEN ? - abuse_limits.window_start >= ? THEN ? ELSE abuse_limits.window_start END
         RETURNING hits`,
      )
      .bind(key, now, now, LIMIT_WINDOW_SECONDS, now, LIMIT_WINDOW_SECONDS, now),
  ]);
  const row = results[1]?.results[0] as { hits: number } | undefined;
  return (row?.hits ?? 1) <= limit;
}
