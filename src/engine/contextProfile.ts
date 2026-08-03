// Purpose: RAM-aware n_ctx + catalog-driven KV profile for llama.rn init (PIANO V4.2 §Fase 0.5).
//
// Math note (hybrid Qwen3.5-4B): only a subset of layers are full attention
// (KV heads 4, head_dim 256) → attention KV ≈ 16KB/token @ q8_0 → ~256MB @ 16k
// (+ hybrid/recurrent state). The full n_ctx buffer is reserved at init.

import type { KvCacheProfile } from "./ModelRegistry";

export const DEFAULT_N_CTX = 8192;
export const HIGH_RAM_N_CTX = 16384;
/**
 * "≥ 8GB" device RAM gate for optional n_ctx UPGRADE only (never downgrade).
 * Marketing-"8GB" devices report ~7.6–7.9e9 via expo-device; threshold 7.5e9
 * catches them. The 6GB class stays at catalog ctx: vision mmproj residency
 * makes +~130MB KV at 16k an OOM risk there.
 */
export const HIGH_RAM_BYTES = 7_500_000_000;

/**
 * RAM tiers for model recommendation (Settings → Models, advisory only —
 * NEVER auto-switches the user's chosen model). Product decision: Qwen 3.5 4B
 * is the default model; the Q3 and 2B variants exist only as fallbacks for
 * lower-RAM phones.
 *
 *   high (>= RAM_HIGH_BYTES, marketing "8GB") -> qwen3.5-4b
 *     2.83GB weights + 672MB mmproj (vision) + ~256MB KV @16k = full experience.
 *   mid  (>= RAM_MID_BYTES,  marketing "6GB")  -> qwen3.5-4b-q3
 *     2.37GB weights (Q3_K_M), KV q4/q4 — same model, lighter quant.
 *   low  (< RAM_MID_BYTES)                     -> qwen3.5-2b
 *     1.28GB, text-only fallback.
 *
 * RAM_HIGH_BYTES reuses HIGH_RAM_BYTES (the same "8GB" gate already used to
 * upgrade n_ctx) so there is exactly one 8GB threshold in the codebase.
 */
export type RamTier = "low" | "mid" | "high";
/** Marketing "6GB" devices report ~5.7-5.9e9 via expo-device; this catches them. */
export const RAM_MID_BYTES = 6_000_000_000;
export const RAM_HIGH_BYTES = HIGH_RAM_BYTES;

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
  if (totalBytes >= RAM_HIGH_BYTES) return "high";
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
 * totalMemory ≥ HIGH_RAM_BYTES may UPGRADE n_ctx to max(catalog, 16384).
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
      totalMemoryBytes >= HIGH_RAM_BYTES
    ) {
      nCtx = Math.max(catalogCtx, HIGH_RAM_N_CTX);
    }
  }

  // Catalog wins; fallback only when caller omitted kvCache (dense practice).
  const cacheTypeK = input.kvCache?.k ?? "q8_0";
  const cacheTypeV = input.kvCache?.v ?? "q4_0";

  return { nCtx, cacheTypeK, cacheTypeV };
}
