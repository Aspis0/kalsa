# Model-Switch After 3s Bounded Stop/Discard — Recon Report

**Date:** 2026-09-10  
**Repo:** `kalsa` at `origin/main` `c370c982fe3e7f136a180f69d52de5b2390d385a`  
**Status:** LOW open item from PLAN §13 / ALIVE §10  
**Constraint:** Read-only recon, no edits, no device claims.

---

## 1. What handleStop does (the 3-second watchdog)

`src/screens/AiChatPage.tsx:2909–2971`:

```typescript
const handleStop = useCallback(() => {
    abortRef.current?.abort();                        // ← L2910: synchronous abort
    if (stopWatchdogRef.current != null) {            // ← L2914: clear prior watchdog
      clearTimeout(stopWatchdogRef.current);
      stopWatchdogRef.current = null;
    }
    const runIdAtStop = sendRunIdRef.current;
    stopWatchdogRef.current = setTimeout(() => {      // ← L2919: 3s timer
      stopWatchdogRef.current = null;
      if (!mountedRef.current) return;
      if (!sendingRef.current || sendRunIdRef.current !== runIdAtStop) return;
      // 1) Invalidate first — bump runId + generation before clearing locks
      sendRunIdRef.current += 1;
      regenGenerationRef.current += 1;
      const ownedRunId = sendRunIdRef.current;
      // 2) Mark streaming assistants interrupted + persist
      setMessages((prev) => { /* mark interrupted, persist */ });
      // 3) Unlock composer only if we still own the generation token
      if (sendRunIdRef.current === ownedRunId) {
        sendingRef.current = false;                    // ← L2962
        sendingInFlightRef.current = false;            // ← L2963
        sendClaimRef.current = false;                  // ← L2964
        regenInFlightRef.current = false;              // ← L2967
        regenHandleSendPassRef.current = false;
        setSending(false);
      }
    }, 3000);                                         // ← L2971: exactly 3 s
}, []);
```

**Key invariant:** the 3s watchdog is a recovery path for when native completion never settles after `abortRef.current?.abort()`. It clears `sendClaimRef` (the pre-await claim that blocks `selectModelById`). All three flags — `sendingRef`, `sendingInFlightRef`, `sendClaimRef` — are cleared in the same synchronous callback.

---

## 2. What selectModelById does with the deferred queue

`src/app/AppShell.tsx:3999–4030`:

```typescript
const selectModelById = useCallback(
    (modelId: string) => {
      // While a send holds the pre-await claim, queue the switch (last-wins)
      if (deferModelSwitchIfSendClaimed(modelId)) {   // ← L4004
        if (!modelSwitchDrainInFlightRef.current) {
          modelSwitchDrainInFlightRef.current = true;
          void (async () => {
            try {
              const t0 = Date.now();
              while (sendClaimRef.current && Date.now() - t0 < 5000) {  // ← L4012
                await new Promise((r) => setTimeout(r, 50));
              }
              if (sendClaimRef.current) {              // ← L4016: 5s timeout
                drainPendingModelSwitch();
                return;
              }
              const pendingId = drainPendingModelSwitch();
              if (!pendingId) return;
              selectModelById(pendingId);              // ← L4022: re-enter
            } finally {
              modelSwitchDrainInFlightRef.current = false;
            }
          })();
        }
        return;
      }
      // ...
      if (regenInFlightRef.current) {                  // ← L4040: check regen
        Alert.alert(t("chat.regenBusy"), t("chat.regenBusy"));
        return;
      }
      if (streamInFlightRef.current) {                 // ← L4045: check streaming
        // confirmation dialog
        return;
      }
      selectModel(nextIndex);
    },
```

**Critical omission:** after the deferred drain succeeds and calls `selectModelById(pendingId)`, the re-entered call checks `regenInFlightRef` and `streamInFlightRef` but does **not** check `sendingInFlightRef`. The flag may still be `true` at this point — either because the native completion hasn't arrived yet, or because the watchdog hasn't fired. This is a code defect (see §4).

---

## 3. What selectModel does (engine teardown)

`src/app/AppShell.tsx:3920–4000`:

```typescript
const selectModel = useCallback(
    (nextIndex: number) => {
      if (modelSwitchInFlightRef.current) return;       // ← L3925
      // ...
      modelSwitchInFlightRef.current = true;             // ← L3937
      engineGenerationRef.current += 1;
      const releasedGen = chatGateGenRef.current;
      chatGateGenRef.current = null;

      void (async () => {
        // Wait for memory extraction (3s bounded)
        if (memoryExtractRef.current) {
          await Promise.race([
            memoryExtractRef.current,
            new Promise<void>((resolve) => setTimeout(resolve, 3000)),
          ]);
          memoryExtractRef.current = null;
        }
        // Save session if engine ready and NOT sending
        if (isEngineReady() && !sendingInFlightRef.current) {  // ← L3962
          const modelId = getActiveModelId();
          if (modelId) {
            const msgs = await readBootMessages();
            await saveEngineSession(modelId, ...);        // ← L3968
          }
        }
        // Dispose via runNativeOp (SERIAL — queued behind any pending native op)
        await runNativeOp(() => disposeEngine());          // ← L3980
      })();
    },
```

**Key: `runNativeOp` is an unbounded FIFO mutex.** `src/engine/llamaContextGate.ts:344–370`:

```typescript
export function runNativeOp<T>(fn: () => Promise<T>): Promise<T> {
  const gen = nativeOpGeneration;
  nativeOpPendingCount += 1;
  const run = nativeOpChain.then(           // ← queued behind the chain head
    () => executeNativeOp(gen, fn),
    () => executeNativeOp(gen, fn),
  );
  nativeOpChain = run.then(() => undefined, () => undefined);
  // ...
}
```

**A hung op HOLDS the chain forever** (L315 comment: `busy stays true and pending stays >0; callers must not clear the chain`). If the old native completion never arrives, `disposeEngine` sits in the FIFO behind it forever.

`runNativeOpBounded` exists (`llamaContextGate.ts:433–487`) and refuses to enqueue when the chain is non-empty past a deadline. It is the correct mechanism for a bounded model-switch dispose, but `selectModel` does not use it.

---

## 4. The defect: what happens on each scenario

### Scenario A: Model switch lands AFTER handleStop's 3s watchdog fires

**Timeline:**
- `t=0`: user taps Stop. `abortRef.abort()`. 3s watchdog starts.
- `t=3.000`: watchdog fires. Synchronous: `sendClaimRef=false`, `sendingRef=false`, `sendingInFlightRef=false`. `sendRunIdRef=N+1`, `regenGenerationRef=G+1`.
- `t=3.050`: drain loop wakes (50ms tick). `sendClaimRef.current === false` → proceeds. `drainPendingModelSwitch()` → returns modelId. Calls `selectModelById(modelId)`.
- `selectModelById` re-enters: `regenInFlightRef=false`, `streamInFlightRef=false` → proceeds to `selectModel(nextIndex)`.
- `selectModel` sets `modelSwitchInFlightRef=true`, starts async teardown.
- `selectModel` async: checks `sendingInFlightRef.current === false` → saves session (may read stale partial if native completion hasn't arrived).
- `selectModel` async: calls `runNativeOp(() => disposeEngine())`. **If old native completion never arrives, this blocks forever.** `modelSwitchInFlightRef` stays `true`. UI frozen at "checking".

**Consequence:** deterministic UI hang when: (a) abort doesn't cause native completion to settle, AND (b) user switches model after stop. Recovery: process kill. The 5s drain timeout is irrelevant — it applies to the drain loop, not to the `selectModel` async code that runs after the drain succeeds.

### Scenario B: Model switch lands DURING the 3s watchdog window

**Timeline:**
- `t=0`: user taps Stop. 3s watchdog starts. `sendClaimRef=true`.
- `t=1.0`: user opens Settings, picks new model. `selectModelById` → `deferModelSwitchIfSendClaimed` returns `true` (sendClaimRef held). ModelId queued.
- `t=3.000`: watchdog fires. Clears `sendClaimRef`.
- `t=3.050`: drain loop proceeds (same as Scenario A from here).

**Same defect applies.** The only difference is when the queue was populated.

### Scenario C: Model switch + background discard race

**Timeline:**
- `t=0`: user taps Stop. 3s watchdog starts.
- `t=3.000`: watchdog fires. All flags cleared.
- `t=3.005`: user backgrounds app. `discardBackground()` starts. `discardInFlightRef=true`. Calls `backgroundDiscardLifecycleRef.current` → `awaitLifecycleForBackgroundDiscard`.
- `t=3.050`: user foregrounds, opens Settings, picks model. `selectModelById` → `selectModel` starts async teardown.

Now two paths both call `runNativeOp(() => disposeEngine())`:
1. `selectModel` (from the model switch path)
2. `requestDeferredDispose` (from the background discard path, after the 5s lifecycle await + spin)

`discardInFlightRef` is NOT checked by `requestDeferredDispose` (L2863). It only checks `discard.finished || discard.disposeRequested`. So both disposals proceed through the `runNativeOp` FIFO. The second dispose is a no-op (engine already gone), but `markChatReleased` is called twice with potentially different generations — one from `selectModel`'s `releasedGen`, one from `requestDeferredDispose`'s `releasedGenBg`.

**Consequence:** double dispose is benign (second is a no-op), but double `markChatReleased` with different generation tokens can leave the chat gate in an inconsistent state. Low risk — `markChatReleased` is generation-guarded.

### Scenario D: Model switch DURING background discard (before lifecycle settles)

**Timeline:**
- `t=0`: app backgrounds. `discardBackground()` starts. `discardInFlightRef=true`. `backgroundDiscardLifecycleRef` set. Lifecycle spins up to 5s.
- `t=2.0`: user foregrounds, picks model. `discardInFlightRef=true` → **NOT checked** by `selectModelById` or `selectModel`. Model switch proceeds.
- `selectModel` async starts: saves session, calls `runNativeOp(disposeEngine)`.
- Meanwhile, `awaitLifecycleForBackgroundDiscard` is spinning (up to 5s). It sees `sendingRef.current` cleared by the model switch's synchronous generation bump. But the lifecycle is blocked on the `runNativeOp` chain.

**Consequence:** the background discard's lifecycle is blocked behind the model switch's dispose in the FIFO. After the dispose completes, the lifecycle finishes, then `requestDeferredDispose` tries a second dispose (no-op). Benign but wasteful.

---

## 5. Can a switch land on a torn-down engine, a stale abort, or a still-saving KV?

### Torn-down engine
**No.** `selectModel` checks `isEngineReady()` before save (L3962: `if (isEngineReady() && !sendingInFlightRef.current)`). If the engine was already torn down (e.g. by a background discard), the save is skipped. The `runNativeOp` dispose call is idempotent.

### Stale abort
**Yes, partially.** The old `abortRef` is captured in the `handleSend` closure. After `handleStop` aborts it, the old generation's finally block runs. The `sendRunId` gate (`sendRunIdRef.current === runId`) ensures the old finally doesn't clobber the new state. **This guard works correctly** — the watchdog bumps `sendRunIdRef` before clearing `sendingRef`, so the old finally sees a mismatch and no-ops.

### Still-saving KV
**Yes, possible.** When `selectModel` calls `saveEngineSession` (L3968), the old native completion may not have arrived yet. The session save reads messages from `readBootMessages()` (AsyncStorage), not from the engine directly — so the KV contents on disk may be stale (partial generation interrupted at abort). The next `restoreEngineSession` would load whatever was saved, which is the pre-send state. This is **correct behavior** — the interrupted generation is marked `interrupted: true` in the messages array, and the KV reflects the state before the aborted turn. The session save during model switch is a best-effort preservation, not a KV-flush.

---

## 6. Verdict: determinstic code defect

This is a **deterministic code defect**, not missing device evidence or accepted residual.

**Defect 1 — unbounded dispose in selectModel:** `src/app/AppShell.tsx:3980` calls `runNativeOp(() => disposeEngine())` without a timeout. When the old native completion never settles (the exact scenario the 3s watchdog recovers from), this blocks forever. `modelSwitchInFlightRef` stays `true`, blocking all subsequent model switches. The UI freezes in "checking" state.

**Defect 2 — missing sendingInFlightRef check in selectModelById re-entry:** `src/app/AppShell.tsx:4022` calls `selectModelById(pendingId)` after the drain loop, which proceeds to `selectModel` without checking `sendingInFlightRef`. This allows engine teardown to start while a native completion is still in flight.

**Defect 3 — no timeout on the 3s memory-extract wait inside selectModel:** `src/app/AppShell.tsx:3955–3960` races `memoryExtractRef.current` against a 3s timer, but this timer is not cleared if the watchdog fires or if the drain loop times out. This is minor — the timer fires harmlessly after the model switch, but it's a correctness debt.

---

## 7. Smallest code fix (justification, not implementation)

### Files to change
1. `src/app/AppShell.tsx` — `selectModel` async code
2. `src/screens/AiChatPage.tsx` — `handleStop` watchdog (optional hardening)

### Invariant to enforce

**`selectModel`'s dispose must be bounded.** When the native-op chain is non-empty, `runNativeOp(disposeEngine)` must not block forever. Use `runNativeOpBounded` (already exists in `llamaContextGate.ts:433`) with a timeout of ~5 seconds. On timeout:
- Log the refusal (`console.warn`).
- Clear `modelSwitchInFlightRef` in the `finally` block (already there, but ensure the timeout path reaches it).
- Set `modelState` to an error state so the UI is not permanently stuck.
- Optionally invalidate the engine session for the old model so a fresh load happens on next send.

**Concrete change in `selectModel` async block:**

Replace:
```typescript
await runNativeOp(() => disposeEngine());
```

With:
```typescript
const disposeResult = await runNativeOpBounded(
  () => disposeEngine(),
  5000,
);
if (!disposeResult.ok) {
  console.warn("[kalsa] model switch dispose timed out — native-op chain hung");
  // The engine is still resident but we cannot dispose it.
  // Mark the model as error so the UI is not stuck at "checking".
  setModelError("chat.disposeTimeout");
  setModelErrorDetail("Native completion did not settle; restart to recover");
}
```

**Secondary fix — guard `selectModelById` re-entry:**

In `selectModelById`'s drain callback (L4016–4022), add:
```typescript
// After drain succeeds, also verify sending state cleared
if (sendingInFlightRef.current) {
  // Native completion may still be in flight. Queue for later.
  pendingModelSwitchQueue.push(pendingId);
  return;
}
```

This prevents the re-entry from starting teardown while a native completion is pending.

---

## 8. Can a one-shot device procedure close this?

**No.** This is a code-level race condition. The fix requires:
1. Changing `runNativeOp` → `runNativeOpBounded` in `selectModel`.
2. Adding a `sendingInFlightRef` guard in the drain re-entry.

A device procedure can only **reproduce** the defect (stop → switch model on a slow/stalled native completion), not close it. The procedure would be:

1. Install CI APK on S23.
2. Send a message, wait for partial generation (visible tokens appearing).
3. Tap Stop.
4. Immediately (within 3s) open Settings → pick a different model.
5. Observe: if the native completion doesn't settle (model under memory pressure or thermal throttle), the UI freezes at "checking".

This is a **reproduction step**, not a closure. The closure is the code fix.

---

## 9. Summary

| Question | Answer |
|---|---|
| Can a switch land on a torn-down engine? | No — `isEngineReady()` guard in selectModel |
| Can a switch land on a stale abort? | No — `sendRunId` gate in old finally blocks clobbering |
| Can a switch land on a still-saving KV? | Partially — session save reads AsyncStorage, not engine KV directly; stale save is correct behavior for interrupted turns |
| Is this a deterministic code defect? | **Yes** — unbounded `runNativeOp(disposeEngine)` + missing `sendingInFlightRef` check in drain re-entry |
| Is this missing device evidence? | No — the defect is traceable in code without a device |
| Is this an accepted LOW residual? | No — it has a deterministic hang path and a bounded fix exists (`runNativeOpBounded`) |
