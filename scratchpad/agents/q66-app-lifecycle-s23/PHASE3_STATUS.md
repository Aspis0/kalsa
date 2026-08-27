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
  The push-triggered run was started once and was still `in_progress` at the
  time of this record; its head SHA is the workflow commit above.

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
