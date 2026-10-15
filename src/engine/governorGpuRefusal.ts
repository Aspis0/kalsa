/**
 * Whether this load runs without the GPU because the governor could not fit it
 * in memory — the one slow-load reason the person can act on.
 *
 * `fit` and `attempted` are the governor's own load-scoped latch: a `NoFit`
 * fit with the governor eligible never takes the governor, which is what leaves
 * an Android load on the `n_gpu_layers = 0` path. So the pair is the whole
 * question, and the platform is asked because iOS prices the same lanes and
 * runs Metal: a `NoFit` there cost nothing and must not claim it did.
 *
 * Lives beside the governor's inputs and not in `LlamaService.ts` so the rule
 * is testable without the native engine, and so the fit work has one owner.
 */
export function gpuRefusedForMemory(input: {
  platformOs: string;
  fit: "Fit" | "NoFit" | "Unknown" | null;
  attempted: boolean;
}): boolean {
  return input.platformOs === "android" && input.attempted && input.fit === "NoFit";
}