# App stability and background-work recon

Scope: read-only source inspection of `/Users/marco/Projects/kalsa-perf2`, HEAD `e110a56b29c29b05a3dfec88d3969d8ccf07be71`. The checkout has no generated `android/` or `ios/` trees; Expo config and checked-in native modules are the native source of truth. No build, install, tests, Metro, Simulator, or phone access was performed. `CONFIRMED` means the code/config is present; battery/crash impact still needs measurement. `PLAUSIBLE` marks behavior the source cannot settle. The supplied iOS recon was read and not repeated except where lifecycle behavior cross-cuts Android.

## A. Background-work inventory (ranked)

### A1. Android local generation and utility native work can outlive the foreground transition — P1, CONFIRMED

`src/app/iosBackgroundPlan.ts:47-54` says `if (args.platform !== "ios") return noAction();` and only plans stop/mark on the iOS background event. `src/host/useHostEffects.ts:109-117` wires this guard. Thus Android has no AppState-triggered cancellation of an active local turn, memory extraction, translation, embedding, or prewarm. These are user-initiated and bounded by turn/tool deadlines, not periodic loops, but can continue CPU/GPU work after screen-off until native completion, cancellation elsewhere, OS suspension, or process death. That is the strongest confirmed battery risk. **Fix:** on Android background, abort active local work and prevent new utility/prewarm work; persist partial chat first and resume only on active. Make operation ownership explicit so extraction shares cancellation.

Memory extraction specifically is launched as detached work: `src/host/engineTurnMemory.ts:172-175` says `const extractJob = (async () => {` and waits on a save gate; `:199-205` calls `extractMemory(...)`; `:249` tracks the resulting promise. It is tied to the turn's abort signal (`:153-159`) but Android background does not abort that signal. It can therefore perform native inference after leaving the foreground while it remains alive.

### A2. iroh bridge lifecycle has no app-background pause — P1 battery/network, PLAUSIBLE

`src/remote/irohBridge.ts:37-49` stores a process-global `started` promise, and `:118-130` shuts down an individual tunnel only when its request owner closes it. `modules/kalsa-iroh/src/index.ts:14-21` exposes `startBridge`, open/read/write/shutdown-by-id, but no bridge stop/pause function. The Rust bridge starts a dial-only endpoint with the public relay choice: `native/kalsa-iroh-mobile/src/bridge.rs:37-48` says “bind a dial-only endpoint” and `RelayChoice::N0Public`; it also notes relayed endpoints disclose stable EndpointId (`:41-42`). The native Expo module only drops the bridge in `OnDestroy` (`modules/kalsa-iroh/android/src/main/java/expo/modules/kalsairoh/KalsaIrohModule.kt:109-121`) or replaces it on another `startBridge` (`:199-208`).

When Room streams pause they close the tunnel, but not the shared bridge/endpoint. No background timer cadence is visible in this wrapper; iroh's internal discovery/relay/keepalive scheduling is inside the pinned engine dependency and cannot be measured from this source. Therefore **open sockets/ongoing discovery after a tunnel closes are plausible, not confirmed**. While an active remote chat is running, its tunnel is caller-owned and the app has no general Android AppState abort; an active SSE read can stay pending until its own read/idle timeout or OS suspension. **Fix:** add a native bridge suspend operation that closes endpoint/relay/discovery resources on background and recreates on foreground; separately abort remote turns on background unless explicitly supporting background audio/transfer. Measure sockets, packets, and wakeups before/after background.

### A3. Thermal and process samplers — P2, CONFIRMED for mounted Settings screen only

`src/hooks/useThermalMonitor.ts:26` sets `DEFAULT_INTERVAL_MS = 30_000`; `:141-148` samples immediately then every 30 seconds, and cleanup only clears the timer on effect unmount (`:146-150`), with no AppState listener. Its comment says it “Never unloads the model — UI banner only” (`:1-5`). It is instantiated from Settings (`src/screens/SettingsScreen.tsx:1124`), so it runs while Settings remains mounted; navigation/unmount normally stops it, but backgrounding Settings does not explicitly stop it. Thermal reads Android sysfs or iOS state, then memory `/proc` fallback (`:117-191`). Cost: one to three native/file reads per 30-second tick. **Fix:** add active/background pause and one in-flight sample guard; avoid parallel timer overlap.

`useProcessHealth` is used by Settings at `src/screens/SettingsScreen.tsx:1103`; its comment says “Lightweight process-health ticker for Settings diagnostics” (`src/hooks/useProcessHealth.ts:2`), it samples every 15 seconds (`:26`, `:141-149`), and effect cleanup clears the interval on unmount. Settings unmount should stop it; there is no AppState gate while mounted. Battery ETA is separately app-global (below).

### A4. Battery ETA sampler — P2, CONFIRMED and correctly stopped in background

`src/host/useModelBar.ts:51-56` enables it only while a model is ready/resident. `src/hooks/useBatteryEta.ts:244-248` immediately samples and sets an interval; the interval is configurable by `intervalMs` (default is declared earlier in the file). Its AppState handler clears the timer on `background` and on `inactive` pauses without clearing its slope (`:254-275`); active rearms (`:255-257`). Cost while foreground with a resident model is one battery API read per configured interval; zero intentional polls in background. **Fix:** none required for background; consider reducing foreground cadence if device measurements show meaningful overhead.

### A5. Room SSE streams — P2, CONFIRMED paused on background on both platforms

`src/host/useHostEffects.ts:119-122` installs `bindRoomStreamsToAppState`. `src/room/roomAppState.ts:23-28` calls `pauseRoomStreams()` on `background`, `resumeRoomStreams()` on `active`. `src/room/roomSubscriptions.ts:73-81` documents and implements close-wire/pause and cursor-based resume. Each stream has one idle watchdog interval (`src/room/roomStream.ts:88-90`, `:345-362`) and reconnect timeout; `halt()` aborts the dial, closes wire, clears reconnect and idle timers (`:122-135`). **Cost:** no stream socket or stream timers intended while backgrounded; one reconnect per subscribed room on foreground. Network transitions while foreground use backoff (`:165-173`). No change needed, but app-wide remote-brain turns are a different path and are not covered by this binding.

### A6. Model downloads — P1/P2, CONFIRMED foreground keep-awake; background pause is absent

`src/host/useModelDownload.ts:199-209` creates an AbortController, sets downloading state, calls `activateKeepAwakeAsync`, then starts notification handling. `:216-234` passes the signal into `downloadModelBundle`; `:277-282` clears keep-awake only in `finally`. Download implementation uses `DownloadResumable.downloadAsync()` (`src/engine/ModelDownloader.ts:466-472`) and a five-second stall watchdog (`:416-432`), cleared only when the task settles (`:526-529`). No AppState listener aborts or pauses the download; `:285-339` starts only after user confirmation. Sticky progress notifications are ordinary `expo-notifications` schedules throttled to 2 s (`src/host/downloadNotifications.ts:21-23,145-160`), not a download service. `app.config.js:37-40` requests only RECORD_AUDIO and READ_CALENDAR; checked-in module manifests are empty `<manifest />`; no checked-in WorkManager/JobScheduler/AlarmManager service, WAKE_LOCK or FOREGROUND_SERVICE declaration exists. Generated platform trees are absent, so final merged-manifest validation remains open.

Expo KeepAwake is not evidence of a background CPU wakelock: it holds the screen awake while the activity is visible. When backgrounded, the JS transfer is not explicitly paused, so whether native URL transfer continues is platform/library-dependent (PLAUSIBLE). **Fix:** add AppState handling to pause resumably and persist resume data before background; deactivate keep-awake promptly on pause. Only adopt a real foreground transfer service with notification/permissions if background downloads are a product requirement.

### A7. Prefix prewarm — P2, CONFIRMED foreground-gated

`src/engine/LlamaService.ts:1117-1123` says OEM restore may relaunch in background and returns unless `AppState.currentState === "active"`; `src/host/useHostEngine.ts:128-144` re-kicks from AppState active. It can spend a bounded prefill when active, but code does not intentionally run it in background. **Fix:** current guard is appropriate; ensure every other enqueue site shares the same foreground condition (the two queue callsites at `LlamaService.ts:1598,1660` should remain behind this function).

### A8. iOS local engine work — P2, CONFIRMED stopped/poisoned on suspend; resident idle model remains

The supplied prior iOS report covers most iOS engine memory/performance findings. Cross-check: `src/app/iosBackgroundPlan.ts:47-59` stops a local send and marks a context when native work/load is underway; it intentionally does nothing for remote turns (`:36-37,49-54`). `src/host/iosBackgroundGuard.ts:51-85` wires abort and releases poisoned context on next active. No background GPU work is intended after that. A merely resident idle model is not unloaded on every app switch. **Fix:** retain; add an explicit remote-turn background policy if SSE should stop.

### A9. Memory extraction / document indexing / embeddings — P2, foreground task scope, not a background scheduler

There is no WorkManager, JobScheduler, AlarmManager, BGTaskScheduler, or Expo BackgroundTask registration in source (search of app config, src, modules, plugins). Memory extraction is post-turn detached work as A1 describes; it can overlap turn completion and could continue while Android app backgrounds. Document extraction/indexing and embedding are initiated by foreground document/import/rebuild flows; no persistent job scheduler is registered. `src/host/useModelDownload.ts:24-27` explicitly holds semantic rebuild and embedding-download UI flows as unavailable in this build. **Fix:** cancel/queue document jobs on AppState background and checkpoint progress; do not add background scheduling unless requested. Large JSON/text extraction is still a foreground memory/latency risk, not evidence of an OS background worker.

### A10. TTS, recording, location/sensors, OS background modes — P2/P3, CONFIRMED scope

TTS is user-triggered through `src/host/useReadAloud.ts:49-82`; on unmount it calls stop (`:90-98`), but no AppState listener is visible. Expo Speech may continue or be interrupted by OS on background; the app does not configure a background audio mode. `app.config.js:22-35` has privacy usage strings but no `UIBackgroundModes`, `audio`, `location`, or `BGTaskScheduler` configuration. **Fix:** stop TTS on `background` (not only unmount), unless intentional background read-aloud is desired; then configure and measure a deliberate audio background mode.

Voice capture is explicitly user initiated, not a sensor subscription: app config only grants microphone/calendar (`:37-40`), and there is no continuous location, accelerometer, gyroscope, or location permission/use surfaced by source search. No WorkManager/JobScheduler/AlarmManager or BGTaskScheduler use found. No Android foreground service or explicit WAKE_LOCK/WifiLock use found. **No always-on location/sensor wake source found.**

## B. Log hygiene

### Normal-path warnings/errors and recurring noise

- **Require cycle warning — CONFIRMED at import.** `src/domain/miniappBuilders.ts:11-18` imports helpers then imports `buildC6c` from `miniappBuildersNew`; `src/domain/miniappBuildersNew.ts:15-24` imports helpers from `miniappBuilders`. Metro reports a Require cycle for this mutual dependency. Extract shared primitives to `miniappBuilderCommon.ts`; each builder module imports common, with no reverse edge.
- **Duplicate React message IDs — CONFIRMED warning when duplicate data occurs, not normal on valid data.** `src/ui/shell/Transcript.tsx:192` logs every render while duplicate IDs persist. Fix duplicate creation at source and log once per conversation/unique duplicate signature; use stable ID repair only if semantics permit. Index keys in `TranscriptInline.tsx:65-151` identify tokenized presentation nodes and are not evidence of a missing-key warning; no specific missing-key emitter was confirmed in source.
- **Download-notification errors — caught and warned on each failing API attempt.** `src/host/downloadNotifications.ts:129-142,145-160,171-186`. Setup/progress/ready/failure notification permissions or schedule failures are ordinary optional-feature failures. Make expected permission denial/API unavailable silent or one structured event per download session; preserve unexpected failures once with rate limiting.
- **Embedding availability warnings — expected fallback can warn repeatedly.** `src/engine/EmbeddingService.ts:255-262` warns when `initLlama` is absent, and `:227-234` warns on hung-state transition. The former is a normal capability fallback in builds without the embedder; warn once per process/build or downgrade to debug. Hung-state warning is a one-time real fault; retain.
- **Session persistence warnings — routine fallback path may recur.** `src/engine/LlamaService.ts:3773-3784` warns on every rejected `saveEngineSession`; `:4005-4010` warns on every failed restore. Some are expected absent/stale/incompatible session cases already represented in structured logs; log only unexpected reason classes, aggregate repeat failures, and retain user-visible action for genuine data loss. `src/host/useHistoryHost.ts:85-96` warns on every AsyncStorage rejection/refusal; failures are actionable, but dedupe by key/epoch/reason and keep content out of logs.
- **Native iroh warning — caught but unexpected-only.** `modules/kalsa-iroh/android/src/main/java/expo/modules/kalsairoh/KalsaIrohModule.kt:141-153` emits `Log.w` only for `KALSA_IROH_OTHER`; ordinary typed transport/deadline failures avoid this. Keep unexpected-only but rate-limit a repeated persistent fault.
- **Native verbose logs:** no `Log.e`/`Log.w` token-stream emitter or `NSLog` found in checked-in modules. Standard per-token console logs were not found; sampled KALSA diagnostics are structured one-per-phase. The downloaded/pinned llama.rn C++ native logging was not fully audited for token-level log volume, so inspect release logcat during generation before claiming none.

### Caught errors that should not be elevated on normal paths

The bulk of `console.warn` callsites describe exceptional outcomes: RAM/native timeouts in `src/host/engineGateHelpers.ts:44-53,195-215`, load fallback in `src/host/engineLoad.ts:103-113`, recovery warning in `src/host/engineEnsureLoad.ts:241-251`, and remote transport failure in `src/engine/remote/openaiTransport.ts:201`. Keep visible when actionable; ensure retries do not log every retry at warning level. `console.error` search returned no app-source callsites. No `console.error` normal-path emitter was confirmed.

### Unhandled promise rejection candidates

There is no centralized `unhandledrejection` listener in app source. `void` alone does not handle rejection. Highest-value audit targets: `src/host/engineTurnMemory.ts:106` uses `void extractJob.finally(...)` (a rejecting original promise can produce a rejected `finally` result); attach a terminal `.catch` after telemetry/state cleanup. `src/host/useModelHost.ts:108` uses `void loadDeviceBandwidthCalibration().then(...)` without rejection handler; add fallback catch. `src/host/useModelHost.ts:131` calls `void saveDeviceBandwidthCalibration(next)`; catch and rate-limit. `src/host/useConversationHost.ts:105-120` chains initial state/history reads in detached promises; add catches and surface recovery. `src/screens/SettingsScreen.tsx:494-545` starts several unobserved settings reads / `Promise.all`; attach fallback handlers. `src/host/conversationActions.ts:183,211,216` detached reset/invalidate/restore operations should have catch and telemetry. `src/screens/NotesScreen.tsx:66,153` and `src/screens/PersonasScreen.tsx:70,164` also contain detached async UI actions; audit each for internal catches. Not every `void` call is unsafe: a number end with `.catch(() => undefined)` already handles rejection.

### Deprecated APIs / React warnings

Search found no RN core `SafeAreaView`, `Clipboard` (uses current `expo-clipboard`), or `InteractionManager` API call; `src/host/HostMiniappSheet.tsx:24,57` and `src/theme/components/Screen.tsx:8,28` use `react-native-safe-area-context` SafeAreaView. No deprecation warning is source-confirmed. No React StrictMode wrapper was found in `App.tsx` or source search. Validate actual debug logcat once without treating these as confirmed issues.

## C. Crash and stability risks outside prior iOS recon

1. **Android low-memory model load can kill the process — P1, PLAUSIBLE, high impact.** Catalog Qwen 3.5 4B is `2_834_975_040` bytes plus a `672_423_616` byte mmproj (`src/engine/ModelRegistry.ts:217-228`); runtime also requests `n_ctx`, `n_batch:512`, `n_ubatch` and compute buffers (`src/engine/LlamaService.ts:2620-2634`). Load code does estimate memory and use platform load policy (`:2622-2630`), so OOM is not proven; actual peak vs Jelly Star/6-8 GB devices is unknown. Enforce hard available-memory margin including mmproj/KV/compute, prefer smaller model on 6 GB, record Android low-memory exit (`ApplicationExitInfo` already mapped in lifecycle module), and stress load+chat+image. The prior iOS mlock concern does not apply as written: `resolveUseMlock(Platform.OS)` is platform-aware (`:2622-2627`).
2. **Process death loses volatile state — P1 visible bug, CONFIRMED partial preservation only.** History flushes on background only when idle (`src/host/useHistoryFlushes.ts:101-124`); while sending it preserves streaming partial through a separate write (`:95-100`), but an abrupt low-memory/process kill can occur before async storage/session write lands. Android lifecycle module can report last exit reason (`modules/kalsa-lifecycle/android/src/main/java/expo/modules/kalsalifecycle/KalsaLifecycleModule.kt:95-110`), but does not itself restore app state. On next launch, hydrate durable history and show interrupted partial; persist turn/checkpoint state before/while work proceeds and reconcile the last exit record.
3. **Synchronous heavy work / ANR — PLAUSIBLE, no checked-in custom sync model call confirmed.** iroh wrapper explicitly runs blocking calls on executor pools (`modules/kalsa-iroh/android/src/main/java/expo/modules/kalsairoh/KalsaIrohModule.kt:21-45,125-139`). Lifecycle timer’s synchronous Expo `Function` only posts/cancels a `Handler` callback (`modules/kalsa-lifecycle/android/src/main/java/expo/modules/kalsalifecycle/KalsaLifecycleModule.kt:30-36,56-71`), small work. Chat prefill deadline does synchronous `JSON.stringify(currentMessages)` (`src/engine/LlamaService.ts:4522-4524`), and history/message parsing uses JSON in JS; very long histories can stall JS but are not evidence of Android main-thread blocking. Audit the pinned llama.rn `initLlama`/JSI and AsyncStorage native internals; keep large JSON parse/serialization off UI thread or bound payload size.
4. **Network handoff during remote turn / Room — P2, PLAUSIBLE.** Room stream reconnect/backoff is explicit and bounded, with cursor resume; remote SSE transport has timeouts but no AppState policy. Wi-Fi-to-cellular changes can invalidate an active tunnel/HTTP stream and trigger failure/retry; add connectivity-change abort/retry with idempotency and resume rules. Do not retry a non-idempotent message POST without an idempotency key.
5. **Double mount / StrictMode — P2, PLAUSIBLE only.** No StrictMode wrapper found, and key roots use effect cleanup; still, development remount and rapid screen transitions can surface duplicate subscriptions. Keep singleton Room map and once-only bridge startup; add mount/unmount assertions in logs only if actual double mount is reproduced.
6. **Main-thread SQLite/AsyncStorage — P2, PLAUSIBLE, not confirmed as ANR.** Chat uses AsyncStorage for history and session metadata and may serialize full conversations; native module implementation details are external. Bound history and profile storage latency; trace Android main thread before assigning ANR severity.

## D. Jelly Star (Android, unplugged) 15-minute measurement plan

Run only when unplugged and no other phone session owns the device. Pair/confirm Wi-Fi ADB beforehand; never connect to USB during the interval. Capture device ID using `adb devices -l`; then use the resolved serial below.

```sh
SERIAL='192.168.1.82:5555'
PKG='com.kalsa.app'
OUT="$PWD/jelly-bg-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT"
adb -s "$SERIAL" get-state
adb -s "$SERIAL" shell dumpsys battery > "$OUT/battery-before.txt"
adb -s "$SERIAL" shell dumpsys batterystats --reset
adb -s "$SERIAL" shell am force-stop "$PKG"
adb -s "$SERIAL" shell monkey -p "$PKG" 1
sleep 90
adb -s "$SERIAL" shell input keyevent KEYCODE_HOME
adb -s "$SERIAL" shell input keyevent KEYCODE_POWER
sleep 900
adb -s "$SERIAL" shell input keyevent KEYCODE_POWER
adb -s "$SERIAL" shell dumpsys battery > "$OUT/battery-after.txt"
adb -s "$SERIAL" shell dumpsys batterystats --charged > "$OUT/batterystats-charged.txt"
adb -s "$SERIAL" shell dumpsys batterystats "$PKG" > "$OUT/batterystats-app.txt"
adb -s "$SERIAL" shell dumpsys power wakelocks > "$OUT/power-wakelocks-subcommand.txt" 2>&1
adb -s "$SERIAL" shell dumpsys power > "$OUT/power-wakelocks.txt"
adb -s "$SERIAL" shell dumpsys alarm > "$OUT/alarms.txt"
adb -s "$SERIAL" shell dumpsys jobscheduler > "$OUT/jobscheduler.txt"
adb -s "$SERIAL" shell dumpsys netstats > "$OUT/netstats.txt"
adb -s "$SERIAL" shell top -b -n 1 -o PID,USER,PR,NI,VIRT,RES,SHR,S,%CPU,%MEM,ARGS > "$OUT/top.txt"
adb -s "$SERIAL" shell pidof "$PKG" > "$OUT/pid.txt"
```

For a minute-by-minute foreground/background CPU sample, do a separate repeat with screen still off and run from host every 60s: `adb -s "$SERIAL" shell top -b -n 1 -o PID,ARGS,%CPU,RES | rg 'com.kalsa.app|PID'`; do not keep an interactive `top` process running on device during the timed interval. Capture network counters at both ends using `adb shell dumpsys netstats detail` (if supported) or `dumpsys netstats`; compare UID `com.kalsa.app` RX/TX bytes. To inspect Android-held locks more directly where supported, use `adb shell dumpsys power | rg -i 'wake lock|wakelock|mWakeLocks|Wifi'`; `dumpsys power` lists kernel/system locks, while batterystats attributes app wakeups.

Interpretation (screen off, idle, no download/turn/Room operation):

- **Good:** app CPU ~0% in each sample; no app-owned partial wakelock (zero duration or no increase); no recurring app alarm/job; app UID network bytes stop increasing after initial background teardown; battery level unchanged over 15 minutes (integer battery percent is coarse, so repeat for 30-60 minutes if it moves by 1%).
- **Investigate:** >0.5% sustained app CPU or repeated >1% samples; any app partial wakelock accumulating after screen off; recurring app alarm/job; network RX/TX continuing after Room wire should have closed; >1 percentage-point drop in 15 minutes under stable ambient/temp and no foreground use.
- **Bad:** sustained >2% CPU, active app partial wakelock for most of the 15 minutes, repeated packets/alarms every few seconds, >2 percentage-point drain in 15 minutes, process repeatedly restarting, ANR/crash/low-memory exit. Battery percentage alone is noisy; repeat with screen off, radios/coverage controlled, same initial charge band, and compare a force-stopped baseline.

Record device temperature/thermal state before and after; do not infer app-only drain from a single battery percent delta. Since `dumpsys batterystats --reset` changes system stats, save all outputs and run baseline/loaded-model experiments as separate unplugged sessions.
