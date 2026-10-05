# Android background CPU: Worklets UI loop

Scope: read-only inspection of `/Users/marco/Projects/kalsa-attach-gate` at `88357e64` and its installed `node_modules`, plus upstream GitHub research. No tests, builds, installs, or device access.

## Finding

**CONFIRMED — root cause is `react-native-worklets@0.10.1` failing to register its Android host lifecycle listener.** This is the idle/background UI-runtime frame pump, not an app animation that accidentally remains mounted. Its signature matches the report: `AnimationFrameQueue.executeQueue` → `AnimationFrameCallback.onAnimationFrame` → `WorkletsModule.requestAnimationFrame`.

Installed `src/runLoop/uiRuntime/requestAnimationFrame.ts:60-65`:
> `function nativeFlushQueue(timestamp: number) { flushQueue(timestamp); /* Schedule next frame */ globalThis.__nativeRequestAnimationFrame(nativeFlushQueue); }`

Installed `.../requestAnimationFrame.ts:80-81` starts that pump once. That callback re-arms itself every VSync, regardless of queued work. The JS queue itself is not a self-sustaining animation.

Installed Android `WorkletsModule.kt:178-184` defines `onHostResume() { mAnimationFrameQueue.resume() }` and `onHostPause() { mAnimationFrameQueue.pause() }`, but both networking and no-networking variants contain **no `addLifecycleEventListener` call** (confirmed by source search). Thus Home does not reach these overrides. This distinction explains why merely seeing pause methods in 0.10.1 is misleading.

**CONFIRMED — the native queue is demand-driven, not independently stuck.** `AnimationFrameQueue.kt:47-52` adds a callback and calls `scheduleQueueExecution`; `:65-72` posts only if unpaused and no callback is posted; `:86-100` drains and clears the callback list. It does not normally re-post after a successful drain. The duplicate-same-timestamp path at `:78-84` retries, but is explicitly a duplicate-frame guard, not the persistent idle mechanism.

**CONFIRMED — C++ batches callbacks; it does not supply the endless loop.** `AnimationFrameBatchinator.cpp:14-20` batches a callback and flushes; `:33-51` requests one animation frame, drains the batch, then clears `flushRequested_`. Persistent VSync scheduling is the UI-runtime JS callback above, fed by the Kotlin queue.

## Dependency inventory (lockfile + installed package manifests)

| Package | Installed version; relevant peer dependencies | Frame/worklet behavior and app relevance |
|---|---|---|
| `react-native-reanimated` | 4.5.1; RN `0.83 - 0.86`, Worklets `0.10.x` | Provides `useFrameCallback` / `useAnimatedStyle`; a style mapper updates when its shared-value dependencies change. It is the Worklets client, not the Android lifecycle bug. `node_modules/.../useFrameCallback.ts:49-61` registers/unregisters the callback. |
| `react-native-worklets` | 0.10.1; direct dependency | **Cause above.** Its rAF pump runs once installed and re-arms forever; Android lifecycle registration absent. |
| `react-native-keyboard-controller` | 1.21.9; React/RN `*`, Reanimated `>=3.0.0` | Root `KeyboardProvider` is mounted at `App.tsx:229-233`. Internally it sets `useAnimatedKeyboardHandler` and focused-input handlers (`src/animated.tsx:161-199`) that process keyboard/input events, not a perpetual frame callback. Its hidden `Animated.View` at `:234-244` retains keyboard animated values; no recurring rAF is registered there. |
| `react-native-gesture-handler` | 2.32.0; React/RN `*`; **no Worklets/Reanimated peer** | App mounts only `GestureHandlerRootView` (`App.tsx:217`). Its `ghQueueMicrotask` uses rAF only as a one-shot fallback when `setImmediate` is unavailable; it does not re-arm a loop. |
| `react-native-screens` | **Not installed / absent from lockfile** | Not a candidate in this checkout. |
| `expo-modules-core` | 57.0.20; peer Worklets `^0.7.4 || ^0.8.0 || ^0.9.0 || ^0.10.0` | Worklets compatibility peer; no app-level frame-loop registration identified. |
| `react-native-draggable-flatlist` | 4.0.3; peers RNGH `>=2`, Reanimated `>=2.8` | Transitive animation consumer, but no `DraggableFlatList` use found in `src`; not mounted in the empty-chat reproduction. |

## App-owned animation audit

**CONFIRMED — no always-mounted `StatusPill` pulse found.** `StatusPill` only appears in its definition and barrel export; it is not used by app source. `Pill.tsx:44-58` does run `withRepeat(..., -1, ...)` only when `pulse && dot`; `StatusPill.tsx:12-15` maps `live` to that switch. No model-bar/drawer/notice instance was found.

**CONFIRMED — ThoughtCloud loops are state-gated.** `ThoughtCloud.tsx:241-255` starts infinite breathing only for `working && !reduced`, and `:269-273` starts its `useFrameCallback` only for phase `rise` when not reduced (`thoughtMotion.ts:240-247`). Empty chat has no such thinking cloud, and these cannot explain the app-wide idle reproduction.

**CONFIRMED — keyboard usage and transcript fade are not the loop.** App uses only `KeyboardProvider` plus `useKeyboardHeight` (`src/ui/shell/useKeyboardHeight.ts:28-43`), which listens for settled `keyboardDidShow/Hide`; app source has no `useKeyboardHandler`, `useReanimatedKeyboardAnimation`, or `useAnimatedKeyboard` call. `TranscriptEdgeFade.tsx:19,35-68` draws static LinearGradients; no Reanimated imports/shared values. The provider is always mounted, but the host lifecycle bug applies even in a minimal Worklets app.

## Upstream confirmation and fix

- The matching report is [Reanimated issue #10076](https://github.com/software-mansion/react-native-reanimated/issues/10076): it describes the `AnimationFrameQueue.executeQueue → onAnimationFrame → WorkletsModule.requestAnimationFrame` profile chain, idle/background CPU around 7%, and the same RN 0.86 / Fabric / Hermes stack. **CONFIRMED match** to this profile; issue report's package pair is Worklets 0.11.3 / Reanimated 4.5.0, while this app has 0.10.1 / 4.5.1.
- Maintainer PR [#10196](https://github.com/software-mansion/react-native-reanimated/pull/10196) states the cause: “an event listener for `onHost.pause` and `onHost.resume` wasn't wired in” and reports emulator verification that backgrounded Android no longer spins the UI runtime. It merged Aug 10, 2026.
- The fix was backported to Worklets 0.10 via [PR #10216](https://github.com/software-mansion/react-native-reanimated/pull/10216), merged Aug 11. The official [Worklets 0.10.4 release](https://github.com/software-mansion/react-native-reanimated/releases/tag/worklets-0.10.4) lists the cherry-pick `UI loop not pausing when the app is backgrounded (#10196)`. **CONFIRMED minimal version fix: upgrade Worklets from 0.10.1 to at least 0.10.4** (still satisfies Reanimated 4.5.1's `0.10.x` peer). No Reanimated or keyboard-controller version bump is needed for this specific bug.
- A separate keyboard-controller background issue [#1522](https://github.com/kirillzyusko/react-native-keyboard-controller/issues/1522) concerns a Fabric `SurfaceControl` crash when keyboard animation ends in background, not an idle CPU loop; it does not match this evidence.

## Recommendation and device verification

**FIX: bump only `react-native-worklets` to `0.10.4` (or a later compatible `0.10.x`), then rebuild the native APK when authorized.** Do not remove KeyboardProvider or change app animation code for this cause. AppState-pausing `Pill`/ThoughtCloud loops would not stop Worklets' core rAF pump.

**Verification (device work intentionally not performed):** repeat the same 15-second simpleperf main-thread capture and `dumpsys gfxinfo` with the release APK, home screen visible, and Kalsa backgrounded. Before fix, the reported 7–15% core use and dominant `AnimationFrameQueue.executeQueue`/Worklets/Hermes UI-runtime samples reproduce. After 0.10.4, expect no continuing Choreographer → Worklets queue ticks while backgrounded and main-thread use near the device idle baseline; `gfxinfo` should still show 0 rendered app frames. Foreground a static empty chat and leave it idle as a second check: no animation should produce a sustained frame loop. If background ticks remain, collect same profile and check installed APK's embedded native Worklets version/lifecycle registration before blaming app-level loops.
