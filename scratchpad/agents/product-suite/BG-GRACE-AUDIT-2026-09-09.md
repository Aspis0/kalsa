# HOSTILE AUDIT #3 — background grace (backgroundGrace.ts + AppShell wiring)
Diff: AppShell.tsx (156+/126−) + backgroundGrace.ts/.test.ts (new). 4/4 tests pass; tsc exit 0.

## Angle 1 — body equivalence + gen-capture timing
- CONFIRMED: byte-for-byte equivalent (normalized diff old onAppState-background body vs new discardBackground): only delta is reason:"background" → reason:"background",graceMs:BACKGROUND_DISPOSE_GRACE_MS (AppShell.tsx:2916-2917). All steps preserved in order: Round-8 FIX 3 capture, regen abort, lifecycle await, ≤5s busy-wait + bail, saveEngineSession, gen-clear, dispose, markChatReleased fallback, finally reset + discardGenerationRef bump. REFUTED (no body drift).
- CONFIRMED (real semantic shift): FIX 3 gen capture now happens at grace expiry, NOT background entry. New background branch is just: "if (discardInFlightRef.current) return; backgroundGrace.onBackground(discardBackground); return;" (AppShell.tsx:2979-2981) — discardInFlightRef is not set at entry; discardBackground sets it (:2819-2820) and captures releasedGenBg only 45 s later. A turn started DURING the grace acquires a newer gate gen; at expiry discardBackground aborts regen + runs the AiChatPage lifecycle which kills that new turn. Old code could never discard a turn that started after the background event. Memory-safe (gen guards :2926-2936) but the contract changed: "discard session as of background time" → "discard whatever runs 45 s later". User backgrounds, resumes PiP/split-screen streaming → turn aborted at +45 s with chat.unloaded. PLAUSIBLE→CONFIRMED (undocumented contract change).
- REFUTED (double-schedule): backgroundGrace.ts:24 "if (pending !== null) return;" + test 3 (:38-48).

## Angle 2 — races
- bg → completion+save → grace fires → discard abort+save on idle engine: saveEngineSession idempotent (kvReproducible-gated, AppShell.tsx:2900-2910), busy-wait bails on re-claim. CONFIRMED correct.
- bg → fg within grace → send → bg again: onForeground cancels (AppShell.tsx:2952-2955), pending=null, fresh schedule works; discardInFlightRef only touched by the body finally (:2940). Consistent. REFUTED (no bug).
- bg → grace expiry → discard in flight → fg mid-discard: fg cancels only the pending timer, never the in-flight async body — same as old (old discard was equally async past its sync entry). User sees: turn aborted, partial text finalized, model unloaded, chat.unloaded banner, reload on next send. cancelBackgroundGrace during in-flight discard returns false (pending nulled at expiry, backgroundGrace.ts:26) and cannot touch discardInFlightRef. CONFIRMED equivalent-to-old. REFUTED (no regression).

## Angle 3 — Android/Doze reality (the serious one)
- CONFIRMED (regression on process death): the grace can turn a formerly-saved session into an unsaved one. Old: background → sync abort → lifecycle turn-end save → saveEngineSession in discard body, kicked within ~ms of backgrounding while JS time is guaranteed. New: NOTHING happens for 45 s. RN timers do run in background for a while (headless JS), but Doze/app-standby can freeze, and LMK can kill — a 1.56 GB engine + KV is a prime kill target, and the comment "shorter than the OS background-kill horizon on the supported phones" (AppShell.tsx:324-328) is an unproven constant on an S23 under 2 GB swap pressure. On kill-before-expiry: no abort, no saveEngineSession, no gate release. Chat TEXT survives (persistActiveMessages at turn end, AiChatPage.tsx:2742-2750) but the .kvs session + instant-restore are lost — exactly what the old immediate path saved for a turn aborted mid-flight. Verified no other background save exists (only AiChatPage turn-end :2715-2719 and edit path :1356). CONFIRMED.
- REFUTED (timer-frozen concern for the common case): user app-switch <45 s works; the failure mode is the kill, not the timer.

## Angle 4 — pressure path
- CONFIRMED guard correct: "if (backgroundGrace.isPending()) { cancelBackgroundGrace(); discardBackground(); }" (AppShell.tsx:2971-2974) — foreground pressure with no pending grace only logs, preserving old behavior.
- CONFIRMED onPressure is the ONLY pressure signal (no onTrimMemory anywhere; monitor.ts interval 15 s + AppState). Grace pressure-cancel depends on a poll landing inside the 45 s window AND MemAvailable dropping; hard OOM between samples uncaught (pre-existing).
- PLAUSIBLE (race, narrow): the 15 s interval callback can fire after the AppState "active" event is queued — if the pressure tick wins the ordering, cancel+discard runs while the user is already back in foreground (foregrounding does not cancel an already-firing pressure tick). Old code never discarded on pressure at all, so this is a new foreground-visible unload; narrow window, benign banner.

## Angle 5 — unmount cleanup
- Cleanup runs disposed=true; cancelBackgroundGrace(); handle.stop() (AppShell.tsx:3039-3042). An in-flight discard continues past unmount: discardBackground never checks `disposed` (guard exists only at :2967/:2978 callback tops), so saveEngineSession + disposeEngine + setState(setProcessUnloadedReason/setMemoryBannerKey) run post-unmount. Identical shape to old code (old async body had the same property). PLAUSIBLE (same-as-old, not a regression). REFUTED as regression.
- REFUTED (leak): timer cancelled on cleanup; test 4 covers cancel-idempotency.

## Angle 6 — tests / exports
- 4 tests cover ONLY the pure scheduler (run-after-grace :15-25, fg-cancel :27-36, no-double-schedule :38-48, cancel :50-59). NOT covered: AppShell wiring (zero tests), pressure-cancel+immediate-discard, grace-expiry-vs-new-turn contract (the very behavior that changed), kill-before-grace. CONFIRMED.
- Exports: createBackgroundGrace is the only export, used at AppShell.tsx:199/:2947; cancel used :2954/:3041. No dead exports. REFUTED.
- jest 4/4 pass; tsc --noEmit exit 0.

## Verdict + minimal fix list (ranked)
1. CONFIRMED — Save-early/dispose-late: at background entry run ONLY the lifecycle abort + saveEngineSession (cheap, guaranteed JS time); schedule only disposeEngine at +45 s. Restores the old data-safety invariant while keeping the battery win — eliminates the Angle-3 regression entirely.
2. CONFIRMED — capture releasedGenBg at background entry (pass into discardBackground), or refuse to abort at expiry if sendingInFlightRef became true after scheduling (pin the chosen contract in a test).
3. PLAUSIBLE — pressure-tick-after-active race: re-check AppState.currentState inside the pressure branch before discarding.
4. Test wiring + the expiry-vs-live-turn contract.

## Verdict summary
- CONFIRMED: body byte-equivalent; gen-capture moved 45 s later with a real contract change (can abort a turn started during grace); process-death regression (session save lost vs old immediate path — the fix's own battery scenario); wiring untested.
- REFUTED: body drift beyond graceMs log field; double-schedule; fg-mid-discard regression; timer-leak; dead exports.
- PLAUSIBLE: pressure-tick-after-foreground race; post-unmount discard continuation (same as old).
