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
 * LFM2.5 chat template emits **Python-style calls** (not JSON):
 *   <|tool_call_start|>[func_name(arg1=val1, arg2=val2)]<|tool_call_end|>
 * e.g. <|tool_call_start|>[web_search(query="capitale del Madagascar")]<|tool_call_end|>
 * Argument values: quoted strings (single/double, with escapes), ints/floats,
 * true/false, None/null, and JSON-serialised values for complex types ({...}, [...]).
 *
 * This module is intentionally dependency-free (no llama.rn import) so it
 * can be unit-tested with a plain tsc + node harness
 * (scripts/harnesses/toolCallParseHarness.mjs) without pulling in native bindings.
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
 * LFM2.5 dialect — two forms in the wild:
 *
 * (A) Real chat-template output (Python-style calls, what LiquidAI models emit):
 *     <|tool_call_start|>[web_search(query="Roma, Italia"), get_time()]<|tool_call_end|>
 *
 * (B) JSON-array form (some finetunes may emit this — kept as fallback):
 *     <|tool_call_start|>[{"name":"web_search","arguments":{"query":"x"}}]<|tool_call_end|>
 *
 * Returns null if the start marker is absent (caller may try other dialects).
 * Returns [] when the marker is present but payload is missing/invalid.
 * Tolerates a missing end marker when the trailing payload is valid.
 *
 * Python-call form is tried first: it is what the upstream template produces.
 * The JSON path is a fallback and must not mask a malformed Python payload —
 * once we recognise the content as Python-call-shaped, parse failures yield []
 * rather than falling through to JSON.parse (which would also throw and give []
 * but for the wrong reason, hiding the bug).
 */
function parseLfmToolCalls(rawText: string): FallbackToolCall[] | null {
  const openIdx = rawText.indexOf(LFM_TOOL_CALL_START);
  if (openIdx === -1) return null;
  const afterOpen = rawText.slice(openIdx + LFM_TOOL_CALL_START.length);
  const closeIdx = afterOpen.indexOf(LFM_TOOL_CALL_END);
  const inner = (closeIdx === -1 ? afterOpen : afterOpen.slice(0, closeIdx)).trim();
  if (!inner) return [];

  // (A) Python-call form — what the upstream chat template actually emits.
  const py = tryParsePythonCallList(inner);
  if (py !== null) return py;

  // (B) JSON-array fallback — some finetunes emit the canonical JSON form.
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

// ── Python-call parser (LFM2.5 real dialect) ─────────────────────────────

/**
 * Split `s` by top-level occurrences of `sep`, respecting quoted strings
 * (both `"` and `'`, with `\`-escapes) and nested `()`, `[]`, `{}`.
 * A comma inside a string, a paren inside a string, or a comma inside
 * nested brackets/braces never splits.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let buf = "";
  let dParen = 0;
  let dBracket = 0;
  let dBrace = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote !== null) {
      buf += c;
      if (c === "\\" && i + 1 < s.length) {
        buf += s[i + 1];
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      buf += c;
      continue;
    }
    if (c === "(") dParen++;
    else if (c === ")") dParen--;
    else if (c === "[") dBracket++;
    else if (c === "]") dBracket--;
    else if (c === "{") dBrace++;
    else if (c === "}") dBrace--;
    else if (c === sep && dParen === 0 && dBracket === 0 && dBrace === 0) {
      out.push(buf);
      buf = "";
      continue;
    }
    buf += c;
  }
  out.push(buf);
  return out;
}

/**
 * Index of the first top-level `=` in `s` (not inside strings / brackets).
 * Returns -1 when no top-level `=` exists.
 */
function findTopLevelEq(s: string): number {
  let dParen = 0;
  let dBracket = 0;
  let dBrace = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote !== null) {
      if (c === "\\" && i + 1 < s.length) { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") dParen++;
    else if (c === ")") dParen--;
    else if (c === "[") dBracket++;
    else if (c === "]") dBracket--;
    else if (c === "{") dBrace++;
    else if (c === "}") dBrace--;
    else if (c === "=" && dParen === 0 && dBracket === 0 && dBrace === 0) return i;
  }
  return -1;
}

/**
 * Parse one argument value from the Python-call form.
 *
 * Per the upstream `format_arg_value` macro:
 *  - quoted strings (single or double) with `\`-escapes → string
 *  - integers and floats → number
 *  - true / false → boolean
 *  - None / null → null
 *  - complex types (object / array) → JSON-serialised literal → JSON.parse
 *
 * Never throws: truly unparseable values fall through to their raw string.
 */
function parseArgValue(s: string): unknown {
  if (s.length === 0) return "";
  // Quoted string (single or double) — must start AND end with the same quote.
  const first = s[0];
  const last = s[s.length - 1];
  if (s.length >= 2 && (first === '"' || first === "'") && last === first) {
    const inner = s.slice(1, -1);
    // Unescape: \n \t \r \\ \" \' — any other \X keeps X.
    return inner.replace(/\\(.)/g, (_match, ch: string) => {
      if (ch === "n") return "\n";
      if (ch === "t") return "\t";
      if (ch === "r") return "\r";
      return ch;
    });
  }
  // Both capitalisations on purpose. LFM2.5 emits a **Pythonic** call, so the
  // literals it writes are `True` / `False` / `None`; a finetune emitting the
  // JSON form writes `true` / `false` / `null`. Accepting only the JSON pair
  // left `safe=True` arriving at the tool as the STRING "True", which a boolean
  // parameter then rejects or, worse, reads as truthy-non-empty.
  if (s === "true" || s === "True") return true;
  if (s === "false" || s === "False") return false;
  if (s === "None" || s === "null") return null;
  // Number: integer, float, scientific notation.
  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) {
    const n = Number(s);
    if (Number.isFinite(n)) return n;
  }
  // Complex type — try JSON parse (covers {...}, [...]).
  try {
    return JSON.parse(s);
  } catch {
    // Fall back to raw string so the call is at least surfaced.
    return s;
  }
}

const PYTHON_CALL_RE = /^([A-Za-z_]\w*)\(/;

/**
 * Parse one `name(arg1=val1, arg2=val2)` Python-call chunk.
 * Returns null when the chunk is not a valid Python-call shape.
 */
function parseOnePythonCall(s: string): FallbackToolCall | null {
  const m = PYTHON_CALL_RE.exec(s);
  if (!m) return null;
  const name = m[1];
  const rest = s.slice(m[0].length);
  // rest must end with the balanced closing `)`. Walk from the start of
  // `rest` to find the matching close — the outermost open is the `(`
  // consumed by PYTHON_CALL_RE.
  let depth = 1;
  let quote: string | null = null;
  let closeIdx = -1;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (quote !== null) {
      if (c === "\\" && i + 1 < rest.length) { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx === -1) return null;
  // Anything after the closing `)` (trimmed) means junk — reject.
  if (rest.slice(closeIdx + 1).trim() !== "") return null;
  const inner = rest.slice(0, closeIdx).trim();
  if (!inner) return { name, arguments: {} };
  // Split args by top-level comma, then parse each `key=value`.
  const argChunks = splitTopLevel(inner, ",");
  const args: Record<string, unknown> = {};
  for (const chunk of argChunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue; // trailing/leading comma
    const eqIdx = findTopLevelEq(trimmed);
    if (eqIdx === -1) return null;
    const key = trimmed.slice(0, eqIdx).trim();
    if (!/^[A-Za-z_]\w*$/.test(key)) return null;
    const valStr = trimmed.slice(eqIdx + 1).trim();
    args[key] = parseArgValue(valStr);
  }
  return { name, arguments: args };
}

/**
 * Try to parse `inner` as a Python-call list: `[call1, call2, ...]`.
 *
 * Returns:
 *  - null   → content doesn't look like a Python-call list (fall through to JSON)
 *  - []     → recognised as Python-call form but empty/malformed → stop, don't JSON-fallback
 *  - calls  → successfully parsed
 *
 * Heuristic for "looks like Python": the trimmed body (inside `[...]`) starts
 * with an identifier character. JSON arrays of objects start with `{`;
 * `[123]` (not identifier-start) is not Python-call-shaped either.
 */
function tryParsePythonCallList(inner: string): FallbackToolCall[] | null {
  const trimmed = inner.trim();
  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) return null;
  const body = trimmed.slice(1, -1).trim();
  if (!body) return [];
  // First non-whitespace character decides the dialect.
  const first = body[0];
  if (first === "{" || first === "[" || first === '"') return null; // JSON territory
  if (!/[A-Za-z_]/.test(first)) return null; // not Python-call-shaped
  // Python-call territory: parse each chunk. A malformed chunk yields []
  // (do NOT fall through to JSON — that would mask the Python failure).
  const chunks = splitTopLevel(body, ",");
  const calls: FallbackToolCall[] = [];
  for (const chunk of chunks) {
    const t = chunk.trim();
    if (!t) continue; // empty (trailing comma) — skip
    const call = parseOnePythonCall(t);
    if (!call) return []; // malformed Python call — stop, don't JSON-fallback
    calls.push(call);
  }
  return calls;
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
