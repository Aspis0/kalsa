import {
  applyEmbedPrefix,
  embedChunkKey,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
  shouldLogEmbedProgress,
} from "./embeddingPure";

describe("embeddingPure", () => {
  test("hashChunkContent is stable canonical FNV-1a", () => {
    expect(hashChunkContent("")).toBe("cbf29ce484222325");
    expect(hashChunkContent("a")).toBe("af63dc4c8601ec8c");
    expect(hashChunkContent("hello")).toBe(hashChunkContent("hello"));
    expect(hashChunkContent("hello")).not.toBe(hashChunkContent("hello!"));
  });

  test("applies idempotent query and document prefixes", () => {
    expect(applyEmbedPrefix("casa", "query")).toBe("query: casa");
    expect(applyEmbedPrefix("query: casa", "query")).toBe("query: casa");
    expect(applyEmbedPrefix("casa", "doc")).toBe("passage: casa");
    expect(applyEmbedPrefix("passage: casa", "doc")).toBe("passage: casa");
  });

  test("degrades when the embedder or vectors are unavailable", () => {
    expect(shouldDegradeToBm25Only({ embedderDownloaded: false, vectorChunkCount: 4 })).toBe(true);
    expect(shouldDegradeToBm25Only({ embedderDownloaded: true, vectorChunkCount: 0 })).toBe(true);
    expect(shouldDegradeToBm25Only({ embedderDownloaded: true, vectorChunkCount: 2 })).toBe(false);
  });

  test("shares retrieval chunk ids and plans only missing chunk hashes", () => {
    const chunks = listDocumentChunksForEmbed([
      {
        docId: "paper#p1",
        text: "Alpha is the first sentence. Beta is the second sentence.",
      },
    ]);

    expect(chunks.some((chunk) => chunk.chunkId === "paper#p1#sentence#0")).toBe(true);
    expect(chunks.some((chunk) => chunk.chunkId === "paper#p1#paragraph#0")).toBe(true);
    expect(chunks.every((chunk) => chunk.contentHash.length === 16)).toBe(true);

    const first = chunks[0]!;
    const existing = new Set([embedChunkKey(first.chunkId, first.contentHash)]);
    const planned = planChunksToEmbed(existing, [first, first, ...chunks.slice(1)]);
    expect(planned).toHaveLength(chunks.length - 1);
    expect(planned).not.toContainEqual(first);
  });

  test("logs progress at every 50 chunks and at the final planned chunk", () => {
    // Interval boundaries on a non-round total.
    expect(shouldLogEmbedProgress(50, 707)).toBe(true);
    expect(shouldLogEmbedProgress(100, 707)).toBe(true);
    expect(shouldLogEmbedProgress(51, 707)).toBe(false);
    expect(shouldLogEmbedProgress(99, 707)).toBe(false);
    // Final planned chunk (not a multiple of the interval).
    expect(shouldLogEmbedProgress(707, 707)).toBe(true);
    // Final chunk before any interval boundary.
    expect(shouldLogEmbedProgress(30, 30)).toBe(true);
    // Final chunk that is also an interval boundary is still one predicate hit.
    expect(shouldLogEmbedProgress(50, 50)).toBe(true);
    expect(shouldLogEmbedProgress(100, 100)).toBe(true);
    // Invalid / out-of-range inputs never fire.
    expect(shouldLogEmbedProgress(0, 707)).toBe(false);
    expect(shouldLogEmbedProgress(-50, 707)).toBe(false);
    expect(shouldLogEmbedProgress(708, 707)).toBe(false);
    expect(shouldLogEmbedProgress(1.5, 10)).toBe(false);
    expect(shouldLogEmbedProgress(10, 10, 0)).toBe(false);
  });

  test("emits exactly one progress line per qualifying count (no duplicates)", () => {
    const logged: number[] = [];
    for (let embedded = 1; embedded <= 250; embedded += 1) {
      if (shouldLogEmbedProgress(embedded, 250)) logged.push(embedded);
    }
    expect(logged).toEqual([50, 100, 150, 200, 250]);

    // final === multiple of 50 must not be counted twice, and short jobs log
    // only the final chunk.
    const finalMultiple: number[] = [];
    for (let embedded = 1; embedded <= 100; embedded += 1) {
      if (shouldLogEmbedProgress(embedded, 100)) finalMultiple.push(embedded);
    }
    expect(finalMultiple).toEqual([50, 100]);

    const shortJob: number[] = [];
    for (let embedded = 1; embedded <= 12; embedded += 1) {
      if (shouldLogEmbedProgress(embedded, 12)) shortJob.push(embedded);
    }
    expect(shortJob).toEqual([12]);
  });
});
