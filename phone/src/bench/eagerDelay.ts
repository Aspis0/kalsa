/**
 * The `kalsa.bench.eager_delay_ms` knob: holds the boot eager engine kick
 * back for N ms after first render, so a launch measurement can separate
 * first-screen work from the model load. Absent or invalid reads as 0 —
 * today's immediate kick. Bench-only; never a product default.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";

export const BENCH_EAGER_DELAY_KEY = "kalsa.bench.eager_delay_ms";

/** Past 30 s the wait says nothing new about launch stutter. */
export const EAGER_DELAY_MS_MAX = 30000;

/**
 * Integer 0..30000. Absent / non-integer / negative → 0; anything above the
 * max clamps to it.
 */
export function parseBenchEagerDelayMs(raw: string | null | undefined): number {
  if (raw === null || raw === undefined || !/^\d+$/.test(raw)) return 0;
  return Math.min(Number(raw), EAGER_DELAY_MS_MAX);
}

export async function getBenchEagerDelayMs(): Promise<number> {
  try {
    return parseBenchEagerDelayMs(
      await AsyncStorage.getItem(BENCH_EAGER_DELAY_KEY),
    );
  } catch {
    return 0;
  }
}

/**
 * Persist from a `bench:eager_delay <arg>` token. Digits are clamped and
 * stored canonically; 0, "clear" and "default" remove the key (absent reads
 * as 0). Returns the stored value, or null when the token is invalid.
 */
export async function setBenchEagerDelayMs(
  arg: string,
): Promise<number | null> {
  const trimmed = arg.trim();
  try {
    if (trimmed === "clear" || trimmed === "default") {
      await AsyncStorage.removeItem(BENCH_EAGER_DELAY_KEY);
      return 0;
    }
    if (!/^\d+$/.test(trimmed)) return null;
    const ms = parseBenchEagerDelayMs(trimmed);
    if (ms === 0) await AsyncStorage.removeItem(BENCH_EAGER_DELAY_KEY);
    else await AsyncStorage.setItem(BENCH_EAGER_DELAY_KEY, String(ms));
    return ms;
  } catch {
    return null;
  }
}
