/**
 * Hardware identity from the resolved device profile, read by telemetry. Only
 * static facts live here: availability figures are a process-start read, so
 * they never leave the profile.
 */

export type DeviceRamTier = "low" | "mid" | "high";

export type DeviceFacts = {
  socModel: string | null;
  ramTier: DeviceRamTier;
  totalMemoryBytes: number;
  osVersion: string | null;
};

let resolved: DeviceFacts | null = null;

/**
 * A profile whose total-memory probe failed is degraded. It keeps no facts, so
 * telemetry falls back to its default instead of a tier derived from nothing.
 */
export function noteDeviceProfile(profile: {
  socModel: string | null;
  ramTier: DeviceRamTier;
  totalMemoryBytes: number | null;
  osVersion: string | null;
}): void {
  resolved =
    profile.totalMemoryBytes === null
      ? null
      : {
          socModel: profile.socModel,
          ramTier: profile.ramTier,
          totalMemoryBytes: profile.totalMemoryBytes,
          osVersion: profile.osVersion,
        };
}

export function resolvedDeviceFacts(): DeviceFacts | null {
  return resolved;
}

/** Test-only: forgets the resolved profile. */
export function resetDeviceFactsForTests(): void {
  resolved = null;
}
