/**
 * User-chosen KV cache quantization (Settings → KV cache precision).
 *
 * Two rows, both of them pairs the engines already carry in their catalog
 * `kvCache` profiles: Standard is the shipped q8_0/q4_0, High is q8_0/q8_0.
 * Unset means the catalog profile wins, so an install that never opens this
 * setting loads the same tensors it loaded before the setting existed.
 *
 * The choice reaches the engine through the existing cacheTypeK/cacheTypeV
 * path (resolveContextProfile → EngineInitOptions), and both values already sit
 * in LlamaService's skip-reload key and in the session meta's mismatch check —
 * a .kvs written with a q4_0 V cache is discarded, not loaded, when the current
 * cache is q8_0.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { KvCacheProfile } from "./ModelRegistry";

export const KV_CACHE_KEY = "kalsa.kv.cache";

export type KvCacheChoiceId = "standard" | "high";

export type KvCacheChoice = {
  id: KvCacheChoiceId;
  k: KvCacheProfile["k"];
  v: KvCacheProfile["v"];
};

export const KV_CACHE_CHOICES: readonly KvCacheChoice[] = [
  { id: "standard", k: "q8_0", v: "q4_0" },
  { id: "high", k: "q8_0", v: "q8_0" },
];

/** The choice for a stored id, or null when the id is absent or unknown. */
export function kvCacheChoiceById(id: string | null | undefined): KvCacheChoice | null {
  if (typeof id !== "string") return null;
  return KV_CACHE_CHOICES.find((choice) => choice.id === id) ?? null;
}

/**
 * The stored choice, or null when the user never picked one (catalog wins).
 * Never throws; an unrecognised stored id reads as unset rather than as a
 * cache type this build cannot price.
 */
export async function readKvCacheChoice(): Promise<KvCacheChoice | null> {
  try {
    return kvCacheChoiceById(await AsyncStorage.getItem(KV_CACHE_KEY));
  } catch {
    return null;
  }
}

/** Persists the choice; returns whether the write landed. Never throws. */
export async function writeKvCacheChoice(id: KvCacheChoiceId): Promise<boolean> {
  try {
    await AsyncStorage.setItem(KV_CACHE_KEY, id);
    return true;
  } catch (error) {
    console.warn(`Failed to persist ${KV_CACHE_KEY}`, error);
    return false;
  }
}
