# AUDIT-SHIP-APP — second, independent, hostile review (app worktree `kalsa-wt-bench-apk`, `ca2dcc0..041eec6e`)

**VERDICT: SHIP-WITH-FIXES** — no functional blocker found in any reachable schedule; two one-line
hardening/comment fixes requested below (F1 capture-at-entry, F2 comment accuracy). Everything else
I attacked held. Earlier reviews (AUDIT-P1-*, AUDIT-A1, A1.md, APP-PIN.md) were not used as evidence;
every claim below was re-derived from the code.

Reviewed 2026-09-23. Range: `1228836f` (P1), `66e7befb`→`cff955da` (A1, 5 commits), `041eec6e` (pin).
Worktree clean at review time.

## Commands run (all in `/Users/marco/Projects/kalsa-wt-bench-apk`)

- `npx tsc --noEmit > /tmp/ship-app-tsc.log 2>&1; echo "EXIT=$?"` → **EXIT=0**
- `npx jest src/engine/governorRuntime.test.ts src/engine/governorInputs.test.ts src/engine/runtimeGovernorFallbackWiring.test.ts ...` → **EXIT=0**, 37/37
- `npx jest` (full) → **EXIT=0**, 116 suites, **1455/1455**
- `bash scripts/assert-engine-provenance.sh` → **EXIT=0**:
  `[provenance] lockfile pins Aspis0/kalsa.rn@42087667fcf7` / `OK: 1119 files match` /
  `engine inside it: kalsallama@56f79e6cb81e == native/kalsallama.pin`

## Angle 1 — security and privacy: CLEAN (no finding)

- The new line (`src/engine/LlamaService.ts:2813`): `console.log(\`KALSA_GOVERNOR_RUNTIME_FALLBACK ${JSON.stringify({ reason })}\`);`
  — `reason` comes only from `governorRuntimeFallbackReason` (`src/engine/governorRuntime.ts:66-74`):
  `message.slice(GOVERNOR_DECODE_FAILED_PREFIX.length).trim().replace(GOVERNOR_REASON_UNSAFE, "").slice(0, GOVERNOR_REASON_MAX_LEN)`
  with `GOVERNOR_REASON_UNSAFE = /[^A-Za-z0-9 _.,:+=\/-]/g` and `GOVERNOR_REASON_MAX_LEN = 120`. Charset-bounded,
  length-capped, JSON-escaped: no newline/quote injection into logcat, no prompt or model text can pass.
- The reason's native sources are all fixed machine strings — binding `cpp/jsi/RNLlamaJSI.cpp:1312`
  `"Governor decode failed: " + ctx->governorFailureReason()`; engine (vendored @56f79e6)
  `llama-governor.cpp:164/167/172/209` (`fail("governor is failed")` etc.), `llama-governor-runtime.cpp:51/124`,
  and the snprintf at `llama-governor.cpp:220-222` (`"llama_decode failed with rc=%d"`). No user content reaches the suffix.
- The module's own doc comment honestly declares the residual limit: "not semantically filtered, so prose
  or paths made of allowed characters still pass through" (`governorRuntime.ts:60-62`). Bounded and honest — accepted.
- Telemetry: `reportChatGenerationTelemetry` passes `rawMessage: errObj.message` (`LlamaService.ts:3054-3058`) but
  `sanitizeReport` consumes it only via `extractSignal` (`src/telemetry/pure.ts:325`: `signal = extractSignal(input.rawMessage)`);
  type doc: "Raw message ONLY for extractSignal — never stored/sent as text" (`telemetry.ts:891`). Pre-existing pattern, not worsened.
- `console.warn("[toolRoundsExhausted] fallback completion failed", fallbackError)` (`LlamaService.ts:5475`, pre-existing line)
  now also carries governor rejections that don't qualify for the fallback (remote turn, second failure) — machine text only.

## Angle 2 — A1 races/bugs: no reachable functional bug; one latent fragility, one comment inaccuracy

- **F1 — PLAUSIBLE (latent; unreachable in the current app). Turn token captured at catch time, not turn entry.**
  `LlamaService.ts:5533` `turnToken: turnTokenSeq,` — captured inside the job's catch. A send landing between the
  turn's start and the failure would already have bumped `turnTokenSeq` (`LlamaService.ts:4082` `turnTokenSeq += 1;`
  runs at function entry, before `withEngineJob`), so the attempt would adopt the *newer* turn's token and the gate
  (`turnStillCurrent: turnTokenSeq === attempt.turnToken`, `LlamaService.ts:5579`) could not see it — defeating exactly
  what the comment at 497-501 promises ("a newer send must not be raced by an old retry"). **Why it is not live:** every
  path that lets a second `streamAssistantTurn` start first aborts the old turn or is blocked — `handleSend` blocks
  synchronously on `sendingRef.current` (`src/screens/AiChatPage.tsx:2237`), conversation switch aborts before clearing
  `sendingRef` (`AiChatPage.tsx:1869-1877`), model switch and regenerate are refused while streaming
  (`AppShell.tsx:4962`, `5080-5092`); an aborted/stopped turn can never produce an attempt (`LlamaService.ts:5512-5516`
  checks `stopped` first), and during the reload the original `await streamAssistantTurn(...)` has not resolved, so
  streaming stays true. Fix when convenient: capture the token at job entry (or capture `turnTokenSeq` before the
  entry bump), not at catch time.
- **Double onDone — REFUTED.** The attempt path returns before any `finishOnce` (`LlamaService.ts:5531-5535`); `endCurrentTurn`
  calls `onDone` once (`5587-5590`); the retry creates a fresh `finishOnce`; AppShell's `finish` is idempotent
  (`AppShell.tsx:5832` `if (settled) return;`).
- **Stuck UI (turn never gets onDone) — REFUTED.** Every continuation branch ends the turn or returns after which
  AppShell's safety net runs: `AppShell.tsx:7160-7162` `// Safety: if the stream returns without onDone/onError ... armMemoryExtract(); finish();`
  — the `.then` chain is inside the awaited promise, so even the "stale → no callbacks" branch (`LlamaService.ts:5614-5618`)
  resolves the outer promise and clears `streaming`. The reload-failure branch surfaces via `emitEngineError` (`5609`).
- **Retry against a disposed/replaced context — REFUTED.** The reload precedes the retry and the idempotent skip is
  denied to it: `LlamaService.ts:2391-2393` `// A runtime fallback's reload must never take this idempotent skip: ... !governorRuntimeOff`.
  Post-reload, `activeModelId === attempt.modelId` is re-checked (`5580-5581`).
- **Reload running when it must not — REFUTED.** Gates: local turn only (`5465`, `5522`: `isLocalTurn: !isRemoteEngineBackend()`),
  never after abort (`5466`, `5523`: `aborted: Boolean(aborted || signal?.aborted)` — and `stopped` is checked before at `5512-5516`),
  once per load (`5467`, `5524`: `fallbackUsedForModel: runtimeGovernorState !== "fresh"`); `remoteSettings.ts` imports nothing
  from LlamaService (no cycle). The reload is forced CPU-only regardless of governorLoad: `2576` `if (governorLoad || governorRuntimeOff) {`
  and `2587` `enabled: !governorRuntimeOff,`; the GPU retry on failure is also skipped for it (`2650`).
- **Once-per-model flag re-arming — REFUTED as a bug; behaves as documented.** `2238-2243`: `if (runtimeGovernorState === "fallback-reload") { runtimeGovernorState = "fallback-consumed"; } else { runtimeGovernorState = "fresh"; }`
  — only the fallback's own reload takes the consumed path; any explicit load re-arms ("the governor stays off until the
  next explicit load", `365-367`). `withLifecycleLock` queues (`1842-1849`), never rejects, so the armed
  "fallback-reload" state always reaches its transition. After the reload `activeGovernorKey = "off"` (`2701`,
  via `governorUsed = !governorRuntimeOff && !result.retried` at `2595`), so a later same-args load does not skip-reuse it.
- **KV/boundary state across the reload — REFUTED.** `initEngine` awaits `disposeEngineLocked` (`2408`), which resets
  `dropChatKvHold(true)` and `lastAssembleBoundary = undefined` (`2903-2908`), so the cold re-prefill cannot assemble
  against a boundary the empty KV does not hold. The retry re-sends the same `messages` by value (`5633`), so the user
  message is not double-appended (verified against AppShell's assembly at `7032-7056`: history is rebuilt per send).
- **`onDelta("", "")` really clears the partial — CONFIRMED.** Bridge forwards `full` (`engineCallbackBridge.ts:55-58`),
  AiChatPage pushes into an overwriting coalescer (`AiChatPage.tsx:2572-2582` `streamCoalescer.push(full)` with
  `updateMessage(assistantId, { text: fullText }, ...)`); `onDeltaFull` also resets `assistantFull = ""` (`AppShell.tsx:7090-7092`).
  The failed attempt's `modelEmittedText` is NOT stale: only the abort/clean paths emit it (`4191`, emitFinalText), neither
  of which ran on the attempt path.
- **F4 — CONFIRMED, cosmetic.** In the "ended" ending the clearing delta forces `anyTextStreamed = true`
  (`AiChatPage.tsx:2574-2576` sets it before the staleness check), so the abort-during-reload case skips the empty-placeholder
  removal (`AiChatPage.tsx:2759-2767`) and can leave an empty bubble flagged interrupted; the failed attempt's thinking text
  also lingers (never cleared). Cosmetic, not ship-blocking.

## Angle 3 — P1: CONFIRMED correct and correctly scoped

- Binding (`~/Projects/llama.rn-kalsa` @ 42087667, the pinned commit) `cpp/rn-llama.cpp:88`: `decode_params.no_extra_bufts = true;`
  — inside `load_governor_models`, unconditional: no device/low-memory condition anywhere in the function. The governor
  decode model never allocates the CPU repack copy, on any device.
- App side `src/engine/governorInputs.ts:97-100`: comment "The lane's decode model loads with no_extra_bufts=true (binding:
  rn-llama.cpp load_governor_models), so no CPU repack copy exists here; pricing one demanded ~W of memory the lane never
  allocates." followed by `repack: false,` (line 100). Device-agnostic, matching the unconditional binding flag — the
  "applies to every device" reading is the code's behaviour and its comment's claim. The pre-P1 caller priced the lane with
  the *app-level* flag (`git show ca2dcc0:src/engine/LlamaService.ts` line 2289: `repack: !load.noExtraBufts,`), which is
  about the main context — wrong input for the lane.
- The MAIN context estimate still prices repack where it should: `LlamaService.ts:2326` `repack: !load.noExtraBufts,` —
  P1 touched only the lane. Correct scoping.
- Gate arithmetic re-derived by hand from the registry (`ModelRegistry.ts:272-293`: LFM2.5-2.6B, sizeBytes 1,593,894,944,
  kvBytesPerToken 6656) and `memoryEstimate.ts` constants (COMPUTE_MIB_AT_UBATCH_256=249, REPACK_FRACTION≈0.895):
  mmap on, repack off, ctx 8192 → nonEvictable 301 MiB; gpuReserve 800+1.05·1520.09=2396.1; required =
  301+2396.1+249+52 = **2998.1 MiB** (test comment: 2998.06 ✓). With repack priced back: +0.895·1520.09 ≈ +1360.6 →
  **4358.7 MiB** (test comment: 4358.70 ✓). The double compute+KV term is the two-context (GPU prefill + CPU decode) lane,
  each context owning its own compute and KV — consistent with `load_governor_models` loading two full models
  (prefill n_gpu_layers=99, decode n_gpu_layers=0).

## Angle 4 — the pin: CONFIRMED, provenance green

- `package.json` and `package-lock.json` (both deps block and `node_modules/llama.rn.resolved`+integrity): `github:Aspis0/kalsa.rn#42087667fcf7fd34a7ac7bc37aea31fea738b610`.
- `native/kalsallama.pin`: `56f79e6cb81ed8a802a069ded6c63922a3dc9e06`.
- Binding checkout at that commit has `vendor/VERSIONS`: `LLAMA_CPP_COMMIT=56f79e6cb81ed8a802a069ded6c63922a3dc9e06`.
- `bash scripts/assert-engine-provenance.sh` → **EXIT=0** (output quoted at top). Chain intact.

## Angle 5 — tests: green, and the important guards are not vacuous

- Full suite **1455/1455, EXIT=0**; tsc **EXIT=0**.
- P1 guard is real: the fixture `memory` (`governorInputs.test.ts:51-56`) sets no `repack` key, and `estimateMemory`
  defaults it to on (`memoryEstimate.ts:146` `const repack = input?.repack !== false;`). Reverting P1 to
  `repack: memory.repack` re-prices ~1360 MiB and flips the `2999 MiB → "Fit"` assertion red — for the right reason,
  at the exact pin (2997 already NoFit).
- Prefix matching: positives use string literals, never the module constant (`governorRuntime.test.ts:114-117`
  "Literals on purpose, never the module's constant") — prefix drift goes red. Decision tables cover remote/abort/once
  and all three endings incl. "stale outranks ended".
- Wiring guard (`runtimeGovernorFallbackWiring.test.ts`) is source-text shape-checking; it catches deletion/reorder of the
  load-bearing lines (e.g. `enabled: !governorRuntimeOff`, the two `governorLoad || governorRuntimeOff` sites, bump-before-job).
  **What it cannot catch (honestly declared in the file):** behaviour of the continuation itself — a control-flow bug inside
  the `.then` that still contains the checked substrings stays green. This is the residual test gap; acceptable given
  LlamaService value-imports llama.rn (unmockable in Jest) and precedent exists (`kvShiftRefuse.test.ts`), but it is the
  first place a future regression will slip through.
- No mutation runs were possible under the read-only constraint; guard strength was verified by hand-arithmetic
  (P1) and by construction (literals/decision tables) instead.

## Angle 6 — clean code

- New/changed modules are small and single-purpose: `governorRuntime.ts` 144, `governorRuntime.test.ts` 237 (split by
  describe-topic, not a case list), `runtimeGovernorFallbackWiring.test.ts` 63, `governorInputs.ts` 218. No convenience
  re-exports, no unused exports (all three new functions consumed by LlamaService + tests), no secret values.
- `LlamaService.ts` is 6441 lines (+~200 from this diff) — a pre-existing God file. The pure decisions were correctly
  extracted to `governorRuntime.ts`; the remaining wiring is inseparable from the turn driver without the refactor the
  rules forbid. **Nit:** I found no place where this file's pre-existing excess is *declared* (checked AGENTS.md,
  docs/CODER-BRIEF.md) — worth a line somewhere, but not this diff's job.
- **F2 — CONFIRMED (comment accuracy).** `LlamaService.ts:2821-2822`: "Unreachable while a context is loaded: lastLoadArgs
  is written by every completed initEngine" — the idempotent-skip return (`2395-2397` `loadOk = true; return { effectiveNCtx };`)
  completes initEngine *without* writing `lastLoadArgs` (written only at `2783`). The declared invariant itself still holds
  (a live context implies at least one full load, and the skip only fires when the active context matches the request, so
  `lastLoadArgs` mirrors what is loaded) — but the justification sentence is literally false and should be reworded.
- Commit messages follow the house rule (repo @ detached HEAD named in each; no push; worktree clean).
- New comments state WHY and traps, with one inaccuracy (F2) and one invariant that holds only thanks to UI-side guards
  outside this module (F1's comment) — both listed as fixes.

## Fixes requested (both one-liners, neither blocking correctness today)

1. **F1:** capture the turn token at `streamAssistantTurn` entry (before the bump) or at job start, and put that value in
   the attempt — so the engine-side invariant stands without leaning on the shells' send-blocking.
2. **F2:** reword the `lastLoadArgs` comment (written by every *loading* initEngine; the skip path intentionally leaves it,
   and why that is still safe).

## Not verified

- No on-device run (no phone session was taken; the A1 path's native behaviour was verified from binding/engine source at
  the pinned commits, not on hardware).
- The non-JS harnesses (`harness:markdown`, `harness:telemetry`, `harness:research`, `harness:campaign`, `harness:profile`)
  were not run — the diff touches none of their inputs; jest + tsc + provenance cover the changed surface.
- Earlier audits' conclusions (AUDIT-P1-*, AUDIT-A1, A1.md, APP-PIN.md) were deliberately not read as evidence.
