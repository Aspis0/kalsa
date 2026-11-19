import { cookie, expiredCookie, readCookie } from "./cookies";
import { randomToken, sha256Hex } from "./crypto";

export const SESSION_COOKIE = "__Host-kalsa_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface Account {
  username: string;
  avatar: string | null;
  provider: string;
}

/** What a state-changing route needs besides the public account: the provider's own id for the account. */
export interface SessionUser extends Account {
  userId: number;
  providerUserId: string;
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/** The cookie carries the random value; D1 keeps only its SHA-256, so a database read cannot sign anyone in. */
export async function openSession(db: D1Database, userId: number, now: number): Promise<string> {
  const token = randomToken();
  await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= ?").bind(now),
    db.prepare("INSERT INTO sessions (hash, user_id, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(token), userId, now + SESSION_TTL_SECONDS),
  ]);
  return cookie(SESSION_COOKIE, token, SESSION_TTL_SECONDS);
}

export async function readSessionUser(db: D1Database, request: Request, now: number): Promise<SessionUser | null> {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT users.id, users.provider_user_id, users.username, users.avatar_url, users.provider
       FROM sessions JOIN users ON users.id = sessions.user_id
       WHERE sessions.hash = ? AND sessions.expires_at > ?`,
    )
    .bind(await sha256Hex(token), now)
    .first<{ id: number; provider_user_id: string; username: string; avatar_url: string | null; provider: string }>();
  if (!row) return null;
  return { userId: row.id, providerUserId: row.provider_user_id, username: row.username, avatar: row.avatar_url, provider: row.provider };
}

/** The public account, which is all /api/me ever returns. */
export async function readSession(db: D1Database, request: Request, now: number): Promise<Account | null> {
  const user = await readSessionUser(db, request, now);
  return user ? { username: user.username, avatar: user.avatar, provider: user.provider } : null;
}

export async function closeSession(db: D1Database, request: Request): Promise<string> {
  const token = readCookie(request, SESSION_COOKIE);
  if (token) await db.prepare("DELETE FROM sessions WHERE hash = ?").bind(await sha256Hex(token)).run();
  return expiredCookie(SESSION_COOKIE);
}
