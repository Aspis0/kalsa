/**
 * Memory-subsystem telemetry (counters only).
 *
 * Measures whether the memory extract/inject path actually ran during a bench arm.
 * Without this, a MEMORY=1 arm where nothing was extracted is indistinguishable
 * from MEMORY=0 — the report looks like a measurement but measures nothing.
 *
 * Fields are enumerated by name so a string field added later cannot leak
 * user text into a log line. Numbers only: counters and extraction lifecycle codes.
 *
 * Privacy: fact TEXT is never included. Counters only.
 */

export interface MemoryTelemetry {
  /** Whether memory was enabled this turn (1=on, 0=off). */
  memoryEnabled: number;
  /** Candidates the settled extract job produced (before filtering). */
  factsExtracted: number;
  /** Facts actually stored by the settled extract job. */
  factsStored: number;
  /** Facts rejected by isSensitiveFact by the settled extract job. */
  factsRejectedSensitive: number;
  /** Facts rejected because the store was full (cap 40). */
  factsRejectedFull: number;
  /** Facts injected into this turn's prompt; turn-end only. */
  factsInjected: number;
  /** Total facts in the store after the settled extract job. */
  totalFactsInStore: number;
  /**
   * DNA notes dropped by the injection-time token bound.
   * -1 = not applicable (memory off or extract line).
   */
  dnaDeferred: number;
  /**
   * DNA notes actually injected this turn after bounding.
   * -1 = not applicable (memory off or extract line).
   */
  dnaInjected: number;
  /**
   * Token sub-budget used for DNA bounding.
   * -1 = not applicable (memory off or extract line).
   */
  dnaBudgetTokens: number;
  /** Extract parse outcome codes are documented with trackMemoryParseOutcome in MemoryStore.ts. */
  extractParseOutcome: number;
  /** Gate-source codes are documented with trackMemoryExtractGateSource in MemoryStore.ts. */
  extractGateSource: number;
  /** Stop-reason codes are documented with trackMemoryExtractStopReason in MemoryStore.ts. */
  extractStopReason: number;
  /** CisWire feature bits: compaction=1, memory=2, tool-help=4. */
  ciswireFlags?: number;
}

/**
 * Machine-parseable single line for adb logcat / CI.
 * Fields listed by name — never spread an object that could leak strings.
 * @param prefix Log line prefix (default: KALSA_MEMORY for turn-end, KALSA_MEMORY_EXTRACT for extract-complete)
 *
 * The turn-end line uses -1 for every field whose value belongs to the not-yet-
 * settled extract job: factsExtracted, factsStored, both rejection counters,
 * totalFactsInStore, and all three extraction lifecycle codes. The settled line
 * uses -1 for factsInjected and the dna* fields because prompt injection
 * belongs to the turn. dna* is also -1 on the turn-end line when memory is off.
 */
export function formatMemoryLine(t: MemoryTelemetry, prefix = "KALSA_MEMORY"): string {
  return `${prefix} ${JSON.stringify({
    memoryEnabled: t.memoryEnabled,
    factsExtracted: t.factsExtracted,
    factsStored: t.factsStored,
    factsRejectedSensitive: t.factsRejectedSensitive,
    factsRejectedFull: t.factsRejectedFull,
    factsInjected: t.factsInjected,
    totalFactsInStore: t.totalFactsInStore,
    dnaDeferred: t.dnaDeferred,
    dnaInjected: t.dnaInjected,
    dnaBudgetTokens: t.dnaBudgetTokens,
    extractParseOutcome: t.extractParseOutcome,
    extractGateSource: t.extractGateSource,
    extractStopReason: t.extractStopReason,
    ...(t.ciswireFlags ? { ciswireFlags: t.ciswireFlags } : {}),
  })}`;
}
