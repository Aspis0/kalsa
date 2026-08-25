/**
 * Weight-load policy for one model: mmap and repack, each a plain boolean.
 *
 * Precedence, explicit and enforced here plus at the initEngine call site:
 *
 *   expert streaming > bench levers > per-model policy > default
 *
 * - streaming is FIRST because it is a physical constraint, not a preference:
 *   when armed, native rebinds tensors to the file's byte layout and forces
 *   BOTH flags itself (native/bmoe/rn/bmoe_stream.cpp: no_extra_bufts=true,
 *   use_mmap=true), regardless of what JS sent. The resolver mirrors that
 *   outcome so its answer matches what the engine will actually do.
 * - bench levers outrank the policy IN BOTH DIRECTIONS: kalsa.bench.norepack=1
 *   forces repack off, =0 forces repack ON (absent → policy decides), and the
 *   bench:engine useMmap override wins over the policy either way. Without the
 *   "=0" arm, no bench could ever measure repack-on on the models whose policy
 *   disables it — exactly the A/B this change needs to be validated with.
 * - default: llama.cpp's own normal behaviour (common/common.h:574
 *   use_mmap = true): weights stay mapped on the GGUF file — page-cache backed,
 *   reclaimable by the kernel under pressure. This is the CORRECT
 *   configuration, not a compromise position.
 */

/** Two values, both required: no partial entries, nothing reserved "for later". */
export type LoadPolicy = {
  /** Map the weights from the GGUF file instead of reading them anonymous. */
  mmap: boolean;
  /** Keep the ARM weight-repack pass (a second anonymous buffer ≈ file size). */
  repack: boolean;
};

/** llama.cpp normal behaviour. A model without a registry entry gets this. */
export const DEFAULT_LOAD_POLICY: LoadPolicy = { mmap: true, repack: true };

export type LoadPolicyInput = {
  /** ModelInfo.loadPolicy — absent → default. */
  policy?: LoadPolicy;
  /** Expert streaming active for this load: forces both flags, as native does. */
  streamExperts: boolean;
  /**
   * kalsa.bench.norepack, tri-state: absent/undefined → policy decides;
   * true ("1") → no_extra_bufts; false ("0") → repack forced ON.
   */
  benchNoRepack?: boolean;
  /** bench:engine useMmap override: wins over the policy when present. */
  benchUseMmap?: boolean;
};

export type ResolvedLoad = {
  /** Value for ContextParams.use_mmap. */
  useMmap: boolean;
  /** Value for ContextParams.no_extra_bufts (= NOT repack). */
  noExtraBufts: boolean;
};

/**
 * Resolve the two engine flags for one load. Pure — no react-native, no
 * AsyncStorage — so the harness can load it.
 */
export function resolveLoadPolicy(input: LoadPolicyInput): ResolvedLoad {
  const policy = input.policy ?? DEFAULT_LOAD_POLICY;
  return {
    // Native forces mmap on under streaming; JS mirroring it keeps logs and
    // gates honest about the configuration that will really run.
    useMmap: input.streamExperts
      ? true
      : input.benchUseMmap !== undefined
        ? input.benchUseMmap
        : policy.mmap,
    // Streaming must win here too: a streamed layout cannot be repacked.
    noExtraBufts: input.streamExperts
      ? true
      : input.benchNoRepack === true
        ? true
        : input.benchNoRepack === false
          ? false
          : !policy.repack,
  };
}

/**
 * Gate-side resolution: what the engine would load with if streaming did NOT
 * happen (mmap / repack, positive forms for memoryEstimate). The streaming
 * decision belongs to the gate itself, which prices the resident alternative
 * with exactly these values — folding the streaming term here would make the
 * resident estimate describe a configuration the engine never loads.
 */
export function resolveGateLoadPolicy(input: {
  policy?: LoadPolicy;
  benchNoRepack?: boolean;
}): { mmap: boolean; repack: boolean } {
  const resolved = resolveLoadPolicy({
    policy: input.policy,
    streamExperts: false,
    benchNoRepack: input.benchNoRepack,
  });
  return { mmap: resolved.useMmap, repack: !resolved.noExtraBufts };
}
