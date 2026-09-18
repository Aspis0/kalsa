/**
 * Guard for chat-history persistence.
 *
 * Conversations live only on the phone: a write that replaces stored history
 * with less than the store holds is unrecoverable. This module owns the whole
 * state machine for the active conversation's messages key; the screens are
 * thin adapters that wire AsyncStorage and the UI to it.
 *
 * Identity, not counts. A length is not evidence about content, so the guard
 * tracks the SET of message ids the store is known to hold:
 *
 * - On load, raw entries are identified by their string `id`. A load is
 *   faithful only when every entry has a usable id and every raw id survives
 *   sanitize. Anything else — parse failure, non-array payload, one dropped
 *   or unidentifiable entry — is a lossy load. A load that sanitizes to the
 *   same COUNT is still lossy when the ids differ: equal counts say nothing
 *   about whether the content survived.
 * - A lossy load is quarantined before anything else: the raw is copied to
 *   `<messagesKey>.quarantine` and the copy is awaited. The quarantine is
 *   PRESERVATION, NOT RECOVERY — nothing in the app ever reads it back and
 *   there is no restore path; it exists so the original raw cannot be
 *   overwritten silently. The first copy wins (the oldest surviving copy is
 *   the valuable one) and neither key is ever deleted here.
 * - Preservation confirmed → writes resume against what is on screen (the
 *   known-id set becomes the sanitized ids). Refusing further writes after
 *   preservation would buy nothing and cost the user their new messages.
 * - Preservation failed or still in flight → every write is refused and the
 *   caller is told via LoadOutcome.preservationFailed so it can surface the
 *   state to the user; a console.warn is not telling the user.
 * - A write is permitted without a declaration only when every known id is
 *   still present in the list being written. armDeclaredShrink records the
 *   ids a declared user action (edit / regenerate truncation) may drop; the
 *   write that actually shrinks spends the declaration, so an unrelated
 *   flush in between cannot consume it.
 * - An allowed write moves the known-id set only after its promise resolves:
 *   a rejected write leaves the store — and the guard — as they were.
 *
 * Privacy: never log message text, conversation ids or storage keys from
 * this module or its call sites — counts and booleans only.
 */

/** Minimal KV surface the caller injects (AsyncStorage satisfies it). */
export interface HistoryKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

export function quarantineKeyFor(messagesKey: string): string {
  return `${messagesKey}.quarantine`;
}

/**
 * Delete a conversation's messages key together with its quarantine.
 * Deleting the conversation without the quarantine would leave the full raw
 * conversation text on disk forever: nothing reads it back and nothing
 * garbage-collects it.
 * The KV only needs removeItem; KeyValueStorage types it optional, so a
 * storage without delete reports `false` instead of deleting halfway.
 */
export async function deleteConversationHistory(
  kv: { removeItem?(key: string): Promise<void> },
  messagesKey: string,
): Promise<boolean> {
  if (!kv.removeItem) return false;
  await kv.removeItem(messagesKey);
  await kv.removeItem(quarantineKeyFor(messagesKey));
  return true;
}

/** Usable id: the same rule sanitizeHistoryMessages accepts. */
function idOfEntry(entry: unknown): string | null {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const id = (entry as Record<string, unknown>).id;
  return typeof id === "string" && id ? id : null;
}

function idsOfList(list: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const entry of list) {
    const id = idOfEntry(entry);
    if (id != null) ids.add(id);
  }
  return ids;
}

export interface LoadOutcome<T> {
  /** Sanitized messages to show; [] when nothing readable. */
  messages: T[];
  /**
   * True when the raw needs preservation and the copy did not land: writes
   * stay refused until the next successful load, and the caller MUST tell
   * the user (Alert), not just log.
   */
  preservationFailed: boolean;
}

export interface HistoryWriteGuard {
  /**
   * Feed the raw observed at load time. Awaits the quarantine copy on a
   * lossy load before resolving, so the caller knows the outcome before the
   * first write can be scheduled. A load that starts later invalidates this
   * one (conversation switch); the copy still completes — preservation
   * transcends switches — only the state application is dropped.
   */
  onHistoryLoaded<T>(
    raw: string | null,
    messagesKey: string,
    sanitize: (entries: unknown[]) => T[],
  ): Promise<LoadOutcome<T>>;
  /**
   * Declare that a user action is about to shrink history to `listAfterShrink`:
   * the ids it drops become droppable for the write that performs the shrink.
   * Ids learned later are NOT covered and need a fresh declaration.
   */
  armDeclaredShrink(listAfterShrink: readonly unknown[]): void;
  /**
   * Decide and write. `persist` receives the JSON payload; the guard stringifies.
   * Returns true when the write was issued (the caller may treat "issued" as
   * "happened" for engine-session hashing); false when refused — nothing is
   * written. The known-id set moves only when the promise resolves (B4), and
   * the declaration is spent only by a write that needed it.
   */
  tryPersist(
    list: readonly unknown[],
    persist: (json: string) => Promise<void>,
  ): boolean;
  /**
   * True while the store holds (or may hold) messages the screen is not
   * showing: blocked state, or a known non-empty id set. Feeds the
   * "is this chat empty" probe — in that state "New chat" must really
   * create a conversation instead of keeping the user here.
   */
  storeKnownToHoldMessages(): boolean;
}

type Gate =
  | { open: true; knownIds: Set<string> }
  | { open: false };

export function createHistoryWriteGuard(kv: HistoryKv): HistoryWriteGuard {
  // Boot: closed until the first load classifies the key, so no write can
  // land between getItem and the quarantine copy.
  let gate: Gate = { open: false };
  /** Ids a declared shrink may drop; null when nothing is armed. */
  let declaredDroppable: Set<string> | null = null;
  /** Latest load wins state application; copies complete regardless. */
  let loadSeq = 0;
  /** Only the newest issued write adopts on resolve. */
  let writeSeq = 0;

  return {
    async onHistoryLoaded(raw, messagesKey, sanitize) {
      const seq = ++loadSeq;
      declaredDroppable = null;
      // Closed for the duration of the classification/copy: no write may
      // land between getItem and quarantine, and a previous load's ids must
      // not authorize writes to the new key.
      gate = { open: false };
      if (raw == null) {
        gate = { open: true, knownIds: new Set<string>() };
        return { messages: [], preservationFailed: false };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const messages = Array.isArray(parsed) ? sanitize(parsed) : [];
      const sanitizedIds = idsOfList(messages);
      let lossy = !Array.isArray(parsed);
      if (Array.isArray(parsed)) {
        const rawIds = new Set<string>();
        for (const entry of parsed) {
          const id = idOfEntry(entry);
          if (id == null) {
            // An entry without a usable id cannot be tracked across writes:
            // lossy by definition.
            lossy = true;
            continue;
          }
          rawIds.add(id);
        }
        for (const id of rawIds) {
          if (!sanitizedIds.has(id)) {
            lossy = true;
            break;
          }
        }
      }

      if (!lossy) {
        gate = { open: true, knownIds: sanitizedIds };
        return { messages, preservationFailed: false };
      }

      // Lossy → preserve first. An existing quarantine already holds this
      // conversation's oldest surviving copy (it is only ever written for
      // this key's lossy raws), so it counts as preserved — never clobbered.
      let preserved = true;
      try {
        const quarantineKey = quarantineKeyFor(messagesKey);
        const existing = await kv.getItem(quarantineKey);
        if (existing == null) await kv.setItem(quarantineKey, raw);
      } catch {
        preserved = false;
      }
      if (seq !== loadSeq) {
        // A newer load owns the gate and the user messaging.
        return { messages: [], preservationFailed: false };
      }
      if (preserved) {
        gate = { open: true, knownIds: sanitizedIds };
        return { messages, preservationFailed: false };
      }
      gate = { open: false };
      return { messages, preservationFailed: true };
    },

    armDeclaredShrink(listAfterShrink) {
      if (!gate.open) return;
      const kept = idsOfList(listAfterShrink);
      const droppable = new Set<string>();
      for (const id of gate.knownIds) {
        if (!kept.has(id)) droppable.add(id);
      }
      declaredDroppable = droppable;
    },

    tryPersist(list, persist) {
      if (!gate.open) return false;
      const ids = idsOfList(list);
      const missing: string[] = [];
      for (const id of gate.knownIds) {
        if (!ids.has(id)) missing.push(id);
      }
      let viaDeclaration = false;
      if (missing.length > 0) {
        const droppable = declaredDroppable;
        if (droppable != null && missing.every((id) => droppable.has(id))) {
          viaDeclaration = true;
        } else {
          return false;
        }
      }
      const seq = ++writeSeq;
      void persist(JSON.stringify(list)).then(
        () => {
          if (seq !== writeSeq) return;
          gate = { open: true, knownIds: ids };
          if (viaDeclaration) {
            // Spent by exactly the write that performed the declared shrink.
            declaredDroppable = null;
          }
        },
        () => undefined,
      );
      return true;
    },

    storeKnownToHoldMessages() {
      if (!gate.open) return true;
      return gate.knownIds.size > 0;
    },
  };
}
