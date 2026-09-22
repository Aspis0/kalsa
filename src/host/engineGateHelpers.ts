/**
 * The load gate's bounded helpers, lifted verbatim: the native-patch
 * diagnostic, the raw-error truncator, the bundle-size probe, `gateForModel`,
 * the bounded embedder release and the localized gate reason. Plus the
 * model-switch dispose bound the gate's injected dispose uses.
 */
import {
  diskRequirementBytes,
  type DeviceProfile,
  type getCachedDeviceProfile,
  modelGateVerdict,
  type ModelGateVerdict,
} from "../engine/deviceProfile";
import { getAvailableMemoryBytesUncached } from "../engine/monitor";
import { loadGateFitModel } from "../engine/loadGate";
import { gateNonEvictableMiB } from "../engine/modelGateRAM";
import {
  EMBEDDER_RELEASE_TIMEOUT_MS,
  markEmbedderHung,
  releaseEmbedder,
} from "../engine/EmbeddingService";
import { nativeOpBusy } from "../engine/llamaContextGate";
import {
  deviceBandwidthForModel,
  type DeviceBandwidthCalibration,
} from "../engine/deviceThroughput";
import type { KvCacheProfile, ModelInfo } from "../engine/ModelRegistry";
import type { TranslationKey } from "../i18n";

/**
 * Model-switch engine dispose must be bounded: when handleStop's abort does not
 * settle the in-flight native completion, the unbounded native-op FIFO would
 * hang dispose forever and pin the UI on "checking". Refuse after this deadline.
 */
export const MODEL_SWITCH_DISPOSE_TIMEOUT_MS = 5_000;

/**
 * Non-blocking native-patch marker check. When systemInfo is present and
 * lacks "kalsa-native-patches", the build used prebuilt jniLibs and every
 * Kalsa cpp/ patch is inactive. Never throws; skip silently when unknown
 * (idempotent skip-reload path leaves systemInfo undefined).
 */
export function warnIfNativePatchesInactive(systemInfo: string | undefined): void {
  try {
    if (typeof systemInfo !== "string" || systemInfo.length === 0) return;
    if (systemInfo.includes("kalsa-native-patches")) return;
    console.warn(
      "[kalsa-native] llama.rn not built from patched source — native patches inactive",
    );
  } catch {
    // never throw from a diagnostic assert
  }
}

/**
 * Untranslated on-device diagnostic string from a thrown value.
 * Suppresses empty / bare "Error:" noise; truncates surrogate-safe to 400 chars.
 */
export function rawErrorDetail(error: unknown): string | null {
  let rawSource: string;
  if (error instanceof Error) {
    rawSource = `${error.name}: ${error.message}`;
  } else {
    try {
      const json = JSON.stringify(error);
      rawSource = json === undefined ? String(error) : json;
    } catch {
      rawSource = String(error);
    }
  }
  const rawTrimmed = rawSource.trim();
  if (!rawTrimmed || rawTrimmed === "Error:" || rawTrimmed === "Error: ") return null;
  return Array.from(rawTrimmed).slice(0, 400).join("");
}

/** Bundle size for disk-gate checks (main GGUF + optional mmproj). */
export function modelBundleSizeBytes(model: ModelInfo): number {
  return model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);
}

/**
 * Build a ModelGateVerdict for a registry entry from a DeviceProfile +
 * free-disk probe. Pure after inputs are resolved. Besides the verdict it
 * returns `nonEvictableMiB` — the RAM charge it priced — so the download
 * sheet can quote need-vs-have without re-running the fit (one pricing,
 * two readers).
 */
export function gateForModel(
  model: ModelInfo,
  profile: Awaited<ReturnType<typeof getCachedDeviceProfile>>,
  freeDiskBytes: number | null,
  checkVolatileMemory = true,
  /** kalsa.bench.norepack tri-state; absent → the model's loadPolicy decides. */
  benchNoRepack?: boolean,
  deviceBandwidth: DeviceBandwidthCalibration = {},
  /** Chosen cache profile; absent → the catalog's own. */
  kvCache?: KvCacheProfile | null,
  /** bench ?? user ?? catalog; absent → the catalog / high-RAM resolution. */
  requestedContextTokens?: number,
  /** bench:engine useMmap; the gate prices the mode the engine will use. */
  benchUseMmap?: boolean,
): ModelGateVerdict & {
  /** The RAM charge (MiB) the verdict priced — see this function's doc. */
  nonEvictableMiB: number | null;
} {
  // Charge the context this load will ACTUALLY run at (KV priced at the
  // chosen profile): the user's 100k asking is not refused here when the
  // budget will simply degrade it, and the catalog default is not charged
  // when the user asked for more. Same helper the other load gate uses.
  const fitModel = loadGateFitModel({
    model,
    profile,
    requestedContextTokens,
    kvCache,
    benchNoRepack,
    benchUseMmap,
  });

  // One responsibility: what the gate should charge this model for RAM.
  // Measured streamed footprint when expert streaming is loaded, else the
  // repack estimate. Settings also calls gateNonEvictableMiB with
  // checkVolatileMemory:false, so this shared helper is what guarantees the
  // two agree on the RAM axis (as diskRequirementBytes keeps them from
  // drifting on disk).
  const nonEvictableMiB = gateNonEvictableMiB({
    // The catalog's ModelFileSpec (this helper's own type), not the
    // size-only view the fit decider takes.
    model: { ...fitModel, mmproj: model.mmproj },
    contextTokens: fitModel.engineCtx,
    availableMemoryBytes: profile.availableMemoryBytes,
    benchNoRepack,
  });
  return {
    ...modelGateVerdict(
      {
        totalMemoryBytes: profile.totalMemoryBytes,
        availableMemoryBytes: profile.availableMemoryBytes,
        freeDiskBytes,
        ramTier: profile.ramTier,
        modelMinRamTier: model.minRamTier,
        modelNonEvictableMiB: nonEvictableMiB,
        modelWeightsBytesPerToken: model.weightsBytesPerToken,
        deviceBandwidthBytesPerSecond: deviceBandwidthForModel(deviceBandwidth, model),
        // Always margined so confirm/start/Settings share one disk requirement.
        modelSizeBytes: diskRequirementBytes(modelBundleSizeBytes(model)),
      },
      { checkVolatileMemory },
    ),
    nonEvictableMiB,
  };
}

/**
 * The profile's volatile axis re-sampled, everything else untouched:
 * `getCachedDeviceProfile()` freezes `availableMemoryBytes` for the process
 * (its builder reads memoryEstimate's process-lifetime cache), and
 * `monitor.ts`'s own header forbids cached MemAvailable on decision paths.
 * Total memory and RAM tier cannot change at runtime, so only MemAvailable is
 * re-read — through the same uncached reader the load gate's fit evaluation
 * already uses. Probe failure keeps the cached sample; never throws.
 */
export async function profileWithFreshMemory(
  profile: DeviceProfile,
): Promise<DeviceProfile> {
  try {
    const availableMemoryBytes = await getAvailableMemoryBytesUncached();
    if (typeof availableMemoryBytes === "number" && availableMemoryBytes > 0) {
      return { ...profile, availableMemoryBytes };
    }
  } catch {
    // The reader is documented never to throw; keep the cached sample anyway.
  }
  return profile;
}

/**
 * Bounded releaseEmbedder for chat-init: races release against
 * EMBEDDER_RELEASE_TIMEOUT_MS. On timeout: markEmbedderHung (drop the JS ref;
 * native leak isolated, never reused), do NOT clear the native-op chain (the
 * hung op holds it), do NOT proceed with chat init — the caller surfaces an
 * explicit busy state. Recovery for a hung native context = process restart.
 * Never throws.
 *
 * Invariant: never two overlapping llama.rn ops; a hung op holds the chain
 * and blocks new native work until restart.
 */
export async function releaseEmbedderBounded(): Promise<"released" | "timeout"> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      releaseEmbedder()
        .then(() => "released" as const)
        .catch(() => "released" as const),
      new Promise<"timeout">((resolve) => {
        timer = setTimeout(
          () => resolve("timeout"),
          EMBEDDER_RELEASE_TIMEOUT_MS,
        );
      }),
    ]);
    if (result === "timeout") {
      // Release timed out — native embedding/release is not cancellable.
      markEmbedderHung();
      console.warn(
        `[kalsa] releaseEmbedder timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms; embedder marked hung (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
      );
    }
    return result;
  } catch {
    return "released";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Localized hard-gate reason for Alert / error banner. */
export function gateReasonMessage(
  reason: ModelGateVerdict["reason"],
  t: (key: TranslationKey) => string,
): string {
  switch (reason) {
    case "blocked_tier":
      return t("models.blockedTier");
    case "blocked_ram":
      return t("models.blockedRam");
    case "blocked_disk":
      return t("models.blockedDisk");
    default:
      return t("models.mayNotFit");
  }
}
