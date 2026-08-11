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
 *    Callers may pass raw or already-normalized vectors; we re-normalize.
 *    Zero / non-finite vectors are REJECTED on add (skipped) so they cannot
 *    perturb RRF. A zero-norm query returns [] (no dense hits).
 *    Cosine on unit vectors = dot product.
 *
 * 2. rrfFuse ranks are 0-BASED from callers (array index / top-N position).
 *    The RRF formula uses 1-based rank position:
 *      score(d) = Σ_arm  w_arm / (k + rank_1based(d))
 *               = Σ_arm  w_arm / (k + rank_0based(d) + 1)
 *    Absent arm contributes 0. Default k=60, weights=1. Sorted desc.
 *    Matches existing retrievalLoop (rankInRound 1-based → 1/(RRF_K+rank)).
 *
 * 3. Optional per-chunk text + contentHash for durable persistence and
 *    dense-only RRF hit recovery (no silent drop of dense winners).
 */

export type SemanticVectorIndexOpts = { dims: number };

export type SemanticVectorAddItem = {
  chunkId: string;
  vector: Float32Array;
  /** Optional passage text (dense-only hit recovery + durable persist). */
  text?: string;
  /** Optional content hash for incremental re-embed planning. */
  contentHash?: string;
};

type StoredVector = {
  vector: Float32Array;
  text?: string;
  contentHash?: string;
};

export type SemanticVectorJSON = {
  dims: number;
  vectors: {
    chunkId: string;
    vector: number[];
    text?: string;
    contentHash?: string;
  }[];
};

function assertPositiveIntegerDims(d: unknown, where: string): number {
  if (typeof d !== "number" || !Number.isInteger(d) || d <= 0) {
    throw new Error(
      `SemanticVectorIndex${where}: dims must be a positive integer, got ${String(d)}`,
    );
  }
  return d;
}

/** True when the vector is empty of usable signal (any non-finite, or all zeros). */
function isZeroOrNonFinite(v: Float32Array): boolean {
  let allZero = true;
  for (let i = 0; i < v.length; i++) {
    const x = v[i];
    if (typeof x !== "number" || !Number.isFinite(x)) return true;
    if (x !== 0) allZero = false;
  }
  return allZero;
}

/** Default resident float cap (200k floats ≈ 800 KB fp32). */
export const DEFAULT_VECTOR_MEMORY_FLOAT_CAP = 200_000;

/**
 * Total resident floats across a collection of indexes
 * (sum of chunkCount × dims for each).
 */
export function totalResidentFloats(
  indexes: Iterable<{ chunkCount: number; dims: number }>,
): number {
  let n = 0;
  for (const idx of indexes) {
    if (!idx) continue;
    const c = idx.chunkCount;
    const d = idx.dims;
    if (typeof c === "number" && typeof d === "number" && Number.isFinite(c) && Number.isFinite(d)) {
      n += c * d;
    }
  }
  return n;
}

/** True when total resident floats already exceed (or equal) the cap. */
export function semanticIndexCountExceeds(
  indexes: Iterable<{ chunkCount: number; dims: number }>,
  cap: number = DEFAULT_VECTOR_MEMORY_FLOAT_CAP,
): boolean {
  const limit =
    typeof cap === "number" && Number.isFinite(cap) && cap > 0
      ? cap
      : DEFAULT_VECTOR_MEMORY_FLOAT_CAP;
  return totalResidentFloats(indexes) >= limit;
}

/**
 * Net float delta if `newItems` were added to `index`, accounting for
 * replacement of existing chunkIds (same id → 0 net new floats for that row).
 * Only items that would actually be accepted (valid dims / non-zero) count.
 */
export function wouldBeFloatDelta(
  index: SemanticVectorIndex,
  newItems: SemanticVectorAddItem[],
): number {
  if (!index || !Array.isArray(newItems) || newItems.length === 0) return 0;
  const dims = index.dims;
  let delta = 0;
  // Track chunkIds we already counted in this batch (last write wins).
  const seen = new Set<string>();
  // Walk reverse so last write per chunkId wins (matches addVectors).
  for (let i = newItems.length - 1; i >= 0; i--) {
    const item = newItems[i];
    if (!item || typeof item.chunkId !== "string" || item.chunkId.length === 0) continue;
    if (seen.has(item.chunkId)) continue;
    const v = item.vector;
    if (!(v instanceof Float32Array) || v.length !== dims) continue;
    if (isZeroOrNonFinite(v)) continue;
    seen.add(item.chunkId);
    // Replacement of an existing chunkId → 0 net floats.
    if (index.hasChunk(item.chunkId)) continue;
    delta += dims;
  }
  return delta;
}

export class SemanticVectorIndex {
  readonly dims: number;
  /** chunkId → L2-normalized vector (+ optional text/hash). */
  private readonly store = new Map<string, StoredVector>();
  /** True when an add was skipped because a float cap would be exceeded. */
  private _capped = false;

  constructor(opts: SemanticVectorIndexOpts) {
    this.dims = assertPositiveIntegerDims(opts?.dims, "");
  }

  get chunkCount(): number {
    return this.store.size;
  }

  /** Resident float count for this index (chunkCount × dims). */
  get floatCount(): number {
    return this.store.size * this.dims;
  }

  /** True when a prior add was skipped due to a memory cap. */
  get isCapped(): boolean {
    return this._capped;
  }

  /** Mark this index as capped (host may also set this when restore is refused). */
  markCapped(): void {
    this._capped = true;
  }

  /** True when chunkId already has a vector. */
  hasChunk(chunkId: string): boolean {
    if (typeof chunkId !== "string" || chunkId.length === 0) return false;
    return this.store.has(chunkId);
  }

  /**
   * Insert or replace vectors. Dedupe by chunkId (last write wins).
   * Vectors are L2-normalized on add; wrong-length / zero / non-finite
   * entries are skipped (they must not perturb dense RRF ranks).
   * Optional text / contentHash are stored when provided (string, non-empty).
   *
   * Cap (FIX D): when `floatCap` + `otherResidentFloats` are provided, each
   * NEW (non-replacement) vector is refused once the would-be total exceeds
   * the cap; `isCapped` is set. Replacements of existing chunkIds always pass
   * (0 net floats). Without cap opts the add is unbounded (caller enforces).
   */
  addVectors(
    items: SemanticVectorAddItem[],
    capOpts?: { floatCap?: number; otherResidentFloats?: number },
  ): { added: number; skippedByCap: number } {
    if (!Array.isArray(items) || items.length === 0) {
      return { added: 0, skippedByCap: 0 };
    }
    const cap =
      capOpts &&
      typeof capOpts.floatCap === "number" &&
      Number.isFinite(capOpts.floatCap) &&
      capOpts.floatCap > 0
        ? capOpts.floatCap
        : null;
    const other =
      capOpts &&
      typeof capOpts.otherResidentFloats === "number" &&
      Number.isFinite(capOpts.otherResidentFloats) &&
      capOpts.otherResidentFloats > 0
        ? capOpts.otherResidentFloats
        : 0;
    let added = 0;
    let skippedByCap = 0;
    for (const item of items) {
      if (!item || typeof item.chunkId !== "string" || item.chunkId.length === 0) {
        continue;
      }
      const v = item.vector;
      if (!(v instanceof Float32Array) || v.length !== this.dims) continue;
      if (isZeroOrNonFinite(v)) continue;
      const normalized = l2Normalize(v, this.dims);
      // Defensive: if normalize collapsed to zero, still reject.
      if (isZeroOrNonFinite(normalized)) continue;

      const isReplacement = this.store.has(item.chunkId);
      if (cap !== null && !isReplacement) {
        const wouldBe = other + this.floatCount + this.dims;
        if (wouldBe > cap) {
          this._capped = true;
          skippedByCap += 1;
          continue;
        }
      }

      const prev = this.store.get(item.chunkId);
      const text =
        typeof item.text === "string" && item.text.length > 0
          ? item.text
          : prev?.text;
      const contentHash =
        typeof item.contentHash === "string" && item.contentHash.length > 0
          ? item.contentHash
          : prev?.contentHash;
      const row: StoredVector = { vector: normalized };
      if (text !== undefined) row.text = text;
      if (contentHash !== undefined) row.contentHash = contentHash;
      this.store.set(item.chunkId, row);
      added += 1;
    }
    return { added, skippedByCap };
  }

  /** Store / replace passage text for a chunk (dense-only hit recovery). */
  setChunkText(chunkId: string, text: string): void {
    if (typeof chunkId !== "string" || chunkId.length === 0) return;
    if (typeof text !== "string") return;
    const prev = this.store.get(chunkId);
    if (!prev) {
      // Text without a vector is not queryable; ignore until a vector lands.
      return;
    }
    if (text.length === 0) {
      delete prev.text;
    } else {
      prev.text = text;
    }
  }

  /** Retrieve stored passage text, or null when absent. */
  getChunkText(chunkId: string): string | null {
    if (typeof chunkId !== "string" || chunkId.length === 0) return null;
    const row = this.store.get(chunkId);
    const t = row?.text;
    return typeof t === "string" && t.length > 0 ? t : null;
  }

  /** Retrieve stored contentHash, or null when absent. */
  getContentHash(chunkId: string): string | null {
    if (typeof chunkId !== "string" || chunkId.length === 0) return null;
    const row = this.store.get(chunkId);
    const h = row?.contentHash;
    return typeof h === "string" && h.length > 0 ? h : null;
  }

  /** All known (chunkId, contentHash) composite keys for incremental planning. */
  contentHashKeys(): Set<string> {
    const out = new Set<string>();
    for (const [chunkId, row] of this.store) {
      if (typeof row.contentHash === "string" && row.contentHash.length > 0) {
        out.add(`${chunkId}\0${row.contentHash}`);
      }
    }
    return out;
  }

  removeChunk(chunkId: string): void {
    if (typeof chunkId !== "string" || chunkId.length === 0) return;
    this.store.delete(chunkId);
  }

  /**
   * Brute-force cosine (dot product of L2-normalized vectors).
   * Query vector is defensively re-normalized. Zero-norm query → [] (no dense
   * hits; a zero query must not flood RRF with score-0 rows).
   * Empty index / topN<=0 / bad query → [].
   */
  query(queryVector: Float32Array, topN: number): { chunkId: string; score: number }[] {
    if (this.store.size === 0) return [];
    if (!(queryVector instanceof Float32Array) || queryVector.length !== this.dims) {
      return [];
    }
    const n = Math.floor(Number(topN));
    if (!Number.isFinite(n) || n <= 0) return [];
    if (isZeroOrNonFinite(queryVector)) return [];

    const q = l2Normalize(queryVector, this.dims);
    if (isZeroOrNonFinite(q)) return [];

    const scored: { chunkId: string; score: number }[] = [];
    for (const [chunkId, row] of this.store) {
      scored.push({ chunkId, score: dot(q, row.vector) });
    }
    scored.sort(
      (a, b) =>
        b.score - a.score ||
        (a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0),
    );
    return scored.slice(0, n);
  }

  /**
   * Round-trip persistence: plain serializable shape (fp32 as number[]).
   * Includes text / contentHash when present. Order is deterministic
   * (sorted by chunkId) so snapshots are stable.
   */
  toJSON(): SemanticVectorJSON {
    const vectors: SemanticVectorJSON["vectors"] = [];
    const ids = Array.from(this.store.keys()).sort();
    for (const chunkId of ids) {
      const row = this.store.get(chunkId)!;
      const entry: SemanticVectorJSON["vectors"][number] = {
        chunkId,
        vector: Array.from(row.vector),
      };
      if (typeof row.text === "string" && row.text.length > 0) {
        entry.text = row.text;
      }
      if (typeof row.contentHash === "string" && row.contentHash.length > 0) {
        entry.contentHash = row.contentHash;
      }
      vectors.push(entry);
    }
    return { dims: this.dims, vectors };
  }

  static fromJSON(data: SemanticVectorJSON | null | undefined): SemanticVectorIndex {
    const dims = assertPositiveIntegerDims(data?.dims, ".fromJSON");
    const idx = new SemanticVectorIndex({ dims });
    const items = Array.isArray(data?.vectors) ? data!.vectors : [];
    const packed: SemanticVectorAddItem[] = [];
    for (const row of items) {
      if (!row || typeof row.chunkId !== "string") continue;
      if (!Array.isArray(row.vector) || row.vector.length !== idx.dims) continue;
      const f = new Float32Array(idx.dims);
      let bad = false;
      for (let i = 0; i < idx.dims; i++) {
        const x = row.vector[i];
        if (typeof x !== "number" || !Number.isFinite(x)) {
          bad = true;
          break;
        }
        f[i] = x;
      }
      if (bad || isZeroOrNonFinite(f)) continue;
      const item: SemanticVectorAddItem = { chunkId: row.chunkId, vector: f };
      if (typeof row.text === "string" && row.text.length > 0) item.text = row.text;
      if (typeof row.contentHash === "string" && row.contentHash.length > 0) {
        item.contentHash = row.contentHash;
      }
      packed.push(item);
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
  const ws = typeof wsRaw === "number" && Number.isFinite(wsRaw) ? wsRaw : 1;
  const wd = typeof wdRaw === "number" && Number.isFinite(wdRaw) ? wdRaw : 1;

  const scores = new Map<string, number>();

  const accumulate = (
    list: { chunkId: string; rank: number }[] | null | undefined,
    weight: number,
  ) => {
    if (!Array.isArray(list) || list.length === 0 || weight === 0) return;
    for (const row of list) {
      if (!row || typeof row.chunkId !== "string" || row.chunkId.length === 0) {
        continue;
      }
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
 *
 * Note: planChunksToEmbed (embeddingPure) is the production planner and dedupes
 * by (chunkId, contentHash). This helper stays hash-only for pure unit tests.
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
    if (!c || typeof c.contentHash !== "string" || c.contentHash.length === 0) {
      continue;
    }
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
