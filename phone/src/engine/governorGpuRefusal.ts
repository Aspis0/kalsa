/**
 * Whether this load runs without the GPU because the governor could not fit it
 * in memory — the one slow-load reason the person can act on.
 *
 * `fit` and `attempted` are the governor's own load-scoped latch: a `NoFit`
 * fit with the governor eligible never takes the governor, which is what leaves
 * an Android load on the `n_gpu_layers = 0` path. A lane-only load is the one
 * exception: the NPU fit carried it, so `laneOnly` clears the refusal. The
 * platform is asked because iOS prices the same lanes and
 * runs Metal: a `NoFit` there cost nothing and must not claim it did.
 *
 * A `NoFit` is also the verdict when there was nothing to measure against, so
 * `measured` is asked too: the line names a cause, and only a fit that had the
 * numbers has one.
 *
 * Lives beside the governor's inputs and not in `LlamaService.ts` so the rule
 * is testable without the native engine, and so the fit work has one owner.
 */
export function gpuRefusedForMemory(input: {
  platformOs: string;
  fit: "Fit" | "NoFit" | "Unknown" | null;
  attempted: boolean;
  /** The fit had both numbers to compare: a free-memory sample and a KV price
   *  for this model. Without either, its `NoFit` means "not proven to fit" —
   *  the same verdict an unknown memory gets — and a line saying the memory is
   *  low would be reporting a measurement nobody took. */
  measured: boolean;
  /** The governor ran lane-only: prefill is on the NPU, not slow, so a GPU
   *  NoFit names no cause the person can act on. */
  laneOnly: boolean;
}): boolean {
  return (
    input.platformOs === "android" &&
    input.attempted &&
    input.measured &&
    input.fit === "NoFit" &&
    !input.laneOnly
  );
}

/** Did the native load resolve the NPU lane, as the engine reports it
 *  (getGovernorStats: npu_device "HTP0", no npu_fallback)? A failed or absent
 *  read is not a resolved lane: the caller then keeps the memory line. */
export function npuLaneResolved(
  stats: { npu_device?: string | null; npu_fallback?: string | null } | null,
): boolean {
  return stats?.npu_device === "HTP0" && !stats.npu_fallback;
}