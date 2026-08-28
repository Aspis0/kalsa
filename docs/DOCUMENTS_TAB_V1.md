# Documents Tab v1 — friendly library for non-technical users

Date: 2026-08-12 · Branch: TBD (off main) · Status: DESIGN PROPOSAL (post-audit v1, pre-implementation)

> **Author note**: This plan was drafted after the user pushed back on the
> previous "documents tab + drag-and-drop" proposal with a key constraint:
> **the audience is the broad public, not power users**. Anything that reads
> like an engineer's screen (chip-style metadata, technical status badges,
> inline memory/process readouts, sort menus, multi-select) is out. Only
> patterns a non-technical user would recognise from iOS Photos, Apple
> Notes, Files, or a paperback reader belong here.
>
> **v1 audit (2026-08-12, hostile reviewer)**: **BLOCK** → all 6 CRITICAL
> and 7 HIGH findings integrated into this revision. Cross-doc contract
> checks pass (DOCUMENT_CHAT_TRANCHE1.md FIX-5 preserved; HYBRID_RETRIEVAL,
> ANTI_OOM_AND_EDITREGEN, DEVICE_TUNING_LAYER untouched; COMPETITOR_ANALYSIS
> patterns reused, MIT license verified for the new dep).

---

## 1. Scope (what ships, what does not)

### In scope (this tranche)

1. **Documents overlay** opened from Settings/Help area (no new root tab —
   keep the Android-first screen count low, same rationale as the original
   `DOCUMENT_CHAT_TRANCHE1.md`).
2. **Empty state** with a soft illustration, friendly copy, single CTA.
3. **Library list** of imported documents with:
   - Cover thumbnail (page-1 JPEG for PDF, tinted text tile for TXT/MD).
   - Title, friendly metadata ("12 pagine" / "1,4 MB"), no tech stack.
   - Long-press → drag handle → reorder.
   - Tap → open in-document detail view.
4. **In-screen detail view** (push inside the same overlay; back returns
   to the list — no AppShell overlay kind for detail; the back stack stays
   flat).
5. **Single picker** ("Aggiungi documento") accepting PDF + plain text +
   Markdown (Markdown accepted as `kind: "txt"` per recommendation Q4).
6. **Import overlay** with friendly copy "Sto leggendo il documento…",
   blocks back/picker while running.
7. **Cover generation** for PDFs via `PdfToImages` `maxPages={1}`,
   sequential after text extraction (per recommendation Q2).
8. **Reorder persistence** via pure `reorderDocs(state, orderedIds)`
   (per recommendation Q1: array order, no `addedAt` rewriting).
9. **Friendly errors** replacing the current "extracting / noTextLayer /
   fs_error / timeout" UX (per recommendation Q3: failed PDF still listed
   as "Non leggibile").
10. **TXT/MD preview snippet** stored at import (per recommendation Q5)
    capped at ~200 chars; detail renders it without on-open I/O.

### Explicit non-goals (this tranche)

- ❌ No multi-select / batch delete.
- ❌ No rename, duplicate, folders, tags, search.
- ❌ No sort menu (order = array position; default new-on-top).
- ❌ No tokens / BM25 / embedder / extraction-status badges visible.
- ❌ No full multi-page PDF reader (cover only via `maxPages={1}`).
- ❌ No separate AppShell overlay kind for detail.
- ❌ No "+ PDF / + TXT" split buttons.
- ❌ No benchmark / process-health / memory badges (per prior review
  against "audience too broad").
- ❌ No new abstractions (no `RegenerateFlow`, no `DocOwner` — reuse
  existing `onAddDocument` / `onDeleteDocument` props from AppShell).
- ❌ No new permissions (document picker only).

---

## 2. UX (what the user sees)

### A. Empty state

```
[ ← Documenti ]
        [ 📄  large FileText icon, tinted  ]
     "Nessun documento ancora"
   "Aggiungi un file e potrai
    chiederne a Kalsa in chat."
       [ + Aggiungi documento ]   ← single primary CTA
```

- Centered in shell background.
- One primary button (accent color, large tap target ≥ 48 px).
- Icon = `FileText` from `lucide-react-native` (already in tree), 64 px,
  tinted with accentSoft at 20% alpha. **No bespoke illustration asset**
  (audit MED-1: no `src/theme/illustrations/` exists; using a stock Lucide
  icon keeps this implementable without a design task).

### B. Library list

```
[ ← Documenti ]                    [ + ]
┌─────────────────────────────────────┐
│ [cover]  Manuale_frigo.pdf      ≡   │  ← ≡ drag handle, long-press to lift
│  12 pagine · 1,4 MB                  │
├─────────────────────────────────────┤
│ [Aa]     Lista_spesa.txt        ≡   │
│  48 KB                               │
└─────────────────────────────────────┘
hint under list (once, dismissable): "Tieni premuto per riordinare"
```

- PDF cover: 56 × 72 px, rounded 12, page-1 JPEG. Missing/loading →
  soft `FileText` placeholder (same dimensions).
- TXT/MD → tinted icon tile in the same slot (no fake cover).
- Meta: pages (if known) **or** size — never both jargon stacks; never
  tokens, kind codes, "no text layer", or extraction status.
- Failed read: friendly one-liner muted under the title, "Non leggibile".
  Tap → detail shows the friendly error and the delete button.
- Header `+` = same single picker as the empty CTA.
- Long-press a row → lift + gap; release commits order.
- One-time hint ("Tieni premuto per riordinare") under the list,
  dismissable with `X` and remembered per-session.

### C. Detail (push inside same overlay)

```
[ ← ]  Documenti
┌──────── cover / text preview ────────┐
│  PDF: large page-1 image (full width) │
│  TXT/MD: first ~4 lines, monospaced   │
└──────────────────────────────────────┘
  Manuale_frigo.pdf
  12 pagine · 1,4 MB · aggiunto ieri

  [        Elimina        ]   ← destructive, full width, Alert confirm
```

- No rename / share / re-import / "open in chat" CTA (chat already uses
  the library).
- TXT/MD preview = stored snippet (no I/O at open).
- "Aggiunto ieri" / "Aggiunto oggi" via simple time bucket (no absolute
  dates in the main view).

### D. Import progress (modal overlay)

- Dim background + `GlassPanel2` card.
- Spinner + **"Sto leggendo il documento…"** + optional file name on one
  line.
- Blocks back / picker / row taps while running.
- Replaces the current inline `ActivityIndicator` under the old intro
  panel.

---

## 3. State machine

```
LIST (docs = [])  ──→  EMPTY  ── tap "+" / CTA  ──→  PICKING
LIST (docs > 0)   ── tap "+" / row  ────────────→  PICKING / DETAIL
  │
  └── long-press → drag → release → reorderDocs → persist

PICKING (system sheet; cancel → LIST)
  │
  └── asset chosen → IMPORTING  (overlay; refuse if delete latch / extract busy)
        │
        ├── size/storage/read fail → Alert (friendly) → LIST
        ├── extract ok → generate cover (PDF only, sequential) → onAddDocument → LIST (new first)
        └── extract fail (current FIX-5 behaviour) → onAddDocument + Alert (friendly) → LIST
              (entry is added with "Non leggibile" subtitle; chat tool will not vision-fallback)

LIST  ──tap row──→  DETAIL(docId)
DETAIL  ──back──→  LIST
DETAIL  ──Elimina confirm──→  onDeleteDocument  →  LIST
```

Busy guards (unchanged from current screen):
`isDocumentDeleteInFlight`, `isPdfTextExtractionBusy`,
`isDocumentOpInFlight`. Back hardware: blocked while IMPORTING;
DETAIL pops first.

---

## 4. Order model

- Display order = `library.docs` array order.
- New imports **prepend** (CRIT-3 fix): the existing AppShell
  `addDocument` uses `docs: [...current, entry]`; the new code uses
  `docs: [entry, ...current.docs]` (or a new `addDocPrepend` helper).
  A harness case asserts import order so this never regresses.
- Reorder = pure `reorderDocs(state, orderedIds)` with strict
  permutation contract (MED-2):
  - **Required**: `orderedIds` is exactly a permutation of the current
    doc IDs (same length, same elements, no duplicates).
  - **Malformed input** (missing IDs, extra IDs, duplicates, empty):
    return the **unchanged state**; the call is a no-op. Never silently
    drop or duplicate a document.
  - The harness covers all four malformed shapes.
- `addedAt` is **never rewritten** by reorder — that would lie about
  "added today / yesterday" labels.

---

## 5. Cover generation (PDFs)

**Storage**: covers are written to **owned durable storage**, not
`cacheDirectory`. `PdfToImages` writes its JPEGs under `cacheDirectory`
which can be evicted by the OS at any time; we cannot persist a
`previewUri` that points to a cache file we don't own. The plan:
- `PdfToImages` renders into a temp path under `cacheDirectory`.
- On `onPage(0, imageUri)`, `documentCover.ts` reads the JPEG, writes a
  resized copy into `documentDirectory/kalsa-covers/<docId>.jpg`, and
  commits that durable URI as `previewUri`.
- Cleanup: `deleteOwnedFile(previewUri)` in AppShell delete path, plus
  cleanup of the temp cache JPEG after the durable write succeeds.

**Lifecycle (CRIT-2 + CRIT-6 fixes)**:
- Cover generation acquires the shared `docOpGate` READ latch for its
  entire operation. Delete that fires while a cover is generating
  blocks on the same gate; the cover job checks `library.has(id)` again
  right before the durable JPEG write and aborts if the doc is gone.
- Cover is generation-bound: `inflightCoverGen` increments on each
  start; a late `onPage` callback that sees a stale gen aborts without
  writing.
- Commit via AppShell `updateDocumentPreview(id, previewUri)` (new prop)
  using the **functional state updater** against `libraryRef.current`.
  This is the only path that can mutate an existing entry.

**Resolution & memory (HIGH-6 fix)**:
- Render at low resolution: a dedicated `coverRenderWidth = 224` px
  (4× display size for HiDPI sharpness) instead of the 1024 px default.
  This keeps decoded image size at ~224 × 304 × 4 ≈ 270 KB raw,
  ~50–80 KB as JPEG. 100 docs ≈ 5–8 MB total cover storage on disk,
  ~7 MB decoded if all held in `Image` cache simultaneously.
- On rendering, validate `previewUri` exists before showing it; if the
  file is gone (cache eviction edge case, manual delete), fall back to
  the tinted `FileText` placeholder.

**Failure modes**:
- Cover generation failure (timeout, WebView error, no page 1) → silent
  degrade to placeholder. **No** user-facing error toast (the document
  is still usable in chat; cover is cosmetic).
- If `previewUri` is set but the file is missing at render time →
  silent fallback to placeholder (no error).

**Sequential, not parallel**: only one cover generates at a time across
the app (single-flight per import). Adds ~1–2 s on mid-tier devices but
eliminates WebView-pool contention on Android.

**Implementation**: new module `src/documents/documentCover.ts`
exports `generateCoverForDoc(doc, opts): Promise<string | null>`. It
owns the temp render, the resize, and the durable write.

---

## 6. Picker (single button, narrow type list)

```ts
DocumentPicker.getDocumentAsync({
  type: ["application/pdf", "text/plain", "text/markdown"],
  copyToCacheDirectory: true,
  multiple: false,
});
```

`text/*` is **deliberately excluded** (HIGH-3 fix) — it would accept
HTML, XML, CSV, source files, and binary files mislabelled as text.
We accept only PDF, plain text, and Markdown MIME types.

After picker selection, **content validation** runs:
- Reject files with NUL bytes in the first 8 KB (binary mislabel).
- Reject files over `MAX_DOCUMENT_BYTES` / `MAX_TEXT_BYTES` (existing).
- Empty TXT/whitespace-only TXT → reject with friendly `errorEmpty`
  (CRIT-4 fix; never add, never enter vision fallback).

Branch by MIME / extension:
- `application/pdf` → `kind: "pdf"`.
- `text/markdown` or `.md` extension → `kind: "txt"` (Q4: accepted).
- `text/plain` → `kind: "txt"`.

---

## 7. Failed imports (per Q3: still listed, with strict rules)

**Hard rejects (entry not added)**:

| Failure                  | UI                                         |
|--------------------------|--------------------------------------------|
| Size > MAX               | Alert (friendly, shows max)                |
| Storage unavailable      | Alert (friendly)                           |
| Read failed (TXT)        | Alert (friendly)                           |
| Empty / whitespace TXT   | Alert `errorEmpty`                         |
| Binary mislabel (NUL in first 8 KB) | Alert `errorBinary`             |

**Soft failures (entry added with "Non leggibile" subtitle)**:

| Failure                  | Chat tool path                                          |
|--------------------------|---------------------------------------------------------|
| Extract timeout (PDF)    | `shouldUseVisionFallback` → **false** → `errorResult`   |
| Extract renderer error   | `errorResult` (NOT vision_fallback — FIX-5 invariant)   |
| Extract FS error         | `errorResult`                                            |
| Scanned PDF (no text layer) | Vision fallback marker (existing path)               |
| Cover generation failure | Silent degrade to placeholder cover                    |

**CRIT-5 fix**: the previous Q3 rationale said "lets chat attempt
vision-fallback" for failed PDFs. That contradicts FIX-5
(`shouldUseVisionFallback` MUST return false for
`timeout | renderer_error | fs_error`). The correct contract:
- **Failed extraction** (timeout/renderer/fs) → entry is listed for
  visibility but **chat returns an errorResult, never vision fallback**.
- **Scanned PDF** (extraction succeeded, zero text layer) → entry is
  listed; **chat returns the vision-fallback marker** so the page
  images are attached to the next message.
- These are **two distinct states** and must not be conflated. The
  harness in `documentLibraryHarness.mjs` covers all three statuses
  explicitly.

**Detail view**: the failed entry's detail shows the friendly reason
("Non riesco a leggere questo PDF, potrebbe essere scannerizzato o
protetto") and the primary "Elimina" button. No "Riprova" action in v1
(audit MED-4 — retry would re-trigger the same broken state without
any diagnostic gain; user can re-import from a working copy).

---

## 8. Files & modules

| Change | Path | Est. lines |
|---|---|---:|
| Rewrite list / empty / import overlay / local detail stack | `src/screens/DocumentsScreen.tsx` | 390 → 600 |
| New list row (cover + title + meta + drag handle, a11y labels) | `src/screens/documents/DocumentListItem.tsx` | +120 |
| New detail surface (in-screen, not AppShell overlay, back stack contract) | `src/screens/documents/DocumentDetailView.tsx` | +180 |
| New empty state (Lucide icon + CTA, no bespoke illustration) | `src/screens/documents/DocumentsEmptyState.tsx` | +70 |
| New full-screen import busy overlay | `src/screens/documents/DocumentImportOverlay.tsx` | +60 |
| New one-shot page-1 cover generator (durable write + resize + gate) | `src/documents/documentCover.ts` | +130 |
| Pure helpers: `reorderDocs`, `makePreviewSnippet`, `formatBytesLocalized`, `formatAddedBucket`; optional `previewUri?` | `src/documents/DocumentLibrary.ts` | +90 |
| Delete owned cover on remove; previewSnippet lazy read on detail open | `src/documents/documentStorage.ts` + AppShell | +50 |
| Props: `onAddDocument` (prepend), `onReorderDocuments`, `onUpdateDocumentPreview`; serialized persistence queue | `src/app/AppShell.tsx` | +80 |
| i18n + types (24 user-facing keys + locale formatters) | `src/i18n/en.ts`, `it.ts`, `types.ts` | +110 |
| Accessibility: `accessibilityLabel`/`accessibilityHint` on rows, drag handle, hint dismiss; reduced-motion check | `src/screens/documents/*.tsx` | included above |
| New dep `react-native-draggable-flatlist` (MIT, peer-compatible with installed RNGH + Reanimated 4) | `package.json` + `package-lock.json` | +1 dep |
| Harness: reorderDocs cases, prepend, legacy compat, snippet cap, i18n parity, date bucket | `scripts/harnesses/documentLibraryHarness.mjs` + `scripts/harnesses/i18nParityHarness.mjs` (NEW) | +60 |

**Reuse as-is**: `Header`, `GlassPanel2`, `expo-document-picker`,
`requestPdfText`, TXT read path, delete latch in AppShell, `PdfToImages`
(`src/components/PdfToImages.tsx`), row visual language inspired by
`RecentCard` (36–56 cover, title, subtitle) + chevron pattern from
`ActionRow` — but the row needs a larger leading slot, so we don't drop
those in directly.

---

## 9. Drag library choice: `react-native-draggable-flatlist`

| | DFL | Custom `Gesture.Pan()` |
|---|---|---|
| Long-press → reorder API | Built-in | DIY activation, placeholder, auto-scroll |
| Auto-scroll near edges | Yes | Easy to get wrong |
| Conflict with drawer pan in `AppShell.tsx` | `simultaneousHandlers` / `activeOffset` | Same but more surface area |
| Bundle | Small (already uses RNGH + Reanimated) | 0 new dep, **~200–400 LOC fragile** |
| List size (short libraries) | Fine | Overkill either way |

**Recommendation**: ship `react-native-draggable-flatlist`. The custom
path was rejected for v1; if a future "no new deps" rule appears we can
hand-roll later (the gesture primitives are all already installed).

---

## 10. i18n keys (rewrite user-facing `documents.*`)

**Two distinct groups**: screen keys (user-facing) and tool keys
(model-facing inside `document_chat` tool body).

**Screen keys — old tech-jargon dropped** (`intro`, `addPdf`, `addTxt`,
`extracting`, `noTextLayer`, `extraction.*` as user labels). Failures
collapse into friendly keys (`errorPdf` / `errorTxt` / `errorBusy` /
`errorEmpty` / `errorBinary`).

**Tool keys — preserved**. `documents.extraction.timeout`,
`documents.extraction.renderer`, `documents.extraction.fsError`,
`documents.extraction.retryHint` and `errors.documentChat*` are
**not** orphaned; they are read by `documentChatTool.ts` to compose
the tool body that the chat model sees. They must stay until that
tool is rewritten (out of scope for this tranche). The audit verified
the tool code paths still consume them.

**Screen keys (24 total)**:

| Key | EN | IT |
|---|---|---|
| `title` | Documents | Documenti |
| `emptyTitle` | No documents yet | Nessun documento ancora |
| `emptyBody` | Add a file and you can ask Kalsa about it in chat. | Aggiungi un file e potrai chiederne a Kalsa in chat. |
| `add` | Add document | Aggiungi documento |
| `reorderHint` | Hold and drag to reorder | Tieni premuto per riordinare |
| `reorderHintDismiss` | Got it | Capito |
| `reading` | Reading your document… | Sto leggendo il documento… |
| `readingName` | Reading {name}… | Sto leggendo {name}… |
| `pageCount` | {count} pages | {count} pagine |
| `pageCountOne` | 1 page | 1 pagina |
| `sizeOnly` | {size} | {size} |
| `metaPagesSize` | {pages} · {size} | {pages} · {size} |
| `addedToday` | Added today | Aggiunto oggi |
| `addedYesterday` | Added yesterday | Aggiunto ieri |
| `addedOn` | Added {date} | Aggiunto {date} |
| `unreadable` | Can't read this file | Non leggibile |
| `errorPdf` | I can't read this PDF. It may be scanned or protected. | Non riesco a leggere questo PDF. Potrebbe essere scannerizzato o protetto. |
| `errorTxt` | I can't read this file. Try another copy. | Non riesco a leggere questo file. Prova con un'altra copia. |
| `errorEmpty` | This file is empty. | Il file è vuoto. |
| `errorBinary` | This file doesn't look like a document. | Questo file non sembra un documento. |
| `errorTooLarge` | This file is too large (max {max}). | Questo file è troppo grande (max {max}). |
| `errorBusy` | Something is already in progress. Try again in a moment. | C'è già un'operazione in corso. Riprova tra poco. |
| `errorStorage` | Can't save documents on this device right now. | Non riesco a salvare documenti su questo dispositivo. |
| `delete` | Delete | Elimina |
| `deleteConfirm` | Delete "{name}"? This can't be undone. | Eliminare "{name}"? Non si può annullare. |
| `deleteCancel` | Keep | Mantieni |
| `detailBack` | Documents | Documenti |
| `detailFallback` | Text document | Documento di testo |
| `detailA11yRow` | {name}, {meta} | {name}, {meta} |
| `detailA11yCover` | Cover image for {name} | Copertina di {name} |
| `detailA11yDrag` | Reorder handle | Maniglia per riordinare |

**Locale formatting (HIGH-7 fix)**:
- Sizes use a new helper `formatBytesLocalized(bytes, locale)` using
  `Intl.NumberFormat` for proper thousand separators (Italian `1,4 MB`,
  English `1.4 MB`).
- Dates use `Intl.DateTimeFormat("it-IT"/"en-US", { day: "numeric",
  month: "short" })`. Day-bucket ("today" / "yesterday" / "older") is
  computed by **calendar date** comparison in the user's local time
  zone, not by elapsed 24 h (so the bucket doesn't drift across
  midnight).
- The date formatter is unit-tested with mock `Date` to cover midnight
  rollover.

---

## 11. Open questions + recommendations

These were the design decisions the user was asked to confirm. My
recommendations are listed; the final answer will be confirmed before
implementation begins.

| # | Decision | Recommendation | Rationale |
|---|---|---|---|
| Q1 | Reorder persistence | **Array order pure (`reorderDocs`)** | Cleaner; doesn't lie about "added today/yesterday" dates. |
| Q2 | Cover timing | **Post-extract sequential** | Simpler; user already waits for text extract; ~+1–2 s is acceptable on mid-tier. |
| Q3 | Failed PDF listing | **Still listed as "Non leggibile"** | Visibility for the user. Chat tool **never** uses vision fallback for failed extraction (timeout/renderer/fs); only for successful scans. See §7. |
| Q4 | Markdown in picker | **Accepted as `kind: "txt"`** | Non-technical users have .md files (Obsidian, Apple Notes exports). |
| Q5 | TXT preview | **Lazy read on open, snippet ≤ 200 chars** | Reversed after audit: storing snippets bloats library JSON for marginal benefit; reading the first 200 chars on detail open is ~50 ms I/O, well below the 100 ms "feels instant" threshold. Legacy docs without snippet open with placeholder until read. |

---

## 12. Boundary / reuse contract

- **In scope**: library UI, single picker, friendly errors, cover, reorder.
- **Out of scope**: document chat tool changes, retrieval changes,
  hybrid retrieval, embedder, anti-OOM, device tuning, model gate.
- **Do not touch**: `src/context/retrievalLoop.ts`, `src/util/pdfText.ts`,
  `src/agent/webFetchTool.ts`, `src/engine/LlamaService.ts`,
  `docs/MANDATE_FASE4_BENCHMARK.md` (harness owner's territory),
  `.github/workflows/*`, `scripts/ci/ci-bench.sh`, `out/bench/`.
- **Ownership stays in AppShell**: `onAddDocument` (now prepends),
  `onDeleteDocument`, `updateDocumentPreview`, delete latch, library
  persistence (HIGH-5: serialized write queue), `requestPdfText` host
  mount. Screen stays presentational + picker/import orchestration,
  matching the existing latch comments in `DocumentsScreen.tsx`.

**Persistence queue (HIGH-5 fix)**: a small serial write queue in
AppShell (`pendingSavePromise: Promise<void>`) ensures add → reorder →
preview-update → delete writes arrive at AsyncStorage in order, so a
slow save cannot overwrite a newer state. The queue is FIFO and
chained; failures retry up to 3 times before surfacing a friendly
Alert. Harness tests cover add-then-reorder, add-then-preview-update,
and add-then-delete races.

**AppShell prop additions**:
- `onAddDocument(entry)` — now prepends `[entry, ...current.docs]`.
- `onDeleteDocument(id)` — also deletes `previewUri` cover file.
- `onReorderDocuments(orderedIds)` — invokes `reorderDocs` via
  functional updater + persistence queue.
- `onUpdateDocumentPreview(id, previewUri)` — updates `previewUri` on
  existing entry; refuses if doc is gone (generation check).

---

## 13. Verification

- `npm run typecheck` exit 0.
- `node scripts/harnesses/documentLibraryHarness.mjs` extensions:
  - `reorderDocs`: identity on same order, mid swap, full reverse,
    missing-id → unchanged, duplicate-id → unchanged, empty input →
    unchanged, length-mismatch → unchanged.
  - `addDoc` prepends (existing + new case asserting new-first).
  - `sanitizeDoc` accepts missing `previewUri` and `previewSnippet`
    fields (legacy compatibility).
  - `parseLibraryState` round-trips new fields.
  - `makePreviewSnippet` (NEW pure helper): cap at 200 code points
    after trim, Unicode-safe cut at code-point boundary, returns
    undefined for empty input, no NUL leakage.
- `node scripts/harnesses/i18nParityHarness.mjs` (NEW or extended): every
  key in §10 exists in both `en.ts` and `it.ts`; old keys
  (`intro`, `addPdf`, `addTxt`, `extracting`, `noTextLayer`) are not
  referenced by any screen code (grep across `src/screens/`,
  `src/app/`, `src/components/`).
- All existing harnesses still green.
- Hostile review of the diff before commit (per tranche discipline).

---

## 14. Audit findings (resolved in this revision)

| # | Severity | Finding | Resolution |
|---|---|---|---|
| CRIT-1 | Cover URI in cacheDir (can be evicted) | §5 | Cover written to owned durable storage via `documentCover.ts`. |
| CRIT-2 | No commit/update protocol for late cover | §5, §12 | New `onUpdateDocumentPreview(id, previewUri)` AppShell prop with functional updater + generation check + serialized persistence queue. |
| CRIT-3 | New imports appended, not prepended | §4, §12 | `onAddDocument` now prepends; harness asserts. |
| CRIT-4 | Whitespace TXT → vision fallback | §6, §7 | Reject with `errorEmpty`; never added; never vision. |
| CRIT-5 | Q3 contradicted FIX-5 | §7, §11 | Q3 rationale rewritten; table distinguishes failed extraction (error) vs scanned PDF (vision); harness covers all statuses. |
| CRIT-6 | Cover / delete race | §5 | Cover acquires `docOpGate` READ latch + generation-bound; re-checks `library.has(id)` before durable write. |
| HIGH-1 | Snippet cap unenforced | §8, §10 | `makePreviewSnippet(plainText): string \| undefined` with Unicode-safe cut, omit on empty. |
| HIGH-2 | Markdown raw to chat | §6 | Treat as plain text intentionally; front matter preserved; documented as design choice. |
| HIGH-3 | `text/*` too broad | §6 | Strict MIME list `[pdf, plain, markdown]` + content NUL-byte validation + extension whitelist. |
| HIGH-4 | i18n key list incomplete | §10 | 30 keys enumerated; tool keys preserved; harness asserts parity. |
| HIGH-5 | Persistence writes out of order | §12 | Serialized FIFO queue in AppShell. |
| HIGH-6 | Cover memory assumption wrong | §5 | Dedicated `coverRenderWidth = 224` px; ~5–8 MB on disk for 100 docs. |
| HIGH-7 | Locale formatting undefined | §10 | `formatBytesLocalized` + `Intl.DateTimeFormat`; calendar-date buckets; midnight-rollover tests. |
| HIGH-8 | Detail back behavior unspecified | §3, §12 | `screenMode: "list" \| { detailId }`; hardware-back order explicit; pending ops checked. |
| MED-1 | No illustration asset | §2 | Use stock Lucide `FileText` icon (already in tree); no design task. |
| MED-2 | Reorder helper contract loose | §4 | Strict permutation; malformed → unchanged; harness covers 6 shapes. |
| MED-3 | A11y / reduced motion underdesigned | §2, §10 | Row a11y labels, drag announcements, reduced-motion fallback for lift animation. |
| MED-4 | Failure UI loses cause | §7 | Per-status detail copy; no retry in v1 (documented). |
| MED-5 | Legacy docs no snippet | §11, §13 | Q5 reversed: lazy read on open; legacy opens with placeholder. |
| MED-6 | Drag dep not pinned | §8, §9 | Pin version; verify peer-compatible; lockfile updated. |
| LOW-1 | Detail shows both pages + size | §2 | Detail allowed to show both (full info); list shows one or the other. |
| LOW-2 | Filename truncation in overlay | §2 | Truncate to 32 chars + ellipsis in `readingName`. |
| LOW-3 | Jargon in a11y labels | §10 | New a11y keys avoid `kind`, `status`, `text layer`, etc. |
| LOW-4 | Picker cache cleanup | §6 | Documented; cache file is short-lived, GC by OS. |

**Cross-doc contract checks**:
- `DOCUMENT_CHAT_TRANCHE1.md` — **PASS**: tool path unchanged;
  `shouldUseVisionFallback()` invariant preserved; whitespace TXT no
  longer reaches it; harness covers all statuses.
- `HYBRID_RETRIEVAL.md` — **PASS**: semantic index untouched; cover
  generation does not mutate it.
- `ANTI_OOM_AND_EDITREGEN.md` — **PASS**: chat generation lifecycle
  not touched; cover WebView has its own gate (does not co-resident
  with chat engine).
- `DEVICE_TUNING_LAYER.md` — **PASS**: engine knobs closed.
- `COMPETITOR_ANALYSIS.md` — **PASS**: UX patterns reused (no closed
  source); `react-native-draggable-flatlist` MIT license compatible.

---

## 15. Companion docs cross-reference

- Original technical design: `docs/DOCUMENT_CHAT_TRANCHE1.md` (FIX-5 +
  vision-fallback logic).
- Hybrid retrieval: `docs/HYBRID_RETRIEVAL.md` (semantic index, RRF).
- Competitor analysis: `docs/COMPETITOR_ANALYSIS.md` §4 (rivals' UX
  patterns we're borrowing) and §7 (gap analysis — Documents tab was
  the user's standout gap to close).
- Anti-OOM + edit/regen: `docs/ANTI_OOM_AND_EDITREGEN.md` (no overlap;
  this plan does not touch generation lifecycle).
- Device tuning layer: `docs/DEVICE_TUNING_LAYER.md` (no overlap; engine
  knobs are closed territory).

---

## 16. Implementation order (suggested)

1. **Pure helpers + harness** (`DocumentLibrary.ts` reorderDocs +
   makePreviewSnippet + sanitizeDoc accepts new fields, plus harness
   extension). Run harness green before any UI work.
2. **AppShell contract** (`onAddDocument` prepends, persistence queue,
   `onReorderDocuments`, `onUpdateDocumentPreview`). Typecheck only.
3. **Cover generator** (`documentCover.ts` + owned-durable write +
   docOpGate integration). Harness via stub; verify against a real PDF
   on the S23 / PC later.
4. **Storage helpers** (delete owned cover on doc delete; preview
   snippet lazy read).
5. **i18n** (30 keys in `en.ts` + `it.ts` + types + parity harness).
6. **Screen components** (DocumentListItem, DocumentDetailView,
   DocumentsEmptyState, DocumentImportOverlay) — presentational only.
7. **DocumentsScreen rewrite** — wires everything; manual smoke.
8. **Drag library** (`react-native-draggable-flatlist` install,
   peer check, lockfile update).
9. **Final hostile review** of the full diff before commit.
