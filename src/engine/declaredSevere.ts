import type { DeviceProfile } from "./deviceProfile";

/** Default decode-pacing lines in skin degrees C, used by every row that
 *  declares no lines of its own (today the S23): its calibrated 0.87 / 0.99
 *  headroom lines (owner 2026-10-10 / 2026-10-11), i.e. 12 + 30 x 0.87 and
 *  12 + 30 x 0.99. The app picks the lines in skin degrees; the engine
 *  compares headroom, so each model's scale is derived below from its own
 *  SEVERE. */
const PACING_START_SKIN_C = 38.1;
const PACING_FULL_SKIN_C = 41.7;

/** Android headroom reads 1.0 at the HAL SEVERE threshold and 0.0 thirty
 *  degrees below it: AOSP ThermalManagerService normalizes
 *  (T - (SEVERE - 30)) / 30, with DEGREES_BETWEEN_ZERO_AND_ONE = 30. Apps
 *  cannot read the HAL thresholds, so each row is measured by hand. Unmeasured
 *  models get no row. */
const DEGREES_BETWEEN_ZERO_AND_ONE = 30;

const DECLARED_SEVERE: ReadonlyArray<{
  model: RegExp;
  severeSkinC: number;
  /** Own pacing lines in skin C; an absent one falls back to the default. */
  startSkinC?: number;
  fullSkinC?: number;
}> = [
  // Galaxy S23 (SM-S911): Android status 3 (SEVERE) measured at headroom 1.003,
  // skin 42.1 C (lab cell s23-headroom-cal-78). The 0.87 / 0.99 lines come from
  // the S23's calibrated fits (cells s23-g2-graduated-867affaa,
  // s23-g2-full099-233486dd).
  { model: /^SM-S911/, severeSkinC: 42.0 },
  // Xiaomi 14 (23127PN0CG): HAL Threshold mType=3 (SEVERE), read with
  // `dumpsys thermalservice` on 2026-10-11. The array index is the status, and
  // index 3 holds 66.5 C. The in-app fit (cell xiaomi-g2-inapp-233486dd) puts
  // headroom 1.0 at ~66.9 C, consistent with it. Its pacing lines are its own
  // (owner 2026-10-12): the S23's 3.6 C ramp, placed on this SEVERE.
  { model: /^23127PN0CG$/, severeSkinC: 66.5, startSkinC: 39.0, fullSkinC: 42.6 },
];

/** Headroom for a skin temperature on a phone whose SEVERE is severeSkinC,
 *  rounded to 3 decimals and floored at 0: AOSP reads 0 below SEVERE - 30, so
 *  no line goes negative. Exported for the unit test only. */
export function headroomAt(skinC: number, severeSkinC: number): number {
  const headroom =
    (skinC - (severeSkinC - DEGREES_BETWEEN_ZERO_AND_ONE)) / DEGREES_BETWEEN_ZERO_AND_ONE;
  return Math.max(0, Math.round(headroom * 1000) / 1000);
}

/** The decode_pacing_headroom_start / _full engine params for this phone, or
 *  null when its model has no measured SEVERE; null leaves the engine's own
 *  defaults in charge. Matched on the model name (Build.MODEL) alone, because
 *  expo-device's osName is a build fingerprint on some Android vendors and
 *  cannot gate the rows; the governor load that consumes these is
 *  Android-only. */
export function pacingHeadroomLines(profile: DeviceProfile): {
  decode_pacing_headroom_start: number;
  decode_pacing_headroom_full: number;
} | null {
  const modelName = (profile.modelName ?? "").trim().toUpperCase();
  const row = DECLARED_SEVERE.find((entry) => entry.model.test(modelName));
  if (!row) return null;
  return {
    decode_pacing_headroom_start: headroomAt(
      row.startSkinC ?? PACING_START_SKIN_C,
      row.severeSkinC,
    ),
    decode_pacing_headroom_full: headroomAt(
      row.fullSkinC ?? PACING_FULL_SKIN_C,
      row.severeSkinC,
    ),
  };
}
