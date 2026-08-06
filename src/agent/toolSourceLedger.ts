/**
 * Pure per-turn tool bookkeeping: source accumulation, cite-instruction formatting,
 * and execution budget / call-key de-duplication.
 * Used by LlamaService so search + fetch share one [N] citation space.
 * No RN / engine imports — Node-harness safe.
 */

import { normalizeFetchUrl } from "../util/url";

/** Cite body kind: search lists sources; fetch lists passages from one page. */
export type CiteKind = "sources" | "passages";

/**
 * Best-effort URL from a tool source object, normalized for identity
 * (fragment / trailing slash / host case collapse to one card).
 */
export function sourceUrlOf(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const url = (source as { url?: unknown }).url;
  if (typeof url !== "string" || !url.trim()) return null;
  return normalizeFetchUrl(url) ?? url.trim();
}

export type CiteStrings = {
  errors: {
    webSearchCiteInstruction: string;
    webToolCiteInstructionMapped: string;
    webFetchCiteInstruction: string;
    /** Optional; used when passages carry PDF page numbers. */
    webFetchPdfCiteInstruction?: string;
  };
};

/** Optional extras for cite-suffix formatting (PDF page labels, etc.). */
export type CiteSuffixOptions = {
  /**
   * Distinct 1-based PDF page numbers represented in this tool outcome.
   * When present with kind "passages" and a single assigned index, the PDF
   * cite instruction names those pages so the model can write "p. 7".
   */
  pdfPages?: number[];
};

/**
 * Append outcome sources into the turn accumulator (dedup by normalized url,
 * keep first — including the first occurrence's title). URL-less sources always
 * append. Mutates `acc` in place; `merged` is the same array reference.
 * `assigned` = 1-based absolute citation indices for each `incoming` entry.
 */
export function accumulateToolSources(
  acc: unknown[],
  incoming: unknown[] | undefined,
): { merged: unknown[]; assigned: number[] } {
  if (!incoming?.length) return { merged: acc, assigned: [] };
  const assigned: number[] = [];
  for (const source of incoming) {
    const url = sourceUrlOf(source);
    if (url) {
      const existing = acc.findIndex((s) => sourceUrlOf(s) === url);
      if (existing >= 0) {
        assigned.push(existing + 1);
        continue;
      }
    }
    acc.push(source);
    assigned.push(acc.length);
  }
  return { merged: acc, assigned };
}

/**
 * Cite instruction with absolute [N] numbers for this tool outcome.
 *
 * kind "sources" (web_search): contiguous 1..n → plain webSearchCiteInstruction
 * (byte-identical for search-alone); otherwise mapped form.
 *
 * kind "passages" (web_fetch): NEVER the plain list instruction. Single assigned
 * index → webFetchCiteInstruction with {index}; multiple → mapped form.
 * When options.pdfPages is non-empty and webFetchPdfCiteInstruction is present,
 * the single-index path names those pages (e.g. "p. 1, p. 3") so the model can
 * write "p. 7" rather than a bare source number.
 */
export function buildCiteInstructionSuffix(
  assigned: number[],
  strings: CiteStrings,
  kind: CiteKind = "sources",
  options?: CiteSuffixOptions,
): string {
  if (!assigned.length) return "";

  if (kind === "passages") {
    if (assigned.length === 1) {
      const pages = normalizePdfPages(options?.pdfPages);
      const pdfTpl = strings.errors.webFetchPdfCiteInstruction;
      if (pages.length > 0 && typeof pdfTpl === "string" && pdfTpl.length > 0) {
        const pageList = pages.map((p) => `p. ${p}`).join(", ");
        return `\n\n${pdfTpl
          .replace("{index}", String(assigned[0]))
          .replace("{pages}", pageList)}`;
      }
      return `\n\n${strings.errors.webFetchCiteInstruction.replace(
        "{index}",
        String(assigned[0]),
      )}`;
    }
    const mapping = assigned.map((n, i) => `${i + 1}→[${n}]`).join(", ");
    return `\n\n${strings.errors.webToolCiteInstructionMapped.replace("{mapping}", mapping)}`;
  }

  // kind === "sources"
  const contiguousFromOne = assigned.every((n, i) => n === i + 1);
  if (contiguousFromOne) {
    return `\n\n${strings.errors.webSearchCiteInstruction}`;
  }
  const mapping = assigned.map((n, i) => `${i + 1}→[${n}]`).join(", ");
  return `\n\n${strings.errors.webToolCiteInstructionMapped.replace("{mapping}", mapping)}`;
}

/** Collect positive integer page numbers, unique, sorted ascending. */
export function normalizePdfPages(pages: unknown): number[] {
  if (!Array.isArray(pages)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  for (const p of pages) {
    if (typeof p !== "number" || !Number.isInteger(p) || p < 1) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    out.push(p);
  }
  out.sort((a, b) => a - b);
  return out;
}

/**
 * Best-effort pdfPages from tool outcome sources (provider "fetch" cards).
 * Used by LlamaService when appending the cite suffix.
 */
export function pdfPagesFromSources(sources: unknown[] | undefined): number[] {
  if (!sources?.length) return [];
  const collected: number[] = [];
  for (const source of sources) {
    if (!source || typeof source !== "object") continue;
    const pp = (source as { pdfPages?: unknown }).pdfPages;
    if (!Array.isArray(pp)) continue;
    for (const p of pp) {
      if (typeof p === "number" && Number.isInteger(p) && p >= 1) {
        collected.push(p);
      }
    }
  }
  return normalizePdfPages(collected);
}

// ── Call-key + per-turn budget (F10 / execution cap) ─────────────────────────

/** Recursively sort object keys so key order cannot evade the de-dupe set. */
export function canonicalizeArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalizeArgs);
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = canonicalizeArgs(obj[k]);
    }
    return out;
  }
  return value;
}

/**
 * Stable call key for per-turn de-duplication.
 * On parse failure, key on the raw argument string (not `{}`) so distinct
 * malformed payloads do not false-positive-collide.
 */
export function makeToolCallKey(
  name: string,
  args: Record<string, unknown>,
  options?: { rawArguments?: string; parseFailed?: boolean },
): string {
  if (options?.parseFailed) {
    return `${name}:raw:${options.rawArguments ?? ""}`;
  }
  try {
    return `${name}:${JSON.stringify(canonicalizeArgs(args ?? {}))}`;
  } catch {
    return `${name}:raw:${options?.rawArguments ?? ""}`;
  }
}

export type ToolExecDecision =
  | { action: "execute"; key: string }
  | { action: "skip_cap" }
  | { action: "skip_dup" };

/**
 * Decide whether to run a tool call under the per-turn budget + success-only
 * de-dupe set. Does not mutate state.
 */
export function decideToolExecution(
  state: { executions: number; successfulKeys: ReadonlySet<string> },
  maxExecutions: number,
  name: string,
  args: Record<string, unknown>,
  options?: { rawArguments?: string; parseFailed?: boolean },
): ToolExecDecision {
  if (state.executions >= maxExecutions) {
    return { action: "skip_cap" };
  }
  const key = makeToolCallKey(name, args, options);
  if (state.successfulKeys.has(key)) {
    return { action: "skip_dup" };
  }
  return { action: "execute", key };
}

/** After a successful tool run: count execution + remember the key. */
export function recordToolSuccess(
  state: { executions: number; successfulKeys: Set<string> },
  key: string,
): void {
  state.executions += 1;
  state.successfulKeys.add(key);
}

/**
 * After a failed tool run: count execution only (key NOT recorded so a retry
 * with the same args is still allowed within the budget).
 */
export function recordToolFailure(state: {
  executions: number;
  successfulKeys: Set<string>;
}): void {
  state.executions += 1;
}

/** Derive cite kind from the tool name (call site in LlamaService). */
export function citeKindForTool(name: string): CiteKind {
  return name === "web_fetch" ? "passages" : "sources";
}
