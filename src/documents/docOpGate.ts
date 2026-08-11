/**
 * Authoritative shared gate for document library ops.
 *
 * One source of truth for document_chat reads and AppShell deletes so neither
 * can race the other through independent latches. Module-level state, no React.
 *
 * Invariants:
 * - tryAcquireRead fails while a delete is active OR another read is active
 * - tryAcquireDelete fails while ANY op (read or delete) is active
 * - release* only clears the matching slot; callers own finally-release
 * - stale-cap / abort paths must NOT release early — only the owning finally
 */

export type DocOpGate = {
  tryAcquireRead(): boolean;
  releaseRead(): void;
  tryAcquireDelete(): boolean;
  releaseDelete(): void;
  isReadActive(): boolean;
  isDeleteActive(): boolean;
  isAnyActive(): boolean;
};

let readActive = false;
let deleteActive = false;

export function tryAcquireRead(): boolean {
  if (readActive || deleteActive) return false;
  readActive = true;
  return true;
}

export function releaseRead(): void {
  readActive = false;
}

export function tryAcquireDelete(): boolean {
  if (readActive || deleteActive) return false;
  deleteActive = true;
  return true;
}

export function releaseDelete(): void {
  deleteActive = false;
}

export function isReadActive(): boolean {
  return readActive;
}

export function isDeleteActive(): boolean {
  return deleteActive;
}

export function isAnyActive(): boolean {
  return readActive || deleteActive;
}

/** Test-only: force-clear both slots. */
export function __resetDocOpGateForTests(): void {
  readActive = false;
  deleteActive = false;
}
