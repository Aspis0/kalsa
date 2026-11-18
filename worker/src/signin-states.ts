import { sha256Hex } from "./crypto";
import type { ProviderId } from "./providers/types";

/** Records the attempt and sweeps expired rows, so the table cannot grow without a scheduled job. */
export async function rememberState(db: D1Database, provider: ProviderId, state: string, expiresAt: number, now: number): Promise<void> {
  await db.batch([
    db.prepare("DELETE FROM signin_states WHERE expires_at <= ?").bind(now),
    db.prepare("INSERT INTO signin_states (hash, provider, expires_at) VALUES (?, ?, ?)").bind(await sha256Hex(state), provider, expiresAt),
  ]);
}

/** Spends the attempt: one statement both proves the row existed and removes it, so a replay finds nothing. */
export async function spendState(db: D1Database, provider: ProviderId, state: string): Promise<boolean> {
  const row = await db
    .prepare("DELETE FROM signin_states WHERE hash = ? AND provider = ? RETURNING hash")
    .bind(await sha256Hex(state), provider)
    .first<{ hash: string }>();
  return row !== null;
}
