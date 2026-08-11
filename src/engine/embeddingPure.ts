/**
 * Pure helpers for the embedding / hybrid path (no llama.rn, no RN).
 * Node-harness safe. EmbeddingService re-exports these for app callers.
 */

import {
  embedDocPrefix,
  embedQueryPrefix,
  planIncrementalEmbed,
} from "../documents/semanticIndex";
import { segmentSentences, normalize } from "../context/retriever";

/**
 * Stable FNV-1a 32-bit hex of chunk text. Used as contentHash for
 * planIncrementalEmbed so re-imports of unchanged text skip re-embed.
 */
export function hashChunkContent(text: string): string {
  const s = typeof text === "string" ? text : "";
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    // h *= 16777619 (with 32-bit overflow)
    h = Math.imul(h, 0x01000193);
  }
  // unsigned hex
  return (h >>> 0).toString(16).padStart(8, "0");
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

const MIN_PARAGRAPH_LEN = 20;
const MAX_PARAGRAPH_WINDOW = 600;
const MIN_BULLET_PARA_LEN = 6;

/**
 * Paragraph windows matching retrievalLoop.segmentParagraphs (kept local so
 * we do not depend on a private export). Used only for embed-chunk listing.
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
    // Window long paragraphs without mid-sentence cuts when possible.
    const parts = p.split(/(?<=[.!?])\s+/);
    let buf = "";
    for (const part of parts) {
      const next = buf ? `${buf} ${part}` : part;
      if (next.length > MAX_PARAGRAPH_WINDOW && buf) {
        out.push(buf);
        buf = part.slice(0, MAX_PARAGRAPH_WINDOW);
      } else if (next.length > MAX_PARAGRAPH_WINDOW) {
        out.push(next.slice(0, MAX_PARAGRAPH_WINDOW));
        buf = "";
      } else {
        buf = next;
      }
    }
    if (buf) out.push(buf);
  }
  return out;
}

/**
 * Build embeddable chunks for a multi-page doc using the same chunkId scheme
 * as DocRetrieverIndex (`${docId}#sentence#N` / `${docId}#paragraph#N`).
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

    let sentOrd = 0;
    for (const original of segmentSentences(page.text)) {
      if (!original) continue;
      const normalized = normalize(original);
      if (!normalized) continue;
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
 * Plan which chunks need embedding, given an existing set of contentHashes
 * already present in the per-doc vector index. Thin wrapper over
 * planIncrementalEmbed for the service's own contentHash scheme.
 */
export function planChunksToEmbed(
  existingHashes: Set<string>,
  chunks: EmbeddableChunk[],
): EmbeddableChunk[] {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  const need = new Set(
    planIncrementalEmbed(
      existingHashes instanceof Set ? existingHashes : new Set(),
      chunks.map((c) => ({ chunkId: c.chunkId, contentHash: c.contentHash })),
    ),
  );
  if (need.size === 0) return [];
  const out: EmbeddableChunk[] = [];
  const seen = new Set<string>();
  for (const c of chunks) {
    if (!need.has(c.contentHash)) continue;
    if (seen.has(c.contentHash)) continue;
    seen.add(c.contentHash);
    out.push(c);
  }
  return out;
}
