import {
  SemanticVectorIndex,
  embedDocPrefix,
  embedQueryPrefix,
  planIncrementalEmbed,
  rrfFuse,
  wouldBeFloatDelta,
} from "./semanticIndex";

function vector(...values: number[]): Float32Array {
  return new Float32Array(values);
}

describe("SemanticVectorIndex", () => {
  test("normalizes vectors, rejects unusable values, and queries nearest", () => {
    const index = new SemanticVectorIndex({ dims: 2 });
    const result = index.addVectors([
      { chunkId: "a", vector: vector(3, 4), text: "alpha", contentHash: "ha" },
      { chunkId: "zero", vector: vector(0, 0) },
      { chunkId: "bad", vector: vector(Number.NaN, 1) },
    ]);

    expect(result).toEqual({ added: 1, skippedByCap: 0 });
    expect(index.chunkCount).toBe(1);
    const hits = index.query(vector(6, 8), 1);
    expect(hits[0]?.chunkId).toBe("a");
    expect(hits[0]?.score).toBeCloseTo(1, 5);
    expect(index.getChunkText("a")).toBe("alpha");
    expect(index.getContentHash("a")).toBe("ha");
  });

  test("applies the hard float cap while allowing replacements", () => {
    const index = new SemanticVectorIndex({ dims: 2 });
    const result = index.addVectors(
      [
        { chunkId: "a", vector: vector(1, 0) },
        { chunkId: "b", vector: vector(0, 1) },
        { chunkId: "c", vector: vector(1, 1) },
      ],
      { floatCap: 4 },
    );

    expect(result).toEqual({ added: 2, skippedByCap: 1 });
    expect(index.isCapped).toBe(true);
    expect(index.addVectors([{ chunkId: "a", vector: vector(0, 1) }], { floatCap: 4 })).toEqual({
      added: 1,
      skippedByCap: 0,
    });
  });

  test("round-trips JSON, metadata, and capped state", () => {
    const index = new SemanticVectorIndex({ dims: 2 });
    index.addVectors([
      { chunkId: "b", vector: vector(0, 2), text: "beta", contentHash: "hb" },
    ]);
    index.markCapped();

    const restored = SemanticVectorIndex.fromJSON(index.toJSON());
    expect(restored.dims).toBe(2);
    expect(restored.chunkCount).toBe(1);
    expect(restored.isCapped).toBe(true);
    expect(restored.getChunkText("b")).toBe("beta");
    expect(restored.getContentHash("b")).toBe("hb");
    expect(restored.query(vector(0, 1), 1)[0]?.score).toBeCloseTo(1, 5);
  });
});

describe("semantic retrieval helpers", () => {
  test("rrfFuse uses 0-based ranks and combines both arms", () => {
    const fused = rrfFuse(
      [
        { chunkId: "a", rank: 0 },
        { chunkId: "b", rank: 1 },
      ],
      [
        { chunkId: "b", rank: 0 },
        { chunkId: "c", rank: 1 },
      ],
      { k: 1 },
    );

    expect(fused.map((row) => row.chunkId)).toEqual(["b", "a", "c"]);
    expect(fused[0]?.score).toBeCloseTo(1 / 3 + 1 / 2, 8);
  });

  test("wouldBeFloatDelta counts only new valid chunks", () => {
    const index = new SemanticVectorIndex({ dims: 2 });
    index.addVectors([{ chunkId: "existing", vector: vector(1, 0) }]);

    expect(
      wouldBeFloatDelta(index, [
        { chunkId: "existing", vector: vector(0, 1) },
        { chunkId: "zero", vector: vector(0, 0) },
        { chunkId: "wrong", vector: vector(1, 0, 0) },
      ]),
    ).toBe(0);
    expect(wouldBeFloatDelta(index, [{ chunkId: "new", vector: vector(1, 1) }])).toBe(2);
  });

  test("planIncrementalEmbed dedupes hashes and skips existing content", () => {
    expect(
      planIncrementalEmbed(new Set(["old"]), [
        { chunkId: "a", contentHash: "old" },
        { chunkId: "b", contentHash: "new" },
        { chunkId: "c", contentHash: "new" },
      ]),
    ).toEqual(["new"]);
  });

  test("e5 prefixes are idempotent", () => {
    expect(embedQueryPrefix("hello")).toBe("query: hello");
    expect(embedQueryPrefix("query: hello")).toBe("query: hello");
    expect(embedDocPrefix("hello")).toBe("passage: hello");
    expect(embedDocPrefix("passage: hello")).toBe("passage: hello");
  });
});
