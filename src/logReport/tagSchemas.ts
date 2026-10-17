/**
 * The per-tag allow-list for the "Send the log" report: for each accepted
 * KALSA_* tag, which fields exist and which VALUE KIND each accepts. Unknown
 * tags and unknown fields fail closed; a field of the wrong kind, or a string
 * outside its closed literal set, is dropped (never the whole line — the
 * remaining validated fields still count the event).
 *
 * Privacy boundary (owner sentence): no messages, no answers, no files, no
 * code or key. Only finite numbers, booleans, code-defined enum literals and
 * catalog model ids pass. Every closed set quotes the code that emits it.
 */

import { GOVERNOR_FALLBACK_CODES } from "../engine/governorTurnLog";
import { KV_CACHE_TYPES } from "../engine/kvCacheProfile";

export type FieldRule =
  | { k: "num"; nullable?: true }
  | { k: "bool"; nullable?: true }
  | { k: "enum"; values: readonly string[]; nullable?: true }
  /** A monotonic turn counter (`mintTurnId`, LlamaService.ts:546-548) — never a conversation id. */
  | { k: "counter" }
  /** A bounded identifier prefix; full ids are never collected. */
  | { k: "safeId8"; nullable?: true }
  /** A catalog model id; the accepted set is installed at startup. */
  | { k: "modelId" }
  /** A finite number, or a depth-1 object of them under exactly these keys —
   *  any other key drops the whole field. */
  | { k: "numObj"; keys: readonly string[] }
  /** A fixed-length array of finite numbers or nulls (Stage 0 observation
   *  cells, governorObservation.ts): every row defines the exact cell count,
   *  and a wrong length or a non-number cell drops the whole field. */
  | { k: "numArray"; len: number }
  /** A depth-1 object of bounded identifier strings under exactly these keys
   *  (Stage 0 fingerprint: model id, SoC id, binding pin). */
  | { k: "idObj"; keys: readonly string[]; maxLen: number }
  /** A bounded-length array of bounded identifier strings (Stage 0 prefill
   *  devices). The length is a ceiling, not an exact count: the array holds
   *  the DISTINCT devices of the turn, so it is short by construction. A
   *  non-string or over-long cell drops the whole field. Nullable because the
   *  row always carries the key and null means "no device named" — an
   *  explicit absence, not a missing field. */
  | { k: "strArray"; maxLen: number; maxItems: number; nullable?: true }
  /** A bounded-length array drawn from a CLOSED set of literals — the turn
   *  line's distinct prefill devices, where an unknown backend name drops the
   *  whole field rather than riding as free text. */
  | { k: "enumArray"; values: readonly string[]; maxItems: number; nullable?: true };

type TagSchema = Record<string, FieldRule>;

const NUM: FieldRule = { k: "num" };
const NUMN: FieldRule = { k: "num", nullable: true };
const BOOL: FieldRule = { k: "bool" };
const BOOLN: FieldRule = { k: "bool", nullable: true };
const enumOf = (...values: string[]): FieldRule => ({ k: "enum", values });
const enumOrNull = (...values: string[]): FieldRule => ({
  k: "enum",
  values,
  nullable: true,
});
/** The same, over an exported closed set the schema must not restate. */
const enumSetOrNull = (values: readonly string[]): FieldRule => ({
  k: "enum",
  values,
  nullable: true,
});

const PAUSE_REASONS = enumOf("thermal", "profile", "reload", "unexplained");

/** Cache ggml type names a governor context runs with: the app's own closed
 *  set, plus nothing else the lane can produce — decide_governor_lane_kv only
 *  ever keeps an F32/F16/Q8_0 request or rewrites it to q8_0 (llama.rn
 *  cpp/rn-llama.cpp:113-137). */
const GOVERNOR_KV_TYPES = KV_CACHE_TYPES;

/**
 * ggml backend device names a governor prefill chunk can report as its layer
 * device (`layers_device`, llama-governor.cpp:23-30 → ggml_backend_dev_name).
 * The binding names the three itself at llama-ext.h:518-520 ("HTP0",
 * "GPUOpenCL", "CPU"); the Hexagon backend builds the rest as "HTP"+<index>
 * (ggml-hexagon.cpp:10145). Anything else — a new backend, a colon-separated
 * multi-HTP alias — is NOT in the set and fails closed.
 */
const LAYER_DEVICES = ["CPU", "GPUOpenCL", "HTP0", "HTP1", "HTP2", "HTP3"] as const;

/**
 * Every code-defined `reason` a KALSA_SESSION line carries. NOT in the set,
 * by design: the `meta_mismatch:<field>` / `tokens_loaded:0` composites
 * (chatKvSessionLoad.ts:105-215) build their suffix from a meta field name, and
 * `sessionErrorReason`'s `error:<Name>` class (chatKvSessionShared.ts) from a
 * JS error name — both open-ended, so both fail closed. `diskReason` is a
 * different field and rides with `reason: "disk"`.
 */
const SESSION_REASONS = [
  // shouldSaveSession gate (sessionPersistence.ts:872-890)
  "no_context",
  "kv_poisoned",
  "disposing",
  "kv_not_chat",
  "kv_not_reproducible",
  // save/load protocol (chatKvSessionSave.ts, chatKvSessionLoad.ts, chatKvSessionNative.ts)
  "no_session_key",
  "session_identity_unavailable",
  "kv_prefix_unavailable", // chatKvSessionSave.ts:139, op "mark_prefix"
  "no_file",
  "no_meta",
  "last_exchange_prefix",
  "unchanged",
  "native_shorter_than_npast",
  "meta_write",
  "evicted",
  "disk",
  "load_error",
  // the native refusals (sessionPersistence.ts:806-821)
  "governor_mode",
  "kv_inconsistent",
  // prewarm (LlamaService.ts:1661)
  "n_predict_rejected",
  // evict run (sessionEvictMarker.ts:26-30)
  "evict_failed",
  "over_budget_unevictable",
  "deficit_uncoverable",
  "invalid_budget",
  "gate_unreadable",
] as const;

/** Tool names: src/agent/toolNames.ts:13 plus the clamp placeholder (toolCallTelemetry.ts:43). */
const TOOL_NAME_VALUES = [
  "web_search",
  "web_fetch",
  "document_chat",
  "write_note",
  "device_info",
  "device_calc",
  "calendar_agenda",
  "create_miniapp",
  "other",
] as const;

const TOOL_NAMES = enumOf(...TOOL_NAME_VALUES);

export const TAG_SCHEMAS: Record<string, TagSchema> = {
  // LlamaService.ts:2436 via buildGovernorPlanLog (governorInputs.ts:228-243).
  KALSA_GOVERNOR_PLAN: {
    gpu_fit: enumOf("Fit", "NoFit"),
    decode_repack: BOOL,
    required_mib_with_repack: NUM,
    required_mib_without_repack: NUM,
    available_mib: NUM,
    bench_norepack_forced: BOOLN,
    npu_device: enumOrNull("HTP0"), // governorInputs.ts:338 — null with the lane off
    npu_fallback: enumOrNull(), // governorInputs.ts:339 — always null today
    npu_lane: enumOf("off", "on", "auto"), // BenchNpuLanePref, governorInputs.ts:18
    npu_fit: enumOrNull("Fit", "NoFit"), // governorInputs.ts:264 — null when the lane was not priced
    available_src: enumOrNull("fresh", "cached", "none"), // governorInputs.ts:265
    // decode_pacing_headroom_start/_full as computed; null without a declared row.
    pacing_start: NUMN, // governorInputs.ts buildGovernorPlanLog
    pacing_full: NUMN, // governorInputs.ts buildGovernorPlanLog
    npu_price: enumOf("lane_only", "with_gpu"), // governorInputs.ts buildGovernorPlanLog
    gpu_leg: BOOL, // governorInputs.ts buildGovernorPlanLog — false on a lane-only load
  },
  // LlamaService.ts:2456; reason is governorBase.reason (governorInputs.ts,
  // `gpu-prefill-incorrect-<Generation>`, Generation in governorInputs.ts).
  KALSA_GOVERNOR_FALLBACK: {
    stage: enumOf("correctness"),
    reason: enumOf(
      "gpu-prefill-incorrect-V73",
      "gpu-prefill-incorrect-V75",
      "gpu-prefill-incorrect-V79",
      "gpu-prefill-incorrect-V81",
      "gpu-prefill-incorrect-Unknown",
    ),
    forced: BOOL,
  },
  // governorTurnLog.ts: the per-turn governor report, split in two because the
  // full field set does not fit normalize.ts's 300-char clip. TURN answers
  // "which device ran this prefill and what decided it"; COST answers "what the
  // KV commit and the decode hop paid, and did the governor bail".
  KALSA_GOVERNOR_TURN: {
    // Engine names: RNLlamaJSI.cpp governorEngineName (CPU, GPU and the
    // GPU_COOLMODE decode state both read "GPU").
    ep: enumOf("Unknown", "CPU", "GPU", "NPU"),
    ed: enumOf("Unknown", "CPU", "GPU", "NPU"),
    rr: NUM, // prefill_router_rule; the engine's list, llama-governor-policy.cpp:517-554
    th: BOOL, // prefill_thermal_handoff (the arming that makes rule 10 possible)
    hn: NUMN, // prefill_npu_headroom_c — null when no sample placed the route
    hg: NUMN, // prefill_gpu_headroom_c
    // npu_device is the governor's PREFILL device, which the binding types as
    // "HTP0" | "GPU" (llama.rn types.ts GovernorStats.npu_device) — "GPU" is
    // what the two-model load publishes when the lane is off.
    npu: enumOrNull("HTP0", "GPU"),
    // llama-governor-device.cpp:31 and cpp/rn-governor-params.h:161.
    npuf: enumOrNull("htp-device-missing", "htp-runtime-error"),
    ck: enumSetOrNull(GOVERNOR_KV_TYPES),
    cv: enumSetOrNull(GOVERNOR_KV_TYPES),
    kv: enumOrNull("host", "device"), // cpp/rn-llama.cpp setGovernorKvCache
    // Chunks of the binding's prefill_chunks accumulator. Nullable, like
    // `dev`: the accumulator is empty when no chunk ran, which is a fact about
    // this turn, not a missing field.
    chunks: NUMN,
    // The distinct layer devices that ran this turn's prefill chunks, drawn
    // from the names the binding names at llama-ext.h:518-520 and builds as
    // "HTP"+<index> (ggml-hexagon.cpp:10145) or "CPU"/"GPUOpenCL". Capped at
    // four: the governor loads list devices {HTP0, GPUOpenCL} (llama-ext.h:196)
    // so three distinct names is the real ceiling, and the cap bounds the line.
    dev: { k: "enumArray", values: LAYER_DEVICES, maxItems: 4, nullable: true },
    therm: enumOf(
      "Unknown",
      "FAST",
      "WARM",
      "COOLMODE",
      "CRITICAL",
      "LOWBAT",
      "Invalid", // llama.rn RNLlamaJSI.cpp:58-66
    ),
    forced: BOOL,
  },
  // governorTurnLog.ts. `dhb`, `tok` and `hops` are the cost THIS turn added,
  // not the engine's cumulative counters (the observation row deltas the same
  // way); `first`/`gap` are its honesty flags. `fr` is the code, not the reason
  // prose: the wide logcat line still carries that verbatim.
  KALSA_GOVERNOR_COST: {
    cb: NUM, // commit_bytes — this turn's prefill→decode commit
    cm: NUM, // commit_ms
    dhb: NUM, // decode_hop_commit_bytes, delta
    tok: { k: "numArray", len: 3 }, // decode tokens per leg, delta
    hops: NUM, // decode_hops, delta
    first: NUM, // 1 = first line after a load/clear: the numbers are cumulative
    gap: NUM, // 1 = the counters describe no single turn (regressed, or a turn was skipped)
    failed: BOOL,
    fr: { k: "enum", values: GOVERNOR_FALLBACK_CODES },
  },
  // governorLoadLog.ts from the init result's governorLoad (llama.rn
  // GovernorLoadFacts); one line per governor load. The legs and the zone
  // counts are what a postmortem needs when a turn's numbers look wrong.
  KALSA_GOVERNOR_LOAD: {
    npu: BOOL,
    gpu: BOOL,
    cpu: BOOL,
    one: BOOL, // one_copy
    // The matched legs-table row's SoC model ("SM8550"), a bounded model
    // string — safeId8, so a future row's longer name drops rather than rides.
    // Nullable because null is the load's own "no row matched", which is the
    // fact that explains a two-model load with one_copy false.
    soc: { k: "safeId8", nullable: true },
    ck: enumSetOrNull(GOVERNOR_KV_TYPES),
    cv: enumSetOrNull(GOVERNOR_KV_TYPES),
    // cpp/rn-llama.cpp setGovernorKvCache / the two lane-kv branches.
    kvr: enumOrNull("htp-prefill-kv", "flash-attn-off"),
    hop: NUM, // hop_tokens
    zcpu: NUM,
    znpu: NUM,
    zgpu: NUM,
    th: BOOL, // prefill_thermal_handoff armed at this load
  },
  // LlamaService.ts:1821. `reason` (stats.failure_reason) is DROPPED: native
  // free prose (llama.rn rn-governor.cpp:47-58 builds it from error strings).
  KALSA_GOVERNOR_FAILED: {
    thermal_state: enumOf(
      "Unknown",
      "FAST",
      "WARM",
      "COOLMODE",
      "CRITICAL",
      "LOWBAT",
      "Invalid", // llama.rn RNLlamaJSI.cpp:57-65
    ),
  },
  // LlamaService.ts:2875. `reason` is DROPPED: a sanitized slice of a native
  // error message, "not semantically filtered" (governorRuntime.ts:56).
  KALSA_GOVERNOR_RUNTIME_FALLBACK: {
    turnId: { k: "counter" },
    attempt: NUM,
  },
  // governorPauseLog.ts:19-24; GovernorPauseReason at thermalResume.ts:23;
  // UtilityPauseSite at governorPauseLog.ts:17.
  KALSA_GOVERNOR_PAUSE: {
    turnId: { k: "counter" },
    round: NUM,
    site: enumOf("extractMemory", "translate", "completeOnce"),
    reason: PAUSE_REASONS,
  },
  // governorObservation.ts via LlamaService (Stage 0 row minus the win ring,
  // which only the on-phone observations.jsonl carries). Labels are the
  // engine's closed sets: thermal_state llama.rn RNLlamaJSI.cpp:57-65,
  // state_source llama.rn types.ts, decode_hop_rule llama-governor-policy-hop.cpp:219-269.
  KALSA_GOVERNOR_COMPLETION: {
    t: { k: "counter" },
    round: NUM,
    attempt: NUM,
    gap: NUM,
    first_row: NUM,
    fp: { k: "idObj", keys: ["model", "soc", "pin"], maxLen: 64 },
    state: enumOf("Unknown", "FAST", "WARM", "COOLMODE", "CRITICAL", "LOWBAT", "Invalid"),
    src: enumOf("battery", "platform"),
    status: NUM,
    batt: NUM,
    level: NUM,
    plugged: NUM,
    prompt_n: NUMN,
    pred_n: NUMN,
    pred_ms: NUMN,
    pps: NUMN,
    // Prefill attribution (governorObservation.ts): the route label the engine
    // chose, this completion's prefill ms, and the distinct layer devices that
    // actually ran it. The first quotes RNLlamaJSI.cpp:48-56 (governorEngineName)
    // and the per-completion reset at llama-governor-runtime.cpp:295-312.
    engine_prefill: enumOrNull("Unknown", "CPU", "GPU", "NPU"),
    prefill_ms: NUMN,
    // Distinct devices in chunk order. maxLen 31 is the binding's
    // char layers_device[32], NUL-terminated; 8 is far above the real
    // distinct count (a turn runs on a device per chunk, and a turn has a
    // handful of chunks).
    prefill_dev: { k: "strArray", maxLen: 31, maxItems: 8, nullable: true },
    wall: { k: "numArray", len: 2 },
    first: { k: "numArray", len: 13 },
    bsys: { k: "numArray", len: 4 },
    hl: NUMN,
    duty: NUM,
    paced: { k: "numArray", len: 2 },
    tok: { k: "numArray", len: 3 },
    us: { k: "numArray", len: 3 },
    hops: NUM,
    rule: enumOrNull("alternation", "headroom", "heat_rank", "gpu_burst"),
    trips: { k: "numArray", len: 6 },
    win_ovf: NUM,
    dropped: NUMN,
  },
  // The binding's one-time battery sysfs probe (rn-governor.cpp, 0/1 flags
  // and -1-coded values as logged).
  KALSA_GOVERNOR_BATTERY_SYSFS: {
    temp_ok: NUM,
    temp_tenths_c: NUM,
    status_ok: NUM,
    status: NUM,
  },
  // governorLearned.ts: the learned store's own numbers, after each row it
  // absorbs. Numbers only — Build.FINGERPRINT and the store key stay out, so
  // no identifier is collected. tps_* are tok/s per leg (EWMA), prefill_tps_*
  // the tok/s of the device that ran the prompt, heat_* the learned ucb in
  // skin C per 1k tokens and heat_bg in C per minute.
  KALSA_GOVERNOR_LEARNED: {
    tps_cpu: NUM,
    tps_gpu: NUM,
    tps_npu: NUM,
    prefill_tps_cpu: NUMN,
    prefill_tps_gpu: NUMN,
    prefill_tps_npu: NUMN,
    heat_cpu: NUMN,
    heat_gpu: NUMN,
    heat_npu: NUMN,
    heat_bg: NUMN,
    heat_sigma: NUM,
    heat_rows: NUM,
    heat_rejects: NUM,
    breaker: NUM,
    breaker_hold_ms: NUMN,
  },
  // governorPauseLog.ts:44-58; CoolingEndReason at thermalResume.ts:84-92
  // (absent on enter); battTempTenthsC nullable at thermalResume.ts:102.
  KALSA_THERMAL_COOLING: {
    turnId: { k: "counter" },
    round: NUM,
    phase: enumOf("enter", "exit"),
    waitedMs: NUM,
    generationMs: NUM,
    batt_temp_tenths_c: NUMN,
    outcome: enumOf("resumed", "stopped", "timeout", "failed"),
  },
  // LlamaService.ts:4338 and :4392; StallReason at stallWatchdog.ts:20, the
  // "prefill" literal at LlamaService.ts:4396; tokPerSec nullable on prefill.
  KALSA_STALL: {
    gapMs: NUM,
    tokens: NUM,
    turnId: { k: "counter" },
    reason: enumOf("gap", "rate", "prefill"),
    tokPerSec: NUMN,
  },
  // foregroundIdle.ts:249-252.
  KALSA_IDLE_STALL: {
    idleMs: NUM,
    tokenSilenceMs: NUMN,
  },
  // iosBackgroundGuard.ts — one line per iOS background suspend action.
  KALSA_IOS_BG: {
    op: enumOf("abort", "reload"),
  },
  // iosMemoryGuard.ts — one line per iOS memory warning. `reason` rides on the
  // skip ops only (iosMemoryWarningPlan.ts: IosMemoryWarningSkipReason).
  KALSA_IOS_MEM: {
    op: enumOf("release", "deferred", "skip"),
    reason: enumOrNull("platform", "remote", "no-engine"),
  },
  // engineLoad.ts:160-167; verdict sets at loadGate.ts:105-115; the only
  // caller passes source "ensure" (engineEnsureLoad.ts:98).
  KALSA_LOAD: {
    phase: enumOf("fitGate"),
    modelId: { k: "modelId" },
    refusedBy: enumOf("fit", "marker", "disposeTimeout"),
    reasonKey: enumOrNull("model.tooLarge", "model.tightNow"),
    disposedResident: BOOL,
    source: enumOf("ensure"),
  },
  // LlamaService.ts:2717-2720; FlashAttnMode at engineParams.ts:9.
  KALSA_GPU_FALLBACK: {
    requestedGpuLayers: NUM,
    flashAttn: enumOf("auto", "on", "off"),
  },
  // LlamaService.ts:2665-2674. androidLib is the loaded .so name; the loader
  // only ever assigns these (llama.rn RNLlama.java:225-283) or "" (line 225).
  KALSA_NATIVE_VARIANT: {
    androidLib: enumOrNull(
      "",
      "rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl",
      "rnllama_jni_v8_2_dotprod_i8mm",
      "rnllama_jni_v8_2_dotprod",
      "rnllama_jni_v8_2_i8mm",
      "rnllama_jni_v8_2",
      "rnllama_jni_v8",
      "rnllama_jni_x86_64",
      "rnllama_jni",
    ),
    nGpuLayers: { k: "numObj", keys: ["prefill", "decode"] }, // number, or {prefill, decode} (LlamaService.ts:2669-2673)
  },
  // logPrewarm sites LlamaService.ts:855-1574, :4633 and useHostEngine.ts:142.
  // DROPPED fields: hash / prewarm / send (prefix hashes, LlamaService.ts:1091,
  // :1112, :1278, :4639-4640) and err (native error text, :1365, :4654, :4665).
  KALSA_PREWARM: {
    op: enumOf("start", "skip", "done", "restore", "snapshot_save"),
    match: BOOL, // LlamaService.ts:4638
    reason: enumOf(
      // literals at LlamaService.ts:1055-1591 and :4635-4665
      "facts_in_system",
      "background",
      "not_ready",
      "kv_holds_chat",
      "given_up",
      "in_flight",
      "already_warm",
      "stale",
      "no_context",
      "disposing",
      "platform_severe", // prefixPrewarm.ts:561
      "interrupted",
      "generated",
      "paused",
      "eval-failed",
      "system_only_template",
      "n_predict_rejected",
      "empty_prompt",
      "fail",
      "prefix_miss",
      // foregroundPrewarm.ts:36-55
      "thermal_gate",
      "no_model",
      "model_changed",
      "poisoned",
      // snapshot restore/save outcomes, staticPrefixSnapshot.ts:126-179, :204-320
      // (the composites meta_mismatch:<field> and tokens_loaded:0 do not pass)
      "no_session_key",
      "no_file",
      "no_meta",
      "aborted",
      "load_error",
      "disk",
      "native_shorter_than_prefix",
      "meta_write",
      "gone_after_write",
      "save_error",
    ),
    ok: BOOL,
    deleted: BOOL, // LlamaService.ts:1291
    tokens: NUM,
    promptMs: NUM,
    promptN: NUM,
    tokensEvaluated: NUM,
    tokensCached: NUM,
    systemChars: NUM,
    toolCount: NUM,
    pause: PAUSE_REASONS, // LlamaService.ts:1349
  },
  // turnTelemetry.ts:226-235; strategy set at turnTelemetry.ts:42-49; tool is
  // the model's function name clamped to KNOWN_TOOL_NAMES (toolCallTelemetry.ts:87-91).
  KALSA_TELEMETRY: {
    turnId: { k: "counter" },
    attempt: NUM,
    round: NUM,
    tokensCached: NUM,
    tokensEvaluated: NUM,
    tokensPredicted: NUM,
    draftTokens: NUM,
    draftAccepted: NUM,
    promptMs: NUM,
    predictedMs: NUM,
    predictedPerSecond: NUM,
    contextFull: BOOL,
    interrupted: BOOL,
    truncated: BOOL,
    tool: TOOL_NAMES,
    strategy: enumOf(
      "hybrid",
      "bm25_only",
      "full_context",
      "vision_fallback",
      "retrieve",
      "error",
    ),
    prompt_n: NUM,
    ciswireFlags: NUM,
  },
  // toolCallTelemetry.ts:100-117 per round; toolChoice is CompletionToolChoice
  // (benchConfig.ts:91 — the union is the whole set), fallbackDialect is the
  // ToolRoundTelemetry literal. DROPPED: `tool`/`argsRaw` if ever added — a
  // name is only safe through the clamped set, and arguments never pass.
  // `toolNames` is the clamped list the round EXECUTED: at most the per-round
  // slice (LlamaService.ts prepared.slice(0, 2)); 4 is a ceiling above that
  // real bound, so raising the slice does not silently drop the whole field.
  KALSA_TOOLCALL: {
    turnId: { k: "counter" },
    round: NUM,
    toolChoice: enumOf("auto", "required", "none"),
    structuredCalls: NUM,
    fallbackCalls: NUM,
    fallbackDialect: enumOf("qwen", "lfm", "openai", "none"),
    executed: NUM,
    skippedCap: NUM,
    skippedDup: NUM,
    skippedFailedRepeat: NUM,
    failed: NUM,
    blockedPrivacy: NUM,
    namesValid: BOOL,
    argsParsed: BOOL,
    toolNames: { k: "enumArray", values: TOOL_NAME_VALUES, maxItems: 4 },
  },
  // toolCallTelemetry.ts:64-84. `rawLen` / `sawThink` / `sawToolMarkup` say
  // why a fallback produced no answer without its text: a non-zero rawLen with
  // sawThink and no sawToolMarkup is the reasoning-only round.
  KALSA_TOOLROUND_EXHAUSTED: {
    turnId: { k: "counter" },
    roundsUsed: NUM,
    streamedLen: NUM,
    fallbackFired: BOOL,
    fallbackOk: BOOL,
    rawLen: NUM,
    sawThink: BOOL,
    sawToolMarkup: BOOL,
  },
  // LlamaService.ts tool-round ceiling break: the projected window at the
  // moment it crossed n_ctx. Counts and char lengths only.
  KALSA_TOOL_CEILING: {
    turnId: { k: "counter" },
    round: NUM,
    promptChars: NUM,
    toolsChars: NUM,
    promptTokens: NUM,
    ceiling: NUM,
  },
  // engineTurnStream.ts:130-149; historyDropped constant at compactor.ts:533;
  // rebuild budget source at engineTurnWindow.ts:65-67.
  KALSA_WINDOW: {
    turnId: { k: "counter" },
    kvHeld: BOOL,
    nPast: NUMN,
    lastSaveTokens: NUMN,
    loadedB: BOOL,
    hasDigest: BOOL,
    legacyWindowStart: NUM,
    historyDropped: enumOf("history_dropped_window_exceeds_budget"),
    rebuildBudgetChars: NUM,
    rebuildBudgetSource: enumOf("ceiling", "profile"),
    textEst: NUM,
    measuredCharsPerToken: NUMN,
    windowTokens: NUMN,
  },
  // Session save/load/reconcile outcomes (chatKvSessionSave.ts, chatKvSessionLoad.ts,
  // chatKvSessionNative.ts, chatKvSessionShared.ts, engineTurnWindow.ts,
  // engineTurnSlide.ts, engineTurnCompactor.ts, LlamaService.ts, sessionEvictMarker.ts).
  // `ok` + `reason` + `ms` only: enough to see that a save was refused because
  // the governor holds the context, without collecting a single session artifact
  // (stems, hashes, meta field names, victim models and byte counts all drop).
  KALSA_SESSION: {
    op: enumOf(
      "save",
      "mark_prefix",
      "load",
      "init",
      "evict",
      "prewarm",
      "window_align",
      "window_reconcile",
      "window_slide",
    ),
    ok: BOOL,
    reason: enumSetOrNull(SESSION_REASONS),
    ms: NUM,
  },
  // LlamaService.ts:4448-4454; ContextMode at compactor.ts:313.
  KALSA_THINKING: {
    turnId: { k: "counter" },
    budget: NUM,
    decodeTokPerSec: NUM,
    forceShort: BOOL,
    contextMode: enumOf("off", "ciswire", "anchored"),
  },
  // turnTelemetry.ts:249-255.
  KALSA_ANSWER_TRUNCATED: {
    turnId: { k: "counter" },
    round: NUM,
    tokensEvaluated: NUM,
    tokensPredicted: NUM,
    tokensCached: NUM,
  },
  // LlamaService.ts:2346.
  KALSA_CTX_FLOOR: {
    nCtx: NUM,
  },
  // pairingFailLog.ts:3-21 (stage), :27 (status).
  KALSA_PAIRING_FAIL: {
    stage: enumOf(
      "random",
      "validate",
      "claim_url",
      "claim_network",
      "claim_status",
      "complete_network",
      "complete_status",
      "seal",
      "save",
      "request_too_large",
      "confirm_timeout",
      "unexpected",
    ),
    status: NUMN,
  },
  // Lifecycle and dial reasons share one field; stage-specific sets live in road.ts.
  // `node8` is deliberately NOT a field (node-id prefix): the schema drops it.
  KALSA_ROAD: {
    road: enumOf("https", "iroh"),
    lane: enumOf("desk", "door"),
    stage: enumOf("dial", "start", "background_stop", "idle_stop"),
    reason: enumOf(
      "no_node",
      "module_absent",
      "ok",
      "deadline",
      "aborted",
      "no_module",
      "linkage",
      "invalid_node",
      "transport",
      "io",
      "entropy",
      "key_corrupt",
      "config",
      "closed",
      "async_context",
      "other",
      "started",
      "stopped",
      "tunnels_open",
      "error",
      "stop_timeout",
    ),
    ms: NUM,
  },
  KALSA_ROOM_SEND: {
    op: enumOf("enqueue", "persisted", "kick", "post", "ack", "fail", "announce_fail", "drop_no_pairing"),
    code: enumOf(
      "bad_request", "name_taken", "client_msg_id_reused", "too_large", "bad_cursor",
      "epoch_changed", "no_room", "read_only", "not_found", "internal", "removed",
      "invalid_input", "body_too_large", "client_msg_id_unavailable", "queue_full",
      "pairing_store_damaged", "door_unusable", "unreachable", "unexpected",
      "malformed_response", "storage_error",
    ),
    localId8: { k: "safeId8" },
    clientId8: { k: "safeId8" },
    ms: NUM,
  },
  KALSA_ROOM_FEED: {
    op: enumOf("mount", "read", "history", "resync", "entry", "info", "removed", "error"),
    entries: NUM,
    seqFirst: NUM,
    seqLast: NUM,
    epoch8: { k: "safeId8" },
    status: enumOf("loading", "ready", "error", "removed"),
  },
};
