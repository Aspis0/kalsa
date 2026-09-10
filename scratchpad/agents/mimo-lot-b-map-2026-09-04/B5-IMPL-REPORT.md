# B5 Option D Implementation Report

Date: 2026-09-05
Repo: `/Users/marco/Projects/kalsa`
Branch: `feat/moe-stream`

## Implemented

- Added `src/documents/semanticIndex.test.ts` covering vector add/query, normalization and rejection, float caps, JSON/capped round-trip, RRF, float deltas, incremental planning, and e5 prefixes.
- Added `src/engine/embeddingPure.test.ts` covering FNV content hashes, chunk planning, shared document chunking, BM25-only degradation, and e5 prefixes.
- Added `src/documents/documentChatTool.test.ts` covering empty library, abort propagation, BM25-only degradation, and hybrid retrieval through `createDocumentChatExecutor` with a mock `DocumentChatHost`.
- Added AppShell `rebuildSemanticIndex(docId)`. It guards missing documents and in-flight document/embed operations, deletes the vector sidecar, clears dense per-document state, and schedules the existing background embed job.
- Plumbed the rebuild callback through `DocumentsScreen` to `DocumentDetailView`.
- Added a disabled-while-busy “Rebuild index” action with accessibility label/hint and English/Italian translations.

## Verification

| Check | Result |
|---|---:|
| Targeted Jest: 3 requested suites, 15 tests | EXIT: 0 |
| `npm run typecheck` | EXIT: 0 |
| `git diff --check` | EXIT: 0 |

Jest log: `/tmp/b5-jest.log`
Typecheck log: `/tmp/b5-typecheck.log`

## Skipped / non-goals

- No notes or chat corpus indexing.
- No new tools or retrieval entry points.
- No export of the private `tryHybridRetrieve` helper.
- Full Jest suite not run; verification stayed targeted as requested.
- No commit or push performed.

Pre-existing unrelated worktree changes were preserved.

## DeepSeek audit fixes

- Fixed destroy-before-verify: rebuild now resolves the current entry and runs the shared RAM preflight plus shared embedder-download check before generation bump, sidecar deletion, or dense-map clearing.
- Shared `mustSkipEmbedForRam` and `ensureEmbedderDownloaded` helpers are used by both imports and rebuilds, preventing divergent preflight rules.
- Added shared `isDocumentUnreadable` logic; unreadable documents refuse rebuild and no longer render the rebuild control.
- Rebuild refusal now distinguishes busy, rebuild-in-progress, missing embedder, and unavailable-document cases with English/Italian messages.
- Accepted rebuilds show a “started in the background” alert and expose a reactive busy prop until the scheduled job settles.
- Added a hybrid top-order assertion and executor single-flight busy-latch test.

Final audit verification:

| Check | Result |
|---|---:|
| Targeted Jest: 3 requested suites, 16 tests | EXIT: 0 |
| `npm run typecheck` | EXIT: 0 |
| `git diff --check` | EXIT: 0 |

Final logs: `/tmp/b5-final-jest.log`, `/tmp/b5-final-typecheck.log`
