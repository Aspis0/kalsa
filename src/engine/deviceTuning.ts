/**
 * Device Tuning Layer — measured-first engine knob resolution.
 *
 * Pure module (no react-native / expo at module scope). Every knob carries a
 * provenance string (design §4 / §8). Resolution order (design §7):
 *   1. exact SoC preset from the measured registry
 *   2. family policy (apple / android-big / android-small / fallback)
 *   3. memory budget on n_ctx
 *   4. thermal guard flag (boolean/seconds only; no behavior)
 *
 * Composes deviceProfile, threadProfile, contextProfile, memoryEstimate,
 * ModelRegistry — never reimplements their rules.
 */

import {
  estimateMemory,
  fitMemoryEstimate,
  type MemoryFitVerdict,
} from "./memoryEstimate";
import {
  chooseThreadCountFromCapacities,
  detectThreadCount,
  FALLBACK_THREAD_COUNT,
  getThreadCountSource,
} from "./threadProfile";
import { DEFAULT_N_CTX } from "./contextProfile";

// ── Types (design §3–§6) ────────────────────────────────────────────────────
//
// Structural shapes only (no import of ModelRegistry / deviceProfile) so the
// node harness compiles without i18n / expo. ModelInfo and DeviceProfile are
// structural supersets — production can pass them as-is.

/** Subset of DeviceProfile read by the tuning layer. */
export type TuningDeviceProfile = {
  brand: string | null;
  modelName?: string | null;
  modelId?: string | null;
  osName?: string | null;
  cpuCoreCount: number | null;
  availableMemoryBytes: number | null;
  totalMemoryBytes?: number | null;
};

/** Subset of ModelInfo read by the tuning layer. */
export type TuningModelInfo = {
  id: string;
  sizeBytes: number;
  engineCtx: number;
  contextLength: number;
  kvCache?: { k: string; v: string };
  kvBytesPerToken?: number;
};

export type BackendPolicyKind =
  | "cpu-only"
  | "gpu-opencl"
  | "gpu-metal"
  | "emulator";

/**
 * Backend policy object (design §6). `kind` is the switch; `reason` is the
 * measured/documented justification (never empty).
 */
export type BackendPolicy = {
  kind: BackendPolicyKind;
  reason: string;
};

export type MeasuredPresetId =
  | "helio-g99"
  | "sd-8-gen2"
  | "sd-8-gen3"
  | "apple";

/**
 * One entry in the measured SoC registry (design §5). Values are from our own
 * llama-bench / capacity-rule campaign — do not invent.
 */
export type MeasuredPreset = {
  id: MeasuredPresetId;
  decodeThreads: number;
  prefillThreads: number;
  /** Exact multiset of per-core cpu_capacity values (order-insensitive). */
  capacitySignature: number[];
  /** Brand substrings that identify this SoC when present (lowercased). */
  brands: string[];
  /** Expected present-core count; null = any (apple). */
  cpuCoreCount: number | null;
};

export type TuningInput = {
  model: TuningModelInfo;
  profile: TuningDeviceProfile;
  /**
   * Optional per-core cpu_capacity values for SoC matching. Production async
   * path may omit these (detectThreadCount already applied the capacity rule);
   * harnesses pass synthetic signatures to hit exact presets.
   */
  cpuCapacities?: number[] | null;
  /** Optional bench-side measured fragment (reserved; unused by pure core). */
  measured?: Record<string, unknown>;
  request: {
    contextBudget?: number;
    ubatchOverride?: number;
    threadsOverride?: number;
  };
  /**
   * Platform hint when profile.osName is missing (LlamaService / harness).
   * "ios" | "android" | "emulator" | other.
   */
  platformHint?: string;
  /**
   * Pre-resolved n_threads for the pure sync path (from detectThreadCount or
   * a test fixture). Required for correct non-preset Android resolution when
   * capacities are not supplied.
   */
  resolvedThreads?: number;
  /** Provenance of resolvedThreads when provided by the caller. */
  resolvedThreadsSource?: string;
};

export type TuningResult = {
  n_threads: number;
  nThreadsSource: string;
  /** Prefill thread count (measured dual on G99; equals decode elsewhere). */
  n_threads_prefill: number;
  n_ubatch: number;
  ubatchSource: string;
  kv: { type_k: string; type_v: string };
  kvSource: string;
  context: { n_ctx: number; ctxSource: string };
  memory: {
    nonEvictableMiB: number;
    availableMiB: number | null;
    fit: MemoryFitVerdict["status"];
  };
  backend: BackendPolicy;
  thermal: { maxDecodeSeconds?: number; guardSource: string };
};

/** Provenance strings allowed by design §8 (+ measured kv/ubatch tags). */
export const PROVENANCE_SOURCES = [
  "soc-preset:helio-g99",
  "soc-preset:sd-8-gen2",
  "soc-preset:sd-8-gen3",
  "soc-preset:apple",
  "family:apple",
  "family:android-big",
  "family:android-small",
  "fallback",
  "override:user",
  "override:bench",
  "measured:kv-defaults",
  "measured:ubatch-256",
  "request",
  "memory-budget",
  "floor:2048",
  "none",
] as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

// ── Measured registry (design §5) ───────────────────────────────────────────

/**
 * Seeded from app/llama-bench measurements. capacitySignature is the multiset
 * of /sys/.../cpu_capacity values (order free; compared sorted).
 */
export const MEASURED_PRESETS: readonly MeasuredPreset[] = [
  {
    id: "helio-g99",
    decodeThreads: 2,
    prefillThreads: 8,
    // 2×A76@1024 + 6×A55@348 (Jelly Star)
    capacitySignature: [348, 348, 348, 348, 348, 348, 1024, 1024],
    brands: ["unihertz", "jelly"],
    cpuCoreCount: 8,
  },
  {
    id: "sd-8-gen2",
    decodeThreads: 5,
    prefillThreads: 5,
    // 3×266 + 4×811 + 1×1024 (S23)
    capacitySignature: [266, 266, 266, 811, 811, 811, 811, 1024],
    brands: [],
    cpuCoreCount: 8,
  },
  {
    id: "sd-8-gen3",
    decodeThreads: 6,
    prefillThreads: 6,
    // 1P+5perf+2eff shape used in threadProfile harness
    capacitySignature: [1024, 980, 980, 980, 940, 940, 320, 320],
    brands: [],
    cpuCoreCount: 8,
  },
  {
    id: "apple",
    decodeThreads: 4,
    prefillThreads: 4,
    capacitySignature: [],
    brands: ["apple"],
    cpuCoreCount: null,
  },
] as const;

const DEFAULT_UBATCH = 256;
const CTX_FLOOR = 2048;
const MIB = 1024 * 1024;

// ── Helpers ─────────────────────────────────────────────────────────────────

function sortedCopy(xs: number[]): number[] {
  return xs.slice().sort((a, b) => a - b);
}

function signaturesEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sa = sortedCopy(a);
  const sb = sortedCopy(b);
  for (let i = 0; i < sa.length; i++) {
    if (sa[i] !== sb[i]) return false;
  }
  return true;
}

function brandOf(profile: TuningDeviceProfile): string {
  return (profile.brand ?? "").trim().toLowerCase();
}

function isApplePlatform(
  profile: TuningDeviceProfile,
  platformHint?: string,
): boolean {
  const hint = (platformHint ?? "").trim().toLowerCase();
  if (hint === "ios" || hint === "macos" || hint === "apple") return true;
  const os = (profile.osName ?? "").trim().toLowerCase();
  if (os === "ios" || os === "ipados" || os === "macos") return true;
  const b = brandOf(profile);
  if (b === "apple") return true;
  return false;
}

function isEmulator(
  profile: TuningDeviceProfile,
  platformHint?: string,
): boolean {
  const hint = (platformHint ?? "").trim().toLowerCase();
  if (hint === "emulator" || hint === "android-emulator") return true;
  const model = (profile.modelName ?? "").trim().toLowerCase();
  const id = (profile.modelId ?? "").trim().toLowerCase();
  // Common emulator markers (best-effort; never hard-blocks).
  if (model.includes("sdk") || model.includes("emulator")) return true;
  if (id.includes("sdk_gphone") || id.includes("emulator")) return true;
  return false;
}

/**
 * Exact SoC preset match (design §7.1).
 *
 * Match only on exact capacity signature (multiset) or exact model identity.
 * NEVER brand + core count alone (Jelly Max / Dimensity 7300 is also
 * unihertz + 8 cores but is NOT G99). Apple is brand-only (no capacity
 * signature in the registry). Returns null for unknown devices — never invents.
 */
export function matchMeasuredPreset(
  profile: TuningDeviceProfile,
  capacities?: number[] | null,
): MeasuredPreset | null {
  const cores = profile.cpuCoreCount;
  const brand = brandOf(profile);
  const caps =
    Array.isArray(capacities) && capacities.length > 0 ? capacities : null;
  const modelName = (profile.modelName ?? "").trim().toLowerCase();
  const modelId = (profile.modelId ?? "").trim().toLowerCase();

  // 1. Capacity signature exact match (strongest; order-insensitive multiset).
  if (caps) {
    for (const preset of MEASURED_PRESETS) {
      if (preset.capacitySignature.length === 0) continue;
      if (
        preset.cpuCoreCount != null &&
        cores != null &&
        preset.cpuCoreCount !== cores
      ) {
        continue;
      }
      if (signaturesEqual(preset.capacitySignature, caps)) {
        return preset;
      }
    }
  }

  // 2. Exact model identity for helio-g99 (Jelly Star only — never brand alone).
  // Requires brand unihertz AND exact identity after normalize (trim/lower/strip spaces+dashes).
  // "Jelly Max" and other Unihertz devices must NOT match; capacity multiset remains primary.
  if (brand === "unihertz") {
    const nameKey = modelName.replace(/[\s-]+/g, "");
    const idKey = modelId.replace(/[\s-]+/g, "");
    if (nameKey === "jellystar" || idKey === "jellystar") {
      for (const preset of MEASURED_PRESETS) {
        if (preset.id === "helio-g99") return preset;
      }
    }
  }

  // 3. Apple brand-only (no capacity signature in the registry).
  for (const preset of MEASURED_PRESETS) {
    if (preset.id !== "apple") continue;
    const brandHit = preset.brands.some(
      (b) => brand === b || brand.includes(b),
    );
    if (brandHit) return preset;
  }

  return null;
}

/**
 * Backend policy per family (design §6).
 * Android → cpu-only (hexagon-offload-fatal). Apple → metal. Emulator → no-accel.
 * OpenCL path exists as a kind but is never selected (gated off; unmeasured).
 */
export function resolveBackendPolicy(
  profile: TuningDeviceProfile,
  platformHint?: string,
): BackendPolicy {
  if (isEmulator(profile, platformHint)) {
    return { kind: "emulator", reason: "no-accel" };
  }
  if (isApplePlatform(profile, platformHint)) {
    return { kind: "gpu-metal", reason: "apple" };
  }
  // Android default — HTP0/Hexagon offload was fatal with FA on CPU.
  return { kind: "cpu-only", reason: "hexagon-offload-fatal" };
}

/**
 * Classify android family from capacities for provenance only.
 * big: high-core count from capacity rule ≥4 on ≥6-core SoC (SD 8 Gen class).
 * small: G99-like (≤2 fast cores on 8-core SoC).
 */
function androidFamilySource(
  capacities: number[],
  decodeThreads: number,
): "family:android-big" | "family:android-small" | "fallback" {
  if (!Array.isArray(capacities) || capacities.length === 0) return "fallback";
  if (capacities.length >= 8 && decodeThreads <= 2) {
    return "family:android-small";
  }
  if (capacities.length >= 6 && decodeThreads >= 4) {
    return "family:android-big";
  }
  return "fallback";
}

type ThreadResolution = {
  n_threads: number;
  n_threads_prefill: number;
  nThreadsSource: string;
};

/**
 * Resolve decode/prefill threads + provenance (design §7.1–§7.2).
 * Pure: never calls detectThreadCount (async). Uses preset / override /
 * capacities / resolvedThreads / family rules only.
 */
function resolveThreadsSync(input: TuningInput): ThreadResolution {
  const { profile, request, platformHint } = input;
  const caps =
    Array.isArray(input.cpuCapacities) && input.cpuCapacities.length > 0
      ? input.cpuCapacities
      : null;

  // User / bench override wins over everything (design §8 override:*).
  if (
    typeof request.threadsOverride === "number" &&
    Number.isFinite(request.threadsOverride) &&
    request.threadsOverride > 0
  ) {
    const t = Math.floor(request.threadsOverride);
    return {
      n_threads: t,
      n_threads_prefill: t,
      nThreadsSource: "override:user",
    };
  }

  // 1. Exact SoC preset.
  const preset = matchMeasuredPreset(profile, caps);
  if (preset) {
    return {
      n_threads: preset.decodeThreads,
      n_threads_prefill: preset.prefillThreads,
      nThreadsSource: `soc-preset:${preset.id}`,
    };
  }

  // 2. Family policy.
  if (isApplePlatform(profile, platformHint)) {
    return {
      n_threads: 4,
      n_threads_prefill: 4,
      nThreadsSource: "family:apple",
    };
  }

  // Capacities present → capacity rule (compose threadProfile; do not reimplement).
  if (caps) {
    const chosen = chooseThreadCountFromCapacities(caps);
    if (chosen != null) {
      const source = androidFamilySource(caps, chosen);
      // G99-like family: prefill = all cores (measured: prefill wants bandwidth).
      const prefill =
        source === "family:android-small" && profile.cpuCoreCount != null
          ? profile.cpuCoreCount
          : chosen;
      return {
        n_threads: chosen,
        n_threads_prefill: prefill,
        nThreadsSource: source,
      };
    }
  }

  // Caller-supplied detectThreadCount result (production async wrapper).
  if (
    typeof input.resolvedThreads === "number" &&
    Number.isFinite(input.resolvedThreads) &&
    input.resolvedThreads > 0
  ) {
    const t = Math.floor(input.resolvedThreads);
    // Map threadProfile sources onto design §8 provenance set.
    const raw = (input.resolvedThreadsSource ?? "").trim();
    let source: string = "fallback";
    if (raw === "capacity") {
      source =
        t <= 2 ? "family:android-small" : t >= 4 ? "family:android-big" : "fallback";
    } else if (raw === "fallback:non-android" && isApplePlatform(profile, platformHint)) {
      source = "family:apple";
    } else if (raw.startsWith("fallback")) {
      source = "fallback";
    } else if (raw.length > 0) {
      // Unknown caller tag → still a non-empty provenance; clamp to fallback set.
      source = "fallback";
    }
    return {
      n_threads: t,
      n_threads_prefill: t,
      nThreadsSource: source,
    };
  }

  // 3. Unknown / emulator → conservative 4 (design §7.2).
  return {
    n_threads: FALLBACK_THREAD_COUNT,
    n_threads_prefill: FALLBACK_THREAD_COUNT,
    nThreadsSource: "fallback",
  };
}

/**
 * Memory-budgeted n_ctx (design §7.3).
 * n_ctx = clamp(requested, [2048, ctxFit]); unknown available → keep requested.
 * Reuses estimateMemory / fitMemoryEstimate (never reimplements arithmetic).
 */
function resolveContextBudget(
  model: TuningModelInfo,
  profile: TuningDeviceProfile,
  requestedIn: number | undefined,
  ubatch: number,
): {
  n_ctx: number;
  ctxSource: string;
  memory: TuningResult["memory"];
} {
  const catalog =
    typeof model.engineCtx === "number" && Number.isFinite(model.engineCtx)
      ? model.engineCtx
      : DEFAULT_N_CTX;
  let requested =
    typeof requestedIn === "number" && Number.isFinite(requestedIn) && requestedIn > 0
      ? Math.floor(requestedIn)
      : catalog;

  if (
    typeof model.contextLength === "number" &&
    Number.isFinite(model.contextLength) &&
    model.contextLength > 0
  ) {
    requested = Math.min(requested, Math.floor(model.contextLength));
  }

  // Floor applies to the final value; requested may be above floor.
  if (requested < CTX_FLOOR) {
    requested = CTX_FLOOR;
  }

  const kvBytesPerToken =
    typeof model.kvBytesPerToken === "number" &&
    Number.isFinite(model.kvBytesPerToken)
      ? model.kvBytesPerToken
      : 0;
  const fileBytes =
    typeof model.sizeBytes === "number" && Number.isFinite(model.sizeBytes)
      ? model.sizeBytes
      : 0;

  const availableMiB =
    typeof profile.availableMemoryBytes === "number" &&
    Number.isFinite(profile.availableMemoryBytes) &&
    profile.availableMemoryBytes > 0
      ? profile.availableMemoryBytes / MIB
      : null;

  const estimateAt = (ctx: number) =>
    estimateMemory({
      fileBytes,
      contextTokens: ctx,
      kvBytesPerToken,
      ubatch,
      repack: true,
    });

  const estRequested = estimateAt(requested);
  const fitRequested = fitMemoryEstimate(estRequested, availableMiB);

  if (availableMiB === null) {
    return {
      n_ctx: requested,
      ctxSource: "request",
      memory: {
        nonEvictableMiB: estRequested.nonEvictableMiB,
        availableMiB: null,
        fit: "unknown",
      },
    };
  }

  // Requested fits (or is only "tight") → keep it. Budget only shrinks when
  // non-evictable exceeds available (does_not_fit).
  if (fitRequested.status !== "does_not_fit") {
    return {
      n_ctx: requested,
      ctxSource: "request",
      memory: {
        nonEvictableMiB: estRequested.nonEvictableMiB,
        availableMiB,
        fit: fitRequested.status,
      },
    };
  }

  // Binary search largest ctx in [CTX_FLOOR, requested] with nonEvictable ≤ available.
  let lo = CTX_FLOOR;
  let hi = requested;
  let best = CTX_FLOOR;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const e = estimateAt(mid);
    if (e.nonEvictableMiB <= availableMiB) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  // Never below floor even if floor itself does not fit (conservative load attempt).
  const n_ctx = Math.max(CTX_FLOOR, best);
  const estFinal = estimateAt(n_ctx);
  const fitFinal = fitMemoryEstimate(estFinal, availableMiB);

  return {
    n_ctx,
    ctxSource: n_ctx === CTX_FLOOR && best < CTX_FLOOR ? "floor:2048" : "memory-budget",
    memory: {
      nonEvictableMiB: estFinal.nonEvictableMiB,
      availableMiB,
      fit: fitFinal.status,
    },
  };
}

/**
 * Thermal guard flag only (design §7.4). No behavior change — UI later.
 * Sets maxDecodeSeconds when 4B-class model + low available memory.
 */
function resolveThermal(
  model: TuningModelInfo,
  availableMiB: number | null,
): TuningResult["thermal"] {
  const is4bTier =
    typeof model.id === "string" &&
    (model.id.includes("4b") || model.id.includes("4B"));
  const lowMem =
    typeof availableMiB === "number" &&
    Number.isFinite(availableMiB) &&
    availableMiB > 0 &&
    availableMiB < 2048;
  if (is4bTier && lowMem) {
    // Flag only: 60s sustained decode was the measured thermal concern on 4B.
    return { maxDecodeSeconds: 60, guardSource: "measured:thermal-4b" };
  }
  return { guardSource: "none" };
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Pure synchronous resolver (design §7). Fully harness-testable: no I/O,
 * no detectThreadCount. Pass resolvedThreads when the capacity path was
 * already probed by the caller.
 */
export function resolveEngineTuningSync(input: TuningInput): TuningResult {
  const backend = resolveBackendPolicy(input.profile, input.platformHint);
  const threads = resolveThreadsSync(input);

  // ubatch: override > measured default 256 (lmkd guard).
  let n_ubatch = DEFAULT_UBATCH;
  let ubatchSource: string = "measured:ubatch-256";
  if (
    typeof input.request.ubatchOverride === "number" &&
    Number.isFinite(input.request.ubatchOverride) &&
    input.request.ubatchOverride > 0
  ) {
    n_ubatch = Math.floor(input.request.ubatchOverride);
    ubatchSource = "override:user";
  }

  // kv quant: constant q8_0/q4_0 on cpu-only (and everywhere until measured otherwise).
  // Catalog kvCache is authoritative when present; defaults match measured path.
  const type_k = input.model.kvCache?.k ?? "q8_0";
  const type_v = input.model.kvCache?.v ?? "q4_0";
  const kvSource = "measured:kv-defaults";

  const ctx = resolveContextBudget(
    input.model,
    input.profile,
    input.request.contextBudget,
    n_ubatch,
  );

  const thermal = resolveThermal(input.model, ctx.memory.availableMiB);

  return {
    n_threads: threads.n_threads,
    nThreadsSource: threads.nThreadsSource,
    n_threads_prefill: threads.n_threads_prefill,
    n_ubatch,
    ubatchSource,
    kv: { type_k, type_v },
    kvSource,
    context: { n_ctx: ctx.n_ctx, ctxSource: ctx.ctxSource },
    memory: ctx.memory,
    backend,
    thermal,
  };
}

/**
 * Async wrapper: probes detectThreadCount when threads are not overridden and
 * no SoC preset matches from supplied capacities. Production entry point for
 * LlamaService.
 */
export async function resolveEngineTuning(
  input: TuningInput,
): Promise<TuningResult> {
  // Fast path: override or preset or capacities already decide threads.
  const hasOverride =
    typeof input.request.threadsOverride === "number" &&
    Number.isFinite(input.request.threadsOverride) &&
    input.request.threadsOverride > 0;
  const caps =
    Array.isArray(input.cpuCapacities) && input.cpuCapacities.length > 0
      ? input.cpuCapacities
      : null;
  const preset = matchMeasuredPreset(input.profile, caps);

  if (
    hasOverride ||
    preset != null ||
    caps != null ||
    typeof input.resolvedThreads === "number"
  ) {
    return resolveEngineTuningSync(input);
  }

  // Probe device (Android capacity rule / iOS fallback 4).
  const resolvedThreads = await detectThreadCount();
  const resolvedThreadsSource = getThreadCountSource();
  return resolveEngineTuningSync({
    ...input,
    resolvedThreads,
    resolvedThreadsSource,
  });
}

/**
 * Map BackendPolicy → llama.rn n_gpu_layers (production guard).
 * metal → 99; everything else → 0 (Android cpu-only / emulator).
 */
export function nGpuLayersForBackend(backend: BackendPolicy): number {
  return backend.kind === "gpu-metal" ? 99 : 0;
}
