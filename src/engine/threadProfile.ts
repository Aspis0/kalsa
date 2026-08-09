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
 * WARNING — the "pinning" story is false. llama.rn's set_best_cores fills a
 * cpumask and sets strict_cpu, but ggml only applies affinity under
 * __gnu_linux__ (a glibc macro); on Bionic it takes the "unsupported platforms"
 * branch where ggml_thread_apply_affinity is `{ UNUSED(mask); return true; }`.
 * Nothing has ever been pinned on any phone, and thread priority is a no-op too.
 * Thread COUNT is the only lever here — see docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md
 * for the three proofs. The threads=8 collapse above is therefore NOT explained
 * by a slow-core straggler; it is unexplained, and the leading hypothesis is CPU
 * starvation of system_server / the UI thread. Do not re-derive the old story.
 * llama.rn's own Android default is min(4, hardware_concurrency).
 *
 * Second SoC (Helio G99, 6x A55 + 2x A76, standalone binary, forward+reverse):
 *   Qwen3.5-2B  threads=1 → prefill 11.3  decode 4.58
 *   Qwen3.5-2B  threads=2 → prefill 21.1  decode 6.38   (best decode)
 *   Qwen3.5-2B  threads=6 → prefill 21.6  decode 5.68
 *   Qwen3.5-2B  threads=8 → prefill 22.5  decode 5.66
 * i.e. a memory-bandwidth ceiling reached at 2 threads, and no collapse at 8.
 * The two SoCs disagree, so the mapping below is NOT settled.
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

/**
 * Parse Linux CPU-list text from `/sys/devices/system/cpu/present`.
 *
 * Format: comma-separated items, each a single index (`0`) or inclusive range
 * (`0-7`). Count is the number of CPUs listed (sum of `b - a + 1`), not `max+1`,
 * so gaps like `0-2,4-7` yield 7. Trailing newline is fine. Reject anything that
 * does not parse cleanly → `null` (caller falls back); never guess.
 */
export function parseCpuPresent(text: string): number | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  let total = 0;
  const items = trimmed.split(",");
  for (const raw of items) {
    // No whitespace inside items in the kernel format; reject stray spaces.
    if (raw.length === 0 || /\s/.test(raw)) return null;

    const range = /^(\d+)-(\d+)$/.exec(raw);
    if (range) {
      const a = Number(range[1]);
      const b = Number(range[2]);
      // Reversed range is malformed (do not swap or return negative).
      if (!Number.isFinite(a) || !Number.isFinite(b) || b < a) return null;
      total += b - a + 1;
      continue;
    }

    if (/^\d+$/.test(raw)) {
      total += 1;
      continue;
    }

    return null;
  }

  return total > 0 ? total : null;
}

/** Cached probe result: undefined = not yet read, null = unknown. */
let cachedCoreCount: number | null | undefined;

async function readSysfsText(
  FileSystem: { readAsStringAsync: (uri: string) => Promise<string> },
  absPath: string,
): Promise<string | null> {
  try {
    return await FileSystem.readAsStringAsync(absPath);
  } catch {
    try {
      return await FileSystem.readAsStringAsync(`file://${absPath}`);
    } catch {
      return null;
    }
  }
}

function countCpuinfoProcessors(text: string): number | null {
  let count = 0;
  for (const line of text.split("\n")) {
    if (line.startsWith("processor")) {
      count += 1;
    }
  }
  return count > 0 ? count : null;
}

/**
 * Best-effort Android core count.
 *
 * Prefers `/sys/devices/system/cpu/present` (full possible set, hotplug-stable).
 * Falls back to counting `processor` lines in `/proc/cpuinfo` (online only).
 * iOS → null (Metal path; do not touch). Any failure → null → chooseThreadCount(4).
 * Cached for the process lifetime.
 */
export async function detectCores(): Promise<number | null> {
  if (cachedCoreCount !== undefined) {
    return cachedCoreCount;
  }
  try {
    // Dynamic require keeps the pure chooseThreadCount / parseCpuPresent paths
    // free of static RN imports for node harnesses that only load pure exports.
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

    // Prefer present: reports the full possible CPU range regardless of hotplug.
    const presentText = await readSysfsText(
      FileSystem,
      "/sys/devices/system/cpu/present",
    );
    if (presentText !== null) {
      const fromPresent = parseCpuPresent(presentText);
      if (fromPresent !== null) {
        cachedCoreCount = fromPresent;
        return cachedCoreCount;
      }
    }

    // Fallback: /proc/cpuinfo lists only ONLINE CPUs (can undercount on hotplug).
    const cpuinfoText = await readSysfsText(FileSystem, "/proc/cpuinfo");
    if (cpuinfoText !== null) {
      const fromCpuinfo = countCpuinfoProcessors(cpuinfoText);
      if (fromCpuinfo !== null) {
        cachedCoreCount = fromCpuinfo;
        return cachedCoreCount;
      }
    }

    cachedCoreCount = null;
    return null;
  } catch {
    cachedCoreCount = null;
    return null;
  }
}

/** Test-only: reset the process cache (harness / unit tests). */
export function __resetDetectCoresCacheForTests(): void {
  cachedCoreCount = undefined;
}
