/**
 * Pure application of bench-only engine overrides onto llama ContextParams.
 *
 * No react-native / llama.rn imports — loadable under plain Node for CI harness.
 * platformOS is passed in so the Android Hexagon/HTP GPU gate is testable.
 */

/** llama.rn accepts exactly these three; "disabled"/"enabled" are silently ignored. */
export type FlashAttnMode = "auto" | "on" | "off";

export type EngineOverrideFields = {
  nGpuLayers?: number;
  nThreads?: number;
  nUbatch?: number;
  flashAttn?: FlashAttnMode;
};

/** Minimal ContextParams slice the override touches. */
export type EngineParamsSlice = {
  n_gpu_layers?: number;
  n_threads?: number;
  n_ubatch?: number;
  n_batch?: number;
  flash_attn_type?: FlashAttnMode;
};

/**
 * Apply bench engineOverride onto params (mutates and returns params).
 * - flashAttn: passthrough, every platform.
 * - nGpuLayers: on Android, only alongside `flashAttn: "off"` — see below.
 * - nThreads: passthrough.
 * - nUbatch: clamped to params.n_batch ?? 512.
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
  }

  if (override.nGpuLayers !== undefined) {
    // What was measured is narrower than what this used to block. The recorded
    // failure is Hexagon/HTP offload *with Flash Attention on CPU* — production
    // sends flash_attn_type "auto", so offload has never been tried with FA off.
    // Blocking that cell too made the one untested configuration unmeasurable,
    // in the bench as well as in production, since both share this path.
    // So: Android needs an explicit `flashAttn: "off"` in the SAME override.
    // Production sets no override at all and stays n_gpu_layers=0 either way.
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

  return params;
}
