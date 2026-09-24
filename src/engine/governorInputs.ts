import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import type { DeviceProfile } from "./deviceProfile";
import type { ModelInfo } from "./ModelRegistry";
import { estimateMemory, fitMemoryEstimate } from "./memoryEstimate";

const MIB = 1024 * 1024;
const BENCH_THERMO_KEY = "kalsa.bench.thermo";
export const BENCH_GOVERNOR_FORCE_KEY = "kalsa.bench.governor_force";

type Generation = "V73" | "V75" | "V79" | "Unknown";

const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
  V79: true, // S5 run 6 oracle PASS 4/4 (kalsa-moe-experiments ALIVE 48)
  /* Owner decision (2026-09-07): enable V75 under R6 of the logit-oracle protocol;
   * a PASS is reported, but production enablement is the owner's call, not an automatic promotion.
   * q4_0 GEMM product now computes in f32 (fork Aspis0/kalsallama @ 67c73d26c),
   * which was the cause of old divergence (historical ALIVE 38/39/48): confident-CPU top-1 flips 8/32 → 0.
   * Median |Δp₁| 0.0861 → 0.0014; GPU prefill is 1.242× vs CPU.
   * Caveat: raw oracle is still FAIL on R2; R2 requires ≤0.02 at every step;
   * same-top is 94.8%; evidence is n=1 pair on one board (ALIVE 60).
   */
  V75: true,
  V73: true, // owner decision 2026-09-21: enabled in production, never measured in-app; kalsa.bench.governor_force still exists for the other paths
  Unknown: false,
};

type ThermoProfile = {
  batt_temp_tenths_c: number;
  batt_level_pct: number;
  plugged: boolean;
  sensor_valid: boolean;
  t_idle_valid?: boolean;
  t_idle_c?: number;
  trend_c_per_min?: number;
};

type ThermoSnapshot = ThermoProfile & {
  thermo_source: "battery" | "bench-skin";
};

type BatteryModule = {
  readThermo?: () => Promise<unknown>;
};

type MemorySnapshot = {
  availableMemoryBytes: number | null;
  totalMemoryBytes?: number | null;
  contextTokens: number;
  ubatch?: number;
  mmap?: boolean;
  offloadedBytes?: number | null;
};

type GovernorModel = Pick<ModelInfo, "sizeBytes"> &
  Partial<Pick<ModelInfo, "hybrid" | "kvUnified" | "canStreamExperts" | "kvBytesPerToken">> & {
    model_kind?: "Dense" | "Hybrid" | "MoE";
  };

function generationFor(profile: DeviceProfile): Generation {
  const soc = (profile.socModel ?? "").toUpperCase();
  if (/(SM8550|KALAMA|SM7675|SM8635)/.test(soc)) return "V73";
  if (/(SM8650|PINEAPPLE)/.test(soc)) return "V75";
  if (/(SM8750|SUN)/.test(soc)) return "V79";
  const text = [profile.modelName, profile.modelId, profile.manufacturer]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toUpperCase();
  if (/(^|[^A-Z0-9])(QRD8650|SM8650)([^A-Z0-9]|$)/.test(text)) return "V75";
  if (/(^|[^A-Z0-9])(QRD8750|SM8750)([^A-Z0-9]|$)/.test(text)) return "V79";
  if (/(^|[^A-Z0-9])(HDK8550|SM8550|QRD7675|SM7675|QRD8635|SM8635)([^A-Z0-9]|$)/.test(text)) return "V73";
  return "Unknown";
}

function modelKind(model: GovernorModel) {
  if (model.model_kind) return model.model_kind;
  if (model.canStreamExperts) return "MoE" as const;
  if (model.hybrid || model.kvUnified) return "Hybrid" as const;
  return "Dense" as const;
}

function laneFit(
  model: GovernorModel,
  profile: DeviceProfile,
  memory: MemorySnapshot,
  repack: boolean,
) {
  const kv = model.kvBytesPerToken;
  if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit" as const;
  if (generationFor(profile) === "Unknown") return "NoFit" as const;

  const estimate = estimateMemory({
    fileBytes: model.sizeBytes,
    contextTokens: memory.contextTokens,
    kvBytesPerToken: kv,
    ubatch: memory.ubatch ?? 256,
    mmap: memory.mmap,
    repack,
  });
  const verdict = fitMemoryEstimate(
    estimate,
    typeof memory.availableMemoryBytes === "number"
      ? memory.availableMemoryBytes / MIB
      : null,
  );
  if (verdict.status === "unknown" || verdict.status === "does_not_fit") return "NoFit" as const;

  const offloadedBytes = memory.offloadedBytes ?? model.sizeBytes;
  const gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB;
  // Plan §4 bounds the two-context resident budget at 3.46–3.94 GiB.
  const requiredMiB =
    estimate.nonEvictableMiB +
    gpuReserveMiB +
    estimate.computeMiB +
    estimate.kvMiB;
  const availableMiB = (memory.availableMemoryBytes ?? 0) / MIB;
  return requiredMiB <= availableMiB ? "Fit" as const : "NoFit" as const;
}

function gpuFit(
  model: GovernorModel,
  profile: DeviceProfile,
  memory: MemorySnapshot,
  benchNoRepack: boolean | undefined,
) {
  // Price the lane WITH repack first: P1 (decode_repack false) drops the CPU
  // repack copy and costs ~1.41x lane decode plus KLD p99 0.034 -> 0.042, so
  // it is only taken where the repack-priced lane does not fit (8 GB S23:
  // 4358.70 MiB required with repack vs 2998.06 without). kalsa.bench.norepack
  // outranks this fit decision so one arm measures one configuration: "1"
  // skips the with-repack attempt (no-repack arm), "0" skips the P1 fallback
  // (repack-on arm, refused rather than silently re-priced); absent lets the
  // production order above decide.
  if (benchNoRepack !== true && laneFit(model, profile, memory, true) === "Fit") {
    return { fit: "Fit" as const, decodeRepack: true };
  }
  if (benchNoRepack !== false && laneFit(model, profile, memory, false) === "Fit") {
    return { fit: "Fit" as const, decodeRepack: false };
  }
  return { fit: "NoFit" as const, decodeRepack: benchNoRepack === false };
}

export function buildGovernorParams(
  modelEntry: GovernorModel,
  deviceProfile: DeviceProfile,
  memory: MemorySnapshot,
  force = false,
  benchNoRepack: boolean | undefined = undefined,
) {
  const generation = generationFor(deviceProfile);
  const enabled = force || GPU_PREFILL_CORRECT[generation];
  const lane = gpuFit(modelEntry, deviceProfile, memory, benchNoRepack);
  // measured: ALIVE #55 ~17x; #58 2.94x (Adreno 750); #38 >=9.8x (Adreno 830).
  return {
    enabled,
    generation,
    model_kind: modelKind(modelEntry),
    gpu_fit: lane.fit,
    // Binding param governor.decode_repack (default true): false makes
    // load_governor_models drop the decode model's CPU repack copy (P1).
    decode_repack: lane.decodeRepack,
    // V73 carries the owner's 2026-09-21 enablement decision, not a measurement.
    // The generation list is duplicated in the engine; the form refactor should carry it once.
    gpu_prefill_measured:
      generation === "V73" || generation === "V75" || generation === "V79",
    bench_force_gpu_prefill: force,
    npu_lane_enabled: false,
    reload_budget_available: false,
    forced: force,
    ...(enabled ? {} : { reason: `gpu-prefill-incorrect-${generation}` }),
  };
}

export async function readBenchGovernorForce(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(BENCH_GOVERNOR_FORCE_KEY)) === "1";
  } catch {
    return false;
  }
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function profileFrom(value: unknown): ThermoProfile | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const temp = numberValue(input.batt_temp_tenths_c ?? input.battTempTenthsC, 0);
  const level = numberValue(input.batt_level_pct ?? input.battLevelPct, 100);
  const plugged = input.plugged;
  const sensor = input.sensor_valid ?? input.sensorValid;
  if (typeof plugged !== "boolean" || typeof sensor !== "boolean") return null;
  const idleValidRaw = Boolean(input.t_idle_valid);
  const idleDegrees = numberValue(input.t_idle_c, Number.NaN);
  const idleTenths = numberValue(input.t_idle_tenths_c, Number.NaN);
  // t_idle_c reaches the engine in whole degrees C: the native side reports
  // tenths, the bench skin already reports degrees. Convert exactly once.
  // Validity is the engine's decision (profile_is_valid in
  // llama-governor-policy.cpp): forward the raw flag, apply no range gate here.
  const idle = Number.isFinite(idleDegrees)
    ? idleDegrees
    : Number.isFinite(idleTenths)
      ? idleTenths / 10
      : 0;
  return {
    batt_temp_tenths_c: temp,
    batt_level_pct: level,
    plugged,
    sensor_valid: sensor,
    t_idle_valid: idleValidRaw,
    t_idle_c: idle,
    trend_c_per_min: numberValue(input.trend_c_per_min, 0),
  };
}

export async function readGovernorThermo(): Promise<ThermoSnapshot> {
  try {
    const bench = await AsyncStorage.getItem(BENCH_THERMO_KEY);
    if (bench) {
      const profile = profileFrom(JSON.parse(bench));
      if (profile) return { ...profile, thermo_source: "bench-skin" };
    }
  } catch {
    // A malformed bench value must not block the production battery path.
  }

  try {
    const module = NativeModules.GovernorBattery as BatteryModule | undefined;
    const battery = module?.readThermo ? await module.readThermo() : null;
    const profile = profileFrom(battery);
    if (profile) return { ...profile, thermo_source: "battery" };
  } catch {
    // Missing native module is expected on host/iOS; it makes the profile invalid.
  }

  return {
    batt_temp_tenths_c: 0,
    batt_level_pct: 0,
    plugged: false,
    sensor_valid: false,
    thermo_source: "battery",
  };
}
