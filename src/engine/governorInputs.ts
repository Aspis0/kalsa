import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import type { DeviceProfile } from "./deviceProfile";
import type { ModelInfo } from "./ModelRegistry";
import { estimateMemory, fitMemoryEstimate } from "./memoryEstimate";

const MIB = 1024 * 1024;
const EIGHT_GIB = 8 * 1024 * MIB;
const BENCH_THERMO_KEY = "kalsa.bench.thermo";
export const BENCH_GOVERNOR_FORCE_KEY = "kalsa.bench.governor_force";

type Generation = "V73" | "V75" | "V79" | "Unknown";

const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
  V79: true, // S5 run 6 oracle PASS 4/4 (kalsa-moe-experiments ALIVE 48)
  V75: false, // Adreno 750 f16/bf16-batched MUL_MAT defect: S5 runs 3-5 deterministic divergence @token 14 (ALIVE 38/39/48)
  V73: false, // never measured in-app; bench runs use kalsa.bench.governor_force
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
  repack?: boolean;
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

function gpuFit(
  model: GovernorModel,
  profile: DeviceProfile,
  memory: MemorySnapshot,
) {
  const total = profile.totalMemoryBytes ?? memory.totalMemoryBytes;
  const kv = model.kvBytesPerToken;
  if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit" as const;
  if (typeof total !== "number" || total <= EIGHT_GIB) return "NoFit" as const;
  if (generationFor(profile) === "Unknown") return "NoFit" as const;

  const estimate = estimateMemory({
    fileBytes: model.sizeBytes,
    contextTokens: memory.contextTokens,
    kvBytesPerToken: kv,
    ubatch: memory.ubatch ?? 256,
    mmap: memory.mmap,
    repack: memory.repack,
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

export function buildGovernorParams(
  modelEntry: GovernorModel,
  deviceProfile: DeviceProfile,
  memory: MemorySnapshot,
  force = false,
) {
  const generation = generationFor(deviceProfile);
  const enabled = force || GPU_PREFILL_CORRECT[generation];
  // measured: ALIVE #55 ~17x; #58 2.94x (Adreno 750); #38 >=9.8x (Adreno 830).
  return {
    enabled,
    generation,
    model_kind: modelKind(modelEntry),
    gpu_fit: gpuFit(modelEntry, deviceProfile, memory),
    gpu_prefill_measured: generation === "V75" || generation === "V79",
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
  const idleValid = Boolean(input.t_idle_valid);
  const idle = numberValue(input.t_idle_c, 0);
  return {
    batt_temp_tenths_c: temp,
    batt_level_pct: level,
    plugged,
    sensor_valid: sensor,
    t_idle_valid: idleValid,
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
