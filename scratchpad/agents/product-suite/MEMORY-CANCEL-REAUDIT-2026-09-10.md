# MEMORY-CANCEL-REAUDIT — 2026-09-10

**Base**: app fix commit `f99fe4506a3072c6d18b625bdaca815615bf7421` on pushed app `origin/main`
**Coder**: Skilled98c66 (extraction cancel fix)
**Scope**: reaudit of MEMORY-CANCEL-RECON-2026-09-10 gap
**Previous recon**: MEMORY-CANCEL-RECON-2026-09-10.md (corrected version)
**Reviewer**: MiMo — SHIP by code-review approval (read-only, code not modified)

---

## Verdict: **SHIP**

The bug is fixed. `createExtractAbort` forwards the turn signal to the inner controller, so `clearChat`/conversation switch/background discard/unmount abort the native completion; new-send behavior is unchanged, and `handleStop` does not overlap extraction. The recon's §3 claim (`abortRef.current` is null during extraction) is refuted by the code trace — the controller stays alive on the success path. All local gates pass (coder-reported): Jest 644/644, sessionMeta 50/0, saveGate 46/0, extractAbort 12/12, and tsc clean. Model-switch 3s race is measured open, unchanged, severity LOW.

Automatic E2E run `34526920272` has `Typecheck + logic harnesses` **SUCCESS** while the full run remains in progress in APK build; CI has not fully passed. The local gates above are not CI results, and no device verification or APK claim is made here.

---

## 1. Bug fix verified

### 1.1 The gap

Pre-fix, `onAbortRelease` (AppShell.tsx:4913) only called `releaseSaveGate?.()`. The inner `extractionAbortController` was never aborted by `clearChat`/`handleStop`. `extractMemory` listened on the inner signal — the native completion ran to completion or timeout.

### 1.2 The fix

`createExtractAbort` (src/memory/extractAbort.ts) creates an inner `AbortController` and forwards the outer (turn) signal to it. When the outer signal fires, `cancel()` runs: sets `cancelled = true`, calls `onCancel` (gate release), then `controller.abort()`. The inner signal is what `extractMemory` receives — `onAbort` fires → `stopCompletion()` → native completion stops.

**Verified**: the "REGRESSION" test (extractAbort.test.ts:38-48) proves outer abort reaches the inner signal. The "CONTROL" test (lines 50-60) proves the pre-fix wiring did NOT reach it.

---

## 2. Recon corrections verified

### 2.1 `abortRef.current` ownership — recon §3 was WRONG

Recon claimed: "after send completes, `abortRef.current` is null; clearChat abort on null → no-op."

**Refuted**. All `abortRef.current = null` assignments (AiChatPage.tsx:2144/2150/2161/2199/2352) are inside pre-send refusal paths:
- `:2144` — `!stillThisRun(myGen)` during fit gate
- `:2150` — `!fitGate.ok`
- `:2161` — `preSendController.signal.aborted` during fit gate
- `:2199` — `!stillThisRun(myGen)` after bench await
- `:2352` — `!stillThisRun(myGen)` before painting bubbles

None are on the success path. After a completed turn, `abortRef.current` still holds the turn's controller (set at `:2137`, reassigned same value at `:2391`). `clearChat`'s `abortRef.current?.abort()` DOES fire the turn signal.

**Verified by code trace**: `handleSend`'s finally block (line 2876) only clears `sendClaimRef`, never `abortRef`. The `handleSendTracked` finally (line 2882) only clears `sendInFlightPromiseRef`.

### 2.2 Conversation switch effect — recon §7 was WRONG

Recon claimed: "`handleSwitchConversation` does not abort the send."

**Refuted**. The effect at AiChatPage.tsx:1733-1735:
```typescript
useEffect(() => {
  const prev = lastAbortConvRef.current;
  lastAbortConvRef.current = conversationId;
  if (prev === conversationId) return;
  abortRef.current?.abort();  // ← fires turn signal on conversation change
```

When `handleSwitchConversation` changes `conversations.activeId`, the `conversationId` prop changes, this effect fires, and `abortRef.current?.abort()` runs. Since `abortRef.current` is alive (§2.1), the turn signal fires → `createExtractAbort` forwards to inner → extraction cancelled.

### 2.3 Model-switch 3s race — severity LOW (bounded stop + lost bookkeeping ref)

`selectModel` (AppShell.tsx:3942-3954) does NOT abort the turn signal. It waits up to 3s for `memoryExtractRef.current`, then sets the ref to `null` and proceeds to `disposeEngine`. The actual sequence:

1. `disposeEngine` → `withLifecycleLock` → `disposeEngineLocked`
2. `disposeEngineLocked` immediately captures `current = context`, sets `context = null`
3. Calls `current.stopCompletion()` — stops any active native completion
4. Awaits `engineJobChain` + `activeCompletionSet` before release

`extractMemory` captured `engine` (the context reference) at entry (LlamaService.ts:4146). When it runs after dispose:
- `engine !== context` (context is now null) → the finally block (LlamaService.ts:4265-4270) takes the else branch: sets `kvHoldsChatSession = false`, `lastChatNPast = undefined`, `chatKvDiskCurrent = false`
- `stopCompletion()` resolves the native promise, likely producing empty/no facts
- The job's `memoryExtractRef.current` was already cleared by `selectModel` — the ref is dropped while the job may still be settling

**Severity: LOW**. This is a bounded stop (engine disposed, completion halted) with lost bookkeeping ref (the cleared `memoryExtractRef` means a subsequent new send won't wait for this job to settle). No overlap corruption: `disposeEngineLocked` holds the lifecycle lock and awaits the engine job chain, so no new engine job can start until dispose completes. No data corruption: facts already committed to `MemoryStore` are untouched; the extraction either produced nothing (stopped) or produced facts before dispose (which are valid).

Correction (owner audit, 2026-09-10): phrase this as a **wait + lost ref / discarded work and state**, not as a completion running "into dispose". `disposeEngineLocked` captures `current = context`, sets `context = null`, calls `stopCompletion()` and awaits `engineJobChain`/`activeCompletionSet` before release; the extract `finally` then sees `engine !== context` and resets KV. No overlap between the release and a live completion is proven.

---

## 3. `createExtractAbort` semantics verified

| Property | Verification | File:Line |
|---|---|---|
| Idempotent cancel | `cancel()` called 3 times → `onCancel` once | test:30-37 |
| Already-aborted outer | cancels at creation → `onCancel` called | test:52-58 |
| No outer signal | only explicit `cancel()` fires | test:60-65 |
| `detach()` | later outer abort does not cancel | test:67-75 |
| `onCancel` throws | signal still aborted (finally block) | test:77-85 |
| Outer forwarding | outer abort → inner signal aborted + `onCancel` once | test:38-48 |
| Pre-fix control | gate released but inner NOT aborted | test:50-60 |
| Job: abort during gate | `nativeStarted:false`, never called | test:95-107 |
| Job: abort during native | `nativeStarted:true`, signal aborted mid-flight | test:109-121 |
| Job: new send | cancels immediately, gate released, outer untouched | test:123-133 |
| Job: no cancellation | native resolves `done` | test:135-143 |

All 12 tests pass. The `nativeCompletion` helper never resolves on its own — a passing test proves the abort reached the signal.

---

## 4. AppShell wiring verified

| Change | Correctness |
|---|---|
| `createExtractAbort({ outer: signal, onCancel: ... })` | `outer` is the turn signal. `onCancel` releases gate + sets source 3. |
| `memoryExtractCancelRef.current = extractAbort.cancel` | Stable identity for ref comparison in finally block. |
| `extractAbort.cancelled()` replaces `extractionCancelled` | Same semantics — boolean after cancel. |
| `extractAbort.signal` replaces `extractionAbortController.signal` | Same — the inner controller's signal. |
| `memoryExtractCancelRef.current === extractAbort.cancel` in finally | Identity check prevents clobbering a newer job's ref. |
| `extractAbort.detach()` replaces manual `removeEventListener` | Removes outer forwarding listener; guarded try/catch. |

**Gate source telemetry**: `onCancel` sets `extractGateSource = 3` (same as old `cancelExtractionForSend`). The `extractGateSource` variable is captured in the closure and reported in `emitSettledMemoryTelemetry`. No telemetry regression.

---

## 5. Behaviour change — conversation switch

Post-fix, conversation switch cancels an in-flight extraction (via the effect at AiChatPage.tsx:1735 → outer signal → `createExtractAbort` forwarding).

**Acceptable?** Yes. The alternative (switch does not cancel) would leave a completion running against a conversation that is no longer active, and more critically, would leave the engine occupied during session restore. The new-send path already cancels extraction — switch is consistent with that. Facts from the completed exchange are lost, but this is the same trade-off as new-send cancellation (accepted).

**Documented**: the fix report §5.1 explicitly flags this as a behaviour change. Correction (owner audit, 2026-09-10): it is **not** "required because engine dispose races otherwise" — there is no proven race between a release and a live completion. For background discard the real effect is narrower: the extract completion is aborted one step earlier than the disposal path, which would halt it anyway via `disposeEngineLocked` (`current = context` → `context = null` → `stopCompletion()` → await `engineJobChain`/`activeCompletionSet`), after which the extract `finally` sees `engine !== context` and resets KV. See `MEMORY-CANCEL-FIX-2026-09-10.md` §6.

---

## 6. Limits

1. **Static + unit evidence only**: no device run. The contract is code-traced and unit-tested, not instrumented on hardware.
2. **`handleStop` window**: only reachable while `sendingRef.current` is true. At that point, `armMemoryExtract` has not run (it arms at `onDone`). So `handleStop` never overlaps a live extraction — it hits the pre-arm early return (`extractStopReason 4`). This is unchanged by the fix.
3. **Post-completion fact write**: if the native completion resolves before the abort arrives (narrow window between `await extractMemory` return and `applyExtractResults`), facts are still written. This is deliberate — facts are global memory, `clearChat` must not drop them. No guard added.
4. **Model-switch 3s race**: unchanged, measured open (§2.3). Severity LOW.
5. **`memoryFactsTailHarness.mjs` 7 failures**: pre-existing, unrelated (`sanitizeFactForPrompt is not a function`). Not run by any CI workflow. Untouched by this diff.

---

## 7. Gate verification

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npx tsc --noEmit` | clean |
| Jest | `npx jest --runInBand` | 644 passed, 0 failed |
| extractAbort | `npx jest --runInBand src/memory/extractAbort.test.ts` | 12 passed, 0 failed |
| sessionMetaHarness | `node scripts/sessionMetaHarness.mjs` | 50 passed, 0 failed |
| sessionSaveGate | `node scripts/sessionSaveGateHarness.mjs` | 46 passed, 0 failed |
| New files not ignored | `git check-ignore` | exit 1 (not ignored) |

**CI/E2E status**: automatic E2E run `34526920272` has `Typecheck + logic harnesses` **SUCCESS** while the full run remains in progress in APK build; CI has not fully passed. The above are local gates. The `extractAbort.test.ts` is covered by `npx jest --runInBand` in both `ci.yml` and `bench.yml`.
