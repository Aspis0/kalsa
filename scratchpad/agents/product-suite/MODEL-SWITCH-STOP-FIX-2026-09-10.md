# Model-Switch After Bounded Stop — Fix Report

**Date:** 2026-09-10
**Repo:** `kalsa` at `origin/main` `c370c982fe3e7f136a180f69d52de5b2390d385a`
**Scope:** Bounded model-switch dispose after `handleStop`'s 3s watchdog; drain wait for both send claim and in-flight send; memory-extract timer cleanup.
**Status:** Implemented, targeted test + `tsc --noEmit` green. Not committed.

---

## 1. Confirmed defect (re-verified in this session)

`selectModel`'s async teardown called the **unbounded** FIFO:

```typescript
await runNativeOp(() => disposeEngine());   // AppShell.tsx:3985 (pre-fix)
```

`runNativeOp` is a serial FIFO mutex: a hung native completion holds the chain
forever (`llamaContextGate.ts:315` comment: *"A hung op HOLDS the chain — busy
stays true and new ops queue behind it"*). So if the abort in `handleStop` never
settles the native completion, `disposeEngine` queues behind it forever:
`modelSwitchInFlightRef` stays `true`, `modelState` stays `"checking"` (set
synchronously at `AppShell.tsx:3962`), and all later model switches are blocked.

`handleStop` itself documents this at `AiChatPage.tsx:2958–2960` (verified):

```typescript
      // Note: if native completion truly never settles, withEngineJob's FIFO may
      // still be wedged — UI unlock is intentional; a follow-up send may queue
      // until dispose/model-switch releases the hung job.
```

`runNativeOpBounded` already existed (`llamaContextGate.ts:433`) and `AppShell`
already imports it (`AppShell.tsx:95`). No third mutex was introduced.

---

## 2. Changes

### 2.1 Bounded dispose (`src/app/AppShell.tsx`)

Replaced the unbounded call with `runNativeOpBounded(..., 5_000)` and added a
deadline constant:

```typescript
const MODEL_SWITCH_DISPOSE_TIMEOUT_MS = 5_000;
```

On `{ ok: false, refused: "timeout" }` the recovery mirrors the existing
embedder-timeout path. Copied lines (`AppShell.tsx:3864–3872`, pre-fix):

```typescript
        setModelState("error");
        setModelErrorKind("engine");
        setModelError(t("embedding.busy"));
        setModelErrorDetail(null);
        console.warn(
          `[kalsa] runNativeOpBounded timed out after ${EMBEDDER_RELEASE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); chat init blocked — restart to recover`,
        );
```

The model-switch path uses the same shape but a model-specific message
(`errors.engineDisposeTimeout`, new key) so the banner is not misleading:

```typescript
          const disposeResult = await runNativeOpBounded(
            () => disposeEngine(),
            MODEL_SWITCH_DISPOSE_TIMEOUT_MS,
          );
          if (!disposeResult.ok) {
            console.warn(
              `[kalsa] model switch dispose timed out after ${MODEL_SWITCH_DISPOSE_TIMEOUT_MS}ms (nativeOpBusy=${nativeOpBusy()}); previous model still resident — the switch can be retried`,
            );
            setModelState("error");
            setModelErrorKind("engine");
            setModelError(t("errors.engineDisposeTimeout"));
            setModelErrorDetail(null);
          }
```

The existing `finally` still runs on both ok and timeout paths, so
`markChatReleased(releasedGen)` and `modelSwitchInFlightRef.current = false`
always execute. The UI is no longer a dead-end at `"checking"`, and the switch
can be retried (see §2.5).

### 2.2 Drain waits for both claim and in-flight send (`src/app/AppShell.tsx`)

`selectModelById`'s drain loop previously watched only `sendClaimRef`, so the
re-entry could start teardown while the native completion was still in flight.
Now it waits for both, same 5s cap:

```typescript
              while (
                (sendClaimRef.current || sendingInFlightRef.current) &&
                Date.now() - t0 < 5000
              ) {
                await new Promise((r) => setTimeout(r, 50));
              }
              if (sendClaimRef.current || sendingInFlightRef.current) {
                drainPendingModelSwitch();
                return;
              }
```

### 2.3 Memory-extract timer cleanup (`src/app/AppShell.tsx`)

Kept the 3s bound, stored the timer id, and cleared it in `finally`:

```typescript
          let memoryExtractTimer: ReturnType<typeof setTimeout> | undefined;
          try {
            await Promise.race([
              memoryExtractRef.current,
              new Promise<void>((resolve) => {
                memoryExtractTimer = setTimeout(resolve, 3000);
              }),
            ]);
          } catch {
            // ignore
          } finally {
            if (memoryExtractTimer !== undefined) clearTimeout(memoryExtractTimer);
          }
```

### 2.4 i18n (`src/i18n/en.ts`, `src/i18n/it.ts`)

Added the recoverable-error string used by 2.1:

- EN: `engineDisposeTimeout: "Could not unload the previous model. Retry the model switch."`
- IT: `engineDisposeTimeout: "Impossibile scaricare il modello precedente. Riprova a cambiare modello."`

`src/i18n/types.ts` derives `LocaleStrings` from `typeof en`, so the Italian
catalog is compile-checked against the new key.

### 2.5 Targeted test (`src/engine/llamaContextGate.test.ts`)

Extended the existing llamaContextGate suite with a `runNativeOpBounded`
describe block (no new harness, no full Jest):

1. Runs immediately and returns the value when the chain is empty.
2. Refuses with `{ ok: false, refused: "timeout" }` when the chain is hung
   (a never-settling `runNativeOp`), returns no earlier than the deadline, and
   does **not** enqueue a third op (`isNativeOpChainEmpty()` stays `false`).
3. Submits and resolves when the chain frees before the deadline.

### 2.6 Hostile-audit must-fixes

Two must-fixes from the MiMo audit were applied on top of §2.1–2.5.

**(a) Missing `t` in `selectModel` deps.** `selectModel`'s timeout path calls
`t("errors.engineDisposeTimeout")` but the callback deps were
`[modelIndex, modelState]` — a stale-locale hazard. Added `t`:

```typescript
    [modelIndex, modelState, t],
```

`t` is memoized per locale (`i18n/index.ts`: `const t = useMemo(() => makeT(locale), [locale])`),
so it is stable across renders and does not churn `selectModel`.

**(b) UX copy told the user to restart although retry works.** `selectModel`
refuses only `modelState === "downloading" | "loading"`; `"error"` is not
refused, and `modelSwitchInFlightRef` is cleared in the `finally`, so a retry
of the same switch is viable. EN/IT copy and the `console.warn` now say retry
instead of restart. Retry is **not** blocked.

---

## 3. Verification

Commands run with real exit codes (logs under `/tmp`), re-run after the
hostile-audit must-fixes in §2.6:

```text
npx tsc --noEmit                               > /tmp/kalsa-tsc-fix.log 2>&1 ; echo $?
  TSC_EXIT=0

npx jest src/engine/llamaContextGate.test.ts   > /tmp/kalsa-jest-fix.log 2>&1 ; echo $?
  JEST_EXIT=0   →  Test Suites: 1 passed, 1 total
                  Tests:       5 passed, 5 total
```

No device was touched. Nothing committed or pushed.

---

## 4. Changed paths

- `src/app/AppShell.tsx`
- `src/engine/llamaContextGate.test.ts`
- `src/i18n/en.ts`
- `src/i18n/it.ts`

---

## 5. `git status` at end

```text
 M src/app/AppShell.tsx
 M src/engine/llamaContextGate.test.ts
 M src/i18n/en.ts
 M src/i18n/it.ts
?? archived/docs/AUDIT_HARNESS_GLM.md
?? archived/docs/AUDIT_HARNESS_GLM_REAUDIT.md
?? archived/docs/remeasure-2026-08-25/
?? archived/docs/repo-audit-2026-08-28/
?? device-decode-lineup-out/
?? n3.txt
?? out/
?? results/ciswire-campaign/
```

(The untracked entries are pre-existing and were not touched by this work.)
