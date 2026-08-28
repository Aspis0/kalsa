# Hybrid Retrieval on-device — SemanticIndexService (BM25+ ∥ dense, RRF)

Date: 2026-08-10 · Branch: perf/fluidity-and-deviceprofile · Status: DESIGN (research-grounded)

## 1. Why

Document chat today is BM25-only (multi-round, RRF_K=60 — `src/context/retrievalLoop.ts`). BM25 is strong on exact terms, weak on paraphrase/synonyms ("quando hanno comprato la casa?" vs "acquisto dell'immobile"). SOTA hybrid RAG adds a small dense bi-encoder and fuses with Reciprocal Rank Fusion. User constraint: **maximum multilingual** (≥50–100 languages, Italian mandatory) and **tiny embedder** (tens of millions of params, not billions) — this unlocks a reusable semantic layer beyond document chat (chat-memory retrieval, compaction, conversation search).

## 2. Research grounding (SOTA)

- **RRF** (Cormack et al. 2009, DOI 10.1145/1571941.1572114): `score(d)=Σ 1/(k+rank(d))`, **k=60** — never mix raw BM25 and cosine scales.
- **Hybrid pattern**: dual first-stage (sparse ∥ dense) → RRF → optional pointwise rerank top-8–12 → budget pack (Weaviate/Qdrant hybrid docs; digitalapplied.com 2026 ref).
- **On-device**: HNSW unnecessary below ~5k chunks (brute-force cosine); SPLADE (~0.5GB), ColBERT/ColPali (multi-vector), HyDE (pre-retrieval generation), Listwise RankGPT all **avoid on phone**.
- **Embeddings on llama.rn 0.12.8 — NO PATCH NEEDED**: `initLlama({ embedding: true })` + `ctx.embedding(text, { embd_normalize: 2 })` already exist (src/index.ts:891, JSI RNLlamaJSI.cpp:925, JSIParams.cpp:399). Never set `embedding:true` on the chat model.

## 3. Embedder choice (user constraint: max multilingual)

Verified August 2026: **no meaningful multilingual embedder exists below ~118M params.** Sub-100M options (all-MiniLM 23M, bge-small-en 33M) are English-only. 2026 newcomers are larger: EmbeddingGemma (308M, on-device-optimized, multilingual), jina-embeddings-v5-nano (239M, Feb 2026). Decision per user rule: keep the floor → **multilingual-e5-small as an OPTIONAL Settings download** (BM25-only when absent, honest label). The SemanticIndexService is model-agnostic (pooling/prefix parameterized) so EmbeddingGemma-308M is a drop-in upgrade later.

| Candidate | Params | Dim | Langs | Q8_0 size | Verdict |
|---|---|---|---|---|---|
| **multilingual-e5-small** | ~118M | 384 | **100+ incl. IT** | ~120 MB | **SHIP** (primary, optional download) |
| EmbeddingGemma (2026) | 308M | ~768 | 100+ (on-device optimized) | ~250-300 MB | future upgrade path |
| jina-embeddings-v5-nano (2026) | 239M | — | multilingual | ~200 MB | alternative upgrade |
| bge-small-en-v1.5 | 33M | 384 | EN only | 37 MB | not acceptable (multilingual req) |
| Qwen3-Embedding-0.6B | 600M | ≤1024 | 100+ | 639 MB | too heavy vs 2B chat |

- Quant: **Q8_0 for embedding weights** (Q4 acceptable for bge-small only; MSE Q8 ≈ 5.8e-6).
- e5 protocol: **prefixes** `query: ` / `passage: `; pooling = **mean** (GGUF must handle; verify with the model card). Cross-lingual en↔it works; Italian lexical coverage stays with BM25.
- Index vectors stored **fp32** flat (2000 × 384 ≈ 3 MB); int8 vector quant later if needed.

## 4. Architecture

```
query
  ├─ sparse: BM25+ multi-round (existing, residual queries)      → top 20–50
  └─ dense:  multilingual-e5-small Q8_0, query prefix            → top 20–50
        ↓
  RRF fuse, k=60 (equal weights, ranks only)
        ↓
  optional: pointwise chat-model rerank top 8–12
    gate: fused top-1 BM25 vs dense disagree, OR query is long/semantic
        ↓
  budget pack + page citations (existing path)
```

- **Prefetch per arm ≥ final k** so RRF has candidates.
- **Rerank**: one short prompt per passage ("Does passage answer the query? answer yes/no") — never a second cross-encoder model; chat model only, cap ≤12, off by default for 2B if latency hurts.
- **Degradation**: embedder not downloaded / index warmup incomplete → **BM25-only** (today's behavior), label honestly in the tool body.

## 5. Embedding service lifecycle (on-device discipline)

- **Second LlamaContext** (`initLlama({ model: embPath, embedding: true, n_ctx: 512, n_gpu_layers: 0, n_threads: 2 })`) — separate from chat; **release() before loading chat** on ≤6 GB RAM (co-resident only on 8 GB+ when chat is 2B).
- **Incremental embedding mandatory**: content-hash each chunk; embed only new/changed; persist vectors (flat file `{chunkId, vec[]}` next to the doc, in the durable kalsa-documents/ storage).
- Bulk index = **background work with progress** (cold 2000-chunk reindex on G99 ≈ 10–25 min — never on the JS thread during chat; single-flight via the existing docOpGate read latch).
- Latency ballparks (CPU-only): query embed <0.5–2 s G99; chunk embed ~1–3 s / 128-tok chunk G99 (SD 8 Gen 2 ~4× faster). Measure real G99 tok/s with `llama-bench -embd 1` before UX promises.

## 6. Files / modules

```
New:
- src/documents/semanticIndex.ts      — PURE core (node-testable):
    SemanticVectorIndex (addDoc/chunks, brute-force cosine query, persist/load fp32 flat)
    embedQueryPrefix(text) / embedDocPrefix(text)   (e5 protocol, model-parameterized)
    rrfFuse(sparseRanks, denseRanks, {k=60, weights}) → ranked chunk ids
    planIncrementalEmbed(existingHashes, chunks) → [newHashes]  (pure planner)
    HybridRetrievalResult { passages, strategy: "hybrid"|"bm25_only", trace }
- src/engine/EmbeddingService.ts      — llama.rn embedding ctx lifecycle (init/release/embed),
                                       model path from registry, incremental index orchestration,
                                       release-before-chat guard hook
- scripts/harnesses/semanticIndexHarness.mjs    — pure cases (see §7)
Edit:
- src/engine/ModelRegistry.ts         — new model entry: embedding model (id, name, hfRepo,
                                       file, sizeBytes, dims, langs, pooling, prefixes) + flag
                                       isEmbedding; Settings optional-download row (disabled model
                                       gating: NOT subject to the RAM gate — tiny; separate
                                       "optional" badge)
- src/documents/documentChatTool.ts   — hybrid path: BM25+ ∥ dense → RRF → optional rerank →
                                       budget pack; result.kind stays "document_chat" (provenance
                                       post-truncation already handled in LlamaService)
- src/app/AppShell.tsx                — EmbeddingService lifecycle (load/release with the engine
                                       lock; progress surfaced via the existing busy/label UX),
                                       wiring into documentExec
- src/screens/SettingsScreen.tsx      — optional embedding-model download row + status
- src/i18n/en.ts + it.ts              — embedding.* keys
Reuse as-is: DocRetrieverIndex (BM25), docOpGate, chunking, citations, provenance framing.
```

## 7. Verification

- `npm run typecheck` exit 0; new `semanticIndexHarness` green; all existing harnesses green.
- Harness cases (≥16): rrfFuse with equal/disjoint ranks, k sensitivity, weight asymmetry; SemanticVectorIndex add/query cosine correctness (known vectors), persist/load round-trip, empty-index; planIncrementalEmbed (new/changed/unchanged, hash collision); prefix functions; strategy fallback (no vectors → bm25_only).
- Hostile review of the diff before commit (per tranche discipline).
- Boundary: do NOT touch .github/workflows, scripts/ci/ci-bench.sh, out/bench/, docs/MANDATE_F4_BENCHMARK.md, src/engine/deviceTuning.ts, src/engine/LlamaService.ts (engine knobs closed), the harness-owner's bench files.

## 8. Reuse surface (the "much more" the user asked about)

The SemanticVectorIndex is app-level state, not document-bound: same class serves
- chat-memory semantic retrieval (fix the measured 33% recall gap — RESEARCH_CONTEXT_LOSS.md),
- compaction digest selection,
- "search my chats",
- RAG over web-fetched content.
Document chat is the first consumer; the module has no document-specific coupling beyond chunk provenance.

## 9. Out of scope (v1)

- SPLADE/ColBERT/HyDE/Listwise rerank (research says avoid on phone).
- int8 vector quantization (fp32 3MB fine).
- Cross-encoder reranker model (chat model only, gated).
- Real-device latency campaign (needs `llama-bench -embd 1` on G99 — follow-up before shipping UX promises).
