/**
 * Whether a model must stream its routed experts in order to load at all.
 *
 * The decision belongs to the gate, not to a setting. Streaming reads experts
 * from the file per token instead of holding them resident, which forces
 * `no_extra_bufts` and so removes exactly the repack term the gate refuses on.
 * That makes it a response to a measured condition: HARNESS_FINDINGS §7.48 ran
 * a remedy of this shape on two phones and measured **6.6x on the one without
 * headroom and 1.006x on the one with it**. Offering it as a switch would ask a
 * person to predict `MemAvailable`, and shipping it unconditionally would pay
 * its cost on every phone that never needed it.
 *
 * Deliberately NOT a general "make it faster" path: this returns true only when
 * the model does not fit resident AND does fit streamed. A model that fits
 * either way keeps its resident weights; a model that fits neither way is still
 * refused, honestly, rather than started in a configuration that cannot help.
 *
 * The two sides are not symmetric: the resident test is an ESTIMATE over
 * weights + KV priced with the model's RESOLVED load policy (what the engine
 * would actually hold if it loaded resident — repack off stays off, mmap-off
 * weights count as anonymous), while the streamed test is one phone
 * MEASUREMENT of RssAnon. They cross at different memory points, and both must
 * hold — which is exactly why the streamed footprint is never taken from an
 * estimate.
 *
 * Pure module — no react-native, no AsyncStorage — so the harness can load it.
 */

import { estimateModelNonEvictableMiB } from "./deviceProfile";
import { resolveGateLoadPolicy, type LoadPolicy } from "./loadPolicy";

/** Phone-measured streamed footprint. Absent or ctx-mismatched → never stream. */
export type StreamingResident = {
  bytes: number;
  measuredAtContextTokens: number;
};

export type ExpertStreamingInput = {
  /** ModelInfo.canStreamExperts — absent/false on every dense model. */
  canStreamExperts?: boolean;
  /** Bundle bytes (main GGUF + mmproj), as the gate counts them. */
  sizeBytes: number;
  /** Resolved load context, not the catalog default. */
  contextTokens: number;
  kvBytesPerToken?: number | null;
  /** Live MemAvailable. Null/unusable → no decision, see below. */
  availableMemoryBytes: number | null;
  /**
   * ModelInfo.streamingResident — measured peak RssAnon when the model runs
   * with expert streaming at measuredAtContextTokens. Priced as-is; never
   * scaled. Absent or a context mismatch → never stream.
   */
  streamingResident?: StreamingResident;
  /** Per-model weight-load policy (ModelRegistry.loadPolicy). Absent → default. */
  loadPolicy?: LoadPolicy;
  /** kalsa.bench.norepack tri-state; absent → policy decides. */
  benchNoRepack?: boolean;
};

/**
 * True only when streaming is what makes the model loadable.
 *
 * The two sides of the test are not symmetric by design, and that asymmetry is
 * the whole point. The resident side is an ESTIMATE (repack:true over repacked
 * weights + KV); the streamed side is one phone MEASUREMENT of peak RssAnon.
 * They cross at different memory points, and BOTH must hold: resident must not
 * fit AND the measured streaming footprint must fit. Pricing the streamed side
 * from an estimate (repack:false) is exactly the wrong-by-11× trap it avoids —
 * that figure excludes all weights and says "fits" when it does not, so the
 * streamed footprint is always taken from a measured constant.
 *
 * Unknown memory or an absent/invalid streamingResident returns FALSE, not
 * true: without a probe we cannot show that resident loading fails, and a
 * missing measurement means there is nothing to price against. A measurement
 * taken at a different n_ctx is the same as missing — the number includes KV.
 * Turning streaming on "just in case" would pay per-token file reads on a
 * phone that may have had room all along. Absence of a measurement is not
 * permission.
 */
export function shouldStreamExperts(input: ExpertStreamingInput): boolean {
  if (input.canStreamExperts !== true) return false;

  const availableBytes = input.availableMemoryBytes;
  if (
    typeof availableBytes !== "number" ||
    !Number.isFinite(availableBytes) ||
    availableBytes <= 0
  ) {
    return false;
  }
  const availableMiB = availableBytes / (1024 * 1024);

  // MEASUREMENT, not an estimate. Absent, NaN, non-positive, infinite, or
  // taken at a different n_ctx → "does not fit". Nothing honest to scale by
  // when kvBytesPerToken is missing, so a mismatch is a refusal.
  const measured = input.streamingResident;
  const streamedBytes = measured?.bytes;
  if (
    measured == null ||
    measured.measuredAtContextTokens !== input.contextTokens ||
    typeof streamedBytes !== "number" ||
    !Number.isFinite(streamedBytes) ||
    streamedBytes <= 0
  ) {
    return false;
  }
  const streamedMiB = streamedBytes / (1024 * 1024);

  // Resident side is an ESTIMATE, priced with the resolved load policy (the
  // config the engine would actually load resident). A null estimate is bad
  // input, not a green light.
  const gatePolicy = resolveGateLoadPolicy({
    policy: input.loadPolicy,
    benchNoRepack: input.benchNoRepack,
  });
  const resident = estimateModelNonEvictableMiB({
    sizeBytes: input.sizeBytes,
    contextTokens: input.contextTokens,
    kvBytesPerToken: input.kvBytesPerToken,
    repack: gatePolicy.repack,
    mmap: gatePolicy.mmap,
  });
  if (typeof resident !== "number") return false;

  // Resident must NOT fit, streamed (measured) MUST fit. The two sides are not
  // symmetric by design: resident is an estimate over policy-priced weights +
  // KV, streamed is one phone measurement of RssAnon. They cross at different
  // memory points, and both must hold for streaming to be offered.
  return resident > availableMiB && streamedMiB <= availableMiB;
}
