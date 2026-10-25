/**
 * The one call a whole answer was, recovered so it can run and the turn can
 * go on — and nothing else. Answer text is the channel a fetched page can
 * speak into, so the contract is deliberately narrow: after trimming, the
 * text must BE the call, exactly, in one of two dialects —
 *
 *     <tool_call>                     (wrapper optional)
 *     <function=web_search>
 *     <parameter=query>
 *     weather in Tokyo today
 *     </parameter>
 *     </function>
 *     </tool_call>
 *
 * or one JSON object (`<tool_call>{"name":…}</tool_call>`, or the bare
 * object itself). No prose before or after, no code fence, no quotation —
 * an example shown to the reader is not an action, and a text over the cap
 * is not even parsed.
 *
 * Trust nothing else either: a name is kept only when this request offered
 * it, values are used exactly as they parse, and two calls in one text mean
 * no call at all — which the model meant is not ours to guess.
 */

import { canonicalToolName } from "./repairToolCall";

export interface RecoveredCall {
  /** The offered name, in the request's own casing. */
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * A hard bound on what is parsed, not a judgement about call size: a
 * prettified call can be many times its compact form (a create_miniapp
 * payload measured 9 015 chars indented, 2 671 compact), so the raw text
 * gets eight times the arguments cap, and the real size rule — the arguments
 * cap itself — is applied to the recovered call by the loop.
 */
const MAX_TEXT = 32_768;

/**
 * The call `text` wholly is, or null: prose, a fence, a quotation, an
 * over-cap text, an unoffered name, two calls, anything unparsable. The tag
 * dialect's values are strings; repairToolCall coerces them against the
 * schema once the call runs.
 */
export function recoverToolCall(text: string, offered: readonly string[]): RecoveredCall | null {
  if (offered.length === 0) return null;
  const whole = typeof text === "string" ? text.trim() : "";
  if (whole.length === 0 || whole.length > MAX_TEXT) return null;

  // One optional <tool_call> wrapper, anchored at both ends: a wrapper that
  // opens but does not close is not a call, and neither is one with prose
  // before it.
  const unwrapped = whole.replace(/^<tool_call\b[^>]*>([\s\S]*)<\/tool_call>$/i, "$1").trim();
  const body = unwrapped.length < whole.length ? unwrapped : whole;

  if (body.startsWith("<function")) {
    const block = /^<function=([^>]+)>([\s\S]*)<\/function>$/.exec(body);
    // A second opening inside means two calls: ambiguous, so no call.
    if (block === null || block[2]!.includes("<function=")) return null;
    return parseTags(block[1]!.trim(), block[2]!, offered);
  }
  if (body.startsWith("{")) {
    // The whole body must parse: trailing prose after the object fails here.
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      return null;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return fromRecord(parsed as Record<string, unknown>, offered);
  }
  return null;
}

function parseTags(
  rawName: string,
  body: string,
  offered: readonly string[],
): RecoveredCall | null {
  const name = canonicalToolName(rawName, offered);
  if (name === null) return null;
  // Null prototype: a parameter literally named __proto__ is data here, not
  // an assignment to the object's prototype.
  const args: Record<string, unknown> = Object.create(null);
  for (const param of body.matchAll(/<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g)) {
    args[param[1]!.trim()] = param[2]!.trim();
  }
  return { name, arguments: args };
}

/** One JSON record to a call: a name key the request offered, then the
    payload under `arguments` (object, or a JSON string holding one), or the
    remaining keys themselves. */
function fromRecord(rec: Record<string, unknown>, offered: readonly string[]): RecoveredCall | null {
  const nameRaw = pickString(rec, "name", "tool", "tool_name", "toolName", "function");
  if (nameRaw === null) return null;
  const name = canonicalToolName(nameRaw, offered);
  if (name === null) return null;

  const carried = rec.arguments ?? rec.args ?? rec.parameters ?? rec.input ?? rec.params;
  if (typeof carried === "string") {
    try {
      const inner = JSON.parse(carried);
      if (inner === null || typeof inner !== "object" || Array.isArray(inner)) return null;
      return { name, arguments: { ...(inner as Record<string, unknown>) } };
    } catch {
      return null;
    }
  }
  if (carried !== null && typeof carried === "object" && !Array.isArray(carried)) {
    return { name, arguments: { ...(carried as Record<string, unknown>) } };
  }
  if (carried !== undefined) return null;
  // Flat shape: the call is one object, its payload the keys beside the name.
  const args: Record<string, unknown> = Object.create(null);
  for (const [k, v] of Object.entries(rec)) {
    if (!["name", "tool", "tool_name", "toolName", "function"].includes(k)) args[k] = v;
  }
  return { name, arguments: args };
}

function pickString(rec: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = rec[key];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return null;
}
