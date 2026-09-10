/**
 * Engine build identity for KV session persistence.
 *
 * The saved KV must be invalidated when the compiled engine changes: a new
 * kalsallama pin, new llama.rn bridge patches, changed native sources, or a
 * source-vs-prebuilt variant. A bare `kalsa-native-patches` marker is a
 * boolean literal, so it cannot tell two engine builds apart (audit of
 * e2e09f5, 2026-09-10).
 *
 * The real identity is computed at prebuild from the committed build inputs
 * (scripts/engine-build-id.js) and embedded in the shipped APK's app.config
 * `extra.engineBuildId`. This module only consumes it and combines it with the
 * runtime marker that proves the binary was compiled from the patched source.
 *
 * Fail closed: no generated id, no runtime systemInfo, or no patch marker →
 * null. Callers treat null as "identity unavailable" and skip the save, so a
 * fabricated value never reaches disk.
 */

export const ENGINE_PATCH_MARKER = "kalsa-native-patches";

/**
 * Deterministic engine fingerprint, or null when the build identity cannot be
 * established. `engineBuildId` comes from the prebuild-embedded app config;
 * `systemInfo` comes from llama.rn at context init.
 */
export function engineBuildFingerprint(
  systemInfo: string | undefined,
  engineBuildId: string | null | undefined,
): string | null {
  if (typeof engineBuildId !== "string" || engineBuildId.trim().length === 0) {
    return null;
  }
  if (typeof systemInfo !== "string" || systemInfo.trim().length === 0) {
    return null;
  }
  const marker = systemInfo
    .split(/\s+/)
    .find((token) => token.includes(ENGINE_PATCH_MARKER));
  if (!marker) {
    // Binary was not compiled from the patched source (prebuilt jniLibs):
    // the generated build id would not describe what is actually running.
    return null;
  }
  return `${engineBuildId.trim()}:${marker.slice(0, 96)}`;
}

/**
 * Read the prebuild-embedded engine build id from expo-constants.
 * Never throws: returns null when the embedded config is unavailable (e.g.
 * Node unit tests, or an APK built without the config-time identity).
 */
export function readEngineBuildId(): string | null {
  try {
    // Lazy require keeps this module importable in Node unit tests.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Constants = require("expo-constants").default as {
      expoConfig?: { extra?: Record<string, unknown> };
    };
    const raw = Constants?.expoConfig?.extra?.engineBuildId;
    return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
  } catch {
    return null;
  }
}
