/**
 * The transcript epoch each pairing last read, kept in one place for both
 * callers that need it: the JSON routes send it as Kalsa-Room-Epoch and
 * check it against the answer, and the event stream resumes with it and
 * drops it the moment a resync begins. Process-only — a restart forgets,
 * and an absent epoch is a phone that checks nothing (§7).
 */

const epochs = new Map<string, string>();

export function noteRoomEpoch(localId: string, epoch: string): void {
  epochs.set(localId, epoch);
}

export function cachedRoomEpoch(localId: string): string | null {
  return epochs.get(localId) ?? null;
}

/** The epoch is dead (409, a header that disagrees, a resync in flight):
 *  the next call goes out bare and learns the new one from info. */
export function forgetRoomEpoch(localId: string): void {
  epochs.delete(localId);
}

/** Test seam: a case that cares about the cache starts with none. */
export function resetRoomEpochs(): void {
  epochs.clear();
}
