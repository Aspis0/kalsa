/**
 * Fallback dialect parser + markup stripper for tool_call XML-ish leaks.
 *
 * Some local models (observed on Qwen3.5 under the V4.2 bench, thinking
 * budget256) occasionally emit a tool call as literal text in a
 * `<tool_call>...</tool_call>` block instead of the OpenAI-style
 * `tool_calls` array the llama.rn binding normally exposes on the
 * completion result. Left unhandled, that raw markup streams straight into
 * the chat bubble (UX bug) AND the tool never actually runs (the turn ends
 * with no real answer).
 *
 * LFM2.5 emits a different dialect:
 *   <|tool_call_start|>[{"name":"...","arguments":{...}}]<|tool_call_end|>
 *
 * This module is intentionally dependency-free (no llama.rn import) so it
 * can be unit-tested with a plain tsc + node harness
 * (scripts/toolCallParseHarness.mjs) without pulling in native bindings.
 */

export const TOOL_CALL_OPEN = "<tool_call>";
export const TOOL_CALL_CLOSE = "</tool_call>";

/** LFM2.5 chat-template markers (JSON array payload between them). */
export const LFM_TOOL_CALL_START = "<|tool_call_start|>";
export const LFM_TOOL_CALL_END = "<|tool_call_end|>";

/**
 * Length of the longest suffix of `s` that is a strict prefix of `tag`.
 * Used to hold back a partial tag (e.g. "<tool_c") at the end of a stream
 * delta until the next delta resolves whether it is really a tag.
 */
export function partialTagSuffixLength(s: string, tag: string): number {
  const maxLen = Math.min(s.length, tag.length - 1);
  for (let len = maxLen; len > 0; len -= 1) {
    if (s.slice(s.length - len) === tag.slice(0, len)) return len;
  }
  return 0;
}

export type FallbackToolCall = { name: string; arguments: Record<string, unknown> };

// Not global: matched once against the (already isolated) <tool_call> inner text.
const FUNCTION_TAG_RE = /<function=([^>]+)>([\s\S]*?)<\/function>/;
// Global: multiple <parameter=...> entries per function call.
const PARAMETER_TAG_RE = /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g;

/**
 * Validate/normalise one call object (OpenAI-style name + arguments).
 * Shared by Qwen JSON body and LFM2 array elements.
 */
function normaliseCallObject(value: unknown): FallbackToolCall | null {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as { name?: unknown }).name !== "string" ||
    !(value as { name: string }).name.trim()
  ) {
    return null;
  }
  const rawArgs = (value as { arguments?: unknown }).arguments;
  const args =
    rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
      ? (rawArgs as Record<string, unknown>)
      : {};
  return { name: (value as { name: string }).name.trim(), arguments: args };
}

/**
 * LFM2.5 dialect: `<|tool_call_start|>[{...}, ...]<|tool_call_end|>`.
 * Returns null if the start marker is absent (caller may try other dialects).
 * Returns [] when the marker is present but payload is missing/invalid.
 * Tolerates a missing end marker when the trailing payload is valid JSON.
 */
function parseLfmToolCalls(rawText: string): FallbackToolCall[] | null {
  const openIdx = rawText.indexOf(LFM_TOOL_CALL_START);
  if (openIdx === -1) return null;
  const afterOpen = rawText.slice(openIdx + LFM_TOOL_CALL_START.length);
  const closeIdx = afterOpen.indexOf(LFM_TOOL_CALL_END);
  const inner = (closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx)).trim();
  if (!inner) return [];
  try {
    const parsed: unknown = JSON.parse(inner);
    if (!Array.isArray(parsed)) return [];
    const calls: FallbackToolCall[] = [];
    for (const item of parsed) {
      const call = normaliseCallObject(item);
      if (call) calls.push(call);
    }
    return calls;
  } catch {
    return [];
  }
}

/**
 * Qwen XML-ish dialect (single call): function tags or a JSON object body.
 */
function parseQwenFallbackToolCall(rawText: string): FallbackToolCall | null {
  const openIdx = rawText.indexOf(TOOL_CALL_OPEN);
  if (openIdx === -1) return null;
  const afterOpen = rawText.slice(openIdx + TOOL_CALL_OPEN.length);
  const closeIdx = afterOpen.indexOf(TOOL_CALL_CLOSE);
  const inner = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
  const trimmedInner = inner.trim();
  if (!trimmedInner) return null;

  // Variant B: JSON body (single object).
  if (trimmedInner.startsWith("{")) {
    try {
      return normaliseCallObject(JSON.parse(trimmedInner));
    } catch {
      return null;
    }
  }

  // Variant A: <function=NAME><parameter=KEY>VALUE</parameter>...</function>
  const fnMatch = FUNCTION_TAG_RE.exec(trimmedInner);
  if (!fnMatch) return null;
  const name = fnMatch[1]?.trim();
  if (!name) return null;
  const paramsBlock = fnMatch[2] ?? "";
  const args: Record<string, unknown> = {};
  PARAMETER_TAG_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PARAMETER_TAG_RE.exec(paramsBlock)) !== null) {
    const key = m[1]?.trim();
    if (key) args[key] = (m[2] ?? "").trim();
  }
  return { name, arguments: args };
}

/**
 * Extract tool call(s) from raw model text fallback dialects.
 * Prefers LFM2 markers when present; otherwise Qwen `<tool_call>` markup.
 * Never throws — malformed input yields an empty array.
 */
export function parseFallbackToolCalls(rawText: string): FallbackToolCall[] {
  try {
    if (!rawText || typeof rawText !== "string") return [];
    const lfm = parseLfmToolCalls(rawText);
    if (lfm !== null) return lfm;
    const qwen = parseQwenFallbackToolCall(rawText);
    return qwen ? [qwen] : [];
  } catch {
    return [];
  }
}

/**
 * Extract a single tool call from the raw fallback dialect (first call if many).
 * Prefer `parseFallbackToolCalls` when multiple LFM2 calls may be present.
 *
 * Handles an unterminated trailing block too (round cut off mid-markup by
 * n_predict / stop words) by treating "to end of string" as the block body.
 *
 * Defensive: malformed markup NEVER throws — returns null instead, letting
 * the caller fall through to plain (stripped) text handling.
 */
export function parseFallbackToolCall(rawText: string): FallbackToolCall | null {
  return parseFallbackToolCalls(rawText)[0] ?? null;
}

/** Open/close tag pairs for every known tool-call dialect. */
const TOOL_CALL_TAG_PAIRS: ReadonlyArray<readonly [open: string, close: string]> = [
  [TOOL_CALL_OPEN, TOOL_CALL_CLOSE],
  [LFM_TOOL_CALL_START, LFM_TOOL_CALL_END],
];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Strip one dialect's tool-call span(s) from final text: closed pairs
 * anywhere, plus a trailing open-never-closed block (truncated generation).
 */
function stripOneTagPairFinal(text: string, open: string, close: string): string {
  const closedRe = new RegExp(
    `${escapeRegExp(open)}[\\s\\S]*?${escapeRegExp(close)}`,
    "g",
  );
  const trailingRe = new RegExp(`${escapeRegExp(open)}[\\s\\S]*$`);
  return text.replace(closedRe, "").replace(trailingRe, "");
}

/**
 * Strip tool_call markup from a FINAL (non-streaming, whole-round) text:
 * closed pairs anywhere, plus a trailing block that was opened but never
 * closed (round truncated mid-markup). Mirrors LlamaService's stripThinkTags.
 * Covers Qwen `<tool_call>` and LFM2.5 `<|tool_call_start|>` dialects.
 */
export function stripToolCallTagsFinal(text: string): string {
  let out = text;
  for (const [open, close] of TOOL_CALL_TAG_PAIRS) {
    out = stripOneTagPairFinal(out, open, close);
  }
  return out;
}

/**
 * Earliest open-tag match at or after `from` among all dialect pairs.
 * Returns null when none of the full open tags are present.
 */
function findEarliestOpen(
  text: string,
  from: number,
): { index: number; open: string; close: string } | null {
  let best: { index: number; open: string; close: string } | null = null;
  for (const [open, close] of TOOL_CALL_TAG_PAIRS) {
    const idx = text.indexOf(open, from);
    if (idx === -1) continue;
    if (best === null || idx < best.index) best = { index: idx, open, close };
  }
  return best;
}

/**
 * Longest suffix of `s` that is a strict prefix of any dialect open/close
 * tag (depending on mode). Keeps partial markers from leaking across deltas.
 */
function maxPartialTagSuffix(s: string, tags: readonly string[]): number {
  let max = 0;
  for (const tag of tags) {
    const n = partialTagSuffixLength(s, tag);
    if (n > max) max = n;
  }
  return max;
}

/**
 * Stateful, delta-aware tool_call markup stripper for streaming output.
 * Mirrors the <think> handling in LlamaService.cleanStreamDelta: a
 * tool-call open/close pair can arrive split across two consecutive
 * stream deltas — state (insideToolCall + a partial-tag carry) survives
 * across calls so a fragment never leaks into the visible stream.
 * Handles both Qwen and LFM2.5 dialects via TOOL_CALL_TAG_PAIRS.
 *
 * Returns a per-round stripper: create a FRESH instance at the start of
 * every completion round (state does not reset itself).
 */
export function createToolCallDeltaStripper(): (raw: string) => string {
  /** Close tag of the dialect currently being stripped, or null if outside. */
  let activeClose: string | null = null;
  let carry = "";
  const allOpenTags = TOOL_CALL_TAG_PAIRS.map(([o]) => o);

  return (raw: string): string => {
    const text = carry + raw;
    carry = "";
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (activeClose !== null) {
        const closeTag = activeClose;
        const closeIdx = text.indexOf(closeTag, i);
        if (closeIdx === -1) {
          // Still inside a tool call: discard the remainder, but the tail may
          // be a PARTIAL close tag split across this delta and the next.
          const tail = partialTagSuffixLength(text.slice(i), closeTag);
          if (tail > 0) carry = text.slice(text.length - tail);
          i = text.length;
          break;
        }
        activeClose = null;
        i = closeIdx + closeTag.length;
        continue;
      }
      const open = findEarliestOpen(text, i);
      if (open === null) {
        const tail = maxPartialTagSuffix(text.slice(i), allOpenTags);
        out += text.slice(i, text.length - tail);
        if (tail > 0) carry = text.slice(text.length - tail);
        i = text.length;
        break;
      }
      out += text.slice(i, open.index);
      activeClose = open.close;
      i = open.index + open.open.length;
    }
    return out;
  };
}
