/**
 * The governor's PLATFORM-thermal pause gate (owner decision 2026-09-27).
 *
 * The engine's policy only ever reads the battery temperature
 * (llama-governor-policy.cpp: batt_temp_tenths_c → classify → FAST/WARM/...),
 * so a phone that climbs the Android ladder on CPU/skin heat never pauses
 * while the battery stays cool — measured on the S23 smoke: status 0→3,
 * battery 33.6→41.6 °C, thermal_state FAST. This gate watches the PLATFORM
 * severity instead, for the completion attempts of one cooling round:
 * SEVERE (3) or worse refuses to run the completion and the caller turns
 * that refusal into the engine's own thermal-paused result, so the existing
 * cooling loop, its KALSA_THERMAL_COOLING evidence and its resume gate all
 * stay unchanged. A paused episode resumes only at LIGHT (1) or below —
 * MODERATE (2) in between keeps it paused (hysteresis) — and a missing,
 * unknown or throwing read NEVER blocks (fail-open, the hard gate's
 * documented contract). CRITICAL (4)+ remains the hard gate's job too
 * (thermalHardGate.ts). The battery thresholds are untouched: they stay the
 * mid-generation safety net. Prefill routing is not touched here.
 *
 * iOS keeps only its own critical hard gate: the owner rule quoted is the
 * Android PowerManager ladder, so no iOS pause severity is invented here.
 */
import { getCurrentPlatformThermalState } from "../../modules/kalsa-thermal/src";

/** Android `PowerManager` SEVERE: start pausing completions. */
const PLATFORM_PAUSE_STATUS_SEVERE = 3;
/** Android `PowerManager` LIGHT: a paused episode may resume below this. */
const PLATFORM_PAUSE_RESUME_MAX = 1;

/**
 * The Android thermal status to judge, or null when there is nothing to
 * judge (unsupported module, iOS, malformed read, thrown call): null means
 * fail-open at every caller.
 */
export async function readPlatformThermalStatus(): Promise<number | null> {
  try {
    const read = await getCurrentPlatformThermalState();
    if (!read || read.supported !== true || read.platform !== "android") {
      return null;
    }
    const status = read.androidStatus;
    return typeof status === "number" && Number.isInteger(status) ? status : null;
  } catch {
    return null;
  }
}

export type PlatformPauseReader = () => Promise<number | null>;

/**
 * One cooling round's pause episode: `shouldPauseNow()` answers "do not run
 * the completion; wait like a thermal pause instead". The episode opens at
 * SEVERE and closes only when a LIGHT (or an unreadable — fail-open) reading
 * lets the next attempt run. Not a module singleton on purpose: each cooling
 * round owns its episode, so a fresh round starts clean.
 */
export function createPlatformPauseGate(readStatus: PlatformPauseReader) {
  let episode = false;
  return {
    async shouldPauseNow(): Promise<boolean> {
      let status: number | null;
      try {
        status = await readStatus();
      } catch {
        status = null;
      }
      if (status === null) {
        episode = false;
        return false;
      }
      if (episode) {
        if (status <= PLATFORM_PAUSE_RESUME_MAX) {
          episode = false;
          return false;
        }
        return true;
      }
      if (status >= PLATFORM_PAUSE_STATUS_SEVERE) {
        episode = true;
        return true;
      }
      return false;
    },
  };
}
