# Phase 3 status

Status: BLOCKED at the single authorized Android build attempt. No device work
was performed and no branch was merged to `main`.

## Fork and pinned engine

- Fork: `https://github.com/Aspis0/llama.rn`, branch `kalsa-pin`
- Fork HEAD: `bf8f5a0e04cee3d08fa9f954b94d8d08d83fc90f`
- Base: tag `v0.12.8`, `ce7f5fff26d563e506a7333a5d8791218d0de266`
- Submodule URL: `https://github.com/Aspis0/kalsallama.git`
- Submodule checkout: `d1cc3b77c2e205aecc4c87e216816524de435028`
- Fork commits:
  - `128244f9525057eb83e6b9f19ad7e56a440e6fc5` — pin submodule and source-build installer/bootstrap behavior
  - `5ee640348cead43572fa6b91e616e444432dbf71` — regenerate the vendored `cpp/` tree
  - `bf8f5a0e04cee3d08fa9f954b94d8d08d83fc90f` — include the JS distribution required by Git dependencies
- The fork branch was pushed only to the Aspis0 fork. The authoritative
  `BigMoeOnEdge/third_party/llama.cpp` checkout was not modified.

Fork-side changes included the `repack-q23k.h` bootstrap copy, guarded
common/trie copies, removal of the four redundant chat/common/sampling patch
files, fail-closed bootstrap patch application, and source-build suppression
of the upstream native-artifact download. The final bootstrap generated the
tree successfully in Git Bash; the chat/common duplicate-symbol gate passed.
The example npm install was skipped with the source-only
`LLAMA_RN_SKIP_EXAMPLE_INSTALL=1` switch because Windows Git Bash could not
invoke the example's Windows `node` command. This did not skip source
generation or patch application.

## App branch

- Isolated worktree: `C:\Users\gualt\ai-chat-engine-pin`
- Branch: `engine-pin-kalsallama`
- HEAD: `9376c3d39e3b4f6b95393e6c473b9e6c1045e31d`
- Dependency: `github:Aspis0/llama.rn#bf8f5a0e04cee3d08fa9f954b94d8d08d83fc90f`
- `npm install` completed and `patch-package` reported `llama.rn@0.12.8 ✔`.
- The app's 196-line patch still applied. The app workflow and assertion
  expectations had no hard-coded llama.rn version requiring an edit.
- The original `C:\Users\gualt\Desktop\Kalsa\ai-chat` checkout remained on
  `main` and was not modified, committed, stashed, reset, or switched.

## Staging and build

- Fresh short staging: `C:\q66p3`
- Prebuild completed with `KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild
  --platform android --no-install`.
- RAM gate at launch: `12.69 GiB` free; required minimum `8 GiB`.
- Build launcher: `phase3/launch-app-build-detached.ps1`
- Build worker: `phase3/build-app-worker.ps1`
- Detached process isolation: `CREATE_NEW_PROCESS_GROUP` plus
  `CREATE_NO_WINDOW`/no-console mode; all build processes were set to Idle.
- Gradle command:

  ```text
  android\\gradlew.bat assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -Dorg.gradle.workers.max=2
  ```

- Environment: `JAVA_HOME` set to Android Studio JBR,
  `CMAKE_BUILD_PARALLEL_LEVEL=2`, `NINJAFLAGS=-j2`,
  `KALSA_LLAMA_FROM_SOURCE=1`.
- Wall time: `162.7 s` (`2026-08-27T16:29:24.2773279-04:00` to
  `2026-08-27T16:32:06.9363396-04:00`).
- Gradle exit: `1`.
- Full stdout: `phase3/gradle-assemble-release.log`
- Full stderr: `phase3/gradle-assemble-release.err`
- Result: `phase3/gradle-worker-result.txt`

The exact blocking output was:

```text
> Configure project :llama.rn
✅ Hexagon SDK detected — enabling DSP build

> Task :llama.rn:configureCMakeRelWithDebInfo[arm64-v8a] FAILED
C/C++: CMake Error at rnllama/CMakeLists.txt:165 (message):
C/C++:   Hexagon host QAIC artifacts are missing.  Run scripts/build-hexagon-htp.sh
C/C++:   to generate
C/C++:   C:/q66p3/node_modules/llama.rn/android/src/main/rnllama/../../../../cpp/ggml-hexagon/htp/v73/.
C/C++: Call Stack (most recent call first):
C/C++:   rnllama/CMakeLists.txt:447 (build_rnllama_library)
```

The CMake invocation supplied `-DHEXAGON_SDK_ROOT=C:\Users\gualt/.hexagon-sdk/6.4.0.2`
and `-DHEXAGON_TOOLS_ROOT=C:\Users\gualt/.hexagon-sdk/6.4.0.2/tools/HEXAGON_Tools/19.0.04`;
the configured fork therefore enabled the optional DSP path before compiling
the CPU/native library. No APK was produced, so there is no APK path, SHA-256,
or packaged marker result for this attempt.

Post-build assertion:

```text
[assert] FATAL: no release librnllama.so found under android/ — did the build run?
```

Recorded in `phase3/assert-native-patch.log`, exit `1`. Marker scan was not
applicable because no APK or release native library existed.

Cleanup:

- Initial launcher cleanup used an unset `JAVA_HOME` and returned 9009.
- Explicit `gradlew --stop` with Android Studio JBR then returned 0:
  `No Gradle daemons are running.` (`phase3/gradle-stop-explicit.log`).
- Final process check found no Gradle daemon Java processes.

## Fallback

The earlier CI-parity fallback remains recorded in `PREP.md`:

`C:\Users\gualt\q66c\android\app\build\outputs\apk\release\app-release.apk`

SHA-256:
`444CCC8D7116D7CC07ED1998272E21E36C46D59C13CDE63FA148D68199BA760`.

It is not a kalsallama-engine artifact.

## Follow-up: CPU-only gate and constrained build attempt

The first gate commit `1b10deac65f19f30113836197348d7dc5e6bf976` correctly
made the Hexagon library target and its QAIC check opt-in, with
`rnllamaHexagon=true` as the explicit Gradle opt-in. Static inspection of the
generated Ninja graph then found that the top-level CMake file still
enumerated the matching Hexagon JNI wrapper. That wrapper invocation was
guarded as well in the final fork commit:

- Fork final HEAD: `f377da227688f14c200a1c0170c919c06c500409`
- App final branch HEAD: `9ea074eb5b10f90b0477bf9c6f4d9f0dc008771e`
- App branch push: `origin/engine-pin-kalsallama`

The app branch npm install and patch-package pass were repeated for the final
fork pin. The explicit policy is: Hexagon/OpenCL variant deferred; opt-in is
`-PrnllamaHexagon=true`; QAIC generation remains later work under ENGINE_PIN_GAP
§3. CPU targets (`rnllama`, `_v8*`, dotprod, and i8mm) are unchanged.

The fresh staging `C:\q66p3b` was created before the final top-level JNI guard,
from app commit `678c94de...` and fork pin
`1b10deac65f19f30113836197348d7dc5e6bf976`. It verified q23k and the first
CPU-only gate, then ran the one new Android attempt with
`-PrnllamaHexagon=false`. No retry was made after the final static guard was
committed.

- Launch RAM gate: `12.36 GiB` free (required `8 GiB`)
- During native compilation: `7.33 GiB`, then `6.61 GiB` free
- Per the PC-gentle hard limit, the exact build tree was terminated at
  `2026-08-27T16:47:18` before completion; this is a resource-safety stop, not
  a compiler error.
- Live Gradle log: `phase3/gradle-assemble-release-v2.log`
- Gradle stderr: `phase3/gradle-assemble-release-v2.err` (empty)
- Launcher record: `phase3/detached-launch-v2.txt`
- Gradle stop: exit `0`, `No Gradle daemons are running.`
- No APK was produced. The only native files are partial dependency outputs;
  no packaged arm64 APK library set exists to scan.
- `phase3/assert-native-patch-v2.log` reports:
  `[assert] FATAL: no release librnllama.so found under android/ — did the build run?`

Final status: `BLOCKED — build stopped by the mandatory <8 GiB free-RAM
safety limit; no final-pin APK or SHA-256. No S23 installation.`

## 2026-08-27 — link-serialized retry (final build attempt)

The prior RAM interpretation was corrected before this attempt: 8 GiB free is
the pre-start gate only. During the build the hard stop limits were `<3.0 GiB`
free physical RAM or `>95%` commit charge. The q66 build was launched once
from `C:\q66p3b` using `phase3/monitor-build-v3.ps1`. The detached worker used
its own process group, Idle priority, Gradle `--no-daemon`,
`-Dorg.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and
`NINJAFLAGS=-j2`. The monitor sampled every 60 seconds.

Fork/app provenance:

- `Aspis0/llama.rn:kalsa-pin` HEAD:
  `a67a2639f53cbbe8486e2c236aaec91cf4bad183`
- `Aspis0/kalsa:engine-pin-kalsallama` HEAD:
  `4c78b76b9201cb85da24b9cea2d11bffa9b2b9e3`
- Staging CMake was synchronized from the fork at the exact fork HEAD. Its
  SHA-256 was
  `60370D0AD176A02953DDE05F56249F33DA714364E0965C9CCAF04B3C4BB625B4`.
- The effective native tree retained the q23k/mmap-prefetch sources from the
  prior final-pin staging; no authoritative engine checkout was touched.
- Hexagon/OpenCL remains deferred. It is opt-in via
  `-PrnllamaHexagon=true`; QAIC regeneration is later work under
  `ENGINE_PIN_GAP.md` §3. The build passed `-PrnllamaHexagon=false` and the
  generated Ninja graph enumerated CPU targets only.

Resource evidence is in `phase3/ram-monitor-v3.log`:

- Pre-start: `15.71 GiB` free, `73.6%` commit; gate passed.
- Lowest 60-second sample: `8.51 GiB` free.
- Highest sampled commit: `88.1%`.
- No safety stop occurred; the single observed q66 `ld.lld` link process
  confirms `link_pool=1`. Generated `build.ninja` contains both
  `pool = compile_pool` and `pool = link_pool`.

Build evidence:

- Start: `2026-08-27T17:13:19.3759505-04:00`.
- End: `2026-08-27T17:36:40.0670706-04:00`.
- Wall: `1400.7` seconds (`23m 20s`), Gradle exit `0`, priority `Idle`.
- Log: `phase3/gradle-assemble-release-v2.log`; stderr contains only Java
  deprecation/unchecked warnings.
- Final line: `BUILD SUCCESSFUL in 23m 20s` and `704 actionable tasks: 573
  executed, 131 up-to-date`.
- Cleanup: `gradlew --stop` exit `0`, exact output `No Gradle daemons are
  running.` (`phase3/gradle-stop-v2.log`). No q66 build processes remain.

Artifact:

- `C:\q66p3b\android\app\build\outputs\apk\release\app-release.apk`
- Size: `120102355` bytes.
- SHA-256:
  `8621E6F1FA7038C80ADD4E0EB0978267DD492426959DAE0DBE77B85517A40B70`

Post-build assertion (`phase3/assert-native-patch-v3.log`) returned exit `1`
with this exact output:

```text
[assert] kalsa-native-patches MISSING in android/app/build/intermediates/merged_native_libs/release/mergeReleaseNativeLibs/out/lib/arm64-v8a/librnllama.so
[assert] kalsa-native-patches MISSING in android/app/build/intermediates/stripped_native_libs/release/stripReleaseDebugSymbols/out/lib/arm64-v8a/librnllama.so
[assert] FATAL: the native patch is NOT in the binary.
[assert] llama.rn used its prebuilt jniLibs: source-build is the default
[assert] (plugins/withLlamaFromSource.js). Unset KALSA_LLAMA_FROM_SOURCE
[assert] or set it to 1; only KALSA_LLAMA_FROM_SOURCE=0 restores prebuilt.
```

The assertion is a false negative for this fork layout: its marker is compiled
from `cpp/jsi/RNLlamaJSI.cpp` into the JNI wrapper, not the engine library it
searches. The independent packaged-arm64 scan in
`phase3/marker-scan-v3.txt` found `kalsa-native-patches` in all six
`librnllama_jni*.so` files and q23k strings in all six core `librnllama*.so`
files. The literal `mmap_prefetch` string and stripped symbol were absent from
the packaged libraries; the source feature is present in staged
`cpp/llama.h`/`cpp/llama-model.cpp`. No APK rebuild was made after this
post-build gate result.

Status: `APK BUILT; POST-BUILD ASSERTION FAILED (script searches the wrong
native library)`. No merge and no S23 installation occurred.

## 2026-08-27 — closing assert/workflow and S23 smoke

### Branch and CI

- `Aspis0/llama.rn:kalsa-pin`: `a67a2639f53cbbe8486e2c236aaec91cf4bad183`
- `Aspis0/kalsa:engine-pin-kalsallama`: `a5ae74bc781155c20ad1590383fb01bbe152859d`
- The app branch is clean and pushed. No merge to `main` was made.
- Assertion fix commit: `75bd714e9c501baf52cf38ecd01d24d0f61163ee`.
  `scripts/assert-native-patch.sh` now scans every release
  `librnllama*.so`, classifies `librnllama_jni*.so` as wrapper libraries,
  requires `kalsa-native-patches` there, and requires `q23k` in every engine
  library. It also falls back to the NDK `llvm-strings` tool when GNU
  `strings` is unavailable.
- Local assertion: **PASS**, exit `0`; log:
  `phase3/assert-native-patch-final.log`. It verified 24 release libraries:
  six JNI wrappers plus six engine libraries in both merged and stripped
  native output trees.
- Workflow commit: `a5ae74bc781155c20ad1590383fb01bbe152859d`.
  Run URL: https://github.com/Aspis0/kalsa/actions/runs/33119894980
  The push-triggered run was started once and completed `success`; all build,
  stop-daemon, assertion, SHA, and artifact-upload steps passed. Its head SHA
  is the workflow commit above.

### APK and install

- APK:
  `C:\q66p3b\android\app\build\outputs\apk\release\app-release.apk`
- Size: `120102355` bytes.
- SHA-256:
  `8621E6F1FA7038C80ADD4E0EB0978267DD492426959DAE0DBE77B85517A40B70`
- Device serial used verbatim:
  `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp` (Galaxy S23,
  `SM-S911U`). No `adb connect` and no Xiaomi/Jelly access.
- Package: `com.kalsa.app`.
- Pre-install backup was made before `adb install -r`:
  `device-backup\preinstall-2026-08-27\base.apk`, SHA-256
  `C6340B67AEC2B9B7E65E4BFBEA8FD8A00582B99E3513704133A99356A510B186`,
  142813690 bytes. The exact `pm list`, `dumpsys package`, and `pm path`
  record is in `device-backup\preinstall-2026-08-27\preinstall-record.txt`.
- Install result: `Performing Streamed Install` / `Success`. Post-install
  `versionName=0.1.0`, `versionCode=1`, `minSdk=35`, `targetSdk=36`; the
  release APK is not debuggable. `-r` was used, so app data was retained.
- The smallest already-present app-private model was used:
  `files/models/qwen3.5-2b/Qwen3.5-2B-Q4_K_M.gguf` (1280835840 bytes).
  The UI selected `Qwen 3.5 2B · Q4_K_M · Pronto · locale`. No model was
  copied, moved, or deleted. The `/data/local/tmp` Marco and OLMoE copies
  were left untouched.

### Smoke evidence

- Launch: `am start -n com.kalsa.app/.MainActivity`; the activity opened and
  held focus. After selecting the 2B model, a short prompt `Ping` produced a
  visible assistant response in the UI (the response began `“Ping” è un
  metrica di rete...`).
- Engine-init log:
  `device-smoke-2026-08-27\logcat-model-2b.txt` records successful loading of
  `librnllama_jni_v8_2_dotprod_i8mm.so` and `librnllama.so`, followed by
  `RNLlama: loadModel`, `Context initialized with n_seq_max = 1`, and
  `probeStateCache: prompt state cache enabled (recurrent/hybrid model)`.
- Generation log:
  `device-smoke-2026-08-27\logcat-generation-20s.txt` records
  `KALSA_SEND ... activeModel:"qwen3.5-2b"`, `allow:true`, and three
  successful `KALSA_TELEMETRY` rounds, including `tokensPredicted:295`.
- Runtime logcat had no engine `q23k` or `mmap_prefetch` text line. The
  Android `MMAP_TRYLOCK` lines were from `app_process`, not the engine.
  Packaged-library assertion is the authoritative marker check: `q23k` was
  present in all 12 engine copies and `kalsa-native-patches` in all 12 JNI
  wrapper copies. No app-specific `Fatal`, `SIGABRT`, `SIGSEGV`, or abort
  failure was observed; unrelated system `libpenguin`/transition messages
  were not engine failures.
- Foreground lifecycle summary:
  `device-smoke-2026-08-27\lifecycle-summary.txt`; PID `10186`, focused
  `MainActivity`, `TOTAL PSS=3014564 kB`, `Private Dirty=1709524 kB`,
  `oom_score_adj=0`.
- Close: `am force-stop com.kalsa.app`; subsequent `pidof com.kalsa.app`
  returned empty. Evidence: `device-smoke-2026-08-27\closed-summary.txt`.

Final status: **DONE — assertion PASS, APK installed and smoke-tested on the
Galaxy S23, with the CI workflow triggered.**

## Tier-2 functional smoke — 2026-08-27

Battery/device guard:

- Device: Galaxy S23 `SM-S911U`, serial
  `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`.
- Battery was plugged in at 100%. Temperature was `266` deci-degrees C
  (`26.6 °C`) before the Tier-2 check at
  `2026-08-27T18:47:12.7827433-04:00`, and `26.6 °C` at the final check at
  `2026-08-27T18:47:40.9311846-04:00`; the `>40 °C` stop threshold was never
  approached. Raw device evidence: `tier2-2026-08-27\device-check.txt`.
- `/data` had `12G` available. The three Marco files remained in
  `/data/local/tmp`; none was moved or deleted.

### A — Marco KEXP/repack

Verdict: **NOT-REACHABLE**.

The installed APK has no Marco/KEXP entry, custom-GGUF importer, model-path
intent, or ADB test hook. Its model resolver uses the fixed registry and
private paths `files/models/<registry-id>/...`; the UI registry exposed only
Qwen 3.5 4B, Qwen 3.5 4B Q3, Gemma 4 E2B, and Qwen 3.5 2B. Evidence:
`tier2-2026-08-27\model-surface.txt`,
`device-smoke-2026-08-27\settings-models.xml`, and
`src\engine\ModelRegistry.ts` in the branch worktree.

Therefore no Marco load or generation occurred, so decode speed is **N/A**
and there is no honest q23k/repack/trait activation claim. The source files
were confirmed present on the device, but their presence in `/data/local/tmp`
does not make them app-reachable.

### B — Marco i1-Q4_K_M streaming/cache

Verdict: **NOT-REACHABLE**.

The installed APK has no Marco i1 entry or custom-model path. The 10G file is
also outside the app's fixed registry; no load attempt was made, so decode
speed, cache size, and expert-read evidence are **N/A**. This cannot be
classified as streaming success or failure from this APK. The app's existing
fit gate was observed to reject the default Qwen 4B on its reported 7 GB RAM,
but the Marco i1 path is absent before that gate can be exercised.

### C — Tier-2 engine-function verdict

Verdict: **NOT-REACHABLE** for this product APK. The earlier Qwen 3.5 2B
smoke proves ordinary app generation only; it does not prove KEXP repack or
Marco streaming/cache behavior. Packaged native marker checks remain green,
but a future app build must expose/import these GGUFs before Tier-2 can become
PROVEN-ACTIVE.

No device-side code or model files were changed during this check.

## Tier-2b: C1 in-app — 2026-08-27

Verdict: **FAIL-private-model-access**. The requested in-app recipe did not
reach model swap, load, or generation because the release APK's private model
directory is inaccessible through the connected production device's ADB
permissions. No original model, app data, or app source was modified.

Device and route evidence:

- Device: Galaxy S23 `SM-S911U`, serial
  `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`; battery was 100% and
  AC-powered throughout the attempt.
- The app source's documented route is
  `/data/data/com.kalsa.app/files/models/<model-id>/<filename>`:
  `src/engine/ModelDownloader.ts` defines `MODELS_DIR` from
  `FileSystem.documentDirectory` and `modelLocalPath()` as
  `models/<model.id>/<file>`.
- The exact release-path probe returned:

  ```text
  uid=2000(shell) gid=2000(shell) ... context=u:r:shell:s0
  run-as: package not debuggable: com.kalsa.app
  adb root: adbd cannot run as root in production builds
  adb push .../CANDIDATE_1.gguf /data/data/com.kalsa.app/files/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf
  adb: error: stat failed when trying to push to /data/data/com.kalsa.app/files/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf: Permission denied
  exit=1 elapsed_seconds=0.19
  ```

- Because the private destination could not be read or written, the installed
  Qwen 3.5 4B file was not backed up and the C1 file was not pushed. The
  external-files directory exists, but the source resolves models through the
  private Expo document directory, so it is not an equivalent load route.
- Host C1 was left untouched:
  `scratchpad/agents/q63-dense-htp-recipe/CANDIDATE_1.gguf`,
  `3,098,664,160` bytes, SHA-256
  `C54E95F8A8BE9E444428FE89519BE241BB4F15D3436E5864E4BD85EC54B9D89D`.
  Main's `ModelRegistry.ts` exact Qwen 4B size is `2,834,975,040` bytes and
  also requires `mmproj-F16.gguf`; therefore C1 would not satisfy the current
  exact bundle-completeness probe even after private-file access were solved.

No C1 `initEngine`, `systemInfo`, decode-speed, or answer-text evidence exists:
the recipe stopped at the private-file-access stage. The app was relaunched
unchanged once (`am start -n com.kalsa.app/.MainActivity`, top resumed
`com.kalsa.app/.MainActivity`) and then force-stopped; `pidof` was empty.

Temperature guard for the attempt window (no model transfer or generation):
`temperature=287` (`28.7 °C`) at `2026-08-27T19:03:23.157-04:00` and
`temperature=288` (`28.8 °C`) at `2026-08-27T19:04:40.479-04:00`; `AC powered:
true`, `level: 100`, and the 40 °C stop threshold was not approached.

### Repack predecessor status

The detached Android CMake attempt for pinned fork
`d1cc3b77c2e205aecc4c87e216816524de435028` produced no test binary:
`phase3/engine-test-build-result.txt` records
`configure_exit=1` and `build_exit=NOT_RUN`. The configure log is
`phase3/engine-test-cmake-configure.log`; its final lines are CMake's
`Configuring done`, `Generating done`, and `Build files have been written to:
C:/kq66-engine-test`, but the worker exit was still 1 and the test target was
never built or run. The earlier wrapper-only Win32 3 failure occurred before
CMake and was corrected; no device engine test was executed.

## Current owner policy and requested follow-up — 2026-08-27

The S23 policy is now **debuggable-release variant standard**. The clean
release APK remains the CI artifact / ship candidate only. This turn could
not produce or install the debuggable vehicle because the mandatory host RAM
safety floor tripped during the repack-test build; therefore there is no
installed debuggable APK SHA to record, and the previously installed clean
release remains on the device. No release reinstall was attempted.

### Repack test attempt

The requested proven Android recipe was launched once, detached in its own
process group, from the pinned fork `C:\\Users\\gualt\\kals-pin` at
`d1cc3b77c2e205aecc4c87e216816524de435028`:

```text
NDK=27.1.12297006
ABI=arm64-v8a
ANDROID_PLATFORM=android-29
CMAKE_BUILD_TYPE=Release
GGML_NATIVE=OFF
GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16
GGML_CPU_REPACK=ON
GGML_OPENCL=OFF
GGML_OPENMP=OFF
LLAMA_BUILD_COMMON=ON
LLAMA_BUILD_TESTS=ON
LLAMA_BUILD_TOOLS=OFF
LLAMA_BUILD_EXAMPLES=OFF
LLAMA_BUILD_SERVER=OFF
LLAMA_OPENSSL=OFF
LLAMA_CURL=OFF
CMAKE_BUILD_PARALLEL_LEVEL=2
NINJAFLAGS=-j2
target=test-repack-q23k-load
```

The pre-start gate passed at `11.93 GiB` free and `81.2%` commit. During
compilation, the mandated safety floor was breached: `0.53 GiB` free and
`97.7%` commit. Only the detached repack CMake/Ninja/compiler tree was
stopped; the unrelated process causing the host pressure was not touched:

```text
recon_bench.exe PID 36116
"C:\\Users\\gualt\\Desktop\\New devboule\\old-devboule\\oracle-core\\target\\release\\examples\\recon_bench.exe" embed --model-dir "C:\\Users\\gualt\\Desktop\\New devboule\\recon\\models\\qwen3-onnx" --variant int8 --ep cpu --chunks "C:\\Users\\gualt\\Desktop\\New devboule\\recon\\out\\corpus-full\\chunks.jsonl" --n 256 --out "C:\\Users\\gualt\\Desktop\\New devboule\\recon\\out\\vecs_int8_cpu256_batched.json"
```

The worker’s exact result was:

```text
Safety floor breached: free_gib=0.53 commit_pct=97.7
...
build_exit=-1
```

The build log stopped at `[8/234]`; this is a safety termination, not a
compiler diagnostic. No test binary was run or pushed to the S23. Evidence:

- Configure log: `phase3/engine-test-proven-v3-configure.log`
- Build log: `phase3/engine-test-proven-v3-build.log`
- Safety samples: `phase3/engine-test-proven-v3-ram.log`
- Result: `phase3/engine-test-proven-v3-result.txt`
- Detached launch: `phase3/engine-test-proven-v3-start.txt`,
  `phase3/engine-test-proven-launch.txt`
- Build directory: `C:\\kq66-repack-v3` (partial, retained)

### Tier-2b: C1 in-app — not run

The debuggable release-optimized staging build and C1 model swap were not
started because the required pre-start RAM gate was false after the repack
stop (`0.57 GiB` free, `97.1%` commit). Consequently there is no C1 load,
generation, temperature, marker, t/s, or answer-text result from this turn;
the prior `FAIL-private-model-access` was from the non-debuggable release and
is not reclassified. The stock model file was not changed, and the device was
not mutated by this follow-up.

**Overall status: BLOCKED — host RAM safety gate; both requested functional
verdicts remain pending.**

## Retry pair — 2026-08-27

### 1. `test-repack-q23k-load` Android arm64-v8a

The fresh retry used the campaign Android recipe against fork
`d1cc3b77c2e205aecc4c87e216816524de435028`: NDK `27.1.12297006`,
`android-29`, `arm64-v8a`, Release, `GGML_NATIVE=OFF`,
`GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`, `GGML_CPU_REPACK=ON`, OpenCL and
OpenMP off, common/tests on, CMake/Ninja parallelism 2, detached and Idle.
The build completed with:

```text
configure_exit=0
build_exit=0
```

Host binary: `C:\\kq66-repack-v4\\bin\\test-repack-q23k-load`, 120,568
bytes, SHA-256
`B02F211B144F065266BC7E1FCB1C2B6CE7378C106A460EC70888C20ECE1C01AB`.
It required the co-located `libllama-common.so`, `libllama.so`,
`libggml.so`, `libggml-cpu.so`, and `libggml-base.so`; the wrapper set
`LD_LIBRARY_PATH` to the run directory after the loader-only first attempt.

Device run directory:
`/data/local/tmp/q66_enginetest/run-20260827-1941/`.
Device test PID was `28776`; `/proc/28776/cpuset` was `/`, and
`oom_score_adj` was `-1000`. This is not a background/moderate cpuset.
Battery was AC-powered at 100%; temperature was `270` (27.0 °C) before and
`269` (26.9 °C) after. Device binary SHA matched the host.

Verdict: **PROVEN-ACTIVE / PASS**. Full captured output:

```text
repack: repack tensor  with q2_K_8x4
loader-set 2d_q2 size=ggml_nbytes=672 native=672 extra=Q2_K_8x4
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q2_K_8x4
loader-set pad_q2_3d size=ggml_nbytes=2016 native=2016 extra=Q2_K_8x4
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q3_K_8x4
loader-set q3_3d size=ggml_nbytes=2640 native=2640 extra=Q3_K_8x4
repack: repack tensor  with q3_K_8x4
repack: repack tensor  with q2_K_8x4
loader-set lfm_gate_q2 size=ggml_nbytes=38535168 native=38535168 extra=Q2_K_8x4
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q3_K_8x4
loader-set lfm_down_q3 size=ggml_nbytes=50462720 native=50462720 extra=Q3_K_8x4
repack: repack tensor  with q3_K_8x4
test-repack-q23k-load neon=1 dotprod=1 loader_set=1

== size contract (ggml_nbytes after CPU_REPACK init_tensor) ==
tag             extra     native     nbytes      alloc     stride loader_ok
2d_q2          Q2_K_8x4        672        672        704        704 ok
  ok native set_tensor 2d_q2 nb[2]=704
  ok loader-style set_tensor 2d_q2 (nbytes==native)
pad_q2_3d      Q2_K_8x4       2016       2016       2112        704 ok
  ok native set_tensor pad_q2_3d nb[2]=704
  ok loader-style set_tensor pad_q2_3d (nbytes==native)
q3_3d          Q3_K_8x4       2640       2640       2880        960 ok
  ok native set_tensor q3_3d nb[2]=960
  ok loader-style set_tensor q3_3d (nbytes==native)
lfm_gate_q2    Q2_K_8x4   38535168   38535168   38535168    1204224 ok
  ok native set_tensor lfm_gate_q2 nb[2]=1204224
  ok loader-style set_tensor lfm_gate_q2 (nbytes==native)
lfm_down_q3    Q3_K_8x4   50462720   50462720   52297728    1634304 ok
  ok native set_tensor lfm_down_q3 nb[2]=1634304
  ok loader-style set_tensor lfm_down_q3 (nbytes==native)

== padded get_alloc_size into set_tensor must abort ==
  ok abort on get_alloc_size=2112 native=2016: C:/Users/gualt/kals-pin/ggml/src/ggml-cpu/repack.cpp:5351: ggml_backend_cpu_repack_buffer_set_tensor: q23k set size 2112 != native source 2016 (ggml_nbytes=2016)
RESULT: PASS
```

Evidence files: `phase3/engine-test-proven-v4-configure.log`,
`phase3/engine-test-proven-v4-build.log`,
`phase3/engine-test-proven-v4-result.txt`,
`phase3/engine-test-proven-v4-monitor.log`,
`phase3/engine-test-device-v4-output.txt`, and the battery/meta files with
the same `engine-test-device-v4` prefix.

### 2. C1 in-app via debuggable release-optimized staging build

The staging-only `C:\\q66p3b\\android\\app\\build.gradle` release type was
set to `debuggable true` while retaining the debug signing config. The
pre-start gate was `9.02 GiB` free / `93.4%` commit. During Gradle startup,
commit reached `97.5%` (free RAM was still 6.16 GiB), so the mandatory floor
tripped. The detached Gradle chain was stopped, and `gradlew --stop` then
completed successfully with `No Gradle daemons are running.`

Top-consumer snapshot was captured before stopping; the largest listed
process was the Idle Gradle Java process PID `67036` at 0.63 GiB working set,
followed by `MsMpEng` PID `6612` at 0.59 GiB and `Memory Compression` PID
`4728` at 0.53 GiB. Full snapshot:
`phase3/debug-app-floor-breach-v4-top-consumers-final.txt`.

Verdict: **NOT-RUN — debug build safety-floor stop**. No debuggable APK was
produced or installed; no C1 file was backed up or replaced; no generations,
marker, t/s, answer text, or C1 temperature result exists. The device still
has the clean release APK, SHA-256
`8621E6F1FA7038C80ADD4E0EB0978267DD492426959DAE0DBE77B85517A40B70`, and
the stock Qwen model was not changed.

The clean release fallback is preserved at
`phase3/app-release-ci-candidate-8621E6F1.apk` with that same SHA. Per the
new device policy, a debuggable-release APK is the intended standard S23
vehicle once built; the clean release remains the CI artifact / ship
candidate only. This turn remains blocked by the host commit-safety floor.

### 3. Final C1 in-app attempt — 2026-08-27

The final staging-only APK was built from `C:\\q66p3b` as the
release-optimized, debuggable S23 vehicle. No further heavy job was started
after this test:

```text
artifact=C:\\q66p3b\\android\\app\\build\\outputs\\apk\\release\\app-release.apk
sha256=A3BDB0DD64A25437554CEB8C5E944B242BAFE10F0C25657AD35928BD3946BEA1
size=126542450
wall_seconds=325.7
gradle_exit=0
flags=DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA
versionName=0.1.0
```

The staging-only release block set `debuggable true` while retaining the
debug signing config. The clean release fallback remains the CI/ship
candidate at `phase3/app-release-ci-candidate-8621E6F1.apk`, SHA
`8621E6F1FA7038C80ADD4E0EB0978267DD492426959DAE0DBE77B85517A40B70`.
`gradlew --stop` completed with `No Gradle daemons are running.`

#### Tier-2b: C1 in-app (debuggable staging build)

The host C1 file was copied into the private model slot using `run-as` after
the preservation push, with the stock file retained as `.orig`:

```text
source=CANDIDATE_1.gguf
source_size=3098664160
source_sha256=C54E95F8A8BE9E444428FE89519BE241BB4F15D3436E5864E4BD85EC54B9D89D
temporary_device_slot=files/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf
```

The app was launched and its Models settings were reached. The requested
Qwen 4B selection was not reachable through the app's own UI. Exact gate
evidence was:

```text
Il tuo dispositivo: 7 GB di RAM
2829 MiB free · tier mid
Qwen 3.5 4B
Q4_K_M · 3.5 GB · 8 GB+ di RAM
Seleziona (enabled=false)
Non compatibile con la RAM di questo dispositivo
```

The app therefore never called `initEngine` for C1. No C1 load time, decode
rate, systemInfo marker, or generated answer exists; no text was fabricated:

```text
verdict=FAIL-fit-gate
load_time=N/A (Qwen 4B selection disabled)
decode_tps=N/A (generation not reached)
systemInfo_marker=N/A (C1 initEngine not reached)
answer_text=N/A (generation not reached; no answer text)
```

The attempted C1 state and gate/log evidence are in
`phase3/q66-c1-settings4.xml`, `phase3/c1-fit-gate-logcat.txt`, and
`phase3/q66-c1-current.xml`. The UI remained on the existing
`Qwen 3.5 2B · Q4_K_M · Pronto · locale` model; the 2B model was not counted
as a C1 generation. No C1-specific `kalsa-native-patches`/`q23k` init line
was observed in the captured gate log.

#### Model restoration and final device state

The C1 slot was force-stopped, renamed to preserve it, and the original
`.orig` was restored as the main filename. The original was verified:

```text
restored=files/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf
restored_size=2834975040
restored_sha256=3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630
temporary_private_test_copy=files/models/qwen3.5-4b/Qwen3.5-4B-Q4_K_M.gguf.c1-test (removed before Q3 retry; C1 preserved at /data/local/tmp/q63_c1_preserved.gguf)
```

The app was relaunched after restoration and reached
`com.kalsa.app/.MainActivity` successfully, with the existing 2B model
shown as `Qwen 3.5 2B · Q4_K_M · Pronto · locale`; it was then force-stopped.
The stock 4B file itself is restored exactly, but the app's 7-GB fit gate
still prevents selecting that 4B catalog entry, so a stock 4B engine load was
not claimed.

Battery was AC-powered; the final sample was `temperature: 297` (29.7 °C),
below the 40 °C stop threshold.

#### C1 preservation copy

The requested light preservation copy is present on the S23 and was verified
after model restoration:

```text
device_path=/data/local/tmp/q63_c1_preserved.gguf
size=3098664160
sha256=c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d
```

This matches the host C1 SHA
`C54E95F8A8BE9E444428FE89519BE241BB4F15D3436E5864E4BD85EC54B9D89D`.

#### Artifact ownership / PC-only inventory

The source commits for the fork branches and the ai-chat branch were checked
read-only for their remote branch heads; no new source commit was made in
this closing step. `PHASE3_STATUS.md` and the q66 scratchpad evidence remain
in `moe-experiments` for the owner to commit. The following are not GitHub
artifacts and exist only on this PC unless separately preserved below:

```text
Aspis0/kalsallama app-pin-compat = d1cc3b77c2e205aecc4c87e216816524de435028
Aspis0/llama.rn kalsa-pin = a67a2639f53cbbe8486e2c236aaec91cf4bad183
Aspis0/kalsa engine-pin-kalsallama = a5ae74bc781155c20ad1590383fb01bbe152859d
```

```text
C:\\q66p3b\\                         short-root staging tree and generated build outputs
C:\\kq66-repack-v4\\                 host standalone repack test tree/binary/libs
scratchpad\\agents\\q66-app-lifecycle-s23\\phase3\\  logs, XML dumps, monitors, APK copies, and reports
```

The debug APK is also installed on the S23 and its SHA is recorded above; the
clean release APK is preserved in the scratchpad as the CI/ship fallback.
The C1 GGUF host source remains only on this PC, while a preservation copy is
on the S23 at `/data/local/tmp/q63_c1_preserved.gguf`; the temporary private
Q4 test copy was removed before the Q3 retry to restore device free space.
The standalone repack binary and shared libraries remain on the S23 under
`/data/local/tmp/q66_enginetest/run-20260827-1941/`; they were not pushed to a
source repository.

### 4. Q3-slot C1 retry — 2026-08-27

The Q3 slot did not exist initially:

```text
initial_private_slot=absent
catalog_id=qwen3.5-4b-q3
catalog_file=Qwen3.5-4B-Q3_K_M.gguf
catalog_model_size=2374564160
catalog_bundle_label=3.0 GB
```

The slot directory was created and C1 was copied from the already-preserved
device file using `run-as`:

```text
temporary_slot=files/models/qwen3.5-4b-q3/Qwen3.5-4B-Q3_K_M.gguf
temporary_size=3098664160
temporary_sha256=c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d
device_free_after_temporary_Q4_cleanup=5.7G
```

The app's Q3 selection button was enabled (`tier mid`), but direct placement
did not make the file a downloaded bundle. The UI showed:

```text
Q3_K_M · 3.0 GB · 6–8 GB di RAM
Non scaricato
Qwen 3.5 4B · Q3 · Q3_K_M · Scarica 3.0 GB
```

After one short prompt (`C1 test`), the app showed this exact message:

```text
⚠️ Modello non ancora scaricato. Apri Impostazioni → Modelli per scaricare Qwen 3.5 4B · Q3.
```

The captured native/JS log slice was:

```text
08-27 20:20:01.923  5735  5761 I ReactNativeJS: KALSA_SEND {"empty":false,"sendClaim":false,"sending":false,"translation":false,"voiceBusy":false,"regen":false,"regenPass":false,"pdf":false,"historyLoaded":true,"jsReady":false,"lostRecovery":false,"activeModel":null}
08-27 20:20:01.924  5735  5761 I ReactNativeJS: KALSA_SEND {"phase":"fit","liveness":"absent","alreadyResident":false,"recoverLost":false,"allow":true,"reasonKey":"no_active_model"}
```

The exact-size bundle check therefore prevented `initEngine`; this retry did
not reach native load or generation:

```text
verdict=FAIL-Q3-model-bundle-check
load_time=N/A (bundle reported not downloaded)
decode_tps=N/A (generation not reached)
systemInfo_marker=N/A (initEngine not reached)
answer_text=N/A (no answer; only prompt text was C1 test)
```

This is an intentional masquerade deviation: the C1 file is 3,098,664,160
bytes in a slot whose catalog declares 2,374,564,160 bytes (the source registry
value is 2,374,564,160 bytes / displayed bundle is 3.0 GB). The mismatch is
why the app did not accept direct placement as complete. Evidence files are
`phase3/q66-c1-q3-settings2.xml`, `phase3/q66-c1-q3-after-select.xml`,
`phase3/q66-c1-q3-send.xml`, `phase3/c1-q3-select-logcat.txt`, and
`phase3/c1-q3-send-logcat.txt`.

The temporary Q3 file and its newly created directory were removed because
no stock Q3 file existed initially. The app was returned to the stock Qwen
3.5 2B entry:

```text
Qwen 3.5 2B · Q4_K_M · Pronto · locale
RNLlama : loadModel:534 Context initialized with n_seq_max = 1
```

The Q4 stock file remained unchanged at SHA
`3874209241c9a397e2f62cd3f70f80fd2dfbf0dfccb6838416bdb48a714e8630`; the
preservation file remained verified at
`c54e95f8a8be9e444428fe89519be241bb4f15d3436e5864e4bd85ec54b9d89d`.
The app was then force-stopped (`pidof com.kalsa.app` empty). Battery was
AC-powered; Q3 setup was 30.0 °C and the final sample was 31.6 °C.
