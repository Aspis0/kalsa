/**
 * Pure per-turn tool-source accumulation + cite-instruction formatting.
 * Used by LlamaService so search + fetch share one [N] citation space.
 * No RN / engine imports — Node-harness safe.
 */

/** Best-effort URL from a tool source object (for per-turn dedup). */
export function sourceUrlOf(source: unknown): string | null {
  if (!source || typeof source !== "object") return null;
  const url = (source as { url?: unknown }).url;
  return typeof url === "string" && url.trim() ? url.trim() : null;
}

export type CiteStrings = {
  errors: {
    webSearchCiteInstruction: string;
    webToolCiteInstructionMapped: string;
  };
};

/**
 * Append outcome sources into the turn accumulator (dedup by url, keep first —
 * including the first occurrence's title). URL-less sources are always appended.
 * Mutates `acc` in place; `merged` is the same array reference.
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
 * When numbers are exactly 1..n (search alone / first sources of the turn),
 * reuse webSearchCiteInstruction byte-for-byte. Otherwise emit a mapped form
 * so fetch-after-search cites [K] correctly.
 */
export function buildCiteInstructionSuffix(
  assigned: number[],
  strings: CiteStrings,
): string {
  if (!assigned.length) return "";
  const contiguousFromOne = assigned.every((n, i) => n === i + 1);
  if (contiguousFromOne) {
    return `\n\n${strings.errors.webSearchCiteInstruction}`;
  }
  const mapping = assigned.map((n, i) => `${i + 1}→[${n}]`).join(", ");
  return `\n\n${strings.errors.webToolCiteInstructionMapped.replace("{mapping}", mapping)}`;
}
