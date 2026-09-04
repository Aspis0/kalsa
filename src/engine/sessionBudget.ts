/**
 * KV session pool budget: user-facing conversation count ↔ UFS bytes.
 *
 * Measured §7.25: 8_668_927 B / 1672 tokens ≈ 5.2 kB/token → ~41 MB at the
 * loaded 8192 context. Default 7 chats ≈ 300 MB on disk, not RAM.
 */

/** AsyncStorage key: decimal conversation count. */
export const SESSION_POOL_STORAGE_KEY = "kalsa.session.pool.conversations";

/** Measured §7.25 (~5.2 kB/token). */
export const KV_BYTES_PER_TOKEN = 5200;

export const KV_CONTEXT_TOKENS = 8192;

/** ~41 MB per loaded conversation. */
export const KV_BYTES_PER_CONVERSATION = KV_BYTES_PER_TOKEN * KV_CONTEXT_TOKENS;

export const DEFAULT_SESSION_POOL_CONVERSATIONS = 7;

/** Picker values shown in Settings (not megabytes). */
export const SESSION_POOL_CONVERSATION_OPTIONS = [1, 3, 7, 15] as const;

export type SessionPoolConversationOption =
  (typeof SESSION_POOL_CONVERSATION_OPTIONS)[number];

export function isSessionPoolConversationOption(
  n: number,
): n is SessionPoolConversationOption {
  return (SESSION_POOL_CONVERSATION_OPTIONS as readonly number[]).includes(n);
}

/** Invalid / missing storage → default 7. */
export function parseSessionPoolConversations(
  raw: string | null | undefined,
): SessionPoolConversationOption {
  if (typeof raw !== "string" || raw.length === 0) {
    return DEFAULT_SESSION_POOL_CONVERSATIONS;
  }
  const n = Number.parseInt(raw, 10);
  if (isSessionPoolConversationOption(n)) return n;
  return DEFAULT_SESSION_POOL_CONVERSATIONS;
}

export function sessionPoolBudgetBytes(conversations: number): number {
  const n = isSessionPoolConversationOption(conversations)
    ? conversations
    : DEFAULT_SESSION_POOL_CONVERSATIONS;
  return n * KV_BYTES_PER_CONVERSATION;
}
