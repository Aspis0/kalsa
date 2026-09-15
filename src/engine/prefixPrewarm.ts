/**
 * Pure helpers for the static system+tools prefix prewarm (V2-2).
 *
 * Hash is djb2 over {locale, systemText, toolNames+schema JSON}.
 * Messages are system-only — no user, facts, persona, or operative/digest.
 */

import { WINDOW_CHARS_PER_TOKEN } from "../context/windowProfile";

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

/** Storage key for one measured prefix, including the model identity. */
export function staticPrefixMeasurementKey(
  modelIdentity: string,
  prefixIdentity: string,
): string {
  return JSON.stringify({ modelIdentity, prefixIdentity });
}

/** Parse persisted measurements without trusting malformed storage. */
export function parseStaticPrefixMeasurements(
  raw: string | null | undefined,
): Array<[string, number]> {
  try {
    const parsed = raw == null ? null : JSON.parse(raw) as unknown;
    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return [];
    }
    return Object.entries(parsed).flatMap(([key, value]) =>
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? [[key, Math.floor(value)] as [string, number]]
        : [],
    );
  } catch {
    return [];
  }
}

/** Serialize the measured-prefix map as a compact JSON object. */
export function serializeStaticPrefixMeasurements(
  measurements: ReadonlyMap<string, number>,
): string {
  return JSON.stringify(Object.fromEntries(measurements));
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
