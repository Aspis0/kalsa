import AsyncStorage from "@react-native-async-storage/async-storage";
import { NativeModules } from "react-native";
import { pacingHeadroomLines } from "./declaredSevere";
import type { DeviceProfile } from "./deviceProfile";
import type { ModelInfo } from "./ModelRegistry";
import { estimateMemory, fitMemoryEstimate } from "./memoryEstimate";
import { getCurrentGovernorThermalStatus } from "./platformThermalStatus";

const MIB = 1024 * 1024;
const BENCH_THERMO_KEY = "kalsa.bench.thermo";
export const BENCH_GOVERNOR_FORCE_KEY = "kalsa.bench.governor_force";
/** Bench-only A/B for the governor NPU lane: absent or invalid → "auto", the
 *  gated default since the owner's 2026-10-02 decision, "off" forces the lane
 *  off, "on" forces it past the auto gates (fit and platform still win — the
 *  engine degrades to GPU when the device does not resolve). Production never
 *  writes this key. */
export const BENCH_NPU_LANE_KEY = "kalsa.bench.npu_lane";
/** Bench-only decode-hop cadence: when > 0 the engine alternates CPU / NPU
 *  decode every N generated tokens — and only on a load whose NPU lane
 *  resolved, so the hops never appear on a CPU/GPU load. This is the S23
 *  measurement knob for heat per token (CPU-only vs hopping); production
 *  never writes this key, and absent or invalid reads 0 = off. */
export const BENCH_DECODE_HOP_KEY = "kalsa.bench.decode_hop";

export type BenchNpuLanePref = "off" | "on" | "auto";

/** The pref the gates act on: absent or invalid (readBenchNpuLane →
 *  undefined) means "auto", the default since the owner's 2026-10-02
 *  decision. "off" still forces the lane off; "on" keeps its bypass. */
function effectiveNpuLanePref(pref?: BenchNpuLanePref): BenchNpuLanePref {
  return pref ?? "auto";
}

/** The HTP prefill copy costs +219 MiB over the OpenCL one (spike buffer
 *  table: HTP0 1525.87 MiB vs OpenCL 1307.20 MiB), so the NPU lane prices
 *  every fit with this extra — same repack order as the GPU lane, i.e. an
 *  8 GB device lands on decode_repack=false exactly like today. */
export const NPU_PREFILL_EXTRA_MIB = 219;

/** Safety margin added to every fit the governor decides, GPU and NPU alike,
 *  on top of the price (owner decision 2026-10-15: at least 300 MiB). */
const FIT_MARGIN_MIB = 300;

/** Adreno fixed cost of the GPU leg, measured ≈ 770 MiB on the Xiaomi 14. It
 *  is paid only when something is offloaded to the GPU, so the lane-only price
 *  leaves it out. */
const GPU_LEG_FIXED_MIB = 800;

/** Effective KV ggml types of the governor's NPU lane, applied to the types
 *  the context will actually receive (effectiveCacheTypes of the load's
 *  catalog values — with flash attention off the engine has already forced
 *  V to f16). When the lane runs (prefill on HTP0) the KV stays on the
 *  device, and the device cannot write every cache type: anything but
 *  f32/f16/q8_0 — unknown type names just the same — is upgraded to q8_0
 *  in BOTH governor contexts (kalsa.rn 3d8fc84a). The shipped catalog only
 *  carries f16/q8_0/q4_0, so a non-catalog input (bf16) rides the same
 *  upgrade to q8_0. Flash attention explicitly off disables the upgrade —
 *  the effective types run unchanged. */
export function npuLaneCacheTypes(
  cacheTypeK: string,
  cacheTypeV: string,
  flashAttnOff?: boolean,
): { k: string; v: string } {
  const upgrade = (type: string) =>
    flashAttnOff === true || type === "f32" || type === "f16" || type === "q8_0"
      ? type
      : "q8_0";
  return { k: upgrade(cacheTypeK), v: upgrade(cacheTypeV) };
}

/** What the NPU lane needs to know beyond the pure governor inputs; read at
 *  the call site (Platform, the mmproj gate and the bench pref live there). */
export type NpuLaneInputs = {
  android: boolean;
  /** Restates the LlamaService governorLoad gate (`… && !options.mmprojPath`)
   *  where the flag is built: vision models never claim the lane. */
  hasMmproj: boolean;
  /** The bench key's value as read; absent/invalid resolves to "auto". */
  lanePref?: BenchNpuLanePref;
  /** The model with its KV priced at npuLaneCacheTypes of the load's
   *  cache types — the lane fit must price the KV the lane will really hold.
   *  Composed from the catalog number at the call site: the model entry this
   *  function otherwise sees is already priced at the caller profile, and
   *  re-pricing that again would compound. Honoured only when the effective
   *  pref requests the lane ("auto", absent included, or "on"): with the
   *  lane off the entry's own pricing stands, byte-identical to 7ddf39ad. */
  laneModel?: GovernorModel;
  /** The Hexagon arch the runtime actually registered (readHtpRuntimeArch,
   *  the "Hexagon v<NN>" HTP0 description); null when no HTP device is
   *  registered or the read failed. The auto gate reads the device, not the
   *  SoC name — an unknown SoC whose v79 HTP device registered takes the
   *  lane, and a named SoC without a registered device does not. */
  htpArch: number | null;
};

type Generation = "V73" | "V75" | "V79" | "V81" | "Unknown";

/** Exported (keys only) for the logReport schema drift test — the one runtime source of the governor fallback generations. */
export const GPU_PREFILL_CORRECT: Record<Generation, boolean> = {
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
  V81: true, // owner 2026-10-11: GPU fallback when the NPU lane is off; raw R2 still FAIL, as V75 (oracle-onoff-41dc728f addendum)
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
  platform_thermal_status?: number;
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

/** The two SoC strings the generation checks read: ro.soc.model, and the
 *  model/manufacturer text those checks fall back to. */
function socIdentifiers(profile: DeviceProfile) {
  return {
    soc: (profile.socModel ?? "").toUpperCase(),
    text: [profile.modelName, profile.modelId, profile.manufacturer]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
      .toUpperCase(),
  };
}

function generationFor(profile: DeviceProfile): Generation {
  const { soc, text } = socIdentifiers(profile);
  if (/(SM8550|KALAMA|SM7675|SM8635)/.test(soc)) return "V73";
  if (/(SM8650|PINEAPPLE)/.test(soc)) return "V75";
  if (/(SM8750|SUN)/.test(soc)) return "V79";
  // QDC device logs: ro.soc.model=SM8850, board.platform=canoe, product.model=Canoe.
  if (/(SM8850|CANOE)/.test(soc)) return "V81";
  if (/(^|[^A-Z0-9])(QRD8650|SM8650)([^A-Z0-9]|$)/.test(text)) return "V75";
  if (/(^|[^A-Z0-9])(QRD8750|SM8750)([^A-Z0-9]|$)/.test(text)) return "V79";
  if (/(^|[^A-Z0-9])(QRD8850|SM8850)([^A-Z0-9]|$)/.test(text)) return "V81";
  if (/(^|[^A-Z0-9])(HDK8550|SM8550|QRD7675|SM7675|QRD8635|SM8635)([^A-Z0-9]|$)/.test(text)) return "V73";
  return "Unknown";
}

function modelKind(model: GovernorModel) {
  if (model.model_kind) return model.model_kind;
  if (model.canStreamExperts) return "MoE" as const;
  if (model.hybrid || model.kvUnified) return "Hybrid" as const;
  return "Dense" as const;
}

/** The NPU lane's eligibility gates other than the memory fit. The fit cannot
 *  decide them: the fit's price depends on whether the lane is eligible
 *  (lane-only when the GPU leg is left out), so the gates come first. */
function npuLaneGates(
  model: GovernorModel,
  lanePref: BenchNpuLanePref,
  npu?: NpuLaneInputs,
): boolean {
  if (lanePref === "off") return false;
  const androidOk = npu?.android ?? false;
  const visionOk = !npu?.hasMmproj;
  if (lanePref === "on") return androidOk && visionOk;
  const arch = npu?.htpArch ?? null;
  return androidOk && visionOk && arch !== null && arch >= 73 && modelKind(model) !== "MoE";
}

function lanePrice(
  model: GovernorModel,
  memory: MemorySnapshot,
  repack: boolean,
  gpuLeg: boolean,
) {
  const kv = model.kvBytesPerToken;
  if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return null;

  // The generic REPACK_FRACTION (0.8951, memoryEstimate.ts) is anchored on
  // other models — on the S23 the ship model's CPU_REPACK buffer was
  // ~1511 MiB for its 1520 MiB Q4_0 file, i.e. for Q4_0 almost every weight
  // is repackable. Price the LANE's repack copy at 1.0 × weight bytes so the
  // boundary errs safe (an optimistic price picks repack, OOMs, and falls
  // back); the generic fraction stays untouched for its other callers.
  const estimate = estimateMemory({
    fileBytes: model.sizeBytes,
    contextTokens: memory.contextTokens,
    kvBytesPerToken: kv,
    ubatch: memory.ubatch ?? 256,
    mmap: memory.mmap,
    repack: false,
  });
  const priced = repack
    ? {
        ...estimate,
        repackMiB: estimate.weightsMiB,
        nonEvictableMiB: estimate.nonEvictableMiB + estimate.weightsMiB,
        totalMiB: estimate.totalMiB + estimate.weightsMiB,
      }
    : estimate;
  // nonEvictableMiB already holds compute and KV (memoryEstimate.ts), so they
  // are not added again here.
  const offloadedBytes = memory.offloadedBytes ?? model.sizeBytes;
  const requiredMiB =
    priced.nonEvictableMiB +
    (gpuLeg ? GPU_LEG_FIXED_MIB : 0) +
    (1.05 * offloadedBytes) / MIB;
  return { priced, requiredMiB };
}

function laneFit(
  model: GovernorModel,
  memory: MemorySnapshot,
  repack: boolean,
  extraMiB: number,
  gpuLeg: boolean,
) {
  const lane = lanePrice(model, memory, repack, gpuLeg);
  if (!lane) return "NoFit" as const;
  const verdict = fitMemoryEstimate(
    lane.priced,
    typeof memory.availableMemoryBytes === "number"
      ? memory.availableMemoryBytes / MIB
      : null,
  );
  if (verdict.status === "unknown" || verdict.status === "does_not_fit") return "NoFit" as const;

  const availableMiB = (memory.availableMemoryBytes ?? 0) / MIB;
  return lane.requiredMiB + extraMiB + FIT_MARGIN_MIB <= availableMiB
    ? ("Fit" as const)
    : ("NoFit" as const);
}

export function buildGovernorPlanLog(
  model: GovernorModel,
  memory: MemorySnapshot,
  governor: {
    gpu_fit: "Fit" | "NoFit";
    gpu_leg: boolean;
    npu_price: "lane_only" | "with_gpu";
    decode_repack: boolean;
    npu_device?: string | null;
    npu_fallback?: string | null;
    npu_fit?: "Fit" | "NoFit";
    /** The pacing lines buildGovernorParams computed for this load, read from
     *  the same object, never from a second table lookup. Absent when the
     *  phone has no row. */
    decode_pacing_headroom_start?: number;
    decode_pacing_headroom_full?: number;
  },
  benchNoRepack: boolean | undefined,
  npuLanePref?: BenchNpuLanePref,
  lane?: {
    /** The model priced at npuLaneCacheTypes — what the NPU lane fit compares. */
    laneModel?: GovernorModel;
    /** Which source supplied availableMemoryBytes: the post-release uncached
     *  read ("fresh"), the app-start cache it fell back to ("cached"), or
     *  neither ("none": both were null). */
    availableSrc?: "fresh" | "cached" | "none";
  },
) {
  // The binding fit check is requiredMiB + extraMiB + FIT_MARGIN_MIB <=
  // availableMiB, so the printed required_mib carries the same margin, the
  // same +219 MiB HTP prefill copy and the same lane-priced KV the decision
  // used — otherwise a postmortem recomputing fit-vs-available from this line
  // disagrees with the verdict. The effective pref decides both (an absent or
  // invalid read is "auto"); with the lane off the binding check is the GPU
  // lane's own (no extra, entry pricing). The price is the one buildGovernorParams
  // decided with (npu_price), so a caller's pref cannot change it here.
  const lanePref = effectiveNpuLanePref(npuLanePref);
  const laneRequested = lanePref !== "off";
  const laneOnly = governor.npu_price === "lane_only";
  const pricedModel = laneRequested ? (lane?.laneModel ?? model) : model;
  const extraMiB = laneRequested ? NPU_PREFILL_EXTRA_MIB : 0;
  const withRepack = lanePrice(pricedModel, memory, true, !laneOnly);
  const withoutRepack = lanePrice(pricedModel, memory, false, !laneOnly);
  const availableMiB = (memory.availableMemoryBytes ?? 0) / MIB;
  const roundMiB = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const printedMiB = (price: { requiredMiB: number } | null) =>
    roundMiB((price?.requiredMiB ?? 0) + extraMiB + FIT_MARGIN_MIB);

  return {
    gpu_fit: governor.gpu_fit,
    decode_repack: governor.decode_repack,
    required_mib_with_repack: printedMiB(withRepack),
    required_mib_without_repack: printedMiB(withoutRepack),
    available_mib: roundMiB(availableMiB),
    bench_norepack_forced: benchNoRepack ?? null,
    // Intent, not outcome: the loader resolves the device after this line; a
    // GPU degrade is reported on KALSA_GOVERNOR via the stats fields.
    npu_device: governor.npu_device ?? null,
    npu_fallback: governor.npu_fallback ?? null,
    // The effective pref ASKED for, not the resolved lane, so a crash can be
    // attributed to lane on vs off: absent/invalid reads resolve to the
    // default "auto" and print as such.
    npu_lane: lanePref,
    // The lane fit verdict these required_mib explain (the GPU lane's is
    // gpu_fit above).
    npu_fit: governor.npu_fit ?? null,
    available_src: lane?.availableSrc ?? null,
    // The lines computed for this load, so a device run can tell the declared
    // table from the battery ramp; null when the phone has no declared row.
    // The engine receives them only when the governor load is built, which
    // NoFit or a thermal gate can still refuse.
    pacing_start: governor.decode_pacing_headroom_start ?? null,
    pacing_full: governor.decode_pacing_headroom_full ?? null,
    // Which price the printed required_mib are: the GPU-inclusive one, or the
    // lane-only one that leaves the 800 MiB GPU leg out.
    npu_price: laneOnly ? "lane_only" : "with_gpu",
    gpu_leg: governor.gpu_leg,
  };
}

function gpuFit(
  model: GovernorModel,
  memory: MemorySnapshot,
  benchNoRepack: boolean | undefined,
  extraMiB = 0,
  gpuLeg = true,
) {
  // Price the lane WITH repack first: P1 (decode_repack false) drops the CPU
  // repack copy and costs ~1.41x lane decode plus KLD p99 0.034 -> 0.042, so
  // it is only taken where the repack-priced lane does not fit (on the S23
  // ship model the repack copy alone is ~1520 MiB, the weights' file size).
  // kalsa.bench.norepack outranks this fit decision so one arm measures one
  // configuration: "1" skips the with-repack attempt (no-repack arm), "0"
  // skips the P1 fallback (repack-on arm, refused rather than silently
  // re-priced); absent lets the production order above decide.
  if (benchNoRepack !== true && laneFit(model, memory, true, extraMiB, gpuLeg) === "Fit") {
    return { fit: "Fit" as const, decodeRepack: true };
  }
  if (benchNoRepack !== false && laneFit(model, memory, false, extraMiB, gpuLeg) === "Fit") {
    return { fit: "Fit" as const, decodeRepack: false };
  }
  return { fit: "NoFit" as const, decodeRepack: benchNoRepack === false };
}

/** The NPU lane's load and its verdict. The GPU leg is left out only where the
 *  lane takes the load alone: the GPU does not fit, or the GPU-inclusive lane
 *  does not fit but the lane-only price does. A refused lane (gates false) keeps
 *  the GPU-inclusive price it always had, even when the GPU does not fit. */
function npuLaneLoad(
  gates: boolean,
  gpuOwnFit: "Fit" | "NoFit",
  priceLane: (gpuLeg: boolean) => ReturnType<typeof gpuFit>,
) {
  if (!gates) return { gpuLeg: gpuOwnFit === "Fit", npuLane: priceLane(true) };
  if (gpuOwnFit === "NoFit") return { gpuLeg: false, npuLane: priceLane(false) };
  const withGpu = priceLane(true);
  if (withGpu.fit === "Fit") return { gpuLeg: true, npuLane: withGpu };
  const laneOnly = priceLane(false);
  return laneOnly.fit === "Fit"
    ? { gpuLeg: false, npuLane: laneOnly }
    : { gpuLeg: true, npuLane: withGpu };
}

export function buildGovernorParams(
  modelEntry: GovernorModel,
  deviceProfile: DeviceProfile,
  memory: MemorySnapshot,
  force = false,
  benchNoRepack: boolean | undefined = undefined,
  npu?: NpuLaneInputs,
  decodeHopTokens = 0,
) {
  const generation = generationFor(deviceProfile);
  const lane = gpuFit(modelEntry, memory, benchNoRepack);
  // Only a requested lane re-prices: lanePref is the one place "requested"
  // lives, so a load with the lane off (pref "off") prices npu_fit at the
  // entry's own caller profile.
  const lanePref = effectiveNpuLanePref(npu?.lanePref);
  const laneRequested = lanePref !== "off";
  // The lane's gates other than the fit (see npuLaneGates). An eligible lane
  // takes the load alone (prefill on HTP0, no GPU leg) when the GPU does not
  // fit, or when the GPU-inclusive lane does not fit and the lane-only one does.
  const gates = npuLaneGates(modelEntry, lanePref, npu);
  const npuModel = laneRequested ? (npu?.laneModel ?? modelEntry) : modelEntry;
  const { gpuLeg, npuLane } = npuLaneLoad(gates, lane.fit, (withGpuLeg) =>
    gpuFit(npuModel, memory, benchNoRepack, NPU_PREFILL_EXTRA_MIB, withGpuLeg),
  );
  // NPU lane eligibility (owner rule 2026-09-28). The default is "auto" since
  // the owner's 2026-10-02 decision: the S23 measurement (lane-on prefill
  // 4.0x/5.5x vs host KV, decode unchanged, 7/7 correct) and the S23 heat
  // arms (HTP the coolest prefill backend per 1k tokens) cleared the gates
  // that used to leave the lane off. Hard gates never bend: Android only,
  // vision excluded (the LlamaService governorLoad gate
  // `… && !options.mmprojPath`, restated here via hasMmproj), memory fit
  // priced with the +219 MiB HTP prefill copy. MoE never claims it — the app
  // has no expert-readability signal, and the engine requires the pair.
  // bench pref: "off" forces off; "on" bypasses only the auto gates (arch
  // and kind); fit, platform and vision stay hard. When HTP0 does not
  // resolve at load the binding clears the lane: prefill then goes to the GPU
  // only when the GPU leg runs on a GPU-qualified generation, and stays on the
  // CPU otherwise (a lane-only load has no GPU fallback).
  const laneEnabled = gates && npuLane.fit === "Fit";
  // The governor also loads lane-only: a generation whose GPU prefill is not
  // qualified (Unknown), or that runs without the GPU leg, still runs prefill on
  // HTP0 with decode on CPU, so enabled is GPU-qualified OR lane enabled — and when
  // both are false the Android-only n_gpu_layers guard lands the load on CPU.
  const enabled = force || GPU_PREFILL_CORRECT[generation] || laneEnabled;
  // measured: ALIVE #55 ~17x; #58 2.94x (Adreno 750); #38 >=9.8x (Adreno 830).
  return {
    enabled,
    generation,
    model_kind: modelKind(modelEntry),
    gpu_fit: lane.fit,
    // Whether the load runs the GPU leg: false on a lane-only load even when
    // gpu_fit is Fit. Always emitted, so the binding never has to guess.
    gpu_leg: gpuLeg,
    // The price the NPU fit used, which the plan log prints: lane-only exactly
    // when the lane is priced without the GPU leg (lane on or off).
    npu_price: gates && !gpuLeg ? ("lane_only" as const) : ("with_gpu" as const),
    // Binding param governor.decode_repack (default true): false makes
    // load_governor_models drop the decode model's CPU repack copy (P1).
    // When the NPU lane is on, its own fit decides — the HTP copy costs
    // +219 MiB, so an 8 GB device falls to no-repack exactly like today.
    decode_repack: laneEnabled ? npuLane.decodeRepack : lane.decodeRepack,
    // Binding param governor.decode_hop_tokens (default 0): the bench cadence
    // from kalsa.bench.decode_hop. Omitted when off so the default params
    // object stays byte-identical to production.
    ...(decodeHopTokens > 0 ? { decode_hop_tokens: decodeHopTokens } : {}),
    // Per-model decode-pacing lines from the declared SEVERE table; empty for
    // phones without a measured row, so their params stay byte-identical.
    ...(pacingHeadroomLines(deviceProfile) ?? {}),
    // V73, V75 and V81 carry owner enablement decisions; V79 passed the token oracle (S5 run 6).
    // No committed logit-oracle PASS exists for any generation.
    // The generation list is duplicated in the engine; the form refactor should carry it once.
    // Without the GPU leg no prefill goes to the GPU, whatever the generation.
    gpu_prefill_measured:
      (generation === "V73" || generation === "V75" || generation === "V79" || generation === "V81") &&
      gpuLeg,
    // Owner 2026-10-16: a too-hot NPU hands prefill to a cooler GPU on every
    // generation the engine lists, though GPU prefill still fails R2 on V75/V81.
    prefill_thermal_handoff: true,
    // No GPU leg means no GPU prefill to force, whatever the bench asked for.
    bench_force_gpu_prefill: force && gpuLeg,
    npu_lane_enabled: laneEnabled,
    npu_fit: npuLane.fit,
    // Claim only what is switched on: with the lane off the binding skips
    // the device resolver and the plan says nothing; with it on the trunk
    // weights are readable (the engine re-checks both facts).
    htp_trunk_readable: laneEnabled,
    // No app-side signal says whether MoE expert weights are HTP-readable —
    // MoE never passes `kindOk` below, and the engine requires the pair.
    htp_experts_readable: false,
    // Intent, not outcome: resolved at load; a GPU degrade reaches
    // KALSA_GOVERNOR as stats.npu_device/npu_fallback.
    npu_device: laneEnabled ? "HTP0" : null,
    npu_fallback: null,
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

/** absent/invalid → undefined; the gates resolve that to "auto". */
export async function readBenchNpuLane(): Promise<BenchNpuLanePref | undefined> {
  try {
    const raw = await AsyncStorage.getItem(BENCH_NPU_LANE_KEY);
    return raw === "off" || raw === "on" || raw === "auto" ? raw : undefined;
  } catch {
    return undefined;
  }
}

/** A positive integer is the hop cadence; absent or invalid reads 0 = off
 *  (Number(null) is 0, so the absent key needs no branch of its own). */
export async function readBenchDecodeHop(): Promise<number> {
  try {
    const value = Number(await AsyncStorage.getItem(BENCH_DECODE_HOP_KEY));
    return Number.isInteger(value) && value > 0 ? value : 0;
  } catch {
    return 0;
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
  // t_idle_c reaches the engine in degrees C (fractional, e.g. 37.3): the
  // native side reports tenths, the bench skin already reports degrees.
  // Convert exactly once.
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
  // One platform read per completion, at the battery read's cadence; null
  // (iOS, unsupported, failed read) omits the key entirely, which the engine
  // treats as an absent platform vote.
  const platformStatus = await getCurrentGovernorThermalStatus();
  const platform =
    platformStatus === null ? {} : { platform_thermal_status: platformStatus };
  try {
    const bench = await AsyncStorage.getItem(BENCH_THERMO_KEY);
    if (bench) {
      const profile = profileFrom(JSON.parse(bench));
      // The live platform status rides even under the bench override, on
      // purpose: safety outranks arm determinism, and a frozen thermo
      // already disables engine stops.
      if (profile) return { ...profile, ...platform, thermo_source: "bench-skin" };
    }
  } catch {
    // A malformed bench value must not block the production battery path.
  }

  try {
    const module = NativeModules.GovernorBattery as BatteryModule | undefined;
    const battery = module?.readThermo ? await module.readThermo() : null;
    const profile = profileFrom(battery);
    if (profile) return { ...profile, ...platform, thermo_source: "battery" };
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
