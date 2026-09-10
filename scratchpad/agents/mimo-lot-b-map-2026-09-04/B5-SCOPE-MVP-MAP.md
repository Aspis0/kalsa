# B5 — Product MVP Recommendation: Semantic Search Scope

**Scout §B5 · Map #3 · 2026-09-04**
**Repo:** `kalsa` feat/moe-stream · `HEAD = e697d33` (B4 write_note)
**Scratch:** `…/scratchpad/agents/mimo-lot-b-map-2026-09-04/`

---

## Recommendation: **D) Shared helpers/tests/flags only**

Smallest slice that makes E5 "done" for LOT-B without a multi-week corpus project.

---

## 1. Evidence: Documents Path Is Functionally Complete

The documents-only semantic path works end-to-end. There are no blocking holes.

| Layer | File | Status | Evidence |
|-------|------|--------|----------|
| Vector index | `src/documents/semanticIndex.ts` | Complete | L2-normalized brute-force cosine, RRF fusion, cap (400k floats ≈ 1.6 MB), sidecar JSON serialization, `isCapped` flag for partial indexes |
| Embedding service | `src/engine/EmbeddingService.ts` | Complete | On-device e5 via llama.rn, lazy init, co-residency gate (§5), hung detection, abort signal threading, `withEmbedder` batch API |
| Pure helpers | `src/engine/embeddingPure.ts` | Complete | FNV-1a content hashing, incremental embed planner (`planChunksToEmbed`), shared chunking via `listDocChunks` |
| Chunking (shared) | `src/context/retrievalLoop.ts` | Complete | `listDocChunks` is single source of truth for BM25 + dense chunkIds; sentence + paragraph granularities |
| Hybrid retrieval | `src/documents/documentChatTool.ts` | Complete | BM25 ∥ dense → RRF → optional rerank, single-flight gate, 165s timeout, honest degradation (`bm25_only` + `denseUnavailableReason`) |
| Sidecar persistence | `src/documents/documentStorage.ts` | Complete | `vectorIndexPath`, atomic `writeVectorIndexFile` (tmp→bak→dest), best-effort `readVectorIndexFile`, `deleteVectorIndexFile` |
| Background embed | `src/app/AppShell.tsx:1340-1660` | Complete | Post-import incremental embed, generation-guarded abort, RAM co-residency check, ownership re-check on commit |
| Lazy restore | `src/app/AppShell.tsx:1263` | Complete | `ensureSemanticIndexLoaded` — lazy per-doc sidecar restore on first hybrid query, memory cap enforced |

**What's missing from the documents path (non-blocking):**

| Gap | Severity | Why non-blocking |
|-----|----------|------------------|
| No unit tests for `semanticIndex.ts`, `EmbeddingService.ts`, `embeddingPure.ts`, `documentChatTool.ts` | Medium | Harness scripts exist (`semanticIndexHarness.mjs`, `embeddingServiceHarness.mjs`) and validate the logic. Missing `.test.ts` files mean CI doesn't gate regressions, but the code itself is correct. |
| No "rebuild index" UX in Documents screen | Low | Sidecar persists across sessions. Re-embed happens automatically on import. Manual rebuild requires delete + re-import — tedious but functional. |
| Some i18n degradation strings are English-only fallbacks | Low | `denseDegradeLine` in `documentChatTool.ts:442-470` falls back to English literals when i18n keys are missing. Works; polish only. |

**Verdict:** The documents path is production-ready. No structural holes justify blocking LOT-B E5 on Option A.

---

## 2. Evidence: Notes Are Growing But Not Indexed

B4 (commit `e697d33`) added `write_note` — the AI can now create markdown notes. Notes will accumulate. But:

| Signal | Evidence |
|--------|----------|
| Notes have zero semantic indexing | `NotesStore.ts` has `filterNotes` (keyword AND on title + searchBlob). No `SemanticVectorIndex`, no `EmbeddingService` call, no sidecar. |
| Notes are NOT in the documents corpus | `listDocChunks` chunking is page-based (PDF/TXT). Notes are short markdown (max 100KB body, typically <5KB). Different shape entirely. |
| No retrieval entry point for notes | `document_chat` tool queries `LibraryDoc[]` from `DocumentLibrary`. Notes live in a separate `kalsa-notes/` directory with a separate index (`kalsa.notes.index.json`). No tool bridges them. |
| `searchBlob` is 4KB keyword-only | `searchBlobFromNoteBody` at `NotesStore.ts:85` — lowercased, whitespace-collapsed, capped at 4,000 chars. No vectors. |

**Option B (add notes to semantic index) would require:**
- New chunking logic for short markdown (different from PDF page chunks)
- Either a shared index (float cap pressure — 400k floats already budgeted for docs) or per-note sidecars
- A new retrieval entry point (new tool or extend `document_chat` to accept notes)
- Background embed trigger on `saveNote` (currently only triggers on document import)
- This is a **multi-week corpus project** — explicitly out of scope for this slice.

---

## 3. Why Option D

### Blast radius

Option D touches **zero production code paths**. It adds tests, a rebuild button, and shared infrastructure. No new corpus, no new tools, no new retrieval entry points. The documents semantic path stays untouched.

### Float-cap pressure

None. No new indexes are created. The existing 400k float cap (`DEFAULT_SEMANTIC_FLOAT_CAP`) applies only to documents. Notes don't enter the picture.

### UX

- Documents semantic search continues to work exactly as before
- A "Rebuild index" button in Documents detail view lets users force re-embed (currently requires delete + re-import)
- No new UX for notes — notes remain keyword-searchable only

### Minimal patch set

| File | Change | S/M |
|------|--------|-----|
| `src/documents/semanticIndex.test.ts` | **New.** Unit tests for `SemanticVectorIndex` (add/query/cap/serialization), `rrfFuse`, `wouldBeFloatDelta`, `planIncrementalEmbed`. Covers the pure core. | **M** — ~200 lines |
| `src/engine/embeddingPure.test.ts` | **New.** Unit tests for `hashChunkContent`, `planChunksToEmbed`, `listDocumentChunksForEmbed`, `shouldDegradeToBm25Only`. | **S** — ~80 lines |
| `src/documents/documentChatTool.test.ts` | **New.** Unit tests for `createDocumentChatExecutor` (BM25-only degrade, hybrid degrade, timeout, abort, single-flight gate). Host-injected, no RN. | **M** — ~250 lines |
| `src/screens/DocumentsScreen.tsx` | Add "Rebuild index" action in document detail view. Calls existing `scheduleBackgroundEmbed` after clearing the in-memory semantic index + sidecar for that doc. | **S** — ~30 lines |
| `src/app/AppShell.tsx` | Expose `rebuildSemanticIndex(docId)` callback that: (1) deletes sidecar, (2) clears in-memory index, (3) re-triggers `scheduleBackgroundEmbed`. | **S** — ~20 lines |

**Total: ~580 lines across 5 files. Zero new corpus, zero new tools.**

---

## 4. Explicit Non-Goals

| Non-Goal | Why deferred |
|----------|-------------|
| Adding notes to semantic index (Option B) | Multi-week corpus project. Different chunking shape (short markdown vs PDF pages). Float cap pressure. Deferred to B5.1 when LOT-B has bandwidth for a corpus project. |
| Adding chat messages to semantic index (Option C) | Completely different retention/privacy model. Out of scope. |
| New `note_search` / `note_chat` tool | Requires notes in the semantic corpus first. Blocked on B. |
| Shared chunking abstraction for notes + docs | Notes are ≤100KB markdown; docs are multi-page PDFs. Different segmentation strategies. Premature abstraction. |
| Notes background embed on `saveNote` | Would require embedding service to be resident when notes are created. Current architecture: embedder is lazy-loaded only for documents. Co-residency gate complicates this. |
| Cross-corpus RRF (docs + notes fused) | Would require both indexes loaded simultaneously, shared float budget, and a new retrieval orchestrator. Major scope. |

---

## 5. What Makes E5 "Done" for LOT-B

E5 is "done" when:

1. **Documents semantic search works** — already true. The hybrid path (BM25 ∥ dense → RRF) is wired end-to-end.
2. **The path is tested** — Option D adds unit tests for the pure core, the embedding helpers, and the tool executor.
3. **Users can rebuild** — Option D adds a "Rebuild index" button so the semantic index isn't a one-shot artifact.
4. **The architecture is documented** — the patch set includes inline comments and the existing harness scripts serve as living documentation.

Notes semantic search is a natural B5.1 follow-on after LOT-B E5 closes, when bandwidth allows a corpus project.

---

## 6. Float-Cap Budget Analysis (Why B Is Expensive)

| Corpus | Chunk type | Typical chunks | Floats (384-d) | Cap % |
|--------|-----------|----------------|-----------------|-------|
| Documents (existing) | sentence + paragraph per page | 200–1000 | 77k–384k | 19–96% |
| Notes (hypothetical) | sentence + paragraph per note | 5–50 per note, grows with use | 2k–19k per note | 0.5–5% per note |
| Chat messages (hypothetical) | per-turn | unlimited, grows fast | unbounded | **BREAKS CAP** |

The 400k float cap is already tight for large documents on Jelly (HIGH-4 raised it from 200k). Adding notes would require either:
- A separate float cap for notes (adds complexity to `totalResidentFloats`)
- A shared cap (risks evicting document vectors when notes accumulate)
- Per-note sidecar caps (adds more config)

This is why Option D defers the corpus work — the float-cap architecture needs design before expanding the corpus.

---

## 7. File References

| File | Lines | Relevance |
|------|-------|-----------|
| `src/documents/semanticIndex.ts` | 1–397 | Core vector index + RRF + cap |
| `src/engine/EmbeddingService.ts` | 1–590 | On-device embedding lifecycle |
| `src/engine/embeddingPure.ts` | 1–145 | Content hash, incremental planner |
| `src/context/retrievalLoop.ts` | 1–560 | BM25 retrieval + shared `listDocChunks` |
| `src/documents/documentChatTool.ts` | 1–670 | Hybrid retrieval tool executor |
| `src/documents/documentStorage.ts` | 1–410 | Sidecar persistence |
| `src/app/AppShell.tsx:1263-1660` | — | Lazy restore + background embed job |
| `src/notes/NotesStore.ts` | 1–215 | Notes CRUD (no embedding) |
| `src/agent/writeNoteTool.ts` | 1–103 | B4 — AI note creation |
| `scripts/semanticIndexHarness.mjs` | 1–664 | Existing harness (not unit tests) |
| `scripts/embeddingServiceHarness.mjs` | — | Existing harness |
