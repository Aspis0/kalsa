/**
 * Hashed character 3-gram ranking for hybrid retrieval.
 * Ported from /Users/marco/Projects/ciswire/src/retrieval.ts to preserve
 * exact hashing and normalization behavior as a reference implementation.
 *
 * Why duplicated: ciswire is a separate project; importing would create a
 * cross-project dependency. This is a pure reference implementation whose
 * FNV-1a hashing, boundary markers, and L2 normalization must be preserved
 * for reproducible ranking behavior.
 */

export const DIM = 1024;

/**
 * FNV-1a hashed character 3-gram vector, L2-normalized.
 * Uses \x01 as boundary marker (SOH control byte, never in natural text).
 * Replaces Math.hypot(...v) with a loop to avoid stack overflow on 1024 args.
 */
export function ngramVec(s: string, n = 3): Float32Array {
  const v = new Float32Array(DIM);
  const t = `\x01${s.toLowerCase().replace(/\s+/g, ' ')}\x01`;
  for (let i = 0; i <= t.length - n; i++) {
    let h = 2166136261; // FNV-1a offset basis
    for (let j = i; j < i + n; j++) {
      h ^= t.charCodeAt(j);
      h = Math.imul(h, 16777619); // FNV-1a prime
    }
    v[(h >>> 0) % DIM] += 1;
  }
  // L2 normalization: loop instead of Math.hypot(...v) to avoid stack overflow
  // on 1024 arguments. On Hermes a 1024-arg spread is slow or hits argument limit.
  let sum = 0;
  for (let i = 0; i < DIM; i++) {
    sum += v[i] * v[i];
  }
  const norm = Math.sqrt(sum);
  if (norm > 0) {
    for (let i = 0; i < DIM; i++) {
      v[i] /= norm;
    }
  }
  return v;
}

/**
 * Cosine similarity between two L2-normalized vectors.
 * For normalized vectors, cosine = dot product.
 */
export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < DIM; i++) {
    s += a[i] * b[i];
  }
  return s;
}

/**
 * Reciprocal Rank Fusion (Cormack 2009).
 * Combines multiple ranked lists into a single ranked map.
 * Score for each item: sum of 1/(k + rank) across all lists.
 */
export function rrf(rankings: string[][], k = 60): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankings) {
    list.forEach((id, i) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + i + 1));
    });
  }
  return new Map([...scores].sort((a, b) => b[1] - a[1]));
}
