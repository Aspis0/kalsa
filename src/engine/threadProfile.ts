/**
 * Per-device n_threads default for llama.rn ContextParams.
 *
 * What is known: the rule below reproduces the measured optimum on the three
 * SoCs we own (5 / 6 / 2). Keep the measured tables; do not invent mechanism.
 *
 * Measured (standalone llama-bench, Qwen3.5-2B Q4_K_M, pp512, warm cache):
 *
 *   Snapdragon 8 Gen 2 (S23) — capacities 3x266 + 4x811 + 1x1024 (5 fast):
 *     4 threads  76.92 / 71.32 tok/s prefill
 *     5 threads  77.28 / 71.50   ← optimum
 *     6 threads  27.08 / 25.57   ← pathological dip (old count-based rule)
 *     8 threads  64.57 / 46.73   ← ~2.4× faster than 6; NOT monotonic decay
 *
 *   Snapdragon 8 Gen 3 (Xiaomi 14) — 1 prime + 5 perf + 2 eff (6 fast):
 *     4 → 78.6, 6 → 103.9 (+32%), 8 → 10.8 catastrophic
 *
 *   Helio G99 — 6x348 + 2x1024 (2 fast):
 *     optimum decode at 2; prefill bandwidth-bound and flat past that
 *
 * Why 6 collapses on the 8 Gen 2 while 8 does not is unexplained. Do not build
 * on a "past the fast-core count every ggml barrier stalls" story: that predicts
 * monotonic decay beyond the fast-core count, which the 8 Gen 2 table refutes.
 *
 * Rule: count cores with capacity > 50% of the SoC maximum (`>`, not `>=`).
 * That count is the thread count (clamped: min 2, max cores-1 when cores>2).
 * Frequency is NOT a usable proxy (G99: +10% freq vs +194% capacity).
 *
 * The 50% factor is a choice, not a derived constant. Against the THREE REAL
 * layouts alone it is barely constrained: anything in roughly (0.34, 0.79)
 * gives the same answers, since G99 littles sit at 348/1024≈0.34 (excluded) and
 * 8 Gen 2 mids at 811/1024≈0.79 (included). The synthetic layouts added to the
 * harness (4+4@1024/512 and friends) narrow it further — moving the threshold
 * to 0.4 or 0.75 now fails cases — but the exact surviving window was not
 * bisected, so treat 0.5 as "bounded and defensible", never as "measured".
 * Boundary: 4+4@1024/512 — with `>=` littles sit at exactly 0.5, count 8 →
 * clamp 7 (pathological); with `>` they are excluded → 4. Verified unchanged
 * on owned SoCs:
 *   G99 348/1024≈0.34 excluded either way; 8 Gen 2 811/1024≈0.79 included
 *   either way; 8 Gen 3 perf≈0.93 included, eff≈0.35 excluded either way.
 *
 * When cpu_capacity is unavailable, fall back to 4 (pre-1b2e14d default, and
 * the value that measured ~77 tok/s on the 8 Gen 2). Do NOT fall back to a
 * core-count mapping — same total cores, different fast-core counts (8 Gen 2
 * vs 8 Gen 3) made that rule catastrophically wrong on a ship target.
 *
 * Pure: no react-native / expo imports — safe under node harnesses.
 */

/** Fallback when capacities cannot be read (or non-Android). Pre-1b2e14d default. */
export const FALLBACK_THREAD_COUNT = 4;

/**
 * How `detectThreadCount` resolved. Observable for /bench; no log noise on the
 * normal path. Cached with the thread count for the process lifetime.
 */
export type ThreadCountSource =
  | "capacity"
  | "fallback:present-unreadable"
  | "fallback:capacity-missing"
  | "fallback:non-android"
  | "unset";

/**
 * Choose n_threads from per-core `cpu_capacity` values.
 *
 * Counts cores whose capacity is > 50% of the max capacity (`>`, not `>=` —
 * see file header for the 4+4@1024/512 boundary). Returns null for empty /
 * malformed / all-zero / non-finite input (caller falls back).
 *
 * Guard rails:
 * - floor at 2 (never 0 or 1)
 * - when length > 2, never request every core (cap at length - 1)
 * - on a 2-core device, 2 is allowed
 */
export function chooseThreadCountFromCapacities(
  capacities: number[],
): number | null {
  if (!Array.isArray(capacities) || capacities.length === 0) {
    return null;
  }

  let max = -Infinity;
  for (const c of capacities) {
    if (typeof c !== "number" || !Number.isFinite(c) || c < 0) {
      return null;
    }
    if (c > max) max = c;
  }
  // All-zero (or max never set to a positive value).
  if (!(max > 0)) {
    return null;
  }

  // 0.5 is a bounded choice, not proven (see file header). Use strict `>`.
  const threshold = max * 0.5;
  let high = 0;
  for (const c of capacities) {
    if (c > threshold) high += 1;
  }

  // Floor: never 0 or 1.
  let threads = Math.max(2, high);

  // Never ask for every core on a normal phone (leave at least one free).
  if (capacities.length > 2) {
    threads = Math.min(threads, capacities.length - 1);
  }

  return threads;
}

/**
 * Parse Linux CPU-list text into the ordered list of CPU indices.
 *
 * Format: comma-separated items, each a single index (`0`) or inclusive range
 * (`0-7`). Gaps like `0-2,4-7` yield `[0,1,2,4,5,6,7]`. Trailing newline is fine.
 * Reject anything that does not parse cleanly → `null` (caller falls back).
 */
export function listCpuPresent(text: string): number[] | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const indices: number[] = [];
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
      for (let i = a; i <= b; i++) {
        indices.push(i);
      }
      continue;
    }

    if (/^\d+$/.test(raw)) {
      indices.push(Number(raw));
      continue;
    }

    return null;
  }

  return indices.length > 0 ? indices : null;
}

/**
 * Parse Linux CPU-list text from `/sys/devices/system/cpu/present`.
 *
 * Count is the number of CPUs listed (sum of `b - a + 1`), not `max+1`,
 * so gaps like `0-2,4-7` yield 7. Implemented via `listCpuPresent`.
 */
export function parseCpuPresent(text: string): number | null {
  const list = listCpuPresent(text);
  return list === null ? null : list.length;
}

/** Cached thread-count result: undefined = not yet read. */
let cachedThreadCount: number | undefined;

/** Source of the cached thread count; "unset" until detectThreadCount runs. */
let cachedThreadCountSource: ThreadCountSource = "unset";

/**
 * Cached per-core cpu_capacity values from the last successful Android probe.
 * `undefined` = not yet read; `null` = unreadable / non-Android / partial.
 */
let cachedCpuCapacities: number[] | null | undefined;

/**
 * Which path last resolved `detectThreadCount`. Sync, no I/O — for /bench
 * status. Returns `"unset"` until the first probe completes.
 */
export function getThreadCountSource(): ThreadCountSource {
  return cachedThreadCountSource;
}

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

/**
 * Read per-core `/sys/.../cpuN/cpu_capacity` for every CPU in `present`.
 *
 * Same all-or-nothing rule as `detectThreadCount`: any missing / unreadable /
 * malformed capacity → `null` (never a partial table). Non-Android → `null`.
 * Never throws. Cached for the process lifetime (shared with detectThreadCount).
 *
 * Used by deviceProfile so production resolveEngineTuning can match measured
 * SoC presets (e.g. G99 prefill=8) instead of falling back to equal decode/prefill.
 */
export async function readCpuCapacities(): Promise<number[] | null> {
  if (cachedCpuCapacities !== undefined) {
    return cachedCpuCapacities;
  }
  // Drive the shared probe (populates both capacity table and thread count).
  await detectThreadCount();
  return cachedCpuCapacities ?? null;
}

/**
 * Production n_threads for the current device.
 *
 * 1. Android: read `/sys/.../cpuN/cpu_capacity` for every CPU in `present`,
 *    then `chooseThreadCountFromCapacities`. Source: `"capacity"`.
 * 2. Any capacity file missing / unreadable / malformed → FALLBACK_THREAD_COUNT
 *    (4). Source: `"fallback:capacity-missing"`. Never fall back to a
 *    core-count rule. All-or-nothing: a partial capacity table is not used
 *    (could misjudge worse than the conservative 4).
 * 3. present unreadable / unparseable → 4, `"fallback:present-unreadable"`.
 * 4. non-Android → 4, `"fallback:non-android"`.
 *
 * Never throws. Cached for the process lifetime (count + source + capacities).
 * No static RN import at module scope. No log noise — inspect via
 * getThreadCountSource() / readCpuCapacities().
 */
export async function detectThreadCount(): Promise<number> {
  if (cachedThreadCount !== undefined) {
    return cachedThreadCount;
  }
  try {
    // Dynamic require keeps pure exports free of static RN imports for node harnesses.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") {
      cachedThreadCount = FALLBACK_THREAD_COUNT;
      cachedThreadCountSource = "fallback:non-android";
      cachedCpuCapacities = null;
      return cachedThreadCount;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };

    const presentText = await readSysfsText(
      FileSystem,
      "/sys/devices/system/cpu/present",
    );
    if (presentText === null) {
      cachedThreadCount = FALLBACK_THREAD_COUNT;
      cachedThreadCountSource = "fallback:present-unreadable";
      cachedCpuCapacities = null;
      return cachedThreadCount;
    }
    const indices = listCpuPresent(presentText);
    if (indices === null || indices.length === 0) {
      cachedThreadCount = FALLBACK_THREAD_COUNT;
      cachedThreadCountSource = "fallback:present-unreadable";
      cachedCpuCapacities = null;
      return cachedThreadCount;
    }

    const capacities: number[] = [];
    for (const cpu of indices) {
      const capText = await readSysfsText(
        FileSystem,
        `/sys/devices/system/cpu/cpu${cpu}/cpu_capacity`,
      );
      // Any missing capacity file → fall back to 4 (do NOT use count-based rule).
      if (capText === null) {
        cachedThreadCount = FALLBACK_THREAD_COUNT;
        cachedThreadCountSource = "fallback:capacity-missing";
        cachedCpuCapacities = null;
        return cachedThreadCount;
      }
      const cap = Number(capText.trim());
      if (!Number.isFinite(cap)) {
        cachedThreadCount = FALLBACK_THREAD_COUNT;
        cachedThreadCountSource = "fallback:capacity-missing";
        cachedCpuCapacities = null;
        return cachedThreadCount;
      }
      capacities.push(cap);
    }

    const chosen = chooseThreadCountFromCapacities(capacities);
    if (chosen === null) {
      cachedThreadCount = FALLBACK_THREAD_COUNT;
      cachedThreadCountSource = "fallback:capacity-missing";
      cachedCpuCapacities = null;
      return cachedThreadCount;
    }
    cachedThreadCount = chosen;
    cachedThreadCountSource = "capacity";
    cachedCpuCapacities = capacities;
    return cachedThreadCount;
  } catch {
    cachedThreadCount = FALLBACK_THREAD_COUNT;
    cachedThreadCountSource = "fallback:present-unreadable";
    cachedCpuCapacities = null;
    return cachedThreadCount;
  }
}
