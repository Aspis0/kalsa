/**
 * The per-document retrieval indexes the tool executor and the document
 * chat read: the BM25 index map, the dense (semantic) map, the dense
 * unavailable-reason map and the embed-hash map — lifted from
 * `AppShell.tsx:1126-1160` — plus `ensureSemanticIndexLoaded`, the lazy
 * sidecar restore lifted from `AppShell.tsx:1439-1523` (D fix: no startup
 * vector restore; cap; corrupt → BM25-only with a reason).
 *
 * What is NOT here: the background embed job that BUILDS those sidecars
 * (`AppShell.tsx:1590-2044`) — not mounted in this host, so imports land
 * BM25-first and dense reads still work for sidecars the old app wrote.
 */
import { DEFAULT_VECTOR_MEMORY_FLOAT_CAP, SemanticVectorIndex, totalResidentFloats } from "../documents/semanticIndex";
import { readVectorIndexFile } from "../documents/documentStorage";
import { isReadActive, releaseRead, tryAcquireRead } from "../documents/docOpGate";
import { DocRetrieverIndex } from "../context/retrievalLoop";
import type { LibraryState } from "../documents/DocumentLibrary";

export const docIndexByIdRef: { current: Map<string, DocRetrieverIndex> } = {
  current: new Map(),
};
/**
 * Per-doc dense vector index. Durable under kalsa-documents/{docId}.vec.json;
 * also held in memory for the session. Dropped on delete / library prune
 * alongside the BM25 index and the .vec.json sidecar.
 */
export const docSemanticByIdRef: { current: Map<string, SemanticVectorIndex> } = {
  current: new Map(),
};
/**
 * Per-doc dense-unavailable reason when the index was refused (cap / corrupt)
 * or partially capped mid-embed. Cleared when a usable index is installed.
 */
export const docDenseReasonByIdRef: {
  current: Map<string, "cap" | "capped" | "corrupt" | "no_embedder" | "hung">;
} = { current: new Map() };
/**
 * Existing (chunkId, contentHash) keys per doc for incremental embed planning
 * (see embedChunkKey). Same text in different chunks embed per chunk.
 */
export const docEmbedHashesByIdRef: { current: Map<string, Set<string>> } = {
  current: new Map(),
};
/** Module-local cap (same value the old component kept in a local). */
const VECTOR_MEMORY_FLOAT_CAP = DEFAULT_VECTOR_MEMORY_FLOAT_CAP;


export interface DocIndexDeps {
  documentLibraryRef: { current: LibraryState };
}

  /**
   * FIX D — lazy per-doc vector restore (no startup cost).
   *
   * Memory policy: total loaded floats across all docs must stay under
   * DEFAULT_VECTOR_MEMORY_FLOAT_CAP (400_000 ≈ 1.6 MB fp32; raised from 200k
   * after Jelly HIGH-4: 516-chunk partial on 273 KB docs). If loading this
   * doc would exceed the cap, leave it BM25-only (return null) and record
   * reason "cap". Corrupt / missing sidecars → reason "corrupt".
   */
export async function ensureSemanticIndexLoaded(
  deps: DocIndexDeps,
  docId: string,
): Promise<SemanticVectorIndex | null> {
  const { documentLibraryRef } = deps;
      if (!docId || typeof docId !== "string") return null;
      const live = docSemanticByIdRef.current.get(docId);
      if (live && live.chunkCount > 0) {
        // Live index may still be marked capped (partial embed) — keep reason.
        return live;
      }

      // Doc must still be in the library.
      if (!documentLibraryRef.current.docs?.some((d) => d.id === docId)) {
        return null;
      }

      // document_chat already holds READ (non-reentrant). Reuse that latch
      // instead of tryAcquireRead, which would fail and skip the sidecar load.
      const readAlreadyHeld = isReadActive();
      if (!readAlreadyHeld && !tryAcquireRead()) return null;
      try {
        const raw = await readVectorIndexFile(docId);
        // Re-check after await.
        if (!documentLibraryRef.current.docs?.some((d) => d.id === docId)) {
          return null;
        }
        if (!raw || typeof raw !== "object") {
          // Missing sidecar is not "corrupt" — just cold (no reason).
          return null;
        }
        let idx: SemanticVectorIndex;
        try {
          idx = SemanticVectorIndex.fromJSON(
            raw as ReturnType<SemanticVectorIndex["toJSON"]>,
          );
        } catch {
          docDenseReasonByIdRef.current.set(docId, "corrupt");
          return null; // corrupt / bad dims → BM25-only
        }
        // Zero-vector edge (round 6): a capped sidecar with zero valid vectors
        // must still record "capped" so hybrid surfaces degraded-cap consistently
        // (do not early-return before recording the reason).
        if (idx.chunkCount <= 0) {
          if (idx.isCapped) {
            docDenseReasonByIdRef.current.set(docId, "capped");
          }
          return null;
        }

        // Memory policy: refuse load if total floats would exceed the cap.
        const loadedFloats = totalResidentFloats(docSemanticByIdRef.current.values());
        const incoming = idx.chunkCount * idx.dims;
        if (loadedFloats + incoming > VECTOR_MEMORY_FLOAT_CAP) {
          // Beyond cap → BM25-only for this doc; surface reason to hybrid path.
          docDenseReasonByIdRef.current.set(docId, "cap");
          return null;
        }

        docSemanticByIdRef.current.set(docId, idx);
        docEmbedHashesByIdRef.current.set(docId, idx.contentHashKeys());
        // FIX 3: retain "capped" when the restored index is partial; only clear
        // the reason when the index is genuinely uncapped (full hybrid).
        if (idx.isCapped) {
          docDenseReasonByIdRef.current.set(docId, "capped");
        } else {
          docDenseReasonByIdRef.current.delete(docId);
        }
        return idx;
      } catch {
        docDenseReasonByIdRef.current.set(docId, "corrupt");
        return null;
      } finally {
        if (!readAlreadyHeld) releaseRead();
      }
}
