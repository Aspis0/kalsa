/**
 * Runtime A/B bench knobs (AsyncStorage).
 * Defaults preserve production behaviour; change via adb without rebuild:
 *   adb shell run-as <pkg> … or AsyncStorage.setItem from a debug path.
 *
 * Keys:
 * - kalsa.bench.thinking: "default" | "off" | "budget256" | "budget512"
 * - kalsa.bench.format:   "none" | "system-end" | "user-prefix" | "user-note"
 *
 * No in-memory cache: one fresh read per turn (best-effort).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const BENCH_THINKING_KEY = "kalsa.bench.thinking";
export const BENCH_FORMAT_KEY = "kalsa.bench.format";

export type ThinkingMode = "default" | "off" | "budget256" | "budget512";
export type BlockFormat = "none" | "system-end" | "user-prefix" | "user-note";

const THINKING_MODES: ReadonlySet<string> = new Set([
  "default",
  "off",
  "budget256",
  "budget512",
]);

const BLOCK_FORMATS: ReadonlySet<string> = new Set([
  "none",
  "system-end",
  "user-prefix",
  "user-note",
]);

/** Read thinking mode for the next completion. Defaults to "default". */
export async function getThinkingMode(): Promise<ThinkingMode> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_THINKING_KEY);
    if (raw && THINKING_MODES.has(raw)) return raw as ThinkingMode;
  } catch {
    // best-effort
  }
  return "default";
}

/** Read operative-block placement format. Defaults to "none" (no block). */
export async function getBlockFormat(): Promise<BlockFormat> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_FORMAT_KEY);
    if (raw && BLOCK_FORMATS.has(raw)) return raw as BlockFormat;
  } catch {
    // best-effort
  }
  return "none";
}
