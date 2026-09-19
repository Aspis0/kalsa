/**
 * KV cache cost per token at a chosen cache quant.
 *
 * The catalog's `kvBytesPerToken` is measured or derived at ONE profile — the
 * shipped `kvCache`, q8_0 K / q4_0 V for both chat models. Once the user picks
 * another profile that number is no longer the model's cost: a q8_0 V cache
 * holds 31% more bytes per element than q4_0, so reusing the catalog number
 * under-counts exactly the way a missing field priced the 4B at zero.
 *
 * Elements per token per side are recovered through the shipped profile's
 * bytes/element and then re-priced. Block sizes are GGML's, read from the
 * vendored `ggml-common.h` (QK = 32 elements/block): q4_0 = 2+16,
 * q4_1 = 4+16, q5_0 = 2+4+16, q5_1 = 4+4+16, q8_0 = 2+32, iq4_nl = 2+16 bytes
 * per block; f16/f32 are element-exact.
 *
 * Pure — no react-native, no storage — so the estimator callers and the node
 * harness share one implementation.
 */

import type { KvCacheProfile } from "./ModelRegistry";

export type KvQuant = KvCacheProfile["k"];

const BYTES_PER_ELEMENT: Record<KvQuant, number> = {
  f16: 2,
  f32: 4,
  q8_0: 34 / 32,
  q4_0: 18 / 32,
  q4_1: 20 / 32,
  iq4_nl: 18 / 32,
  q5_0: 22 / 32,
  q5_1: 24 / 32,
};

/** The profile the catalog `kvBytesPerToken` numbers are derived at. */
export const MEASURED_KV_PROFILE: KvCacheProfile = { k: "q8_0", v: "q4_0" };

/**
 * Bytes per element for one quant name, or null when the name is not one this
 * module knows. Unknown → refuse to price rather than assume a block size.
 */
export function kvBytesPerElement(quant: string): number | null {
  return Object.prototype.hasOwnProperty.call(BYTES_PER_ELEMENT, quant)
    ? BYTES_PER_ELEMENT[quant as KvQuant]
    : null;
}

/**
 * Re-price a catalog `kvBytesPerToken` (derived at MEASURED_KV_PROFILE) at
 * `cacheTypeK`/`cacheTypeV`. Null when the input is not a usable number or
 * either quant is unknown, so callers keep their existing absent/zero
 * behaviour instead of inventing a cost.
 *
 * Rounded: elements x bytes/element lands on the shipped integers (LFM 6656 →
 * 4096 elements → 8704 at q8_0/q8_0; Qwen 13312 → 8192 → 17408), and a
 * fraction here only means the input was never a real KV size.
 */
export function kvBytesPerTokenAtProfile(
  kvBytesPerToken: number | null | undefined,
  cacheTypeK: string,
  cacheTypeV: string,
): number | null {
  if (
    typeof kvBytesPerToken !== "number" ||
    !Number.isFinite(kvBytesPerToken) ||
    kvBytesPerToken <= 0
  ) {
    return null;
  }
  const base =
    BYTES_PER_ELEMENT[MEASURED_KV_PROFILE.k] + BYTES_PER_ELEMENT[MEASURED_KV_PROFILE.v];
  const k = kvBytesPerElement(cacheTypeK);
  const v = kvBytesPerElement(cacheTypeV);
  if (k === null || v === null) return null;
  return Math.round((kvBytesPerToken / base) * (k + v));
}

/**
 * `model` with its KV re-priced at the profile actually loading, or `model`
 * unchanged when either side cannot be priced. Callers hand the result to the
 * estimators, so a gate prices the quant the engine will really allocate.
 */
export function modelAtKvProfile<T extends { kvBytesPerToken?: number | null }>(
  model: T,
  cacheTypeK: string,
  cacheTypeV: string,
): T {
  const priced = kvBytesPerTokenAtProfile(model.kvBytesPerToken, cacheTypeK, cacheTypeV);
  if (priced === null) return model;
  return { ...model, kvBytesPerToken: priced } as T;
}
