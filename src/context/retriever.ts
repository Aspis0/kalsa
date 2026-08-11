/**
 * Lightweight sentence-level BM25+ retriever with RRF fusion and salience.
 * Pure TypeScript — no React Native imports; runs in plain Node.
 *
 * Production path: hold one RetrieverIndex per conversation (append-only history).
 * retrieveRelevant() remains a thin throwaway-index wrapper for one-shot calls.
 */

export interface RetrievalUnit {
  turnIndex: number;
  role: "user" | "assistant";
  text: string;
}

export interface RetrievedSnippet {
  turnIndex: number;
  role: "user" | "assistant";
  text: string;
  score: number;
}

export type RetrieveOptions = {
  topN?: number;
  maxCharsPerSnippet?: number;
};

export const K1 = 1.2;
export const B = 0.75;
export const DELTA = 1.0;
export const RRF_K = 60;
const DEFAULT_TOP_N = 4;
const DEFAULT_MAX_CHARS = 240;
/** Drop below this; 6–9 char fragments are merged (see segmentSentences). */
const MIN_SENTENCE_LEN = 10;
const MIN_KEEP_LEN = 6;
const MAX_SENTENCE_LEN = 300;
const MAX_QUERY_LEN = 2000;
export const JACCARD_DEDUP = 0.7;
/** Privacy gate: require this many shared content n-grams AND BM25+ > 0. */
export const MIN_SHARED_GRAMS = 3;

/**
 * Declarative / durable-fact anchors (IT + EN). Multi-word phrases first.
 * `/u` so non-ASCII letters (e.g. è) are word chars for `\b`.
 * Note: `\bè\b` can false-positive on some French words (e.g. "très") — accepted noise.
 */
const ANCHOR_PATTERNS: RegExp[] = [
  /\bsi\s+chiama\b/giu,
  /\bè\b/giu,
  /\bsono\b/giu,
  /\bha\b/giu,
  /\bvoglio\b/giu,
  /\bpreferisco\b/giu,
  /\bis\b/giu,
  /\bare\b/giu,
  /\bhas\b/giu,
  /\bwants\b/giu,
  /\bprefers\b/giu,
  /\bcalled\b/giu,
  /\bnamed\b/giu,
  /\bdeadline\b/giu,
  /\bentro\b/giu,
];

/** Pre-NFKD transliteration for letters that do not decompose to base+mark. */
const TRANSLIT: Record<string, string> = {
  ß: "ss",
  œ: "oe",
  Œ: "oe",
  æ: "ae",
  Æ: "ae",
  ø: "o",
  Ø: "o",
  ł: "l",
  Ł: "l",
  đ: "d",
  Đ: "d",
};

interface SentenceDoc {
  /** Unique ordinal across the index (total order for tiebreaks). */
  docOrdinal: number;
  turnIndex: number;
  role: "user" | "assistant";
  unitSentenceIndex: number;
  unitSlot: number;
  original: string;
  normalized: string;
  tf: Map<string, number>;
  dl: number;
  salience: number;
}

function applyTranslit(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    out += TRANSLIT[ch] ?? ch;
  }
  return out;
}

export function normalize(s: string): string {
  return applyTranslit(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Protect URLs / emails / versions / decimals so sentence split does not tear them.
 * Placeholders use a private-use-ish pattern unlikely in chat.
 */
function protectSpans(text: string): { text: string; spans: string[] } {
  const spans: string[] = [];
  const stash = (m: string): string => {
    const id = spans.length;
    spans.push(m);
    return `\uE000${id}\uE001`;
  };
  let t = text;
  // Order: URLs (dots inside), emails, multi-dot versions, then simple decimals
  t = t.replace(/https?:\/\/\S+/gi, stash);
  t = t.replace(/\b[\w.+-]+@[\w.-]+\.\w{2,}\b/gi, stash);
  // Optional "v"/"V" prefix so v2.5.1 is not torn at the letter/digit edge
  t = t.replace(/\bv?\d+(?:\.\d+){1,}\b/gi, stash);
  t = t.replace(/\b\d+[.,]\d+\b/g, stash);
  return { text: t, spans };
}

function restoreSpans(text: string, spans: string[]): string {
  if (spans.length === 0) return text;
  return text.replace(/\uE000(\d+)\uE001/g, (_, id: string) => {
    const i = Number(id);
    return spans[i] ?? "";
  });
}

/**
 * Split on `.`, `!`, `?`, newlines with protected spans restored.
 * - drop fragments < 6 chars
 * - merge 6–9 char fragments into the following sentence (or previous if last)
 * - drop after merge only if still < 6; keep ≥6 so short facts stay visible
 * - cap at MAX_SENTENCE_LEN; accept if final length ≥ MIN_SENTENCE_LEN (10)
 *   or was a merged short fact (≥ MIN_KEEP_LEN)
 */
export function segmentSentences(text: string): string[] {
  if (!text) return [];
  const { text: protectedText, spans } = protectSpans(text);
  const parts = protectedText.split(/[.!?\n]+/);
  const trimmed: string[] = [];
  for (const raw of parts) {
    const s = restoreSpans(raw.trim(), spans);
    if (s.length > 0) trimmed.push(s);
  }

  const merged: string[] = [];
  let pending = "";
  for (const s of trimmed) {
    const piece = pending ? `${pending} ${s}` : s;
    pending = "";
    if (piece.length < MIN_KEEP_LEN) {
      continue;
    }
    if (piece.length < MIN_SENTENCE_LEN) {
      pending = piece;
      continue;
    }
    merged.push(
      piece.length > MAX_SENTENCE_LEN
        ? piece.slice(0, MAX_SENTENCE_LEN)
        : piece,
    );
  }
  if (pending) {
    if (merged.length > 0) {
      const last = `${merged[merged.length - 1]} ${pending}`;
      merged[merged.length - 1] =
        last.length > MAX_SENTENCE_LEN
          ? last.slice(0, MAX_SENTENCE_LEN)
          : last;
    } else if (pending.length >= MIN_KEEP_LEN) {
      // Lone short fact — keep so nothing ≥6 chars is invisible
      merged.push(
        pending.length > MAX_SENTENCE_LEN
          ? pending.slice(0, MAX_SENTENCE_LEN)
          : pending,
      );
    }
  }
  return merged;
}

/**
 * Character 3-grams and 4-grams over space-padded normalized text.
 * Single forward pass; only one string pad allocation.
 */
export function ngramCounts(normalized: string): Map<string, number> {
  const counts = new Map<string, number>();
  if (!normalized) return counts;
  const padded = ` ${normalized} `;
  const n = padded.length;
  // Emit 3-grams for every window; 4-grams when the window fits.
  for (let i = 0; i <= n - 3; i++) {
    const g3 = padded.slice(i, i + 3);
    counts.set(g3, (counts.get(g3) ?? 0) + 1);
    if (i <= n - 4) {
      const g4 = padded.slice(i, i + 4);
      counts.set(g4, (counts.get(g4) ?? 0) + 1);
    }
  }
  return counts;
}

export function tokenCount(tf: Map<string, number>): number {
  let n = 0;
  for (const c of tf.values()) n += c;
  return n;
}

/** Count distinct query n-grams present in the document (content overlap). */
export function sharedGramCount(
  queryGrams: Map<string, number>,
  docTf: Map<string, number>,
): number {
  let n = 0;
  for (const t of queryGrams.keys()) {
    if (docTf.has(t)) n++;
  }
  return n;
}

function firstWord(sentence: string): string {
  const m = sentence.match(/^\s*(\S+)/u);
  return m ? m[1] : "";
}

function computeSalience(original: string): number {
  let score = 0;

  const digits = original.match(/\d+/g);
  if (digits) score += digits.length;

  const first = firstWord(original);
  // /u: non-ASCII capitals participate correctly in word boundaries
  const properRe = /\b[A-ZÀ-ÖØ-Þ][a-zà-öø-ÿ]+\b/gu;
  let pm: RegExpExecArray | null;
  while ((pm = properRe.exec(original)) !== null) {
    if (pm[0] === first) continue;
    if (
      pm.index === 0 ||
      (pm.index > 0 && original.slice(0, pm.index).trim() === "")
    ) {
      continue;
    }
    score += 1;
  }

  if (/"[^"]+"|'[^']+'/.test(original)) score += 1;

  for (const re of ANCHOR_PATTERNS) {
    re.lastIndex = 0;
    const matches = original.match(re);
    if (matches) score += 0.5 * matches.length;
  }

  return score;
}

export function idf(N: number, df: number): number {
  return Math.log((N - df + 0.5) / (df + 0.5) + 1);
}

/** Minimal doc shape for BM25+ (tf map + document length). */
export interface Bm25Doc {
  tf: Map<string, number>;
  dl: number;
}

export function bm25plus(
  queryGrams: Map<string, number>,
  doc: Bm25Doc,
  dfMap: Map<string, number>,
  N: number,
  avgdl: number,
): number {
  if (N === 0 || doc.dl === 0) return 0;
  let score = 0;
  const denomBase = K1 * (1 - B + B * (doc.dl / (avgdl || 1)));
  for (const t of queryGrams.keys()) {
    const tf = doc.tf.get(t) ?? 0;
    if (tf === 0) continue;
    const df = dfMap.get(t) ?? 0;
    const termIdf = idf(N, df);
    score += termIdf * ((tf * (K1 + 1)) / (tf + denomBase) + DELTA);
  }
  return score;
}

/**
 * Word set used by jaccardWords.
 * Callers that already hold normalized text should build the set once and
 * reuse it across comparisons (hot path in merge / candidate selection).
 */
export function wordSet(normalized: string): Set<string> {
  return new Set(normalized.split(/\s+/).filter(Boolean));
}

/** Jaccard similarity over precomputed word sets (same tokenization as jaccardWords). */
export function jaccardWordSets(setA: Set<string>, setB: Set<string>): number {
  if (setA.size === 0 && setB.size === 0) return 0;
  let inter = 0;
  for (const w of setA) {
    if (setB.has(w)) inter++;
  }
  const union = setA.size + setB.size - inter;
  if (union === 0) return 0;
  return inter / union;
}

export function jaccardWords(a: string, b: string): number {
  return jaccardWordSets(wordSet(a), wordSet(b));
}

/**
 * Sequence form for textual (substring) containment, from already-normalized text.
 *
 * `normalize` keeps punctuation (verified: "accurate." ≠ "accurate"), so a
 * sentence-final `.` that a paragraph window dropped would defeat raw
 * `includes`. This form strips non-letter/non-digit runs to spaces and
 * collapses whitespace so the real sentence⊂paragraph fixture matches while
 * meaning-inverting pairs (negation, word reordering) do not.
 *
 * No word-count floor: a passage that is a literal contiguous substring of
 * another adds no new text, so it is always safe to collapse.
 */
export function containmentForm(normalized: string): string {
  return normalized
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * True when the shorter non-empty containmentForm is a contiguous substring of
 * the longer (equal forms count as contained). Empty forms never match.
 *
 * Callers must pass already-`normalize`d text (same path as the retrieval loop).
 */
export function isTextuallyContained(normA: string, normB: string): boolean {
  const fa = containmentForm(normA);
  const fb = containmentForm(normB);
  if (!fa || !fb) return false;
  if (fa.length <= fb.length) return fb.includes(fa);
  return fa.includes(fb);
}

function stableSortIndices(
  n: number,
  compare: (i: number, j: number) => number,
): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  idx.sort(compare);
  return idx;
}

/** Truncate to max code units, never splitting a surrogate pair; append … if cut. */
export function truncateWithEllipsis(s: string, maxChars: number): string {
  if (maxChars <= 0) return "";
  if (s.length <= maxChars) return s;
  if (maxChars === 1) return "…";
  let end = maxChars - 1; // room for ellipsis
  if (end > 0) {
    const c = s.charCodeAt(end - 1);
    // High surrogate alone at cut → back up one
    if (c >= 0xd800 && c <= 0xdbff) end -= 1;
  }
  if (end <= 0) return "…";
  return s.slice(0, end) + "…";
}

function resolveTopN(raw: number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.floor(raw);
  }
  return DEFAULT_TOP_N;
}

function resolveMaxChars(raw: number | undefined): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  // ≤0 or invalid → default (F2)
  return DEFAULT_MAX_CHARS;
}

/**
 * Assemble snippet as [role tag] + optional prev + current + optional next,
 * original order, truncated to maxChars.
 */
function assembleSnippet(
  d: SentenceDoc,
  unitSentences: string[][],
  maxChars: number,
): string {
  const tag = `[${d.role}] `;
  const sents = unitSentences[d.unitSlot] ?? [];
  const cur = d.original;
  const prev =
    d.unitSentenceIndex > 0 ? sents[d.unitSentenceIndex - 1] : null;
  const next =
    d.unitSentenceIndex < sents.length - 1
      ? sents[d.unitSentenceIndex + 1]
      : null;

  // Greedy: start with tag+current, then prepend prev if fits, then append next if fits
  let body = cur;
  if (prev) {
    const withPrev = `${prev} ${body}`;
    if (tag.length + withPrev.length <= maxChars) {
      body = withPrev;
    }
  }
  if (next) {
    const withNext = `${body} ${next}`;
    if (tag.length + withNext.length <= maxChars) {
      body = withNext;
    }
  }
  return truncateWithEllipsis(`${tag}${body}`, maxChars);
}

function tiebreakDocs(a: SentenceDoc, b: SentenceDoc): number {
  if (a.turnIndex !== b.turnIndex) return a.turnIndex - b.turnIndex;
  if (a.unitSentenceIndex !== b.unitSentenceIndex) {
    return a.unitSentenceIndex - b.unitSentenceIndex;
  }
  return a.docOrdinal - b.docOrdinal;
}

/**
 * Incremental BM25+ index for append-only conversation history.
 * Callers (Fase 1b) should keep one instance per chat and append new turns.
 */
export class RetrieverIndex {
  private docs: SentenceDoc[] = [];
  private unitSentences: string[][] = [];
  private dfMap = new Map<string, number>();
  private totalDl = 0;
  private nextOrdinal = 0;

  /** Append conversation units (tokenized + DF updated). */
  append(units: RetrievalUnit[] | null | undefined): void {
    if (!Array.isArray(units) || units.length === 0) return;

    for (let ui = 0; ui < units.length; ui++) {
      const unit = units[ui];
      if (!unit || typeof unit.text !== "string") continue;
      const role = unit.role === "assistant" ? "assistant" : "user";
      const turnIndex =
        typeof unit.turnIndex === "number" && Number.isFinite(unit.turnIndex)
          ? unit.turnIndex
          : this.unitSentences.length;
      const sents = segmentSentences(unit.text);
      const unitSlot = this.unitSentences.length;
      this.unitSentences.push(sents);

      for (let si = 0; si < sents.length; si++) {
        const original = sents[si];
        const normalized = normalize(original);
        if (!normalized) continue;
        const tf = ngramCounts(normalized);
        const dl = tokenCount(tf);
        const doc: SentenceDoc = {
          docOrdinal: this.nextOrdinal++,
          turnIndex,
          role,
          unitSentenceIndex: si,
          unitSlot,
          original,
          normalized,
          tf,
          dl,
          salience: computeSalience(original),
        };
        this.docs.push(doc);
        this.totalDl += dl;
        for (const t of tf.keys()) {
          this.dfMap.set(t, (this.dfMap.get(t) ?? 0) + 1);
        }
      }
    }
  }

  /**
   * Drop the oldest `count` conversation units (FIFO sliding window).
   * Updates DF / totalDl so BM25 stays correct after eviction.
   * No-op when count ≤ 0. Clamps to unit count.
   */
  dropOldestUnits(count: number): void {
    if (!Number.isFinite(count) || count <= 0) return;
    const n = Math.min(Math.floor(count), this.unitSentences.length);
    if (n <= 0) return;

    const kept: SentenceDoc[] = [];
    for (let i = 0; i < this.docs.length; i++) {
      const d = this.docs[i];
      if (d.unitSlot < n) {
        this.totalDl -= d.dl;
        for (const t of d.tf.keys()) {
          const df = (this.dfMap.get(t) ?? 1) - 1;
          if (df <= 0) this.dfMap.delete(t);
          else this.dfMap.set(t, df);
        }
      } else {
        d.unitSlot -= n;
        kept.push(d);
      }
    }
    this.docs = kept;
    this.unitSentences = this.unitSentences.slice(n);
  }

  get documentCount(): number {
    return this.docs.length;
  }

  /**
   * Retrieve top snippets for a query against the indexed corpus.
   * Privacy gate: only docs with BM25+ > 0 and ≥ MIN_SHARED_GRAMS shared n-grams.
   */
  retrieve(
    query: string | null | undefined,
    options?: RetrieveOptions,
  ): RetrievedSnippet[] {
    let q = typeof query === "string" ? query : "";
    if (q.length > MAX_QUERY_LEN) q = q.slice(0, MAX_QUERY_LEN);
    const qNorm = normalize(q);
    const N = this.docs.length;
    if (N === 0 || !qNorm) return [];

    const topN = resolveTopN(options?.topN);
    const maxChars = resolveMaxChars(options?.maxCharsPerSnippet);
    if (topN <= 0) return [];

    const avgdl = this.totalDl / N;
    const queryGrams = ngramCounts(qNorm);
    if (queryGrams.size === 0) return [];

    // Gate: only docs with enough lexical overlap and positive BM25+
    const candidates: number[] = [];
    const bm25Scores = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const d = this.docs[i];
      const shared = sharedGramCount(queryGrams, d.tf);
      if (shared < MIN_SHARED_GRAMS) continue;
      const score = bm25plus(queryGrams, d, this.dfMap, N, avgdl);
      if (score <= 0) continue;
      candidates.push(i);
      bm25Scores.set(i, score);
    }

    const C = candidates.length;
    if (C === 0) return [];

    // Rank only among gated candidates (salience cannot resurrect zero-overlap docs)
    const candDocs = candidates.map((i) => this.docs[i]);

    const bm25Order = stableSortIndices(C, (a, b) => {
      const ia = candidates[a];
      const ib = candidates[b];
      const ds = (bm25Scores.get(ib) ?? 0) - (bm25Scores.get(ia) ?? 0);
      if (ds !== 0) return ds > 0 ? 1 : -1;
      return tiebreakDocs(candDocs[a], candDocs[b]);
    });
    const bm25Rank = new Int32Array(C);
    for (let r = 0; r < C; r++) bm25Rank[bm25Order[r]] = r + 1;

    const salOrder = stableSortIndices(C, (a, b) => {
      const ds = candDocs[b].salience - candDocs[a].salience;
      if (ds !== 0) return ds > 0 ? 1 : -1;
      return tiebreakDocs(candDocs[a], candDocs[b]);
    });
    const salRank = new Int32Array(C);
    for (let r = 0; r < C; r++) salRank[salOrder[r]] = r + 1;

    const fused = new Float64Array(C);
    for (let c = 0; c < C; c++) {
      fused[c] = 1 / (RRF_K + bm25Rank[c]) + 1 / (RRF_K + salRank[c]);
    }

    const order = stableSortIndices(C, (a, b) => {
      const ds = fused[b] - fused[a];
      if (ds !== 0) return ds > 0 ? 1 : -1;
      return tiebreakDocs(candDocs[a], candDocs[b]);
    });

    const selected: number[] = []; // indices into candidates[]
    for (const c of order) {
      let dup = false;
      for (const s of selected) {
        if (
          jaccardWords(candDocs[c].normalized, candDocs[s].normalized) >=
          JACCARD_DEDUP
        ) {
          dup = true;
          break;
        }
      }
      if (!dup) selected.push(c);
      if (selected.length >= topN) break;
    }

    const results: RetrievedSnippet[] = [];
    for (const c of selected) {
      const d = candDocs[c];
      results.push({
        turnIndex: d.turnIndex,
        role: d.role,
        text: assembleSnippet(d, this.unitSentences, maxChars),
        score: fused[c],
      });
    }
    return results;
  }
}

/**
 * One-shot retrieve: builds a throwaway index (API compat).
 * Prefer RetrieverIndex for multi-query / production use.
 */
export function retrieveRelevant(
  history: RetrievalUnit[] | null | undefined,
  query: string | null | undefined,
  options?: RetrieveOptions,
): RetrievedSnippet[] {
  const index = new RetrieverIndex();
  index.append(history);
  return index.retrieve(query, options);
}
