/**
 * Biting recall test for the hybrid char-3-gram leg of RetrieverIndex.
 * Pure Node — no React Native.
 *
 * Fixture design: the query is built from vowel-only tokens and the mark from
 * consonant-only tokens, so the two share NO exact 3-/4-gram
 * (sharedGramCount === 0, below MIN_SHARED_GRAMS) while still colliding in the
 * FNV-1a 1024-bucket space (cosine > 0). That isolates the hashed-bucket signal
 * from exact-gram overlap — precisely the case the BM25-leg cutoff hides.
 */

import {
  MIN_SHARED_GRAMS,
  RetrieverIndex,
  ngramCounts,
  normalize,
  sharedGramCount,
  type RetrievalUnit,
} from "./retriever";
import { cosine, ngramVec } from "./ngramRank";

const QUERY = "eia oue aio uea oai eou uia oae eio uao aeu oiu eai uoe";
const MARK = "klt bdf ghm npq stv wzc xkm bdg hln prs tvw zcf kmn bdf hlp rstv";
/** Lexically close to QUERY, so BM25 keeps it in both modes. */
const LEXICAL_HIT = "eia oue aio uea oai eou uia oae";

function indexOf(units: RetrievalUnit[]): RetrieverIndex {
  const idx = new RetrieverIndex();
  idx.append(units);
  return idx;
}

/** The fixture must sit below the BM25 cutoff and still have bucket overlap. */
function markIsCutoffFrom(query: string, mark: string, minCosine: number): void {
  const shared = sharedGramCount(
    ngramCounts(normalize(query)),
    ngramCounts(normalize(mark)),
  );
  expect(shared).toBeLessThan(MIN_SHARED_GRAMS);
  expect(
    cosine(ngramVec(normalize(query)), ngramVec(normalize(mark))),
  ).toBeGreaterThan(minCosine);
}

/**
 * Deterministic search for filler docs whose hashed bucket set is disjoint from
 * the query's (cosine exactly 0, so also zero shared exact grams). A fixed LCG
 * makes the same fillers every run; the caller asserts the count, so a failed
 * search fails loudly instead of silently weakening the test.
 */
function zeroCosineFillers(query: string, count: number): string[] {
  const qVec = ngramVec(normalize(query));
  const alphabet = "bcdfghjklmnpqrstvwxyz0123456789";
  let seed = 0x2f6e2b1;
  const next = (): number => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const out: string[] = [];
  for (let t = 0; t < 20000 && out.length < count; t++) {
    let s = "";
    for (let k = 0; k < 14; k++) {
      s += alphabet[Math.floor(next() * alphabet.length)];
    }
    s = `${s.slice(0, 4)} ${s.slice(4, 9)} ${s.slice(9)}`;
    if (cosine(qVec, ngramVec(normalize(s))) === 0) out.push(s);
  }
  return out;
}

describe("RetrieverIndex hybrid dense leg", () => {
  test("hybrid recalls a doc the shared-gram cutoff drops, bm25 does not", () => {
    markIsCutoffFrom(QUERY, MARK, 0.05);

    const idx = indexOf([
      { turnIndex: 0, role: "user", text: LEXICAL_HIT },
      { turnIndex: 1, role: "user", text: MARK },
    ]);
    const base = { topN: 2, maxCharsPerSnippet: 400 };

    // Hybrid: the char 3-gram leg ranks EVERY doc, so the mark surfaces, and
    // the union still keeps the BM25 hit ahead of it.
    const hybrid = idx.retrieve(QUERY, { ...base, ranking: "hybrid" });
    expect(hybrid.map((r) => r.turnIndex)).toEqual([0, 1]);

    // BM25: the cutoff drops the mark, which is the old behavior we compare to.
    const bm25 = idx.retrieve(QUERY, { ...base, ranking: "bm25" });
    expect(bm25.map((r) => r.turnIndex)).toEqual([0]);

    // No BM25 candidate at all: only the ungated dense leg can answer.
    const markOnly = indexOf([{ turnIndex: 0, role: "assistant", text: MARK }]);
    expect(
      markOnly.retrieve(QUERY, { topN: 1, ranking: "hybrid" }).map((r) => r.turnIndex),
    ).toEqual([0]);
    expect(markOnly.retrieve(QUERY, { topN: 1, ranking: "bm25" })).toEqual([]);
  });

  test("evicting one of two docs with identical text keeps the retained doc's dense vector", () => {
    markIsCutoffFrom(QUERY, MARK, 0.05);

    // Identical normalized text: the vector cache entry is shared by both docs.
    const idx = indexOf([
      { turnIndex: 0, role: "user", text: MARK },
      { turnIndex: 1, role: "user", text: MARK },
    ]);
    expect(idx.documentCount).toBe(2);

    idx.dropOldestUnits(1);
    expect(idx.documentCount).toBe(1);

    // The survivor must still be scored by the dense leg: score > 0 means its
    // cached vector survived the eviction of the doc that shared its text.
    const results = idx.retrieve(QUERY, {
      topN: 1,
      maxCharsPerSnippet: 400,
      ranking: "hybrid",
    });
    expect(results.map((r) => r.turnIndex)).toEqual([1]);
    expect(results[0].score).toBeGreaterThan(0);
  });

  test("hybrid never outputs a zero-cosine doc (dense noise floor)", () => {
    const fillers = zeroCosineFillers(QUERY, 4);
    expect(fillers).toHaveLength(4);
    for (const f of fillers) {
      // Honest fixture: zero bucket overlap AND zero shared exact grams.
      expect(cosine(ngramVec(normalize(QUERY)), ngramVec(normalize(f)))).toBe(0);
      expect(sharedGramCount(ngramCounts(normalize(QUERY)), ngramCounts(normalize(f)))).toBe(0);
    }

    const idx = indexOf([
      ...fillers.map((text, i) => ({ turnIndex: i, role: "user" as const, text })),
      { turnIndex: 99, role: "user", text: LEXICAL_HIT },
    ]);
    expect(idx.documentCount).toBe(fillers.length + 1);

    // topN is larger than the number of real hits, so without a floor the
    // zero-cosine fillers would fill the leftover slots.
    const results = idx.retrieve(QUERY, {
      topN: 8,
      maxCharsPerSnippet: 400,
      ranking: "hybrid",
    });
    expect(results.map((r) => r.turnIndex)).toEqual([99]);
  });
});
