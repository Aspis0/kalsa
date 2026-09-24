/**
 * The governor-pause evidence lines: the app's ONLY emitters of
 * KALSA_GOVERNOR_PAUSE and KALSA_THERMAL_COOLING, built from numbers and
 * closed-set literals alone so a unit test can pin payload and per-event
 * cardinality (one line per event, one enter/exit pair per episode). The
 * utility refusal decision lives here too — it is what decides whether the
 * site's line fires at all. Rendering, turn failure and history stay with
 * the callers.
 */
import {
  pauseReasonOf,
  type CoolingDetail,
  type GovernorPauseReason,
} from "./thermalResume";

/** Where a utility completion sits — the site line's closed `site` set. */
type UtilityPauseSite = "extractMemory" | "translate" | "completeOnce";

export type GovernorPauseLogEvent =
  | { turnId: string; round: number; reason: GovernorPauseReason }
  | { site: UtilityPauseSite; reason: GovernorPauseReason };

export function governorPauseLogLine(event: GovernorPauseLogEvent): string {
  return `KALSA_GOVERNOR_PAUSE ${JSON.stringify(event)}`;
}

/**
 * A utility completion (memory extract, translation, planner) treats any
 * governor pause as a failure of that call: returns whether the result is
 * paused and emits its ONE evidence line when it is. No cooling wait runs
 * on these paths — the caller returns its own no-result.
 */
export function utilityGovernorPause(result: unknown, site: UtilityPauseSite): boolean {
  const reason = pauseReasonOf(result);
  if (reason === null) return false;
  try {
    console.log(governorPauseLogLine({ site, reason }));
  } catch {
    // telemetry must never throw
  }
  return true;
}

export function thermalCoolingLogLine(event: {
  turnId: string;
  round: number;
  phase: "enter" | "exit";
  detail: CoolingDetail;
}): string {
  return `KALSA_THERMAL_COOLING ${JSON.stringify({
    turnId: event.turnId,
    round: event.round,
    phase: event.phase,
    waitedMs: event.detail.elapsedMs,
    generationMs: event.detail.generationMs,
    batt_temp_tenths_c: event.detail.battTempTenthsC,
    outcome: event.detail.endReason,
  })}`;
}
