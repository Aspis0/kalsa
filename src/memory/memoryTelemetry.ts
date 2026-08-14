/**
 * Memory-subsystem telemetry (counters only).
 *
 * Measures whether the memory extract/inject path actually ran during a bench arm.
 * Without this, a MEMORY=1 arm where nothing was extracted is indistinguishable
 * from MEMORY=0 — the report looks like a measurement but measures nothing.
 *
 * Fields are enumerated by name so a string field added later cannot leak
 * user text into a log line. Numbers only: extracted, stored, rejected, injected, total.
 *
 * Privacy: fact TEXT is never included. Counters only.
 */

export interface MemoryTelemetry {
  /** Candidates the extract job produced this turn (before filtering). */
  factsExtracted: number;
  /** Facts actually stored after dedup/cap/sensitive filter. */
  factsStored: number;
  /** Facts rejected by isSensitiveFact. */
  factsRejectedSensitive: number;
  /** Facts rejected because store was full (cap 40). */
  factsRejectedFull: number;
  /** Facts injected into this turn's system prompt (0..10). */
  factsInjected: number;
  /** Total facts in the store at turn end. */
  totalFactsInStore: number;
}

/**
 * Machine-parseable single line for adb logcat / CI.
 * Fields listed by name — never spread an object that could leak strings.
 */
export function formatMemoryLine(t: MemoryTelemetry): string {
  return `KALSA_MEMORY ${JSON.stringify({
    factsExtracted: t.factsExtracted,
    factsStored: t.factsStored,
    factsRejectedSensitive: t.factsRejectedSensitive,
    factsRejectedFull: t.factsRejectedFull,
    factsInjected: t.factsInjected,
    totalFactsInStore: t.totalFactsInStore,
  })}`;
}
