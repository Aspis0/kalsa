/**
 * What the model gate should charge a model for, in MiB of anonymous resident
 * memory. ONE responsibility shared by every site that builds a ModelGateVerdict,
 * so the RAM axis cannot drift between them (as diskRequirementBytes keeps
 * confirm/start/Settings from drifting on the disk axis).
 *
 * Returns the MEASURED streamed resident footprint when expert streaming is the
 * loaded configuration, else the policy-priced resident estimate. The two sides
 * are not symmetric by design (see expertStreaming.ts): the streamed figure is
 * one phone measurement of RssAnon, the resident figure an estimate over the
 * RESOLVED per-model load policy + KV. Pricing either side from constants is
 * exactly the wrong-by-11× trap this helper avoids — it always prices from a
 * measured constant, or from what the engine would actually load.
 *
 * Returns null only when the underlying estimator cannot price the model (bad
 * input), matching estimateModelNonEvictableMiB's contract.
 */

import { estimateMemory, fitMemoryEstimate, type MemoryEstimate, type MemoryFitVerdict } from "./memoryEstimate";
import { shouldStreamExperts } from "./expertStreaming";
import { resolveGateLoadPolicy } from "./loadPolicy";

/** Fields of ModelInfo the RAM gate actually reads — nothing more. */
export type ModelGateRAMModel = Pick<
  import("./ModelRegistry").ModelInfo,
  "sizeBytes" | "canStreamExperts" | "streamingResident" | "loadPolicy"
> & {
  kvBytesPerToken?: number | null;
  mmproj?: import("./ModelRegistry").ModelInfo["mmproj"];
};

/** Same inputs the gate prices with — the load path must call this, not a copy. */
export function shouldStreamModel(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  availableMemoryBytes: number | null;
  /** kalsa.bench.norepack tri-state; absent → the model's loadPolicy decides. */
  benchNoRepack?: boolean;
}): boolean {
  const bundleBytes = input.model.sizeBytes + (input.model.mmproj?.sizeBytes ?? 0);
  return shouldStreamExperts({
    canStreamExperts: input.model.canStreamExperts,
    sizeBytes: bundleBytes,
    contextTokens: input.contextTokens,
    kvBytesPerToken: input.model.kvBytesPerToken,
    availableMemoryBytes: input.availableMemoryBytes,
    streamingResident: input.model.streamingResident,
    loadPolicy: input.model.loadPolicy,
    benchNoRepack: input.benchNoRepack,
  });
}

/**
 * The gate's own resident estimate for a model at `contextTokens`: weights at
 * the resolved load policy + compute + KV, priced at this model's
 * kvBytesPerToken (rescale it first when the loading cache profile is not the
 * catalog's). Shared by the two functions below so the MiB a caller is shown
 * and the verdict it is handed come from the SAME numbers, not two estimates.
 * Null when the bundle cannot be priced (bad size input).
 */
export function estimateGateLoad(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  benchNoRepack?: boolean;
}): MemoryEstimate | null {
  // RAM estimate includes optional mmproj (vision bundle), matching the callers.
  const bundleBytes = input.model.sizeBytes + (input.model.mmproj?.sizeBytes ?? 0);
  if (!Number.isFinite(bundleBytes) || bundleBytes <= 0) return null;
  const load = resolveGateLoadPolicy({
    policy: input.model.loadPolicy,
    benchNoRepack: input.benchNoRepack,
  });
  return estimateMemory({
    fileBytes: bundleBytes,
    contextTokens: input.contextTokens,
    kvBytesPerToken: input.model.kvBytesPerToken ?? 0,
    ubatch: 256,
    repack: load.repack,
    mmap: load.mmap,
  });
}

/**
 * RAM cost and fit verdict for ONE option (a context size, a cache quality),
 * both read off a single estimate. `status` is fitMemoryEstimate's own verdict,
 * four-way: `tight` (foreground may live, background kill likely) is not
 * collapsed into a boolean, and `unknown` means the device could not be judged
 * — the caller shows the option with no verdict.
 */
export function gateOptionFit(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  availableMemoryBytes: number | null;
  benchNoRepack?: boolean;
}): { nonEvictableMiB: number | null; status: MemoryFitVerdict["status"] } {
  const estimate = estimateGateLoad(input);
  if (!estimate) return { nonEvictableMiB: null, status: "unknown" };
  const availableMiB =
    typeof input.availableMemoryBytes === "number" &&
    Number.isFinite(input.availableMemoryBytes) &&
    input.availableMemoryBytes > 0
      ? input.availableMemoryBytes / (1024 * 1024)
      : null;
  return {
    nonEvictableMiB: estimate.nonEvictableMiB,
    status: fitMemoryEstimate(estimate, availableMiB).status,
  };
}

/**
 * How an option's fit verdict may be presented. ONE place states the policy:
 * `does_not_fit` blocks the option, `tight` stays selectable with a warning
 * (the foreground may live while a backgrounded app is killed), and `unknown`
 * shows the option with no verdict — the behaviour an unreadable MemAvailable
 * has always had.
 */
export type OptionAvailability = "selectable" | "tight" | "blocked" | "unknown";

export function optionAvailability(
  status: MemoryFitVerdict["status"],
): OptionAvailability {
  if (status === "does_not_fit") return "blocked";
  if (status === "tight") return "tight";
  if (status === "unknown") return "unknown";
  return "selectable";
}

export function gateNonEvictableMiB(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  availableMemoryBytes: number | null;
  /**
   * kalsa.bench.norepack tri-state; absent → the model's loadPolicy decides.
   * The resident fallback is priced with the SAME resolved mode, so the stream
   * decision and the non-stream estimate cannot disagree about what a resident
   * load would weigh.
   */
  benchNoRepack?: boolean;
}): number | null {
  const { model, contextTokens, availableMemoryBytes, benchNoRepack } = input;

  const streamDecision = shouldStreamModel({
    model,
    contextTokens,
    availableMemoryBytes,
    benchNoRepack,
  });

  // Streamed footprint is a phone measurement (bytes → MiB); otherwise the
  // policy-priced resident estimate.
  if (streamDecision && typeof model.streamingResident?.bytes === "number") {
    return model.streamingResident.bytes / (1024 * 1024);
  }
  return estimateGateLoad({ model, contextTokens, benchNoRepack })?.nonEvictableMiB ?? null;
}
