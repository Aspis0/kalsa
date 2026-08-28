/**
 * Digest-build telemetry (counters + timing only).
 *
 * Measures the cost of the BM25 digest build on every compaction turn.
 * This is the baseline the CisWire hybrid leg has to be judged against —
 * without it, "the hybrid is fast enough" is an opinion, not a measurement.
 *
 * Fields are enumerated by name so a string field added later cannot leak
 * user text into a log line. Numbers only: duration, candidate count,
 * selected count.
 */

export interface DigestTelemetry {
  /** Wall-clock duration of buildDigest in milliseconds. */
  durationMs: number;
  /**
   * Documents the ranking scanned — the variable the cost scales on. NOT the
   * number of snippets returned: that is capped at top-N (4) and would say
   * nothing about the work done to produce it.
   */
  corpusSize: number;
  /** Number of snippets actually selected for the digest. */
  selectedCount: number;
  /** CisWire feature bits: compaction=1, memory=2, tool-help=4. */
  ciswireFlags?: number;
}

/**
 * Machine-parseable single line for adb logcat / CI.
 * Fields listed by name — never spread an object that could leak strings.
 */
export function formatDigestLine(t: DigestTelemetry): string {
  return `KALSA_DIGEST ${JSON.stringify({
    durationMs: t.durationMs,
    corpusSize: t.corpusSize,
    selectedCount: t.selectedCount,
    ...(t.ciswireFlags ? { ciswireFlags: t.ciswireFlags } : {}),
  })}`;
}
