/**
 * Multi-round document retrieval loop over a BM25+ chunk index.
 * Pure TypeScript — no React Native imports, no Node APIs, no clocks/RNG;
 * runs in plain Node like the sentence-level retriever.
 *
 * Foundation for upcoming web-fetch / remote-PDF text documents (not chat turns).
 *
 * Design rules encoded here:
 *  1. Vary the query   — residual (uncovered) words feed the next round
 *  2. Vary granularity — sentence then paragraph (and paragraph again if round 3)
 *  3. Exclude returned chunks — every chunkId ever selected into the pool is
 *     excluded from later rounds (budget-dropped carriers are unrecoverable)
 *  4. Mechanical trigger + hard cap + replacement — coverage/floor trigger only
 *     (always evaluated on the post-round MERGED selection), maxRounds clamped
 *     to [1, 3], final passages replace via RRF rank fusion (budget + Jaccard)
 */

import {
  MIN_SHARED_GRAMS,
  JACCARD_DEDUP,
  RRF_K,
  normalize,
  segmentSentences,
  ngramCounts,
  tokenCount,
  sharedGramCount,
  bm25plus,
  jaccardWords,
  truncateWithEllipsis,
} from "./retriever";

export interface RetrievalDoc {
  docId: string;
  title?: string;
  text: string;
}

export type ChunkGranularity = "sentence" | "paragraph";

export interface RetrievedPassage {
  docId: string;
  chunkId: string;
  granularity: ChunkGranularity;
  text: string;
  /** Raw BM25+ score (telemetry only; merge ranks by rankInRound RRF). */
  score: number;
  round: number;
  /** 1-based position within this round's selection (score-ordered). */
  rankInRound: number;
}

export interface RetrievalLoopTrace {
  roundsRun: number;
  triggeredSecondRound: boolean;
  triggerReason: "coverage_below_threshold" | "too_few_passages" | null;
  /**
   * coverageByRound[i] = coverage of the MERGED selection after round i+1
   * (delivered text of `mergePassages(pool)`). The final entry describes
   * exactly the returned `passages`. Budget-dropped carriers do not count.
   */
  coverageByRound: number[];
  /**
   * The last residual query actually used (round 3 overwrites round 2).
   * Derived from the post-merge selection of the previous round.
   * Null if no residual round ran.
   */
  residualQuery: string | null;
}

export interface RetrievalLoopResult {
  passages: RetrievedPassage[];
  trace: RetrievalLoopTrace;
}

export type RetrievalLoopOptions = {
  maxRounds?: number;
  topNPerRound?: number;
  maxCharsPerPassage?: number;
  budgetChars?: number;
  coverageThreshold?: number;
  minPassagesFloor?: number;
};

const DEFAULT_MAX_ROUNDS = 2;
const HARD_CAP_ROUNDS = 3;
const DEFAULT_TOP_N = 4;
const DEFAULT_MAX_CHARS = 300;
const DEFAULT_BUDGET_CHARS = 1200;
const DEFAULT_COVERAGE_THRESHOLD = 0.5;
const DEFAULT_MIN_PASSAGES_FLOOR = 2;
const MAX_QUERY_LEN = 2000;
const MIN_PARAGRAPH_LEN = 20;
const MAX_PARAGRAPH_WINDOW = 600;
const MIN_CONTENT_WORD_LEN = 3;

interface ChunkDoc {
  chunkId: string;
  docId: string;
  granularity: ChunkGranularity;
  ordinal: number;
  original: string;
  normalized: string;
  tf: Map<string, number>;
  dl: number;
}

interface GranularityIndex {
  chunks: ChunkDoc[];
  dfMap: Map<string, number>;
  totalDl: number;
  /** Next ordinal per docId for O(1) append (avoids O(n) rescan). */
  nextOrdinal: Map<string, number>;
}

function emptyTrace(): RetrievalLoopTrace {
  return {
    roundsRun: 0,
    triggeredSecondRound: false,
    triggerReason: null,
    coverageByRound: [],
    residualQuery: null,
  };
}

function emptyResult(): RetrievalLoopResult {
  return { passages: [], trace: emptyTrace() };
}

function resolveMaxRounds(raw: number | undefined): number {
  let n = DEFAULT_MAX_ROUNDS;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    n = Math.floor(raw);
  }
  if (n < 1) n = 1;
  if (n > HARD_CAP_ROUNDS) n = HARD_CAP_ROUNDS;
  return n;
}

function resolveTopN(raw: number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  return DEFAULT_TOP_N;
}

function resolvePositiveInt(raw: number | undefined, fallback: number): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return fallback;
}

/** Clamp coverageThreshold to [0, 1]. */
function resolveThreshold(raw: number | undefined): number {
  let t = DEFAULT_COVERAGE_THRESHOLD;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    t = raw;
  }
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  return t;
}

/** Clamp minPassagesFloor to ≥ 0. */
function resolveMinFloor(raw: number | undefined): number {
  let n = DEFAULT_MIN_PASSAGES_FLOOR;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    n = Math.floor(raw);
  }
  if (n < 0) n = 0;
  return n;
}

/**
 * Sentence split for paragraph windowing only.
 * Unlike segmentSentences (chat path, 300-char cap), a single sentence here may
 * be up to MAX_PARAGRAPH_WINDOW (600); longer is truncated at 600.
 */
function splitSentencesForParagraphs(text: string): string[] {
  if (!text) return [];
  const parts = text.split(/[.!?\n]+/);
  const out: string[] = [];
  for (const raw of parts) {
    const s = raw.trim();
    if (s.length === 0) continue;
    if (s.length > MAX_PARAGRAPH_WINDOW) {
      out.push(s.slice(0, MAX_PARAGRAPH_WINDOW));
    } else {
      out.push(s);
    }
  }
  return out;
}

/**
 * Split text into paragraph windows.
 * Blank-line separated; drop < 20 chars; windows ≤ 600 never mid-sentence.
 */
function segmentParagraphs(text: string): string[] {
  if (!text) return [];
  const rawParas = text.split(/\n\s*\n/);
  const out: string[] = [];

  for (const raw of rawParas) {
    const p = raw.trim();
    if (p.length < MIN_PARAGRAPH_LEN) continue;

    if (p.length <= MAX_PARAGRAPH_WINDOW) {
      out.push(p);
      continue;
    }

    // Long paragraph → sentence windows ≤ 600 (never mid-sentence)
    const sents = splitSentencesForParagraphs(p);
    let window = "";
    for (const piece of sents) {
      if (!piece) continue;
      if (!window) {
        window = piece;
        continue;
      }
      if (window.length + 1 + piece.length <= MAX_PARAGRAPH_WINDOW) {
        window = `${window} ${piece}`;
      } else {
        if (window.length >= MIN_PARAGRAPH_LEN) out.push(window);
        window = piece;
      }
    }
    if (window.length >= MIN_PARAGRAPH_LEN) out.push(window);
  }

  return out;
}

/**
 * Content words from a normalized query: strip non letter/digit/hyphen,
 * then keep length ≥ 3. No stopword filtering.
 */
function contentWords(normalizedQuery: string): string[] {
  if (!normalizedQuery) return [];
  const raw = normalizedQuery.split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const w of raw) {
    // Strip punctuation that survived normalize (e.g. trailing '?')
    const cleaned = w.replace(/[^\p{L}\p{N}-]+/gu, "");
    if (cleaned.length >= MIN_CONTENT_WORD_LEN) out.push(cleaned);
  }
  return out;
}

/**
 * A content word is covered when ≥ half of its char n-grams appear in corpusGrams.
 */
function isWordCovered(word: string, corpusGrams: Set<string>): boolean {
  const grams = ngramCounts(word);
  if (grams.size === 0) return true;
  let hit = 0;
  for (const g of grams.keys()) {
    if (corpusGrams.has(g)) hit++;
  }
  return hit >= grams.size / 2;
}

/**
 * Union of n-gram keys over DELIVERED passage text (not full-chunk tf).
 * Truncated tails must not claim coverage for terms that never left the index.
 */
function deliveredGramUnion(passages: RetrievedPassage[]): Set<string> {
  const keys = new Set<string>();
  for (const p of passages) {
    const tf = ngramCounts(normalize(p.text));
    for (const t of tf.keys()) keys.add(t);
  }
  return keys;
}

/**
 * Coverage = fraction of query content words whose n-grams are half-covered
 * by the union of DELIVERED passages' n-grams. 1.0 when there are no content words.
 */
function computeCoverage(
  queryWords: string[],
  passages: RetrievedPassage[],
): number {
  if (queryWords.length === 0) return 1.0;
  const corpusGrams = deliveredGramUnion(passages);
  let covered = 0;
  for (const w of queryWords) {
    if (isWordCovered(w, corpusGrams)) covered++;
  }
  return covered / queryWords.length;
}

function uncoveredWords(
  queryWords: string[],
  passages: RetrievedPassage[],
): string[] {
  const corpusGrams = deliveredGramUnion(passages);
  const out: string[] = [];
  for (const w of queryWords) {
    if (!isWordCovered(w, corpusGrams)) out.push(w);
  }
  return out;
}

function compareChunkTiebreak(a: ChunkDoc, b: ChunkDoc): number {
  if (a.docId < b.docId) return -1;
  if (a.docId > b.docId) return 1;
  return a.ordinal - b.ordinal;
}

/** RRF rank key: higher is better. */
function rrfKey(p: RetrievedPassage): number {
  return 1 / (RRF_K + p.rankInRound);
}

function comparePassageMerge(a: RetrievedPassage, b: RetrievedPassage): number {
  // Rank-fused order (not raw BM25 — residual rounds score structurally lower)
  const da = rrfKey(a);
  const db = rrfKey(b);
  const ds = db - da;
  if (ds !== 0) return ds > 0 ? 1 : -1;
  // Tiebreak: round ASC, then docId, then ordinal
  if (a.round !== b.round) return a.round - b.round;
  if (a.docId < b.docId) return -1;
  if (a.docId > b.docId) return 1;
  const oa = a.chunkId.lastIndexOf("#");
  const ob = b.chunkId.lastIndexOf("#");
  const na = oa >= 0 ? Number(a.chunkId.slice(oa + 1)) : 0;
  const nb = ob >= 0 ? Number(b.chunkId.slice(ob + 1)) : 0;
  if (na !== nb) return na - nb;
  if (a.chunkId < b.chunkId) return -1;
  if (a.chunkId > b.chunkId) return 1;
  return 0;
}

/**
 * Greedy budget pack ordered by RRF rank fusion across rounds.
 * Passages REPLACE — a top-ranked residual hit can displace a lower-ranked
 * round-1 passage that no longer fits the budget.
 */
function mergePassages(
  pool: RetrievedPassage[],
  budgetChars: number,
): RetrievedPassage[] {
  if (pool.length === 0 || budgetChars <= 0) return [];

  const sorted = pool.slice().sort(comparePassageMerge);
  const kept: RetrievedPassage[] = [];
  let used = 0;

  for (const p of sorted) {
    const norm = normalize(p.text);
    let dup = false;
    for (const k of kept) {
      if (jaccardWords(norm, normalize(k.text)) >= JACCARD_DEDUP) {
        dup = true;
        break;
      }
    }
    if (dup) continue;
    if (used + p.text.length > budgetChars) continue;
    kept.push(p);
    used += p.text.length;
  }

  return kept;
}

/**
 * Append-only multi-granularity BM25+ index for document text.
 * Sentence and paragraph stats are kept separate so DF/avgdl are not mixed.
 */
export class DocRetrieverIndex {
  private sentence: GranularityIndex = {
    chunks: [],
    dfMap: new Map(),
    totalDl: 0,
    nextOrdinal: new Map(),
  };
  private paragraph: GranularityIndex = {
    chunks: [],
    dfMap: new Map(),
    totalDl: 0,
    nextOrdinal: new Map(),
  };
  /** docIds already appended; re-appends are silently ignored. */
  private seenDocIds = new Set<string>();
  /** Monotonic counter for anonymous docs (never reused across append calls). */
  private nextAnonId = 0;

  /**
   * Append documents (chunked at both granularities + DF updated).
   * Append-only per docId; re-appends are ignored.
   * Missing/empty docId → `doc-anon-N` (monotonic, never collides across calls).
   */
  append(docs: RetrievalDoc[] | null | undefined): void {
    if (!Array.isArray(docs) || docs.length === 0) return;

    for (let di = 0; di < docs.length; di++) {
      const doc = docs[di];
      if (!doc || typeof doc.text !== "string") continue;
      const docId =
        typeof doc.docId === "string" && doc.docId.length > 0
          ? doc.docId
          : `doc-anon-${this.nextAnonId++}`;

      if (this.seenDocIds.has(docId)) continue;
      this.seenDocIds.add(docId);

      this.indexGranularity(docId, "sentence", segmentSentences(doc.text));
      this.indexGranularity(docId, "paragraph", segmentParagraphs(doc.text));
    }
  }

  private indexGranularity(
    docId: string,
    granularity: ChunkGranularity,
    pieces: string[],
  ): void {
    const idx = granularity === "sentence" ? this.sentence : this.paragraph;
    let ordinal = idx.nextOrdinal.get(docId) ?? 0;

    for (let i = 0; i < pieces.length; i++) {
      const original = pieces[i];
      if (!original) continue;
      const normalized = normalize(original);
      if (!normalized) continue;
      const tf = ngramCounts(normalized);
      const dl = tokenCount(tf);
      if (dl === 0) continue;

      const chunkId = `${docId}#${granularity}#${ordinal}`;
      const chunk: ChunkDoc = {
        chunkId,
        docId,
        granularity,
        ordinal,
        original,
        normalized,
        tf,
        dl,
      };
      ordinal++;
      idx.chunks.push(chunk);
      idx.totalDl += dl;
      for (const t of tf.keys()) {
        idx.dfMap.set(t, (idx.dfMap.get(t) ?? 0) + 1);
      }
    }
    idx.nextOrdinal.set(docId, ordinal);
  }

  get chunkCount(): number {
    return this.sentence.chunks.length + this.paragraph.chunks.length;
  }

  /**
   * BM25+ retrieve over one granularity with the privacy/relevance gate.
   * No salience/RRF inside a round — documents are not chat turns.
   * Sets rankInRound (1-based) on each selected passage.
   */
  retrieveRound(
    query: string | null | undefined,
    granularity: ChunkGranularity,
    excludeChunkIds: Set<string>,
    opts: { topN: number; maxChars: number; round: number },
  ): RetrievedPassage[] {
    let q = typeof query === "string" ? query : "";
    if (q.length > MAX_QUERY_LEN) q = q.slice(0, MAX_QUERY_LEN);
    const qNorm = normalize(q);
    const idx = granularity === "sentence" ? this.sentence : this.paragraph;
    const N = idx.chunks.length;
    if (N === 0 || !qNorm) return [];

    const topN = opts.topN;
    const maxChars = opts.maxChars;
    if (topN <= 0) return [];

    const avgdl = idx.totalDl / N;
    const queryGrams = ngramCounts(qNorm);
    if (queryGrams.size === 0) return [];

    const exclude = excludeChunkIds ?? new Set<string>();
    const candidates: number[] = [];
    const scores = new Map<number, number>();

    for (let i = 0; i < N; i++) {
      const d = idx.chunks[i];
      if (exclude.has(d.chunkId)) continue;
      const shared = sharedGramCount(queryGrams, d.tf);
      if (shared < MIN_SHARED_GRAMS) continue;
      const score = bm25plus(queryGrams, d, idx.dfMap, N, avgdl);
      if (score <= 0) continue;
      candidates.push(i);
      scores.set(i, score);
    }

    if (candidates.length === 0) return [];

    candidates.sort((ia, ib) => {
      const ds = (scores.get(ib) ?? 0) - (scores.get(ia) ?? 0);
      if (ds !== 0) return ds > 0 ? 1 : -1;
      return compareChunkTiebreak(idx.chunks[ia], idx.chunks[ib]);
    });

    const selected: number[] = [];
    for (const i of candidates) {
      const d = idx.chunks[i];
      let dup = false;
      for (const s of selected) {
        if (
          jaccardWords(d.normalized, idx.chunks[s].normalized) >= JACCARD_DEDUP
        ) {
          dup = true;
          break;
        }
      }
      if (!dup) selected.push(i);
      if (selected.length >= topN) break;
    }

    const results: RetrievedPassage[] = [];
    for (let r = 0; r < selected.length; r++) {
      const i = selected[r];
      const d = idx.chunks[i];
      results.push({
        docId: d.docId,
        chunkId: d.chunkId,
        granularity: d.granularity,
        text: truncateWithEllipsis(d.original, maxChars),
        score: scores.get(i) ?? 0,
        round: opts.round,
        rankInRound: r + 1,
      });
    }
    return results;
  }
}

/**
 * Mechanical multi-round retrieval: sentence → (optional) paragraph residual →
 * budget merge with RRF rank fusion. No LLM satisfaction check.
 *
 * Unified per-round pipeline: select → pool → merge → coverage/trigger/residual
 * all evaluate the MERGED selection (delivered text under budget).
 */
export function runRetrievalLoop(
  index: DocRetrieverIndex,
  query: string | null | undefined,
  options?: RetrievalLoopOptions,
): RetrievalLoopResult {
  if (!index || index.chunkCount === 0) return emptyResult();

  let q = typeof query === "string" ? query : "";
  if (q.length > MAX_QUERY_LEN) q = q.slice(0, MAX_QUERY_LEN);
  const qNorm = normalize(q);
  if (!qNorm) return emptyResult();

  const maxRounds = resolveMaxRounds(options?.maxRounds);
  const topN = resolveTopN(options?.topNPerRound);
  const resolvedMaxChars = resolvePositiveInt(
    options?.maxCharsPerPassage,
    DEFAULT_MAX_CHARS,
  );
  const budgetChars = resolvePositiveInt(
    options?.budgetChars,
    DEFAULT_BUDGET_CHARS,
  );
  // Invariant: at least one passage must be able to fit under the budget.
  const maxChars = Math.min(resolvedMaxChars, budgetChars);
  const coverageThreshold = resolveThreshold(options?.coverageThreshold);
  const minPassagesFloor = resolveMinFloor(options?.minPassagesFloor);

  if (topN <= 0) return emptyResult();

  const queryWords = contentWords(qNorm);
  // Pool-wide exclusion: every chunkId ever selected into the pool.
  // Budget-dropped carriers are unrecoverable by design; merged-based coverage
  // (post every round) reports that honestly. A futile round 3 against an
  // unachievable threshold is accepted — bounded by the hard cap (maxRounds ≤ 3).
  const exclude = new Set<string>();
  const pool: RetrievedPassage[] = [];
  const coverageByRound: number[] = [];

  let triggeredSecondRound = false;
  let triggerReason: RetrievalLoopTrace["triggerReason"] = null;
  let residualQuery: string | null = null;
  let roundsRun = 0;
  let merged: RetrievedPassage[] = [];

  // --- Round 1: sentence, full query → merge → cov on merged ---
  const r1 = index.retrieveRound(q, "sentence", exclude, {
    topN,
    maxChars,
    round: 1,
  });
  roundsRun = 1;
  for (const p of r1) {
    exclude.add(p.chunkId);
    pool.push(p);
  }
  merged = mergePassages(pool, budgetChars);
  const cov1 = computeCoverage(queryWords, merged);
  coverageByRound.push(cov1);

  // --- Mechanical trigger for round 2 (post-merge coverage / floor) ---
  const shouldRound2 =
    maxRounds >= 2 &&
    (cov1 < coverageThreshold || merged.length < minPassagesFloor);

  if (shouldRound2) {
    if (cov1 < coverageThreshold) {
      triggerReason = "coverage_below_threshold";
    } else {
      triggerReason = "too_few_passages";
    }
    triggeredSecondRound = true;

    // Residual from MERGED selection (not raw r1)
    const uncovered = uncoveredWords(queryWords, merged);
    const r2Query = uncovered.length > 0 ? uncovered.join(" ") : q;
    residualQuery = r2Query;

    // Exclusion = all pool chunkIds so far
    const r2 = index.retrieveRound(r2Query, "paragraph", exclude, {
      topN,
      maxChars,
      round: 2,
    });
    roundsRun = 2;
    for (const p of r2) {
      exclude.add(p.chunkId);
      pool.push(p);
    }
    merged = mergePassages(pool, budgetChars);
    const cov2 = computeCoverage(queryWords, merged);
    coverageByRound.push(cov2);
  }

  // --- Round 3: same shape (trigger on post-merge cov/floor) ---
  if (maxRounds >= 3 && roundsRun < maxRounds) {
    const covForTrigger =
      coverageByRound[coverageByRound.length - 1] ??
      computeCoverage(queryWords, merged);
    const shouldRound3 =
      covForTrigger < coverageThreshold || merged.length < minPassagesFloor;

    if (shouldRound3) {
      const uncovered3 = uncoveredWords(queryWords, merged);
      const r3Query = uncovered3.length > 0 ? uncovered3.join(" ") : q;
      residualQuery = r3Query;

      // Exclusion = all pool chunkIds ever selected
      const r3 = index.retrieveRound(r3Query, "paragraph", exclude, {
        topN,
        maxChars,
        round: 3,
      });
      roundsRun = 3;
      for (const p of r3) {
        exclude.add(p.chunkId);
        pool.push(p);
      }
      merged = mergePassages(pool, budgetChars);
      coverageByRound.push(computeCoverage(queryWords, merged));
    }
  }

  return {
    passages: merged,
    trace: {
      roundsRun,
      triggeredSecondRound,
      triggerReason,
      coverageByRound,
      residualQuery,
    },
  };
}
