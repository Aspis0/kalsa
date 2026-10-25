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
import type { ThermalStatus } from "./thermalThresholds";
import { withNativeCallTimeout } from "./nativeCallTimeout";
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
 * Map an iOS ProcessInfo.thermalState reading to the advisory ThermalStatus
 * bands (useThermalMonitor). iOS exposes states, never a temperature, so
 * currentTempC stays null on this path. Severity order matches the platform:
 * nominal < fair < serious < critical. Anything unrecognised → "unknown".
 */
export function iosThermalStateToAdvisoryStatus(
  state: string | number | null | undefined,
): ThermalStatus {
  switch (typeof state === "string" ? state.trim().toLowerCase() : state) {
    case "nominal":
    case 0:
      return "ok";
    case "fair":
    case 1:
      return "warm";
    case "serious":
    case 2:
      return "hot";
    case "critical":
    case 3:
      return "critical";
    default:
      return "unknown";
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

/**
 * Android status for the governor thermo feed: an integer 0..6, or null when
 * no platform status exists (iOS, unsupported, unknown, malformed). Null is
 * "omit the key": the engine treats an absent status as no platform vote.
 */
export function readToGovernorStatus(
  read: ThermalPlatformRead | null | undefined,
): number | null {
  if (!read || read.supported !== true || read.platform !== "android") return null;
  const status = read.androidStatus;
  if (typeof status !== "number" || !Number.isInteger(status) || status < 0 || status > 6) {
    return null;
  }
  return status;
}

// WHY 1 s: the feed read runs inside the watchdog-free window before a
// completion (refreshGovernorBeforeCompletion) and at prewarm job start, so a
// hung native call may cost at most this much before the status is dropped
// to absent — never a hang, never a block.
const GOVERNOR_STATUS_READ_TIMEOUT_MS = 1_000;

/** One bounded governor-feed read per completion; timeout or throw reads as
 *  absent, never fatal. */
export async function getCurrentGovernorThermalStatus(): Promise<number | null> {
  try {
    const read = await withNativeCallTimeout(
      getCurrentPlatformThermalState(),
      GOVERNOR_STATUS_READ_TIMEOUT_MS,
      "platform thermal read",
    );
    return readToGovernorStatus(read);
  } catch {
    return null;
  }
}
