/**
 * Apple model-id → chip class and nominal RAM, for the devices Kalsa plans to
 * run the engine on: the Apple Intelligence class (iPhone 15 Pro and later,
 * M-series iPads) plus the Apple Silicon Mac running the iPad build (any
 * "Mac…" identifier is Apple Silicon by construction — Intel Macs cannot run
 * iOS apps).
 *
 * Data-only: no imports, no I/O. RAM figures are a FALLBACK only — Apple does
 * not publish iPhone RAM, and expo-device totalMemory reports the real
 * physical bytes on iOS/macOS, so the map is consulted when that read is
 * unavailable. Conservative where hardware varies by storage tier (the iPad
 * Pros' 16 GiB variants are recorded as 8 GiB).
 *
 * Sources (checked 2026-10-01):
 * - Model identifiers: https://gist.github.com/adamawolf/3048717 (Apple
 *   machine IDs); cross-checked with EveryMac lookups, e.g.
 *   https://everymac.com/ultimate-mac-lookup/?identify=iPhone18,1
 * - Chips (Apple tech specs): iPhone 17
 *   https://support.apple.com/en-us/125089 · 17 Pro /en-us/125090 · 17 Pro Max
 *   /en-us/125091 · Air /en-us/125092 · 17e /en-us/126470 (A17/A18 rows are
 *   the iPhone 15/16 generations' pages on the same site)
 * - RAM: https://www.macrumors.com/2025/09/09/iphone-17-pro-iphone-air-ram-amounts
 *   (Xcode 26: 17 = 8 GB; Air / 17 Pro / 17 Pro Max = 12 GB); iPhone 17e = 8 GB
 *   per EveryMac's A3575 page.
 *
 * Exact identifiers ONLY. A prefix rule (the old `iPhone18,` arm) invented one
 * chip/RAM answer for a heterogeneous family — 17 Pro is A19 Pro / 12 GiB, the
 * base 17 and 17e are A19 / 8 GiB — and validated unverified suffixes.
 * Unknown identifiers return null and callers keep their existing
 * conservative fallbacks; never guess.
 */

const EIGHT_GIB = 8_589_934_592;
const TWELVE_GIB = 12_884_901_888;

export type AppleDeviceClass = {
  /** Marketing chip class, e.g. "A17 Pro", "M2". Generations share a class. */
  chipClass: string;
  /** Nominal RAM bytes (conservative for storage-tier variants). */
  ramBytes: number;
};

/** iPhone 15 Pro … 17e — the exact Apple Intelligence iPhone identifiers. */
const EXACT_MODEL_IDS: Record<string, AppleDeviceClass> = {
  // iPhone 15 Pro / 15 Pro Max.
  "iPhone16,1": { chipClass: "A17 Pro", ramBytes: EIGHT_GIB },
  "iPhone16,2": { chipClass: "A17 Pro", ramBytes: EIGHT_GIB },
  // iPhone 16 Pro / Pro Max / 16 / 16 Plus / 16e.
  "iPhone17,1": { chipClass: "A18 Pro", ramBytes: EIGHT_GIB },
  "iPhone17,2": { chipClass: "A18 Pro", ramBytes: EIGHT_GIB },
  "iPhone17,3": { chipClass: "A18", ramBytes: EIGHT_GIB },
  "iPhone17,4": { chipClass: "A18", ramBytes: EIGHT_GIB },
  "iPhone17,5": { chipClass: "A18", ramBytes: EIGHT_GIB },
  // iPhone 17 Pro / Pro Max / 17 / Air / 17e — first 12 GiB tiers.
  "iPhone18,1": { chipClass: "A19 Pro", ramBytes: TWELVE_GIB },
  "iPhone18,2": { chipClass: "A19 Pro", ramBytes: TWELVE_GIB },
  "iPhone18,3": { chipClass: "A19", ramBytes: EIGHT_GIB },
  "iPhone18,4": { chipClass: "A19 Pro", ramBytes: TWELVE_GIB },
  "iPhone18,5": { chipClass: "A19", ramBytes: EIGHT_GIB },
  // M1 iPad Pro 11" / 12.9".
  "iPad13,4": { chipClass: "M1", ramBytes: EIGHT_GIB },
  "iPad13,5": { chipClass: "M1", ramBytes: EIGHT_GIB },
  "iPad13,6": { chipClass: "M1", ramBytes: EIGHT_GIB },
  "iPad13,7": { chipClass: "M1", ramBytes: EIGHT_GIB },
  // M1 iPad Air (5th gen).
  "iPad13,16": { chipClass: "M1", ramBytes: EIGHT_GIB },
  "iPad13,17": { chipClass: "M1", ramBytes: EIGHT_GIB },
  // M2 iPad Pro 11" / 12.9".
  "iPad14,3": { chipClass: "M2", ramBytes: EIGHT_GIB },
  "iPad14,4": { chipClass: "M2", ramBytes: EIGHT_GIB },
  "iPad14,5": { chipClass: "M2", ramBytes: EIGHT_GIB },
  "iPad14,6": { chipClass: "M2", ramBytes: EIGHT_GIB },
  // M3 iPad Air 11" / 13".
  "iPad15,3": { chipClass: "M3", ramBytes: EIGHT_GIB },
  "iPad15,4": { chipClass: "M3", ramBytes: EIGHT_GIB },
  // M4 iPad Pro 11" / 13".
  "iPad16,3": { chipClass: "M4", ramBytes: EIGHT_GIB },
  "iPad16,4": { chipClass: "M4", ramBytes: EIGHT_GIB },
  "iPad16,5": { chipClass: "M4", ramBytes: EIGHT_GIB },
  "iPad16,6": { chipClass: "M4", ramBytes: EIGHT_GIB },
};

/**
 * Resolve an expo-device modelId (e.g. "iPhone16,1", "Mac15,6") to its device
 * class, or null when the identifier is unknown / not Apple Intelligence
 * class.
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
    return { chipClass: "Apple Silicon", ramBytes: EIGHT_GIB };
  }
  return null;
}
