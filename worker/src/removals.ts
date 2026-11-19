export type Kind = "engine" | "developer";

export interface Removal {
  kind: Kind;
  target: string;
}

export interface StoredRemoval extends Removal {
  githubUserId: string;
}

/** Every removal, read once per request that serves a page. The table holds one row per removed page. */
export async function listRemovals(db: D1Database): Promise<Removal[]> {
  const result = await db.prepare("SELECT kind, target FROM removals").all<Removal>();
  return result.results;
}

/** Who removed a page: only that account may undo it, and only that account is told the page is gone. */
export async function findRemoval(db: D1Database, kind: Kind, target: string): Promise<StoredRemoval | null> {
  return db
    .prepare("SELECT kind, target, github_user_id AS githubUserId FROM removals WHERE kind = ? AND target = ?")
    .bind(kind, target)
    .first<StoredRemoval>();
}

export async function addRemoval(db: D1Database, kind: Kind, target: string, githubUserId: string, now: number): Promise<void> {
  await db
    .prepare("INSERT OR IGNORE INTO removals (kind, target, github_user_id, created_at) VALUES (?, ?, ?, ?)")
    .bind(kind, target, githubUserId, now)
    .run();
}

export async function deleteRemoval(db: D1Database, kind: Kind, target: string): Promise<void> {
  await db.prepare("DELETE FROM removals WHERE kind = ? AND target = ?").bind(kind, target).run();
}

const SNAPSHOT_TTL_SECONDS = 3600;

interface Snapshot {
  at: number;
  rows: Removal[];
}

let last: { origin: string; at: number; rows: Removal[] } | null = null;

function snapshotKey(env: Env): Request {
  return new Request(`${env.SITE_ORIGIN}/__kalsa/removals-snapshot`);
}

/**
 * The removals set for this request: one D1 read, remembered in the isolate and published to an edge
 * snapshot. The snapshot is a FALLBACK FOR A D1 OUTAGE ONLY, not a cache of the truth, and its bound
 * is best-effort: a cold isolate in a colo that has not served a request since a removal or an undo
 * can read a snapshot written before that change, so during an outage the set may be stale by up to
 * the snapshot's TTL (one hour). A monotonic timestamp stops an older set replacing a newer one in
 * either direction. With no last known set at all the caller must refuse rather than guess.
 */
export async function currentRemovals(env: Env): Promise<Removal[] | null> {
  let rows: Removal[];
  try {
    rows = await listRemovals(env.DB);
  } catch {
    return fallback(env);
  }
  const at = Date.now();
  // D1 answered. Remember it before anything that can fail for an unrelated reason.
  last = { origin: env.SITE_ORIGIN, at, rows };
  await publish(env, { at, rows });
  return rows;
}

/** Best-effort: a cache write failure is not a D1 failure and must never refuse the page. */
async function publish(env: Env, snapshot: Snapshot): Promise<void> {
  try {
    const existing = await readSnapshot(env);
    if (existing && existing.at > snapshot.at) return;
    await caches.default.put(
      snapshotKey(env),
      new Response(JSON.stringify(snapshot), {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": `public, max-age=${SNAPSHOT_TTL_SECONDS}`,
        },
      }),
    );
  } catch {
    // The isolate still holds the set, so serving is unaffected.
  }
}

async function readSnapshot(env: Env): Promise<Snapshot | null> {
  const hit = await caches.default.match(snapshotKey(env));
  if (!hit) return null;
  const payload = (await hit.json().catch(() => null)) as Snapshot | null;
  return payload && typeof payload.at === "number" && Array.isArray(payload.rows) ? payload : null;
}

/** The newer of the isolate's last set and the edge snapshot; null when neither exists. */
async function fallback(env: Env): Promise<Removal[] | null> {
  const mine = last && last.origin === env.SITE_ORIGIN ? last : null;
  const stored = await readSnapshot(env).catch(() => null);
  const newer = stored && (!mine || stored.at > mine.at) ? { origin: env.SITE_ORIGIN, at: stored.at, rows: stored.rows } : mine;
  if (!newer) return null;
  last = newer;
  return newer.rows;
}
