# B5 Map #1: EmbeddingService + E5 Model Wiring

**Repo**: `kalsa` · branch `feat/moe-stream`
**Date**: 2026-09-04
**Scope**: Read-only. Every claim file:line.

---

## 1. EMBEDDING_MODEL in ModelRegistry

```typescript
// src/engine/ModelRegistry.ts:445-461
export const EMBEDDING_MODEL: EmbeddingModelInfo = {
  id: "multilingual-e5-small",
  name: "multilingual-e5-small",
  vendor: "intfloat / keisuke-miyako",
  quant: "Q8_0",
  hfRepo: "keisuke-miyako/multilingual-e5-small-gguf-q8_0",
  revision: "e1da94460f223e3204e75dfe51350e5491c879d4",
  file: "multilingual-e5-small-Q8_0.gguf",
  sizeBytes: 131_953_504,           // ~126 MB
  contextLength: 512,
  engineCtx: 512,
  kvCache: { k: "f16", v: "f16" },
  isEmbedding: true,
  dims: 384,
  langs: "100+ (incl. IT)",
  pooling: "mean",
  prefixes: { query: "query: ", doc: "passage: " },
  n_ctx: 512,
};
```

**Type extension** (same file, line 432–443):
```typescript
export type EmbeddingModelInfo = ModelInfo & {
  isEmbedding: true;
  dims: number;
  langs: string;
  pooling: "mean" | "cls";
  prefixes: { query: string; doc: string };
  n_ctx: number;
};
```

- **NOT in MODEL_REGISTRY** — standalone export, same `ModelDownloader` pipeline.
  `src/engine/ModelRegistry.ts:430` comment: "NOT listed in MODEL_REGISTRY (chat LLM list)".
- **sizeBytes verified** via HF API HEAD → `X-Linked-Size: 131_953_504`.
  `src/engine/ModelRegistry.ts:441`.
- **Download URL pattern**: `https://huggingface.co/keisuke-miyako/multilingual-e5-small-gguf-q8_0/resolve/{revision}/{file}`
  (`src/engine/ModelDownloader.ts:64-66`).

---

## 2. EmbeddingService Lifecycle

**File**: `src/engine/EmbeddingService.ts`

### 2a. initLlama embedding:true (line 437–443)

```typescript
// EmbeddingService.ts:437-443
const next = await initFn({
  model: path,
  embedding: true,
  n_ctx: EMBEDDING_MODEL.n_ctx,   // 512
  n_gpu_layers: 0,
  n_threads: 2,
});
```

- Static import of `initLlama` from `llama.rn` (line 37), not dynamic — avoids Metro `.default` issue.
- Cast via `unknown` to `InitLlamaFn` (line 422–430).

### 2b. withEmbedder (line 292–360)

```typescript
// EmbeddingService.ts:292
export async function withEmbedder<T>(
  fn: (embed: (text: string, role: "query" | "doc") => Promise<Float32Array | null>) => Promise<T>,
  opts?: EmbedAbortOpts,
): Promise<T | null>
```

- Acquires shared native-op lock for the **entire batch** — release cannot interleave mid-batch.
- Returns `null` when: hung, not downloaded, chat blocks embed, abort, or load failure.
- `fn` receives an `embed(text, role)` helper that applies prefix and calls native `embedding()`.
- Embedding `role` is typed `"query" | "doc"` — prefix applied inside `embedWithContext` (line 362).

### 2c. releaseEmbedder (line 322–352)

```typescript
// EmbeddingService.ts:322
export async function releaseEmbedder(): Promise<void>
```

- Safe to call when idle. Never throws. Absorbs `native_op_abandoned`.
- AppShell calls this **before** loading the chat model when co-residency is NOT allowed.
  `src/app/AppShell.tsx:418-450` — `releaseEmbedderBounded()`.

### 2d. Concurrency

- **Single-op serialization**: ALL llama.rn native calls go through `runNativeOp()` — an async FIFO mutex.
  `src/engine/llamaContextGate.ts:180-200`.
- **embedInitializing flag**: prevents concurrent init/release within EmbeddingService.
  `llamaContextGate.ts:28-32`.
- **embedInFlight flag**: true while any embed op (embed/init/release) is in flight.
  `llamaContextGate.ts:33`.
- **No thread pool, no batching** — chunks embedded one-by-one in a for-loop.
  `src/app/AppShell.tsx:1590` (the `for (const chunk of toEmbed)` loop).

### 2e. n_ctx

- Fixed at **512** — `EMBEDDING_MODEL.n_ctx` = `EMBEDDING_MODEL.engineCtx` = `EMBEDDING_MODEL.contextLength` = 512.
  `src/engine/ModelRegistry.ts:448,449,460`.
- Not adaptive; not subject to `resolveContextProfile` (that's chat models only).

---

## 3. embedQuery / embedDocumentChunk / Prefixes

### 3a. Prefixes (E5 protocol)

```typescript
// ModelRegistry.ts:460
prefixes: { query: "query: ", doc: "passage: " }
```

Applied via `applyEmbedPrefix` → delegates to `semanticIndex.ts`:
```typescript
// embeddingPure.ts:65-68
export function applyEmbedPrefix(text: string, role: "query" | "doc"): string {
  if (role === "query") return embedQueryPrefix(text);
  return embedDocPrefix(text);
}
```

```typescript
// documents/semanticIndex.ts:184-199
export function embedQueryPrefix(text: string): string {
  return `query: ${text}`;
}
export function embedDocPrefix(text: string): string {
  return `passage: ${text}`;
}
```

### 3b. embedQuery

```typescript
// EmbeddingService.ts:400-425
export async function embedQuery(text: string, opts?: EmbedAbortOpts): Promise<Float32Array | null>
```

- Lazy-loads embedder, calls `embedWithContext(ctx, text, "query", signal)`.
- Returns `null` on miss/error/abort/hung — **never throws**.

### 3c. embedDocumentChunk

```typescript
// EmbeddingService.ts:370-398
export async function embedDocumentChunk(text: string, opts?: EmbedAbortOpts): Promise<Float32Array | null>
```

- Same pattern as `embedQuery` but role `"doc"`.
- Called per-chunk from AppShell's `scheduleBackgroundEmbed` loop.
  `src/app/AppShell.tsx:1616` — `const vec = await embedDocumentChunk(chunk.text, { signal });`

### 3d. embedText (alias)

```typescript
// EmbeddingService.ts:365-368
export async function embedText(text: string, opts?: EmbedAbortOpts): Promise<Float32Array | null> {
  return embedDocumentChunk(text, opts);
}
```

### 3e. embedWithContext (low-level)

```typescript
// EmbeddingService.ts:362-394
async function embedWithContext(ctx, text, role, signal): Promise<Float32Array | null>
```

- Applies prefix via `applyEmbedPrefix`.
- Calls `ctx.embedding(prefixed, { embd_normalize: 2 })` — **L2 normalization at native level**.
  `EmbeddingService.ts:386`.
- Defensive: NaN/Infinity → 0 (line 389-390).

---

## 4. Settings Download UI + AppShell Download Flow

### 4a. Settings UI

```typescript
// SettingsScreen.tsx:1997-2078
{/* ── Embedding model (optional hybrid document search) ─────── */}
```

- Shows model name, size, status label (downloaded/downloading/missing/error/hung).
- Status label logic (`SettingsScreen.tsx:1059-1081`):
  - `isEmbedderHung()` → `t("embedding.hung")`
  - `"not_downloaded"` → `t("embedding.statusNotDownloaded")`
  - `"downloading"` → `t("embedding.downloading", { percent })`
  - `"downloaded"` → `t("embedding.statusDownloaded")`
- Progress bar shown when `embedding.state === "downloading"` (line 2039-2053).
- **Download button** shown only when `state === "missing" || state === "error"` (line 2064-2077).
- Button calls `embedding.onDownload` → `confirmEmbeddingDownload()`.

### 4b. AppShell download flow

```typescript
// AppShell.tsx:4064-4120
const startEmbeddingDownload = useCallback(async () => {
```

1. **Single-flight guard** (`embeddingDownloadInFlight` ref, line 4065).
2. **Free-disk check**: `diskRequirementBytes(EMBEDDING_MODEL.sizeBytes)` — same margin as chat models.
   `AppShell.tsx:4077-4085`.
3. **Calls `downloadModelBundle(EMBEDDING_MODEL, { onBundleProgress, signal, locale })`**
   — same pipeline as chat models. `AppShell.tsx:4088`.
4. **Post-download verification**: `isModelBundleDownloaded(EMBEDDING_MODEL)` — if false → error.
   `AppShell.tsx:4100`.
5. **On success**: `embedderDownloadedRef.current = true`, state → `"ready"`, shows notice.
   `AppShell.tsx:4105-4112`.
6. **On error**: friendly network error shown in UI + notification.
   `AppShell.tsx:4122-4136`.

### 4c. What happens when model is missing?

- **Embedding is fully optional.** `scheduleBackgroundEmbed` silently skips when `embedderDownloadedRef.current === false` (`AppShell.tsx:1466-1484`).
- `embedDocumentChunk` / `embedQuery` return `null` when model not downloaded (`EmbeddingService.ts:376-381`).
- `shouldDegradeToBm25Only({ embedderDownloaded: false, ... })` → `true` (`embeddingPure.ts:48-54`).
- `document_chat` tool falls back to BM25-only hybrid path.
- **No crash, no error toast, no banner.** The user just gets keyword search until they download the embedder.

---

## 5. Failure Modes

### 5a. OOM

- `classifyNativeEmbedErr` in `EmbeddingService.ts:67-83` catches `"oom"`, `"out of memory"`, `"enomem"` → `EmbedFailureKind: "oom"`.
- Telemetry fires only for `oom`, `model_corrupt`, `native_crash` (`AppShell.tsx:1616-1634`).
- On OOM: `embedDocumentChunk` returns `null`, hybrid degrades to BM25.

### 5b. Missing file

- `getEmbeddingModelStatus()` → `"not_downloaded"` (`EmbeddingService.ts:88-99`).
- `ensureEmbedder` never called → returns `null`.
- All embed paths short-circuit before native.

### 5c. Second-context conflict with chat model

- **Shared native-op mutex**: `runNativeOp()` serializes ALL llama.rn work (`llamaContextGate.ts:180-200`).
- **Co-residency gate** (`llamaContextGate.ts:56-58`):
  - `totalMemoryBytes > 6e9` AND 2B-class chat model → `allowsCoResidency()` = true → embedder can live alongside chat.
  - Otherwise: chat loading/ready blocks embed init entirely.
- **releaseEmbedderBounded** (`AppShell.tsx:418-450`): races `releaseEmbedder()` against 15s timeout.
  - On timeout: `markEmbedderHung()` → JS context dropped, native leaked, chat init **REFUSED**.
  - Recovery = process restart. Explicitly documented as BLOCK policy (round 7).
- **abort job on chat load** (`AppShell.tsx:978-989`): `bumpEmbedJobGeneration()` increments `embedJobGenerationRef` and aborts `AbortController` before chat model loads.

### 5d. Hung native context

- `embedderHung` flag (`EmbeddingService.ts:107-108`): once set, all `embed*` return `null` immediately.
- `isEmbedderHung()` exposed for UI (`SettingsScreen.tsx:1064`) and telemetry gating.
- **No automatic recovery** — process restart required.

### 5e. Abort/cancellation

- `AbortSignal` checked before every `await` boundary and before `initLlama`/`embedding()`.
  `EmbeddingService.ts:172-240` (ensureEmbedder), `370-398` (embedDocumentChunk), `400-425` (embedQuery).
- On abort: returns `null`, never throws. State left idle.

---

## 6. Existing Tests

**No tests exist for EmbeddingService, embeddingPure, or llamaContextGate.**

Verified:
- `find /Users/marco/Projects/kalsa/src -name "*.test.*" -path "*embed*"` → empty.
- `find /Users/marco/Projects/kalsa/src -name "*.test.*" -path "*llamaContext*"` → empty.
- `src/engine/__tests__/` contains `memoryPressure.test.ts` only — not embedding-related.
- All 30+ test files under `src/` are for other modules (memory, tools, telemetry, engine params, model gates).

**Test infrastructure**: Jest (`jest.config.js` exists at root). Tests are colocated `*.test.ts` files.

---

## 7. Gaps vs Production-Ready Optional Embedder

| Gap | Current State | Production Need |
|-----|---------------|-----------------|
| **Feature flag** | No runtime flag. Embedding is always attempted when downloaded. `scheduleBackgroundEmbed` is called unconditionally. | `kalsa.tools.embedding` toggle (like `kalsa.tools.device` at `src/agent/toolToggles.ts:3`). User opt-out without deleting model. |
| **Telemetry** | Only `embed.native` with `oom`/`model_corrupt`/`native_crash` (`AppShell.tsx:1616-1634`). No success metrics, no latency, no chunk counts, no degradation-to-bm25 rate. | Full lifecycle telemetry: download completion, init latency, per-chunk embed time, degrade-to-bm25 counter, co-residency success/fail. |
| **User messaging on degrade** | Silent. BM25-only fallback has no UI indication. User doesn't know embeddings aren't running. | Banner or subtle indicator when document_chat falls back to BM25 ("Semantic search unavailable — using keyword search"). |
| **Chunk-level progress** | `scheduleBackgroundEmbed` logs `[embed] plan` and `[embed] done` but no per-chunk progress to UI. | Progress indicator during large document embed (e.g., "Embedding 12/45 chunks"). |
| **Error recovery** | `embedderHung` = permanent; process restart required. No retry logic for transient OOM/native crash. | Exponential backoff retry (1-2 retries) before declaring hung. User-facing "Retry" button. |
| **Concurrent embed jobs** | Single-flight via `embedJobInFlightRef` — second import silently skipped (`AppShell.tsx:1366`). | Queue with priority (user-initiated doc import > background re-embed). Or at minimum, "embedding in progress" UI feedback. |
| **Model corruption** | `classifyNativeEmbedErr` detects "bad magic"/"corrupt" but no re-download prompt. | Detect corruption → prompt user to re-download embedder model. |
| **RAM telemetry** | Co-residency gate decisions not reported to telemetry. | Report co-residency allowed/denied, RAM tier, embedder release timeout events. |
| **Timeout config** | `EMBEDDER_RELEASE_TIMEOUT_MS = 15_000` hardcoded (`EmbeddingService.ts:114`). | Device-tier adaptive timeout (low-RAM devices may need shorter timeout to avoid UI freeze). |
| **Metrics export** | `consumeLastEmbedFailure()` is fire-and-forget, consumed once. | Persistent failure counter for analytics dashboard (how many embeds failed, by kind, over time). |

---

## File Inventory

| File | Role |
|------|------|
| `src/engine/ModelRegistry.ts:432-461` | `EMBEDDING_MODEL` catalog entry |
| `src/engine/EmbeddingService.ts` (entire file) | On-device E5 lifecycle |
| `src/engine/embeddingPure.ts` | Pure helpers (prefix, hash, chunking, degrade logic) |
| `src/engine/llamaContextGate.ts` | Shared native-op mutex + co-residency gate |
| `src/documents/semanticIndex.ts:184-215` | E5 prefix helpers + L2 normalize + brute-force cosine |
| `src/documents/documentChatTool.ts` | `document_chat` tool (BM25+dense hybrid retrieval) |
| `src/screens/SettingsScreen.tsx:133-141,1997-2078` | Download UI |
| `src/app/AppShell.tsx:285-286,418-450,956-992,1340-1676,4060-4150` | Download flow, embed job, residency gates |
| `src/telemetry/pure.ts:377` | `embed.native` telemetry code pattern |
