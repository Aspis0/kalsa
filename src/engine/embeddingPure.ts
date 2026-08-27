/**
 * Pure helpers for the embedding / hybrid path (no llama.rn, no RN).
 * Node-harness safe. EmbeddingService re-exports these for app callers.
 */

import {
  embedDocPrefix,
  embedQueryPrefix,
} from "../documents/semanticIndex";
import { listDocChunks } from "../context/retrievalLoop";

/**
 * Composite key for (chunkId, contentHash) incremental planning.
 * Same text in different chunks embeds per chunk (provenance kept);
 * identical (chunkId, hash) reuses the existing vector.
 */
export function embedChunkKey(chunkId: string, contentHash: string): string {
  return `${chunkId}\0${contentHash}`;
}

/**
 * Canonical FNV-1a 64-bit content hash as 16-char lowercase hex.
 *
 * Offset basis 0xcbf29ce484222325, prime 0x100000001b3, 64-bit arithmetic.
 * Implemented with BigInt: Hermes in RN 0.86 (Hermes ≥0.12 era) supports
 * BigInt natively, so we do not need a two-lane 32-bit carry emulation.
 *
 * Known constants:
 *   FNV("")  = 0xcbf29ce484222325
 *   FNV("a") = 0xaf63dc4c8601ec8c
 */
export function hashChunkContent(text: string): string {
  const s = typeof text === "string" ? text : "";
  // Canonical FNV-1a 64-bit constants (Fowler–Noll–Vo).
  const FNV_OFFSET = 0xcbf29ce484222325n;
  const FNV_PRIME = 0x100000001b3n;
  const MASK64 = 0xffffffffffffffffn;
  let h = FNV_OFFSET;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK64;
  }
  return h.toString(16).padStart(16, "0");
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

// ── Chunking (single source: retrievalLoop.listDocChunks) ───────────────────
//
// Dense embed path no longer mirrors segmentation. listDocChunks in
// retrievalLoop.ts is the sole segmentation function; DocRetrieverIndex.append
// and this helper both call it so chunkIds/texts stay byte-identical.

/**
 * Build embeddable chunks for a multi-page doc via listDocChunks (shared with
 * DocRetrieverIndex). Adds contentHash for incremental embed planning.
 * Pure — no I/O, no llama.rn.
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

    for (const entry of listDocChunks(page.text, docId)) {
      out.push({
        chunkId: entry.chunkId,
        text: entry.text,
        contentHash: hashChunkContent(entry.text),
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
