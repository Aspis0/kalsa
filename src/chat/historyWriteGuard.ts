/**
 * Two-phase load lifecycle + persistence orchestration for one conversation's
 * history key. The permission rules live in historyWritePolicy.ts, load
 * classification in historyClassifier.ts, preservation slots in
 * historyQuarantine.ts.
 *
 * Conversations live only on the phone: a write that replaces stored history
 * with less than the store holds is unrecoverable. The flow:
 *
 * - beginHistoryLoad classifies the raw synchronously. The readable part goes
 *   back to the caller at once so the screen can render; on a lossy load the
 *   gate stays CLOSED until settleHistoryLoad has preserved the raw (awaited
 *   copy). One refused write in that window is the acceptable price; a
 *   wedged screen is not.
 * - Preservation confirmed → the gate opens against the sanitized ids and
 *   writes resume. Refusing after preservation would buy nothing and cost
 *   the user their new messages.
 * - Preservation failed (unreadable raw with no slot, the copy could not be
 *   written, the cap is reached) → the gate stays closed and settle reports
 *   preservationFailed so the caller tells the user; a console.warn is not
 *   telling the user.
 * - A superseded load (conversation switch) loses only the gate application —
 *   its copy is dispatched regardless: preservation transcends switches.
 * - Turn-end flows key engine-session hashing off the write LANDING via
 *   HistoryWriteTicket.landed, not off the synchronous issue.
 *
 * Privacy: never log message text, conversation ids or storage keys from
 * this module or its call sites — counts and booleans only.
 */
import { classifyHistory } from "./historyClassifier";
import { preserveRawHistory } from "./historyQuarantine";
import {
  createWritePermissionPolicy,
  type WritePermissionPolicy,
} from "./historyWritePolicy";

/** Minimal KV surface the caller injects (AsyncStorage satisfies it). */
export interface HistoryKv {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
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
  /** Raw entries sanitize dropped; 0 when unreadable (nothing to count). */
  droppedCount: number;
}

export interface SettledHistoryLoad {
  /** True: no slot could hold the raw — the gate stays closed. Tell the user. */
  preservationFailed: boolean;
  /** True: the raw parsed to nothing readable — the chat really is empty. */
  unreadable: boolean;
  droppedCount: number;
}

export interface HistoryWriteGuard {
  /**
   * Classify the raw observed at load time. Closes the gate for the
   * classification and, on a lossy load, for the duration of preservation;
   * returns the readable messages at once so the screen can render. A later
   * begin invalidates this one (conversation switch) but its copy still
   * completes — only the gate application is dropped.
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
  /** Delegate: declare the ids a user truncation may drop. */
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

/** A lossy load waiting for its preservation copy. */
interface PendingPreservation {
  seq: number;
  raw: string;
  messagesKey: string;
  knownIds: Set<string>;
  droppedCount: number;
  unreadable: boolean;
}

export function createHistoryWriteGuard(kv: HistoryKv): HistoryWriteGuard {
  const policy: WritePermissionPolicy = createWritePermissionPolicy();
  /** Latest load wins gate application; copies complete regardless. */
  let loadSeq = 0;
  let pendingPreservation: PendingPreservation | null = null;

  return {
    beginHistoryLoad(raw, messagesKey, sanitize) {
      const seq = ++loadSeq;
      // A superseded load's raw is still preserved: dispatch its copy now,
      // fire-and-forget (preserveRawHistory never rejects). Only the gate
      // application below is dropped.
      const orphan = pendingPreservation;
      pendingPreservation = null;
      if (orphan != null) {
        void preserveRawHistory(kv, orphan.messagesKey, orphan.raw);
      }
      policy.close();
      const classified = classifyHistory(raw, sanitize);
      if (!classified.lossy) {
        policy.open(classified.knownIds);
        return { messages: classified.messages, droppedCount: 0 };
      }
      if (raw != null) {
        pendingPreservation = {
          seq,
          raw,
          messagesKey,
          knownIds: classified.knownIds,
          droppedCount: classified.droppedCount,
          unreadable: classified.unreadable,
        };
      }
      return {
        messages: classified.messages,
        droppedCount: classified.droppedCount,
      };
    },

    async settleHistoryLoad() {
      const pending = pendingPreservation;
      if (pending == null || pending.seq !== loadSeq) {
        return { preservationFailed: false, unreadable: false, droppedCount: 0 };
      }
      const preserved = await preserveRawHistory(
        kv,
        pending.messagesKey,
        pending.raw,
      );
      if (pending.seq !== loadSeq) {
        // A newer load owns the gate and the user messaging.
        return { preservationFailed: false, unreadable: false, droppedCount: 0 };
      }
      if (preserved) {
        policy.open(pending.knownIds);
        pendingPreservation = null;
        return {
          preservationFailed: false,
          unreadable: pending.unreadable,
          droppedCount: pending.droppedCount,
        };
      }
      return {
        preservationFailed: true,
        unreadable: pending.unreadable,
        droppedCount: pending.droppedCount,
      };
    },

    armDeclaredShrink(listAfterShrink) {
      policy.armDeclaredShrink(listAfterShrink);
    },

    tryPersist(list, persist) {
      const decision = policy.authorize(list);
      if (!decision.allowed) return { issued: false };
      const seq = policy.beginIssue(decision.ids);
      const loadAtIssue = loadSeq;
      const landed: Promise<boolean> = persist(JSON.stringify(list)).then(
        () => {
          policy.writeLanded(
            seq,
            decision.ids,
            loadAtIssue,
            loadSeq,
            decision.viaDeclaration,
          );
          return true;
        },
        () => {
          policy.writeRejected(seq);
          return false;
        },
      );
      return { issued: true, landed };
    },

    storeKnownToHoldMessages() {
      return policy.knownToHoldMessages();
    },
  };
}
