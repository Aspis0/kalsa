# LIFECYCLE-MODULE-AUDIT-2026-09-10 (hostile, read-only)

Subject: modules/kalsa-lifecycle/ (Kotlin module + TS wrapper, uncommitted) + backgroundGrace generic diff. Reference: modules/kalsa-thermal (shipping). Key context fact: nothing in src/ imports kalsa-lifecycle yet — AppShell still calls `createBackgroundGrace({ setTimeout, clearTimeout })` with JS timers (AppShell.tsx:2821-2825). This is Part-1 plumbing, inert until wired.

## Expo Modules event delivery while paused (the whole point)

- CONFIRMED: no `hasListeners` gate on the Kotlin send path. `Module.sendEvent` -> `moduleEventEmitter?.emit(name, body)` (node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/modules/Module.kt:46-48); KModuleEventEmitterWrapper.emit -> `emitNative` -> `JNIUtils.emitEvent(jsObject, runtimeContext.jsiContext, eventName, eventBody)` (events/KModuleEventEmitterWrapper.kt:47-58). Only gates: (a) `checkIfEventWasExported` (:61-68) — satisfied, `Events(BACKGROUND_TIMER_DID_FIRE, TRIM_MEMORY)` declared (KalsaLifecycleModule.kt:25); (b) `moduleHolder.safeJSObject ?: return` (:48-49) — the JS module object must exist, which happens when JS first touches the module. No listener-count gating exists (grep hasListeners/listenerCount in expo-modules-core/android: zero). So OnStartObserving is NOT required for delivery — but if JS never imports the module, safeJSObject is null and emits silently no-op (:49). Dead-until-wired, not broken-by-design.
- CONFIRMED: delivery survives pause. JNIUtils.cpp:177/:212 wrap the emit in `jsiContext->runtimeHolder->jsInvoker->invokeAsync(...)` — queued onto the JS thread via CallInvoker. JavaTimerManager only stops Choreographer-driven timer DISPATCH on pause (`onHostPause() { isPaused.set(true); clearFrameCallback(); maybeIdleCallback(); }` JavaTimerManager.kt:72-76; `clearFrameCallback` removes the TIMERS_EVENTS frame callback :141-150); the JS runtime itself keeps running, so a queued invokeAsync task executes. A main-looper Handler timer firing at +45 s while paused therefore reaches JS. (Residual caveat: Doze/app-standby can still freeze the whole process — this module fixes RN timers, not Doze.)

## Kotlin module

- CONFIRMED (blocker-class for Part 2): trim-memory registration is OnCreate-only and un-retried. `OnCreate { registerComponentCallbacks() }` (:35-37) with `appContext.reactContext?.applicationContext ?: return` (:79): if reactContext is not resolvable at module-definition time, registration silently never happens and `componentCallbacks` stays null forever — trimMemory forwarding dead for that module instance. kalsa-thermal sidesteps this by registering in `OnStartObserving` (KalsaThermalModule.kt:24-27), tied to JS observers. Fix: register lazily (first use) or move to OnStartObserving-equivalent.
- CONFIRMED (dev-reload leak, bounded): if reactContext is already null at OnDestroy (`?: return` :103), the callbacks remain registered on applicationContext pointing at a dead module; later onTrimMemory -> sendEvent throws into the swallow-all catch (:112-115) but the listener leaks for the process lifetime. Dev-reload only.
- REFUTED (thread safety): all map/counter access inside `synchronized(timerLock)` (:47-61, :65, :70-74); `return` inside synchronized is a standard inline-lambda non-local return. Main-looper Handler; runnable double-fire prevented by `timers.remove(id) != null` (:50-51); post-OnDestroy sends swallowed (:52-56). No leak/UAF path found.
- CONFIRMED (post-OnDestroy): OnDestroy cancels all timers (:39-42, cancelAllTimers :69-76). REFUTED as a bug.

## TS wrapper (src/index.ts)

- REFUTED (leak-on-fire / throw-path / double-remove): listener per timer with id-match + fired flag (:53-59), subscription removed on fire, on cancel, and on native throw (:62-65, :76-80). If `startBackgroundTimer` throws, cleanup runs and null is returned (JS fallback intact).
- CONFIRMED (minor): null result cached forever (`if (nativeModule !== undefined) return nativeModule;` :30-31) — first-call-before-registration would permanently disable native timers. Practically unreachable (expo modules register before JS runs); a retry-on-null would kill the class of bug.
- CONFIRMED (dead exports): TRIM_MEMORY_UI_HIDDEN (:24), TRIM_MEMORY_BACKGROUND (:25) — zero consumers. Flagged; PART-2 material as stated.

## Autolinking

- CONFIRMED equivalent to kalsa-thermal: same expo-module.config.json shape (`"android": { "modules": ["expo.modules.kalsalifecycle.KalsaLifecycleModule"] }` vs kalsa-thermal's identical format), package.json with main/types + expo-modules-core peer dep, `expo-module-gradle-plugin` build.gradle, empty `<manifest />`, Android-only consistent with platforms:["android"]. Autolinking default: `nativeModulesDir: options.nativeModulesDir ? ... : (resolvePathMaybe('./modules', appRoot) ?? null)` (node_modules/expo-modules-autolinking/build/commands/autolinkingOptions.js:170-174) + `expoAutolinking.useExpoModules()` (android/settings.gradle:30) — kalsa-thermal ships through exactly this convention with no app.json/package.json entry, so discovery is identical. REFUTED (missing config — nothing missing).

## Generic backgroundGrace + tests

- REFUTED (regression): diff is purely `type TimerHandle` -> generic `<H>` (backgroundGrace.ts:1-12); logic lines unchanged; old call sites compile via inference (tsc exit 0). The new test ("supports an injected handle type") drives a FakeHandle end-to-end (schedule stores run, cancel receives same handle, expiry runs once, isPending false) — meaningful Part-2 contract pin. 5/5 pass. CONFIRMED sound.

## Clean code / dead code (last)

- Dead exports: TRIM_MEMORY_UI_HIDDEN, TRIM_MEMORY_BACKGROUND (index.ts:24-25) — zero consumers, expected PART-2 material.
- CONFIRMED (the elephant): zero wiring. scheduleNativeBackgroundTimer/cancelNativeBackgroundTimer/addTrimMemoryListener have no callers in src/; the 45 s grace still uses JS setTimeout (AppShell.tsx:2821-2825). The original Jelly bug (grace never fires while paused) is NOT yet fixed by this diff — it becomes fixable in Part 2.
- File sizes fine (module 118 L, index.ts 103 L).

## VERDICT: SHIP (as Part-1 module) — with blockers to clear before Part-2 wiring
Blockers: (1) OnCreate registration can permanently no-op (reactContext null, no retry) — register lazily/retry; (2) the wire-up must land in the same series — merged alone, the module fixes nothing in the field. Non-blocking: cached-null nativeModule edge, dev-reload callback leak (bounded), TRIM_* dead constants.

## Part 2 — AppShell wiring
Part-1 blockers: CONFIRMED-FIXED. KalsaLifecycleModule.kt:37-46 — `OnStartObserving { registerComponentCallbacks() }` / `OnStopObserving { unregisterComponentCallbacks() }` / `OnDestroy { unregisterComponentCallbacks(); cancelAllTimers() }` (registration now observer-gated, same pattern as kalsa-thermal). index.ts:28-37 — `let nativeModule: NativeKalsaLifecycleModule | undefined;` with `if (module) nativeModule = module; return module ?? null;` — a null first probe is no longer memoized; retry happens on next call.

(a) Stale closure — REFUTED. `let pendingBackgroundDiscard: BackgroundDiscard | null = null;` (AppShell.tsx:2843) is an effect-scope `let` written at background entry (:3021 `pendingBackgroundDiscard = discard;`) and read live by the trim listener (:3168 `const discard = pendingBackgroundDiscard;`) — the listener closes over the variable, not a copy; null-after-finish is handled (`if (!discard) return;` :3169).

(b) trimLevel + "inactive" — CONFIRMED correct. plan call maps `(AppState.currentState === "background" || (trimLevel !== undefined && AppState.currentState !== "active")) ? "background_expired" : AppState.currentState` (AppShell.tsx:2873-2875) → backgroundDiscardPlan.ts:24-27 returns disposeNow when genAtEntry === genNow (newer_gen otherwise). Android-only module ⇒ "inactive" case is iOS-theoretical; addTrimMemoryListener returns null without the module, so the trim path cannot exist on iOS. Level < 40 and foreground are gated before the plan (`level < TRIM_MEMORY_BACKGROUND || AppState.currentState === "active"` :3160-3162).

(c) Double dispose — REFUTED. Trim path calls `backgroundGrace.cancel()` FIRST (:3166-3170) → backgroundTimer.clearTimeout → native `cancelTimer` removes the runnable AND the JS subscription was removed by cancelNativeBackgroundTimer; an event already in flight past remove() still cannot double-dispose: `requestDeferredDispose` early-returns on `discard.finished || discard.disposeRequested` (AppShell.tsx:2852-2853) and finishBackgroundDiscard guards `finished`. If the timer event instead wins the race, the trim listener sees `backgroundGrace.isPending() === false` and returns. Both orders converge on one dispose.

(d) Trim after cleanup/foreground — CONFIRMED guarded: `disposed ||` is the first condition (:3160), subscription removed in cleanup (`trimMemorySubscription?.remove();` :3181); foreground is excluded by the `AppState.currentState === "active"` guard.

(e) Types/this-binding — REFUTED (no hole). TimerHandle is a discriminated union ({kind:"native"|"js"}); `backgroundTimer.setTimeout`/`clearTimeout` never touch `this` (they close over `nativePair` and call `globalThis.setTimeout/clearTimeout`, backgroundTimer.ts:28-39), so passing them unbound into createBackgroundGrace (:2828-2831) is safe. Generic H unifies.

(f) JS fallback — CONFIRMED unchanged: `createBackgroundTimer(null)` → `globalThis.setTimeout/clearTimeout` (:31, :38) — semantically the previous direct pair; one new log line `background.grace {"timer":"js"}` once per effect mount. iOS (no module) keeps the exact previous behaviour.

(g) Tests — CONFIRMED meaningful for the three asked paths: native-first (`schedule` called with (run, 45000), kind "native", source "native" :8-20), JS fallback with real firing (:22-34), cancel routing (native cancel receives the handle; JS timer count drops to 0; subscription NOT removed on cancel — matches design) :36-55. Gap (minor): no test for `nativePair.schedule` returning null → per-call JS fallback (backgroundTimer.ts:29-31 `?? null`), and none for the trim-listener wiring in AppShell (untestable there).

(h) Removed behaviour — line-by-line minus diff: only `setTimeout,`/`clearTimeout,` (replaced by the backgroundTimer pair) and the model.unload JSON body (`{reason:"background",graceMs}` → conditional trim shape). All prior semantics preserved verbatim: save-at-entry preparation, newer_gen skip, in-flight-ref skip, foreground cancel, ≤5 s busy-wait, `finishBackgroundDiscard` reset. The trim unload correctly drops `graceMs` and adds `{"reason":"trim","level":N}` (AppShell.tsx:2908-2913). CONFIRMED no removed behaviour.

(i) Dead exports / sizes — CONFIRMED: `TRIM_MEMORY_UI_HIDDEN` is gone from index.ts (only `TRIM_MEMORY_BACKGROUND = 40` remains, now consumed by AppShell.tsx:159). Files: backgroundTimer.ts 42 L, test 56 L, module 122 L — fine. jest 8/8 (timer 3 + grace 5); tsc exit 0.

One PLAUSIBLE residue: the per-once `background.grace {"timer":...}` log fires on every effect mount (every AppShell mount) — fine, but it logs unconditionally even when nothing will ever background; acceptable breadcrumb. Second: trim path calls `requestDeferredDispose` even when the plan would return newer_gen — the guard inside makes it a no-op log (`skipped:"newer_gen"`), correct.

VERDICT: SHIP — Part-1 blockers fixed as claimed; wiring implements the intended trim contract with no stale closures, no double dispose, JS-fallback parity, and no removed behaviour.
