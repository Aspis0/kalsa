/**
 * What the model gate should charge a model for, in MiB of anonymous resident
 * memory. ONE responsibility shared by every site that builds a ModelGateVerdict,
 * so the RAM axis cannot drift between them (as diskRequirementBytes keeps
 * confirm/start/Settings from drifting on the disk axis).
 *
 * Returns the MEASURED streamed resident footprint when expert streaming is the
 * loaded configuration, else the repack estimate. The two sides are not
 * symmetric by design (see expertStreaming.ts): the streamed figure is one phone
 * measurement of RssAnon, the resident figure an estimate over repacked weights
 * + KV. Pricing the streamed side from an estimate (repack:false) is exactly the
 * wrong-by-11× trap this helper avoids — it always prices from a measured
 * constant, or declines to stream.
 *
 * Returns null only when the underlying estimator cannot price the model (bad
 * input), matching estimateModelNonEvictableMiB's contract.
 */

import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { shouldStreamExperts } from "./expertStreaming";

/** Fields of ModelInfo the RAM gate actually reads — nothing more. */
export type ModelGateRAMModel = Pick<
  import("./ModelRegistry").ModelInfo,
  "sizeBytes" | "canStreamExperts" | "streamingResident"
> & {
  kvBytesPerToken?: number | null;
  mmproj?: import("./ModelRegistry").ModelInfo["mmproj"];
};

/** Same inputs the gate prices with — the load path must call this, not a copy. */
export function shouldStreamModel(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  availableMemoryBytes: number | null;
}): boolean {
  const bundleBytes = input.model.sizeBytes + (input.model.mmproj?.sizeBytes ?? 0);
  return shouldStreamExperts({
    canStreamExperts: input.model.canStreamExperts,
    sizeBytes: bundleBytes,
    contextTokens: input.contextTokens,
    kvBytesPerToken: input.model.kvBytesPerToken,
    availableMemoryBytes: input.availableMemoryBytes,
    streamingResident: input.model.streamingResident,
  });
}

export function gateNonEvictableMiB(input: {
  model: ModelGateRAMModel;
  contextTokens: number;
  availableMemoryBytes: number | null;
  /** Load mode the engine will actually use. False only under kalsa.bench.norepack. */
  repack?: boolean;
}): number | null {
  const { model, contextTokens, availableMemoryBytes, repack = true } = input;
  // RAM estimate includes optional mmproj (vision bundle), matching the callers.
  const bundleBytes = model.sizeBytes + (model.mmproj?.sizeBytes ?? 0);

  const streamDecision = shouldStreamModel({
    model,
    contextTokens,
    availableMemoryBytes,
  });

  // Streamed footprint is a phone measurement (bytes → MiB); otherwise the
  // repack estimate. `repack` stays the bench norepack knob.
  return streamDecision && typeof model.streamingResident?.bytes === "number"
    ? model.streamingResident.bytes / (1024 * 1024)
    : estimateModelNonEvictableMiB({
        sizeBytes: bundleBytes,
        contextTokens,
        kvBytesPerToken: model.kvBytesPerToken,
        repack,
      });
}
