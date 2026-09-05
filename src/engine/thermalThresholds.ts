/**
 * Pure, platform-independent thermal advisory logic.
 *
 * Design contract (see C3 — thermal thresholds research):
 *   - Advisory ONLY. Never hard-blocks send / load / download.
 *   - `thermal_zone0` on Android is an unknown / internal-like sensor, NOT a
 *     proven skin sensor and NOT the governor's battery sensor. Its thresholds
 *     below are deliberately warm (45 / 48 / 52 °C) so a summer / direct-sun
 *     device is not spammed with banners and normal generation keeps running.
 *   - The governor (when later bridged) uses battery tenths °C with its own
 *     policy (WARM ≥ 38, COOLMODE ≥ 39.5, CRITICAL ≥ 42) and may prefer
 *     GPU_COOLMODE when hot. The app does NOT implement that switch here; it
 *     only emits a `preferGpuPath` flag that is ready for the future bridge.
 */

/**
 * Advisory status surfaced to the UI. `critical` is a strong advisory only —
 * the platform (OS thermal policy / iOS thermalState) remains the safety
 * authority; the app never rejects a send because of this value.
 */
export type ThermalStatus = "ok" | "warm" | "hot" | "critical" | "unknown";

/**
 * One advisory band's enter thresholds plus a shared exit hysteresis. Exit
 * thresholds are `enter − exitHysteresisC`; a band is only left once the
 * temperature falls at least `exitHysteresisC` below its enter point.
 */
export interface ThermalBandThresholds {
  /** °C — at or above this = "warm". */
  warmC: number;
  /** °C — at or above this = "hot". */
  hotC: number;
  /** °C — at or above this = "critical". */
  criticalC: number;
  /** °C — exit an entered band once temperature drops this far below its enter. */
  exitHysteresisC: number;
}

/**
 * Default bands for the Android sysfs `thermal_zone0` / unknown-internal path.
 * Raised well above the governor's battery thresholds on purpose: this sensor
 * is not skin, so a summer device should not banner at 38–42 °C.
 */
export const ZONE0_THERMAL_BANDS: ThermalBandThresholds = {
  warmC: 45,
  hotC: 48,
  criticalC: 52,
  exitHysteresisC: 2,
};

/** Relative ordering used for hysteresis: hotter bands "hold" longer. */
const BAND_RANK: Record<ThermalStatus, number> = {
  ok: 0,
  warm: 1,
  hot: 2,
  critical: 3,
  // "unknown" carries no band, so it never holds a state.
  unknown: 0,
};

/** Classify a single sample by enter thresholds (no memory of prior state). */
function classifyByEnter(
  tempC: number,
  bands: ThermalBandThresholds,
): ThermalStatus {
  if (tempC >= bands.criticalC) return "critical";
  if (tempC >= bands.hotC) return "hot";
  if (tempC >= bands.warmC) return "warm";
  return "ok";
}

/** Exit threshold for an entered band, or null for bands with no hysteresis. */
function exitThresholdFor(
  band: ThermalStatus,
  bands: ThermalBandThresholds,
): number | null {
  switch (band) {
    case "warm":
      return bands.warmC - bands.exitHysteresisC;
    case "hot":
      return bands.hotC - bands.exitHysteresisC;
    case "critical":
      return bands.criticalC - bands.exitHysteresisC;
    default:
      return null;
  }
}

/**
 * Classify `tempC` into an advisory status, applying 2 °C exit hysteresis when
 * `prev` is a hotter band than the raw reading (i.e. the device is cooling
 * down). This prevents banner flapping around a threshold. `prev` of
 * `"unknown"` carries no band and never holds state.
 */
export function statusFromTempC(
  tempC: number,
  prev?: ThermalStatus | null,
  bands: ThermalBandThresholds = ZONE0_THERMAL_BANDS,
): ThermalStatus {
  const raw = classifyByEnter(tempC, bands);
  if (prev == null) return raw;

  // Cooling from a hotter band: stay until we cross that band's exit threshold.
  if (BAND_RANK[prev] > BAND_RANK[raw]) {
    const exit = exitThresholdFor(prev, bands);
    if (exit != null && tempC >= exit) return prev;
  }
  return raw;
}

/**
 * State returned by `useThermalMonitor`. Carries the advisory status, the
 * current temperature (null when only a memory proxy is available), the read
 * source, and a `ThermalGovernorHint` ready for a future governor bridge.
 */
export type ThermalMonitorState = {
  status: ThermalStatus;
  currentTempC: number | null;
  source: "sysfs" | "memory_proxy" | "none";
  sampledAt: number | null;
  hint: ThermalGovernorHint;
};

/**
 * Advisory hint a future governor bridge can consume. `preferGpuPath` is true
 * for every entered (non-ok, non-unknown) band — the coolest supported
 * execution path should be preferred once the device is warm, hot, or critical.
 * No native call is made here; this is pure data.
 */
export type ThermalGovernorHint = {
  /** Advisory status for this sample. */
  status: ThermalStatus;
  /** Current temperature °C, or null when only a memory proxy is available. */
  tempC: number | null;
  /** Where the sample came from (e.g. "sysfs", "memory_proxy", "none"). */
  source: string;
  /** True for warm | hot | critical — ready for the governor bridge. */
  preferGpuPath: boolean;
};

/** Build a `ThermalGovernorHint` from an advisory status + source. */
export function toGovernorHint(
  status: ThermalStatus,
  tempC: number | null,
  source: string,
): ThermalGovernorHint {
  return {
    status,
    tempC,
    source,
    preferGpuPath: status === "warm" || status === "hot" || status === "critical",
  };
}