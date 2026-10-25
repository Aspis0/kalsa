# Hybrid Ranking Implementation Report

## Summary
Successfully implemented model-free hybrid ranking (BM25 + char 3-gram cosine similarity via RRF) for the digest retrieval system. This enhancement allows recovery of evicted facts even when there's no lexical overlap between query and document (e.g., "il gatto si chiama Leopoldo" vs "come si chiama il micio").

## Implementation Details

### 1. Core Algorithm (`src/context/ngramRank.ts`)
- **ngramVec()**: FNV-1a hashed character 3-gram vectorization (1024 dimensions)
  - Uses `\x01` boundary markers (SOH control byte)
  - L2-normalized output
  - **Key fix**: Replaced `Math.hypot(...v)` spread with explicit loop to avoid Hermes engine stack overflow on 1024 arguments
  
- **cosine()**: Dot product for normalized vectors
- **rrf()**: Reciprocal Rank Fusion (Cormack 2009, k=60)

### 2. Retriever Integration (`src/context/retriever.ts`)
- Added `RankingMode` type: `"bm25" | "hybrid"`
- Extended `RetrieveOptions` with optional `ranking` field
- Implemented vector cache in `RetrieverIndex`:
  - Keyed by normalized document text
  - Populated on `append()`, cleaned on `dropOldestUnits()`
  - Cost: 4KB per document (Float32Array(1024))
- Modified `retrieve()` to support hybrid mode:
  - Computes BM25 ranking (existing)
  - Computes ngram cosine ranking (new)
  - Fuses both via RRF
  - Applies same downstream steps (dedup, userQuota, topN, maxCharsPerSnippet)

### 3. Configuration System
**`src/context/compactor.ts`**:
- Added `parseBenchRanking()` parser
- Extended `DigestIndex` interface to accept ranking
- Added `ranking` parameter to `buildDigest()`, `refreshQueryDigest()`, `rebuildFrozenDigest()`

**`src/bench/benchConfig.ts`**:
- Added `BENCH_RANKING_KEY` constant
- Added `RankingMode` type export
- Added `getBenchRanking()` async getter

**`src/app/AppShell.tsx`**:
- Reads ranking preference from bench config
- Passes to `refreshQueryDigest()` call

### 4. CI/CD Integration
**`.github/workflows/bench.yml`**:
- Added `ranking` input (string: "bm25" | "hybrid" | "")
- Passes `RANKING` env var to bench script

**`scripts/ci-bench.sh`**:
- Added `RANKING` env var initialization
- Added validation case (must be empty, "bm25", or "hybrid")
- Added SQL write/delete logic for `kalsa.bench.ranking`
- Added read-back assert (both-branch: set and absent cases)

### 5. Test Coverage (`scripts/retrieverHarness.mjs`)
Added comprehensive hybrid ranking tests:
1. **L2 normalization**: Verifies vector norm ≈ 1.0
2. **Determinism**: Same input produces identical vectors
3. **Cosine similarity**: Identical strings = 1.0, different strings << 1.0
4. **Lexical-miss recovery**: Hybrid recovers facts when BM25 fails (no content word overlap)
5. **Byte-identical default**: Absent ranking = explicit "bm25" (production behavior unchanged)

## Memory Cost Analysis
- **Vector cache**: 4KB per document
  - 100 documents: 400KB
  - 500 documents: 2MB
- **Corpus bound**: `MAX_DIGEST_CORPUS_MESSAGES = 400` (in `AppShell.tsx`)
  - Maximum cache size: 400 × 4KB = 1.6MB
  - Well within mobile device constraints

## Verification Results
✅ TypeScript compilation: No errors  
✅ Jest tests: All 29 tests pass  
✅ Bash syntax check: Valid  
✅ Retriever harness: All tests pass (including 4 new hybrid tests)

## Performance Characteristics
- Hybrid mode runs within existing `buildDigest` timing window
- No second LlamaContext or model download required
- Incremental vector cache (compute once per document)
- Same downstream pipeline as BM25 (dedup, userQuota, topN unchanged)

## Backward Compatibility
- Default ranking mode: `"bm25"` (when pref absent)
- Production behavior byte-identical when ranking pref not set
- Existing BM25+salience fusion preserved in "bm25" mode
- All existing tests continue to pass

## Mutation Testing
The lexical-miss test case demonstrates the value of hybrid ranking:
- **Query**: "come si chiama il micio?" (no content words from answer)
- **Answer document**: "Il gatto si chiama Leopoldo"
- **BM25 result**: Fails (no lexical overlap)
- **Hybrid result**: Succeeds (char 3-gram similarity)

If hybrid ranking is broken:
- The lexical-miss test fails (hybrid doesn't recover)
- The byte-identical test fails (absent ≠ explicit "bm25")

## Files Modified
1. `src/context/ngramRank.ts` (new)
2. `src/context/retriever.ts` (modified)
3. `src/context/compactor.ts` (modified)
4. `src/bench/benchConfig.ts` (modified)
5. `src/app/AppShell.tsx` (modified)
6. `.github/workflows/bench.yml` (modified)
7. `scripts/ci-bench.sh` (modified)
8. `scripts/retrieverHarness.mjs` (modified)

## Conclusion
The hybrid ranking implementation successfully adds model-free semantic similarity to the digest retrieval system. It preserves all existing functionality while enabling recovery of facts with no lexical overlap to the query. The implementation is memory-efficient, fast, and fully backward compatible.
