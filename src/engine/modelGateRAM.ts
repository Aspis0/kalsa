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
import { resolveGateContextTokens, type TuningDeviceProfile, type TuningModelInfo } from "./deviceTuning";
import { modelAtKvProfile } from "./kvQuantCost";

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
  /** bench:engine useMmap; same load mode the engine will honour. */
  benchUseMmap?: boolean;
}): MemoryEstimate | null {
  // RAM estimate includes optional mmproj (vision bundle), matching the callers.
  const bundleBytes = input.model.sizeBytes + (input.model.mmproj?.sizeBytes ?? 0);
  if (!Number.isFinite(bundleBytes) || bundleBytes <= 0) return null;
  const load = resolveGateLoadPolicy({
    policy: input.model.loadPolicy,
    benchNoRepack: input.benchNoRepack,
    benchUseMmap: input.benchUseMmap,
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
  benchUseMmap?: boolean;
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

/** Fields the option resolvers read from a model: gate fields + tuning fields. */
type GateOptionModel = ModelGateRAMModel &
  Pick<TuningModelInfo, "id" | "engineCtx" | "contextLength">;

/**
 * Resolve a candidate's context through the load budget, then price the model
 * at the context it lands on. ONE implementation, so a context-size row and a
 * cache-quality row cannot price the same request differently.
 *
 * A null profile (device not probed yet) has nothing to resolve against: the
 * candidate is priced as asked and the fit comes back "unknown".
 */
function resolveAndPriceOption(input: {
  model: GateOptionModel;
  profile: TuningDeviceProfile | null;
  requestedContextTokens: number;
  availableMemoryBytes: number | null;
  benchNoRepack?: boolean;
  benchUseMmap?: boolean;
}): {
  contextTokens: number;
  nonEvictableMiB: number | null;
  status: MemoryFitVerdict["status"];
} {
  const contextTokens = input.profile
    ? resolveGateContextTokens({
        model: input.model,
        profile: input.profile,
        requestedContextTokens: input.requestedContextTokens,
        benchNoRepack: input.benchNoRepack,
        benchUseMmap: input.benchUseMmap,
      })
    : input.requestedContextTokens;
  return {
    ...gateOptionFit({
      model: input.model,
      contextTokens,
      availableMemoryBytes: input.availableMemoryBytes,
      benchNoRepack: input.benchNoRepack,
      benchUseMmap: input.benchUseMmap,
    }),
    contextTokens,
  };
}

/**
 * Fit for ONE cache-quality candidate, priced at the context THAT candidate
 * would itself resolve to — not at the context another profile resolved to.
 *
 * The larger cache can force the next downgrade. Pricing a q8_0 V row at the
 * smaller q4_0 cache's context under-reports both its bytes and the window it
 * costs, which is exactly how a row can look fine and still shrink the chat.
 * Both numbers come from the resolvers the load itself uses.
 */
export function gateCacheOptionFit(input: {
  model: GateOptionModel;
  /** The cache profile this option would load. */
  choice: { k: string; v: string };
  profile: TuningDeviceProfile | null;
  /** The context the user asked for (bench ?? user ?? catalog). */
  requestedContextTokens: number;
  availableMemoryBytes: number | null;
  benchNoRepack?: boolean;
  benchUseMmap?: boolean;
}): {
  nonEvictableMiB: number | null;
  status: MemoryFitVerdict["status"];
  /** The context this candidate resolves to; never above the request. */
  contextTokens: number;
} {
  return resolveAndPriceOption({
    ...input,
    model: modelAtKvProfile(input.model, input.choice.k, input.choice.v),
  });
}

/**
 * Fit for ONE context-size candidate, resolved the way the load resolves it:
 * the candidate goes through the same budget and what gets priced is the
 * context that comes out of it, not the candidate itself.
 *
 * A context size DEGRADES rather than blocks. A phone that cannot hold 100k
 * still runs at the largest size it can hold, so blocking the row would take
 * the choice away instead of honouring it. The row is unselectable only when
 * even the effective floor cannot load — a genuine no-load, where there is no
 * smaller context to fall back to.
 */
export function gateContextOptionFit(input: {
  model: GateOptionModel;
  /** The size the user is considering. */
  requestedContextTokens: number;
  profile: TuningDeviceProfile | null;
  availableMemoryBytes: number | null;
  benchNoRepack?: boolean;
  benchUseMmap?: boolean;
}): {
  /** The context this candidate would actually load at (≤ the candidate). */
  contextTokens: number;
  nonEvictableMiB: number | null;
  status: MemoryFitVerdict["status"];
  /** False only when even the effective floor cannot load. */
  selectable: boolean;
  /** The resolved size when the budget cut it below the candidate, else null. */
  downgradesTo: number | null;
} {
  const resolved = resolveAndPriceOption(input);
  return {
    ...resolved,
    selectable: resolved.status !== "does_not_fit",
    downgradesTo:
      resolved.contextTokens < input.requestedContextTokens
        ? resolved.contextTokens
        : null,
  };
}

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
