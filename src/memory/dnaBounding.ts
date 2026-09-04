/**
 * CisWire DNA sub-budget, adapted to Kalsa MemoryFact[].
 *
 * Injection-only: the store is never rewritten. Dates are derived from
 * createdAt at format time (UTC YYYY-MM-DD). Whole notes only — never
 * truncate mid-fact. Same fact set → byte-identical output (freeze).
 */

import type { MemoryFact } from "./MemoryStore";

/**
 * Token sub-budget for injected memory notes.
 * Injection caps each fact at 120 chars; worst case
 * 40 × (120 + 16 label) = 5440 chars ≈ 1360 est tokens, so 1200 defers overflow.
 * (Store allows 200 chars/fact; 40 × 200 / 4 = 2000 — that is not the injection cost.)
 */
export const MEMORY_SUB_BUDGET_TOKENS = 1200;

/** Kalsa chars/4 estimate — not CisWire's CJK-aware estimator. */
const CHARS_PER_TOKEN = 4;

/** Same cap the last-user tail used before bounding. */
const PROMPT_FACT_CHARS = 120;

export type DnaBoundHealth = {
  deferredCount: number;
  injectedCount: number;
  budgetTokens: number;
};

export type DnaBoundResult = {
  bounded: string;
  health: DnaBoundHealth;
  keptTexts: string[];
};

type RankedNote = {
  date: string;
  block: string;
  text: string;
  index: number;
};

export function estimateMemoryTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

function dateLabel(createdAt: number): string {
  if (!Number.isFinite(createdAt)) return "1970-01-01";
  return new Date(createdAt).toISOString().slice(0, 10);
}

function sanitizeFactText(text: string): string {
  return text
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PROMPT_FACT_CHARS);
}

function deferralMarker(n: number): string {
  return `\n- […] ${n} older notes deferred — see Memory\n`;
}

function healthOf(
  deferredCount: number,
  injectedCount: number,
  budgetTokens: number,
): DnaBoundHealth {
  return { deferredCount, injectedCount, budgetTokens };
}

function toNotes(facts: readonly MemoryFact[]): RankedNote[] {
  const notes: RankedNote[] = [];
  for (let i = 0; i < facts.length; i++) {
    const fact = facts[i]!;
    const text = sanitizeFactText(fact.text);
    if (!text) continue;
    const date = dateLabel(fact.createdAt);
    notes.push({
      date,
      block: `- [${date}] ${text}`,
      text,
      index: i,
    });
  }
  return notes;
}

/**
 * Bound MemoryFact[] to a token sub-budget. Newest-date-first when notes
 * must be dropped; original order when everything fits (freeze-safe).
 */
export function boundMemoryFacts(
  facts: readonly MemoryFact[],
  budgetTokens: number = MEMORY_SUB_BUDGET_TOKENS,
): DnaBoundResult {
  const notes = toNotes(facts);
  if (notes.length === 0) {
    return {
      bounded: "",
      health: healthOf(0, 0, budgetTokens),
      keptTexts: [],
    };
  }

  const original = notes.map((n) => n.block).join("\n");
  const allTexts = notes.map((n) => n.text);
  if (estimateMemoryTokens(original) <= budgetTokens) {
    return {
      bounded: original,
      health: healthOf(0, notes.length, budgetTokens),
      keptTexts: allTexts,
    };
  }

  const ranked = [...notes].sort((a, b) => {
    if (a.date !== b.date) return a.date > b.date ? -1 : 1;
    return a.index - b.index;
  });

  const effective = budgetTokens - estimateMemoryTokens(deferralMarker(notes.length));
  let used = 0;
  const kept: RankedNote[] = [];
  let deferred = 0;
  for (const note of ranked) {
    const t = estimateMemoryTokens(`\n${note.block}`);
    if (used + t <= effective) {
      kept.push(note);
      used += t;
    } else {
      deferred++;
    }
  }

  if (deferred === 0) {
    return {
      bounded: original,
      health: healthOf(0, notes.length, budgetTokens),
      keptTexts: allTexts,
    };
  }

  const body = kept.map((n) => n.block).join("\n");
  const bounded = body + deferralMarker(deferred);
  return {
    bounded,
    health: healthOf(deferred, kept.length, budgetTokens),
    keptTexts: kept.map((n) => n.text),
  };
}
