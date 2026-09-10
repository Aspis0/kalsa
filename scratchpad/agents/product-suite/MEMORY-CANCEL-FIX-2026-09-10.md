# MEMORY CANCEL FIX — 2026-09-10

**Repo**: `/Users/marco/Projects/kalsa` (main)
**Base commit**: `095466e` (`fix(session): derive engine identity from native build inputs`)
**Scope**: memory-extraction cancellation — stop / clearChat / conversation switch while an extraction is in flight.
**Status**: **committed and pushed** as `f99fe45` (`f99fe4506a3072c6d18b625bdaca815615bf7421`) — `fix(memory): forward chat cancellation to extraction`, 3 files (2 new). MiMo re-audit verdict: **SHIP**.
**CI**: automatic `E2E emulator (real inference)` run `34526920272` started on the `main` push (headSha `f99fe45`) — **pending/in progress when this report was written**; the orchestrator monitors it. No workflow was dispatched, no APK/device build started from this step.
**Input recon**: `MEMORY-CANCEL-RECON-2026-09-10.md` (MiMo) — see §5: two of its central claims are **refuted** by the trace. Re-audit: `MEMORY-CANCEL-REAUDIT-2026-09-10.md` (SHIP), corrected on the model-switch wording (owner audit).

**Commit contents** (verified via `git show --name-status`, `git ls-tree`, `git cat-file`; blob hashes committed == on-disk):
- `M src/app/AppShell.tsx` (`209e9ebb487c5a7ede7ce4ca1be99c2ed75b1149`)
- `A src/memory/extractAbort.ts` (`9829b2645afba969327046723f1447d861c85720`)
- `A src/memory/extractAbort.test.ts` (`d831bac07040d2f381b2cccfd2bdfedee269b853`)

Remote verified: `git ls-remote origin refs/heads/main` = `f99fe4506a3072c6d18b625bdaca815615bf7421` (identical to local `HEAD` and local `main`).

No phone test in this step. No APK build on this Mac. No campaigns.

---

## 1. The real bug

The extraction job runs `extractMemory(..., signal)` with its **own** `AbortController`. `LlamaService.extractMemory` attaches its `onAbort` listener to that signal (`stopCompletion`). The turn's signal is a **different** signal and only *gates* the job — it never reaches the native completion.

Pre-fix AppShell registered a listener on the turn signal that did exactly one thing:

```ts
// pre-fix, AppShell.tsx:4909-4913
const onAbortRelease = () => {
  if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
  releaseSaveGate?.();
};
signal.addEventListener("abort", onAbortRelease, { once: true });
```

`extractionAbortController.abort()` existed **only** inside `cancelExtractionForSend`, which was reachable **only** through `memoryExtractCancelRef.current?.()` on the **new-send** path. So:

- **gate phase** (job still waiting on `saveGate`): the listener released the gate, the job then saw `signal.aborted` and returned early — no native work. Correct.
- **native phase** (job already past the post-gate check and inside `extractMemory`): releasing the gate does nothing. The native completion ran to its own end or to its timeout. **Release is not cancellation.**

### 1.1 Reachability of the turn signal (traced, not assumed)

AiChatPage owns the controller and keeps it alive after the turn:

| Step | Code |
|---|---|
| pre-send, install | `abortRef.current = preSendController` (`AiChatPage.tsx:2137`) |
| stream start, reuse | `abortRef.current = controller` (`AiChatPage.tsx:2391`) — same controller |
| passed to AppShell | `controller.signal` → `handleSendStream` (`AiChatPage.tsx:2544`) |
| **after a successful turn** | **no `abortRef.current = null`**; the only nulls are pre-send refusal paths (`:2144/:2150/:2161/:2199/:2352`) |

Abort sites on that same controller (`abortRef.current?.abort()`):

| Site | Line | Reached by |
|---|---|---|
| conversation change effect | `AiChatPage.tsx:1735` | switch conversation (drawer) |
| unmount | `:1790` | component teardown |
| background discard | `:1966`, `:1997` | app goes background → engine dispose |
| edit / regenerate during streaming | `:3109` | only while `sendingRef.current` |
| `handleStop` | `:2908` | composer "Interrompi generazione" — only while `sendingRef.current` |
| `clearChat` | `:2989` | "Nuova chat" — always available |

**Reachability result** (measured contract, §4): `clearChat`, conversation switch, background discard and unmount all fire the turn signal **while an extraction can be in flight** (the extraction arms at the turn's `onDone`, i.e. after the stream ends, and `abortRef.current` still points at that turn's controller). `handleStop` is only reachable while `sendingRef.current` is true, and at that moment this turn's extraction is not armed yet — a stop during streaming is caught by `armMemoryExtract`'s own early-return (`extractStopReason 4`), which is what the device session measured.

### 1.2 The one-guard-after-completion argument

The post-gate guard (`if (signal.aborted || turnFailed)`) runs **before** `extractMemory`. It cannot stop a completion that has already started, and no guard is placed after the native call. A guard is not cancellation; the abort has to reach the native signal.

---

## 2. The fix

New module `src/memory/extractAbort.ts` owns the cancellation of one extraction job and forwards the turn signal to it. `onCancel` stays in AppShell because the gate release and its telemetry source are AppShell state, not cancellation state.

```ts
// src/memory/extractAbort.ts
export function createExtractAbort({ outer, onCancel }: ExtractAbortOptions): ExtractAbort {
  const controller = new AbortController();
  let cancelled = false;

  const cancel = () => {
    if (cancelled) return;
    cancelled = true;
    try {
      onCancel();
    } finally {
      // Always abort, even if the gate release throws: a live native
      // completion after stop is worse than a missed telemetry counter.
      controller.abort();
    }
  };

  const forward = () => cancel();

  if (outer) {
    if (outer.aborted) cancel();
    else outer.addEventListener("abort", forward, { once: true });
  }

  return {
    signal: controller.signal,
    cancelled: () => cancelled,
    cancel,
    detach: () => { /* removeEventListener, guarded */ },
  };
}
```

AppShell wiring (net **-5 lines**, one file):

```diff
-            let extractionCancelled = false;
-            const extractionAbortController = new AbortController();
-            const cancelExtractionForSend = () => {
-              extractionCancelled = true;
-              if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
-              releaseSaveGate?.();
-              extractionAbortController.abort();
-            };
-            memoryExtractCancelRef.current = cancelExtractionForSend;
-            // clearChat/stop aborts the signal — release so we never hang the ref.
-            const onAbortRelease = () => {
-              if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
-              releaseSaveGate?.();
-            };
-            signal.addEventListener("abort", onAbortRelease, { once: true });
+            // Cancel = release the gate (source 3) + abort the extraction's own
+            // signal. stop/clearChat abort the TURN signal; forwarding it here is
+            // what makes cancellation reach a completion that is already running
+            // (audit 2026-09-10: the old listener released the gate only, and
+            // extractMemory listens on this controller, not on the turn signal).
+            const extractAbort = createExtractAbort({
+              outer: signal,
+              onCancel: () => {
+                if (releaseSaveGate && extractGateSource === 0) extractGateSource = 3;
+                releaseSaveGate?.();
+              },
+            });
+            memoryExtractCancelRef.current = extractAbort.cancel;
@@
-                if (extractionCancelled) {
+                if (extractAbort.cancelled()) {
@@
-                  extractionAbortController.signal,
+                  extractAbort.signal,
@@
-                if (memoryExtractCancelRef.current === cancelExtractionForSend) {
+                if (memoryExtractCancelRef.current === extractAbort.cancel) {
                   memoryExtractCancelRef.current = null;
                 }
-                try {
-                  signal.removeEventListener("abort", onAbortRelease);
-                } catch {
-                  // ignore
-                }
+                extractAbort.detach();
```

Consequences, all intended:
- `cancel` is idempotent and has stable identity, so the `finally` ownership check still works.
- An `outer` signal already aborted at arm time cancels immediately → the job never starts native work.
- A gate-phase stop/clear now reports `stopReason:"aborted_by_send"` + `extractStopReason:1` + `extractGateSource:3`. Pre-fix it reported `stopReason:"skipped_no_snapshot"` for the same event, because `extractDetails` stayed at `noExtractDetails`. **Telemetry fix included.**
- **No `MemoryStore` code touched. No fact is deleted. `clearChat` in AiChatPage still never references `MemoryStore`** — closing a chat still does not clear global memory.

---

## 3. Tests (deterministic, no device)

`src/memory/extractAbort.test.ts` — **12 passed, 12 total**. The job shape mirrors AppShell (gate → post-gate cancel check → native completion). `nativeCompletion()` resolves **only** on abort, so a passing test must have been driven by the abort reaching that signal.

| Test | Assertion |
|---|---|
| no cancellation | signal live |
| `cancel()` | aborts signal, `onCancel` once, idempotent (3 calls → 1) |
| **REGRESSION: turn signal abort** | stop/clear → `cancelled()` + native signal aborted + `onCancel` once |
| **CONTROL: released-gate-only wiring** | gate opens (`gateReleased === 1`) **and** the native signal stays live — the pre-fix wiring, asserted |
| already-aborted outer | cancels at creation |
| no outer signal | only explicit `cancel()` fires |
| `detach()` | a later outer abort no longer cancels |
| `onCancel` throws | signal still aborted |
| job: abort during gate | `nativeStarted:false`, `aborted_by_send`, native never called |
| job: abort during native | `nativeStarted:true`, `aborted_by_send`, signal aborted mid-flight |
| job: new send | cancels immediately, gate released, turn signal untouched |
| job: no cancellation | native resolves `done` |

**Old implementation fails the same tests.** Removing only the outer forwarding from `extractAbort.ts` (keeping the rest) → `Tests: 4 failed, 8 passed`:

```
● REGRESSION: aborting the turn signal (stop / clearChat) reaches the native signal
● an already-aborted outer signal cancels at creation
● extract job: stop during the save gate: never starts native work, reports cancelled
● extract job: stop during the native completion: aborts mid-flight, reports cancelled
```

Restored file → 12/12 again.

### Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | clean |
| `npx jest --runInBand` | **644 passed, 0 failed** (68 suites; 632 → 644 with the new file) |
| `apk.yml` harness step, all 36 harnesses by **exit code** | 0 non-zero exits |
| `matrixParityHarness` | `OVERALL: PASS (15 passed, 0 failed)` |

`memoryFactsTailHarness.mjs` reports 13/7 failures (`sanitizeFactForPrompt is not a function`) — **pre-existing and unrelated**: it compiles `src/engine/memoryFactsTail.ts` + `personaTail.ts`, both untouched, and no CI workflow runs it.

---

## 4. Contract measured (stop / clear / switch / background / new send)

| Trigger | Fires turn signal? | Reachable with a live extraction? | Pre-fix | Post-fix |
|---|---|---|---|---|
| **New send** | no (direct `cancel()`) | yes | cancels immediately | unchanged |
| **clearChat / "Nuova chat"** | yes (`:2989`) | **yes** (available after the turn) | gate released; native completion **not** aborted → runs to its own end/timeout; facts applied | **cancels gate + native** |
| **Conversation switch** | yes (`:1735`) | yes | gate released; native completion **not** aborted → runs on; facts applied | **cancels gate + native** |
| **Background discard** | yes (`:1966/:1997`) | yes | gate released; the extract completion is **not** aborted by this path, but `disposeEngineLocked` later halts it (captures `current`, `context = null`, `stopCompletion()`, awaits `engineJobChain` + `activeCompletionSet`) and the extract `finally` sees `engine !== context` and resets KV | **cancels gate + native before the dispose path** |
| **Unmount** | yes (`:1790`) | possible | same | cancels |
| **handleStop** | yes (`:2908`) | **no** — only while `sendingRef.current`; extraction arms at `onDone` | pre-arm early return (`reason 4`) | unchanged |
| **Model switch** | **no** (`selectModel` does not abort) | yes | 3 s wait, then `memoryExtractRef` is dropped; the job keeps settling and `disposeEngineLocked` halts its completion (bounded stop) | **unchanged — measured open, §6** |

Timing boundary, stated explicitly: cancellation reaches the native completion only if it arrives while the completion is running. If the completion has already resolved and the job is between the `await extractMemory(...)` result and `applyExtractResults`, the facts are still applied. **No guard was added there on purpose** — facts are global memory, `clearChat` must not drop global facts, and the alternative (a guard that discards a finished extraction) would silently reduce fact capture. The gain here is bounded native work released to the next engine job; it is not a promise that a cancelled chat writes zero facts.

---

## 5. Corrections to `MEMORY-CANCEL-RECON` (MiMo)

| Recon claim | Verdict |
|---|---|
| §1 `onAbortRelease` releases the gate but never aborts the inner controller; that's the gap | **CONFIRMED** — fixed here |
| §3.1/§3.2 "send finally block → `abortRef.current = null`; therefore clear/stop cannot reach the signal at all" | **REFUTED.** `abortRef.current` is assigned at `:2137` and `:2391` and **never nulled on the success path**; the cited `:2144/:2150/:2161/:2199` are *pre-send refusal* paths (`stillThisRun` false, fit-gate failure, clearChat during the fit gate) and `:2352` is the post-fit-gate refusal. After a completed turn `abortRef.current` still points at that turn's controller, so the outer signal **does** fire on clearChat and the forwarding fix **is** effective |
| §6.1 "required: a dedicated `cancelActiveExtraction` callable from clear/stop, because the outer signal is never reached" | **Not required.** Premised entirely on the refuted §3 |
| §7 "switchConversation during extract … does not abort the send" | **REFUTED.** `handleSwitchConversation` changes `conversations.activeId`, the `conversationId` prop changes, and the AiChatPage effect at `:1735` calls `abortRef.current?.abort()`. Switch **does** abort the turn signal — so post-fix it now cancels an in-flight extraction (**behaviour change**, flagged below) |
| §4 "deterministic reproduction … the race is reachable when …" | The macrotask/microtask race is **not demonstrated**; the fix does not depend on it, and none is claimed here |
| §6.3 "add a guard before `applyExtractResults`" | **Rejected deliberately** — see §4 timing boundary: it would drop a finished extraction's facts, contradicting "closing a chat is not deleting memory" |
| §5.3 "not data corruption … facts are global" | Agreed, and preserved: no store code changed |

### 5.1 Behaviour change to flag to the owner

Post-fix, **conversation switch** cancels an in-flight extraction, so a fact that the completed exchange would have produced is not learned. It is consistent with the accepted new-send behaviour (which already cancels and drops), and for **background discard** it removes work one step earlier than the disposal path would: previously the extract completion was not aborted by the signal path at all and only `disposeEngineLocked` halted it (bounded stop via `stopCompletion()` + wait on `engineJobChain`/`activeCompletionSet`). There is **no proven overlap** between a release and a running completion — the lifecycle lock and the job chain serialize them. If the product wants switch to *not* cancel, the outer signal cannot be the mechanism (it is shared); that needs a per-intent cancel API and is explicitly out of scope here.

---

## 6. Measured open item (not changed)

`selectModel` (`AppShell.tsx:3942-3954`) does not abort the turn signal. It waits up to 3 s for `memoryExtractRef.current`, then sets `memoryExtractRef.current = null` and proceeds to save + `disposeEngine`.

What actually happens to the extraction, traced through `disposeEngineLocked` (LlamaService.ts:1866-1910):

1. `disposeEngine` → `withLifecycleLock` → `disposeEngineLocked`; `disposing = true`.
2. It captures `const current = context`, then sets `context = null` (and clears the engine identity/KV bookkeeping).
3. It calls `current.stopCompletion()` — this halts the extraction's native completion — then awaits `engineJobChain` and `activeCompletionSet` (bounded by `DISPOSE_SAFETY_TIMEOUT_MS`) before release.
4. `extractMemory` captured `engine` at entry; its `finally` sees `engine !== context` (now `null`), takes the else branch and resets `kvHoldsChatSession = false`, `lastChatNPast = undefined`, `chatKvDiskCurrent = false` without attempting a restore.

So this is a **bounded stop**, not a completion running against a disposed engine: the native work is halted, the KV bookkeeping is reset, and the lifecycle lock + job chain serialize the release. **No overlap between release and a live completion was proven.**

**Severity LOW — what is actually lost:** the 3 s wait, and then AppShell drops its bookkeeping ref (`memoryExtractRef.current = null`) while the job may still be settling. Consequences: a subsequent new send will not `await` this job, and the extraction contributes only the stop (uncommitted facts are discarded; already-committed facts stay, they are global). It is a lost-ref / discarded-work-and-state item, not a disposal race.

Left unchanged on purpose: the current wait is a deliberate "let the extraction finish and keep its facts (≤3 s)" trade-off, and cancelling there would drop facts that would otherwise land — the same semantics question as §5.1, decided the other way. Reported as measured, not fixed. Fixing it needs the owner's call on the trade-off, not a code change.

### 6.1 "cleanup null" trace (asked explicitly)

| Site | Scope | Risk |
|---|---|---|
| `AppShell.tsx:4995` `memoryExtractCancelRef.current = null` | job `finally`, **guarded** by `=== extractAbort.cancel` | none — a newer job's cancel ref is never clobbered |
| `AppShell.tsx:5032` `memoryExtractRef.current = null` | new-send path, after `await memoryExtractRef.current` | job already settled; sends are serial. Not reproduced as a defect |
| `AppShell.tsx:3954` `memoryExtractRef.current = null` | model switch, after the 3 s race | the §6 LOW item: ref dropped for a job that may still be settling (bounded stop by the dispose path; no release overlap proven) |

**No unconditional `memoryExtractCancelRef.current = null` exists**, so no cleanup path can make clearChat unable to abort a live extraction. The concern is refuted.

Where a new send waits (`AppShell.tsx:5026-5032`): it cancels immediately and then `await`s the job so the native checkpoint restore stays serialized before the new turn uses the engine. It does **not** promise zero wait — the brief restore await is intentional.

---

## 7. Files

| File | Change |
|---|---|
| `src/memory/extractAbort.ts` | **new** — cancellation handle (forward + idempotent cancel + detach) |
| `src/memory/extractAbort.test.ts` | **new** — 12 tests incl. the pre-fix control |
| `src/app/AppShell.tsx` | rewire extraction cancellation onto the handle (net −5 lines) |

Previously-produced device report preserved with two corrections: `JELLY-SESSION-MEMORY-095466e-2026-09-10.md` — §Results #9 and §7 now read "the send cancels extraction instead of awaiting natural completion; the native checkpoint restore remains serialized" (AppShell still `await`s the restore, so this is not a zero-wait claim), and the Stop/Edit limits are unchanged (Stop: reachable + aborts proven, partial-keep NOT demonstrated; Edit: `Modifica` reachable on a USER message, text change impossible via `adb input text`).

The app fix is committed and pushed as `f99fe45` on `origin/main` (§ header). This report is now being recorded in the experiments repository. No device test or APK build was performed in this report step.

---

## 8. Limits

1. Static + unit evidence only. No device run in this step; the contract table is code-traced + unit-tested, not instrumented on hardware.
2. `stop`'s window never overlaps a live extraction (§4), so the fix's practical reach is clearChat / switch / background / unmount. Verified by the reachability trace, not by a device.
3. The `applyExtractResults` timing boundary (§4) is a deliberate non-fix; a cancelled chat can still have its last extraction's facts applied if the completion had already resolved.
4. Model-switch behaviour unchanged and measured open (§6).
