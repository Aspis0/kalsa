/**
 * The preservation store for chat history (the "quarantine").
 *
 * PRESERVATION, NOT RECOVERY: nothing in the app ever reads a quarantine
 * slot back and there is no restore path. Slots exist so a raw that could
 * not be read faithfully cannot be overwritten silently — restoring one is
 * a manual, out-of-app act.
 *
 * Slot policy — never clobber, never pretend:
 * - `<messagesKey>.quarantine` holds the first copy of a conversation's raw.
 * - A LATER raw whose content differs from existing copies gets its own slot
 *   suffixed with a short FNV-1a hash of the raw, so a conversation that
 *   loses data twice keeps both copies.
 * - "Preserved" means a slot holds EXACTLY this raw: re-loading the same raw
 *   is idempotent and writes nothing. A 32-bit hash collision with different
 *   content is reported as NOT preserved (the caller refuses writes and
 *   tells the user) rather than clobbering either copy.
 * - At most QUARANTINE_CAP slots per conversation. Beyond the cap the copy
 *   is refused honestly (the caller refuses writes and tells the user); the
 *   oldest slots are never garbage-collected to make room — that decision
 *   belongs to the user, not to a GC.
 *
 * An index key (`<messagesKey>.quarantine.index`, JSON array of slot keys)
 * tracks the slots. The cap and deletion go through the index — never
 * through key enumeration, which can silently be unavailable and is the
 * wrong foundation for a delete. A missing index is seeded with the first
 * slot so pre-index data stays deletable.
 */

export function quarantineKeyFor(messagesKey: string): string {
  return `${messagesKey}.quarantine`;
}

/** Slots (the first copy included) a single conversation may accumulate. */
const QUARANTINE_CAP = 3;

/**
 * Slot suffixes are base36 FNV-1a hashes: at most 7 chars of [0-9a-z].
 * Deliberately narrow — see the sweep in deleteConversationHistory for why
 * a wider match could delete another conversation's live messages key.
 */
const SLOT_SUFFIX = /^[0-9a-z]{1,7}$/;

/** FNV-1a over the raw, base36 — slot naming only, not an integrity check. */
function shortHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

interface QuarantineKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

function indexKeyFor(firstSlot: string): string {
  return `${firstSlot}.index`;
}

/** Pure parse of the index value; missing or corrupt yields []. */
function listedSlots(rawIndex: string | null): string[] {
  if (rawIndex == null) return [];
  try {
    const parsed: unknown = JSON.parse(rawIndex);
    if (Array.isArray(parsed)) {
      return parsed.filter((slot): slot is string => typeof slot === "string");
    }
  } catch {
    // Corrupt index: start the list over; the first slot is re-added below.
  }
  return [];
}

/** The first copy is always a tracked slot, listed or not (pre-index data). */
function withFirstSlot(listed: string[], firstSlot: string): string[] {
  return listed.includes(firstSlot) ? listed : [firstSlot, ...listed];
}

/**
 * Make sure `raw` survives in a slot. Returns false only when no slot could
 * be read or written, or the conversation is already at the cap — the caller
 * must then refuse writes and tell the user. Idempotent for the same raw.
 */
export async function preserveRawHistory(
  kv: QuarantineKv,
  messagesKey: string,
  raw: string,
): Promise<boolean> {
  const firstSlot = quarantineKeyFor(messagesKey);
  const indexKey = indexKeyFor(firstSlot);
  try {
    const first = await kv.getItem(firstSlot);
    if (first == null) {
      await kv.setItem(firstSlot, raw);
      const slots = withFirstSlot(listedSlots(await kv.getItem(indexKey)), firstSlot);
      await kv.setItem(indexKey, JSON.stringify(slots));
      return true;
    }
    const slot = first === raw ? firstSlot : `${firstSlot}.${shortHash(raw)}`;
    const existing = await kv.getItem(slot);
    if (existing !== raw) {
      if (existing != null) {
        // Hash collision with different content: never clobber either copy.
        return false;
      }
      const slots = withFirstSlot(listedSlots(await kv.getItem(indexKey)), firstSlot);
      if (!slots.includes(slot) && slots.length >= QUARANTINE_CAP) {
        // Cap reached and this raw is not among the copies: refuse honestly
        // instead of evicting the oldest surviving copy.
        return false;
      }
      await kv.setItem(slot, raw);
    }
    const slots = withFirstSlot(listedSlots(await kv.getItem(indexKey)), firstSlot);
    if (!slots.includes(slot)) {
      await kv.setItem(indexKey, JSON.stringify([...slots, slot]));
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a conversation's messages key together with every quarantine slot
 * of it. The index is the primary path; a best-effort getAllKeys sweep of
 * the slot prefix is the net for slots the index does not know (pre-index
 * data, a lost index read-modify-write). Slots go FIRST: a partial failure
 * must never leave a copy as the survivor. Resolves false — never claims
 * success — when the sweep cannot run, so the caller can warn.
 */
export async function deleteConversationHistory(
  kv: {
    getItem(key: string): Promise<string | null>;
    removeItem?(key: string): Promise<void>;
    getAllKeys?(): Promise<readonly string[]>;
  },
  messagesKey: string,
): Promise<boolean> {
  const removeItem = kv.removeItem;
  if (!removeItem) return false;
  const firstSlot = quarantineKeyFor(messagesKey);
  const indexKey = indexKeyFor(firstSlot);
  let slots: string[] = [firstSlot];
  try {
    slots = withFirstSlot(listedSlots(await kv.getItem(indexKey)), firstSlot);
  } catch {
    slots = [firstSlot];
  }
  for (const slot of slots) {
    await removeItem(slot);
  }
  await removeItem(indexKey);
  // The net: sweep suffixed slots the index did not list. When it cannot
  // run, the caller must be told the delete is incomplete.
  let swept = false;
  if (kv.getAllKeys) {
    try {
      const all = await kv.getAllKeys();
      const prefix = `${firstSlot}.`;
      for (const key of all) {
        if (typeof key !== "string" || !key.startsWith(prefix)) continue;
        if (key === indexKey) continue;
        // The suffix must be a slot hash — base36 FNV-1a, at most 7 chars
        // of [0-9a-z]. This regex is deliberately narrow: conversation ids
        // legally contain dots and dashes (sanitizeConversationId keeps
        // [A-Za-z0-9._-]), so a bare prefix sweep could reach ANOTHER
        // conversation's live messages key nested under this prefix and
        // destroy history nobody asked to delete. Only a hash-shaped
        // suffix is a slot of THIS conversation; do not widen it.
        const suffix = key.slice(prefix.length);
        if (SLOT_SUFFIX.test(suffix)) {
          await removeItem(key);
        }
      }
      swept = true;
    } catch {
      swept = false;
    }
  }
  await removeItem(messagesKey);
  return swept;
}
