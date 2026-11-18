import { ProviderError } from "./providers/http";
import type { Identity, ProviderId } from "./providers/types";

const MAX_USERNAME = 64;
const MAX_AVATAR = 512;

function usableUsername(value: string): boolean {
  return value.length >= 1 && value.length <= MAX_USERNAME && !/\p{Cc}/u.test(value);
}

/** An avatar is stored only as an https URL of bounded length; anything else becomes null. */
function usableAvatar(value: string | null): string | null {
  if (value === null || value.length > MAX_AVATAR || !value.startsWith("https://")) return null;
  return value;
}

/** Applied to the provider's answer before anything is written, so a hostile profile cannot reach the page. */
export function checkedIdentity(identity: Identity): Identity {
  if (!usableUsername(identity.username)) throw new ProviderError("the provider sent an unusable username");
  return { ...identity, avatarUrl: usableAvatar(identity.avatarUrl) };
}

/** One row per provider account. The username and avatar are refreshed at each sign-in; nothing else is kept. */
export async function upsertUser(db: D1Database, provider: ProviderId, identity: Identity, now: number): Promise<number> {
  const row = await db
    .prepare(
      `INSERT INTO users (provider, provider_user_id, username, avatar_url, created_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (provider, provider_user_id) DO UPDATE SET username = excluded.username, avatar_url = excluded.avatar_url
       RETURNING id`,
    )
    .bind(provider, identity.providerUserId, identity.username, identity.avatarUrl, now)
    .first<{ id: number }>();
  if (!row) throw new Error("the account row was not written");
  return row.id;
}
