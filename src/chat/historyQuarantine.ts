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
 * - A LATER raw whose content differs from the first copy gets its own slot
 *   suffixed with a short FNV-1a hash of the raw, so a conversation that
 *   loses data twice keeps both copies.
 * - "Preserved" means a slot holds EXACTLY this raw: re-loading the same raw
 *   is idempotent and writes nothing. A 32-bit hash collision with different
 *   content is reported as NOT preserved (the caller refuses writes and
 *   tells the user) rather than clobbering either copy.
 */

export function quarantineKeyFor(messagesKey: string): string {
  return `${messagesKey}.quarantine`;
}

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

/**
 * Make sure `raw` survives in a slot. Returns false only when no slot could
 * be read or written — the caller must then refuse writes and tell the user.
 * Idempotent for the same raw.
 */
export async function preserveRawHistory(
  kv: QuarantineKv,
  messagesKey: string,
  raw: string,
): Promise<boolean> {
  const firstSlot = quarantineKeyFor(messagesKey);
  try {
    const first = await kv.getItem(firstSlot);
    if (first === raw) return true;
    if (first == null) {
      await kv.setItem(firstSlot, raw);
      return true;
    }
    const nextSlot = `${firstSlot}.${shortHash(raw)}`;
    const existing = await kv.getItem(nextSlot);
    if (existing === raw) return true;
    if (existing == null) {
      await kv.setItem(nextSlot, raw);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Delete a conversation's messages key together with every quarantine slot
 * of it. Slots go FIRST: a partial failure must never leave a copy as the
 * survivor. Enumerating the suffixed copies needs getAllKeys; a storage
 * without it still loses the first copy and the live key.
 */
export async function deleteConversationHistory(
  kv: {
    removeItem?(key: string): Promise<void>;
    getAllKeys?(): Promise<readonly string[]>;
  },
  messagesKey: string,
): Promise<boolean> {
  const removeItem = kv.removeItem;
  if (!removeItem) return false;
  const firstSlot = quarantineKeyFor(messagesKey);
  await removeItem(firstSlot);
  try {
    const all = kv.getAllKeys ? await kv.getAllKeys() : null;
    if (all != null) {
      const prefix = `${firstSlot}.`;
      for (const key of all) {
        if (typeof key === "string" && key.startsWith(prefix)) {
          await removeItem(key);
        }
      }
    }
  } catch {
    // Enumeration unavailable or failed; the first copy is already gone.
  }
  await removeItem(messagesKey);
  return true;
}
