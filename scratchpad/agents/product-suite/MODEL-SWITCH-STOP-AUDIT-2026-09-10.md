# MODEL-SWITCH STOP AUDIT — 2026-09-10

**Uncommitted diff on c370c98.** Audited line-by-line.

---

## 1. STALE `t` CLOSURE IN `selectModel` — PLAUSIBLE (low severity)

```
// Line ~3962-4026
const selectModel = useCallback(
    (nextIndex: number) => {
      ...
      setModelError(t("errors.engineDisposeTimeout"));
      ...
    },
    [modelIndex, modelState],  // ← t is NOT here
  );
```

The async body calls `t("errors.engineDisposeTimeout")` but `t` is not a dependency. It is captured from the closure at the time `useCallback` last recreated (when `modelIndex` or `modelState` changed). If the locale changes between the time the callback was recreated and when the timeout fires ~5s later, `t` returns a stale translation.

**Why PLAUSIBLE not CONFIRMED:** Locale changes are extremely rare mid-session (app restart or explicit language switch). The `selectModelById` wrapper *does* correctly list `t` in its deps (`[selectModel, t]`), but `selectModel` itself does not. The stale `t` still produces a valid English string — it just may not match the current locale. Low severity but the inconsistency between `selectModel` (missing) and `selectModelById` (present) suggests this was unintentional.

---

## 2. SPLIT-BRAIN ON TIMEOUT — PLAUSIBLE (by design, but dangerous edge)

**The question:** Does timeout leave the old engine resident AND the chat gate released?

**Yes.** After `runNativeOpBounded` returns `{ ok: false }`:

```javascript
// Lines ~3994-4003
if (!disposeResult.ok) {
    console.warn(
      `[kalsa] model switch dispose timed out ...`
    );
    setModelState("error");
    setModelErrorKind("engine");
    setModelError(t("errors.engineDisposeTimeout"));
    setModelErrorDetail(null);
}
// finally block:
if (releasedGen !== null) markChatReleased(releasedGen);
modelSwitchInFlightRef.current = false;
```

After timeout:
- **Old engine:** still resident (`disposeEngine()` was never submitted to the FIFO)
- **Chat gate:** released (`markChatReleased` runs in `finally`)
- **modelSwitchInFlightRef:** cleared → user can trigger another switch
- **UI state:** "error" with "restart to recover"

**Is this a real split-brain?** The UI is in error state, so the user *cannot* successfully chat with the old engine (error banner prevents send). The user also cannot trigger a *new* switch immediately because `selectModel` only checks for `modelState === "downloading" || modelState === "loading"` — it does NOT check `modelState === "error"`. So the user **can** trigger another switch. If they do, `runNativeOpBounded` is called again for dispose. If the original hung op has since freed (e.g., handleStop watchdog kicked in), the chain is empty and the new dispose succeeds. **Recovery is possible without restart if the hang clears.**

The log message says "restart to recover" but the code path actually allows retry. **This is inconsistent** — the error message promises one thing, the code does another. Not a bug per se, but misleading.

**PLAUSIBLE** as a design gap, not a crash-level split-brain.

---

## 3. `setModelState("error")` RACE WITH NEWER SWITCH — REFUTED

**The concern:** Does the `setModelState("error")` inside the async block race a newer successful switch?

No. Here's the timeline:

1. `selectModel(B)` → synchronous: `modelSwitchInFlightRef = true`, starts async
2. Async runs `runNativeOpBounded`, times out at 5s → `setModelState("error")`
3. `finally` runs: `modelSwitchInFlightRef = false`, `markChatReleased(releasedGen)`
4. Event loop returns to synchronous code
5. User triggers `selectModel(C)` → synchronous: `modelSwitchInFlightRef = true` again, starts new async
6. New async: `runNativeOpBounded` — if the hung op has cleared, submits dispose, succeeds

Steps 2-3 run in the same microtask continuation (no `await` between `setModelState("error")` and `finally`). Step 5 can only execute after step 3 completes. **No race.**

The only theoretical concern: `setModelState("error")` and `modelSwitchInFlightRef = false` run on the same tick. Could React batch them? In React 18, `setTimeout` callbacks (the async `void (async () => { ... })()` path) are not automatically batched. But even if they were, the state update is `setModelState("error")` and the ref clear is `modelSwitchInFlightRef.current = false` — these don't interact dangerously.

**REFUTED.**

---

## 4. STALE `t` IN `selectModel` DEPS — PLAUSIBLE (same as #1)

Covered above. `selectModel` deps are `[modelIndex, modelState]`. The callback now calls `t()` in the timeout error path. `t` is not listed.

**PLAUSIBLE.** This is the same issue as finding #1 restated.

---

## 5. DRAIN: 5s WAIT THEN DROP VS. DISPOSE BOUNDED — PLAUSIBLE (user CAN get stuck)

**The question:** Can the user get stuck unable to switch?

```javascript
// Lines ~4035-4062
while (
    (sendClaimRef.current || sendingInFlightRef.current) &&
    Date.now() - t0 < 5000
) {
    await new Promise((r) => setTimeout(r, 50));
}
if (sendClaimRef.current || sendingInFlightRef.current) {
    drainPendingModelSwitch();  // ← DROP, no dispose attempted
    return;
}
```

After 5s: if the send is still in-flight, the pending model switch is **dropped**. No dispose is attempted. The user must manually retry.

**Can they get stuck?** If the send eventually completes (the native watchdog should fire within 3s), the user can retry. But:

1. User sends message → `sendClaimRef` set
2. User taps model switch → deferred, drain starts waiting
3. Send is slow/hung (watchdog fires at 3s, but native completion may lag)
4. Drain hits 5s → drops switch
5. User retries switch → send claim may still be set (if the lag persists past 5s from the second switch attempt)
6. Repeat → user keeps getting dropped

The `sendingInFlightRef` check was added in this diff specifically to catch the case where the watchdog clears the claim but the native completion hasn't settled. But the 5s drain timer starts from when `selectModelById` was called, not from when the send started. If the user delays the switch attempt, the send might have cleared by then.

**PLAUSIBLE** but requires a pathological timing window. The native watchdog (3s) should resolve most cases well within the 5s drain window. Recovery = wait a few seconds and try again.

---

## 6. TEST HYGIENE: HUNG PROMISE LEAK — REFUTED

```javascript
// Test: "refuses with timeout when the chain is hung"
void runNativeOp(() => new Promise<void>(() => undefined));
```

The never-resolving promise holds the chain. After the test, `afterEach` calls `__resetForTests()`:

```javascript
export function __resetForTests(): void {
  state = "idle";
  embedHeld = false;
  embedInitializing = false;
  embedInFlight = false;
  totalMemoryBytes = 0;
  chatModelIs2B = false;
  currentChatGeneration = 0;
  __resetNativeOpMutexForTests();
}
```

Which calls:
```javascript
export function __resetNativeOpMutexForTests(): void {
  nativeOpGeneration += 1;  // ← invalidates old chain handlers
  nativeOpBusyFlag = false;
  nativeOpPendingCount = 0;
  nativeOpChain = Promise.resolve();
}
```

The old chain's `.then()` handlers are still in memory but:
- `nativeOpPendingCount` is reset to 0 (no leak in the counter)
- The old handlers check `gen === nativeOpGeneration` → false after reset → no-ops
- `nativeOpChain` is overwritten → old chain graph becomes unreachable → GC-collectible

The `new Promise<void>(() => undefined)` keeps the Promise constructor alive until GC, but there are no timers, no I/O handles, no microtask enqueues. **No meaningful leak.** Jest will exit cleanly.

**REFUTED.**

---

## 7. MEMORY EXTRACT TIMER FIX — CONFIRMED (genuine improvement)

Before:
```javascript
// Old code — timer ID not captured
await Promise.race([
    memoryExtractRef.current,
    new Promise<void>((resolve) => setTimeout(resolve, 3000)),
]);
// Timer leaked if extraction won the race
```

After:
```javascript
let memoryExtractTimer: ReturnType<typeof setTimeout> | undefined;
try {
    await Promise.race([
        memoryExtractRef.current,
        new Promise<void>((resolve) => {
            memoryExtractTimer = setTimeout(resolve, 3000);
        }),
    ]);
} catch { /* ignore */ }
finally {
    if (memoryExtractTimer !== undefined) clearTimeout(memoryExtractTimer);
}
```

The timer ID is now captured and cleared in `finally`. Both paths are covered:
- Timer fires first → extraction continues (unawaited) → `finally` clears the (already-fired) timer (no-op, safe)
- Extraction wins → `finally` clears the pending timer (prevents the 3s callback from firing after cleanup)

**CONFIRMED** genuine fix for a real timer leak.

---

## 8. DEAD CODE — REFUTED

No dead code in the diff:
- `MODEL_SWITCH_DISPOSE_TIMEOUT_MS` is used exactly once (by `runNativeOpBounded`)
- `setModelErrorDetail(null)` after `setModelErrorKind("engine")` — clears prior detail, not dead
- `console.warn` in production — appropriate for a local on-device debug signal
- `memoryExtractTimer` variable — used in try/finally, not dead
- Test exports (`__resetForTests`, `isNativeOpChainEmpty`, `runNativeOp`, `runNativeOpBounded`) — all used in the test file

**REFUTED.**

---

## 9. SECURITY / SECRETS / PRIVACY — CLEAN

- No secrets, API keys, or tokens in the diff
- `console.warn` in production includes `nativeOpBusy()` — boolean, not PII
- i18n strings are user-facing error messages — no sensitive data
- No new network calls, no new storage writes

**CLEAN.**

---

## 10. EDGE CASES

### 10a. `runNativeOpBounded` with `pollIntervalMs=10` in test
The timeout test uses `runNativeOpBounded(async () => "never", 80, 10)` — 10ms poll interval. This is fine for tests but `runNativeOpBounded` in production uses the default 50ms. The production call uses `runNativeOpBounded(() => disposeEngine(), MODEL_SWITCH_DISPOSE_TIMEOUT_MS)` (default 50ms poll). No issue.

### 10b. `Date.now()` drift
`runNativeOpBounded` uses `Date.now()` for deadline calculation. If the system clock jumps (NTP sync, user change), the deadline could be wrong. Extremely unlikely on a phone. **PLAUSIBLE** but not actionable.

---

## ANSWERS TO REQUIRED QUESTIONS

| Question | Verdict |
|----------|---------|
| Does timeout leave old engine resident AND chat gate released (split-brain)? | **PLAUSIBLE.** Yes — both happen. Old engine stays resident, gate is released, UI shows error. But user can retry (inconsistent with "restart to recover" message). |
| Does `setModelState("error")` race a newer successful switch? | **REFUTED.** JS event loop guarantees the async block (including finally) completes before any new `selectModel` synchronous call. |
| `selectModel` deps still `[modelIndex, modelState]` but calls `t()` — stale i18n? | **PLAUSIBLE.** `t` is captured at `useCallback` creation time, not listed in deps. Stale if locale changes. |
| Drain: 5s wait then drop vs dispose — can user get stuck? | **PLAUSIBLE.** User can get repeatedly dropped if sends are slow. Recovery requires waiting for the send to fully settle before retrying. |

---

## VERDICT

**SHIP-WITH-FIXES.**

The core mechanism is sound — `runNativeOpBounded` correctly prevents the FIFO from hanging forever, the timer leak is fixed, the test is clean. But there are two real issues to fix before ship:

1. **Fix the stale `t` in `selectModel` deps:** Add `t` (or `locale` if `t` is derived) to the dependency array, or capture the error string synchronously before the async block.

2. **Fix the inconsistent error messaging on timeout:** Either (a) add a retry button in the error UI, or (b) check `modelState === "error"` in `selectModel` and refuse (matching the message), or (c) change the message from "restart to recover" to "tap to retry" if retry is actually supported.

The drain-stuck scenario is low severity but worth a comment or UX consideration.

---

## RE-AUDIT — 2026-09-10 (post-fix)

Both must-fixes from the original audit have been applied. Re-audit below.

---

### MUST-FIX 1: Stale `t` closure — RESOLVED, CONFIRMED

```
// AppShell.tsx:4023
    [modelIndex, modelState, t],
```

`selectModel` deps now include `t`. Verified this is the only `selectModel` callback in the file. `selectModelById` also lists `t` (line 4088: `[selectModel, t]`). Both callbacks are now consistent.

**Verdict: CONFIRMED** — fix is correct and complete.

---

### MUST-FIX 2: Inconsistent error messaging — RESOLVED, CONFIRMED

Quoted verbatim:

```
// src/i18n/en.ts:651-652
engineDisposeTimeout:
  "Could not unload the previous model. Retry the model switch.",
```

```
// src/i18n/it.ts:650-651
engineDisposeTimeout:
  "Impossibile scaricare il modello precedente. Riprova a cambiare modello.",
```

```
// src/app/AppShell.tsx:4000-4002
console.warn(
  `[kalsa] model switch dispose timed out after ${MODEL_SWITCH_DISPOSE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); previous model still resident — the switch can be retried`,
);
```

Three consistency checks:

1. **EN message says "Retry"** — not "Restart". Matches reality (retry IS allowed).
2. **IT message says "Riprova"** — same meaning. Matches EN.
3. **console.warn says "can be retried"** — consistent with user-facing message.
4. **Retry IS allowed** — `selectModel` refuse list (lines 3931-3936):
   ```
   if (
       downloadInFlight.current ||
       modelSwitchInFlightRef.current ||
       modelState === "downloading" ||
       modelState === "loading"
   ) {
       return;
   }
   ```
   `modelState === "error"` is NOT in the refuse list. User can retry. Message matches behavior.

**Verdict: CONFIRMED** — fix is correct. Message, code, and console.warn are all consistent.

---

### RE-AUDIT VERDICT

**SHIP.**

Both must-fixes are resolved. No new issues introduced. The original non-blocking findings (drain-stuck edge case, Date.now drift) remain unchanged and do not block.
