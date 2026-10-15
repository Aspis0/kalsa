import { PROMPT_FACT_CHARS } from "../memory/dnaBounding";

/**
 * Scan `source` for the first balanced `{...}` object (string-aware).
 * Ported from domain/askAssistant.js findBalancedJsonObject — first-{/last-}
 * is unsafe when braces appear inside strings or trailing prose.
 */
function findBalancedJsonObject(
  source: string,
  start = 0,
): { start: number; end: number; text: string } | null {
  const len = source.length;
  let i = start;
  while (i < len) {
    const open = source.indexOf("{", i);
    if (open < 0) return null;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let j = open; j < len; j += 1) {
      const ch = source[j];
      if (inString) {
        if (escape) {
          escape = false;
          continue;
        }
        if (ch === "\\") {
          escape = true;
          continue;
        }
        if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") {
        depth += 1;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          return { start: open, end: j + 1, text: source.slice(open, j + 1) };
        }
        if (depth < 0) break;
      }
    }
    i = open + 1;
  }
  return null;
}

/** Parse outcome: 0=did not run, 1=parsed OK, 2=parser rejected. */
export type MemoryParseOutcome = 0 | 1 | 2;

/** Parse model JSON for memory extract — fail-closed, balanced first object.
 *  Returns {add, remove, parseOutcome} where parseOutcome distinguishes
 *  "valid JSON, zero items" (1) from "parser rejected" (2). */
export function parseMemoryExtract(raw: string): { add: string[]; remove: string[]; parseOutcome: MemoryParseOutcome } {
  if (!raw || typeof raw !== "string") return { add: [], remove: [], parseOutcome: 0 };
  // Strip optional think tags / fences, then find the first balanced JSON object.
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/g, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  const found = findBalancedJsonObject(cleaned, 0);
  if (!found) return { add: [], remove: [], parseOutcome: 2 };
  try {
    const parsed = JSON.parse(found.text) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { add: [], remove: [], parseOutcome: 2 };
    }
    const obj = parsed as { add?: unknown; remove?: unknown };
    const add = Array.isArray(obj.add)
      ? obj.add
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.replace(/\s+/g, " ").trim().slice(0, PROMPT_FACT_CHARS))
          .filter((item) => item.length > 0)
          .slice(0, 3)
      : [];
    const remove = Array.isArray(obj.remove)
      ? obj.remove
          .filter((item): item is string => typeof item === "string")
          .map((item) => item.replace(/\s+/g, " ").trim())
          .filter((item) => item.length > 0)
          .slice(0, 10)
      : [];
    return { add, remove, parseOutcome: 1 };
  } catch {
    return { add: [], remove: [], parseOutcome: 2 };
  }
}
