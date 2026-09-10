# B5 AUDIT — DEEPSEEK (hostile)

Branch `feat/moe-stream`, HEAD `e697d33` + uncommitted B5 worktree.
Scope: AppShell `rebuildSemanticIndex`, DocumentsScreen/DocumentDetailView wiring, i18n en/it, 3 new test suites (15 tests, re-ran EXIT 0: 3 suites, 15 passed).
Verdicts: CONFIRMED / PLAUSIBLE / REFUTED.

---

## Findings

### 1. Destroy-before-verify: rebuild deletes the durable index, then re-embed can silently no-op → permanent bm25_only — CONFIRMED (HIGH, functional data loss)

`rebuildSemanticIndex` deletes the sidecar and clears the in-memory maps BEFORE confirming the re-embed can run, then fire-and-forgets the embed with no way to report failure.

```
src/app/AppShell.tsx:1863-1868
      bumpEmbedJobGeneration();
      await deleteVectorIndexFile(id);
      docSemanticByIdRef.current.delete(id);
      docEmbedHashesByIdRef.current.delete(id);
      docDenseReasonByIdRef.current.delete(id);
```
```
src/app/AppShell.tsx:1872-1873
      void scheduleBackgroundEmbed(entry);
      return true;
```

The scheduled embed silently returns in several environmental cases, each leaving the doc dense-less forever:
- embedder not downloaded:
```
src/app/AppShell.tsx:1484-1487
        if (!embedderDownloadedRef.current) {
          ...
            `[embed] skip: embedder missing {"docId":${JSON.stringify(entry.id)}}`,
```
- chat resident on ≤6GB RAM gate:
```
src/app/AppShell.tsx:1451-1453
      if (await mustSkipForRam()) {
        ...
        "[embed] skip: chat resident on ≤6GB RAM — BM25-only until chat released",
```
- read gate busy / txt-pdf extraction failure / job exception (all `console.log` + `return`).

After any skip there is NO sidecar (`deleteVectorIndexFile` already ran), NO in-memory index, and `ensureSemanticIndexLoaded` (read-only restore, AppShell.tsx:1264) cannot resurrect it. The only re-triggers are import (`AppShell.tsx:1197`) or another rebuild — i.e. the doc is silently downgraded hybrid→bm25_only, and `return true` tells the UI the operation succeeded. Unlike an import (which keeps the old sidecar on skip), rebuild is destructive even when the re-embed cannot happen. Map B5-SEMANTIC-INDEX §BUG 8 already records "no on-demand re-embed"; rebuild is the first user-facing action that makes this permanent. Fix: verify `embedderDownloadedRef` / RAM gate BEFORE deleting, or embed to a fresh working index and swap only on success.

### 2. Rebuild offered on unreadable/unextractable docs → guaranteed destroy + no-op — CONFIRMED (Medium)

The rebuild button is not gated on `isUnreadable(doc)`; it renders for any doc including extraction-failed PDFs.

```
src/screens/documents/DocumentDetailView.tsx:225-227
        <Pressable
          onPress={() => void handleRebuild()}
          disabled={!!busy || rebuilding}
```
```
src/screens/documents/DocumentDetailView.tsx:203-205
          {isUnreadable(doc) ? (
            <Text ...>
              {t("documents.errorPdf")}
```
For a doc with `extractionStatus: "timeout"|"renderer_error"|"fs_error"`, `requestPdfText` fails inside the embed job (AppShell.tsx:1520-1550, `[embed] skip: pdf extract failed`), so the rebuild deletes any existing sidecar and re-embeds nothing. Amplifies Finding 1 for a specifically doomed input.

### 3. No completion/failure feedback; `true` means "scheduled", not "embedded" — CONFIRMED (Medium, UX)

`handleRebuild` only reacts to `accepted === false`; an accepted rebuild gives zero indication of the actual embed outcome (which is `console.log`-only) and the button re-enables while the embed runs for potentially minutes.

```
src/screens/documents/DocumentDetailView.tsx:63-73
  const handleRebuild = async () => {
    if (busy || rebuilding) return;
    setRebuilding(true);
    try {
      const accepted = await onRebuildSemanticIndex(doc.id);
      if (!accepted) {
        Alert.alert(t("documents.title"), t("documents.errorBusy"));
      }
    } finally {
      setRebuilding(false);
    }
  };
```
No success toast, no in-progress indicator beyond the brief `rebuilding` flip (returns as soon as the embed is scheduled, AppShell.tsx:1872-1873). Map B5-EMBED-SERVICE §7 "Chunk-level progress" lists this as a known gap; rebuild makes it user-facing.

### 4. Re-click during in-flight embed yields a misleading "busy" alert — PLAUSIBLE (UX nit)

After an accepted rebuild the button is not disabled while the embed runs (busy/rebuilding don't include `embedJobInFlightRef`), so a second tap hits `AppShell.tsx:1855`:
```
      if (embedJobInFlightRef.current || !tryAcquireDelete()) return false;
```
and surfaces `errorBusy` — "Something is already in progress. Try again in a moment." (en.ts:205, it.ts:204) — when the "something in progress" is the user's own rebuild. Harmless, mildly confusing.

### 5. Zero direct test coverage of the shipped feature — CONFIRMED (coverage gap)

All 15 tests (re-ran: 3 suites, 15 passed) exercise pre-existing modules — `semanticIndex` (7), `embeddingPure` (4), `documentChatTool` executor (4). The only new production logic (Option D's AppShell `rebuildSemanticIndex` + DocumentDetailView wiring) has no test at all: no coverage of gate refusal, sidecar deletion, map clearing, or the destroy-then-skip regression in Finding 1. Impl-report verification ("3 requested suites, 15 tests EXIT 0") validates only pre-existing code. Consistent with B5-SCOPE-MVP-MAP §3 (tests scoped to the 3 modules), but the report's framing overstates verification of what was shipped.

### 6. Hybrid test is shallow — PLAUSIBLE (false-confidence risk)

`documentChatTool.test.ts:118-142` asserts `strategy === "hybrid"`, `denseUnavailableReason === null`, and chunk presence, but never asserts RRF ordering or that the BM25 arm contributed a rank — a dense-arm-always-wins fusion bug would pass. The test also bypasses the real `tryAcquireRead` single-flight path (executor-level only). No test asserts the busy latch despite the map (B5-SEMANTIC-INDEX §5) listing "single-flight gate" as intended coverage.

### 7. Stale `busy` prop (module latch not reactive) — PLAUSIBLE (nit)

```
src/screens/DocumentsScreen.tsx:580
          busy={importing || isDocumentDeleteInFlight() || isDocumentOpInFlight()}
```
`isDocumentOpInFlight()` reads `docOpGate` module state (`documentChatTool.ts:298-300`), which never triggers a React re-render; the disabled state is only as fresh as the last render. Correctness is still guaranteed downstream (refused rebuild → alert), so this is cosmetic.

### 8. Gate/latch correctness — CONFIRMED (verified safe)

- `tryAcquireDelete` + `finally releaseDelete` is correct in every path: empty id returns before acquiring (AppShell.tsx:1854-1855); missing doc returns inside `try` and the `finally` releases (1858→1869); no double release, no leak.
- Overlapping rebuilds cannot corrupt: DELETE latch is single-slot (`docOpGate.ts:37-39`); second rebuild returns false.
- `releaseDelete()` (1869) → `scheduleBackgroundEmbed(entry)` (1872) is one synchronous frame; the embed's `tryAcquireRead()` (1432) runs before its first await, so no delete/chat can interleave between release and READ acquisition. No race here.
- Cross-op safety (rebuild vs delete vs chat vs embed) all flows through the shared gate; ownership re-checks in the embed loop (AppShell.tsx:1753-1763) cover the rest.

### 9. Security: path traversal via docId — REFUTED (verified safe)

`vectorIndexPath` sanitizes to `[A-Za-z0-9._-]` only:
```
src/documents/documentStorage.ts:263
  const safe = docId.replace(/[^A-Za-z0-9._-]/g, "_");
```
`deleteOwnedFile` refuses any non-owned URI (ownership check):
```
src/documents/documentStorage.ts:238-248
export async function deleteOwnedFile(fileUri: string | undefined): Promise<void> {
  if (!fileUri || typeof fileUri !== "string") return;
  ...
  if (!isOwnedDocumentUri(fileUri, root)) return;
```
And `rebuildSemanticIndex` only acts on ids that exactly match an existing library doc (`AppShell.tsx:1857-1858`); doc ids are app-generated (`nextDocId`, DocumentsScreen.tsx:123-125). Foreign/missing id → `if (!entry) return false`. No traversal path. `deleteVectorIndexFile` itself never throws (wrapped, documentStorage.ts:369-379), so the missing try/catch in `handleRebuild` (DocumentDetailView.tsx:63-73) is unreachable-in-practice.

### 10. Privacy: no content logging — CONFIRMED (verified safe)

Rebuild logs nothing; the embed job logs only `docId`/`chunkId` metadata, never document text (`AppShell.tsx:1368-1370, 1603, 1650-1652`). No content egress introduced.

### 11. i18n parity en/it — CONFIRMED (verified)

`rebuildIndex` + `rebuildIndexHint` present in both: en.ts:217-218, it.ts:216-217. `errorBusy` used by the rebuild refusal path pre-exists in both (en.ts:205, it.ts:204). Keys match exactly; no drift.

### 12. Wiring — CONFIRMED (fully plumbed, no half-wire)

`onRebuildSemanticIndex` is a REQUIRED prop in both `DocumentsScreen` (DocumentsScreen.tsx:96) and `DocumentDetailView` (DocumentDetailView.tsx:36), passed through AppShell (AppShell.tsx:5425) → DocumentsScreen (DocumentsScreen.tsx:578) → DocumentDetailView. Single consumer of each; `npm run typecheck` EXIT 0 per impl report. No optional fallback.

### 13. Test hygiene — CONFIRMED (good)

`__resetDocumentChatBusyForTests` called in both `beforeEach` and `afterEach` (`documentChatTool.test.ts:52-57`), which also resets the shared docOpGate via `__resetDocOpGateForTests`. No `jest.mock` globals leaked (host objects built inline), no env mutation, no snapshots, pure modules otherwise. The abort test deterministically registers the listener synchronously before `await Promise.resolve()` + `controller.abort()`.

---

## Must-fix
1. **Destroy-before-verify** (Finding 1) — verify embedder/RAM/readiness before deleting the sidecar, or embed-then-swap. Highest impact: silent permanent hybrid→bm25_only downgrade with `return true`.
2. **Gate the rebuild button / path on unreadable docs** (Finding 2) — or at least don't delete a sidecar when re-extraction is known-failed.

## Nits
3. No completion/success feedback for rebuild (Finding 3).
4. Misleading `errorBusy` on re-click during own in-flight embed (Finding 4).
5. No direct tests for the new `rebuildSemanticIndex` path (Finding 5).
6. Shallow hybrid test — add an RRF-ordering assertion and a busy-latch test (Finding 6).
7. Stale `busy` prop from non-reactive module latch (Finding 7).

## Verified-safe (no action)
- Gate/latch correctness incl. releaseDelete→schedule frame (Finding 8).
- Path traversal REFUTED (Finding 9); privacy REFUTED (Finding 10).
- i18n parity (Finding 11); full wiring (Finding 12); test hygiene (Finding 13).
