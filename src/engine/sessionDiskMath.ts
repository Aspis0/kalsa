/** Bytes to free so the strict disk gate can pass after eviction. */
export function sessionDiskDeficitBytes(
  requiredBytes: number | null,
  freeBytes: number | null,
): number {
  // The gate passes only when free > required, so equality needs one byte.
  // The null case cannot be covered by a test: removing this guard makes
  // strict TypeScript reject the subtraction, so ts-jest reports Tests: 0
  // total instead of running a failing test. The type checker holds this guard.
  if (
    requiredBytes == null ||
    freeBytes == null ||
    requiredBytes < freeBytes
  ) {
    return 0;
  }
  return requiredBytes - freeBytes + 1;
}
