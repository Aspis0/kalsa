/**
 * The per-turn governor report lines: KALSA_GOVERNOR_TURN (where the turn ran
 * and why) and KALSA_GOVERNOR_COST (what the KV commit and the decode hop
 * cost, plus the fallback verdict). They carry the facts the uploaded report
 * could not see until now, because the wide KALSA_GOVERNOR logcat line they
 * mirror is not in the report's tag allow-list.
 *
 * Two lines, not one: normalize.ts clips every accepted line at 300 chars and
 * the full field set does not fit that with its worst-case values (see
 * schemaGovernorTurn.test.ts, which pins both budgets against a real payload).
 *
 * Short keys because of that clip; long names here would move the answer, not
 * the meaning. Every value is a number, a boolean or a code-defined literal —
 * no prose, no paths, no device names beyond the backend device that ran a
 * prefill chunk.
 */
import { prefillDevices } from "./governorObservation";

/**
 * One decimal of headroom, at emit. The native stat arrives as a f32 sum, so
 * 41.3 comes back as 41.30000305175781 and every log line spells the noise out
 * — for a value whose whole scale is tenths of a degree.
 *
 * Only a number is touched: null stays the explicit absence it is, an absent
 * field stays absent (no key is invented for it), and a non-finite sample stays
 * non-finite, because Math.round carries it through and a broken reading is not
 * noise to tidy.
 */
function headroomC(value: unknown): unknown {
  if (typeof value !== "number") return value;
  return Math.round(value * 10) / 10;
}

/**
 * Why this turn ran without the governor, as the report reads it. A closed
 * enum, because the app's own reason is one of its two literals and the
 * native refusal is prose — see governorFallbackCodeFromNative, which names
 * the native classes it recognizes and sends everything else to "other".
 */
export const GOVERNOR_FALLBACK_CODES = [
  "none",
  "not_eligible",
  "thermo_invalid",
  "native_unsupported",
  "native_unnamed",
  "other",
  /** The governor failed mid-turn and the engine reloaded CPU-only
   *  (KALSA_GOVERNOR_RUNTIME_FALLBACK, reloadGovernorRuntimeFallback). */
  "runtime",
] as const;

export type GovernorFallbackCode = (typeof GOVERNOR_FALLBACK_CODES)[number];

/** The app's two eligibility literals, shared with LlamaService so the reason
 *  it decides and the code the report carries cannot drift apart. */
export const GOVERNOR_NOT_ELIGIBLE_REASON = "governor not eligible";
export const GOVERNOR_THERMO_INVALID_REASON = "governor: thermo profile invalid";

/** The native message classes the code can name. Both are the binding's own
 *  sentences: the thermo ones at cpp/rn-llama.cpp:775,1545 and
 *  cpp/jsi/RNLlamaJSI.cpp:276,902,1438, the unsupported ones at
 *  cpp/rn-llama.cpp:1548-1565,2007 and RNLlamaJSI.cpp:911,939. */
const NATIVE_THERMO_MESSAGE = /thermo/i;
const NATIVE_UNSUPPORTED_MESSAGE = /does not support|supports sequence|not enabled/i;

/**
 * The code for a native load refusal, from the message `initWithGovernorFallback`
 * caught. No message means the retry happened with nothing to say — the
 * `?? "native governor fallback"` arm at LlamaService's retry site. Anything
 * that matches none of the named classes is "other": the prose stays on the
 * wide logcat line, and guessing a class for it would be a lie in a report.
 */
export function governorFallbackCodeFromNative(
  message: string | null | undefined,
): GovernorFallbackCode {
  if (!message) return "native_unnamed";
  if (NATIVE_THERMO_MESSAGE.test(message)) return "thermo_invalid";
  if (NATIVE_UNSUPPORTED_MESSAGE.test(message)) return "native_unsupported";
  return "other";
}

/**
 * The stats fields the two lines read, as `getGovernorStats` emits them.
 * Structural on purpose (same pattern as governorObservation.ts): the builder
 * must load under plain node with no native module present.
 */
export type GovernorTurnStats = {
  engine_prefill?: unknown;
  engine_decode?: unknown;
  prefill_router_rule?: unknown;
  prefill_thermal_handoff?: unknown;
  prefill_npu_headroom_c?: unknown;
  prefill_gpu_headroom_c?: unknown;
  commit_bytes?: unknown;
  commit_ms?: unknown;
  decode_hop_commit_bytes?: unknown;
  decode_hops?: unknown;
  decode_tokens_cpu?: unknown;
  decode_tokens_gpu?: unknown;
  decode_tokens_npu?: unknown;
  cache_type_k?: unknown;
  cache_type_v?: unknown;
  prefill_kv?: unknown;
  npu_device?: unknown;
  npu_fallback?: unknown;
  thermal_state?: unknown;
  failure_reason?: unknown;
  prefill_chunks?: unknown;
};

/** The CUMULATIVE decode counters this line reports as a per-turn delta. */
type DecodeCounters = {
  dhb: number;
  hops: number;
  tok: [number, number, number];
};

export type GovernorTurnPayloads = {
  turn: Record<string, unknown>;
  cost: Record<string, unknown>;
};

/**
 * How many prefill chunks this turn executed, from the binding's
 * `prefill_chunks` accumulator (llama-governor.cpp:284-289): a `+`-joined run
 * of per-chunk token counts, with "cpu:" prepended to the FIRST token only on
 * a CPU route — one cell per chunk, prefix and all. Null when the accumulator
 * is absent, empty, or not the run the engine writes: a turn that never
 * prefilled is an absence, not a count of zero.
 */
export function prefillChunkCount(prefillChunks: unknown): number | null {
  if (typeof prefillChunks !== "string" || prefillChunks === "") return null;
  const cells = prefillChunks.split("+").map((cell, index) =>
    index === 0 ? cell.replace(/^cpu:/, "") : cell,
  );
  return cells.every((cell) => /^\d+$/.test(cell)) ? cells.length : null;
}

/**
 * The counters this line deltas against the previous one. Reset by
 * `resetGovernorTurnCost` — which `resetObservationBaseline` calls, so every
 * path that already restarts the observation row's own baseline restarts this
 * one with it and no call site can forget.
 */
let prevCounters: DecodeCounters | null = null;

/** A turn was skipped or went unread, so the next line cannot delta. */
let gapPending = false;

/** The engine's decode counters restart from zero; this baseline follows. */
export function resetGovernorTurnCost(): void {
  prevCounters = null;
  gapPending = false;
}

/**
 * A turn's telemetry did not run. The NEXT line reports gap:1 with no deltas
 * rather than a delta spanning two turns, and re-baselines from its own
 * counters.
 */
export function markGovernorTurnGap(): void {
  gapPending = true;
}

function readCounters(stats: GovernorTurnStats): DecodeCounters | null {
  const num = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const dhb = num(stats.decode_hop_commit_bytes);
  const hops = num(stats.decode_hops);
  const tok: [number | null, number | null, number | null] = [
    num(stats.decode_tokens_cpu),
    num(stats.decode_tokens_gpu),
    num(stats.decode_tokens_npu),
  ];
  if (dhb === null || hops === null || tok.some((cell) => cell === null)) return null;
  return { dhb, hops, tok: tok as [number, number, number] };
}

/**
 * The two report payloads.
 *
 * `dhb`, `tok` and `hops` are the cost THIS turn added: the binding's decode
 * counters are cumulative since the last cache clear (LlamaService's wide-line
 * comment), so reporting them raw would make every turn after the first look
 * like the sum of all of them.
 *
 * What the line says about them, and why:
 * - first:1 — first line after a load or a clear. There is nothing to delta
 *   against, so the numbers ARE the counters.
 * - gap:1 — a turn was skipped or went unread, or a counter went backwards (the
 *   detectable symptom of a reset nobody announced). The numbers would describe
 *   no single turn, so they are omitted rather than reported as a negative or
 *   as a sum. This line becomes the next baseline.
 * - otherwise — the delta against the previous line.
 *
 * `cb`/`cm` are NOT delta'd: they are the commit this turn's prefill paid,
 * not a running total, and the observation row carries no commit either.
 *
 * Absent and non-finite values stay absent (JSON drops them) and the schema
 * drops anything else, so one bad field never costs the line. `tok` rides the
 * same [cpu, gpu, npu] leg order as the observation row's `tok`.
 */
export function governorTurnPayloads(args: {
  stats: GovernorTurnStats;
  forced: boolean;
  fallbackCode: GovernorFallbackCode;
  routeChunks: unknown;
}): GovernorTurnPayloads {
  const { stats } = args;
  const now = readCounters(stats);
  const before = prevCounters;
  // A counter that went backwards is the symptom of an engine-side reset this
  // module was not told about; defence in depth under resetGovernorTurnCost.
  const regressed =
    now !== null &&
    before !== null &&
    (now.dhb < before.dhb ||
      now.hops < before.hops ||
      now.tok.some((cell, i) => cell < before.tok[i]));
  const gap = gapPending || regressed;
  const first = now !== null && before === null && !gap;
  if (now !== null) {
    prevCounters = now;
    gapPending = false;
    // A line that read NO counters leaves the baseline and the pending gap
    // exactly as they were: it reported nothing, so it must not also clear the
    // record that a turn went unread.
  }

  const delta = (current: number, prev: number | undefined): number =>
    prev === undefined ? current : current - prev;
  const cost =
    now === null || gap
      ? null
      : {
          dhb: delta(now.dhb, before?.dhb),
          tok: [
            delta(now.tok[0], before?.tok[0]),
            delta(now.tok[1], before?.tok[1]),
            delta(now.tok[2], before?.tok[2]),
          ],
          hops: delta(now.hops, before?.hops),
        };

  return {
    turn: {
      ep: stats.engine_prefill,
      ed: stats.engine_decode,
      rr: stats.prefill_router_rule,
      th: stats.prefill_thermal_handoff,
      hn: headroomC(stats.prefill_npu_headroom_c),
      hg: headroomC(stats.prefill_gpu_headroom_c),
      npu: stats.npu_device,
      npuf: stats.npu_fallback,
      ck: stats.cache_type_k,
      cv: stats.cache_type_v,
      kv: stats.prefill_kv,
      chunks: prefillChunkCount(stats.prefill_chunks),
      dev: prefillDevices(args.routeChunks),
      therm: stats.thermal_state,
      forced: args.forced,
    },
    cost: {
      cb: stats.commit_bytes,
      cm: stats.commit_ms,
      dhb: cost?.dhb ?? null,
      tok: cost?.tok ?? null,
      hops: cost?.hops ?? null,
      ...(now === null ? {} : { first: first ? 1 : 0, gap: gap ? 1 : 0 }),
      failed: Boolean(stats.failure_reason),
      fr: args.fallbackCode,
    },
  };
}

/** The two lines, in emission order. */
export function governorTurnLogLines(payloads: GovernorTurnPayloads): [string, string] {
  return [
    `KALSA_GOVERNOR_TURN ${JSON.stringify(payloads.turn)}`,
    `KALSA_GOVERNOR_COST ${JSON.stringify(payloads.cost)}`,
  ];
}