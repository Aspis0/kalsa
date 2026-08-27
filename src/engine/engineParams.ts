/**
 * Pure application of bench-only engine overrides onto llama ContextParams.
 *
 * No react-native / llama.rn imports — loadable under plain Node for CI harness.
 * platformOS is passed in so the Android Hexagon/HTP GPU gate is testable.
 */

export type EngineOverrideFields = {
  nGpuLayers?: number;
  nThreads?: number;
  nUbatch?: number;
};

/** Minimal ContextParams slice the override touches. */
export type EngineParamsSlice = {
  n_gpu_layers?: number;
  n_threads?: number;
  n_ubatch?: number;
  n_batch?: number;
};

/**
 * Apply bench engineOverride onto params (mutates and returns params).
 * - nGpuLayers: skipped on Android (Hexagon NPU + FA-on-CPU init failure);
 *   warn and leave production n_gpu_layers untouched.
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

  if (override.nGpuLayers !== undefined) {
    // Mirror LlamaService production guard: Android must stay n_gpu_layers=0.
    if (platformOS === "android") {
      console.warn(
        "bench:engine nGpuLayers ignored on Android — Hexagon/HTP offload " +
          "with Flash Attention on CPU makes llama_init_from_model fail " +
          "(see n_gpu_layers HARD GUARD in LlamaService)",
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
