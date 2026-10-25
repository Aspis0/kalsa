/**
 * Apple model-id → chip class, for the devices Kalsa plans to run the engine
 * on: the Apple Intelligence class (iPhone 15 Pro and later, M-series iPads)
 * plus the Apple Silicon Mac running the iPad build (any "Mac…" identifier is
 * Apple Silicon by construction — Intel Macs cannot run iOS apps).
 *
 * Data-only: no imports, no I/O. Chip class only: expo-device totalMemory
 * reports the real physical bytes on iOS/macOS, so deviceProfile consults
 * nothing else here.
 *
 * Sources (checked 2026-10-01):
 * - Model identifiers: https://gist.github.com/adamawolf/3048717 (Apple
 *   machine IDs); cross-checked with EveryMac lookups, e.g.
 *   https://everymac.com/ultimate-mac-lookup/?identify=iPhone18,1
 * - Chips (Apple tech specs): iPhone 17
 *   https://support.apple.com/en-us/125089 · 17 Pro /en-us/125090 · 17 Pro Max
 *   /en-us/125091 · Air /en-us/125092 · 17e /en-us/126470 (A17/A18 rows are
 *   the iPhone 15/16 generations' pages on the same site)
 *
 * Exact identifiers ONLY. A prefix rule (the old `iPhone18,` arm) invented one
 * chip answer for a heterogeneous family — 17 Pro is A19 Pro, the base 17 and
 * 17e are A19 — and validated unverified suffixes. Unknown identifiers return
 * null and callers keep their existing conservative fallbacks; never guess.
 */

export type AppleDeviceClass = {
  /** Marketing chip class, e.g. "A17 Pro", "M2". Generations share a class. */
  chipClass: string;
};

/** iPhone 15 Pro … 17e — the exact Apple Intelligence iPhone identifiers. */
const EXACT_MODEL_IDS: Record<string, AppleDeviceClass> = {
  // iPhone 15 Pro / 15 Pro Max.
  "iPhone16,1": { chipClass: "A17 Pro" },
  "iPhone16,2": { chipClass: "A17 Pro" },
  // iPhone 16 Pro / Pro Max / 16 / 16 Plus / 16e.
  "iPhone17,1": { chipClass: "A18 Pro" },
  "iPhone17,2": { chipClass: "A18 Pro" },
  "iPhone17,3": { chipClass: "A18" },
  "iPhone17,4": { chipClass: "A18" },
  "iPhone17,5": { chipClass: "A18" },
  // iPhone 17 Pro / Pro Max / 17 / Air / 17e.
  "iPhone18,1": { chipClass: "A19 Pro" },
  "iPhone18,2": { chipClass: "A19 Pro" },
  "iPhone18,3": { chipClass: "A19" },
  "iPhone18,4": { chipClass: "A19 Pro" },
  "iPhone18,5": { chipClass: "A19" },
  // M1 iPad Pro 11" / 12.9".
  "iPad13,4": { chipClass: "M1" },
  "iPad13,5": { chipClass: "M1" },
  "iPad13,6": { chipClass: "M1" },
  "iPad13,7": { chipClass: "M1" },
  // M1 iPad Air (5th gen).
  "iPad13,16": { chipClass: "M1" },
  "iPad13,17": { chipClass: "M1" },
  // M2 iPad Pro 11" / 12.9".
  "iPad14,3": { chipClass: "M2" },
  "iPad14,4": { chipClass: "M2" },
  "iPad14,5": { chipClass: "M2" },
  "iPad14,6": { chipClass: "M2" },
  // M3 iPad Air 11" / 13".
  "iPad15,3": { chipClass: "M3" },
  "iPad15,4": { chipClass: "M3" },
  // M4 iPad Pro 11" / 13".
  "iPad16,3": { chipClass: "M4" },
  "iPad16,4": { chipClass: "M4" },
  "iPad16,5": { chipClass: "M4" },
  "iPad16,6": { chipClass: "M4" },
};

/**
 * Resolve an expo-device modelId (e.g. "iPhone16,1", "Mac15,6") to its device
 * class, or null when the identifier is unknown / not Apple Intelligence
 * class. The Mac* rule encodes iOS-build semantics; callers must gate on
 * Platform.OS === "ios" (deviceProfile does).
 */
export function appleDeviceClassForModelId(
  modelId: string | null | undefined,
): AppleDeviceClass | null {
  if (typeof modelId !== "string") return null;
  const id = modelId.trim();
  if (id.length === 0) return null;
  const exact = EXACT_MODEL_IDS[id];
  if (exact) return exact;
  // iPad-build app on a Mac ⇒ Apple Silicon Mac (see file header).
  if (id.startsWith("Mac")) {
    return { chipClass: "Apple Silicon" };
  }
  return null;
}
