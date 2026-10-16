/**
 * KALSA_GOVERNOR_LOAD: what one governor load built, read from the init
 * result's `governorLoad` (llama.rn GovernorLoadFacts). Published once per
 * load, beside the load line, because these facts otherwise reach logcat and
 * the native JSI only — an uploaded report could see that a turn ran on the
 * NPU but never why the load had the legs it had.
 *
 * Keys are short for the same reason as the per-turn lines (normalize.ts clips
 * at 300 chars). Values: numbers, booleans and the binding's own closed
 * literal sets. `soc` is the matched legs-table row's SoC model — a bounded
 * model string, never a serial, an Android id or a user string.
 */
/**
 * What one load published about the governor (llama.rn `GovernorLoadFacts`,
 * built in cpp/rn-governor-params.cpp governor_load_json). Structural on
 * purpose, not imported: the installed package's index.d.ts does not re-export
 * the type yet — the same reason GovernorObservationStats is an extension of
 * the shipped GovernorStats. The JSI bridge answers the fields regardless.
 */
export type GovernorLoadFacts = {
  one_copy: boolean;
  npu_leg: boolean;
  gpu_leg: boolean;
  cpu_leg: boolean;
  prefill_thermal_handoff: boolean;
  soc: string | null;
  cache_type_k: string | null;
  cache_type_v: string | null;
  kv_reason: string | null;
  hop_tokens: number;
  zones_cpu: number;
  zones_npu: number;
  zones_gpu: number;
};

/** A load that never ran the governor has no facts; the line is not emitted. */
export function governorLoadLogLine(facts: GovernorLoadFacts): string {
  return `KALSA_GOVERNOR_LOAD ${JSON.stringify({
    npu: facts.npu_leg,
    gpu: facts.gpu_leg,
    cpu: facts.cpu_leg,
    one: facts.one_copy,
    soc: facts.soc,
    ck: facts.cache_type_k,
    cv: facts.cache_type_v,
    kvr: facts.kv_reason,
    hop: facts.hop_tokens,
    zcpu: facts.zones_cpu,
    znpu: facts.zones_npu,
    zgpu: facts.zones_gpu,
    th: facts.prefill_thermal_handoff,
  })}`;
}

/**
 * Emit the load line once, right after the load it describes. `facts` is
 * whatever `context.governorLoad` answered — null on a non-governor load, and
 * absent on a binding older than the field. Never throws into the load path.
 */
export function logGovernorLoad(facts: GovernorLoadFacts | null | undefined): void {
  if (!facts) return;
  try {
    console.log(governorLoadLogLine(facts));
  } catch {
    // telemetry must never throw into the engine path
  }
}