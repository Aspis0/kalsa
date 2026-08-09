/**
 * Per-device n_threads default for llama.rn ContextParams.
 *
 * Measured on Xiaomi 14 / Snapdragon 8 Gen 3 (8 cores), ABBA + thermal cooldown,
 * thinking off, same conversation:
 *   Qwen3.5-2B  threads=4 → prefill 78.6  decode 19.7
 *   Qwen3.5-2B  threads=6 → prefill 103.9 decode 21.4  (+26–32% prefill)
 *   Qwen3.5-2B  threads=8 → prefill 10.8  decode 0.06 (catastrophic)
 *   Qwen3.5-4B  threads=4 → prefill 27.3  decode 8.64
 *   Qwen3.5-4B  threads=6 → prefill 34.4  decode 8.18
 *
 * Why not all cores: llama.rn's set_best_cores pins the N fastest cores; N=8 on
 * an 8-core ABBA SoC drags in the two slow efficiency cores, and every ggml
 * barrier waits for the straggler. Always leave the little cluster out.
 * llama.rn's own Android default is min(4, hardware_concurrency).
 *
 * Pure: no react-native / expo imports — safe under node harnesses.
 */

/**
 * Choose production n_threads from a best-effort core count.
 * `null` (unknown / iOS / probe failed) → 4, matching today's effective default.
 */
export function chooseThreadCount(cores: number | null): number {
  if (cores === null || !Number.isFinite(cores) || cores <= 0) {
    return 4;
  }
  if (cores >= 8) return 6;
  if (cores >= 6) return 4;
  return 2;
}

/** Cached probe result: undefined = not yet read, null = unknown. */
let cachedCoreCount: number | null | undefined;

/**
 * Best-effort Android core count via /proc/cpuinfo (count `processor` lines).
 * iOS → null (Metal path; do not touch). Any failure → null → chooseThreadCount(4).
 * Cached for the process lifetime.
 */
export async function detectCores(): Promise<number | null> {
  if (cachedCoreCount !== undefined) {
    return cachedCoreCount;
  }
  try {
    // Dynamic require keeps the pure chooseThreadCount path free of static RN imports
    // for node harnesses that only load this module for the pure export.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") {
      cachedCoreCount = null;
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    // Legacy expo-file-system accepts the absolute path; file:// also works on Android.
    let text: string;
    try {
      text = await FileSystem.readAsStringAsync("/proc/cpuinfo");
    } catch {
      text = await FileSystem.readAsStringAsync("file:///proc/cpuinfo");
    }
    let count = 0;
    for (const line of text.split("\n")) {
      if (line.startsWith("processor")) {
        count += 1;
      }
    }
    cachedCoreCount = count > 0 ? count : null;
    return cachedCoreCount;
  } catch {
    cachedCoreCount = null;
    return null;
  }
}

/** Test-only: reset the process cache (harness / unit tests). */
export function __resetDetectCoresCacheForTests(): void {
  cachedCoreCount = undefined;
}
