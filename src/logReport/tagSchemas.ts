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

export type FieldRule =
  | { k: "num"; nullable?: true }
  | { k: "bool"; nullable?: true }
  | { k: "enum"; values: readonly string[]; nullable?: true }
  /** A monotonic turn counter (`mintTurnId`, LlamaService.ts:546-548) — never a conversation id. */
  | { k: "counter" }
  /** A bounded identifier prefix; full ids are never collected. */
  | { k: "safeId8" }
  /** A catalog model id; the accepted set is installed at startup. */
  | { k: "modelId" }
  /** A finite number, or a depth-1 object of them under exactly these keys —
   *  any other key drops the whole field. */
  | { k: "numObj"; keys: readonly string[] };

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

const PAUSE_REASONS = enumOf("thermal", "profile", "reload", "unexplained");

/** Tool names: src/agent/toolNames.ts:13 plus the clamp placeholder (toolCallTelemetry.ts:43). */
const TOOL_NAMES = enumOf(
  "web_search",
  "web_fetch",
  "document_chat",
  "write_note",
  "device_info",
  "device_calc",
  "calendar_agenda",
  "create_miniapp",
  "other",
);

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
    stage: enumOf("dial", "start", "background_stop"),
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
