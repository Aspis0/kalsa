// Purpose: RAM-aware n_ctx + catalog-driven KV profile for llama.rn init (PIANO V4.2 §Fase 0.5).
//
// Math note (hybrid Qwen3.5-4B): only a subset of layers are full attention
// (KV heads 4, head_dim 256) → attention KV ≈ 16KB/token @ q8_0 → ~256MB @ 16k
// (+ hybrid/recurrent state). The full n_ctx buffer is reserved at init.

import type { KvCacheProfile } from "./ModelRegistry";

export const DEFAULT_N_CTX = 8192;
export const HIGH_RAM_N_CTX = 16384;
/**
 * Floor for the bench n_ctx override. llama.rn clamps n_ctx to 2048
 * (LlamaService.ts:702); values below this are meaningless and the parser
 * rejects them rather than passing them through to a silent clamp.
 */
export const BENCH_NCTX_FLOOR = 2048;

/**
 * Defensive parser for the bench-only n_ctx override pref.
 * - null / undefined / empty / whitespace → null (no override — catalog wins)
 * - non-numeric / NaN / non-integer → null (no override)
 * - below BENCH_NCTX_FLOOR (2048) → null (no override; llama.rn floor)
 * - valid integer >= 2048 → the number
 *
 * "no override" means resolveContextProfile falls through to catalog n_ctx.
 * Returning null (never 0 or NaN) prevents a silently broken engine init.
 */
export function parseBenchNCtx(
  raw: string | null | undefined,
): number | null {
  if (raw == null) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || !Number.isInteger(n)) return null;
  if (n < BENCH_NCTX_FLOOR) return null;
  return n;
}
/**
 * Minimum reportable MemTotal for the optional n_ctx upgrade (never downgrade).
 * This answers "can this phone hold twice the KV?", not "which model class
 * fits this phone". Keep the original conservative 7.5e9 value until KV
 * bytes/token are measured on-device; the measured S23 is below this gate.
 */
export const CTX_UPGRADE_MIN_TOTAL_BYTES = 7_500_000_000;

/**
 * RAM tiers for model recommendation (Settings → Models, advisory only —
 * NEVER auto-switches the user's chosen model). This answers "which model
 * class fits this phone", not whether it can hold a doubled KV context.
 *
 *   high (>= RAM_TIER_HIGH_BYTES, reportable "8GB" class) -> qwen3.5-4b
 *   mid  (>= RAM_MID_BYTES, reportable "6GB" class) -> qwen3.5-4b-q3
 *   low  (< RAM_MID_BYTES) -> qwen3.5-2b
 */
export type RamTier = "low" | "mid" | "high";
/**
 * A nominal 6GB phone reports about 90–93% of that after reserved memory is
 * excluded; this threshold is for tier classification only.
 */
export const RAM_MID_BYTES = 5_400_000_000;
/** Tier threshold only: the model class that suits this phone. */
export const RAM_TIER_HIGH_BYTES = 6_900_000_000;

const RAM_TIER_ORDER: Record<RamTier, number> = { low: 0, mid: 1, high: 2 };

/**
 * Classify total device RAM into a tier. Unknown RAM (null, e.g. web or a
 * platform expo-device can't read) is treated as "low" — conservative: never
 * recommend a model that might not fit.
 */
export function getRamTier(totalBytes: number | null): RamTier {
  if (typeof totalBytes !== "number" || !Number.isFinite(totalBytes) || totalBytes <= 0) {
    return "low";
  }
  if (totalBytes >= RAM_TIER_HIGH_BYTES) return "high";
  if (totalBytes >= RAM_MID_BYTES) return "mid";
  return "low";
}

/**
 * Advisory recommended model id for a RAM tier — UI hint only (Settings
 * model card badge). Never used to silently switch the user's selection.
 */
export function recommendedModelId(tier: RamTier): string {
  switch (tier) {
    case "high":
      return "qwen3.5-4b";
    case "mid":
      return "qwen3.5-4b-q3";
    case "low":
      return "qwen3.5-2b";
  }
}

/** True when a device at `deviceTier` has enough RAM for a model that needs `modelTier`. */
export function ramTierMeets(deviceTier: RamTier, modelTier: RamTier): boolean {
  return RAM_TIER_ORDER[deviceTier] >= RAM_TIER_ORDER[modelTier];
}

export type ContextProfile = {
  nCtx: number;
  cacheTypeK: KvCacheProfile["k"];
  cacheTypeV: KvCacheProfile["v"];
};

/**
 * Best-effort total device RAM via expo-device (`totalMemory`).
 * Returns null when unavailable; callers keep catalog n_ctx (no upgrade).
 *
 * NOTE: `expo-device@~57.0.1` is installed — hybrid models on devices with
 * totalMemory ≥ CTX_UPGRADE_MIN_TOTAL_BYTES may UPGRADE n_ctx to max(catalog, 16384).
 * The guarded require + null fallback remains so web / missing-native paths
 * never crash the bundle.
 */
export function getDeviceTotalMemoryBytes(): number | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device") as { totalMemory?: number | null };
    const total = Device?.totalMemory;
    if (typeof total === "number" && Number.isFinite(total) && total > 0) {
      return total;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Resolve n_ctx (catalog-authoritative; RAM may only UPGRADE hybrids) and KV
 * types from the model catalog. Catalog n_ctx is never silently downgraded
 * (e.g. Qwen3.5-2B keeps engineCtx 16384 on all devices).
 * `kvCache` is authoritative when provided (Q3 low-RAM keeps q4/q4; standard
 * hybrids use k q8_0 / v q4_0). No blanket hybrid→q8 override.
 */
export function resolveContextProfile(input: {
  hybrid?: boolean;
  /** Catalog KV — preferred source for cache_type_k/v. */
  kvCache?: KvCacheProfile;
  /** Settings / test override — wins over catalog and RAM gate. */
  explicitNCtx?: number;
  /** Catalog engineCtx — authoritative default (restores 2B's 16k everywhere). */
  catalogCtx?: number;
  totalMemoryBytes?: number | null;
}): ContextProfile {
  const hybrid = input.hybrid === true;
  const totalMemoryBytes =
    input.totalMemoryBytes !== undefined
      ? input.totalMemoryBytes
      : getDeviceTotalMemoryBytes();

  let nCtx: number;
  if (typeof input.explicitNCtx === "number" && Number.isFinite(input.explicitNCtx)) {
    nCtx = input.explicitNCtx;
  } else {
    const catalogCtx =
      typeof input.catalogCtx === "number" && Number.isFinite(input.catalogCtx)
        ? input.catalogCtx
        : DEFAULT_N_CTX;
    // Catalog is authoritative — never downgrade (e.g. 2B stays 16384 on 6GB).
    nCtx = catalogCtx;
    // RAM gate only UPGRADES hybrids on high-RAM devices.
    if (
      hybrid &&
      typeof totalMemoryBytes === "number" &&
      totalMemoryBytes >= CTX_UPGRADE_MIN_TOTAL_BYTES
    ) {
      nCtx = Math.max(catalogCtx, HIGH_RAM_N_CTX);
    }
  }

  // Catalog wins; fallback only when caller omitted kvCache (dense practice).
  const cacheTypeK = input.kvCache?.k ?? "q8_0";
  const cacheTypeV = input.kvCache?.v ?? "q4_0";

  return { nCtx, cacheTypeK, cacheTypeV };
}
