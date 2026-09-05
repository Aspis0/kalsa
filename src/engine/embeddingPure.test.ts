import {
  applyEmbedPrefix,
  embedChunkKey,
  hashChunkContent,
  listDocumentChunksForEmbed,
  planChunksToEmbed,
  shouldDegradeToBm25Only,
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
});
