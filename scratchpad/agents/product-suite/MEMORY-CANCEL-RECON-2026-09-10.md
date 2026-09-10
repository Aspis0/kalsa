# MEMORY-CANCEL-RECON — 2026-09-10 (corrected)

**Base**: main at commit `095466e`
**Scope**: stop/clearChat during memory extraction — §3/§8 from ALIVE 10/09
**Previous**: ALIVE line 4106 — "Resta aperto (pre-esistente): stop/clearChat non annullano un'estrazione in corso"
**Reviewer**: autonomous recon (read-only, code not modified)
**Status**: Corrected historical recon: §5 of the FIX report identifies the refuted claims; the forwarding fix is pushed as app commit `f99fe4506a3072c6d18b625bdaca815615bf7421`.

---

## 1. Corrected architecture — two distinct AbortControllers

The extract job uses **two separate AbortControllers** with **two distinct signals**:

| Controller | Created at | Signal passed to | Aborted by |
|---|---|---|---|
| **Outer** (send's) | AiChatPage pre-send | `armMemoryExtract` closure (`signal` param) | `abortRef.current?.abort()` — `clearChat`, `handleStop`, new send |
| **Inner** (extraction's) | AppShell.tsx:4897 | `extractMemory(..., extractionAbortController.signal)` | `cancelExtractionForSend()` — **new send only** |

Critical: `onAbortRelease` (AppShell.tsx:4913) only calls `releaseSaveGate?.()`. It does **NOT** call `extractionAbortController.abort()`. The inner controller is never aborted by `clearChat` or `handleStop`.

---

## 2. What `clearChat` actually does to the extract

```
clearChat()                                     [AiChatPage.tsx:2985]
  abortRef.current?.abort()                     [line 2988]
    └─ outer signal fires "abort"
        └─ onAbortRelease()                     [AppShell.tsx:4913]
            └─ releaseSaveGate?.()              ← ONLY releases the gate
            └─ (does NOT call extractionAbortController.abort())
```

After the gate releases, the extract job (AppShell.tsx:4940-5000) wakes up:

```typescript
await saveGate;                                 // line 4940 — resolves
if (extractionCancelled) { return; }            // line 4946 — false (only set by cancelExtractionForSend)
if (signal.aborted || turnFailed) { return; }   // line 4948 — true → RETURNS EARLY
```

The extract job **exits early** — it does not call `extractMemory` and does not write facts. This part works.

**But**: `extractMemory` may already be running when `clearChat` fires (see §3 below). The inner controller is never aborted, so the native completion continues.

---

## 3. The real gap — `abortRef.current` ownership after send completes

### 3.1 Lifecycle of `abortRef.current`

| Phase | `abortRef.current` value |
|---|---|
| Pre-send (fit gate) | `new AbortController()` (preSendController) |
| During send | same controller — abortable |
| Send finally block | set to `null` at lines 2144/2150/2161/2199 |
| Extract running (after send) | **`null`** |

### 3.2 Concrete scenario

1. User sends message. `abortRef.current = controller_A`.
2. Send completes. Finally block runs. **`abortRef.current = null`**.
3. `afterSessionSave` fires → releases save gate → extract job starts.
4. Extract job calls `extractMemory(capturedUser, capturedAssistant, locale, extractionAbortController.signal)`.
5. `extractMemory` runs native completion (may take 5-30s).
6. **User taps "clearChat" or "stop"**.
7. `clearChat()` calls `abortRef.current?.abort()` — but **`abortRef.current` is `null`**.
8. **Nothing is aborted.** The native completion continues to run.
9. Eventually `extractMemory` finishes (or times out at `timeoutMs`).
10. Extract job processes result, calls `applyExtractResults` — **facts are written**.

### 3.3 Why the extract job still writes facts

After `extractMemory` completes (step 9), the extract job continues:

```typescript
extractResult = await extractMemory(...);        // completed — result has parsed facts
// ...
if (extractResult.stopReason !== "done") return; // "done" — does not return
if (extractResult.add.length === 0 ...) return;  // has facts — does not return
if (MemoryStore.getEpoch() !== startEpoch) return; // epoch unchanged — does not return
if (!(await MemoryStore.getEnabled())) return;   // enabled — does not return
// ← NO signal.aborted CHECK HERE
const applied = await MemoryStore.applyExtractResults(  // WRITES FACTS
  extractResult.add, extractResult.remove, startEpoch,
);
```

There is **no abort check** between the completion result and `applyExtractResults`. The `abortedBySend` flag inside `extractMemory` is irrelevant here — `extractMemory` returns a result object, and the extract job in AppShell processes it without checking any abort state.

---

## 4. Deterministic reproduction (local, no device)

The race is reachable when:
1. Extract is running (after send completed, `abortRef.current = null`)
2. `clearChat` or `handleStop` fires
3. Nothing is aborted — extract continues

To prove `abortRef.current` is null during extraction:
- Send completes → finally block runs → `abortRef.current = null` (AiChatPage.tsx:2144/2150/2161/2199)
- Extract starts after `afterSessionSave` (which fires after send's finally)
- Therefore `abortRef.current` is guaranteed `null` when extract runs

To prove `onAbortRelease` does not abort the inner controller:
- AppShell.tsx:4913-4915: `releaseSaveGate?.()` — no `extractionAbortController.abort()` call
- `extractionAbortController` is only aborted by `cancelExtractionForSend` (line 4899)
- `cancelExtractionForSend` is only stored in `memoryExtractCancelRef.current` (line 4907)
- `memoryExtractCancelRef.current?.()` is only called at line 5031 — **new send path only**

---

## 5. Impact

### 5.1 Engine occupied

The native completion runs to completion or timeout (5-120s). During this time:
- The engine is busy with the extract prompt
- No user chat can use the engine (serialized via `withEngineJob`)
- The KV snapshot is held (not yet restored)

### 5.2 Facts written after user intent to cancel

If the completion finishes before timeout, facts from the old conversation are written to the store. The user cleared the chat or stopped generation, but the extracted facts persist. This is the behavior flagged at ALIVE line 4106.

### 5.3 Not data corruption

The facts are from the correct user/assistant text (captured at send time). They are global, not conversation-specific. The写入 is semantically correct — but contradicts user intent to cancel.

---

## 6. Recommended fix — explicit extraction cancel path

The previous 2-line fix is insufficient: adding `extractionAbortController.abort()` to `onAbortRelease` has no effect in the main scenario because `onAbortRelease` is never called — `abortRef.current` is `null` during extraction, so `clearChat`'s `abortRef.current?.abort()` is a no-op, the outer signal never fires, and `onAbortRelease` is never triggered.

### 6.1 Required: dedicated extraction cancel callable from clear/stop

AppShell must expose a cancel function that `clearChat` and `handleStop` can call directly, independent of `abortRef`:

```
// AppShell — exposed ref or callback
const cancelActiveExtraction = () => {
  memoryExtractCancelRef.current?.();  // sets extractionCancelled, aborts inner controller, releases gate
};
```

`clearChat` (AiChatPage.tsx:2988) and `handleStop` (AiChatPage.tsx:2908) call `cancelActiveExtraction()` in addition to `abortRef.current?.abort()`. This covers the post-send case where `abortRef.current` is null.

### 6.2 Additional: forward outer signal to inner controller (in-flight send case)

When the send is still in flight and `clearChat`/`handleStop` fires, the outer signal does fire and `onAbortRelease` runs. In this case, `onAbortRelease` should also abort the inner controller so `extractMemory` receives the abort and calls `stopCompletion()`:

```typescript
const onAbortRelease = () => {
  if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
  releaseSaveGate?.();
  extractionAbortController.abort();  // forward abort to extractMemory's signal
};
```

This is effective only when the outer signal actually fires (send still in flight). For the post-send case (§6.1), it is a no-op — the outer signal never fires.

### 6.3 Guard before `applyExtractResults`

In the extract job (AppShell.tsx, after line 4974, before line 4976):

```typescript
if (signal.aborted || extractionCancelled) return;
```

This catches the case where cancellation arrives between completion resolution and the write. With fix 6.1, `extractionCancelled` is set by `cancelActiveExtraction`. Without fix 6.1, `signal.aborted` covers the in-flight-send case only.

### 6.4 Scope of cancellation

Cancel stops the native completion (via `stopCompletion` inside `extractMemory`'s `onAbort`). The extract job's finally block still runs and restores the KV checkpoint. The engine becomes available for the next send. Facts already committed to `MemoryStore` before cancellation are **not erased** — they are global and persist across conversations. Closing a chat does not delete memory; this is by design (facts are user-level, not conversation-level).

---

## 7. What is NOT a bug

- **`switchConversation` during extract**: `handleSwitchConversation` does not abort the send. The extract continues and writes facts. `restoreEngineSession` serializes via `withEngineJob` FIFO — runs after extract. Facts are global. **Correct behavior.**
- **New send during extract**: `cancelExtractionForSend` aborts the inner controller and the extract job waits for completion. **Correct behavior.**
- **`clearChat` before extract starts** (gate not yet released): `onAbortRelease` releases the gate, extract job checks `signal.aborted` → returns early. **Correct behavior.**

---

## 8. Limitations

1. **Static analysis only**: no device testing. The race is proven by code tracing, not by runtime observation.
2. **No device/build evidence in this recon**: it records the pre-fix trace against `095466e`. The forwarding fix was later implemented, audited, and pushed as app commit `f99fe4506a3072c6d18b625bdaca815615bf7421`; its final status is in the FIX and REAUDIT reports.
3. **ALIVE doc correction**: the known issue at ALIVE line 4106 is more nuanced than "stop/clearChat non annullano". The extract JOB exits early via `signal.aborted` check (correct for in-flight send), but: (a) after send completes, `abortRef.current` is null so clear/stop cannot reach the signal at all; (b) the inner controller is never aborted by clear/stop; (c) no guard exists between completion and `applyExtractResults`.
4. **Facts already committed are global**: cancelling extraction does not undo facts already written to `MemoryStore`. This is correct — closing a chat is not the same as deleting memory. The fix prevents new facts from being written after cancellation; it does not retroactively remove facts from prior successful extractions.
