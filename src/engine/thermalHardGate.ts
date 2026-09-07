/**
 * Pure, platform-independent HARD-gate logic (C3 — total hard gate).
 *
 * Design contract (see C3 — thermal thresholds research):
 *   - A HARD gate BLOCKS new inference and blocks model load/download. It is
 *     the opposite of the advisory bands in `thermalThresholds.ts`, which never
 *     block.
 *   - The gate is driven by the PLATFORM thermal state, never by an untyped
 *     Celsius number. `thermal_zone0` (Android) is an unknown / internal sensor,
 *     so it must NEVER turn this boolean on. Do not invent a CRITICAL from zone0.
 *
 * The two platform signals are intentionally the strongest severity each
 * platform exposes:
 *
 *   Android — `PowerManager.getCurrentThermalStatus()`:
 *     CRITICAL (4) the platform has done everything to reduce power;
 *     EMERGENCY (5) key components shutting down, last warning before shutdown;
 *     SHUTDOWN (6) shut down immediately. All three ⇒ gate.
 *
 *   iOS — `ProcessInfo.thermalState`:
 *     .critical (3) performance significantly impacted, must cool. ⇒ gate.
 *     .serious (2) is a corrective-reduction signal, NOT a total block.
 *
 * Fail-open is explicit: anything unrecognised (undefined / out-of-range /
 * unknown string) is NOT gated. A missing thermal API must never hard-block.
 */

/**
 * Android `PowerManager` thermal-status constants (API 29+). Only the numeric
 * value matters here; the names mirror the platform for readers of native code.
 */
export const THERMAL_STATUS_CRITICAL = 4;
export const THERMAL_STATUS_EMERGENCY = 5;
export const THERMAL_STATUS_SHUTDOWN = 6;

/**
 * iOS `ProcessInfo.thermalState` numeric values (enum order is stable).
 */
export const THERMAL_STATE_CRITICAL = 3;

/**
 * True when an Android `getCurrentThermalStatus()` value has reached the
 * platform CRITICAL severity or worse (CRITICAL / EMERGENCY / SHUTDOWN).
 *
 * Anything below CRITICAL (NONE=0, PERCEPTIBLE=1, SEVERE=2) does NOT gate —
 * those are throttling / reduction signals, not a total block. Unknown /
 * out-of-range values are not gated (fail open).
 */
export function isAndroidThermalHardGated(status: number): boolean {
  return Number.isInteger(status) && status >= THERMAL_STATUS_CRITICAL;
}

/**
 * True when iOS `ProcessInfo.thermalState` is `.critical`.
 *
 * Accepts the numeric enum value (3) or the symbolic string `"critical"`.
 * `.serious` (2) and every other state does NOT gate. Unknown / missing
 * values are not gated (fail open).
 */
export function isIosThermalHardGated(state: string | number): boolean {
  if (typeof state === "number") {
    return Number.isInteger(state) && state === THERMAL_STATE_CRITICAL;
  }
  if (typeof state === "string") {
    return state.trim().toLowerCase() === "critical";
  }
  return false;
}
