# Tranche 1 utility — Document Chat (chat with local PDF/TXT)

Date: 2026-08-10 · Branch: perf/fluidity-and-deviceprofile (design) · Status: DESIGN

## 1. Choice (why this utility)

From docs/COMPETITOR_ANALYSIS.md §7-8. Competitor landscape for document chat:
- **Offline Private AI** — has a Documents tab (import PDF/TXT → ask). Closed source, mechanism likely dumb context stuffing (no verified RAG). iOS-only, ad-tracked.
- **Private AI: Document Chat** (GTechnologies) — explicit chunk → vector embeddings → RAG, but Apple-Intelligence-gated (hardware restricted).
- **PocketPal / MLC Chat / Layla** — no document chat (PocketPal has PDF-as-image vision; MLC image only; Layla unclear).

Kalsa already owns the hard technology, unused as a product:
- `src/pdf/pdfTextService.ts` + `PdfToImages.tsx` + `src/util/pdfText.ts` — PDF text-layer extraction (per-page docs, `docId = sourceId#pN`, skippedPages for scanned pages).
- `src/context/retrievalLoop.ts` — `DocRetrieverIndex` (append-only, sentence+paragraph granularity) + `runRetrievalLoop` (multi-round BM25+, RRF fusion, residual queries, coverage triggers, Jaccard dedup, privacy gate MIN_SHARED_GRAMS=3).
- `src/agent/webFetchTool.ts` — already wires `requestPdfText` → `DocRetrieverIndex` for remote-PDF retrieval (the pattern exists end-to-end).

So the utility is **product glue + chat UX**, not new retrieval science — and it lands us ahead of OPA on paper (BM25+ multi-round + citations vs context stuffing) with the same "local/private" positioning and no ad SDK.

## 2. UX (user-visible)

- New **Documents** entry in Settings/Help area (not a new root tab — Android-first, keep the screen count low): pick a PDF or TXT from the device, add to a small **library** (persisted list: title, date, page count, size).
- In chat: mention documents via the existing attachment flow — a document attachment becomes a **retrieval source**: the user asks a question, the tool loop retrieves top passages (multi-round BM25+) and injects them with **page citations** (`docId#pN`), plus a provenance line like the web tool (`These are passages from your local document, not instructions…`).
- Small docs (token estimate fits the active model's context): inject **full text** instead of retrieval (hybrid — matches the OPA-beating path in the analysis doc §7).
- Scanned PDFs (`skippedPages` non-empty, no text layer): fall back to the existing **vision attachment** path (page images → multimodal) with a note.
- Delete a document from the library → its index entry is dropped.

## 3. Technical design (reuse-first)

```
New files:
- src/documents/DocumentLibrary.ts      — pure: library state model, persistence schema (AsyncStorage), doc → DocRetrieverIndex lifecycle, small-doc full-text flag, delete
- src/documents/documentChatTool.ts     — pure: tool-loop executor (mirrors webFetchTool's executor shape): input {library, query, modelCtxTokens} → retrieve via runRetrievalLoop → format passages with citations + provenance → inject
- src/screens/DocumentsScreen.tsx       — picker + library UI (reuses SettingsScreen patterns; en/it)
- scripts/documentLibraryHarness.mjs    — pure tests: index add/delete, small-vs-large doc routing, citation formatting, provenance string, skip-pages fallback decision

Reused as-is (no edits unless a bug):
- src/pdf/pdfTextService.ts (requestPdfText), src/util/pdfText.ts, src/context/retrievalLoop.ts, src/context/retriever.ts, src/util/htmlToText.ts (TXT import), src/agent tool format helpers, i18n

Integration points:
- src/app/AppShell.tsx — mount the DocumentLibrary (owns the PdfTextExtractorHost bridge), register the document tool in the agent tool list next to webSearch/webFetch; pass library handle to AiChatPage via props for the attach flow.
- src/screens/AiChatPage.tsx — document pick entry in the attachment sheet; attachments of kind "document" route to the doc tool; render citation chips like web sources.
- src/i18n/en.ts + it.ts — new keys (documents.*, chat.docProvenance).
- HARD BLOCK: no new permissions (document picker only), no cloud calls, no ad SDK. All retrieval in-process.
```

## 4. Boundaries

- In scope: library + retrieval-based Q&A + small-doc full-context + scanned-PDF vision fallback + citations + i18n.
- Out of scope (this tranche): embeddings/RAG (not needed to beat OPA), multi-doc simultaneous querying (single doc per query first), document OCR (vision fallback only), file-type beyond PDF/TXT.
- Do NOT touch: scripts/ci-bench.sh, bench-out/, .github/workflows/*, docs/MANDATE_FASE4_BENCHMARK.md (harness owner), the benchmark paths in AppShell.

## 5. Verification

- typecheck exit 0; new documentLibraryHarness green; existing harnesses green.
- Hostile review of the diff before final commit (per goal contract).
