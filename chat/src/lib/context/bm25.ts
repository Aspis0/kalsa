import { grams } from "./grams";

// The Okapi constants every BM25 paper starts from.
const K1 = 1.2;
const B = 0.75;

/**
 * BM25 of the query against each unit, over character grams. Scores are
 * relative to the units given: the same query against another set of units
 * scores differently, which is why the caller picks the units it searches.
 * A unit that shares no gram with the query scores exactly 0.
 */
export function scoreUnits(units: string[], query: string): number[] {
  const docs = units.map((text) => termCounts(grams(text)));
  const lengths = docs.map((doc) => doc.total);
  const count = docs.length;
  const average = count === 0 ? 0 : lengths.reduce((sum, n) => sum + n, 0) / count;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.counts.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const queryTerms = new Set(grams(query));
  return docs.map((doc, i) => {
    let score = 0;
    for (const term of queryTerms) {
      const frequency = doc.counts.get(term);
      if (frequency === undefined) continue;
      const df = documentFrequency.get(term) ?? 0;
      const idf = Math.log(1 + (count - df + 0.5) / (df + 0.5));
      const norm = frequency + K1 * (1 - B + (B * lengths[i]) / average);
      score += idf * ((frequency * (K1 + 1)) / norm);
    }
    return score;
  });
}

function termCounts(terms: string[]): { counts: Map<string, number>; total: number } {
  const counts = new Map<string, number>();
  for (const term of terms) counts.set(term, (counts.get(term) ?? 0) + 1);
  return { counts, total: terms.length };
}
