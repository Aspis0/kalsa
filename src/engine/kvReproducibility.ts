/**
 * Pure KV-reproducibility state machine.
 *
 * The native llama.cpp KV can only warm-start a restart when it matches what
 * re-rendering the persisted conversation would produce. Content that enters
 * the engine but is stripped (or never written) from history makes the live KV
 * non-reproducible. A tool turn is a narrow exception: the previous good
 * prefix remains a safe restore point, while the live KV must not be written.
 *
 * The invariant that a tool turn's final emit must remain marked as a last-
 * exchange divergence lives HERE: `clean_completion` does not erase the
 * marker while `turnInjected` is true. LlamaService drives this machine; it
 * must not re-implement the guard.
 *
 * Think spans / literal `<tool_call>` markup are the same class of divergence
 * but are intentionally not detected here (documented in LlamaService).
 */

/**
 * Reproducibility plus per-turn injection tracking. `divergesAtLastExchange`
 * is deliberately separate from `reproducible`: it permits the app layer to
 * preserve the already-good prefix, but never permits saving the live tool KV.
 */
export type KvReproState = {
  reproducible: boolean;
  /** True once this turn pushed non-persisted content (tool_calls) into KV. */
  turnInjected: boolean;
  /** True only when the current non-reproducibility is the latest tool turn. */
  divergesAtLastExchange: boolean;
};

export const INITIAL_KV_REPRO_STATE: KvReproState = {
  reproducible: true,
  turnInjected: false,
  divergesAtLastExchange: false,
};

/**
 * Events:
 * - turn_start: clear turnInjected; retain the last-exchange marker until a
 *   clean completion re-renders the divergent suffix. A second tool turn
 *   without a clean turn in between reopens cold.
 * - tool_calls_detected: mark the live KV non-reproducible at the last exchange
 * - miniapp_stripped: reproducible=false (does not set turnInjected —
 *   strip happens after stream ends, outside the completion path)
 * - clean_completion: reproducible=true and clear the marker ONLY if
 *   !turnInjected
 * - dispose: full reset to initial
 */
export type KvReproEvent =
  | "turn_start"
  | "tool_calls_detected"
  | "miniapp_stripped"
  | "clean_completion"
  | "dispose";

export function nextKvReproState(state: KvReproState, event: KvReproEvent): KvReproState {
  switch (event) {
    case "turn_start":
      return {
        reproducible: state.reproducible,
        turnInjected: false,
        divergesAtLastExchange: state.divergesAtLastExchange,
      };
    case "tool_calls_detected":
      return {
        reproducible: false,
        turnInjected: true,
        divergesAtLastExchange: state.turnInjected || state.reproducible,
      };
    case "miniapp_stripped":
      return {
        reproducible: false,
        turnInjected: state.turnInjected,
        divergesAtLastExchange: false,
      };
    case "clean_completion":
      if (state.turnInjected) {
        return state;
      }
      return {
        reproducible: true,
        turnInjected: false,
        divergesAtLastExchange: false,
      };
    case "dispose":
      return { ...INITIAL_KV_REPRO_STATE };
    default:
      return state;
  }
}

/**
 * True when parseMiniappFromText found (and stripped) a miniapp block.
 * Gate for callers: only fire miniapp_stripped when something was stripped.
 */
export function miniappStripMakesKvNonReproducible(miniappFound: boolean): boolean {
  return miniappFound === true;
}
