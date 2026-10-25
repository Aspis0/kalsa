import { grams, gramsOf } from "./grams";

// The Okapi constants every BM25 paper starts from.
const K1 = 1.2;
const B = 0.75;

/**
 * BM25 of the query against each unit, over character grams. Scores are
 * relative to the units given: the same query against another set of units
 * scores differently, which is why the caller picks the units it searches.
 * A unit that shares no gram with the query scores exactly 0.
 *
 * **The units are their words, already folded**: a unit is searched with the
 * words of its sentence and its neighbours, and folding them again for every
 * reading is the work that grows with the cut.
 */
export function scoreUnits(units: string[][], query: string): number[] {
  const queryTerms = new Set(grams(query));
  const docs: Map<string, number>[] = [];
  const lengths: number[] = [];
  const documentFrequency = new Map<string, number>();
  for (const words of units) {
    const terms = gramsOf(words);
    lengths.push(terms.length);
    // **Only the query's terms are counted.** The score is the query's terms
    // against the unit, so a term the query does not carry is worth nothing
    // to it — and counting every term of every unit is the work that grows
    // with the cut.
    const own = new Map<string, number>();
    for (const term of terms) {
      if (!queryTerms.has(term)) continue;
      own.set(term, (own.get(term) ?? 0) + 1);
    }
    for (const term of own.keys()) documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    docs.push(own);
  }
  const count = docs.length;
  const average = count === 0 ? 0 : lengths.reduce((sum, n) => sum + n, 0) / count;
  // **The weight of a term is drawn once.** It depends on the cut and on the
  // query, not on the unit being read, so the same term has the same weight
  // for every unit.
  const weights = new Map<string, number>();
  for (const term of queryTerms) {
    const df = documentFrequency.get(term) ?? 0;
    weights.set(term, Math.log(1 + (count - df + 0.5) / (df + 0.5)));
  }
  return docs.map((doc, i) => {
    let score = 0;
    for (const [term, frequency] of doc) {
      const norm = frequency + K1 * (1 - B + (B * lengths[i]) / average);
      score += (weights.get(term) ?? 0) * ((frequency * (K1 + 1)) / norm);
    }
    return score;
  });
}
