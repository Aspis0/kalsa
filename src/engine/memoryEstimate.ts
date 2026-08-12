/**
 * On-device peak-memory estimator for GGUF loads (llama.rn / llama.cpp).
 *
 * Built from /proc/<pid>/status measurements on a real phone
 * (Qwen3.5 Q4_K_M, n_batch=512, n_ubatch=256, cache_type_k=q8_0, cache_type_v=q4_0):
 *
 *   model   file     VmHWM     RssAnon (non-evictable)
 *   2B      1211 MiB 2551 MiB  1333 MiB
 *   4B      2693 MiB 5013 MiB  2848 MiB
 *
 * Four terms, different reclaim behaviour:
 *
 * 1. Weights — mmap'd, file-backed, EVICTABLE. Kernel can reclaim under pressure
 *    (app gets slow, does not die). Size = GGUF file size.
 * 2. Repacked weights — ggml ARM-friendly second copy when
 *    llama_model_params::use_extra_bufts is true (default). ANONYMOUS → only
 *    reclaimable by killing the process. Dominates background survival.
 *    llama.rn 0.12.8 does not expose the switch yet (follow-up).
 * 3. Compute buffer — linear in n_ubatch, independent of model size and of
 *    context (vocab × ubatch dominated): 497@512, 249@256, 125@128, 62@64 MiB.
 *    Same for 2B and 4B.
 * 4. KV cache — linear in context. Measured 4.88 KiB/token for Qwen3.5-2B at
 *    q8_0/q4_0. Hybrid models filter some layers out of KV; a naive
 *    n_layer×n_ctx×n_embd formula overestimates — prefer measured per-token.
 *
 * Pure: no react-native / expo imports at module scope — safe under node harnesses.
 */

const MIB = 1024 * 1024;

/** Compute buffer at the app's default n_ubatch=256 (measured, model-independent). */
export const COMPUTE_MIB_AT_UBATCH_256 = 249;

/**
 * Fraction of GGUF file size that lands in the anonymous repack buffer.
 *
 * Qualitatively repack ≈ file size ("a second copy of the weights"). Quantitatively
 * the GGUF also holds tensors that are not repacked into anonymous memory
 * (embeddings, output/norm, rope factors, metadata) and stay file-backed.
 *
 * Calibrated from the 2B peak RssAnon treating the table residual after subtract-
 * ing compute@256 as the repack term:
 *   (1333 − 249) / 1211 ≈ 0.895
 * With this fraction, both phone anchors land inside ±10% under the harness
 * inputs (2B at 16k×4.88 KiB/tok; 4B at 8k with KV unknown → 0). A pure 1.0×
 * file-size repack overshoots the 2B RssAnon by ~15% once KV is included.
 */
export const REPACK_FRACTION = (1333 - COMPUTE_MIB_AT_UBATCH_256) / 1211;

/**
 * Bytes of free RAM we want above the non-evictable footprint before calling a
 * load "fits" rather than "tight".
 *
 * Justification against the measurements:
 * - Non-evictable memory (repack + compute + KV) is what Android cannot reclaim
 *   without killing the process. If it exceeds MemAvailable, the load cannot
 *   survive even in the foreground → "does not fit".
 * - When non-evictable fits but only with little slack, the foreground activity
 *   is protected by LMK priority while a backgrounded app is not — that is the
 *   "tight" regime the 4B hits on mid-RAM phones (RssAnon ≈ 2848 MiB).
 * - 512 MiB headroom ≈ 2× compute@256 (249 MiB) and is a small fraction of the
 *   2B non-evictable (1333 MiB): enough for UI chrome, short transient allocs,
 *   and system daemons without sitting on the LMK knife-edge. Not a round
 *   "20% of RAM" guess — it is anchored to the measured compute term.
 */
export const FIT_HEADROOM_MIB = 512;

export type MemoryEstimate = {
  weightsMiB: number; // evictable (mmap / file-backed)
  repackMiB: number; // non-evictable; 0 when repacking is off
  computeMiB: number; // non-evictable
  kvMiB: number; // non-evictable
  /** repack + compute + kv — the OOM-deciding number */
  nonEvictableMiB: number;
  /** weights + non-evictable (peak RSS if all weight pages are resident) */
  totalMiB: number;
};

export type MemoryFitVerdict = {
  status: "fits" | "tight" | "does_not_fit" | "unknown";
  reason: string;
  estimate: MemoryEstimate;
  availableMiB: number | null;
};

/** Coerce a numeric input to a finite non-negative number (0 on bad input). */
function nonNeg(n: unknown): number {
  if (typeof n !== "number" || !Number.isFinite(n) || n < 0) return 0;
  return n;
}

/**
 * Estimate peak memory for a GGUF load under the given context / ubatch / repack.
 *
 * Never throws. Malformed / negative inputs become 0; outputs are never NaN or negative.
 */
export function estimateMemory(input: {
  fileBytes: number;
  contextTokens: number;
  /** Bytes of KV state per token (from registry). Pass 0 when unknown. */
  kvBytesPerToken: number;
  ubatch: number;
  repack: boolean;
}): MemoryEstimate {
  const fileBytes = nonNeg(input?.fileBytes);
  const contextTokens = nonNeg(input?.contextTokens);
  const kvBytesPerToken = nonNeg(input?.kvBytesPerToken);
  const ubatch = nonNeg(input?.ubatch);
  const repack = Boolean(input?.repack);

  const weightsMiB = fileBytes / MIB;
  const repackMiB = repack ? weightsMiB * REPACK_FRACTION : 0;
  const computeMiB = ubatch * (COMPUTE_MIB_AT_UBATCH_256 / 256);
  const kvMiB = (contextTokens * kvBytesPerToken) / MIB;
  const nonEvictableMiB = repackMiB + computeMiB + kvMiB;
  const totalMiB = weightsMiB + nonEvictableMiB;

  return {
    weightsMiB,
    repackMiB,
    computeMiB,
    kvMiB,
    nonEvictableMiB,
    totalMiB,
  };
}

/**
 * Fit an estimate against a device budget (typically MemAvailable in MiB).
 *
 * Thresholds (see FIT_HEADROOM_MIB comment):
 * - does_not_fit: nonEvictable > available — anonymous pages cannot be reclaimed
 * - tight:        nonEvictable + FIT_HEADROOM_MIB > available — foreground may
 *                 live (LMK protects the active activity) but background kill is
 *                 likely; also used when total resident exceeds available while
 *                 non-evictable still fits (weight pages thrash under pressure)
 * - fits:         nonEvictable + headroom ≤ available and total ≤ available
 * - unknown:      availableMiB is null / non-finite / ≤0 (caller keeps today's UI)
 */
export function fitMemoryEstimate(
  estimate: MemoryEstimate,
  availableMiB: number | null | undefined,
): MemoryFitVerdict {
  const avail =
    typeof availableMiB === "number" &&
    Number.isFinite(availableMiB) &&
    availableMiB > 0
      ? availableMiB
      : null;

  if (avail === null) {
    return {
      status: "unknown",
      reason: "available memory unknown; cannot judge fit",
      estimate,
      availableMiB: null,
    };
  }

  const { nonEvictableMiB, totalMiB } = estimate;

  if (nonEvictableMiB > avail) {
    return {
      status: "does_not_fit",
      reason: `non-evictable ${Math.round(nonEvictableMiB)} MiB exceeds available ${Math.round(avail)} MiB`,
      estimate,
      availableMiB: avail,
    };
  }

  if (nonEvictableMiB + FIT_HEADROOM_MIB > avail) {
    return {
      status: "tight",
      reason: `non-evictable ${Math.round(nonEvictableMiB)} MiB leaves <${FIT_HEADROOM_MIB} MiB headroom of ${Math.round(avail)} MiB available (foreground ok, background at risk)`,
      estimate,
      availableMiB: avail,
    };
  }

  if (totalMiB > avail) {
    return {
      status: "tight",
      reason: `total ${Math.round(totalMiB)} MiB exceeds available ${Math.round(avail)} MiB but non-evictable ${Math.round(nonEvictableMiB)} MiB fits (weights thrash under pressure)`,
      estimate,
      availableMiB: avail,
    };
  }

  return {
    status: "fits",
    reason: `non-evictable ${Math.round(nonEvictableMiB)} MiB + ${FIT_HEADROOM_MIB} MiB headroom within ${Math.round(avail)} MiB available`,
    estimate,
    availableMiB: avail,
  };
}

/**
 * Parse Linux /proc/meminfo text for MemAvailable (kB → bytes).
 *
 * MemAvailable accounts for reclaimable page cache; MemTotal does not and would
 * overstate the budget. Returns null on missing / malformed input.
 */
export function parseMemAvailableBytes(meminfoText: string): number | null {
  if (typeof meminfoText !== "string") return null;
  // MemAvailable:      1234567 kB
  const m = /^MemAvailable:\s*(\d+)\s*kB\s*$/m.exec(meminfoText);
  if (!m) return null;
  const kB = Number(m[1]);
  if (!Number.isFinite(kB) || kB < 0) return null;
  return kB * 1024;
}

let cachedAvailableBytes: number | null | undefined;

async function readProcText(
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
 * Read MemAvailable from /proc/meminfo (Android). Cached for process lifetime.
 *
 * Never throws. Returns null when not Android, when the read fails, or when the
 * value cannot be parsed — caller must fall back to today's behaviour (no gate).
 * Dynamic require of expo-file-system so node harnesses stay import-clean.
 */
export async function getAvailableMemoryBytes(): Promise<number | null> {
  if (cachedAvailableBytes !== undefined) return cachedAvailableBytes;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") {
      cachedAvailableBytes = null;
      return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    const text = await readProcText(FileSystem, "/proc/meminfo");
    if (text == null) {
      cachedAvailableBytes = null;
      return null;
    }
    const bytes = parseMemAvailableBytes(text);
    cachedAvailableBytes = bytes;
    return bytes;
  } catch {
    cachedAvailableBytes = null;
    return null;
  }
}

/** Test-only: reset process cache (harness / unit tests). */
export function __resetAvailableMemoryCacheForTests(): void {
  cachedAvailableBytes = undefined;
}
