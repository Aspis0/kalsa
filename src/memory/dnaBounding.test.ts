import type { MemoryFact } from "./MemoryStore";
import {
  boundMemoryFacts,
  estimateMemoryTokens,
  MEMORY_SUB_BUDGET_TOKENS,
} from "./dnaBounding";

function fact(text: string, createdAt: number, id = text): MemoryFact {
  return { id, text, createdAt };
}

/** ~80 chars — under the 120 prompt cap, large enough to force deferral. */
function longText(tag: string): string {
  return (tag + "-").repeat(20).slice(0, 80);
}

function expectWithinBudget(
  r: ReturnType<typeof boundMemoryFacts>,
  budget: number,
) {
  expect(estimateMemoryTokens(r.bounded)).toBeLessThanOrEqual(budget);
}

const DAY1 = Date.UTC(2026, 0, 1);
const DAY2 = Date.UTC(2026, 0, 2);
const DAY3 = Date.UTC(2026, 0, 3);
const PROMPT_FACT_CHARS = 120;

describe("boundMemoryFacts", () => {
  test("empty store → empty block, zero counts, default budget", () => {
    const r = boundMemoryFacts([]);
    expect(r.bounded).toBe("");
    expect(r.health).toEqual({
      deferredCount: 0,
      injectedCount: 0,
      budgetTokens: MEMORY_SUB_BUDGET_TOKENS,
    });
    expect(r.keptTexts).toEqual([]);
    expectWithinBudget(r, MEMORY_SUB_BUDGET_TOKENS);
  });

  test("all-fit keeps original (oldest-first) order, not newest-first", () => {
    const r = boundMemoryFacts([
      fact("older", DAY1),
      fact("newer", DAY3),
      fact("mid", DAY2),
    ]);
    expect(r.bounded).toBe(
      "- [2026-01-01] older\n- [2026-01-03] newer\n- [2026-01-02] mid",
    );
    expect(r.health.deferredCount).toBe(0);
    expect(r.health.injectedCount).toBe(3);
    expect(r.bounded).not.toContain("older notes deferred");
    expectWithinBudget(r, MEMORY_SUB_BUDGET_TOKENS);
  });

  test("over-budget ranks newest-date-first; same-date keeps original index", () => {
    const a = fact(longText("old"), DAY1, "a");
    const b = fact(longText("bbb"), DAY2, "b");
    const c = fact(longText("ccc"), DAY2, "c");
    const joined = boundMemoryFacts([a, b, c], 10_000).bounded;
    // Tight enough to drop at least the oldest, roomy enough to keep day-2 notes.
    const budget = Math.max(
      20,
      estimateMemoryTokens(joined) - estimateMemoryTokens(a.text),
    );
    const r = boundMemoryFacts([a, b, c], budget);
    expect(r.health.deferredCount).toBeGreaterThan(0);
    expectWithinBudget(r, budget);
    const noteLines = r.bounded.split("\n").filter((line) =>
      line.startsWith("- [20"),
    );
    expect(noteLines[0]).toMatch(/^- \[2026-01-02\] /);
    const day2 = noteLines.filter((line) => line.startsWith("- [2026-01-02]"));
    expect(day2.length).toBeGreaterThan(0);
    if (day2.length === 2) {
      expect(day2[0]).toContain("bbb-");
      expect(day2[1]).toContain("ccc-");
    }
  });

  test("freeze: same input twice is byte-identical", () => {
    const facts = [
      fact("User likes espresso", DAY1),
      fact("User lives in Milan", DAY2),
      fact("User prefers Italian", DAY3),
    ];
    const a = boundMemoryFacts(facts, 8);
    const b = boundMemoryFacts(facts, 8);
    expect(a.bounded).toBe(b.bounded);
    expect(a.health).toEqual(b.health);
    expect(a.keptTexts).toEqual(b.keptTexts);
    // budget 8 < marker cost (~11): output may exceed budget (known 1g hole).
  });

  test("exactly-at-budget: no deferral, no marker", () => {
    const facts = [fact("alpha", DAY1), fact("bravo", DAY2)];
    const exact = estimateMemoryTokens(boundMemoryFacts(facts, 10_000).bounded);
    const r = boundMemoryFacts(facts, exact);
    expect(r.health.deferredCount).toBe(0);
    expect(r.health.injectedCount).toBe(2);
    expect(r.bounded).not.toContain("deferred");
    expect(r.bounded).toBe(
      "- [2026-01-01] alpha\n- [2026-01-02] bravo",
    );
    expectWithinBudget(r, exact);
  });

  test("one-past budget: defers at least one whole note, never mid-fact", () => {
    const alpha = longText("alpha-note");
    const bravo = longText("bravo-note");
    const facts = [fact(alpha, DAY1), fact(bravo, DAY2)];
    const exact = estimateMemoryTokens(boundMemoryFacts(facts, 10_000).bounded);
    const r = boundMemoryFacts(facts, exact - 1);
    expect(r.health.deferredCount).toBeGreaterThan(0);
    expect(r.health.injectedCount + r.health.deferredCount).toBe(2);
    expectWithinBudget(r, exact - 1);
    expect(r.bounded).toMatch(
      /- \[…\] \d+ older notes deferred — see Memory/,
    );
    const injected = r.bounded.split("\n").filter((line) =>
      line.startsWith("- [20"),
    );
    for (const line of injected) {
      expect(
        line === `- [2026-01-01] ${alpha}` ||
          line === `- [2026-01-02] ${bravo}`,
      ).toBe(true);
    }
  });

  test("marker count matches deferredCount; newest kept when possible", () => {
    const newest = longText("new-fact");
    const facts = [
      fact(longText("old-fact"), DAY1),
      fact(newest, DAY3),
      fact(longText("mid-fact"), DAY2),
    ];
    const full = boundMemoryFacts(facts, 10_000).bounded;
    const budget = estimateMemoryTokens(full) - 10;
    const r = boundMemoryFacts(facts, budget);
    expect(r.health.deferredCount).toBeGreaterThan(0);
    expectWithinBudget(r, budget);
    expect(r.bounded).toContain(
      `- […] ${r.health.deferredCount} older notes deferred — see Memory`,
    );
    expect(r.bounded).toContain(`- [2026-01-03] ${newest}`);
  });

  test("flattens newlines; does not truncate mid-fact (drops whole note)", () => {
    const r = boundMemoryFacts(
      [fact("line1\nline2", DAY1), fact("ok", DAY2)],
      10_000,
    );
    expect(r.bounded).toContain("- [2026-01-01] line1 line2");
    expect(r.bounded).not.toContain("\nline2");
    expectWithinBudget(r, 10_000);
  });

  test("40 facts at 120-char cap: estimate(bounded) ≤ default budget", () => {
    const cap = "x".repeat(PROMPT_FACT_CHARS);
    const facts = Array.from({ length: 40 }, (_, i) =>
      fact(cap, DAY1 + i * 86_400_000, `f${i}`),
    );
    const r = boundMemoryFacts(facts);
    expectWithinBudget(r, MEMORY_SUB_BUDGET_TOKENS);
    expect(r.health.injectedCount + r.health.deferredCount).toBe(40);
    expect(r.health.deferredCount).toBeGreaterThan(0);
  });

  test("greedy boundary: fact whose cost equals remaining budget is kept whole", () => {
    const newestText = "N".repeat(PROMPT_FACT_CHARS);
    const oldestText = "O".repeat(PROMPT_FACT_CHARS);
    const newest = fact(newestText, DAY3, "n");
    const oldest = fact(oldestText, DAY1, "o");
    const facts = [oldest, newest];
    const newestBlock = `- [2026-01-03] ${newestText}`;
    const t = estimateMemoryTokens(`\n${newestBlock}`);
    const markerReserve = estimateMemoryTokens(
      `\n- […] 2 older notes deferred — see Memory\n`,
    );
    const budget = t + markerReserve;
    expect(
      estimateMemoryTokens(boundMemoryFacts(facts, 10_000).bounded),
    ).toBeGreaterThan(budget);

    const r = boundMemoryFacts(facts, budget);
    expectWithinBudget(r, budget);
    expect(r.health.injectedCount).toBe(1);
    expect(r.health.deferredCount).toBe(1);
    expect(r.keptTexts).toEqual([newestText]);
    expect(r.bounded).toContain(newestBlock);
    expect(r.bounded).not.toContain(oldestText);
  });
});
