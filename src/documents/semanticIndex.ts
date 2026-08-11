/**
 * Pure hybrid-retrieval core (node-testable, no React / RN at module scope).
 *
 * - SemanticVectorIndex: brute-force cosine over L2-normalized fp32 vectors
 * - e5 prefix helpers (query: / passage:)
 * - rrfFuse: Reciprocal Rank Fusion (Cormack et al. 2009), k=60 default
 * - planIncrementalEmbed: content-hash planner for incremental embedding
 *
 * Conventions (locked for EmbeddingService consumers):
 *
 * 1. L2 normalization is DEFENSIVE on both addVectors and query.
 *    Callers may pass raw or already-normalized vectors; we re-normalize
 *    (zero / non-finite vectors become the zero vector and score 0).
 *    Cosine on unit vectors = dot product.
 *
 * 2. rrfFuse ranks are 0-BASED from callers (array index / top-N position).
 *    The RRF formula uses 1-based rank position:
 *      score(d) = Σ_arm  w_arm / (k + rank_1based(d))
 *               = Σ_arm  w_arm / (k + rank_0based(d) + 1)
 *    Absent arm contributes 0. Default k=60, weights=1. Sorted desc.
 *    Matches existing retrievalLoop (rankInRound 1-based → 1/(RRF_K+rank)).
 */

export type SemanticVectorIndexOpts = { dims: number };

export class SemanticVectorIndex {
  readonly dims: number;
  /** chunkId → L2-normalized vector (length = dims). */
  private readonly store = new Map<string, Float32Array>();

  constructor(opts: SemanticVectorIndexOpts) {
    const d = opts?.dims;
    if (typeof d !== "number" || !Number.isFinite(d) || d <= 0) {
      throw new Error(`SemanticVectorIndex: dims must be a positive finite number, got ${d}`);
    }
    this.dims = Math.floor(d);
  }

  get chunkCount(): number {
    return this.store.size;
  }

  /**
   * Insert or replace vectors. Dedupe by chunkId (last write wins).
   * Vectors are L2-normalized on add; wrong-length / non-finite entries are skipped.
   */
  addVectors(items: { chunkId: string; vector: Float32Array }[]): void {
    if (!Array.isArray(items) || items.length === 0) return;
    for (const item of items) {
      if (!item || typeof item.chunkId !== "string" || item.chunkId.length === 0) continue;
      const v = item.vector;
      if (!(v instanceof Float32Array) || v.length !== this.dims) continue;
      this.store.set(item.chunkId, l2Normalize(v, this.dims));
    }
  }

  removeChunk(chunkId: string): void {
    if (typeof chunkId !== "string" || chunkId.length === 0) return;
    this.store.delete(chunkId);
  }

  /**
   * Brute-force cosine (dot product of L2-normalized vectors).
   * Query vector is defensively re-normalized. Returns topN results sorted by
   * score descending; ties keep insertion order of the store iteration.
   * Empty index / topN<=0 / bad query → [].
   */
  query(queryVector: Float32Array, topN: number): { chunkId: string; score: number }[] {
    if (this.store.size === 0) return [];
    if (!(queryVector instanceof Float32Array) || queryVector.length !== this.dims) return [];
    const n = Math.floor(Number(topN));
    if (!Number.isFinite(n) || n <= 0) return [];

    const q = l2Normalize(queryVector, this.dims);
    // Zero query → all scores 0; still return something stable if requested.
    const scored: { chunkId: string; score: number }[] = [];
    for (const [chunkId, vec] of this.store) {
      scored.push({ chunkId, score: dot(q, vec) });
    }
    scored.sort((a, b) => b.score - a.score || (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0));
    return scored.slice(0, n);
  }

  /**
   * Round-trip persistence: plain serializable shape (fp32 as number[]).
   * Order is deterministic (sorted by chunkId) so snapshots are stable.
   */
  toJSON(): { dims: number; vectors: { chunkId: string; vector: number[] }[] } {
    const vectors: { chunkId: string; vector: number[] }[] = [];
    const ids = Array.from(this.store.keys()).sort();
    for (const chunkId of ids) {
      const v = this.store.get(chunkId)!;
      vectors.push({ chunkId, vector: Array.from(v) });
    }
    return { dims: this.dims, vectors };
  }

  static fromJSON(data: ReturnType<SemanticVectorIndex["toJSON"]>): SemanticVectorIndex {
    const dims = data?.dims;
    if (typeof dims !== "number" || !Number.isFinite(dims) || dims <= 0) {
      throw new Error(`SemanticVectorIndex.fromJSON: invalid dims ${dims}`);
    }
    const idx = new SemanticVectorIndex({ dims: Math.floor(dims) });
    const items = Array.isArray(data?.vectors) ? data.vectors : [];
    const packed: { chunkId: string; vector: Float32Array }[] = [];
    for (const row of items) {
      if (!row || typeof row.chunkId !== "string") continue;
      if (!Array.isArray(row.vector) || row.vector.length !== idx.dims) continue;
      const f = new Float32Array(idx.dims);
      for (let i = 0; i < idx.dims; i++) {
        const x = row.vector[i];
        f[i] = typeof x === "number" && Number.isFinite(x) ? x : 0;
      }
      packed.push({ chunkId: row.chunkId, vector: f });
    }
    idx.addVectors(packed);
    return idx;
  }
}

/**
 * L2-normalize a vector into a new Float32Array of length `dims`.
 * Non-finite components → 0. Zero / near-zero norm → zero vector.
 */
function l2Normalize(src: Float32Array, dims: number): Float32Array {
  const out = new Float32Array(dims);
  let sumSq = 0;
  for (let i = 0; i < dims; i++) {
    const x = src[i];
    const v = typeof x === "number" && Number.isFinite(x) ? x : 0;
    out[i] = v;
    sumSq += v * v;
  }
  if (sumSq <= 0 || !Number.isFinite(sumSq)) {
    out.fill(0);
    return out;
  }
  const inv = 1 / Math.sqrt(sumSq);
  for (let i = 0; i < dims; i++) out[i] *= inv;
  return out;
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = a.length;
  for (let i = 0; i < n; i++) s += a[i]! * b[i]!;
  return s;
}

// ── e5 protocol prefixes ────────────────────────────────────────────────────

const QUERY_PREFIX = "query: ";
const PASSAGE_PREFIX = "passage: ";

/**
 * e5 query prefix. Idempotent: if `text` already starts with "query: ", returned as-is.
 * `cfg.model` reserved for future EmbeddingGemma (no-op today; only "e5" recognized).
 */
export function embedQueryPrefix(text: string, cfg?: { model?: "e5" }): string {
  void cfg;
  const t = typeof text === "string" ? text : "";
  if (t.startsWith(QUERY_PREFIX)) return t;
  return QUERY_PREFIX + t;
}

/**
 * e5 document/passage prefix. Idempotent for "passage: ".
 * Model-agnostic hook: EmbeddingGemma may later drop or change prefixes.
 */
export function embedDocPrefix(text: string, cfg?: { model?: "e5" }): string {
  void cfg;
  const t = typeof text === "string" ? text : "";
  if (t.startsWith(PASSAGE_PREFIX)) return t;
  return PASSAGE_PREFIX + t;
}

// ── Reciprocal Rank Fusion ──────────────────────────────────────────────────

export type RrfFuseOptions = {
  /** RRF constant; default 60 (Cormack et al. 2009). */
  k?: number;
  /** Weight for the sparse (BM25) arm; default 1. */
  sparseWeight?: number;
  /** Weight for the dense (embedding) arm; default 1. */
  denseWeight?: number;
};

/**
 * Reciprocal Rank Fusion over two ranked lists.
 *
 * Callers pass **0-based** ranks (0 = best). The formula converts to 1-based:
 *   score(d) = w_s/(k + rank_s + 1) + w_d/(k + rank_d + 1)
 * Missing arm contributes 0. Returns unique chunkIds sorted by score desc.
 * Empty inputs → []. Bad ranks / non-finite weights fall back to safe defaults.
 */
export function rrfFuse(
  sparse: { chunkId: string; rank: number }[],
  dense: { chunkId: string; rank: number }[],
  opts?: RrfFuseOptions,
): { chunkId: string; score: number }[] {
  const kRaw = opts?.k;
  const k =
    typeof kRaw === "number" && Number.isFinite(kRaw) && kRaw >= 0 ? kRaw : 60;
  const wsRaw = opts?.sparseWeight;
  const wdRaw = opts?.denseWeight;
  const ws =
    typeof wsRaw === "number" && Number.isFinite(wsRaw) ? wsRaw : 1;
  const wd =
    typeof wdRaw === "number" && Number.isFinite(wdRaw) ? wdRaw : 1;

  const scores = new Map<string, number>();

  const accumulate = (
    list: { chunkId: string; rank: number }[] | null | undefined,
    weight: number,
  ) => {
    if (!Array.isArray(list) || list.length === 0 || weight === 0) return;
    for (const row of list) {
      if (!row || typeof row.chunkId !== "string" || row.chunkId.length === 0) continue;
      const r = row.rank;
      if (typeof r !== "number" || !Number.isFinite(r) || r < 0) continue;
      // 0-based → 1-based in the denominator: k + rank + 1
      const contrib = weight / (k + r + 1);
      scores.set(row.chunkId, (scores.get(row.chunkId) ?? 0) + contrib);
    }
  };

  accumulate(sparse, ws);
  accumulate(dense, wd);

  const out: { chunkId: string; score: number }[] = [];
  for (const [chunkId, score] of scores) {
    out.push({ chunkId, score });
  }
  out.sort(
    (a, b) =>
      b.score - a.score ||
      (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
  );
  return out;
}

// ── Incremental embed planner ───────────────────────────────────────────────

/**
 * Return contentHashes of chunks that need embedding (not already in `existing`),
 * in input order, deduped (first occurrence wins). Empty / bad input → [].
 * Caller maps hashes back to chunks.
 */
export function planIncrementalEmbed(
  existing: Set<string>,
  chunks: { chunkId: string; contentHash: string }[],
): string[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const have = existing instanceof Set ? existing : new Set<string>();
  const out: string[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (!c || typeof c.contentHash !== "string" || c.contentHash.length === 0) continue;
    if (have.has(c.contentHash)) continue;
    if (seen.has(c.contentHash)) continue;
    seen.add(c.contentHash);
    out.push(c.contentHash);
  }
  return out;
}

// ── Hybrid result type (contract surface for documentChatTool) ──────────────

export type HybridStrategy = "hybrid" | "bm25_only";

export type HybridRetrievalResult = {
  passages: {
    chunkId: string;
    text: string;
    docId: string;
    page?: number;
    score: number;
  }[];
  strategy: HybridStrategy;
  trace: {
    sparseCount: number;
    denseCount: number;
    fusedCount: number;
    reranked?: boolean;
  };
};
