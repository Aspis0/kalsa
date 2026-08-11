/**
 * Pure helpers for the embedding / hybrid path (no llama.rn, no RN).
 * Node-harness safe. EmbeddingService re-exports these for app callers.
 */

import {
  embedDocPrefix,
  embedQueryPrefix,
} from "../documents/semanticIndex";
import {
  segmentSentences,
  normalize,
  ngramCounts,
  tokenCount,
} from "../context/retriever";

/**
 * Composite key for (chunkId, contentHash) incremental planning.
 * Same text in different chunks embeds per chunk (provenance kept);
 * identical (chunkId, hash) reuses the existing vector.
 */
export function embedChunkKey(chunkId: string, contentHash: string): string {
  return `${chunkId}\0${contentHash}`;
}

/**
 * Stable 64-bit content hash as 16-char hex.
 *
 * Two independent FNV-1a 32-bit rounds (different seeds + position mix on h2)
 * concatenated. Avoids BigInt so Hermes / older JSC paths stay happy, while
 * giving a wider key than the previous 32-bit FNV-1a (collision-resistant
 * enough for per-doc chunk inventories).
 */
export function hashChunkContent(text: string): string {
  const s = typeof text === "string" ? text : "";
  // FNV-1a 32-bit, seed A
  let h1 = 0x811c9dc5;
  // FNV-1a 32-bit, seed B (offset from golden-ratio mix)
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c;
    h2 = Math.imul(h2, 0x01000193);
    // Position mix keeps h2 independent of h1 on short strings.
    h2 ^= i + 1;
    h2 = Math.imul(h2, 0x01000193);
  }
  return (
    (h1 >>> 0).toString(16).padStart(8, "0") +
    (h2 >>> 0).toString(16).padStart(8, "0")
  );
}

/**
 * Decide whether the hybrid path must degrade to BM25-only.
 * True when the embedder is missing OR the doc has no vectors yet.
 */
export function shouldDegradeToBm25Only(opts: {
  embedderDownloaded: boolean;
  vectorChunkCount: number;
}): boolean {
  if (!opts || typeof opts !== "object") return true;
  if (!opts.embedderDownloaded) return true;
  const n = opts.vectorChunkCount;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return true;
  return false;
}

/**
 * Apply the e5 protocol prefix for a given role.
 * Delegates to semanticIndex helpers (idempotent).
 */
export function applyEmbedPrefix(
  text: string,
  role: "query" | "doc",
): string {
  if (role === "query") return embedQueryPrefix(text);
  return embedDocPrefix(text);
}

/** One embeddable chunk aligned with DocRetrieverIndex id scheme. */
export type EmbeddableChunk = {
  chunkId: string;
  text: string;
  contentHash: string;
};

// ── Chunking (byte-identical to DocRetrieverIndex / retrievalLoop) ──────────
//
// Single source of truth for embed chunk listing. Constants and algorithms
// mirror src/context/retrievalLoop.ts (segmentSentences + segmentParagraphs)
// so dense chunkIds / texts align with the BM25 index. Do not drift.

const MIN_PARAGRAPH_LEN = 20;
const MAX_PARAGRAPH_WINDOW = 600;
const MIN_BULLET_PARA_LEN = 6;

/**
 * Sentence split for paragraph windowing only — matches retrievalLoop.
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
 * Paragraph windows matching retrievalLoop.segmentParagraphs exactly so embed
 * chunkIds are byte-identical to DocRetrieverIndex.
 */
function segmentParagraphsForEmbed(text: string): string[] {
  if (!text) return [];
  const rawParas = text.split(/\n\s*\n/);
  const out: string[] = [];

  for (const raw of rawParas) {
    const p = raw.trim();
    if (p.length < MIN_PARAGRAPH_LEN) {
      if (!(p.startsWith("- ") && p.length >= MIN_BULLET_PARA_LEN)) continue;
    }

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
 * Build embeddable chunks for a multi-page doc using the same chunkId scheme
 * as DocRetrieverIndex (`${docId}#sentence#N` / `${docId}#paragraph#N`).
 * Pure — no I/O, no llama.rn. Chunking mirrors retrievalLoop so dense/BM25
 * alignment is byte-identical (FIX 9 single-chunking source).
 */
export function listDocumentChunksForEmbed(
  pages: Array<{ docId: string; text: string }>,
): EmbeddableChunk[] {
  if (!Array.isArray(pages) || pages.length === 0) return [];
  const out: EmbeddableChunk[] = [];
  const seenDocIds = new Set<string>();

  for (const page of pages) {
    if (!page || typeof page.text !== "string") continue;
    const docId =
      typeof page.docId === "string" && page.docId.length > 0
        ? page.docId
        : "doc-anon";
    if (seenDocIds.has(docId)) continue;
    seenDocIds.add(docId);

    // Ordinals advance only for chunks that DocRetrieverIndex would keep
    // (normalized non-empty AND tokenCount(ngramCounts) > 0) so dense chunkIds
    // stay byte-aligned with the BM25 index (FIX 9).
    let sentOrd = 0;
    for (const original of segmentSentences(page.text)) {
      if (!original) continue;
      const normalized = normalize(original);
      if (!normalized) continue;
      const dl = tokenCount(ngramCounts(normalized));
      if (dl === 0) continue;
      const chunkId = `${docId}#sentence#${sentOrd}`;
      sentOrd += 1;
      out.push({
        chunkId,
        text: original,
        contentHash: hashChunkContent(original),
      });
    }

    let paraOrd = 0;
    for (const original of segmentParagraphsForEmbed(page.text)) {
      if (!original) continue;
      const normalized = normalize(original);
      if (!normalized) continue;
      const dl = tokenCount(ngramCounts(normalized));
      if (dl === 0) continue;
      const chunkId = `${docId}#paragraph#${paraOrd}`;
      paraOrd += 1;
      out.push({
        chunkId,
        text: original,
        contentHash: hashChunkContent(original),
      });
    }
  }
  return out;
}

/**
 * Plan which chunks need embedding given existing (chunkId, contentHash) keys.
 *
 * Dedupe by (chunkId, hash):
 * - same text in different chunks → embed per chunk (provenance kept)
 * - identical (chunkId, hash) → reuse existing vector (skip)
 *
 * `existingKeys` entries are produced by embedChunkKey(chunkId, contentHash).
 */
export function planChunksToEmbed(
  existingKeys: Set<string>,
  chunks: EmbeddableChunk[],
): EmbeddableChunk[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const have = existingKeys instanceof Set ? existingKeys : new Set<string>();
  const out: EmbeddableChunk[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (!c || typeof c.chunkId !== "string" || c.chunkId.length === 0) continue;
    if (typeof c.contentHash !== "string" || c.contentHash.length === 0) continue;
    const key = embedChunkKey(c.chunkId, c.contentHash);
    if (have.has(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}
