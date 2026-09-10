import type { RetrievedPassage } from "../context/retrievalLoop";
import { rrfFuse } from "./semanticIndex";
import {
  HYBRID_DENSE_TOP_N,
  HYBRID_FINAL_TOP_K,
  HYBRID_RERANK_ENABLED,
  HYBRID_RRF_K,
} from "./documentChatConstants";
import type {
  DocumentChatHost,
  HybridAttempt,
} from "./documentChatTypes";
import type { LibraryDoc } from "./DocumentLibrary";

export function buildRerankPrompt(query: string, passage: string): string {
  return (
    `Does the passage answer the query? Answer only yes or no.\n` +
    `Query: ${query}\n` +
    `Passage: ${passage}`
  );
}

export async function maybeRerankPassages(
  query: string,
  passages: RetrievedPassage[],
  _opts?: { enabled?: boolean },
): Promise<RetrievedPassage[]> {
  void query;
  const enabled = _opts?.enabled ?? HYBRID_RERANK_ENABLED;
  if (!enabled || passages.length === 0) return passages;
  return passages;
}

export async function tryHybridRetrieve(
  host: DocumentChatHost,
  doc: LibraryDoc,
  query: string,
  bm25Passages: RetrievedPassage[],
  signal?: AbortSignal,
): Promise<HybridAttempt | null> {
  try {
    if (signal?.aborted) return bm25Only();
    const embedderDownloaded =
      typeof host.isEmbedderDownloaded === "function"
        ? host.isEmbedderDownloaded()
        : false;
    if (!embedderDownloaded) return bm25Only();

    let semantic =
      typeof host.getSemanticIndexFor === "function"
        ? host.getSemanticIndexFor(doc.id)
        : null;
    if (
      (!semantic || semantic.chunkCount <= 0) &&
      typeof host.loadSemanticIndexFor === "function"
    ) {
      semantic = await host.loadSemanticIndexFor(doc.id);
    }
    if (signal?.aborted) return bm25Only();

    const hostReason =
      typeof host.getDenseUnavailableReason === "function"
        ? host.getDenseUnavailableReason(doc.id)
        : null;
    const vectorChunkCount = semantic?.chunkCount ?? 0;
    if (!semantic || vectorChunkCount <= 0) {
      return {
        strategy: "bm25_only",
        passages: null,
        denseUnavailableReason:
          hostReason === "cap" ||
          hostReason === "capped" ||
          hostReason === "corrupt" ||
          hostReason === "hung" ||
          hostReason === "no_embedder"
            ? hostReason
            : "no_embedder",
      };
    }
    if (hostReason === "cap" || hostReason === "corrupt" || hostReason === "hung") {
      return {
        strategy: "bm25_only",
        passages: null,
        denseUnavailableReason: hostReason,
      };
    }
    const partialCapped = hostReason === "capped" || semantic.isCapped === true;

    if (typeof host.embedQuery !== "function") return bm25Only();
    const queryVec = await host.embedQuery(query, signal);
    if (!queryVec) return bm25Only();
    const denseHits = semantic.query(queryVec, HYBRID_DENSE_TOP_N);
    if (!denseHits.length) return bm25Only();

    const sparseRanks = bm25Passages.map((p, i) => ({ chunkId: p.chunkId, rank: i }));
    const denseRanks = denseHits.map((h, i) => ({ chunkId: h.chunkId, rank: i }));
    const fused = rrfFuse(sparseRanks, denseRanks, { k: HYBRID_RRF_K });
    if (!fused.length) return bm25Only();

    const byId = new Map<string, RetrievedPassage>();
    for (const p of bm25Passages) byId.set(p.chunkId, p);
    const fusedPassages: RetrievedPassage[] = [];
    for (const row of fused) {
      if (fusedPassages.length >= HYBRID_FINAL_TOP_K) break;
      const existing = byId.get(row.chunkId);
      if (existing) {
        fusedPassages.push(existing);
        continue;
      }
      const denseText =
        typeof semantic.getChunkText === "function"
          ? semantic.getChunkText(row.chunkId)
          : null;
      if (!denseText) continue;
      const hashIdx = row.chunkId.lastIndexOf("#");
      const parts = row.chunkId.split("#");
      const granRaw = parts.length >= 3 ? parts[parts.length - 2] : "sentence";
      const granularity = granRaw === "paragraph" ? ("paragraph" as const) : ("sentence" as const);
      const denseDocId =
        hashIdx > 0 && parts.length >= 3
          ? parts.slice(0, parts.length - 2).join("#")
          : doc.id;
      fusedPassages.push({
        docId: denseDocId || doc.id,
        chunkId: row.chunkId,
        granularity,
        text: denseText,
        score: row.score,
        round: 0,
        rankInRound: fusedPassages.length + 1,
      });
    }
    if (!fusedPassages.length) return bm25Only();
    return {
      passages: fusedPassages,
      strategy: "hybrid",
      denseUnavailableReason: partialCapped ? "capped" : null,
    };
  } catch {
    return bm25Only();
  }
}

function bm25Only(): HybridAttempt {
  return {
    strategy: "bm25_only",
    passages: null,
    denseUnavailableReason: "no_embedder",
  };
}
