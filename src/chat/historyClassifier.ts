/**
 * Faithful-load classification for persisted chat history.
 *
 * Pure derivation: raw bytes in, what survived sanitize out. The write guard
 * consumes this to decide whether a load can pass without preservation.
 *
 * A load is faithful only when the raw parses to an array, every entry has a
 * usable string id, sanitize drops nothing, and no surviving entry's text is
 * SHORTER than the stored one (a shrink is content loss — e.g. a cap cut the
 * text even though the id survived). Identity and counts, plus text lengths;
 * nothing deeper.
 */

export function idOfEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = (entry as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

export function idsOfList(list: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of list) {
    const id = idOfEntry(entry);
    if (id != null) ids.add(id);
  }
  return ids;
}

export interface ClassifiedHistory<T> {
  /** Sanitized messages; [] when nothing readable. */
  messages: T[];
  /** Ids of the sanitized messages — what the screen will hold. */
  knownIds: Set<string>;
  /** Raw entries sanitize dropped; 0 when unreadable (nothing to count). */
  droppedCount: number;
  /** Raw parsed but not to an array: nothing readable, count unknown. */
  unreadable: boolean;
  lossy: boolean;
}

export function classifyHistory<T>(
  raw: string | null,
  sanitize: (entries: unknown[]) => T[],
): ClassifiedHistory<T> {
  if (raw == null) {
    return {
      messages: [],
      knownIds: new Set<string>(),
      droppedCount: 0,
      unreadable: false,
      lossy: false,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (!Array.isArray(parsed)) {
    return {
      messages: [],
      knownIds: new Set<string>(),
      droppedCount: 0,
      unreadable: true,
      lossy: true,
    };
  }
  const messages = sanitize(parsed);
  const knownIds = idsOfList(messages);
  const droppedCount = Math.max(0, parsed.length - messages.length);
  const keptTextLength = new Map<string, number>();
  for (const message of messages) {
    const id = idOfEntry(message);
    const text = (message as { text?: unknown }).text;
    if (id != null && typeof text === "string") {
      keptTextLength.set(id, text.length);
    }
  }
  let lossy = droppedCount > 0;
  for (const entry of parsed) {
    const id = idOfEntry(entry);
    if (id == null) {
      // An entry without a usable id cannot be tracked across writes:
      // lossy by definition.
      lossy = true;
      continue;
    }
    if (!knownIds.has(id)) {
      lossy = true;
      continue;
    }
    // Content loss inside a surviving entry: sanitize kept the id but the
    // text shrank (e.g. a length cap cut it). The count and the id subset
    // are blind to this; the length is not.
    const rawText = (entry as { text?: unknown }).text;
    if (typeof rawText === "string") {
      const kept = keptTextLength.get(id);
      if (kept != null && rawText.length > kept) {
        lossy = true;
      }
    }
  }
  return { messages, knownIds, droppedCount, unreadable: false, lossy };
}
