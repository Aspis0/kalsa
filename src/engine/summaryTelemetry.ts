/**
 * Rolling-summary lifecycle telemetry (stage + counters only).
 *
 * Answers why a summary never materialised: skipped, debounced away, aborted,
 * empty, or stored/promoted. Prefix is stable for adb logcat / CI artifacts.
 *
 * NEVER log user text, transcript content, or summary content — counters,
 * lengths and booleans only.
 */

export type SummaryEvent =
  | "skip-already-scheduled"
  | "skip-compaction-off"
  | "skip-turn-failed"
  | "skip-aborted"
  | "skip-no-corpus"
  | "skip-cadence"
  | "cadence-unreachable-size-trigger"
  | "skip-empty-transcript"
  | "debounce-armed"
  | "debounce-busy"
  | "debounce-cancelled"
  | "llm-start"
  | "llm-aborted"
  | "llm-empty"
  | "llm-error"
  | "stored-pending"
  | "promoted";

/**
 * Machine-parseable single line for adb logcat / CI.
 * Payload is stage + numeric/boolean fields only — NEVER user text.
 */
export function formatSummaryLine(
  event: SummaryEvent,
  fields: Record<string, number | boolean>,
): string {
  return `KALSA_SUMMARY ${JSON.stringify({ event, ...fields })}`;
}
