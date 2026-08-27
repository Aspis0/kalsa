/**
 * Deep-research planner: parse a 4B JSON plan, or expand the question
 * mechanically. Pure TypeScript — no engine, no RN.
 */

export const DEEP_RESEARCH_TRIGGER = /\bdeep research\b|\bricerca approfondita\b/i;

const MIN_SUBQUERIES = 3;
const MAX_SUBQUERIES = 5;
const MAX_WORDS = 12;
const JACCARD_DUP = 0.85;

export function hasDeepResearchTrigger(text: string): boolean {
  return typeof text === "string" && DEEP_RESEARCH_TRIGGER.test(text);
}

export function stripDeepResearchTrigger(text: string): string {
  if (typeof text !== "string") return "";
  return text.replace(DEEP_RESEARCH_TRIGGER, " ").replace(/\s+/g, " ").trim();
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9àèéìòùäöüß]+/gi, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount(s: string): number {
  return tokenize(s).length;
}

export function jaccardPhrases(a: string, b: string): number {
  const A = new Set(tokenize(a));
  const B = new Set(tokenize(b));
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter += 1;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function fallbackSubqueries(question: string): string[] {
  const q = question.replace(/\s+/g, " ").trim();
  if (!q) return [];
  return [
    q,
    `${q} definition meaning`,
    `${q} mechanism evidence results`,
    `${q} comparison limitations`,
    `${q} who when`,
  ]
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter((s) => s.length > 0)
    .slice(0, MAX_SUBQUERIES);
}

export function sanitizeSubqueries(raw: unknown[], question: string): string[] {
  const out: string[] = [];
  for (const item of raw) {
    const s = typeof item === "string" ? item.replace(/\s+/g, " ").trim() : "";
    if (!s) continue;
    if (wordCount(s) > MAX_WORDS) continue;
    if (out.some((prev) => jaccardPhrases(s, prev) >= JACCARD_DUP)) continue;
    if (out.length > 0 && jaccardPhrases(s, question) >= JACCARD_DUP) continue;
    out.push(s);
    if (out.length >= MAX_SUBQUERIES) break;
  }
  return out;
}

function extractJsonObject(raw: string): unknown | null {
  const cleaned = raw
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .replace(/```/g, "")
    .trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as unknown;
  } catch {
    /* fall through */
  }
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
    } catch {
      return null;
    }
  }
  return null;
}

/** Parse planner JSON. Returns null when the plan is unusable (caller falls back). */
export function parsePlannerOutput(raw: string, question: string): string[] | null {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const list = (parsed as { subqueries?: unknown }).subqueries;
  if (!Array.isArray(list)) return null;
  const sanitized = sanitizeSubqueries(list, question);
  if (sanitized.length < MIN_SUBQUERIES) return null;
  return sanitized;
}

// (planSubqueries was dead code — removed. Call parsePlannerOutput and
// fall back to fallbackSubqueries() at the call site.)

export const PLANNER_JSON_SCHEMA = {
  type: "object",
  properties: {
    subqueries: {
      type: "array",
      items: { type: "string" },
      minItems: MIN_SUBQUERIES,
      maxItems: MAX_SUBQUERIES,
    },
  },
  required: ["subqueries"],
  additionalProperties: false,
} as const;
