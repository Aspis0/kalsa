/**
 * Apple model-id → chip class and nominal RAM, for the devices Kalsa plans to
 * run the engine on: the Apple Intelligence class (iPhone 15 Pro and later,
 * M-series iPads) plus the Apple Silicon Mac running the iPad build (any
 * "Mac…" identifier is Apple Silicon by construction — Intel Macs cannot run
 * iOS apps).
 *
 * Data-only: no imports, no I/O. RAM figures are Apple's nominal specs, and
 * they are a FALLBACK only — expo-device totalMemory reports the real
 * physical bytes on iOS/macOS, so the map is consulted when that read is
 * unavailable. Conservative where hardware varies by storage tier (the iPad
 * Pros' 16 GiB variants are recorded as 8 GiB).
 *
 * Unknown identifiers return null and callers keep their existing fallbacks.
 */

const EIGHT_GIB = 8_589_934_592;

export type AppleDeviceClass = {
  /** Marketing chip class, e.g. "A17 Pro", "M2". Generations share a class. */
  chipClass: string;
  /** Nominal RAM bytes (conservative for storage-tier variants). */
  ramBytes: number;
};

/** iPhone 15 Pro … 16e — the exact Apple Intelligence iPhone identifiers. */
const EXACT_MODEL_IDS: Record<string, AppleDeviceClass> = {
  "iPhone16,1": { chipClass: "A17 Pro", ramBytes: EIGHT_GIB },
  "iPhone16,2": { chipClass: "A17 Pro", ramBytes: EIGHT_GIB },
  "iPhone17,1": { chipClass: "A18 Pro", ramBytes: EIGHT_GIB },
  "iPhone17,2": { chipClass: "A18 Pro", ramBytes: EIGHT_GIB },
  "iPhone17,3": { chipClass: "A18", ramBytes: EIGHT_GIB },
  "iPhone17,4": { chipClass: "A18", ramBytes: EIGHT_GIB },
  "iPhone17,5": { chipClass: "A18", ramBytes: EIGHT_GIB },
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
 * class. The whole iPhone18,x generation (2025) is Apple Intelligence class
 * with 8 GiB, so it is covered by prefix rather than enumerated.
 */
export function appleDeviceClassForModelId(
  modelId: string | null | undefined,
): AppleDeviceClass | null {
  if (typeof modelId !== "string") return null;
  const id = modelId.trim();
  if (id.length === 0) return null;
  const exact = EXACT_MODEL_IDS[id];
  if (exact) return exact;
  if (id.startsWith("iPhone18,")) {
    return { chipClass: "A19", ramBytes: EIGHT_GIB };
  }
  // iPad-build app on a Mac ⇒ Apple Silicon Mac (see file header).
  if (id.startsWith("Mac")) {
    return { chipClass: "Apple Silicon", ramBytes: EIGHT_GIB };
  }
  return null;
}
