/**
 * Runtime memory pressure, for a process that already has a model resident.
 *
 * This is deliberately NOT the load-time fit gate. The two use different
 * numbers and confusing them cost a night of withdrawn conclusions
 * (HARNESS_FINDINGS.md §7.44):
 *
 * - Deciding a LOAD: `MemAvailable` pre-load. It is the intended metric there
 *   and stays valid, because the model is not resident yet.
 * - Diagnosing a RUNNING process: `MemAvailable` is invalid as headroom. It
 *   counts reclaimable page cache, and a mmapped model's resident weights ARE
 *   that cache — so it reports the model's own residency back as free space.
 *   Subtract `RssFile` to get what is actually reclaimable elsewhere.
 *
 * ⛔ Never gate on `MemFree`. The kernel keeps it near zero by design
 * (0.08-0.53 GB on every healthy arm measured here); a gate on it refuses
 * everything.
 */

/** Parse one `Name:   1234 kB` field from /proc/self/status. Null if absent. */
function parseStatusKbField(statusText: string, field: string): number | null {
  if (typeof statusText !== "string") return null;
  const m = new RegExp(`^${field}:\\s*(\\d+)\\s*kB\\s*$`, "m").exec(statusText);
  if (!m) return null;
  const kB = Number(m[1]);
  if (!Number.isFinite(kB) || kB < 0) return null;
  return kB * 1024;
}

export type ProcessMemorySample = {
  /** File-backed resident pages — the mmapped model lives here on CPU paths. */
  rssFileBytes: number | null;
  /** Anonymous resident pages — repack buffers, KV, compute. */
  rssAnonBytes: number | null;
  /** Swapped-out bytes. Growth is distress on its own, see swapGrewBy. */
  vmSwapBytes: number | null;
  /** Cumulative major page faults since process start. */
  majflt: number | null;
};

/**
 * Parse the cumulative major-fault counter from /proc/self/stat.
 * The process name (field 2) is parenthesized and may contain spaces, so
 * fields are counted only after the final closing parenthesis.
 */
export function parseProcessMajflt(statText: string): number | null {
  if (typeof statText !== "string") return null;
  const closingParen = statText.lastIndexOf(")");
  if (closingParen < 0) return null;
  if (!/^\d+\s+\(.+\)$/.test(statText.slice(0, closingParen + 1))) {
    return null;
  }

  const fields = statText.slice(closingParen + 1).trim().split(/\s+/);
  const rawMajflt = fields[9];
  if (typeof rawMajflt !== "string" || !/^\d+$/.test(rawMajflt)) {
    return null;
  }
  const majflt = Number(rawMajflt);
  if (!Number.isSafeInteger(majflt) || majflt < 0) return null;
  return majflt;
}

/**
 * Parse the fields the runtime signal needs from /proc/self/status and stat.
 * Fields are independent: a kernel that omits one still yields the others.
 */
export function parseProcessMemorySample(
  statusText: string,
  statText = "",
): ProcessMemorySample {
  return {
    rssFileBytes: parseStatusKbField(statusText, "RssFile"),
    rssAnonBytes: parseStatusKbField(statusText, "RssAnon"),
    vmSwapBytes: parseStatusKbField(statusText, "VmSwap"),
    majflt: parseProcessMajflt(statText),
  };
}

/**
 * Headroom for a process with a model resident: `MemAvailable - RssFile`.
 *
 * Removes the model's own page cache from what MemAvailable claims is free.
 * Null when either input is unknown — callers must not substitute a guess,
 * since the whole point is that the un-subtracted number is misleading.
 *
 * ⚠️ Not validated against a collapse yet. The engine side's arm #31 will log
 * MemAvailable and RssFile per turn across 16 turns on both phones — the S23
 * (which evicts) against the Jelly (which does not) — and that contrast is what
 * decides whether this subtraction actually predicts the collapse. Until then
 * this is a diagnostic, never a gate.
 */
export function residentHeadroomBytes(
  memAvailableBytes: number | null,
  rssFileBytes: number | null,
): number | null {
  if (
    typeof memAvailableBytes !== "number" ||
    !Number.isFinite(memAvailableBytes) ||
    typeof rssFileBytes !== "number" ||
    !Number.isFinite(rssFileBytes)
  ) {
    return null;
  }
  return Math.max(0, memAvailableBytes - rssFileBytes);
}

/** Swap growth over a session that we treat as distress. */
export const SWAP_DISTRESS_BYTES = 256 * 1024 * 1024;

/**
 * Bytes swapped out since the session's first sample, or null if unknown.
 *
 * A separate signal from headroom, on purpose: in the one GPU offload measured
 * (§7.18, S23) VmSwap went 26 MB -> 1.02 GB while the process looked thin, and
 * the app was killed anyway. Swap growth is the tell that the system is paying
 * for memory the process does not appear to hold.
 */
export function swapGrewBy(
  baselineVmSwapBytes: number | null,
  currentVmSwapBytes: number | null,
): number | null {
  if (
    typeof baselineVmSwapBytes !== "number" ||
    !Number.isFinite(baselineVmSwapBytes) ||
    typeof currentVmSwapBytes !== "number" ||
    !Number.isFinite(currentVmSwapBytes)
  ) {
    return null;
  }
  return Math.max(0, currentVmSwapBytes - baselineVmSwapBytes);
}

/** Major page faults since the session's first readable sample. */
export function majfltGrewBy(
  baselineMajflt: number | null,
  currentMajflt: number | null,
): number | null {
  if (
    typeof baselineMajflt !== "number" ||
    !Number.isFinite(baselineMajflt) ||
    typeof currentMajflt !== "number" ||
    !Number.isFinite(currentMajflt)
  ) {
    return null;
  }
  return Math.max(0, currentMajflt - baselineMajflt);
}

/** True when swap growth has passed the distress threshold. */
export function isSwapDistressed(grownBytes: number | null): boolean {
  return typeof grownBytes === "number" && grownBytes >= SWAP_DISTRESS_BYTES;
}
