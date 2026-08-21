/**
 * Device introspection + hard model gate.
 *
 * Powers Settings model suggestion, HARD-BLOCKS download/load of models that
 * cannot fit (RAM tier / free MemAvailable / free disk), and exposes brand /
 * form-factor flags for future device-specific features (MIUI RAM handling,
 * Galaxy Z Flip cover screen). Flags only — those features are NOT implemented.
 *
 * Pure exports are free of static react-native / expo imports so node harnesses
 * stay import-clean. Async readers use dynamic require (same pattern as
 * contextProfile / memoryEstimate / threadProfile).
 */

import {
  getRamTier,
  ramTierMeets,
  type RamTier,
} from "./contextProfile";
import {
  estimateMemory,
  fitMemoryEstimate,
  getAvailableMemoryBytes,
} from "./memoryEstimate";
import { parseCpuPresent, readCpuCapacities } from "./threadProfile";
import { shouldRecoverLost } from "./engineLiveness";
import {
  modelSpeedAdvisory,
  predictTokensPerSecond,
  type ModelSpeedAdvisory,
} from "./deviceThroughput";
import type { ModelWeightBytesPerToken } from "./ModelRegistry";

export type DeviceFamily = "xiaomi" | "samsung" | "pixel" | "generic";

export type DeviceProfile = {
  /** expo-device brand, lowercased (null when unavailable). */
  brand: string | null;
  manufacturer: string | null;
  /** expo-device modelName (marketing name, e.g. "Pixel 7"). */
  modelName: string | null;
  /** expo-device modelId (e.g. iOS "iPhone14,2"; often null on Android). */
  modelId: string | null;
  /** expo-device totalMemory (bytes). */
  totalMemoryBytes: number | null;
  /** Android /proc/meminfo MemAvailable (bytes); null off-Android / unreadable. */
  availableMemoryBytes: number | null;
  osName: string | null;
  osVersion: string | null;
  /** CPU present count via threadProfile.parseCpuPresent; null when unreadable. */
  cpuCoreCount: number | null;
  /**
   * Per-core `/sys/.../cpuN/cpu_capacity` values (ordered by present indices).
   * Null when unreadable / non-Android / partial table. Used by deviceTuning
   * to match measured SoC presets (e.g. G99 decode=2 / prefill=8).
   */
  cpuCapacities: number[] | null;
  /** contextProfile.getRamTier(totalMemoryBytes). */
  ramTier: RamTier;
  family: DeviceFamily;
  /**
   * Approximation of MIUI / HyperOS family: brand in {xiaomi, redmi, poco}.
   * expo-device reports Redmi/POCO as brand "xiaomi", "redmi", or "poco"
   * depending on ROM — all three map here. Not a real HyperOS API check.
   */
  isMiuiFamily: boolean;
  /**
   * Heuristic only — expo-device has no fold API.
   * True for Samsung Z Flip / Z Fold modelId/name prefixes (SM-F…).
   */
  isFoldableCandidate: boolean;
  /** True when expo-device deviceType is TABLET (2). */
  isTablet: boolean;
};

export type ModelGateVerdict = {
  allowed: boolean;
  reason: "ok" | "blocked_ram" | "blocked_tier" | "blocked_disk" | "unknown";
  predictedTokensPerSecond: number | null;
  speedAdvisory: ModelSpeedAdvisory;
};

/**
 * Map a lowercased brand string to a coarse device family.
 * Xiaomi ecosystem (xiaomi / redmi / poco) → "xiaomi".
 * Samsung → "samsung". Google/pixel → "pixel". Else "generic".
 */
export function deviceFamilyForBrand(
  brand: string | null | undefined,
): DeviceFamily {
  if (typeof brand !== "string") return "generic";
  const b = brand.trim().toLowerCase();
  if (b.length === 0) return "generic";
  if (b === "xiaomi" || b === "redmi" || b === "poco") return "xiaomi";
  if (b === "samsung") return "samsung";
  if (b === "google" || b === "pixel") return "pixel";
  return "generic";
}

/**
 * Heuristic foldable detector (no platform fold API in expo-device).
 *
 * Samsung Galaxy Z Flip / Z Fold use model codes SM-F…:
 *   Z Flip: SM-F700 / F707 / F711 / F720 / F721 / F731 …
 *   Z Fold: SM-F900 / F907 / F916 / F926 / F936 / F946 …
 * Match modelId or modelName against /^SM-F\d/i. Also true when brand is
 * samsung and either field matches /^SM-F/i (broader, still heuristic).
 */
export function isFoldableModelName(
  modelId: string | null | undefined,
  modelName: string | null | undefined,
): boolean {
  const id = typeof modelId === "string" ? modelId.trim() : "";
  const name = typeof modelName === "string" ? modelName.trim() : "";
  // Primary: SM-F + digit (Z Flip / Z Fold series).
  if (/^SM-F\d/i.test(id) || /^SM-F\d/i.test(name)) return true;
  // Broader SM-F… on either field (still Samsung fold family).
  if (/^SM-F/i.test(id) || /^SM-F/i.test(name)) return true;
  return false;
}

/**
 * Pure hard-gate for download / load. All inputs are passed in (no I/O).
 *
 * Order:
 *  1. tier — modelMinRamTier set and device ramTier does not meet it → blocked_tier
 *  2. ram  — when the volatile check is enabled, availableMemoryBytes +
 *            modelNonEvictableMiB both numeric and nonEvictable > available
 *            (MiB) → blocked_ram (tight is NOT a block)
 *  3. disk — freeDiskBytes numeric and modelSizeBytes > freeDiskBytes → blocked_disk
 *  4. else allowed "ok", or "unknown" when memory is unknown and nothing else blocked
 *     (allowed=true so we never hard-block on missing probes)
 *
 * Download callers disable the volatile check: downloads use only the stable
 * tier and disk properties. Load callers keep the default full gate.
 */
export function modelGateVerdict(
  input: {
    totalMemoryBytes: number | null;
    availableMemoryBytes: number | null;
    freeDiskBytes: number | null;
    ramTier: RamTier;
    modelMinRamTier?: RamTier;
    modelNonEvictableMiB?: number | null;
    modelSizeBytes: number;
    modelWeightsBytesPerToken?: ModelWeightBytesPerToken | null;
    deviceBandwidthBytesPerSecond?: number | null;
  },
  options: { checkVolatileMemory?: boolean } = {},
): ModelGateVerdict {
  const {
    availableMemoryBytes,
    freeDiskBytes,
    ramTier,
    modelMinRamTier,
    modelNonEvictableMiB,
    modelSizeBytes,
  } = input;
  const checkVolatileMemory = options.checkVolatileMemory !== false;
  const predictedTokensPerSecond = predictTokensPerSecond(
    { weightsBytesPerToken: input.modelWeightsBytesPerToken },
    input.deviceBandwidthBytesPerSecond,
  );
  const speedAdvisory = modelSpeedAdvisory(predictedTokensPerSecond);
  const verdict = (
    allowed: boolean,
    reason: ModelGateVerdict["reason"],
  ): ModelGateVerdict => ({
    allowed,
    reason,
    predictedTokensPerSecond,
    speedAdvisory,
  });

  if (modelMinRamTier !== undefined && !ramTierMeets(ramTier, modelMinRamTier)) {
    return verdict(false, "blocked_tier");
  }

  if (
    checkVolatileMemory &&
    typeof availableMemoryBytes === "number" &&
    Number.isFinite(availableMemoryBytes) &&
    availableMemoryBytes > 0 &&
    typeof modelNonEvictableMiB === "number" &&
    Number.isFinite(modelNonEvictableMiB) &&
    modelNonEvictableMiB > 0
  ) {
    const availableMiB = availableMemoryBytes / (1024 * 1024);
    if (modelNonEvictableMiB > availableMiB) {
      return verdict(false, "blocked_ram");
    }
  }

  if (
    typeof freeDiskBytes === "number" &&
    Number.isFinite(freeDiskBytes) &&
    freeDiskBytes >= 0 &&
    typeof modelSizeBytes === "number" &&
    Number.isFinite(modelSizeBytes) &&
    modelSizeBytes > freeDiskBytes
  ) {
    return verdict(false, "blocked_disk");
  }

  // Memory probes unknown → allowed but flagged (caller may still soft-warn).
  const memoryKnown =
    (typeof availableMemoryBytes === "number" &&
      Number.isFinite(availableMemoryBytes) &&
      availableMemoryBytes > 0) ||
    (typeof input.totalMemoryBytes === "number" &&
      Number.isFinite(input.totalMemoryBytes) &&
      input.totalMemoryBytes > 0);
  if (!memoryKnown) {
    return verdict(true, "unknown");
  }

  return verdict(true, "ok");
}

/**
 * Best-effort non-evictable MiB for a registry entry via estimateMemory.
 * `contextTokens` is the resolved load context, not the catalog default.
 * For registry models with no measured bytes/token, the KV term is 0; this is
 * therefore a LOWER BOUND. The 4B at 16k is ~256 MiB above it. Do not invent
 * a kvBytesPerToken. ubatch 256, repack true (llama.rn default) unless the
 * caller passes `repack: false` (bench norepack arm).
 * Returns null on bad input.
 */
export function estimateModelNonEvictableMiB(input: {
  sizeBytes: number;
  contextTokens: number;
  kvBytesPerToken?: number | null;
  /** Default true (production). false → repack term 0. */
  repack?: boolean;
}): number | null {
  try {
    if (
      typeof input.sizeBytes !== "number" ||
      !Number.isFinite(input.sizeBytes) ||
      input.sizeBytes <= 0
    ) {
      return null;
    }
    const contextTokens =
      typeof input.contextTokens === "number" && Number.isFinite(input.contextTokens)
        ? input.contextTokens
        : 0;
    const kvBytesPerToken =
      typeof input.kvBytesPerToken === "number" &&
      Number.isFinite(input.kvBytesPerToken)
        ? input.kvBytesPerToken
        : 0;
    const est = estimateMemory({
      fileBytes: input.sizeBytes,
      contextTokens,
      kvBytesPerToken,
      ubatch: 256,
      repack: input.repack !== false,
    });
    return est.nonEvictableMiB;
  } catch {
    return null;
  }
}

export type ModelFitReasonKey =
  | "model.tightNow"
  | "model.tooLarge"
  | "model.cannotEvaluate"
  | "model.memoryUnknown"
  | "model.fitsOK";

export type ModelFitEvaluation = {
  verdict: "fits" | "tight" | "does_not_fit" | "unknown";
  reasonKey: ModelFitReasonKey;
};

/**
 * Pre-send gate decision (uncached MemAvailable). Callers refuse send/regen/edit
 * on allow:false; on allow:true + bannerKey they may surface a non-blocking banner.
 */
export type PreSendFitDecision =
  | { allow: true; bannerKey: "model.memoryUnknown" | null }
  | { allow: false; reasonKey: "model.tooLarge" | "model.tightNow" };

/**
 * Completion-path options. alreadyResident = engine READY and already
 * holding the requested model: skip size-vs-available (those resident
 * bytes are what lowered MemAvailable). Incremental KV/compute is already
 * in the process; a second full-footprint check is a double count.
 * Pre-load callers must omit this (or pass false).
 */
export type PreSendFitOptions = {
  alreadyResident?: boolean;
  /**
   * Engine was resident then lost (on-contact native ping timed out).
   * Skip size-vs-available so Send can recover via ensureEngineForModel
   * instead of repeating the P0 "not enough memory" dead end.
   * Both lostModelId and requestedModelId must be set and equal —
   * an unscoped recoverLost is ignored (fail closed).
   */
  recoverLost?: boolean;
  lostModelId?: string | null;
  requestedModelId?: string | null;
};

/**
 * Fit a registry model (main GGUF + optional mmproj) against live MemAvailable.
 * Bundle size = sizeBytes + (mmproj?.sizeBytes ?? 0). Uses fitMemoryEstimate
 * (repack + compute + KV). reasonKey maps for i18n banners.
 */
export function evaluateModelFit(
  model: {
    sizeBytes: number;
    engineCtx: number;
    kvBytesPerToken?: number | null;
    mmproj?: { sizeBytes: number } | null;
  },
  availableBytes: number | null,
  options: { repack?: boolean } = {},
): ModelFitEvaluation {
  const main =
    typeof model.sizeBytes === "number" && Number.isFinite(model.sizeBytes)
      ? Math.max(0, model.sizeBytes)
      : 0;
  const mm =
    model.mmproj &&
    typeof model.mmproj.sizeBytes === "number" &&
    Number.isFinite(model.mmproj.sizeBytes)
      ? Math.max(0, model.mmproj.sizeBytes)
      : 0;
  const fileBytes = main + mm;
  if (fileBytes <= 0) {
    return { verdict: "unknown", reasonKey: "model.cannotEvaluate" };
  }
  const contextTokens =
    typeof model.engineCtx === "number" && Number.isFinite(model.engineCtx)
      ? model.engineCtx
      : 0;
  const kvBytesPerToken =
    typeof model.kvBytesPerToken === "number" &&
    Number.isFinite(model.kvBytesPerToken)
      ? model.kvBytesPerToken
      : 0;
  // The gate must model the load mode the engine will actually use — wiring a
  // gate to a different one is the S23-class bug class, and it was live here:
  // the comment claimed "the bench norepack arm bypasses these gates" while the
  // arm did not, so with kalsa.bench.norepack=1 the gate refused on a repack
  // footprint the engine would never have allocated. Default stays true, so
  // production (knob absent) is unchanged.
  const estimate = estimateMemory({
    fileBytes,
    contextTokens,
    kvBytesPerToken,
    ubatch: 256,
    repack: options.repack !== false,
  });
  const availableMiB =
    typeof availableBytes === "number" &&
    Number.isFinite(availableBytes) &&
    availableBytes > 0
      ? availableBytes / (1024 * 1024)
      : null;
  const fit = fitMemoryEstimate(estimate, availableMiB);
  switch (fit.status) {
    case "fits":
      return { verdict: "fits", reasonKey: "model.fitsOK" };
    case "tight":
      return { verdict: "tight", reasonKey: "model.tightNow" };
    case "does_not_fit":
      return { verdict: "does_not_fit", reasonKey: "model.tooLarge" };
    case "unknown":
    default:
      return { verdict: "unknown", reasonKey: "model.memoryUnknown" };
  }
}

/**
 * Uncached pre-send fit gate. does_not_fit → refuse model.tooLarge.
 * tight + availableBytes < 1.5 × requiredBytes → refuse model.tightNow.
 * unknown → allow + model.memoryUnknown banner. fits → allow.
 * requiredBytes uses non-evictable estimate (repack+compute+KV) in bytes.
 * alreadyResident (completion path only): skip size-vs-available entirely.
 */
export function decidePreSendFit(
  model: {
    sizeBytes: number;
    engineCtx: number;
    kvBytesPerToken?: number | null;
    mmproj?: { sizeBytes: number } | null;
  },
  availableBytes: number | null,
  opts?: PreSendFitOptions,
): PreSendFitDecision {
  // Model already in-process: do not compare GGUF size vs leftover MemAvailable.
  if (opts?.alreadyResident) {
    return { allow: true, bannerKey: null };
  }
  // OS stole the resident engine: leftover MemAvailable is the same double-
  // count trap as P0. Reload is the recovery; allow the send path through.
  // Unscoped recoverLost (missing or mismatched model id) is ignored.
  if (
    opts?.recoverLost &&
    shouldRecoverLost(opts.lostModelId, opts.requestedModelId)
  ) {
    return { allow: true, bannerKey: null };
  }
  const main =
    typeof model.sizeBytes === "number" && Number.isFinite(model.sizeBytes)
      ? Math.max(0, model.sizeBytes)
      : 0;
  const mm =
    model.mmproj &&
    typeof model.mmproj.sizeBytes === "number" &&
    Number.isFinite(model.mmproj.sizeBytes)
      ? Math.max(0, model.mmproj.sizeBytes)
      : 0;
  const fileBytes = main + mm;
  const contextTokens =
    typeof model.engineCtx === "number" && Number.isFinite(model.engineCtx)
      ? model.engineCtx
      : 0;
  const kvBytesPerToken =
    typeof model.kvBytesPerToken === "number" &&
    Number.isFinite(model.kvBytesPerToken)
      ? model.kvBytesPerToken
      : 0;
  // Gates deliberately assume the conservative repack-ON footprint (see
  // evaluateModelFit). requiredBytes must match that same estimate.
  const estimate =
    fileBytes > 0
      ? estimateMemory({
          fileBytes,
          contextTokens,
          kvBytesPerToken,
          ubatch: 256,
          repack: true,
        })
      : null;
  const requiredBytes =
    estimate && Number.isFinite(estimate.nonEvictableMiB)
      ? estimate.nonEvictableMiB * 1024 * 1024
      : null;

  const fit = evaluateModelFit(model, availableBytes);
  if (fit.verdict === "does_not_fit") {
    return { allow: false, reasonKey: "model.tooLarge" };
  }
  if (fit.verdict === "unknown") {
    return { allow: true, bannerKey: "model.memoryUnknown" };
  }
  if (fit.verdict === "tight") {
    if (
      typeof availableBytes === "number" &&
      Number.isFinite(availableBytes) &&
      typeof requiredBytes === "number" &&
      Number.isFinite(requiredBytes) &&
      availableBytes < 1.5 * requiredBytes
    ) {
      return { allow: false, reasonKey: "model.tightNow" };
    }
    return { allow: true, bannerKey: null };
  }
  return { allow: true, bannerKey: null };
}

// ── Async device readers (dynamic require; cached) ──────────────────────────

type ExpoDeviceMod = {
  brand?: string | null;
  manufacturer?: string | null;
  modelName?: string | null;
  modelId?: string | null;
  totalMemory?: number | null;
  osName?: string | null;
  osVersion?: string | null;
  /** DeviceType enum: UNKNOWN=0, PHONE=1, TABLET=2, DESKTOP=3, TV=4 */
  deviceType?: number | null;
};

function readExpoDevice(): ExpoDeviceMod | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Device = require("expo-device") as ExpoDeviceMod;
    return Device ?? null;
  } catch {
    return null;
  }
}

function asNullableString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
}

function asNullablePositiveNumber(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

async function readSysfsText(
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

/** CPU present count via /sys/.../cpu/present + parseCpuPresent. Never throws. */
async function readCpuCoreCount(): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS !== "android") return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      readAsStringAsync: (uri: string) => Promise<string>;
    };
    const text = await readSysfsText(
      FileSystem,
      "/sys/devices/system/cpu/present",
    );
    if (text == null) return null;
    return parseCpuPresent(text);
  } catch {
    return null;
  }
}

/** Free disk bytes via expo-file-system. Never throws; null on failure. */
export async function getFreeDiskBytes(): Promise<number | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const FileSystem = require("expo-file-system/legacy") as {
      getFreeDiskStorageAsync: () => Promise<number>;
    };
    const free = await FileSystem.getFreeDiskStorageAsync();
    if (typeof free === "number" && Number.isFinite(free) && free >= 0) {
      return free;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Disk margin applied at download start (≥1.1): require free ≥ size × margin
 * so partial writes / filesystem overhead do not trip mid-download.
 */
export const DOWNLOAD_DISK_MARGIN = 1.1;

/** Disk a download must have free: bundle size × margin (covers FS overhead). */
export function diskRequirementBytes(sizeBytes: number): number {
  return sizeBytes * DOWNLOAD_DISK_MARGIN;
}

let cachedProfilePromise: Promise<DeviceProfile> | undefined;

async function buildDeviceProfile(): Promise<DeviceProfile> {
  const Device = readExpoDevice();
  const brandRaw = asNullableString(Device?.brand);
  const brand = brandRaw ? brandRaw.toLowerCase() : null;
  const manufacturer = asNullableString(Device?.manufacturer);
  const modelName = asNullableString(Device?.modelName);
  const modelId =
    Device?.modelId != null && Device.modelId !== ""
      ? String(Device.modelId)
      : null;
  const totalMemoryBytes = asNullablePositiveNumber(Device?.totalMemory);
  const osName = asNullableString(Device?.osName);
  const osVersion = asNullableString(Device?.osVersion);
  // expo-device has no isTablet boolean — deviceType TABLET === 2.
  const isTablet = Device?.deviceType === 2;

  const family = deviceFamilyForBrand(brand);
  const isMiuiFamily = family === "xiaomi";
  // Foldable heuristic also accepts samsung brand + SM-F on either field.
  let isFoldableCandidate = isFoldableModelName(modelId, modelName);
  if (
    !isFoldableCandidate &&
    brand === "samsung" &&
    (modelId != null || modelName != null)
  ) {
    const id = modelId ?? "";
    const name = modelName ?? "";
    if (/^SM-F/i.test(id) || /^SM-F/i.test(name)) {
      isFoldableCandidate = true;
    }
  }

  const [availableMemoryBytes, cpuCoreCount, cpuCapacities] = await Promise.all([
    getAvailableMemoryBytes(),
    readCpuCoreCount(),
    readCpuCapacities(),
  ]);

  return {
    brand,
    manufacturer,
    modelName,
    modelId,
    totalMemoryBytes,
    availableMemoryBytes,
    osName,
    osVersion,
    cpuCoreCount,
    cpuCapacities,
    ramTier: getRamTier(totalMemoryBytes),
    family,
    isMiuiFamily,
    isFoldableCandidate,
    isTablet,
  };
}

/**
 * Process-lifetime cached DeviceProfile. Safe to call from UI / download paths.
 * Never throws — degrades to a conservative empty profile on total failure.
 */
export function getCachedDeviceProfile(): Promise<DeviceProfile> {
  if (!cachedProfilePromise) {
    cachedProfilePromise = buildDeviceProfile().catch((): DeviceProfile => ({
      brand: null,
      manufacturer: null,
      modelName: null,
      modelId: null,
      totalMemoryBytes: null,
      availableMemoryBytes: null,
      osName: null,
      osVersion: null,
      cpuCoreCount: null,
      cpuCapacities: null,
      ramTier: getRamTier(null),
      family: "generic",
      isMiuiFamily: false,
      isFoldableCandidate: false,
      isTablet: false,
    }));
  }
  return cachedProfilePromise;
}

/** Test-only: reset process cache (harness / unit tests). */
export function __resetDeviceProfileCacheForTests(): void {
  cachedProfilePromise = undefined;
}
