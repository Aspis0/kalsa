import type { DeviceProfile } from "./deviceProfile";

/** Decode-pacing lines in skin degrees C: the S23's calibrated 0.87 / 0.99
 *  headroom lines (owner 2026-10-10 / 2026-10-11), expressed as
 *  12 + 30 x 0.87 and 12 + 30 x 0.99. The governor reasons in skin degrees
 *  for every phone; each model's headroom scale is derived below. */
const PACING_START_SKIN_C = 38.1;
const PACING_FULL_SKIN_C = 41.7;

/** Android headroom reads 1.0 when the skin is at the HAL SEVERE threshold
 *  and 0.0 thirty degrees below it. Apps cannot read the HAL thresholds, so
 *  each row is measured by hand. Unmeasured models get no row. */
const DECLARED_SEVERE: ReadonlyArray<{
  model: RegExp;
  severeSkinC: number;
  source: string;
}> = [
  { model: /^SM-S911/, severeSkinC: 42.0, source: "s23-headroom-cal-78" },
  {
    model: /^23127PN0CG$/,
    severeSkinC: 66.5,
    source: "xiaomi-g2-inapp-233486dd HAL dump",
  },
];

/** Headroom for a skin temperature on a phone whose SEVERE is severeSkinC,
 *  rounded to 3 decimals. */
function headroomAt(skinC: number, severeSkinC: number): number {
  return Math.round(((skinC - (severeSkinC - 30)) / 30) * 1000) / 1000;
}

/** The decode_pacing_headroom_start / _full engine params for this phone, or
 *  null when the phone is not Android or its model has no measured SEVERE.
 *  Null leaves the engine defaults (0.87 / 0.97) in charge. */
export function pacingHeadroomLines(profile: DeviceProfile): {
  decode_pacing_headroom_start: number;
  decode_pacing_headroom_full: number;
} | null {
  if ((profile.osName ?? "").trim().toLowerCase() !== "android") return null;
  const modelName = profile.modelName ?? "";
  const row = DECLARED_SEVERE.find((entry) => entry.model.test(modelName));
  if (!row) return null;
  return {
    decode_pacing_headroom_start: headroomAt(PACING_START_SKIN_C, row.severeSkinC),
    decode_pacing_headroom_full: headroomAt(PACING_FULL_SKIN_C, row.severeSkinC),
  };
}
