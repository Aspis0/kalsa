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
 * This module is intentionally dependency-free (no llama.rn import) so it
 * can be unit-tested with a plain tsc + node harness
 * (scripts/toolCallParseHarness.mjs) without pulling in native bindings.
 */

export const TOOL_CALL_OPEN = "<tool_call>";
export const TOOL_CALL_CLOSE = "</tool_call>";

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
 * Extract a tool call from the raw fallback XML-ish dialect some models emit
 * instead of the structured `tool_calls` array, e.g.:
 *   <tool_call><function=web_search><parameter=query>...</parameter></function></tool_call>
 * or a JSON-body variant:
 *   <tool_call>{"name":"web_search","arguments":{"query":"..."}}</tool_call>
 *
 * Handles an unterminated trailing block too (round cut off mid-markup by
 * n_predict / stop words) by treating "to end of string" as the block body.
 *
 * Defensive: malformed markup NEVER throws — returns null instead, letting
 * the caller fall through to plain (stripped) text handling.
 */
export function parseFallbackToolCall(rawText: string): FallbackToolCall | null {
  try {
    if (!rawText || typeof rawText !== "string") return null;
    const openIdx = rawText.indexOf(TOOL_CALL_OPEN);
    if (openIdx === -1) return null;
    const afterOpen = rawText.slice(openIdx + TOOL_CALL_OPEN.length);
    const closeIdx = afterOpen.indexOf(TOOL_CALL_CLOSE);
    const inner = closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx);
    const trimmedInner = inner.trim();
    if (!trimmedInner) return null;

    // Variant B: JSON body.
    if (trimmedInner.startsWith("{")) {
      const parsed: unknown = JSON.parse(trimmedInner);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        typeof (parsed as { name?: unknown }).name === "string" &&
        (parsed as { name: string }).name.trim().length > 0
      ) {
        const rawArgs = (parsed as { arguments?: unknown }).arguments;
        const args =
          rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)
            ? (rawArgs as Record<string, unknown>)
            : {};
        return { name: (parsed as { name: string }).name.trim(), arguments: args };
      }
      return null;
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
  } catch {
    return null;
  }
}

/**
 * Strip tool_call markup from a FINAL (non-streaming, whole-round) text:
 * closed pairs anywhere, plus a trailing block that was opened but never
 * closed (round truncated mid-markup). Mirrors LlamaService's stripThinkTags.
 */
export function stripToolCallTagsFinal(text: string): string {
  return text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").replace(/<tool_call>[\s\S]*$/, "");
}

/**
 * Stateful, delta-aware tool_call markup stripper for streaming output.
 * Mirrors the <think> handling in LlamaService.cleanStreamDelta: a
 * <tool_call>/</tool_call> pair can arrive split across two consecutive
 * stream deltas — state (insideToolCall + a partial-tag carry) survives
 * across calls so a fragment never leaks into the visible stream.
 *
 * Returns a per-round stripper: create a FRESH instance at the start of
 * every completion round (state does not reset itself).
 */
export function createToolCallDeltaStripper(): (raw: string) => string {
  let insideToolCall = false;
  let carry = "";

  return (raw: string): string => {
    const text = carry + raw;
    carry = "";
    let out = "";
    let i = 0;
    while (i < text.length) {
      if (insideToolCall) {
        const closeIdx = text.indexOf(TOOL_CALL_CLOSE, i);
        if (closeIdx === -1) {
          // Still inside a tool call: discard the remainder (never emitted
          // either way), but the tail may be a PARTIAL "</tool_call>" split
          // across this delta and the next — carry it so the close tag is
          // still detected once the next delta completes it. Without this,
          // a close tag split at a chunk boundary is silently missed and
          // insideToolCall never clears, swallowing everything after it.
          const tail = partialTagSuffixLength(text.slice(i), TOOL_CALL_CLOSE);
          if (tail > 0) carry = text.slice(text.length - tail);
          i = text.length;
          break;
        }
        insideToolCall = false;
        i = closeIdx + TOOL_CALL_CLOSE.length;
        continue;
      }
      const openIdx = text.indexOf(TOOL_CALL_OPEN, i);
      if (openIdx === -1) {
        const tail = partialTagSuffixLength(text.slice(i), TOOL_CALL_OPEN);
        out += text.slice(i, text.length - tail);
        if (tail > 0) carry = text.slice(text.length - tail);
        i = text.length;
        break;
      }
      out += text.slice(i, openIdx);
      insideToolCall = true;
      i = openIdx + TOOL_CALL_OPEN.length;
    }
    return out;
  };
}
