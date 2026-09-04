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

import { estimateModelNonEvictableMiB } from "./deviceProfile";
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
  // RAM estimate includes optional mmproj (vision bundle), matching the callers.
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);

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
  const load = resolveGateLoadPolicy({
    policy: model.loadPolicy,
    benchNoRepack,
  });
  return estimateModelNonEvictableMiB({
    sizeBytes: bundleBytes,
    contextTokens,
    kvBytesPerToken: model.kvBytesPerToken,
    repack: load.repack,
    mmap: load.mmap,
  });
}
