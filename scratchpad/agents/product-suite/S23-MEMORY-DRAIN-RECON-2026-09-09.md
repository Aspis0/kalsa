# S23 memory recon — main@5707cfe (read-only)

Field incident: 10 min after a normal turn (6.9 tok/s decode), next turn = fit allow:true / liveness absent, mlock fail 374 MB, 2112-tok prewarm 286 s, decode 0.06 tok/s, 2× turnInterrupted (engine!==context), swap 2 GB/4 GB, 52→28 % battery in 65 min / 5 questions.

## Q1 — Send-time admission (KALSA_SEND "fit")

**CONFIRMED.** Computed in `awaitPreSendFitGate`, src/screens/AiChatPage.tsx:1875 (`const awaitPreSendFitGate = useCallback`). The observed log line is the `!mid` early-allow branch, AiChatPage.tsx:1888-1899:

> 1888:  `KALSA_SEND ${JSON.stringify({
> 1889:            phase: "fit",
> 1890:            liveness: liveness.status,
> 1891:            alreadyResident: false,
> 1892:            recoverLost: false,
> 1893:            allow: true,
> 1894:            reasonKey: "no_active_model",
> 1895:          })}`

Why allow:true + liveness:absent: at :1880 liveness comes from `probeAndReconcileEngine({ busy: !!sendingInFlightRef.current })`; at :1897 `if (!mid) { …allow:true… }` — when `getActiveModelId()` is null and no lost mark exists, the gate **returns allow BEFORE reading any memory input**. The comment at :1896 states it: "No active model and no lost mark → allow; ensureEngineForModel will surface load errors." So `allow:true` here means "no model selected to gate", not "memory fits".

- It DOES read device memory later — but only when a model id exists: :1906-1910 `available = await getAvailableMemoryBytesUncached();` (try/catch → null). So the gate never sees MemAvailable on tonight's path (no_active_model short-circuits before :1906).
- Inputs actually fed to the decision (:1911-1929): model.sizeBytes, engineCtx, kvBytesPerToken, mmproj size, loadPolicy, `available`, plus flags alreadyResident / recoverLost / lostModelId / requestedModelId / benchNoRepack. NO KV-cache size of a fresh load, no prewarm-token estimate.
- The second log site :1938-1950 includes `availableMb` — the observed line has no availableMb field, which positively identifies the !mid branch (alreadyResident:false + missing availableMb in the user's log confirms it verbatim).
- Liveness semantics: engineLiveness.ts:75 `if (!input.jsReady) return { status: "absent" };` — "absent" = JS wrapper gone (`isEngineReady()` false), i.e. the model had already been unloaded between turns (matches mlock-on-cold-load). decideEngineLiveness never reads RSS by design (:60-63 "Telemetry only").
- Pass-through verdict: gate returns ok:true → load proceeds in ensureEngineForModel; the only memory re-check after that is modelGateRAM at init, not this gate.

## Q2 — mlock

**CONFIRMED.** Requested unconditionally at src/engine/LlamaService.ts:1461:

> 1461:      use_mlock: true,

inside the ContextParams built in initEngine (no platform condition, no override path — engineParams.ts's EngineOverrideFields deliberately has NO use_mlock field, engineParams.ts:28-40 documents why).

Failure semantics: the `KALSA_NATIVE warn: failed to mlock 374902784-byte buffer: Out of memory` comes from llama.cpp via llama.rn — a **warning only**. engineParams.ts:36-38:

> 36:   * 64 MB soft AND hard (measured 2026-08-23), so `use_mlock` cannot hold a
> 37:   * multi-GB model and llama.cpp only warns when mlock fails — it would look
> 38:   * like a run rather than a refusal.

So: RLIMIT_MEMLOCK on a retail S23 = 64 MB; the 375 MB buffer (KV/compute, not the mmap'd 1.56 GB weights) fails to lock, llama.cpp continues unlocked, the app receives no error and shows **no banner / no user warning** (grep for mlock outside these two files: only engineLiveness.ts comments — no UI string, no reasonKey, no telemetry field). Weights are mmap'd anyway (loadPolicy.ts:20-22 default `mmap: true`, "page-cache backed, reclaimable by the kernel under pressure"), so under swap pressure the kernel evicts file-backed weight pages → prewarm 286 s / decode 0.06 tok/s are the re-page-fault storm the design *expects* under pressure (engineLiveness.ts:4-12). mlock failure is cosmetic here; the real eviction driver is mmap+swap.

## Q3 — Engine dispose mid-turn paths

All dispose paths funnel through `disposeEngineLocked` (LlamaService.ts:1823) / `disposeEngine()` (:1819). In-flight-turn protection: `bailIfStopped` (LlamaService.ts:3060-3087) checks `if (disposing || engine !== context)` → emits `strings.errors.turnInterrupted` at :3083 — exactly tonight's interrupt. Callers of disposeEngine in AppShell:

1. **Background unload** — AppShell.tsx:2817-2932: `startMemoryMonitor({ intervalMs: 15_000, onAppState })`; on `"background"` (:2847) it aborts regen, runs AiChatPage lifecycle (abort stream), waits ≤5 s on stream/send/regen/claim refs (:2870-2886), bails if still busy, else `disposeEngine()` at :2917. Fires on screen-off/home. NOT tonight's cause (phone was in use), but it's the "engine pulled from under a turn" path if a turn outlives 5 s + lifecycle — the 5 s bail is the only guard.
2. **Thermal hard gate (CONFIRMED candidate — no user action needed)** — AppShell.tsx:3162-3227 edge effect: `useThermalHardGate` (AppShell.tsx:731) fires on `PowerManager.getCurrentThermalStatus() >= CRITICAL` (thermalHardGate.ts:49-51, Android status ≥ 4). On rising edge it aborts regen + invalidates generation (:317与企业1-3172), waits the same ≤5 s on in-flight refs, then `runNativeOp(() => disposeEngine())` at :3210, logging `model.unload reason:"platform_thermal_critical"` (:3213). Phone at 38 °C unplugged, S23 in hand — SEVERE (2) does not gate but sustained decode at 0.06 tok/s keeps the SoC pinned; CRITICAL can be reached with the screen on. The it.ts:519 string "Il modello è stato rimosso dalla memoria per far raffreddare il dispositivo" (it.ts:519) is `thermalHardGateBody` — shown when this path already unloaded (also `chat.thermalHardGateBody` refusal at AiChatPage.tsx:2059).
3. **Foreground pressure transition** — monitor.ts:144 `opts.onPressure(bytes)` fires every 15 s sample with MemAvailable; AppShell's onPressure (:2830-2841) only logs `pressure.transition` — it does NOT dispose. No onTrimMemory handler exists (grep: zero hits). So memory pressure alone never unloads; but the foreground transition (AppState → active) triggers `evaluateModelFit` (comment AppShell.tsx:2823 "Foreground -> evaluateModelFit") — reload, not dispose.
4. **Model switch** — AppShell.tsx:3803 dispose inside switch (gated on `!sendingInFlightRef.current` for the save; dispose itself runs after the same wait); tonight N/A (no switch).
5. **markEngineLost** (LlamaService.ts:1093-1110) — dispose with `neverForceRelease` when a send-path tokenize ping times out (engineLiveness). Tonight's probe returned "absent" (jsReady false), not "lost", so this did not fire.
6. **Prewarm re-init** — prewarm does NOT re-init: it runs `engine.completion({ n_predict: 0, … })` on the live context (LlamaService.ts:777-789). It cannot dispose; it can only stall the FIFO behind a 286 s prefill (it's a `withEngineJob` — FIFO join, LlamaService.ts:712-714 comment).

## Q4 — Decode watchdog

**CONFIRMED: none exists.** No per-token or per-turn rate check anywhere (grep watchdog/stall/progressTick: only AiChatPage.tsx:1722 `stopWatchdogRef` = "3s recovery if abort never settles native completion" — an abort-settle watchdog, not a rate watchdog).

- The streaming callback that sees every token — the natural fail-fast home — is the onToken closure at LlamaService.ts:3284-3298 (`(data: TokenData) => { … callbacks.onDelta(delta, streamedText); }`). It only appends text; it does NOT record timestamps.
- Per-round timings exist only AFTER the round completes: LlamaService.ts:3312-3326 `emitTurnTelemetry(turnId, round, result, …)` → turnTelemetry.ts:176-178 `promptMs: timings?.prompt_ms ?? -1, predictedMs…, predictedPerSecond: timings?.predicted_per_second ?? -1`. That is where tonight's 0.06 tok/s was measured — post-mortem, after the 259.7 s round had already burned battery.
- Turn-level deadline: none for the stream turn. `COMPLETE_ONCE_TIMEOUT_MS = 120_000` (LlamaService.ts:4120) applies ONLY to util `completeOnce` jobs (:4198 timer → stopCompletion), not to `streamAssistantTurn`'s rounds at :3253. A chat turn runs until EOS / n_predict / user abort / engine-swap bail. So a 0.06 tok/s turn runs to completion: 15 tokens ≈ 259 s is consistent, and a full n_predict at that rate would run for hours.
- The governor (governorRuntime.ts) re-reads thermo BEFORE each completion (LlamaService.ts:3249 `refreshGovernorBeforeCompletion`) — it throttles load params per round, it does not abort a round already running.
- Prewarm likewise has no time cap: it is a plain awaited completion (LlamaService.ts:776-789) on the FIFO; a 286 s prefill is only observable via `KALSA_SESSION {op:"prewarm"}` logs after the fact.

## Q5 — Battery / energy telemetry

**PLAUSIBLE (exists, but NOT per turn).**
- `KALSA_TELEMETRY` (turnTelemetry.ts:191-198 `formatTelemetryLine`) carries round counters + timings ONLY (RoundTelemetry fields, turnTelemetry.ts:123-147: tokensCached/evaluated/predicted, draft*, promptMs, predictedMs, predictedPerSecond, contextFull, interrupted, tool, strategy, ciswireFlags). **No battery field** (grep battery in turnTelemetry.ts: zero hits).
- Battery exists in two other, non-turn-correlated places:
  - `useBatteryEta` hook (src/hooks/useBatteryEta.ts:2-9) polls expo-battery and feeds batteryEta.ts slope estimator (%/hour over ≥10 min window — batteryEta.ts:48-55 gates). AppShell.tsx:2598 "C7 — slope ETA from expo-battery level samples. Advisory only". Samples are not attached to KALSA_TELEMETRY lines; drain-per-turn can only be derived by correlating wall-clock timestamps of KALSA_SEND/KALSA_TELEMETRY with the ETA window.
  - `src/agent/deviceTools.ts:53-56` exposes battery level to the MODEL as a tool (expo-battery), not to logs.
- So tonight's 52→28 % in 65 min / 5 questions is not reconstructable per-turn from telemetry alone; you can reconstruct per-turn WALL TIME and predictedPerSecond (KALSA_TELEMETRY per round), and prewarm cost from KALSA_SESSION prewarm lines.

## Root-cause chain (evidence-linked)

1. Between turns the engine went absent (fit log `liveness:"absent"`, AiChatPage.tsx:1890) — most plausibly the **background-dispose path fired when the screen/app state blipped** (AppShell.tsx:2847-2917) or the process was reclaimed; the next send short-circuits the fit gate at the `!mid` branch (:1897) with **no MemAvailable read**.
2. Cold reload: mmap=true (loadPolicy.ts:20-22) + `use_mlock: true` (LlamaService.ts:1461); mlock of the 375 MB buffer fails (64 MB RLIMIT, engineParams.ts:36-38) with a WARN only — nothing surfaces.
3. 2 GB swap already holding file-backed weight pages → prewarm 2112 tok = 286 s, then decode 0.06 tok/s; no watchdog (Q4), so the turn crawls to EOS; the 15 s pressure monitor only logs (AppShell.tsx:2830-2841).
4. Two turns die with `turnInterrupted` (LlamaService.ts:3083) — a dispose fired mid-round (thermal edge effect :3210 or background :2917 — both wait only ≤5 s on in-flight refs before disposing; a multi-minute crawl at 0.06 tok/s started >5 s earlier would already have been aborted by the lifecycle, but the observed interrupts indicate a dispose won the race in the background/thermal path or `markEngineLost` from a ping timeout).
5. Every crawled second is CPU-maxed re-paging from UFS + zram → the 52→28 % drain. Total latency per question ≈ 5 min (286 s prewarm + 260 s decode), ×5 questions ≈ 45-50 min of pinned CPU — matches 65 min wall.

## Smallest change-set that would have prevented tonight's drain (ranked)

1. **Fail-fast stall watchdog in the token callback** (LlamaService.ts:3284-3298 — the exact hook that already sees every token): track wall time since last delta; if e.g. >30 s between tokens or predictedPerSecond extrapolation <0.5 tok/s after a grace window, `engine.stopCompletion()` + onError("turnInterrupted"/new reasonKey). Turns tonight would have ended in seconds instead of minutes; alone it caps the 65-min drain to ~a few minutes. CHEAPEST + highest leverage; reuses the existing 120 s completeOnce timer pattern (:4196-4200).
2. **Read MemAvailable on the no_active_model path too** (AiChatPage.tsx:1897-1908): even with no resident engine, refuse the cold load when MemAvailable < requiredBytes (estimateMemory via decidePreSendFit already computes it — just don't return early). Tonight the S23 with 2 GB swap used would likely have been "tight" → user gets model.tightNow instead of a 5-min crawl.
3. **Bound the prewarm** (LlamaService.ts:776): skip/abort when MemAvailable is low or when the prefill exceeds e.g. 30 s — a 286 s prewarm before a 260 s decode is pure waste on a thrashing device; skip is free because prefix-match KV only helps if it's fast.
4. **Stop requesting use_mlock on Android** (LlamaService.ts:1461) or gate it per RLIMIT: it locks nothing useful (64 MB cap, engineParams.ts:36-38), warns 375 MB, and adds a misleading breadcrumb; the mmap policy is what actually manages residency. (Cosmetic but removes the false signal that weights were ever pinned.)
5. **Dispose paths: treat an in-flight *crawling* turn as busy, not just in-flight** — the ≤5 s wait loops (AppShell.tsx:2870-2886, :3201-3209) only check in-flight booleans; since (1) exists, they'd rarely race, but a turn-level "bytes since last token" liveness shared with the watchdog would let background/thermal disposal distinguish "streaming" from "stalled" and dispose immediately — which is the CORRECT action for a stalled turn (it frees the 2 GB swap pressure), tonight's turnInterrupted then becomes the desired outcome instead of an accident.
6. **Log battery% in KALSA_TELEMETRY** (one expo-battery read per turn in emitTurnTelemetry) to make drain-per-question measurable in the field — diagnosis aid, not prevention.

Items 1+2+3 (≈3 small patches, all in files already heavily test-covered) would have prevented essentially all of the 65-minute drain: #1 caps per-turn wall time, #2 blocks the pathological cold load, #3 avoids paying the 286 s prewarm for a thrashing context.
