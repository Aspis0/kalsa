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

/**
 * Free-space floor separating the two eviction regimes: at or above it a save
 * may only evict its own model's conversations; below it the pool evicts
 * globally (foreign models become victims). The disk-gate refusal path pins
 * global regardless of this floor — the gate's requirement (the estimated
 * session x SESSION_DISK_MARGIN) can exceed the floor, so a refusal does not
 * imply a below-floor reading.
 *
 * In units of the one measured constant: 2 conversations cover the pool's own
 * worst-case in-flight write — sessionPersistence writes a full `.kvs.tmp`
 * beside the old `.kvs` before promoting, a peak of ~2x one file — and 4
 * conversations are headroom for everything else a nearly-full phone must
 * still write (the OS, plus this app's non-KV stores and logs). At 6 ×
 * KV_BYTES_PER_CONVERSATION = 255_590_400 B the floor sits far above the
 * pool's own write footprint.
 */
export const EVICTION_FREE_FLOOR_BYTES = 6 * KV_BYTES_PER_CONVERSATION;

/**
 * Which eviction regime a free-space reading selects: true → the global
 * policy (foreign models first), false → a save may only evict its own
 * model's conversations.
 *
 * A null reading selects global: no reading must not silently mean "plenty".
 * The unreadable case itself is owned by the DISK GATE, not by this floor —
 * sessionPersistence.sessionDiskGate names a measured short-space refusal
 * ("short") and only that refusal leads to deleting; null here merely means
 * "no reading, so pick the regime that frees the most".
 * deviceProfile.getFreeDiskBytes normalizes non-finite / negative readings to
 * null upstream, so from the app only null or a finite >= 0 value arrives;
 * the non-finite / negative branches pin the behavior for direct callers
 * instead of letting NaN fall through "<" as per-model.
 *
 * The regime chosen is never silent: the KALSA_SESSION evict line records
 * freeBytes and the policy it selected (plus forced:true when the caller
 * pins global regardless of the reading).
 */
export function evictionGoesGlobal(freeBytes: number | null): boolean {
  if (freeBytes == null) return true;
  if (!Number.isFinite(freeBytes) || freeBytes < 0) return true;
  return freeBytes < EVICTION_FREE_FLOOR_BYTES;
}
