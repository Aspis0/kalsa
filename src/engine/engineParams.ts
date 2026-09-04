/**
 * Pure application of bench-only engine overrides onto llama ContextParams.
 *
 * No react-native / llama.rn imports — loadable under plain Node for CI harness.
 * platformOS is passed in so the Android Hexagon/HTP GPU gate is testable.
 */

/** llama.rn accepts exactly these three; "disabled"/"enabled" are silently ignored. */
export type FlashAttnMode = "auto" | "on" | "off";

type MoeStreamParams = {
  enabled?: boolean;
  cache_mb?: number;
  cache_auto?: boolean;
  cache_floor_mb?: number;
  cache_ceil_mb?: number;
  io_threads?: number;
  overlap?: boolean;
  dense_weights?: string;
  n_expert_used?: number;
  drop_cold_frac?: number;
  drop_no_renorm?: boolean;
};

export type EngineOverrideFields = {
  nGpuLayers?: number;
  nThreads?: number;
  nThreadsPrefill?: number;
  nUbatch?: number;
  flashAttn?: FlashAttnMode;
  moeStream?: MoeStreamParams;
  /**
   * Bench-only residency probe. false loads the weights into ANONYMOUS memory
   * instead of mapping the file, which is the only way an unprivileged Android
   * app can keep them off the reclaim path: RLIMIT_MEMLOCK on a retail S23 is
   * 64 MB soft AND hard (measured 2026-08-23), so `use_mlock` cannot hold a
   * multi-GB model and llama.cpp only warns when mlock fails — it would look
   * like a run rather than a refusal.
   */
  useMmap?: boolean;
};

/** Minimal ContextParams slice the override touches. */
export type EngineParamsSlice = {
  n_gpu_layers?: number;
  n_threads?: number;
  n_threads_batch?: number;
  n_ubatch?: number;
  n_batch?: number;
  flash_attn_type?: FlashAttnMode;
  use_mmap?: boolean;
  /** Forced to f16 when flash attention is off — see applyEngineOverride. */
  cache_type_v?: string;
  moe_stream?: MoeStreamParams;
};

/**
 * Apply bench engineOverride onto params (mutates and returns params).
 * - flashAttn: passthrough, every platform.
 * - nGpuLayers: on Android, only alongside `flashAttn: "off"` — see below.
 * - nThreads: passthrough.
 * - nThreadsPrefill: consumed by applyPrefillThreadOverride after this call.
 * - nUbatch: clamped to params.n_batch ?? 512.
 * - moeStream: forwarded only when explicitly present; production omits it.
 * - useMmap: same rule. Production now always sends use_mmap itself (resolved
 *   per-model load policy, loadPolicy.ts); this override is the bench arm that
 *   wins over that policy when present.
 * Absent fields leave params untouched. Empty/undefined override is a no-op.
 */
export function applyEngineOverride<T extends EngineParamsSlice>(
  params: T,
  override: EngineOverrideFields | undefined | null,
  platformOS: string,
): T {
  if (!override) return params;

  // Before the GPU gate: the gate's condition is this value.
  if (override.flashAttn !== undefined) {
    params.flash_attn_type = override.flashAttn;
    // MEASURED 2026-08-19, and it killed an arm before anyone noticed: llama
    // refuses a quantized V cache without flash attention —
    //   llama-context.cpp:3566
    //   "V cache quantization requires flash_attn" -> return nullptr
    // Every LLM in our catalogue ships v: "q4_0", so `flashAttn: "off"` alone
    // makes llama_init_from_model fail on ALL of them, with a message that
    // never reaches JS. The first offload arm read that as "GPU offload does
    // not initialise on this device"; the GPU was not involved at all.
    // Turning FA off therefore has exactly one valid spelling, and this is it.
    if (override.flashAttn === "off") {
      params.cache_type_v = "f16";
    }
  }

  if (override.nGpuLayers !== undefined) {
    // What was measured is narrower than what this used to block. The recorded
    // failure is Hexagon/HTP offload *with Flash Attention on CPU* — production
    // sends flash_attn_type "auto", so offload has never been tried with FA off.
    // Blocking that cell too made the one untested configuration unmeasurable,
    // in the bench as well as in production, since both share this path.
    // So: Android needs an explicit `flashAttn: "off"` in the SAME override.
    // Production sets no override, so it keeps whatever deviceTuning chose —
    // which is now GPU offload on Android, not 0. Ignoring the override here
    // therefore leaves production's value standing; it does not force CPU.
    if (platformOS === "android" && override.flashAttn !== "off") {
      console.warn(
        "bench:engine nGpuLayers ignored on Android — Hexagon/HTP offload " +
          "with Flash Attention on CPU makes llama_init_from_model fail. " +
          'Pass flashAttn:"off" in the same override to measure the untested cell.',
      );
    } else {
      params.n_gpu_layers = override.nGpuLayers;
    }
  }

  if (override.nThreads !== undefined) {
    params.n_threads = override.nThreads;
  }

  if (override.nUbatch !== undefined) {
    const batch = params.n_batch ?? 512;
    params.n_ubatch = Math.min(override.nUbatch, batch);
  }

  if (override.moeStream !== undefined) {
    params.moe_stream = override.moeStream;
  }

  // Only when explicitly present: an absent field must not clobber the
  // per-model policy resolution already written into params by initEngine.
  if (override.useMmap !== undefined) {
    params.use_mmap = override.useMmap;
  }

  return params;
}

/** Set batch threads only when the final decode and prefill counts differ. */
export function applyPrefillThreadOverride<T extends EngineParamsSlice>(
  params: T,
  nThreadsPrefill: number | undefined,
): T {
  const prefillDiffers =
    typeof nThreadsPrefill === "number" &&
    Number.isSafeInteger(nThreadsPrefill) &&
    nThreadsPrefill > 0 &&
    nThreadsPrefill !== params.n_threads;
  if (prefillDiffers) {
    params.n_threads_batch = nThreadsPrefill;
  }
  return params;
}
