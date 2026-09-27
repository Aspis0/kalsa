# S23 launch stutter: delayed model load

## 2026-09-26 — preflight stopped

The requested APK was installed with `adb install -r` (success; app data was
preserved). SHA-256 matched the requested build:
`7239d0d29c1c40ae116487a4638dbc730c4eb2de075cd36973d6b07a3f5e1dd0`.
Installed package metadata: versionName `0.1.0`, lastUpdateTime
`2026-09-26 20:34:29`.

**No arms ran.** The installed APK is not debuggable: `dumpsys package` lists
`pkgFlags=[ HAS_CODE ALLOW_CLEAR_USER_DATA ]` without `DEBUGGABLE`, and
`run-as com.kalsa.app id` returned `run-as: package not debuggable`. This
fails the S23 debuggable-build requirement, so no benchmark commands or chat
messages were sent and no stutter/latency measurements are available.

Other preflight checks passed: unplugged, battery 100%, battery 26.8 C,
thermal status 0, no `llama|bench` process, and `persist.traced.enable=0`.
The phone was Dozing at initial inspection; it was woken and keyguard
dismissed before launching the app to inspect package state. Cleanup
force-stopped Kalsa and restored the original `screen_off_timeout` (`null`);
the final power capture showed Awake. No uninstall or data clear occurred.

Raw preflight and cleanup records: `raw/session-20260926/`. Provide a
debuggable APK before retrying the six-arm A/B session.

## 2026-09-26 — debuggable APK A/B launch run

Installed the supplied `c6e0b3a9` APK with `adb install -r`; SHA-256 matched
`ef4bb493600d4a75521a8cd1d67b81a44dd3ea13314c4cab1ee3a3a7de2968c2`.
`run-as com.kalsa.app id` succeeded; package flags include `DEBUGGABLE`,
versionName `0.1.0`, lastUpdateTime `2026-09-26 22:15:30`. Preflight passed:
unplugged, 99%, 25.3 C, thermal 0, no `llama|bench` process, traced 0.
Screen was kept Awake/unlocked with the WAKEUP loop throughout.

| Arm | Frames / janky | p90 / p99 | Slow UI / draw | Top thread peaks (CPU) | Load start after proc start: first / 1.5 GiB | Prewarm | TTFT `promptMs` (prompt_n) |
|---|---:|---:|---:|---|---:|---:|---:|
| A1 | 8 / 50.00% | 40 / 40 ms | 2 / 2 | main 88.4%, mqt_v_native 75.8%, Jit 15.4% | 2.140 / 8.123 s | 14.325 s | 470.577 ms (17)* |
| B1 | 64 / 7.81% | 14 / 61 ms | 5 / 2 | main 92.3%, Jit 80.7%, mqt_v_native 74.4% | 6.577 / 12.135 s | 14.387 s | 3312.582 ms (324) |
| A2 | 69 / 8.70% | 12 / 93 ms | 5 / 3 | FrescoDecodeExe 77.4%, Jit 69.2%, main 34.6% | 2.136 / 7.815 s | 14.374 s | 4183.162 ms (400) |
| B2 | 65 / 6.15% | 14 / 101 ms | 4 / 2 | main 84.6%, mqt_v_native 76.8%, Jit 19.2% | 6.948 / 12.722 s | 14.326 s | 4944.578 ms (488) |
| A3 | 67 / 7.46% | 15 / 101 ms | 5 / 2 | main 92.3%, mqt_v_native 79.8%, Jit 42.3% | 2.196 / 7.996 s | 14.380 s | 5391.106 ms (565) |
| B3 | 61 / 9.84% | 22 / 150 ms | 6 / 3 | main 88.4%, Jit 80.7%, mqt_v_native 73.0% | 6.639 / 12.174 s | 14.346 s | 6464.547 ms (659) |

`Load start` is measured from Android's `ActivityManager: Start proc` line;
the two native load phases report 205.08 MiB (31/31 GPU layers) and the main
1512.20 MiB CPU-mapped model (0/31 GPU layers). A arms have no `KALSA_EAGER`
line. B arms each log `delay_ms=5000`, with `since_launch_ms` 5291, 5251,
and 5304; prewarm starts after the delayed load and takes about 14.3 s in
every arm. `Slow draw` is `Number Slow issue draw commands`; top figures are
the maximum CPU readings across the six 5-second snapshots. Full selected
timestamped events and verbatim per-turn telemetry are in each arm's
`key_events.log`.

| Median | A | B |
|---|---:|---:|
| Janky frames | 8.70% | 7.81% |
| p90 / p99 | 15 / 93 ms | 14 / 101 ms |
| First / main model-load start | 2.140 / 7.996 s | 6.639 / 12.174 s |
| Prewarm | 14.374 s | 14.346 s |
| TTFT proxy, `promptMs` | 4183.162 ms* | 4944.578 ms |

The delay moved the main model load about 4.18 s later, but the 30-second
jank distributions are close: median jank improves by 0.89 percentage point,
median p90 by 1 ms, while median p99 is 8 ms worse. This run does not show a
clear launch-jank win for B. TTFT is the per-turn telemetry `promptMs` (the
app's prompt/first-token phase); `prompt_n` grows through the shared chat, so
TTFT is descriptive and not a fixed-context comparison.

*A1's 30-second launch sample is valid, but an input-encoding mistake caused
the malformed `Reply%with%one%word: ok` to be sent before the correct prompt.
The correct prompt is turn 2 (`promptMs=470.577`); its TTFT follows an extra
172-token turn and warm KV, so exclude A1 for a clean TTFT comparison. The
clean A2/A3 median is 4787.134 ms versus B's 4944.578 ms. B1 also had an
initial launch attempt with no PID at the immediate check; it produced no
top/gfx sample and is excluded. The valid B1 retry followed that unmeasured
load, so OS file-cache warmth may affect the fixed-order comparison.

The per-turn telemetry lines (verbatim):

```text
A1 09-26 22:22:38.170 23533 23571 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"2","attempt":1,"round":0,"tokensCached":1928,"tokensEvaluated":1894,"tokensPredicted":33,"draftTokens":0,"draftAccepted":0,"promptMs":470.577,"predictedMs":2231.4249999999997,"predictedPerSecond":14.788756063950167,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":17}
B1 09-26 22:28:31.984 27484 27516 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2017,"tokensEvaluated":1984,"tokensPredicted":32,"draftTokens":0,"draftAccepted":0,"promptMs":3312.582,"predictedMs":3262.1119999999996,"predictedPerSecond":9.809595746559285,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":324}
A2 09-26 22:31:20.515 29111 29153 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2092,"tokensEvaluated":2060,"tokensPredicted":31,"draftTokens":0,"draftAccepted":0,"promptMs":4183.162,"predictedMs":3585.8079999999995,"predictedPerSecond":8.645192380629416,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":400}
B2 09-26 22:33:38.147 30487 30516 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2182,"tokensEvaluated":2148,"tokensPredicted":33,"draftTokens":0,"draftAccepted":0,"promptMs":4944.578,"predictedMs":3458.989,"predictedPerSecond":9.5403599144143,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":488}
A3 09-26 22:35:53.902 31856 31887 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2263,"tokensEvaluated":2225,"tokensPredicted":37,"draftTokens":0,"draftAccepted":0,"promptMs":5391.106,"predictedMs":3797.3559999999998,"predictedPerSecond":9.743621614618172,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":565}
B3 09-26 22:38:06.701   786   817 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":2354,"tokensEvaluated":2319,"tokensPredicted":34,"draftTokens":0,"draftAccepted":0,"promptMs":6464.547,"predictedMs":2768.612,"predictedPerSecond":12.28052179214711,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":659}
```

Final cleanup acknowledged `bench:eager_delay clear`, force-stopped Kalsa,
restored `screen_off_timeout=null`, and left the display Awake/unlocked.
End readings: unplugged, 94%, 31.5 C, thermal 0, traced 0.

## 2026-09-27 — interaction diagnosis (diagnostic, on charger)

The S23 was intentionally charging for this diagnostic session. The display
was kept Awake and unlocked; `persist.traced.enable` remained 0. No app data
was cleared and no Android or app settings were changed. The installed
debuggable `c6e0b3a9` build was already present. All values below are
diagnostic, on charger; they are not benchmark results.

| Scenario | Frames / janky | p90 / p99 | App skipped-frame events / frames | App Davey! | App GC / pause |
|---|---:|---:|---:|---:|---:|
| (a) cold launch, idle 30 s | 68 / 5 (7.35%) | 12 / 150 ms | 0 / 0 | 0 | 0 |
| (b) loaded, chat-list scroll 20 s | 2166 / 15 (0.69%) | 12 / 14 ms | 0 / 0 | 0 | 0 |
| (c) Settings/back ×5 | 47 / 19 (40.43%) | 89 / 97 ms | 0 / 0 | 0 | 0 |
| (d) composer typing, then cleared | 141 / 14 (9.93%) | 10 / 19 ms | 0 / 0 | 0 | 0 |
| (e) send `Say only: ok`, in-stream capture | 1010 / 44 (4.36%) | 13 / 950 ms | 15 / 1388 | 22 | 1 / 2.548 ms paused |

For (e), a separate post-completion `gfxinfo` read a few minutes later showed
1929 frames, 71 janky (3.68%), p90 13 ms, p99 950 ms; it includes that extra
idle period and is not the table window. The app-PID GC line reports `total
58.795ms`, of which the two reported pauses sum to 2.548 ms. No GC or app-PID
skipped-frame events were seen in (a)–(d). `OpenGLRenderer` slow-frame lines:
0.

The sampled top-thread peaks were: (a) main 92.3%, Jit 84.6%,
`mqt_v_native` 88.8%; (b) RenderThread 48.1%, main 30.7%, `mqt_v_js` 7.6%,
`pool` 7.6%; (e) `mqt_v_native` 75.0%, main 50.0%, RenderThread 26.9%,
`mqt_v_js` 23.0%, `ncFunctionQueue` 7.6%. `mqt_v_js` is the Hermes JS thread
seen by `top`/simpleperf. The raw 10-symbol lists for main, JS, ART Jit, and
`mqt_v_native` in (b) and (e) are in
`raw/session-20260927-diagnosis/symbols-by-thread.txt`.

The profiler was the S23's `/system/bin/simpleperf` (`1.build.S911USQS6EYL1`),
not an NDK host binary. Both 15-second records succeeded: scroll had 44,716
samples and 0 lost; streaming had 46,531 and 3 lost. Main-thread samples in
(b)/(e) were led by `write`, `syscall`, ART interpreter dispatch, and JNI
bridges. JS-thread samples were low-rate Hermes/React work. Jit-thread samples
were mostly clock/syscall and ART JIT bookkeeping/compilation symbols; Jit
was not the dominant sampled thread in either profile. During (e),
`mqt_v_native` was dominated by `__ioctl`, `__memmove_aarch64_simd`,
`mmap64`, `munmap`, and `llama_vocab::impl::load`.

The captured PID (16346) emitted 1,578 `KALSA_*` lines in (a), 50.3 lines/s,
and 2,005 in (e), 57.7 lines/s (1,994 were `KALSA_NATIVE`). Across the capture
the highest one-second bin was 1,102 `KALSA_NATIVE` lines at 08:16:03. That
burst immediately preceded the main-thread frame warnings. Example lines:

```text
09-27 08:16:05.378 16346 18659 I HWUI: Davey! duration=970ms; ...
09-27 08:16:05.379 16346 16346 I Choreographer: Skipped 107 frames! The application may be doing too much work on its main thread.
09-27 08:16:18.498 16346 16378 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":14395.649,"promptN":1660,...}'
09-27 08:16:26.178 16346 16378 I ReactNativeJS: KALSA_TELEMETRY {"tokensPredicted":73,"predictedMs":7155.704,"predictedPerSecond":10.2016517,"prompt_n":13,...}
```

Across logcat records timestamped from 07:56 onward: 23 device-wide
Choreographer skipped-frame lines, 40 Davey lines, 149 GC lines, 1,528
ActivityManager lines, and 9 lowmemorykiller lines. These include other PIDs;
within app PID 16346 there was only the one GC above. The early buffer before
07:56 was excluded from these session counts.

ART `dumpsys package` reports `arm64: [status=run-from-apk] [reason=unknown]
[primary-abi] [location is error]`; it gives no compiler filter. The requested
`cmd package dump-profiles com.kalsa.app` completed and flushed/saved the
profile. No compilation command changed ART state. The `run-from-apk` result
means there is no reported AOT dexopt artifact; JIT activity is visible in
the simpleperf symbols.

Best-supported hypothesis: native model prewarm/inference work and the
`KALSA_NATIVE` log-mirror burst are overwhelming the UI pipeline together.
The 1,102-lines/s burst is followed by 1,388 skipped frames and 22 Daveys
during (e), while `mqt_v_native` reaches 75% in sampled top and simpleperf
shows model-load/memory/syscall work there. Main-thread samples show bridge,
interpreter, and writes; the Jit samples do not explain the stream stall by
themselves. This is correlation from one diagnostic session, not proof that
logging alone causes the stutter.

Capture caveats: the first (c) navigation attempt used the wrong coordinates;
only the final capture with five verified Settings/back transitions is in
the table. The first (d) touch missed the composer and activated read-aloud
on an existing response; the successful chunked typing was later cleared, but
read-aloud may have overlapped that capture. The raw stream includes those
attempts for audit; early c/d readings are not used above. Full logs and
per-scenario captures are in `raw/session-20260927-diagnosis/`.

## 2026-09-27 — ART speed compile test (diagnostic, on charger)

The S23 remained on AC power for this diagnostic test. Battery was 92%,
temperature 31.9 C, and `persist.traced.enable=0`; it was Awake/unlocked for
the measured scenarios. No app data or settings were changed.

| State / scenario | Dexopt status | Gfx result (diagnostic, on charger) |
|---|---|---|
| Before command | `run-from-apk`, `reason=unknown` | Prior diagnostic A: 68 frames, 5 janky (7.35%), p90/p99 12/150 ms; C: 47 frames, 19 janky (40.43%), 89/97 ms |
| After `compile -m speed -f` | `verify`, `reason=cmdline` | A: 10 frames, 5 janky (50.00%), p90/p99 42/42 ms; C: 54 frames, 25 janky (46.30%), 85/93 ms |
| After `compile --reset` | `verify`, `reason=install` | Default filter restored; status text differs from initial `run-from-apk` |

Both compile commands returned `Success`. The requested `speed` compilation
did **not** appear as a speed filter: while running both scenarios the package
reported `status=verify reason=cmdline`, so this is not a valid speed-vs-
uncompiled comparison. `--reset` succeeded and returned to the default verify
filter, but the final dexopt status is not textually identical to the initial
`run-from-apk/unknown` state. No further compiler changes were attempted.

The cold-launch sample reached 50.00% janky across only 10 rendered frames.
During the Settings/back ×5 sample, simpleperf recorded 8,318 samples in
15.0013 s with 0 lost; top-10 sampled main-thread symbols are in
`raw/session-20260927-art-speed/c-settings/main-top10.txt`. Leading symbols
were `art::interpreter::DoCall` (4.95%), `ExecuteSwitchImplCpp` (3.84%),
`__ioctl` (3.53%), and `NterpGetMethod` (1.78%). `ScopedCheck::CheckFieldAccess`
also appears for the app main thread. Top snapshots showed `mqt_v_native`
811% during cold launch; during Settings, main reached 38.4%, the ART pool
23.0%, and `mqt_v_js` 15.3%.

Runtime evidence points at the debuggable app: package flags contain
`DEBUGGABLE`, and the fresh process logs:

```text
09-27 08:35:52.398 1057 1057 I com.kalsa.app: Late-enabling -Xcheck:jni
```

`dalvik.vm.usejit=true`; `/proc/1057/cmdline` contains only `com.kalsa.app`
and does not expose `-Xcheck:jni`. The simpleperf metadata identifies
`app_type=debuggable`. The main profile contains interpreter dispatch,
`artQuickToInterpreterBridge`, and CheckJNI `ScopedCheck` work even after the
speed command. This supports the debug-runtime explanation; the requested
speed filter was not active for these captures. Raw commands, before/after
dexopt dumps, process flags, gfxinfo, top, simpleperf, and logcat are in
`raw/session-20260927-art-speed/`.
