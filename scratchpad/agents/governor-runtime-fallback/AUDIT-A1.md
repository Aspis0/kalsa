SHIP-WITH-FIXES

# A1 hostile audit

Subject: app worktree `/Users/marco/Projects/kalsa-wt-bench-apk`, HEAD `66e7befb9c60ac922ad548207b06b0d82cc65a7d`, parent `1228836fcb84e38a1cdd9f1ac1111461ae887264` (detached). The worktree was clean before this audit. The only audit artifact written is this file in the lab repository.

## Findings

### 1. Races

**REFUTED — normal lifecycle paths do not create two live local contexts or call completion on a released context.** `withLifecycleLock` serializes init/dispose; disposal clears `context`, waits the engine job chain and active completions before release; turns compare their captured context before entering completion.

> `LlamaService.ts:1835-1841` — “const next = lifecycleChain.then(fn, fn);” / “lifecycleChain = next.then(”
>
> `LlamaService.ts:2862-2865` — “disposing = true;” / “const current = context;” / “context = null;”
>
> `LlamaService.ts:2915-2920` — “Promise.allSettled([” / “engineJobChain.then(() => undefined, () => undefined),”
>
> `LlamaService.ts:4636` — “if (disposing || engine !== context) {”
>
> `LlamaService.ts:2401` — “await disposeEngineLocked();”
>
> `LlamaService.ts:4903` — “if (bailIfStopped()) return;”

This protects against UAF and duplicate active local contexts. It does not bind the retry to a model identity.

**PLAUSIBLE — selecting another local model during the reload can leave the retry running against the old CPU model, or make it report `modelNotLoaded`.** The model picker explicitly offers Continue while streaming and calls `selectModel` without aborting the turn. A1 then unconditionally re-enters `streamAssistantTurn`; that call captures whichever `context` is current when its queued job starts. Depending on disposal timing, it can start on the fallback CPU context or see `null`. There is no model/generation check between reload and retry.

> `AppShell.tsx:5080-5090` — “if (streamInFlightRef.current) {” / “onPress: () => selectModel(nextIndex),”
>
> `LlamaService.ts:4082` — “const engine = context;”
>
> `LlamaService.ts:5553` — “await streamAssistantTurn(messages, callbacks, signal, options);”

**CONFIRMED — abort is checked at the original catch, but an abort after that check does not cancel the reload.** `finally` can await battery-trace shutdown while the abort listener is still installed; after that wait the listener is removed, and the continuation checks only whether it received a string. The reload helper has no signal parameter. If abort arrives during reload, the retry entry checks the signal before completion when a context exists, so it does not decode; however, the CPU reload still runs. If disposal has already nulled `context`, the recursive call reports `modelNotLoaded` before it reaches the aborted-signal check.

> `LlamaService.ts:5483-5499` — “const stopped = Boolean(aborted || signal?.aborted);” / “if (stopped) {” / “return governorRuntimeFallbackReason(error);”
>
> `LlamaService.ts:5503-5505` — “if (energyTraceOn) await stopGovernorBatteryTrace();” / “signal?.removeEventListener(\"abort\", onAbort);”
>
> `LlamaService.ts:5540-5542` — “if (typeof runtimeFallbackReason !== \"string\") return;” / “await reloadGovernorRuntimeFallback(runtimeFallbackReason, options.locale);”
>
> `LlamaService.ts:4101-4104` — “if (!engine) {” / “callbacks.onError(new Error(strings.errors.modelNotLoaded));”
>
> `LlamaService.ts:4271-4275` — “signal?.addEventListener(\"abort\", onAbort, { once: true });” / “if (signal?.aborted) {”

**PLAUSIBLE — the global transition marker can be consumed by an `initEngine` callback already queued ahead of the fallback reload.** The marker is not tied to a request/model token, and each lifecycle callback consumes it when it starts. A newly arriving user event cannot interleave between the assignment and the immediate `initEngine` call, so the writer’s claimed tiny user-event window is not established; the risk requires a competing init already waiting on the lifecycle chain. I found no ordinary AppShell path that deliberately queues such an init ahead of this helper, so this is an exposed design edge, not a reproduced production race.

> `LlamaService.ts:2231-2236` — “if (runtimeGovernorState === \"fallback-reload\") {” / “runtimeGovernorState = \"fallback-consumed\";” / “runtimeGovernorState = \"fresh\";”
>
> `LlamaService.ts:2812-2813` — “runtimeGovernorState = \"fallback-reload\";” / “await initEngine(args.modelPath, args.modelId, {”

**CONFIRMED — an abort during battery-trace shutdown can release the UI send lock before the fallback continuation settles.** `abort()` calls `onDone`; AppShell's `finish()` clears `streamInFlightRef` and resolves its wrapper, and AiChatPage then clears its sending refs. The LlamaService job is still waiting in `finally`; when it settles, the already-returned fallback reason still starts the reload/retry. A second user send can therefore enter during this edge. The engine job/lifecycle guards still prevent overlapping native completion or use-after-free, but the old turn's retry can race the newer chat turn.

> `LlamaService.ts:4176-4177` — “if (error) callbacks.onError(error);” / “else callbacks.onDone();”
>
> `AppShell.tsx:5831-5840` — “streamInFlightRef.current = false;” / “resolve(afterSessionSave ? { afterSessionSave } : {});”
>
> `AiChatPage.tsx:3097-3100` — “sendingRef.current = false;” / “sendingInFlightRef.current = false;”
>
> `AiChatPage.tsx:2234-2243` — “sendClaimRef.current ||” / “sendingRef.current ||”

### 2. State and CPU-only reload

**REFUTED — no normal cross-model governor-state leak was found.** A non-fallback `initEngine` resets to `fresh`; the fallback’s own load changes to `fallback-consumed`, and the catch refuses another fallback while state is not fresh. AppShell also returns early for an already-ready same-model engine rather than issuing an incidental `initEngine` call.

> `LlamaService.ts:2231-2236` — “runtimeGovernorState = \"fallback-consumed\";” / “runtimeGovernorState = \"fresh\";”
>
> `LlamaService.ts:5491-5494` — “fallbackUsedForModel: runtimeGovernorState !==”
>
> `AppShell.tsx:4286-4288` — “if (isEngineReady() && getActiveModelId() === model.id) {” / “return true;”

**CONFIRMED — the CPU-only guarantee depends on `governorLoad` still being true.** `governorRuntimeOff` only disables `initWithGovernorFallback` inside `if (governorLoad)`. If governor enablement or eligibility changes before reload, the `else` calls `initLlama(params)` and bypasses `cpuParams`. `params.n_gpu_layers` is initially taken from the tuning backend; it is only forced to zero when `governorFeatureEnabled` remains true. With the setting switched off and an Android `gpu-opencl` backend, that maps to 99 layers. The Settings switch writes this preference without a streaming guard. Even when the feature stays enabled but eligibility drops, the direct params path does not apply the `cpuParams` cleanup of speculative settings.

> `LlamaService.ts:2438-2440` — “n_gpu_layers: nGpuLayersForBackend(tuning.backend),”
>
> `LlamaService.ts:2473-2475` — “if (governorFeatureEnabled && !governorLoad) {” / “params.n_gpu_layers = 0;”
>
> `deviceTuning.ts:851-856` — “case \"gpu-opencl\":” / “return GPU_OFFLOAD_LAYERS;”
>
> `LlamaService.ts:2565-2577` — “if (governorLoad) {” / “enabled: !governorRuntimeOff,”
>
> `LlamaService.ts:2588-2589` — “} else {” / “context = await initLlama(params);”
>
> `SettingsScreen.tsx:2645-2648` — “<Switch” / “onValueChange={handleToggleGovernor}”
> `SettingsScreen.tsx:500-504` — “const handleToggleGovernor = useCallback((next: boolean) => {” / “void writeGovernorEnabled(next).then((persisted) => {”

### 3. History and KV

**CONFIRMED — the retry does not append a second user message.** AppShell pushes one `userMessage`; the retry passes the same `messages` array, and LlamaService maps it into a new prompt array without appending to the input.

> `AppShell.tsx:7062-7067` — “const userMessage: EngineMessage = {” / “engineMessages.push(userMessage);”
>
> `LlamaService.ts:4387` — “let historyMessages: RNLlamaOAICompatibleMessage[] = messages.map((message, index) => {”
>
> `LlamaService.ts:5553` — “await streamAssistantTurn(messages, callbacks, signal, options);”

**CONFIRMED — the failed partial is not always discarded.** The comment promises a discard, but the retry emits no initial empty replacement. Final text is sent only when truthy. If the CPU completion succeeds with no visible text, `onDone` runs and AppShell’s `assistantFull` still contains the governor attempt’s streamed partial; that text can remain in the bubble/history and pass the nonempty extraction gate.

> `LlamaService.ts:5550` — “discards the failed partial (fresh accumulators, full-replace deltas)”
>
> `LlamaService.ts:4606` — “if (finalText) callbacks.onDelta(finalText, streamedTextAtRoundStart + finalText);”
>
> `LlamaService.ts:4614` — “finishOnce(() => callbacks.onDone());”
>
> `engineCallbackBridge.ts:55-57` — “onDelta: (delta, full) => {” / “hooks.onDeltaFull?.(full);”
>
> `AppShell.tsx:7090-7091` — “onDeltaFull: (full) => {” / “assistantFull = full;”

**REFUTED — the immediate CPU fallback reload cannot restore a stale `.kvs`.** The helper passes `sessionRestore: undefined`, and `initEngine` only calls `tryLoadEngineSession` when `options.sessionRestore?.historyHash` exists. Governor-active sessions are also refused by the normal save path. The old file is not deleted here, but it is not restored by this CPU reload.

> `LlamaService.ts:2813-2818` — “await initEngine(args.modelPath, args.modelId, {” / “sessionRestore: undefined,”
>
> `LlamaService.ts:2712-2715` — “if (activeGovernorActive && options.sessionRestore?.historyHash) {” / “} else if (options.sessionRestore?.historyHash) {”
>
> `LlamaService.ts:3218-3221` — “if (activeGovernorActive) {” / “return false;”

### 4. Remote and abort sources

**REFUTED — normal Brain turns do not enter this catch.** `engineBackend` chooses a backend once at stream invocation and calls the remote stream function for `remote`; only the local branch calls LlamaService. AppShell blocks the ordinary remote switch while a stream is active.

> `engineBackend.ts:182-187` — “const backend = explicit ?? getEngineBackendMode();” / “if (backend ===” / “return streamRemoteAssistantTurn(messages, callbacks, signal, rest);” / “return localStreamAssistantTurn(messages, callbacks, signal, rest);”
>
> `LlamaService.ts:5489-5493` — “shouldRuntimeGovernorFallback({” / “isLocalTurn: !isRemoteEngineBackend(),”
>
> `AppShell.tsx:4962-4964` — “if (regenInFlightRef.current || streamInFlightRef.current) {”

**PLAUSIBLE — the catch rereads mutable backend state instead of carrying the backend selected for this turn.** An out-of-band mid-turn mode change could suppress a legitimate local fallback. I found no normal UI path that can perform that flip during this stream.

> `LlamaService.ts:5489-5493` — “isLocalTurn: !isRemoteEngineBackend(),”
>
> `remoteSettings.ts:74-75` — “return backendCache === \"remote\";”

**CONFIRMED — an abort already visible at the catch is computed from the right signal.** `abort()` sets the local `aborted` flag; the catch also reads `signal?.aborted`. The gap is later: that value is not rechecked after the asynchronous catch/finally handoff, as described in finding 1.

> `LlamaService.ts:4148-4151` — “const abort = (error?: Error) => {” / “aborted = true;”
>
> `LlamaService.ts:5483-5489` — “const stopped = Boolean(aborted || signal?.aborted);” / “aborted: stopped,”

### 5. Tool-exhausted fallback catch

**CONFIRMED DEFECT — A governor rejection from the final text-only tool-exhaustion completion never reaches A1.** Its nested catch logs and suppresses the rejection, then emits the existing canned `toolRoundsExhausted` copy. Main tool-round completions still escape to the outer catch; this defect is specifically the extra text-only completion after the round limit. The stated trigger covers any local completion rejection, so this path should also hand off to the runtime fallback.

> `LlamaService.ts:5440-5447` — “} catch (fallbackError) {” / “if (aborted) return;” / “console.warn(\"[toolRoundsExhausted] fallback completion failed\", fallbackError);”
>
> `LlamaService.ts:5460-5462` — “if (!exhaustedTel.fallbackOk) {” / “const fallbackMessage = strings.errors.toolRoundsExhausted;”
>
> `LlamaService.ts:5482` — “} catch (error) {”

### 6. Privacy

**CONFIRMED — the new event line contains only `reason`, and the installed binding’s current governor reasons are static strings or an integer return code.** No prompt or generated model text is fed into that reason today. The function does not allowlist the suffix, so a future binding that puts arbitrary diagnostics after the prefix could change that conclusion. The source guard does not test this.

> `LlamaService.ts:2802` — “console.log(`KALSA_GOVERNOR_RUNTIME_FALLBACK ${JSON.stringify({ reason })}`);”
>
> `governorRuntime.ts:55-57` — “const message = error instanceof Error ? error.message : String(error ?? \"\");” / “return message.slice(GOVERNOR_DECODE_FAILED_PREFIX.length).trim();”
>
> `RNLlamaJSI.cpp:1311-1312` — “throw std::runtime_error(” / “\"Governor decode failed: \" + ctx->governorFailureReason());”
>
> `rn-governor.cpp:47-48` — “failure_reason_ = \"governor is failed\";” / “return -1;”
>
> `rn-governor.cpp:54-58` — “const char * reason = governor_->failure_reason();” / “failure_reason_ = \"llama_governor_decode failed with rc=\" + std::to_string(result);”

A CPU-init failure also enters the pre-existing raw native-tail logger. This audit did not establish whether all native init diagnostics exclude model paths; it is not the new fallback event line.

> `LlamaService.ts:567-568` — “function logNativeTailOnFailure(): void {” / “console.log("[engine-init-native-tail]", nativeLogTail.join”

### 7. Tests

The focused tests pass. The pure decision tests cover fresh/local positive behavior and the remote, aborted, and consumed negative cases, so the reported predicate mutations should fail for the intended assertion. I did not independently mutate the source or replay the sabotage table.

> `governorRuntime.test.ts:123-127` — “fires on the governor rejection of a fresh local turn”
>
> `governorRuntime.test.ts:151-169` — “never on a remote (Brain) turn” / “never once the turn was aborted or stopped”
>
> `governorRuntime.test.ts:171-178` — “never after the model already fell back once”

**CONFIRMED TEST GAP — the wiring guard checks substrings, not reachable behavior.** A refactor can keep it green while moving the decision into dead code/comments, changing the boolean values at the call site, making the CPU parameter block unreachable, restoring sessions, or retrying with a stale model. It also does not guard the empty-output partial case or the nested tool catch.

> `runtimeGovernorFallbackWiring.test.ts:17-20` — “expect(source).toContain(\"shouldRuntimeGovernorFallback({\");” / “expect(source).toContain(\"return governorRuntimeFallbackReason(error);\");”
>
> `runtimeGovernorFallbackWiring.test.ts:22-27` — “expect(source).toContain(\"enabled: !governorRuntimeOff\");” / “expect(source).toContain(\"cpuParams.n_gpu_layers = 0;\");”

### 8. Clean-code checklist and report integrity

The new source-text test is 29 lines, `governorRuntime.ts` is 112, and the touched decision test is 180; no new file approaches 350 lines. `LlamaService.ts` is 6,361 lines and was already the large mixed engine file; the writer declared that pre-existing excess. Added comments are English. Imports and internal types are used; no unused public API was introduced.

**CONFIRMED CLEAN-CODE ISSUE — the `.then` comment restates the following type check.** The retry comment at line 5550 also states the false partial-discard invariant described above.

> `LlamaService.ts:5538-5540` — “// undefined ends the turn exactly as before; a string is the runtime” / “if (typeof runtimeFallbackReason !== \"string\") return;”

**CONFIRMED REPORT-INTEGRITY MISMATCH — A1.md identifies the wrong HEAD.** The report says the app worktree was at `1228836f`, which is the parent of the subject, not the audited commit. Its test claims are therefore not tied by the report to `66e7befb`.

> `A1.md:3-4` — “detached HEAD `1228836f`”
>
> Actual audited HEAD: `66e7befb9c60ac922ad548207b06b0d82cc65a7d`

## Commands and limits

- `npx jest src/engine/governorRuntime.test.ts src/engine/runtimeGovernorFallbackWiring.test.ts > /tmp/audit-a1-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-jest.log` — **EXIT=0**, 2 suites / 15 tests passed.
- `git diff --check 1228836f..66e7befb > /tmp/audit-a1-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-diffcheck.log` — **EXIT=0**.
- Not independently verified: the writer’s full Jest, typecheck, harness, or sabotage-run claims; no phone/device fallback was run; no source mutations were performed. No source file was edited.

`wc -l` at audit time: `LlamaService.ts` 6,361; `governorRuntime.ts` 112; `governorRuntime.test.ts` 180; `runtimeGovernorFallbackWiring.test.ts` 29.

## Fix round
SHIP-WITH-FIXES

Scope: app HEAD `5b7aecadd0bc65bd1a2a7b5fbec85b1600fe01e4`, parent
`66e7befb9c60ac922ad548207b06b0d82cc65a7d`; UX shell read at
`origin/ux-2026-09-21` `f6689b6e4cd1c1d8c62c59be15e2623b02810acd`.
The requested legacy path `src/ui/AppShell.tsx` is absent at app HEAD;
the active legacy wiring is `src/app/AppShell.tsx` → `src/screens/AiChatPage.tsx`.
All quotes below are source lines, not the writer's account.

### 1. Lifecycle, retry and abort

**REFUTED — two live contexts / use-after-dispose remains prevented.**
`src/engine/LlamaService.ts:1843`: “`const next = lifecycleChain.then(fn, fn);`”
serializes lifecycle operations. At `:2878`, “`context = null;`”; at
`:2931`, “`engineJobChain.then(() => undefined, () => undefined),`” is awaited
before release. The completion guard at `:4650` is
“`if (disposing || engine !== context) {`”. The fallback adds no second
native context path.

**REFUTED — normal state re-arm and fallback reload state.**
At `LlamaService.ts:2238-2243`: “`if (runtimeGovernorState === "fallback-reload") {`”
then “`runtimeGovernorState = "fallback-consumed";`”, otherwise
“`runtimeGovernorState = "fresh";`”. The helper sets that marker immediately
before `:2826` “`await initEngine(args.modelPath, args.modelId, {`”.
An ordinary explicit init/reload re-arms; the fallback's init consumes its own
marker and leaves the governor off. No ordinary cross-model leak found.
**PLAUSIBLE residual:** the marker is global, not owned by the fallback request:
a lifecycle init already queued ahead can consume it. The relevant lines are
`:2238-2243` above and `:2825`
“`runtimeGovernorState = "fallback-reload";`”. I found no ordinary UI path
that reproduces this ordering; it remains an untested interleaving.

**CONFIRMED — an abort while reload is queued/running does not stop the reload.**
The continuation checks once before calling the helper:
`LlamaService.ts:5582-5584`: “`if (!mayRetry()) return;`” then
“`await reloadGovernorRuntimeFallback(attempt.reason, options.locale);`”.
The helper has no signal parameter and unconditionally does
`LlamaService.ts:2825-2832`: “`runtimeGovernorState = "fallback-reload";`”
and “`await initEngine(args.modelPath, args.modelId, {`”. If abort arrives
after the precheck while that init is waiting on the lifecycle chain, the CPU
reload still runs. The postcheck prevents the retry only after reload returns.
Background discard really aborts the send (`AiChatPage.tsx:2108`:
“`abortRef.current?.abort();`”), but does not cancel this queued init.

**CONFIRMED — the turn token misses a new stream that sees no context.**
`LlamaService.ts:4114-4117` returns on “`if (!engine) {`” before
`:4127` “`turnTokenSeq += 1;`”. Disposal deliberately creates that null window
(`:2878` above). Such a send does not advance the token; after the fallback
reload restores the same model ID, the old attempt can still satisfy
`:5576-5578`: “`turnStillCurrent: turnTokenSeq === attempt.turnToken,`” and
“`activeModelId != null && activeModelId === attempt.modelId,`”.
Normal UI sends are serialized, so I did not reproduce this through AppShell;
the exported service path does not uphold the token invariant for every turn.

**PLAUSIBLE — model/context can change after the last gate but before retry
captures its context.** The second gate is outside the job at
`LlamaService.ts:5593`: “`if (!mayRetry()) return;`”; then
`:5603`: “`await streamAssistantTurn(messages, callbacks, signal, options);`”.
That call queues via `:4093-4095`: “`return withEngineJob(async () => {`” /
“`const engine = context;`”. No expected context/model token is carried into
the queued body. A dispose or model switch in that queue gap can make the
retry start with null or a different context. Identity guards still prevent
use-after-free, but the stale retry refusal is not atomic.

### 2. CPU-only, partial, history and KV

**REFUTED — CPU-only reload is unconditional once its marker is consumed.**
`LlamaService.ts:2576`: “`if (governorLoad || governorRuntimeOff) {`”;
`:2580`: “`cpuParams.n_gpu_layers = 0;`”; `:2581`:
“`cpuParams.n_parallel = 1;`”; `:2587`: “`enabled: !governorRuntimeOff,`”.
The init-error path has the same condition at `:2650` and rethrows before
the Android GPU retry. This closes the prior conditional CPU-path finding.

**REFUTED — an empty full-text delta is a replacement in both shells.**
The retry emits `src/engine/LlamaService.ts:5598`:
“`callbacks.onDelta("", "");`”.
Legacy bridge `src/app/engineCallbackBridge.ts:55-57` forwards `full`;
`src/screens/AiChatPage.tsx:2579` calls “`streamCoalescer.push(full);`”.
The coalescer stores it without a truthiness check
(`src/engine/streamCoalescer.ts:50`: “`pending = fullText;`”), flushes it
(`:45`: “`flush(text);`”), and the screen assigns
`src/screens/AiChatPage.tsx:2559` “`{ text: fullText },`”.
On the UX branch, `src/host/engineTurn.ts:200-201` assigns and forwards
`full`, `src/host/sendStream.ts:102-105` forwards the delta while nonterminal,
and `src/host/sendHost.ts:279` calls “`streamCoalescer.push(full);`”;
its flush assigns `src/host/sendHost.ts:256` “`text: fullText`”.
The shared coalescer on that branch also has “`pending = fullText;`”
(`src/engine/streamCoalescer.ts:50`). Neither consumer appends an empty
delta; the clear resets the visible assistant text.

**CONFIRMED — failed partial is still retained when a gate refuses retry.**
The empty callback is after the post-reload early return:
`LlamaService.ts:5593`: “`if (!mayRetry()) return;`”; only afterward at
`:5598` is the empty replacement emitted. An abort or stale model/turn during
reload therefore skips the clear. Legacy screen finalization preserves a
streamed partial on abort: `AiChatPage.tsx:2816` says
“`const wasInterrupted = controller.signal.aborted && anyTextStreamed;`”,
and `:2808` takes the finalize path when “`!controller.signal.aborted || anyTextStreamed`”.
Thus the failed governor partial can remain visible and be persisted on the
abort/stale path. The consumer reset semantics are correct; its placement
does not cover all exits.

**REFUTED — user history is not appended twice.**
Legacy assembly appends once at `src/app/AppShell.tsx:7067`:
“`engineMessages.push(userMessage);`”. The retry passes the same array at
`LlamaService.ts:5603`; the service builds a copy at `:4401`:
“`let historyMessages: RNLlamaOAICompatibleMessage[] = messages.map((message, index) => {`”.
No in-place push/splice of the input `messages` exists in LlamaService.

**REFUTED — stale governor-era KV is not restored by this reload.**
`LlamaService.ts:2831`: “`sessionRestore: undefined,`”; the loader only calls
`tryLoadEngineSession` under `:2727` “`else if (options.sessionRestore?.historyHash) {`”.
The governor save path also refuses the active governor context at
`:5678-5680`: “`if (activeGovernorActive && engine === context) {`” /
“`return false;`”. Old files may remain on disk, but this reload does not
restore one.

### 3. Remote, tool catch, privacy and tests

**REFUTED — remote dispatch bypasses the local fallback catch.**
`src/engine/engineBackend.ts:182-187` captures
“`const backend = explicit ?? getEngineBackendMode();`”, returns
`streamRemoteAssistantTurn` for remote, and calls `localStreamAssistantTurn`
otherwise. LlamaService catches the local implementation.
**PLAUSIBLE mutable-mode edge:** its catch recomputes locality at
`LlamaService.ts:5519`: “`isLocalTurn: !isRemoteEngineBackend(),`” instead of
carrying the dispatcher's `backend`; a mid-turn backend flip could suppress a
valid local fallback. I did not find a normal UI mode switch during an active
send. Abort is sourced correctly at the main catch: `:5509`:
“`const stopped = Boolean(aborted || signal?.aborted);`”; the listener is
`:4284-4285` “`const onAbort = () => abort();`” /
“`signal?.addEventListener("abort", onAbort, { once: true });`”.
The tool catch uses the same local flag plus signal directly at `:5462-5464`.

**REFUTED — the tool-exhaustion governor rejection now hands off.**
`LlamaService.ts:5457-5468` says “`A governor rejection must reach the outer`”
and, when the shared decision allows it, “`throw fallbackError;`”.
Other errors retain the existing canned path. A second rejection after the
model has consumed its one fallback is refused by the shared decision.

**PLAUSIBLE — sanitizer bounds characters but is not a semantic allowlist.**
`governorRuntime.ts:55` allows every character in
“`/[^A-Za-z0-9 _.,:+=\/-]/g`”; `:64-68` strips only outside that class and
caps length. A suffix such as ordinary prompt/model words or a POSIX path
uses allowed characters and survives. The test at
`governorRuntime.test.ts:145` asserts only
“`expect(reason).toMatch(/^[A-Za-z0-9 _.,:+=\/-]{0,120}$/);`”.
For the currently pinned binding, `package.json:49` pins
`llama.rn#e437b1af3de7af563526f5777dbf25d86f9b3215`; its current governor
failure strings are literals: `node_modules/llama.rn/vendor/llama.cpp/src/llama-governor.cpp:164`
“`return fail("governor is failed");`”, `:167`
“`return fail("decode requires a non-empty batch");`”, `:172`
“`return fail("governor supports sequence 0 only");`”, and `:209`
“`return fail("route Reject during phase handoff");`”. I found no current
prompt/model string source. However, when the nested
tool catch declines fallback it logs the raw object:
`LlamaService.ts:5472` “`console.warn("[toolRoundsExhausted] fallback completion failed", fallbackError);`”.
The strict no-free-text guarantee is not established for a future/dynamic
native reason.

**REFUTED — source guard was widened; CONFIRMED — it remains shape-only.**
`runtimeGovernorFallbackWiring.test.ts:25-35` now pins two decision sites,
the handoff, retry gate and empty callback; `:45-48` pins two CPU branches.
But it checks substrings, e.g. `:33-34`
“`expect(source).toContain("mayRetryRuntimeGovernorFallback({");`” /
“`expect(source).toContain('callbacks.onDelta("", "");');`”.
A refactor could leave these in a comment/dead branch, move the clear after
an early return, change values passed to the gate, or run the real retry
through a different path and still pass. Pure gate tests cover each false
input and a true control; they do not exercise lifecycle ordering, null-context
token advancement, abort during reload, or either UI consumer.

### 4. Clean code and verification

**CONFIRMED comment defect — `governorRuntime.ts:54` says**
“`Everything outside this class is stripped: no free text into logcat.`”
The allowed class contains unrestricted prose/path characters, so that
invariant is false. The added retry comments also overstate stale-send
protection given the null-context token path above. No new UI copy was added.
Current line counts: `LlamaService.ts` 6,411 (pre-existing oversized service),
`governorRuntime.ts` 138, `governorRuntime.test.ts` 227, and the new wiring
test 50; no new file approaches 350 lines. The new helper is used and imports
are direct; no unused API or convenience re-export found.

- `npx jest src/engine/governorRuntime.test.ts src/engine/runtimeGovernorFallbackWiring.test.ts > /tmp/audit-a1-fix-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-fix-jest.log` — **EXIT=0**, 2 suites / 23 tests.
- `npm run typecheck > /tmp/audit-a1-fix-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-fix-tsc.log` — **EXIT=0**.
- `npx jest > /tmp/audit-a1-fix-full-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-fix-full-jest.log` — **EXIT=0**, 116 suites / 1,453 tests.
- `git diff --check 66e7befb..5b7aecad > /tmp/audit-a1-fix-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-fix-diffcheck.log` — **EXIT=0**.
- Not verified: device/native runtime fallback, background behavior on a phone, or an actual lifecycle-queue interleaving. No app source was edited. App HEAD remains `5b7aecadd0bc65bd1a2a7b5fbec85b1600fe01e4`; base `66e7befb9c60ac922ad548207b06b0d82cc65a7d`.

## Round 3
SHIP-WITH-FIXES

Scope: app HEAD `73c552f01583cadf300ab24f8dec4782f3060314`, parent
`5b7aecadd0bc65bd1a2a7b5fbec85b1600fe01e4`; UX shell read from
`origin/ux-2026-09-21` at `1a790d7cad96f7361802b38e432e6edb722e3f92`.
No app source was changed.

### Prior findings and stale-before-reload path

**REFUTED — the three requested Fix-round defects are closed.** The entry
increment is now before the engine job: `LlamaService.ts:4079-4082` says
“`turnTokenSeq += 1;`”. Both refused gates route through
`:5587-5589` — “`callbacks.onDelta("", "");`” then
“`callbacks.onDone();`”. The corrected governor comment says the suffix is
“`charset-bounded — not semantically filtered`” (`governorRuntime.ts:55-57`),
which matches `:59`'s “`/[^A-Za-z0-9 _.,:+=\/-]/g`” and `:71-72`'s replace +
120-character slice.

**REFUTED — CPU-only, tool-exhaustion handoff, and widened guard remain.** The
reload path uses `LlamaService.ts:2576-2581` — “`if (governorLoad || governorRuntimeOff) {`”
and “`cpuParams.n_gpu_layers = 0;`”; it passes
`:2587-2590` “`enabled: !governorRuntimeOff`” and `cpuParams`. The nested
catch at `:5462-5470` says “`throw fallbackError;`” when the shared governor
decision accepts it. `runtimeGovernorFallbackWiring.test.ts:53-60` now checks
entry < increment < job and a single increment. The reason remains only
character-filtered, not semantically filtered; the current pinned native
failure reason is the literal “`failure_reason_ = "governor is failed";`”
(`node_modules/llama.rn/cpp/rn-governor.cpp:47`). The event still logs only
`reason` (`LlamaService.ts:2815`: “`KALSA_GOVERNOR_RUNTIME_FALLBACK ${JSON.stringify({ reason })}`”);
no prompt/model field was added.

**REFUTED — stale-before-reload leaves the once-per-load state fresh and
allows recovery on the next same-model turn.** The state initializes to
“`"fresh"`” (`LlamaService.ts:361-362`). The only later writes are the
explicit/fallback distinction in `:2238-2241` and the helper's
“`runtimeGovernorState = "fallback-reload";`” at `:2825`. A stale turn or model
fails `mayRetryRuntimeGovernorFallback` at `:5576-5581`; `:5597-5599` then
calls `stopQuietly()` and returns before `reloadGovernorRuntimeFallback` at
`:5602`, so that path does not consume or change the state. On the next turn
against the same failed context, native `rn_governor::decode` returns the
sticky reason (`rn-governor.cpp:44-48`: “`if (failed_ || governor_ == nullptr)`” /
“`failure_reason_ = "governor is failed";`”), and JSI throws it at
`RNLlamaJSI.cpp:1309-1312`: “`Governor decode failed: " + ctx->governorFailureReason()`”.
The service catch still passes `fallbackUsedForModel: runtimeGovernorState !== "fresh"`
(`LlamaService.ts:5520-5524`), so it can hand off recovery. If a different
model was already explicitly loaded, `initEngine` re-arms at `:2241` for that
new context; it does not leave the old dead context active as the next model.

### Callback isolation across both shells

**REFUTED — the empty delta is not an append and does not clear the newer
assistant message.** In the legacy shell, the bridge forwards `full`
(`src/app/engineCallbackBridge.ts:55-57`: “`ui.onDelta?.(delta, full);`”);
AiChatPage rejects the old run before pushing it
(`src/screens/AiChatPage.tsx:2576-2579`: “`if (regenGenerationRef.current !== myGen || sendRunIdRef.current !== runId) { return; }`”).
The live run coalescer overwrites `pending` (`src/engine/streamCoalescer.ts:50`:
“`pending = fullText;`”) and its update targets the captured assistant id
(`AiChatPage.tsx:2557-2560`: “`updateMessage(assistantId, { text: fullText }, myGen, runId)`”).
On the UX branch, `sendHost.ts:277-280` checks “`if (!fence.owns(token)) return;`”
before “`streamCoalescer.push(full);`”; the coalescer update is limited to
`message.id === assistantId` (`sendHost.ts:251-257`). Thus `("", "")` resets
that attempt's text when current and cannot clear the new message when stale.

**CONFIRMED — old `onDone` can still mutate shared new-stream state in both
shells.** Fallback calls the old callback at `LlamaService.ts:5589`. In the
legacy shell, that callback closes over this send's `finish`
(`AppShell.tsx:7087-7095, 7112-7115`), but its closure writes shared refs/state
without an owner check (`:5831-5839`: “`streamInFlightRef.current = false;`”,
“`setStreaming(false);`”, and “`onMiniappRef.current = () => {};`”). If abort
occurs during the reload, the stream's abort listener has already been removed
(`LlamaService.ts:5541`: “`signal?.removeEventListener("abort", onAbort);`”);
AiChatPage's watchdog can unlock for a new send (`AiChatPage.tsx:3199-3207`)
without settling AppShell's per-send `finish`. The later stale `onDone` can
therefore turn off the new send's shared streaming flag and clear its miniapp
hook. The UX branch has the same lifted `finish` at
`src/host/engineTurn.ts:105-115` and `:230-252`; its watchdog releases the send
claim at `src/host/sendStop.ts:114-126`, so an old finish can likewise set
“`streamInFlightRef.current = false;`” / “`setStreaming(false);`” while a newer
send owns the UI. Each callback resolves only its own send, so it does not
resolve the newer engine promise or finalize its assistant row; the shared
state mutation is still a confirmed interference.

**CONFIRMED — the UX stale empty-delta callback also flips a shared token flag
before its owner check.** `src/host/sendHost.ts:159` resets
“`hasTokensRef.current = false;`” for a new send, but `:277-279` does
“`hasTokensRef.current = true;`” before “`if (!fence.owns(token)) return;`”.
`HostRoot.tsx:196` reads that shared flag. A refused stale callback therefore
cannot clear the new bubble, but it can make the new composer report that text
arrived. Legacy AiChatPage's pre-guard `anyTextStreamed = true` is local to the
old send (`AiChatPage.tsx:2572-2578`) and does not have this shared-ref leak.

### Queue window, comments, and guard limits

**PLAUSIBLE — a retry can become stale after the post-reload gate while its
engine job is queued.** The gate passes at `LlamaService.ts:5611`, then the
clear and recursive call happen at `:5619-5624`. That call immediately bumps
the token but queues its body through `withEngineJob` (`:4097-4099`); the FIFO
is asynchronous (`:849-855`: “`const run = engineJobChain.then(`”). If another
send enters during an earlier queued job, its entry bump can make this retry
stale before the retry body starts, but that body does not re-check the token
or model before capturing `context`. I found no literal `await` between the
gate and recursive call; the queued wait is the remaining window. No runtime
interleaving was exercised.

**REFUTED — tool rounds and the retry do not invalidate their own retry.**
The tool loop stays inside one FIFO job (`LlamaService.ts:4094-4096`: “`Tool executeTool stays inside the lock but does not call completion`”). The only
recursive call in this service is the deliberate one at `:5624`, after the
post-reload gate; its entry bump has no later self-check to fail. Normal
production call sites go through `engineBackend.ts:176-187` and the AppShell
call at `:7087`.

**PLAUSIBLE — the global transition marker can still be consumed by an
unrelated queued init.** `reloadGovernorRuntimeFallback` sets
`LlamaService.ts:2825` “`runtimeGovernorState = "fallback-reload";`” just before
`:2826` “`await initEngine(args.modelPath, args.modelId, {`”. `initEngine`
checks that global marker only when its lifecycle-locked callback runs
(`:2235`, `:2238-2243`), and `withLifecycleLock` appends callbacks to
`lifecycleChain` (`:1842-1847`: “`const next = lifecycleChain.then(fn, fn);`”).
An explicit init already queued ahead of the fallback init can consume the
marker; the fallback init can then re-arm `"fresh"` and allow governor init.
No ordinary UI interleaving was reproduced.

**CONFIRMED — one new test comment overstates a test limitation.**
`runtimeGovernorFallbackWiring.test.ts:51-52` says “`no Jest test can execute it`”.
That is false: `streamAssistantTurn` is exported and can be invoked under Jest
with mocked context/native dependencies. The current test is shape-only: its
`:54-60` `indexOf` assertions can stay green if a matching increment is moved
into a comment before `withEngineJob`, while runtime code increments later or
never reaches it. It also does not execute either shell callback or the queued
retry scenario. The `governorRuntime.ts:55-57` comment itself is true.

### Verification and limits

- `npx jest --runInBand src/engine/governorRuntime.test.ts src/engine/runtimeGovernorFallbackWiring.test.ts > /tmp/audit-a1-round3-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-round3-jest.log` — **EXIT=0**, 2 suites / 24 tests.
- `npm run typecheck -- --pretty false > /tmp/audit-a1-round3-tsc.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-round3-tsc.log` — **EXIT=0**.
- `npx jest --runInBand > /tmp/audit-a1-round3-full-jest.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-round3-full-jest.log` — **EXIT=0**, 116 suites / 1,454 tests.
- `git diff --check 5b7aecad..HEAD > /tmp/audit-a1-round3-diffcheck.log 2>&1; echo "EXIT=$?"; tail -30 /tmp/audit-a1-round3-diffcheck.log` — **EXIT=0**.
- `wc -l`: `LlamaService.ts` 6,432; `governorRuntime.ts` 142; `governorRuntime.test.ts` 227; new wiring test 62. The oversized LlamaService predates this round; no new file approaches 350 lines.
- Not verified: recovery on either phone, a real concurrent lifecycle/FIFO race, or behavior under the upcoming UX shell at runtime. App worktree remains unchanged at `73c552f01583cadf300ab24f8dec4782f3060314`.
