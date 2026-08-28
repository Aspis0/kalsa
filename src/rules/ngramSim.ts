/**
 * Hashed character 3-gram vectors + cosine.
 * Port of ciswire/src/retrieval.ts (DIM 1024, FNV-1a 32-bit). Language-independent.
 */

const DIM = 1024;

export function ngramVec(s: string, n = 3): Float32Array {
  const v = new Float32Array(DIM);
  // SOH (\x01) boundary markers — control byte, never appears in natural text.
  const t = `\x01${s.toLowerCase().replace(/\s+/g, " ")}\x01`;
  for (let i = 0; i <= t.length - n; i++) {
    let h = 2166136261; // FNV-1a
    for (let j = i; j < i + n; j++) {
      h ^= t.charCodeAt(j);
      h = Math.imul(h, 16777619);
    }
    v[(h >>> 0) % DIM] += 1;
  }
  const norm = Math.hypot(...v);
  if (norm > 0) for (let i = 0; i < DIM; i++) v[i] /= norm;
  return v;
}

export const cosine = (a: Float32Array, b: Float32Array): number => {
  let s = 0;
  for (let i = 0; i < DIM; i++) s += a[i] * b[i];
  return s;
};
