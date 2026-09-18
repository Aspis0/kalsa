/**
 * Write-permission state machine for the active conversation's history.
 *
 * Conversations live only on the phone: a write that replaces stored history
 * with less than the store holds is unrecoverable. This module owns the
 * whole state machine for the active messages key; the screens are thin
 * adapters that wire AsyncStorage and the UI to it. Preservation slots live
 * in historyQuarantine.ts.
 *
 * Identity, not counts. The guard tracks the SET of message ids the store is
 * known to hold:
 *
 * - beginHistoryLoad classifies the raw synchronously. A load is faithful
 *   only when it parses to an array, every entry has a usable string id, and
 *   no entry is dropped by sanitize — a dropped entry whose id duplicates a
 *   survivor would pass a pure id-subset check, so the entry count is checked
 *   too. Still necessary, not sufficient: content damage INSIDE a surviving
 *   entry (fields sanitize does not carry, truncation at caps) is invisible
 *   to an id-level guard.
 * - The readable part goes back to the caller immediately so the screen can
 *   render; on a lossy load the write gate stays CLOSED until
 *   settleHistoryLoad has preserved the raw (awaited copy). A write refused
 *   for that window is the acceptable price; a wedged screen is not.
 * - Preservation confirmed → the known-id set becomes the sanitized ids and
 *   writes resume. Refusing after preservation would buy nothing and cost
 *   the user their new messages.
 * - Preservation failed → the gate stays closed and settle reports
 *   preservationFailed so the caller tells the user; a console.warn is not
 *   telling the user.
 * - A write is permitted without a declaration only when every known id is
 *   still present in the list written. armDeclaredShrink records the ids a
 *   declared user action (edit / regenerate truncation) may drop — computed
 *   against known ids PLUS ids of writes in flight, so a declaration made
 *   before a landing write still covers what that write adds; the shrinking
 *   write spends the declaration, an unrelated flush cannot.
 * - A write that outlived its load adopts nothing: it may not reopen a gate
 *   that a failed preservation closed, nor swap a newer load's id set.
 * - The known-id set moves only when a write's KV promise RESOLVES; a
 *   rejected write leaves the store — and the guard — as they were.
 *
 * Privacy: never log message text, conversation ids or storage keys from
 * this module or its call sites — counts and booleans only.
 */
import { preserveRawHistory } from "./historyQuarantine";

/** Minimal KV surface the caller injects (AsyncStorage satisfies it). */
export interface HistoryKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

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

/**
 * Sync refusal signal: `issued` is known synchronously; `landed` resolves
 * true only when the KV write resolved, so engine-session hashing can be
 * keyed off the write actually reaching disk.
 */
export type HistoryWriteTicket =
  | { issued: false }
  | { issued: true; landed: Promise<boolean> };

export interface BegunHistoryLoad<T> {
  /** Sanitized messages to show now; [] when nothing readable. */
  messages: T[];
  /** Raw entries sanitize dropped — may be alerted before preservation settles. */
  droppedCount: number;
}

export interface SettledHistoryLoad {
  /** True: no slot could hold the raw — the gate stays closed. Tell the user. */
  preservationFailed: boolean;
  droppedCount: number;
}

export interface HistoryWriteGuard {
  /**
   * Classify the raw observed at load time. Closes the write gate for the
   * classification and, on a lossy load, for the duration of preservation;
   * returns the readable messages at once so the screen can render.
   * A later begin invalidates this one (conversation switch).
   */
  beginHistoryLoad<T>(
    raw: string | null,
    messagesKey: string,
    sanitize: (entries: unknown[]) => T[],
  ): BegunHistoryLoad<T>;
  /**
   * Preserve the lossy raw (awaited copy) and open the gate on success.
   * Resolves without side effects when the load was faithful or superseded.
   */
  settleHistoryLoad(): Promise<SettledHistoryLoad>;
  /**
   * Declare that a user action is about to shrink history to
   * `listAfterShrink`: the ids it drops become droppable for the write that
   * performs the shrink. Ids learned later are NOT covered and need a fresh
   * declaration.
   */
  armDeclaredShrink(listAfterShrink: readonly unknown[]): void;
  /**
   * Decide and write. `persist` receives the JSON payload; the guard
   * stringifies. `issued` is the synchronous refusal signal; the known-id
   * set moves only when `landed` resolves.
   */
  tryPersist(
    list: readonly unknown[],
    persist: (json: string) => Promise<void>,
  ): HistoryWriteTicket;
  /**
   * True while the store holds (or may hold) messages the screen is not
   * showing: closed gate, or a known non-empty id set. Feeds the "is this
   * chat empty" probe — in that state "New chat" must really create a
   * conversation instead of keeping the user here.
   */
  storeKnownToHoldMessages(): boolean;
}

type Gate =
  | { open: true; knownIds: Set<string> }
  | { open: false };

/** A lossy load waiting for its preservation copy. */
interface PendingPreservation {
  seq: number;
  raw: string;
  messagesKey: string;
  knownIds: Set<string>;
  droppedCount: number;
}

export function createHistoryWriteGuard(kv: HistoryKv): HistoryWriteGuard {
  // Boot: closed until the first load classifies the key, so no write can
  // land between getItem and the preservation copy.
  let gate: Gate = { open: false };
  /** Ids a declared shrink may drop; null when nothing is armed. */
  let declaredDroppable: Set<string> | null = null;
  /** Ids of the newest issued-but-unsettled write. */
  let pendingIds: Set<string> | null = null;
  /** Latest load wins gate application; copies complete regardless. */
  let loadSeq = 0;
  /** Only the newest issued write adopts on resolve. */
  let writeSeq = 0;
  let pendingPreservation: PendingPreservation | null = null;

  return {
    beginHistoryLoad(raw, messagesKey, sanitize) {
      const seq = ++loadSeq;
      declaredDroppable = null;
      pendingPreservation = null;
      gate = { open: false };
      if (raw == null) {
        gate = { open: true, knownIds: new Set<string>() };
        return { messages: [], droppedCount: 0 };
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const messages = Array.isArray(parsed) ? sanitize(parsed) : [];
      const knownIds = idsOfList(messages);
      const droppedCount = Array.isArray(parsed)
        ? Math.max(0, parsed.length - messages.length)
        : 0;
      let lossy = !Array.isArray(parsed);
      if (Array.isArray(parsed)) {
        // The count catches a dropped entry even when its id duplicates a
        // surviving one (idsOfList dedups — the id-subset check alone would
        // wave it through).
        lossy = droppedCount > 0;
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
          if (!knownIds.has(id)) {
            lossy = true;
            break;
          }
        }
      }
      if (!lossy) {
        gate = { open: true, knownIds };
        return { messages, droppedCount: 0 };
      }
      pendingPreservation = { seq, raw, messagesKey, knownIds, droppedCount };
      return { messages, droppedCount };
    },

    async settleHistoryLoad() {
      const pending = pendingPreservation;
      if (pending == null || pending.seq !== loadSeq) {
        return { preservationFailed: false, droppedCount: 0 };
      }
      const preserved = await preserveRawHistory(
        kv,
        pending.messagesKey,
        pending.raw,
      );
      if (pending.seq !== loadSeq) {
        // A newer load owns the gate and the user messaging.
        return { preservationFailed: false, droppedCount: 0 };
      }
      if (preserved) {
        gate = { open: true, knownIds: pending.knownIds };
        pendingPreservation = null;
        return {
          preservationFailed: false,
          droppedCount: pending.droppedCount,
        };
      }
      return { preservationFailed: true, droppedCount: pending.droppedCount };
    },

    armDeclaredShrink(listAfterShrink) {
      if (!gate.open) return;
      const known = new Set(gate.knownIds);
      if (pendingIds != null) {
        // The store is about to provably hold these: a truncation that drops
        // them must be declared now, not only after the write lands.
        for (const id of pendingIds) known.add(id);
      }
      const kept = idsOfList(listAfterShrink);
      const droppable = new Set<string>();
      for (const id of known) {
        if (!kept.has(id)) droppable.add(id);
      }
      declaredDroppable = droppable;
    },

    tryPersist(list, persist) {
      if (!gate.open) return { issued: false };
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
          return { issued: false };
        }
      }
      const seq = ++writeSeq;
      const loadAtIssue = loadSeq;
      pendingIds = ids;
      const landed: Promise<boolean> = persist(JSON.stringify(list)).then(
        () => {
          if (seq === writeSeq) pendingIds = null;
          if (seq === writeSeq && loadAtIssue === loadSeq) {
            gate = { open: true, knownIds: ids };
            if (viaDeclaration) {
              // Spent by exactly the write that performed the shrink.
              declaredDroppable = null;
            }
          }
          return true;
        },
        () => {
          if (seq === writeSeq) pendingIds = null;
          return false;
        },
      );
      return { issued: true, landed };
    },

    storeKnownToHoldMessages() {
      if (!gate.open) return true;
      return gate.knownIds.size > 0;
    },
  };
}
