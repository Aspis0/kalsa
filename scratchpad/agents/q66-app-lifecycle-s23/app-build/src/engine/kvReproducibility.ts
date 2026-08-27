/**
 * Pure KV-reproducibility state machine.
 *
 * The native llama.cpp KV can only warm-start a restart when it matches what
 * re-rendering the persisted conversation would produce. Content that enters
 * the engine but is stripped (or never written) from history makes the session
 * non-restorable — skip save so the previous good .kvs survives
 * (shouldSaveSession → reason `kv_not_reproducible`).
 *
 * The invariant that a tool turn's final emit must NOT re-enable save lives
 * HERE: `clean_completion` only sets `reproducible` when `turnInjected` is
 * false. LlamaService drives this machine; it must not re-implement the guard.
 *
 * Think spans / literal `<tool_call>` markup are the same class of divergence
 * but are intentionally not detected here (documented in LlamaService).
 */

/**
 * Sticky across turns (`reproducible`), plus per-turn injection tracking
 * (`turnInjected`) so clean_completion after tool_calls_detected stays false.
 */
export type KvReproState = {
  reproducible: boolean;
  /** True once this turn pushed non-persisted content (tool_calls) into KV. */
  turnInjected: boolean;
};

export const INITIAL_KV_REPRO_STATE: KvReproState = {
  reproducible: true,
  turnInjected: false,
};

/**
 * Events:
 * - turn_start: clear turnInjected; leave reproducible (stickiness)
 * - tool_calls_detected: reproducible=false, turnInjected=true
 * - miniapp_stripped: reproducible=false (does not set turnInjected —
 *   strip happens after stream ends, outside the completion path)
 * - clean_completion: reproducible=true ONLY if !turnInjected
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
      return { reproducible: state.reproducible, turnInjected: false };
    case "tool_calls_detected":
      return { reproducible: false, turnInjected: true };
    case "miniapp_stripped":
      return { reproducible: false, turnInjected: state.turnInjected };
    case "clean_completion":
      if (state.turnInjected) {
        return state;
      }
      return { reproducible: true, turnInjected: false };
    case "dispose":
      return { reproducible: true, turnInjected: false };
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
