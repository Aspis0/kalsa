/**
 * Platform thermal HARD-gate reader (C3).
 *
 * Reads the OS-level thermal severity from a tiny native module and maps it to
 * the pure gate predicates in `thermalHardGate.ts`:
 *
 *   Android — `PowerManager.getCurrentThermalStatus()` (numeric).
 *   iOS     — `ProcessInfo.thermalState` (numeric enum or symbolic string).
 *
 * FAIL-OPEN is the whole point: if the platform thermal API is unavailable (the
 * native module is not linked / built, or a call throws), this returns
 * `false` — i.e. it does NOT hard-block. It never invents a CRITICAL from the
 * advisory `thermal_zone0` Celsius number.
 *
 * The native module is the local Expo module in `modules/kalsa-thermal/`.
 * Its listener/query surface is intentionally defensive: any missing module,
 * missing method, malformed snapshot, or thrown call resolves to "not gated".
 */
import { isAndroidThermalHardGated, isIosThermalHardGated } from "./thermalHardGate";
import {
  addPlatformThermalListener as addNativePlatformThermalListener,
  getCurrentPlatformThermalState,
  isPlatformThermalModuleAvailable,
  type PlatformThermalRead,
} from "../../modules/kalsa-thermal/src";

export type ThermalPlatformRead = PlatformThermalRead;

/** Subscribe to native thermal transitions; a missing module returns null. */
export function addPlatformThermalListener(
  listener: (read: ThermalPlatformRead) => void,
) {
  return addNativePlatformThermalListener(listener);
}

/**
 * Map a raw platform reading to the hard-gate boolean. Unknown / missing
 * signals are NOT gated (fail open).
 */
export function readToHardGate(read: ThermalPlatformRead): boolean {
  if (!read || read.supported !== true || read.platform == null) return false;
  switch (read.platform) {
    case "android":
      return (
        typeof read.androidStatus === "number" &&
        isAndroidThermalHardGated(read.androidStatus)
      );
    case "ios":
      return (
        (typeof read.iosState === "string" ||
          typeof read.iosState === "number") &&
        isIosThermalHardGated(read.iosState)
      );
    default:
      return false;
  }
}

/**
 * True when a linked native thermal module exposes the current-state query.
 * Used for diagnostics only; missing methods still fail open.
 */
export function isPlatformThermalApiAvailable(): boolean {
  return isPlatformThermalModuleAvailable();
}

/**
 * Read the platform thermal severity and return whether the device is at (or
 * past) the total HARD-gate severity. Fails OPEN (returns `false`) when the
 * platform thermal API is unavailable or errors — it never hard-blocks on a
 * fabricated temperature.
 */
export async function getPlatformThermalHardGate(): Promise<boolean> {
  try {
    const read = await getCurrentPlatformThermalState();
    if (!read) return false;
    return readToHardGate(read);
  } catch {
    // A throwing native call must NOT hard-block: fail open.
    return false;
  }
}
