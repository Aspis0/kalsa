# B5 — SemanticVectorIndex + Document Hybrid Retrieval Map

> **Scope:** `feat/moe-stream` branch. File:line references for the production source tree.
> **Date:** 2026-09-04. Recon only — no edits.

---

## 1. SemanticVectorIndex API

**File:** `src/documents/semanticIndex.ts`

### Construction & Invariants

| Aspect | Detail | Ref |
|--------|--------|-----|
| Constructor | `new SemanticVectorIndex({ dims })` — `dims` must be positive integer; throws otherwise | `semanticIndex.ts:60-62` |
| Internal store | `Map<string, StoredVector>` where `StoredVector = { vector: Float32Array; text?: string; contentHash?: string }` | `semanticIndex.ts:55-59` |
| Cosine model | Brute-force dot product over **L2-normalized** unit vectors | `semanticIndex.ts:11` |

### `addVectors(items, capOpts?)` → `{ added, skippedByCap }`

- **L2 normalization on add:** every vector is defensively re-normalized (line 224). Callers may pass raw or already-normalized.
- **Zero / non-finite rejection:** `isZeroOrNonFinite(v)` rejects any vector containing non-finite values or all zeros (line 57-66, 221-222). These are skipped, never stored.
- **Dedupe by chunkId:** last write wins (line 231). Replacement costs 0 net floats for cap accounting.
- **Cap policy (`FIX D / FIX 4`):**
  - `capOpts` absent → unbounded (caller enforces).
  - `capOpts` present → each **new** (non-replacement) vector refused when `otherResidentFloats + this.floatCount + this.dims > floatCap`.
  - Invalid `floatCap` (non-number, negative, NaN, 0) → fails closed to `DEFAULT_SEMANTIC_FLOAT_CAP = 400_000` (~1041 chunks at 384-d) (lines 130-140).
  - On cap: `_capped = true`, `skippedByCap` incremented, loop continues.
- **Optional `text` / `contentHash`:** stored when present, carried through replacements from prior row (lines 227-229).

### `query(queryVector, topN)` → `{ chunkId, score }[]`

- **Defensive L2 re-normalization** of query (line 267).
- Zero-norm query → `[]` (no dense hits; must not flood RRF with score-0 rows) (line 265).
- Empty index, `topN <= 0`, or bad query type → `[]`.
- Score = dot product of unit vectors = cosine similarity (line 272).
- Deterministic sort: score desc, then chunkId asc for tiebreak (line 275).

### Cap & Eviction Helpers

| Function | Ref | Purpose |
|----------|-----|---------|
| `totalResidentFloats(indexes)` | `:81-88` | Sum `chunkCount × dims` across multiple indexes |
| `semanticIndexCountExceeds(indexes, cap?)` | `:93-101` | True when total ≥ cap |
| `wouldBeFloatDelta(index, newItems)` | `:106-127` | Net float delta accounting for replacements |
| `DEFAULT_SEMANTIC_FLOAT_CAP = 400_000` | `:75` | ~1.6 MB fp32 resident cap |
| `isCapped` / `markCapped()` | `:173-178` | Indicates index is partial due to memory cap |

**Eviction note:** There is no LRU or least-recently-used eviction. The cap is a **hard stop on add** — once reached, further chunks for this doc are refused. The `capped` flag is persisted into `vec.json` so a partial index restores as partial.

### Text & ContentHash Accessors

| Method | Ref | Notes |
|--------|-----|-------|
| `setChunkText(chunkId, text)` | `:239-251` | Text without a vector is ignored (not queryable) |
| `getChunkText(chunkId)` | `:254-258` | For dense-only hit recovery in RRF |
| `getContentHash(chunkId)` | `:261-265` | For incremental re-embed planning |
| `contentHashKeys()` | `:268-275` | Returns `Set<"chunkId\0hash">` composite keys |

### Serialization

| Method | Ref |
|--------|-----|
| `toJSON()` → `SemanticVectorJSON` | `:287-305` |
| `SemanticVectorIndex.fromJSON(data)` | `:307-340` |

- `SemanticVectorJSON` shape: `{ dims, vectors: [{chunkId, vector: number[], text?, contentHash?}], capped?: boolean }` (line 42-53).
- `capped` is serialized **only when true** so older sidecars without the field stay uncapped.
- `fromJSON` restores vectors via `addVectors` (defensive L2 re-norm, zero rejection), then restores `capped` flag directly.

### e5 Prefix Helpers

| Function | Ref | Behavior |
|----------|-----|----------|
| `embedQueryPrefix(text)` | `:357-363` | Idempotent `"query: "` prefix |
| `embedDocPrefix(text)` | `:366-372` | Idempotent `"passage: "` prefix |

### RRF (Reciprocal Rank Fusion)

| Item | Detail | Ref |
|------|--------|-----|
| `rrfFuse(sparse, dense, opts?)` | Two-arm RRF with 0-based rank inputs | `:382-426` |
| Default `k = 60` | Cormack et al. 2009 | `:393` |
| Weights | `sparseWeight` (default 1), `denseWeight` (default 1) | `:388-390` |
| Formula | `score(d) = w_s/(k + rank_0based + 1) + w_d/(k + rank_0based + 1)` | `:413` |
| Missing arm | Contributes 0 (no error) | `:412-414` |

### Incremental Embed Planner

`planIncrementalEmbed(existing, chunks)` at `:436-453` — hash-only pure helper. Production planner is `planChunksToEmbed` in `embeddingPure.ts:108-127` which dedupes by `(chunkId, contentHash)` composite key.

---

## 2. `vec.json` Sidecar Read/Write Format

**File:** `src/documents/documentStorage.ts:253-368`

### Path

`vectorIndexPath(docId)` → `${documentDirectory}kalsa-documents/${safeDocId}.vec.json` (line 261-271). `docId` is sanitized to `[A-Za-z0-9._-]` only.

### Write: `writeVectorIndexFile(docId, json)` → `Promise<void>`

**Atomicity pattern** (line 284-332):
1. Write to `${path}.tmp`
2. Move existing `.vec.json` → `.bak` (backup)
3. Move `.tmp` → `.vec.json`
4. Delete `.bak`
5. On move failure: restore `.bak` → `.vec.json` (previous good file preserved)

- **Never throws** — best-effort; clean up `.tmp` on any failure.
- Callers: `AppShell.tsx:1717` (after each chunk embed), `:1803` (cap stop), `:2000+` (post-job final write).

### Read: `readVectorIndexFile(docId)` → `Promise<unknown | null>`

- Returns `null` on missing, corrupt, non-existent, or I/O error (line 335-348).
- Returns raw parsed JSON (caller casts to `SemanticVectorJSON`).

### Delete: `deleteVectorIndexFile(docId)` → `Promise<void>`

- Delegates to `deleteOwnedFile` with ownership check (line 351-357).

### JSON Shape on Disk

```json
{
  "dims": 384,
  "vectors": [
    {
      "chunkId": "docId#sentence#0",
      "vector": [0.123, -0.456, ...],   // fp32 as number[], L2-normalized
      "text": "optional passage text for dense-only hit recovery",
      "contentHash": "abcdef1234567890"   // FNV-1a 64-bit hex
    }
  ],
  "capped": true   // only present when index is partial
}
```

---

## 3. `document_chat` Hybrid Retrieval Path

**File:** `src/documents/documentChatTool.ts`

### Entry Point

`createDocumentChatExecutor(host, opts)` at `:305-377` returns an async executor. The strategy decision chain:

1. `runStrategy()` (`:386`) — loads text, picks `full_context` vs `retrieve`.
2. `runRetrieve()` (`:579-657`) — BM25 loop, then hybrid attempt.

### `runRetrieve()` — the hybrid decision hub

```
:595-603 — BM25 loop: runRetrievalLoop(index, query, { budgetChars })
:612-620 — hybridHostWired check: true when ANY of getSemanticIndexFor / isEmbedderDownloaded / embedQuery exists
:622     — call tryHybridRetrieve(host, doc, query, bm25Passages, signal)
:623-634 — if hybrid.strategy === "hybrid" → use fused passages
:635-643 — if hybridHostWired but not hybrid → strategy = "bm25_only", reason from hybrid.denseUnavailableReason
```

**Key design:** The `strategy` field in the tool result:
- `"retrieve"` — no hybrid host hooks wired at all (pure BM25, historical)
- `"bm25_only"` — hybrid was considered but degraded (no embedder / no vectors / embed error / cap)
- `"hybrid"` — dense + RRF succeeded (may be partial-capped)

### `tryHybridRetrieve()` — dense arm + RRF fuse

**File:** `documentChatTool.ts:680-840`

#### When the dense arm is SKIPPED (returns `bm25_only`):

| Condition | Reason | Ref |
|-----------|--------|-----|
| `signal.aborted` before start | `"no_embedder"` | `:682-687` |
| `!host.isEmbedderDownloaded()` | `"no_embedder"` | `:691-695` |
| No in-memory + no sidecar restore | `"no_embedder"` / `"cap"` / `"corrupt"` / `"hung"` | `:707-722` |
| `vectorChunkCount <= 0` | same as above | `:724-735` |
| `hostReason === "cap"` or `"corrupt"` or `"hung"` with vectors present | inherited reason | `:737-743` |
| `typeof host.embedQuery !== "function"` | `"no_embedder"` | `:745-749` |
| `embedQuery()` returns null | `"no_embedder"` | `:753-757` |
| `denseHits.length === 0` | `"no_embedder"` | `:759-763` |
| `fusedPassages.length === 0` after RRF | `"no_embedder"` | `:831-836` |
| Any exception | `"no_embedder"` (catch-all) | `:838-842` |

#### Successful hybrid path:

```
:691-695 — embedderDownloaded gate
:697-703 — try in-memory index, fallback to loadSemanticIndexFor (lazy sidecar restore, FIX D)
:751-755 — embedQuery(query, signal) with signal threading (FIX 6)
:758-762 — semantic.query(queryVec, HYBRID_DENSE_TOP_N=25)
:765-769 — sparseRanks from bm25Passages (0-based position)
:770-771 — denseRanks from denseHits (0-based position)
:773     — rrfFuse(sparseRanks, denseRanks, { k: 60 })
:778-825 — map fused chunkIds back to passages; prefer BM25 passages when present;
             for dense-only winners, recover text from semantic.getChunkText()
:826-829 — truncate to HYBRID_FINAL_TOP_K = 8
:830     — partialCapped → denseUnavailableReason = "capped" (FIX 3)
```

### Constants

| Constant | Value | Ref |
|----------|-------|-----|
| `HYBRID_DENSE_TOP_N` | 25 | `:182` |
| `HYBRID_FINAL_TOP_K` | 8 | `:184` |
| `HYBRID_RRF_K` | 60 | `:186` |
| `HYBRID_RERANK_ENABLED` | `false` (v1 — no reranking) | `:192` |

---

## 4. Who Builds / Rebuilds the Index

### Build: `scheduleBackgroundEmbed(entry)` — AppShell

**File:** `src/app/AppShell.tsx:1362-1845`

#### Trigger

**Import only.** `addDocument()` at `AppShell.tsx:1170-1198` calls:
```typescript
void scheduleBackgroundEmbed(entry);  // line 1197
```

**There is NO rebuild on document open, first query, or app start.** The index is:
- Built on import (background, after PDF/TXT text extraction).
- Lazily loaded from `vec.json` sidecar on first hybrid query (`loadSemanticIndexFor` → `ensureSemanticIndexLoaded`).

#### Single-flight guard

`embedJobInFlightRef` (line 967) — set synchronously before first `await`; a second concurrent import silently skips (line 1366-1371).

#### Build lifecycle

```
:1397-1436 — extract text (PDF or TXT) via host functions
:1439-1446 — listDocumentChunksForEmbed(pages) → EmbeddableChunk[] (shared with BM25 via listDocChunks)
:1448-1452 — planChunksToEmbed(existingHashes, chunks) → toEmbed[]
:1466-1470 — working index = existing map entry OR fresh SemanticVectorIndex({ dims: EMBEDDING_MODEL.dims })
:1475-1820 — per-chunk loop:
    :1614     — embedDocumentChunk(chunk.text, { signal }) via EmbeddingService
    :1696-1706 — index.addVectors([{chunkId, vector, text, contentHash}], { floatCap, otherResidentFloats })
    :1707-1717 — on cap: write sidecar, log, exit partial
    :1758-1763 — ownership check at commit (libHas && mapHas)
    :1775-1783 — set docSemanticByIdRef + writeVectorIndexFile
:1820+   — loop done; terminalReason logged
```

#### Lazy restore from sidecar

`ensureSemanticIndexLoaded(docId)` at `AppShell.tsx:1264-1358`:

```
:1271-1275 — return live index if already loaded
:1282-1287 — readVectorIndexFile(docId) from disk
:1291-1297 — SemanticVectorIndex.fromJSON(raw)
:1310-1318 — memory policy: refuse if loadedFloats + incoming > VECTOR_MEMORY_FLOAT_CAP
:1320-1330 — store in docSemanticByIdRef, record capped reason
```

This is called by `tryHybridRetrieve` at `documentChatTool.ts:698-700`:
```typescript
if ((!semantic || semantic.chunkCount <= 0) && typeof host.loadSemanticIndexFor === "function") {
  semantic = await host.loadSemanticIndexFor(doc.id);
}
```

#### Incremental re-embed (content-hash dedup)

The embed job uses `planChunksToEmbed` (from `embeddingPure.ts`) which checks `(chunkId, contentHash)` against the existing set. Only new/changed chunks are embedded. The existing hash set is seeded from `docEmbedHashesByIdRef` + `liveIdx.contentHashKeys()`.

---

## 5. Tests for SemanticIndex / Hybrid

### SemanticVectorIndex

**Zero test files.** No `semanticIndex.test.ts`, no `*.test.ts` importing `SemanticVectorIndex`, `rrfFuse`, `SemanticVectorAddItem`, or any exported symbol from `semanticIndex.ts`. Confirmed via `grep -rn` across all `*.test.ts` in `src/`.

### Hybrid path (document_chatTool)

**Zero test files.** No `documentChatTool.test.ts`. No test imports `tryHybridRetrieve`, `createDocumentChatExecutor`, `rrfFuse` (the document-level one), `packPassagesToBudget`, or any hybrid path symbol from `documentChatTool.ts`.

### What IS tested

| Module | Test file | Covers |
|--------|-----------|--------|
| BM25 retrieval loop | None in `src/` | — |
| Retriever (ngramRank) | None | `retriever.ts` has its own `rrf()` but it's untested |
| EmbeddingService | None | No `EmbeddingService.test.ts` |
| embeddingPure | None | No test file |

**Summary:** The entire dense + hybrid path has **zero unit test coverage**. The only tested retrieval-adjacent modules are unrelated (windowProfile, compactor, etc.).

---

## 6. Bugs / Incomplete Wiring Blocking Reliable Semantic Search

### BUG 1: `rrfFuse` rank convention mismatch (CRITICAL)

**`semanticIndex.ts:382`** `rrfFuse` expects **0-based** ranks and converts to 1-based internally:
```typescript
// 0-based → 1-based in the denominator: k + rank + 1
const contrib = weight / (k + r + 1);
```

**`retrievalLoop.ts:391-392`** `rrfKey` for inter-round RRF uses **1-based** `rankInRound`:
```typescript
function rrfKey(p: RetrievedPassage): number {
  return 1 / (RRF_K + p.rankInRound);  // rankInRound is 1-based
}
```

**`documentChatTool.ts:765-768`** passes 0-based ranks to `rrfFuse` (correct for its API):
```typescript
const sparseRanks = bm25Passages.map((p, i) => ({ chunkId: p.chunkId, rank: i }));
const denseRanks = denseHits.map((h, i) => ({ chunkId: h.chunkId, rank: i }));
```

**`retriever.ts:43`** `RRF_K = 60` is also used for the BM25+ngram local retriever `rrf()` at `ngramRank.ts:62`. This is a **different** `rrf()` function with a different calling convention (`string[][]` of IDs, not `{chunkId, rank}[]`). No confusion bug here, but the naming overlap is a maintenance hazard.

**Verdict:** The `documentChatTool.ts:765-768` → `rrfFuse` call is **correct** (0-based ranks). No mismatch bug in the current code. But the comment at `semanticIndex.ts:18-20` explicitly calls this out as a locked convention — any future caller passing 1-based ranks would get double-shifted scores.

### BUG 2: Dense-only hit recovery misses page number

**`documentChatTool.ts:805-824`** — when a dense-only winner is recovered from `semantic.getChunkText()`:
```typescript
fusedPassages.push({
  docId: denseDocId || doc.id,
  chunkId: row.chunkId,
  granularity,
  text: denseText,
  score: row.score,
  round: 0,
  rankInRound: fusedPassages.length + 1,
  // ⚠️ page: number — NEVER SET
});
```

`RetrievedPassage.page` is always `undefined` for dense-only hits. BM25 passages get page info from `DocRetrieverIndex` (which doesn't store page either — it only stores `docId`). So **no passage ever has page info** through the retrieval loop. `formatPassageCitation(p.docId)` at `:817` uses `docId` (not page) for citation. This is a design gap, not a blocking bug.

### BUG 3: `ensureSemanticIndexLoaded` READ gate re-entrancy

**`AppShell.tsx:1278-1280`**:
```typescript
const readAlreadyHeld = isReadActive();
if (!readAlreadyHeld && !tryAcquireRead()) return null;
```

This handles re-entrancy (document_chat already holds READ). But the `tryAcquireRead()` path means that if the **first hybrid query** for a doc triggers `loadSemanticIndexFor`, the READ gate is briefly released between `tryAcquireRead()` failure and the `document_chat` wrapper's `strategyPromise.finally`. During that window, a **delete** could slip in. The code re-checks library membership at line 1283 after the async `readVectorIndexFile`, which mitigates this.

**Verdict:** Low risk; the ownership check after await covers the race.

### BUG 4: No embed job on document re-open or index staleness

The embed job (`scheduleBackgroundEmbed`) fires **only on import** (`addDocument`). If a document is imported with an old index, then the user edits the source file externally and re-imports, the embed job runs again. But if:
- The `vec.json` sidecar exists but is **stale** (chunks changed), the embed job calls `planChunksToEmbed` which dedupes by content hash — **new chunks get embedded, old vectors remain** (no eviction of stale vectors).
- Old vectors for chunks that no longer exist in the document are **never removed** from the in-memory index or the sidecar. They remain in `docSemanticByIdRef` and will appear in `semantic.query()` results as ghost hits.

**This is a real gap:** a document re-import does not clean up vectors for removed/rephrased chunks. The index monotonically grows until a fresh import (which does create a fresh `SemanticVectorIndex` at `AppShell.tsx:1466-1470`).

### BUG 5: Float cap does not account for existing stale vectors

**`AppShell.tsx:1696-1706`** — `otherFloats` is computed from the current map:
```typescript
let otherFloats = 0;
for (const [id, other] of docSemanticByIdRef.current) {
  if (id === entry.id) continue;
  otherFloats += other.chunkCount * other.dims;
}
const addResult = index.addVectors([...], {
  floatCap: VECTOR_MEMORY_FLOAT_CAP,
  otherResidentFloats: otherFloats,
});
```

When `index` is a **fresh** cold-import index (not yet in the map), the cap is computed against other docs' floats + this fresh index's current floatCount. This is correct for the fresh case. But when `index` already has vectors from a prior partial embed, the `index.floatCount` includes those — replacements are 0-net. So the cap correctly stops when the combined budget is exhausted. **No bug here on closer inspection.**

### BUG 6: `listDocChunks` semantic drift between BM25 and dense

Both `DocRetrieverIndex.append()` (`retrievalLoop.ts:561-562`) and `listDocumentChunksForEmbed()` (`embeddingPure.ts:81-82`) call `listDocChunks(page.text, docId)` — the **same** function. So chunkIds are identical. **No drift bug.**

However: `DocRetrieverIndex` indexes sentence **and** paragraph granularities, while the dense embed job embeds **all** chunks from `listDocChunks` (both sentence and paragraph). So the dense index contains vectors for both granularities. But `listDocChunks` is called with the **full page text**, and the chunkId convention is `${docId}#sentence#${ordinal}` / `${docId}#paragraph#${ordinal}`. The dense query uses `semantic.query()` which returns all chunkIds. The RRF merge at `documentChatTool.ts:778-825` maps chunkIds back to `bm25Passages` first, then falls back to dense-only recovery. **This is sound.**

### BUG 7: `embedQuery` in `tryHybridRetrieve` does not use e5 prefix path for the query

**`documentChatTool.ts:751-755`**:
```typescript
const queryVec = await host.embedQuery(query, signal);
```

The `host.embedQuery` is wired to `EmbeddingService.embedQuery` (via AppShell), which internally calls `applyEmbedPrefix(text, "query")` → `embedQueryPrefix(text)` → `"query: " + text`. The dense index was built with `embedDocumentChunk(text)` → `applyEmbedPrefix(text, "doc")` → `"passage: " + text`.

**This is correct:** e5 models expect different prefixes for query vs passage. Both are applied via the `EmbeddingService` → `embeddingPure` → `semanticIndex` helpers.

### BUG 8: `ensureSemanticIndexLoaded` does not re-embed — only loads sidecar

If the sidecar is missing (cold import never completed, or was deleted), `ensureSemanticIndexLoaded` returns `null` (line 1285-1286). **There is no on-demand re-embed path for a first query.** The user must re-import to trigger `scheduleBackgroundEmbed`.

This means: if the embed job failed mid-way (network issue, app kill, OOM) and the sidecar was never written (or was partial), the first `document_chat` query gets `bm25_only` forever until the user re-imports.

### BUG 9: `tryHybridRetrieve` fallthrough to `"no_embedder"` is too aggressive

**`documentChatTool.ts:735-743`** — when `hostReason` is not one of the known values but the index has vectors:
```typescript
if (hostReason === "cap" || hostReason === "corrupt" || hostReason === "hung") {
  return { strategy: "bm25_only", ... };
}
```

If `hostReason` is `"capped"` (partial index with vectors present), the code correctly falls through to the hybrid path. But if `hostReason` is `"no_embedder"` with vectors present (e.g., embedder was downloaded but `isEmbedderDownloaded()` now returns false due to a transient error), the code proceeds to embed — which will fail and return `bm25_only`. **This is graceful degradation, not a bug**, but the error message ("no_embedder") is misleading when vectors exist.

### INCOMPLETE: `HYBRID_RERANK_ENABLED = false`

**`documentChatTool.ts:192`** — pointwise rerank is stubbed but OFF:
```typescript
export const HYBRID_RERANK_ENABLED = false;
```

`maybeRerankPassages()` at `:197-206` is a pass-through. The rerank prompt is defined at `:193-196` but never called. This is by design for v1 (2B model latency), but means the hybrid path does not benefit from a cross-encoder or LLM reranker — the RRF fusion score is the final ranking.

### INCOMPLETE: No tests

As documented in §5, the entire dense/hybrid pipeline has **zero** test coverage. The `SemanticVectorIndex` class, `rrfFuse`, `tryHybridRetrieve`, `packPassagesToBudget`, and the full `documentChatExecutor` strategy chain are all untested.

---

## Summary Table

| Area | Status | Key Risk |
|------|--------|----------|
| `SemanticVectorIndex` API | Complete, well-guarded | No eviction = monotonic growth |
| `vec.json` sidecar I/O | Atomic write, best-effort read | No sidecar = no dense (by design) |
| `tryHybridRetrieve` | Complete, graceful degradation | Too many paths map to `"no_embedder"` |
| Embed trigger | Import-only, background, single-flight | No rebuild on reopen / stale sidecar |
| Tests | **None** | Zero coverage for entire hybrid path |
| Ghost vectors | Stale chunks never evicted | Index grows monotonically per doc |
| Cold-start recovery | No on-demand re-embed | Failed embed = permanent `bm25_only` |
