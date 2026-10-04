/**
 * Bench-only boot probe gate: when AsyncStorage `kalsa.bench.zone_probe` is
 * "1", call the native thermal-zone probe once and emit the raw payload as a
 * single KALSA_ZONE_PROBE log line (the logcat target a bench campaign greps).
 * Production never sets the key; any failure stays silent and never disturbs
 * boot.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { probeThermalZones } from "../../modules/kalsa-thermal/src";

export const BENCH_ZONE_PROBE_KEY = "kalsa.bench.zone_probe";

export async function maybeRunZoneProbe(): Promise<void> {
  let enabled = false;
  try {
    enabled = (await AsyncStorage.getItem(BENCH_ZONE_PROBE_KEY)) === "1";
  } catch {
    return;
  }
  if (!enabled) return;
  try {
    const result = await probeThermalZones();
    console.log("KALSA_ZONE_PROBE " + JSON.stringify(result));
  } catch {
    // A failing probe is a lost measurement, never a boot failure.
  }
}
