# AUDIT-E8C8886-2026-09-13 — luna FIX apply

**Parent:** e8c8886 `fix(engine): do not wipe or idle-unload live chat KV` (parent-verified)
**Writer:** grok-4.6 (OWNER Skilled Coder, auto_accept)
**Date:** 2026-09-13
**Scope:** two P1s only. Hybrid pos_max out of scope. No phones. No push. G2 not claimed.

---

## P1-1 Wipe job recheck

### Race (quoted)

Init assigns `context` (so `isEngineReady()` is true) before restore marks chat KV held:

> `LlamaService.ts` L1764:
> ```
>         context = result.value;
> ```

> `LlamaService.ts` L2740:
> ```
>     kvHoldsChatSession = true;
> ```

`notifyStaticPrefixInputs` planner reads `kvHoldsChatSession` at queue time. `wipe_and_queue` then ran `clearCache` later with no re-read.

### Before (e8c8886)

> ```
>       case "wipe_and_queue":
>         resetPrewarmState();
>         void withEngineJob(async () => {
>           if (!context || disposing) return;
>           try {
>             await context.clearCache();
>           } catch {
>             // best-effort; the following prewarm still evals the new prefix
>           }
>           markChatKvCleared();
>         });
>         void queueStaticPrefixPrewarm(locale, tools, toolChoiceMode);
>         return;
> ```

### After

> `LlamaService.ts` L954–971:
> ```
>       case "wipe_and_queue":
>         resetPrewarmState();
>         void withEngineJob(async () => {
>           if (!context || disposing) return;
>           // Init assigns context before tryLoadEngineSession sets the hold.
>           if (!shouldApplyQueuedPrefixWipe(kvHoldsChatSession)) {
>             logPrewarm({ op: "skip", reason: "kv_holds_chat" });
>             return;
>           }
>           try {
>             await context.clearCache();
>           } catch {
>             // best-effort; the following prewarm still evals the new prefix
>           }
>           markChatKvCleared();
>           void queueStaticPrefixPrewarm(locale, tools, toolChoiceMode);
>         });
>         return;
> ```

`queueStaticPrefixPrewarm` moved **inside** the job, after a successful wipe. A skip return must not still prewarm over held KV (the already-queued prewarm would `seq_rm` the chat tail). Same FIFO: wipe job then prewarm job. No deadlock: inner `withEngineJob` appends after the current job.

### Helper — no duplicated boolean

> `prefixPrewarm.ts` L140–165:
> ```
> export function shouldSkipPrewarmWhenKvHoldsChat(
>   kvHoldsChatSession: boolean,
> ): boolean {
>   return kvHoldsChatSession === true;
> }
>
> export function shouldWipeKvOnPrefixInputChange(
>   kvHoldsChatSession: boolean,
> ): boolean {
>   return !shouldSkipPrewarmWhenKvHoldsChat(kvHoldsChatSession);
> }
>
> export function shouldApplyQueuedPrefixWipe(kvHoldsNow: boolean): boolean {
>   return shouldWipeKvOnPrefixInputChange(kvHoldsNow);
> }
> ```

Single inversion (`shouldWipeKvOnPrefixInputChange`). Queued recheck folds through it. Planner still uses `shouldWipeKvOnPrefixInputChange`. Holds → no wipe.

---

## P1-2 Idle includes lifecycle native work

### Before (e8c8886)

> ```
> export function nativeEngineWorkInFlight(): boolean {
>   return activeCompletionSet.size > 0 || engineJobPendingCount > 0;
> }
> ```

`isNativeOpChainEmpty` was already exported:

> `llamaContextGate.ts` L405–407:
> ```
> export function isNativeOpChainEmpty(): boolean {
>   return nativeOpPendingCount === 0;
> }
> ```

AppShell `engineWorkInFlight` omitted `modelSwitchInFlightRef`. The two 5s waits omitted `nativeEngineWorkInFlight()`.

### After

> `LlamaService.ts` L687–694:
> ```
> /** Native completion, FIFO engine job, or lifecycle native-op still running. */
> export function nativeEngineWorkInFlight(): boolean {
>   return (
>     activeCompletionSet.size > 0 ||
>     engineJobPendingCount > 0 ||
>     !isNativeOpChainEmpty()
>   );
> }
> ```

`engineJobPendingCount` declaration left where it was (L708). TDZ was REFUTED: the function body is not evaluated at module init.

> `AppShell.tsx` L3095–3102 (`engineWorkInFlight`):
> ```
>     const engineWorkInFlight = () =>
>       streamInFlightRef.current ||
>       sendingInFlightRef.current ||
>       regenInFlightRef.current ||
>       sendClaimRef.current ||
>       downloadInFlight.current ||
>       modelSwitchInFlightRef.current ||
>       nativeEngineWorkInFlight();
> ```

> `AppShell.tsx` L3041–3048 (background discard 5s wait):
> ```
>           while (
>             (streamInFlightRef.current ||
>               sendingInFlightRef.current ||
>               regenInFlightRef.current ||
>               sendClaimRef.current ||
>               nativeEngineWorkInFlight()) &&
>             Date.now() - t0 < 5000
>           ) {
> ```

> `AppShell.tsx` L3479–3486 (thermal 5s wait):
> ```
>         while (
>           (streamInFlightRef.current ||
>             sendingInFlightRef.current ||
>             regenInFlightRef.current ||
>             sendClaimRef.current ||
>             nativeEngineWorkInFlight()) &&
>           Date.now() - startedAt < 5000
>         ) {
> ```

---

## Tests (targeted; no full Jest)

```
node scripts/prefixPrewarmHarness.mjs > /tmp/prefixPrewarmHarness.log 2>&1; echo $?
→ 0
prefixPrewarmHarness OK

npx jest src/engine/prefixPrewarm.test.ts src/engine/llamaContextGate.test.ts --no-coverage > /tmp/p1-targeted-jest.log 2>&1; echo $?
→ 0
PASS  src/engine/llamaContextGate.test.ts
PASS  src/engine/prefixPrewarm.test.ts
Test Suites: 2 passed, 2 total
Tests:       14 passed, 14 total
```

Harness asserts `shouldApplyQueuedPrefixWipe(true) === false` (holds → no wipe) and identity with `shouldWipeKvOnPrefixInputChange` / inverted `shouldSkipPrewarmWhenKvHoldsChat`.

---

## Not claimed

- No device proof (S23 t4 wipe / S23 20t idle unload not re-measured).
- G2 not claimed.
- Hybrid `pos_max` not touched.
- No phones, no push.
