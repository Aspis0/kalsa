/**
 * Epoch-fenced write path for one conversation's history key.
 *
 * The orders below are the specification (tests fail if any is reversed):
 *  1. the epoch is checked BEFORE the payload projection is built;
 *  2. it is checked again immediately BEFORE the guard issues the write;
 *  3. a clear bumps the epoch BEFORE its key is deleted;
 *  4. a clear flushes the old thread's last write BEFORE bumping.
 * A guard refusal ends the attempt — never a retry with fewer messages;
 * recovery after the gate reopens is a full-list rewrite.
 *
 * The epoch stamp is taken at SCHEDULE time by delayed callers (debounce /
 * throttle / AppState) and passed as `opts.epoch`; synchronous callers omit
 * it and are fenced against clears that already landed. The check cannot be
 * skipped.
 */
import type {
  HistoryWriteGuard,
  HistoryWriteTicket,
} from "../chat/historyWriteGuard";

export interface HistoryWriterDeps<T> {
  /** Guard of the active conversation (gate + known-id set). */
  guard: HistoryWriteGuard;
  /** Snapshot → persistable projection (the historyPersistable adapter). */
  project(
    snapshot: readonly T[],
    opts: { allowStreamingPartial: boolean },
  ): T[];
  /**
   * KV write for the bound key. Must REJECT on failure: the guard adopts
   * ids only when the write lands, so a swallowed error would lie to it.
   */
  write(key: string, json: string): Promise<void>;
  /** Counts-only refusal hook (old code warns counts, never ids or text). */
  onRefused?(incomingCount: number): void;
}

export interface HistoryWriter<T> {
  epoch(): number;
  bumpEpoch(): number;
  /** Bind the conversation's messages key; "" unbinds (no conversation). */
  bindKey(key: string): string;
  key(): string;
  /**
   * Persist now. Returns the guard's ticket, or null when nothing was
   * written (stale epoch, empty payload, missing key, or refusal).
   */
  persist(
    snapshot: readonly T[],
    opts?: { epoch?: number; allowStreamingPartial?: boolean },
  ): HistoryWriteTicket | null;
  /** Clear flow: flush the old thread at its still-valid epoch, then bump. */
  flushThenBump(snapshot: readonly T[]): HistoryWriteTicket | null;
  /**
   * Delete flow for the ACTIVE conversation: bump first so a pending write
   * stamped with the old epoch can never land after the removal.
   */
  bumpThenDeleteKey(remove: () => Promise<void>): Promise<void>;
}

export function createHistoryWriter<T>(
  deps: HistoryWriterDeps<T>,
): HistoryWriter<T> {
  let epoch = 0;
  let storageKey = "";

  const writer: HistoryWriter<T> = {
    epoch: () => epoch,
    bumpEpoch: () => (epoch += 1),
    bindKey: (key) => (storageKey = key),
    key: () => storageKey,

    persist(snapshot, opts) {
      if (snapshot.length === 0 || storageKey === "") return null;
      const key = storageKey;
      const stamped = opts?.epoch ?? epoch;
      // Order 1: a clear that already landed stops us before the build.
      if (epoch !== stamped) return null;
      const clean = deps.project(snapshot, {
        allowStreamingPartial: opts?.allowStreamingPartial === true,
      });
      if (clean.length === 0) return null;
      // Order 2: a clear that raced the build stops us before the write.
      if (epoch !== stamped) return null;
      const ticket = deps.guard.tryPersist(clean, (json) => deps.write(key, json));
      if (ticket.issued) return ticket;
      // Refusal ends the attempt: writing a shrunken list here would make
      // the guard's gate the cause of data loss instead of its prevention.
      deps.onRefused?.(clean.length);
      return null;
    },

    flushThenBump(snapshot) {
      // Order 4: stamp the final write BEFORE the bump, or the entry check
      // drops the old thread's last un-debounced messages.
      const ticket = writer.persist(snapshot, {
        epoch,
        allowStreamingPartial: true,
      });
      writer.bumpEpoch();
      return ticket;
    },

    bumpThenDeleteKey(remove) {
      // Order 3: from here on every in-flight write holds a stale stamp.
      writer.bumpEpoch();
      return remove();
    },
  };
  return writer;
}
