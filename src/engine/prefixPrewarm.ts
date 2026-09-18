/**
 * Pure helpers for the static system+tools prefix prewarm (V2-2).
 *
 * Hash is djb2 over {locale, systemText, toolNames+schema JSON}.
 * Messages are system-only — no user, facts, persona, or operative/digest.
 */

import {
  WINDOW_CHARS_PER_TOKEN,
  WINDOW_RESERVE_TOKENS,
} from "../context/windowProfile";

export type PrewarmToolLike = {
  type?: string;
  function?: {
    name?: unknown;
    description?: unknown;
    parameters?: unknown;
  };
};

export type StaticPrefixMessage = { role: "system"; content: string };

export type AssembledStaticPrefix = {
  messages: StaticPrefixMessage[];
  tools: PrewarmToolLike[];
  hasTools: boolean;
  hash: string;
  systemChars: number;
  toolCount: number;
};

export type PrewarmCompletionResult = {
  error?: unknown;
  interrupted?: boolean;
  tokens_predicted?: number;
  tokens_evaluated?: number;
  tokens_cached?: number;
  timings?: { prompt_ms?: number; prompt_n?: number };
};

export type PrewarmResultClass = "failed" | "skip" | "generated" | "success";

/** Same djb2 as sessionPersistence.historyHash (UTF-16 code units). */
export function djb2(text: string): string {
  let h = 5381 >>> 0;
  for (let i = 0; i < text.length; i++) {
    h = (((h << 5) + h + text.charCodeAt(i)) >>> 0);
  }
  return String(h >>> 0);
}

/** Stable {name, schema} rows for the prefix hash. */
export function toolsForPrewarmHash(
  tools: ReadonlyArray<PrewarmToolLike> | null | undefined,
): Array<{ name: string; schema: unknown }> {
  const list = Array.isArray(tools) ? tools : [];
  return list.map((tool) => {
    const fn = tool?.function;
    return {
      name: typeof fn?.name === "string" ? fn.name : "",
      schema: {
        description: typeof fn?.description === "string" ? fn.description : "",
        parameters: fn?.parameters ?? null,
      },
    };
  });
}

/**
 * Exact prefix identity, pre-hash: locale + systemText + {name,schema} rows.
 * This is the memo key for the measured static-prefix token count — the raw
 * string, not its djb2, so two different prefixes can never collide onto one
 * cached count (djb2 is 32-bit; the hash stays for prewarm identity only,
 * where a collision costs a skipped prewarm, not a wrong reserve).
 */
export function staticPrefixIdentity(
  locale: string,
  systemText: string,
  tools?: ReadonlyArray<PrewarmToolLike> | null,
): string {
  return JSON.stringify({
    locale: typeof locale === "string" ? locale : "",
    systemText: typeof systemText === "string" ? systemText : "",
    tools: toolsForPrewarmHash(tools),
  });
}

/**
 * Persisted static-prefix measurement, schema v2.
 *
 * v1 stored a bare number per key. That let two poisons survive:
 * a corrupted/absurd value was indistinguishable from a real count, and a
 * value measured under another (larger) n_ctx could exceed the active one.
 * Any `tokens >= nCtx` collapses `windowCeilingTokens(nCtx, tokens)` to 0,
 * which makes the ceiling guard fire every held send and keeps the prewarm
 * that could replace the value from ever running (kv_holds_chat skip).
 * The bound below is the guard's own: the measurement must leave at least one
 * token of verbatim window under the SAME reserve the guard subtracts, i.e.
 * `tokens < nCtx - WINDOW_RESERVE_TOKENS`. No estimator factor, no fudge
 * constant; `tokens` is the native count the prewarm itself measured.
 */
export type StaticPrefixMeasurement = {
  /** Native token count of the exact system+tools render. */
  tokens: number;
  /** Context size the measurement was taken under. */
  nCtx: number;
  /** Measurement time (epoch ms). Ordering/eviction only, never a bound. */
  at: number;
};

/** Persisted-map cap. Newest by `at` wins; the exact-id key space is small. */
export const STATIC_PREFIX_MEASUREMENT_MAX_ENTRIES = 32;

/** Storage key for one measured prefix, including the model identity. */
export function staticPrefixMeasurementKey(
  modelIdentity: string,
  prefixIdentity: string,
): string {
  return JSON.stringify({ modelIdentity, prefixIdentity });
}

/** JSON.parse gives only plain objects; reject exotic prototypes anyway. */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * The guard's own plausibility bound. A static prefix that consumes the whole
 * `nCtx - WINDOW_RESERVE_TOKENS` budget leaves `windowCeilingTokens` at 0, so
 * it cannot be used for the ceiling decision even if it was really measured.
 * That is a property of the active context, not of the stored blob.
 */
export function isStaticPrefixMeasurementUsable(
  tokens: number,
  nCtx: number,
): boolean {
  if (!Number.isSafeInteger(tokens) || tokens <= 0) return false;
  if (!Number.isSafeInteger(nCtx) || nCtx <= 0) return false;
  return tokens < nCtx - WINDOW_RESERVE_TOKENS;
}

/** Schema + own-context bound; null for anything not a v2 measurement. */
function normalizeStaticPrefixMeasurement(
  value: unknown,
): StaticPrefixMeasurement | null {
  if (!isPlainRecord(value)) return null;
  const { tokens, nCtx, at } = value;
  if (
    typeof tokens !== "number" ||
    typeof nCtx !== "number" ||
    !isStaticPrefixMeasurementUsable(tokens, nCtx)
  ) {
    return null;
  }
  if (typeof at !== "number" || !Number.isSafeInteger(at) || at < 0) {
    return null;
  }
  return { tokens, nCtx, at };
}

/**
 * Build a measurement for persistence. Returns null when the native count is
 * not schema-valid or does not leave a verbatim window under `nCtx` — e.g. a
 * count produced under a different, larger context. Callers keep their
 * existing in-memory value only if they choose to; the store stays clean.
 */
export function makeStaticPrefixMeasurement(
  tokens: number,
  nCtx: number,
  at: number,
): StaticPrefixMeasurement | null {
  return normalizeStaticPrefixMeasurement({ tokens, nCtx, at });
}

/**
 * Deterministic cap/dedupe: one entry per key (newer `at` wins; on equal `at`
 * the first occurrence wins, so a given input order is stable), newest first,
 * key ascending as the tiebreak so the wire bytes do not depend on Map
 * insertion order. Values that are not valid v2 measurements are dropped.
 * At most 32 entries.
 */
export function capStaticPrefixMeasurements(
  entries: Iterable<readonly [string, unknown]>,
): Array<[string, StaticPrefixMeasurement]> {
  const byKey = new Map<string, StaticPrefixMeasurement>();
  for (const [key, raw] of entries) {
    if (typeof key !== "string" || key.length === 0) continue;
    const measurement = normalizeStaticPrefixMeasurement(raw);
    if (measurement === null) continue;
    const previous = byKey.get(key);
    if (previous === undefined || measurement.at > previous.at) {
      byKey.set(key, measurement);
    }
  }
  return [...byKey.entries()]
    .sort(
      (a, b) =>
        b[1].at - a[1].at ||
        (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    )
    .slice(0, STATIC_PREFIX_MEASUREMENT_MAX_ENTRIES);
}

/**
 * Parse persisted measurements without trusting malformed storage. Only a
 * plain-object top level is accepted; every value must be a v2 measurement
 * that satisfies its own-context bound. v1 number values are dropped.
 * Already capped, so a poisoned oversized blob cannot bloat memory.
 */
export function parseStaticPrefixMeasurements(
  raw: string | null | undefined,
): Array<[string, StaticPrefixMeasurement]> {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isPlainRecord(parsed)) return [];
  return capStaticPrefixMeasurements(Object.entries(parsed));
}

/**
 * Deterministic serialization of the capped, newest-first map. The parameter
 * is typed to the v2 record so an un-migrated v1 `Map<string, number>` call
 * site fails to compile instead of silently serializing `{}`; runtime-invalid
 * values are still dropped by the cap.
 */
export function serializeStaticPrefixMeasurements(
  entries: Iterable<readonly [string, StaticPrefixMeasurement]>,
): string {
  return JSON.stringify(Object.fromEntries(capStaticPrefixMeasurements(entries)));
}

/**
 * Synchronous read for the ceiling guard: the counted tokens if this entry is
 * plausible for the ACTIVE context, else null (caller falls back to its
 * estimator and logs why). Never returns a value that could zero the ceiling.
 */
export function staticPrefixTokensForActiveNCtx(
  entry: StaticPrefixMeasurement | null | undefined,
  activeNCtx: number,
): number | null {
  const measurement = normalizeStaticPrefixMeasurement(entry);
  if (measurement === null) return null;
  if (!Number.isSafeInteger(activeNCtx) || activeNCtx <= 0) return null;
  return measurement.tokens < activeNCtx - WINDOW_RESERVE_TOKENS
    ? measurement.tokens
    : null;
}

/**
 * djb2 over staticPrefixIdentity — unchanged wire behavior.
 */
export function computePrewarmPrefixHash(
  locale: string,
  systemText: string,
  tools?: ReadonlyArray<PrewarmToolLike> | null,
): string {
  return djb2(staticPrefixIdentity(locale, systemText, tools));
}

/**
 * Chat-template scaffolding margin for the fallback count below: role
 * headers, special tokens and the user-line render around the system block.
 * Declared, not derived — the measured S23 static prefix (1832) exceeds the
 * chars/3 content estimate (1323) mostly through the tool schemas, so the
 * scaffolding itself is bounded high-side here.
 */
export const STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS = 128;

/**
 * CJK and emoji ranges: on this class of tokenizers they price near 1 token
 * per char, so a flat chars/3 would undercount them ~3x — the fallback must
 * never be optimistic (audit FAIL 2026-09-14: facts/system text is not
 * charset-limited). Priced at 1 token per char; everything else at the
 * window's low /3.
 */
const WIDE_CHAR_RE =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF\u{20000}-\u{2FA1F}\u{1F000}-\u{1FAFF}]/gu;

/**
 * Char-side fallback for the static-prefix token count. Only used when the
 * prefix has not been measured yet (no prewarm for this identity yet) — the
 * honest count is the measured one, never this.
 *
 * Deliberately OVERSHOOTS: the reserve shields the n_ctx ceiling, so an
 * underestimate re-creates the silent-overflow bug this exists to prevent,
 * while an overestimate costs one extra window slide. Both terms use the
 * window's own low chars/token ratio — the S23 t20c run measured the 4045
 * schema chars of the default 7-tool set at only ~500 tokens (~8 chars/token;
 * the tokenizer merges repetitive schema JSON), so /3 stays above the
 * measured density while assuming nothing else — plus the declared template
 * margin and per-char pricing for CJK/emoji. Never returns 0 — a 0 reserve
 * is the starting bug.
 */
export function estimateStaticPrefixTokens(
  systemText: string,
  tools?: ReadonlyArray<PrewarmToolLike> | null,
): number {
  const text = typeof systemText === "string" ? systemText : "";
  const wideChars = text.match(WIDE_CHAR_RE)?.length ?? 0;
  const narrowTokens = Math.ceil((text.length - wideChars) / WINDOW_CHARS_PER_TOKEN);
  const list = Array.isArray(tools) ? tools : [];
  const schemaTokens =
    list.length > 0
      ? Math.ceil(JSON.stringify(toolsForPrewarmHash(list)).length / WINDOW_CHARS_PER_TOKEN)
      : 0;
  return wideChars + narrowTokens + schemaTokens + STATIC_PREFIX_TEMPLATE_MARGIN_TOKENS;
}

/**
 * True when a completion failed because the chat template could not render a
 * system-only conversation.
 *
 * The prewarm prompt is the static prefix and nothing else, so on a hybrid
 * model the cache it leaves ends exactly where the next real prompt diverges:
 * n_common == embd.size(), and llama_memory_seq_rm's partial-rollback branch
 * (llama-memory-recurrent.cpp:194, `0 < p0 && p0 <= cell.pos`) is never
 * entered — which matters because that branch is bounded by n_rs_seq, which
 * is 0 without a draft model, so entering it means FAILING. One extra turn in
 * the cache is enough to move p0 back behind the frontier and lose the whole
 * prefix to a full re-prefill.
 *
 * Some templates cannot render that prompt (Qwen's jinja: "Prompt is
 * required", "Unable to generate parser"). Those, and only those, get a
 * one-character filler turn appended — paying the re-prefill rather than
 * skipping the prewarm entirely. Both shipped templates were read out of their own
 * GGUF metadata rather than the reference .jinja files:
 *
 * - LFM2.5-2.6B renders it fine — a lone system message emits
 *   `<|im_start|>system\n…<|im_end|>\n` and both message loops run zero
 *   times, so no filler is ever added and the prefix is reused whole.
 * - Qwen3.5-4B refuses: its reverse scan sets `multi_step_tool` false only on
 *   a user role, then `raise_exception('No user query found in messages.')`.
 *   That model gets the filler, and pays the re-prefill it implies.
 */
export function isSystemOnlyTemplateFailure(message: unknown): boolean {
  if (typeof message !== "string" || message.length === 0) return false;
  return (
    // Read out of the shipped GGUFs' own tokenizer.chat_template, not guessed:
    // Qwen3.5-4B's template runs `raise_exception('No user query found in
    // messages.')` when its reverse scan finds no user role (it also refuses
    // an empty `messages`), and minja surfaces that string verbatim.
    /No user query found/i.test(message) ||
    /No messages provided/i.test(message) ||
    /Prompt is required/i.test(message) ||
    /Unable to generate parser/i.test(message) ||
    /system[- ]only/i.test(message)
  );
}

/** System-only chat. Never user / assistant / tool roles. */
export function buildStaticPrefixMessages(systemText: string): StaticPrefixMessage[] {
  return [{ role: "system", content: typeof systemText === "string" ? systemText : "" }];
}

/**
 * Queue skip: only when this process already prewarmed (or marked hot) this
 * prefix. After a live chat turn the caller sets prewarmPrefixHash so ensure()
 * will not overwrite hot chat KV with a system-only prefill.
 *
 * Disk restore is split: hybrid/kvUnified loadSession is not a real native
 * restore (n_past=0) so prewarm must still run when the hash is null. Dense
 * a restore populated real KV — see shouldSkipPrewarmWhenKvHoldsChat.
 *
 * Hash is identity-only (locale + systemText + tool name/schema), not a
 * byte-proof of the rendered jinja prompt.
 */
export function shouldSkipStaticPrefixPrewarm(
  prewarmPrefixHash: string | null | undefined,
  prefixHash: string,
): boolean {
  return prewarmPrefixHash === prefixHash;
}

/** Classify a zero-token completion from the native prompt/KV counters. */
export function classifyPrewarmResult(
  result: PrewarmCompletionResult | null | undefined,
): PrewarmResultClass {
  const nativeError = result?.error;
  if (nativeError != null && nativeError !== "") return "failed";
  if (result?.interrupted) return "skip";
  if ((result?.tokens_predicted ?? 0) > 0) return "generated";

  const tokensEvaluated = result?.tokens_evaluated ?? 0;
  const tokensCached = result?.tokens_cached ?? 0;
  return tokensEvaluated > 0 && tokensCached >= tokensEvaluated ? "success" : "failed";
}

/**
 * Chat KV must not be prewarmed over: a system+user"." prewarm seq_rm-succeeds
 * and deletes the live chat tail, and the first send then re-prefills the
 * whole history. This includes KV from a restore and KV left by a completion.
 *
 * This used to skip only for DENSE models, on the assumption that "hybrid /
 * kvUnified restores are not real (n_past=0)". **Measured false on 2026-08-21**
 * (HARNESS_FINDINGS §7.29): on a hybrid model a restore after force-stop
 * logged `is_hybrid=1 resumable=1`, loaded in 19 ms, and the next
 * send ran at `n_past=1473` with `promptMs` ~2 s, twice. The KV was real, and
 * the architecture never told us whether it would be.
 *
 * §7.30 measured hybrid/kvUnified restores with 1814–1946 resident and reused
 * tokens, confirming that a successful restore can leave real reusable KV.
 * So the condition is whether KV holds a chat session, not how it got there
 * or which architecture produced it. A second hybrid restore also lost the KV
 * at prompt time ("no usable state checkpoint … doing full cache clear") because
 * its prompt diverged — a prewarm would not have survived that either, so
 * skipping is right there too.
 */
export function shouldSkipPrewarmWhenKvHoldsChat(
  kvHoldsChatSession: boolean,
): boolean {
  return kvHoldsChatSession === true;
}

export type PrewarmStopReason =
  | "stale"
  | "no_context"
  | "disposing"
  | "kv_holds_chat";

/**
 * Why a running prewarm job must stop, or null to carry on. Every await in the
 * job body can invalidate all four inputs, so this is evaluated before each act
 * that touches the native KV — never only after it. It lived inline in three
 * hand-made copies, and the snapshot restore was added with its copy on the way
 * OUT: a dispose landing during the restore was noticed only once a 12.6 MB
 * loadSession had already been issued against a discarded context.
 *
 * Precedence is load-bearing and matches what the inline copies logged: a stale
 * generation outranks everything, and when the context changed the reason is
 * "no_context" even if a dispose is also in flight — the context identity is the
 * more specific fact.
 */
/**
 * A prewarm that keeps failing must not burn a full static-prefix prefill on
 * every trigger. The foreground re-kick made that concrete: a model whose
 * template or engine path refuses this render would pay ~1832 tokens of
 * prefill on every single return to the app, for a prefix that will never
 * land. Two attempts, then this process stops trying for that (model, prefix)
 * pair; a later success clears the count.
 */
export const STATIC_PREFIX_PREWARM_MAX_FAILURES = 2;

/**
 * Does this outcome say something durable about the model, or only about this
 * attempt? An interrupted completion says nothing — the next trigger should
 * retry. A template that renders nothing usable, or an engine that refuses the
 * render, will say the same thing next time.
 *
 * The template refusal Qwen raises is NOT routed here: it has its own bounded
 * retry (the filler turn), and that retry is free because the refusal happens
 * at render time, before any compute.
 */
export function prewarmFailureIsPersistent(
  resultClass: PrewarmResultClass,
): boolean {
  return resultClass === "failed" || resultClass === "generated";
}

export function prewarmGivenUp(failures: number): boolean {
  return failures >= STATIC_PREFIX_PREWARM_MAX_FAILURES;
}

export function prewarmStopReason(input: {
  genStale: boolean;
  disposing: boolean;
  contextChanged: boolean;
  kvHoldsChat: boolean;
}): PrewarmStopReason | null {
  if (input.genStale) return "stale";
  if (input.disposing || input.contextChanged) {
    return input.contextChanged ? "no_context" : "disposing";
  }
  if (shouldSkipPrewarmWhenKvHoldsChat(input.kvHoldsChat)) return "kv_holds_chat";
  return null;
}

/**
 * Locale/web/device/calendar flips must not clearCache while live chat KV
 * is held. S23 20t t4: notifyStaticPrefixInputs wiped mid-chat then
 * prewarmed over empty KV (`n_common=0`). Next send may hash-miss; that
 * is correct. Same boolean as shouldSkipPrewarmWhenKvHoldsChat — inverted.
 */
export function shouldWipeKvOnPrefixInputChange(
  kvHoldsChatSession: boolean,
): boolean {
  return !shouldSkipPrewarmWhenKvHoldsChat(kvHoldsChatSession);
}

/**
 * Wipe-job run-time recheck, inside withLifecycleLock immediately before
 * clearCache. Init assigns `context` (isEngineReady) before
 * tryLoadEngineSession sets kvHoldsChatSession. Same boolean as
 * shouldWipeKvOnPrefixInputChange — do not invert again.
 */
export function shouldApplyQueuedPrefixWipe(kvHoldsNow: boolean): boolean {
  return shouldWipeKvOnPrefixInputChange(kvHoldsNow);
}

/**
 * Control flow for notifyStaticPrefixInputs. Hash identity first, then
 * live chat KV (must not clearCache), then in-flight engine jobs.
 * Only wipe_and_queue may resetPrewarmState + clearCache + queue.
 * Planner `busy` is sampled before locks; LlamaService rechecks
 * engineJobPendingCount inside withLifecycleLock (skip_inflight).
 */
export function planPrefixInputChange(input: {
  hashSkip: boolean;
  kvHoldsChat: boolean;
  busy: boolean;
}): "skip_hash" | "skip_kv_holds" | "skip_inflight" | "wipe_and_queue" {
  if (input.hashSkip) return "skip_hash";
  if (!shouldWipeKvOnPrefixInputChange(input.kvHoldsChat)) return "skip_kv_holds";
  if (input.busy) return "skip_inflight";
  return "wipe_and_queue";
}

export function assembleStaticPrefix(input: {
  locale: string;
  systemText: string;
  tools?: ReadonlyArray<PrewarmToolLike> | null;
}): AssembledStaticPrefix {
  const tools = Array.isArray(input.tools) ? [...input.tools] : [];
  const systemText = typeof input.systemText === "string" ? input.systemText : "";
  const locale = typeof input.locale === "string" ? input.locale : "";
  return {
    messages: buildStaticPrefixMessages(systemText),
    tools,
    hasTools: tools.length > 0,
    hash: computePrewarmPrefixHash(locale, systemText, tools),
    systemChars: systemText.length,
    toolCount: tools.length,
  };
}
