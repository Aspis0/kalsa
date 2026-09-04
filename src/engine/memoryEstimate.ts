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
 * 1. Weights — with mmap ON: file-backed, EVICTABLE. Kernel can reclaim under
 *    pressure (app gets slow, does not die). Size = GGUF file size. With mmap
 *    OFF the weights are read ANONYMOUS — but read ONCE: source and packed
 *    destination are a partition of the file, not two copies (see
 *    ANON_WEIGHTS_REPACK_ON_FACTOR below).
 * 2. Repacked weights — ggml ARM-friendly second copy of the MAPPED weights
 *    when llama_model_params::use_extra_bufts is true. ANONYMOUS → only
 *    reclaimable by killing the process. Dominates background survival.
 *    Disable via llama.rn `no_extra_bufts` (bench: kalsa.bench.norepack=1).
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
// ⚠️ Under-calibrated: anchored on ONE model (the 2B above). The Q3 4B load
// log shows CPU_REPACK alone at 2265.50 MiB against a 2264.53 MiB file —
// 1.00× the file, not 0.895×. Value kept this round; recalibrate before
// trusting the mapped-weights split beyond the 2B-class files.

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

/**
 * Anonymous weight bytes as a multiple of the GGUF file size when mmap is OFF
 * and repack is ON.
 *
 * Without a mapping, llama.cpp reads every tensor exactly once, straight into
 * its destination buffer — either the plain `CPU` buffer or the `CPU_REPACK`
 * one. Source and pack are a PARTITION of the weights, not two copies; no
 * mapped source survives beside the pack. Measured from phone load_tensors
 * buffer-size lines (mmap off, repack on), total anonymous weights vs file:
 *
 *   Qwen3.5 4B Q4_K_M : (516.03 + 2674.46) / 2775   = 1.15×
 *   Qwen3.5 4B Q3     : …                           = 1.22×
 *   Qwen3.5 2B Q4_K_M : (399.94 + 1208.95) / 1221   = 1.32×
 *
 * The surplus over 1.0× is the unpacked tail (embeddings / output / norms)
 * landing in the plain CPU buffer at f16/f32. Single-factor choice: the most
 * prudent of the three (1.32) — an overestimate here degrades into the "tight"
 * band, an underestimate walks past lmkd. n=3, one model family; re-anchor on
 * new measurements instead of nudging this constant.
 */
export const ANON_WEIGHTS_REPACK_ON_FACTOR = 1.32;

export type MemoryEstimate = {
  /** GGUF file size: evictable where mapped, anonymous where read (see buckets below). */
  weightsMiB: number;
  /** Anonymous repack copy ON TOP of mapped weights; 0 whenever mmap is off. */
  repackMiB: number; // non-evictable
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
 * Estimate peak memory for a GGUF load under the given context / ubatch / load
 * policy.
 *
 * Never throws. Malformed / negative inputs become 0; outputs are never NaN or negative.
 */
export function estimateMemory(input: {
  fileBytes: number;
  contextTokens: number;
  /** Bytes of KV state per token (from registry). Pass 0 when unknown. */
  kvBytesPerToken: number;
  ubatch: number;
  /** Load policy the engine will actually use. Default true (llama.cpp normal). */
  mmap?: boolean;
  repack?: boolean;
}): MemoryEstimate {
  const fileBytes = nonNeg(input?.fileBytes);
  const contextTokens = nonNeg(input?.contextTokens);
  const kvBytesPerToken = nonNeg(input?.kvBytesPerToken);
  const ubatch = nonNeg(input?.ubatch);
  // Default true on both: llama.cpp normal behaviour, unchanged estimates for
  // callers that do not know the policy.
  const mmap = input?.mmap !== false;
  const repack = input?.repack !== false;

  const weightsMiB = fileBytes / MIB;
  const computeMiB = ubatch * (COMPUTE_MIB_AT_UBATCH_256 / 256);
  const kvMiB = (contextTokens * kvBytesPerToken) / MIB;
  // Weight bytes land in ONE bucket each, per load mode:
  //   mmap on,  repack on  → mapped W (evictable) + REPACK_FRACTION·W anon copy
  //   mmap on,  repack off → all W mapped/evictable
  //   mmap off, repack on  → all W anonymous, PARTITIONED across CPU/CPU_REPACK
  //                          (measured ≈ 1.15–1.32×W; see factor above)
  //   mmap off, repack off → all W anonymous, single CPU buffer
  let repackMiB = 0;
  let anonWeightsMiB = 0;
  if (mmap) {
    if (repack) repackMiB = weightsMiB * REPACK_FRACTION;
  } else {
    anonWeightsMiB = weightsMiB * (repack ? ANON_WEIGHTS_REPACK_ON_FACTOR : 1);
  }
  const nonEvictableMiB = anonWeightsMiB + repackMiB + computeMiB + kvMiB;
  // Peak RSS: only the EVICTABLE share of the weights adds to the anonymous
  // total — with mmap off they are already inside it (adding the file again
  // would double-count).
  const totalMiB = weightsMiB - anonWeightsMiB + nonEvictableMiB;

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
