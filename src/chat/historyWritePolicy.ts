/**
 * Write-permission policy for one conversation's history key.
 *
 * The rules, none of the flows:
 * - A closed gate refuses every write (boot, load in flight, preservation
 *   failed). An open gate carries the SET of message ids the store is
 *   known to hold.
 * - A write is permitted only when every known id is still present in the
 *   list written — identity, not counts: a length is not evidence about
 *   content.
 * - armDeclaredShrink records the ids a declared user action (edit /
 *   regenerate truncation) may drop; the shrinking write spends the
 *   declaration, an unrelated flush cannot. Ids of the newest issued-but-
 *   unsettled write count as known: a declaration made before a landing
 *   write still covers what that write adds.
 * - The known-id set moves only when a write's KV promise RESOLVES and that
 *   write is still the newest AND its load is still current — a rejected
 *   write adopts nothing, and a write that outlived its load may not
 *   reopen a closed gate or swap a newer load's id set.
 *
 * Sequencing of loads (loadSeq) belongs to the lifecycle; the policy only
 * compares the value captured at issue time with the current one.
 *
 * Privacy: never log message text, conversation ids or storage keys from
 * this module or its call sites — counts and booleans only.
 */
import { idsOfList } from "./historyClassifier";

export type WriteAuthorization =
  | {
      allowed: true;
      ids: Set<string>;
      viaDeclaration: boolean;
    }
  | { allowed: false };

export interface WritePermissionPolicy {
  /** Open the gate; the store provably holds these ids (possibly none). */
  open(knownIds: Set<string>): void;
  /** Close the gate: every write is refused until the next open. */
  close(): void;
  /**
   * Declare that a user action is about to shrink history to
   * `listAfterShrink`: the ids it drops become droppable for the write that
   * performs the shrink. Ids learned later are NOT covered and need a fresh
   * declaration.
   */
  armDeclaredShrink(listAfterShrink: readonly unknown[]): void;
  /** Synchronous decision: may this list be written right now? */
  authorize(list: readonly unknown[]): WriteAuthorization;
  /** Register an issued write; returns its sequence number. */
  beginIssue(ids: Set<string>): number;
  /**
   * A KV promise resolved: adopt unless superseded by a write or a load.
   * `spendsDeclaration` is true only for the write the declaration covered.
   */
  writeLanded(
    seq: number,
    ids: Set<string>,
    loadAtIssue: number,
    loadSeqNow: number,
    spendsDeclaration: boolean,
  ): void;
  /** A KV promise rejected: the store is unchanged; adopt nothing. */
  writeRejected(seq: number): void;
  /**
   * True while the store holds (or may hold) messages the screen is not
   * showing: closed gate, or a known non-empty id set.
   */
  knownToHoldMessages(): boolean;
}

type Gate =
  | { open: true; knownIds: Set<string> }
  | { open: false };

export function createWritePermissionPolicy(): WritePermissionPolicy {
  // Boot: closed until the first load classifies the key, so no write can
  // land between getItem and the preservation copy.
  let gate: Gate = { open: false };
  /** Ids a declared shrink may drop; null when nothing is armed. */
  let declaredDroppable: Set<string> | null = null;
  /** Ids of the newest issued-but-unsettled write. */
  let pendingIds: Set<string> | null = null;
  /** Only the newest issued write adopts on resolve. */
  let writeSeq = 0;

  return {
    open(knownIds) {
      gate = { open: true, knownIds };
    },

    close() {
      gate = { open: false };
      // A declaration is scoped to the visit that armed it: it must not
      // authorize a shrink after a reload of the same conversation.
      declaredDroppable = null;
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

    authorize(list) {
      if (!gate.open) return { allowed: false };
      const ids = idsOfList(list);
      const missing: string[] = [];
      for (const id of gate.knownIds) {
        if (!ids.has(id)) missing.push(id);
      }
      if (missing.length === 0) {
        return { allowed: true, ids, viaDeclaration: false };
      }
      const droppable = declaredDroppable;
      if (droppable != null && missing.every((id) => droppable.has(id))) {
        return { allowed: true, ids, viaDeclaration: true };
      }
      return { allowed: false };
    },

    beginIssue(ids) {
      const seq = ++writeSeq;
      pendingIds = ids;
      return seq;
    },

    writeLanded(seq, ids, loadAtIssue, loadSeqNow, spendsDeclaration) {
      if (seq === writeSeq) pendingIds = null;
      if (seq !== writeSeq || loadAtIssue !== loadSeqNow) return;
      gate = { open: true, knownIds: ids };
      if (spendsDeclaration) {
        // Spent by exactly the write that performed the shrink.
        declaredDroppable = null;
      }
    },

    writeRejected(seq) {
      if (seq === writeSeq) pendingIds = null;
    },

    knownToHoldMessages() {
      if (!gate.open) return true;
      return gate.knownIds.size > 0;
    },
  };
}
