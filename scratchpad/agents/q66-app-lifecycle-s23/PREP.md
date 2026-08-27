# q66 Kalsa app-lifecycle prep

Status: `BLOCKED BUILD FAILURE`

This turn did not start Gradle/NDK, install an APK, copy/delete a device model, or run smoke. The required pre-build gate was below the hard limit: free physical RAM was 7.78 GiB, then 7.61 GiB and 7.64 GiB on read-only rechecks. The running PPL process remained `llama-perplexity.exe`, PID `3384`, priority `Idle`, command line using `-t 8`.

## Source and provenance

- App: `C:\Users\gualt\Desktop\Kalsa\ai-chat`, branch `main`, HEAD `24deb114f79a2500e72ffffefcda4b0e0b0b8b0c`.
- App working tree status at read time: `?? docs/competitive-analysis-2026-08.md` only. No tracked app file was modified; no commit, stash, reset, branch switch, or push was performed.
- Engine: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\BigMoeOnEdge\third_party\llama.cpp`, HEAD `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`, clean at read time. This checkout was not modified.
- Engine commit subject: `a0cabca6b tests: padded-size death test and SKIP 77 when 8x4 is not selected`.
- `llama.rn`: `0.12.8`.
- App patch: `patches/llama.rn+0.12.8.patch`, SHA-256 `DEC808817345DDC331B39A962CB9B8E5D1D9E0611D31C3434799633C085414B7`.
- The staged mirror contains generated `common/build-info.cpp` with `LLAMA_COMMIT = "a0cabca6b"`, `mmap_prefetch`, and `q2_K_8x4`/`q3_K_8x4` repack sources. The Kalsa patch marker is `kalsa-native-patches`.

## Read toolchain

- Node: `v26.7.0`; the repository CI note calls for Node 20, so this is a known mismatch.
- Java: Android Studio JBR `21.0.9` at `C:\Program Files\Android\Android Studio\jbr`; Java was not on PATH.
- SDK: `C:\Users\gualt\AppData\Local\Android\Sdk`; `ANDROID_HOME`/`ANDROID_SDK_ROOT` were unset.
- NDK: `27.1.12297006` (`r27b`). Installed build-tools: `34.0.0`, `35.0.0`, `36.0.0`; CMake: `3.22.1`.
- Gradle wrapper: `9.3.1`; it downloaded successfully with JBR and `--no-daemon`.
- App config: package `com.kalsa.app`, version `0.1.0`, min SDK 35, new architecture enabled. Release uses `signingConfigs.debug`; this is a debug-keystore-signed release variant, not a production signing setup.

## Staging performed

STAGING MOVED TO: `C:\kq66`

The isolated staged app was copied from `app-build` to `C:\kq66` with `robocopy /E /NFL /NDL /NJH /NJS` (exit code 0). Generated `android\.cxx`, `android\app\build`, `android\build`, all local `.gradle` directories, and generated Android package build directories were pruned from the short-root copy. The cleanup removed 17 directories with zero failures; no stale `C:\Users\gualt\Desktop\Kalsa` path was found under `C:\kq66\android`. The staged `node_modules\llama.rn\cpp\ggml-cpu\repack-q23k.h` remains present.

The app was copied to `C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\app-build` for isolation. The `llama.rn` source clone is in `llama.rn-src`; its engine source is a copy at `llama.rn-src\third_party\llama.cpp`. A dummy Hexagon SDK directory was used only to skip the optional SDK download. The original app and engine checkouts remain the authoritative untouched sources.

`npx expo prebuild --platform android --no-install` completed in the staging copy with `KALSA_LLAMA_FROM_SOURCE=1` and wrote `rnllamaBuildFromSource=true`. The staged source bootstrap and Kalsa patch were applied before prebuild. No APK was produced.

## Resume recipe, only after the RAM gate is >= 8 GiB

Run from the staging copy, after rechecking the PPL process and free RAM:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'C:\Users\gualt\AppData\Local\Android\Sdk'
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:CMAKE_BUILD_PARALLEL_LEVEL = '2'
$env:NINJAFLAGS = '-j2'
$env:KALSA_LLAMA_FROM_SOURCE = '1'
$gradlew = 'C:\Users\gualt\Desktop\Kalsa\moe-experiments\scratchpad\agents\q66-app-lifecycle-s23\app-build\android\gradlew.bat'
$buildArgs = 'assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -Dorg.gradle.workers.max=2'
cmd.exe /d /c "start `"`" /wait /low `"$gradlew`" $buildArgs"
cmd.exe /d /c "`"$gradlew`" --stop"
```

The `/low` launch, Gradle `org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2` are mandatory. Monitor RAM and build children; if free RAM drops below the safe floor or the build needs more than 8 GiB free, stop and report. Expected artifact: `android\app\build\outputs\apk\release\app-release.apk`. Record wall time, bytes, SHA-256, and search packaged arm64 native libraries for `a0cabca6b`, `kalsa-native-patches`, `kalsallama`, and `mmap_prefetch`.

## Existing APK inventory

`C:\Users\gualt\Desktop\Kalsa\APK` had no BUILD note. Read-only inventory included: `Kalsa-526323e-arm64.apk` (121,913,196 bytes, Aug 7 18:29), `Kalsa-7022c3d-arm64.apk` (121,285,871 bytes, Aug 7 16:13), `Kalsa-cpufix-edbd427-arm64.apk` (120,937,722 bytes, Aug 7 10:21), `Kalsa-nativelog-da2e2d2-arm64.apk` (120,937,702 bytes, Aug 7 09:08), `Kalsa-v4.2-release.apk` (212,769,690 bytes, Aug 3 11:24), plus the smaller Aug 6 builds.

## Outcome

`Q66 PREP: BLOCKED RAM budget — 7.61–7.78 GiB free at the mandatory gate; build/install/smoke deferred.`

## 2026-08-27 resume attempt

The fresh gate passed at 13.03 GiB free RAM; the q63 `llama-perplexity` process was absent. The app snapshot captured at the real build start was:

```text
HEAD 24deb114f79a2500e72ffffefcda4b0e0b0b8b0c
status: ?? docs/competitive-analysis-2026-08.md
```

One actual low-priority build attempt was run from the staged copy, arm64 only, with `org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2`. The launcher PID was `46744` at `Idle`; its Java/Gradle children were also observed at `Idle`. It ran from `2026-08-27T07:45:04.6513151-04:00` to `2026-08-27T07:53:58.3762728-04:00` (533.7 seconds), exited 1, and `gradlew --stop` returned 0 with `No Gradle daemons are running.`

Exact primary failure:

```text
Execution failed for task ':llama.rn:buildCMakeRelWithDebInfo[arm64-v8a]'.
fatal error: 'repack-q23k.h' file not found
  cpp/ggml-cpu/ggml-cpu.c:18
  cpp/ggml-cpu/traits.cpp:5
  cpp/ggml-cpu/repack.cpp:21
```

The build also reported a secondary `react-native-worklets` Ninja failure: `manifest 'build.ninja' still dirty after 100 tries`. Full logs are [build.log](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build.log) and [build.err](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build.err). No APK was produced, and no device action was taken. No further retry was made.

Previous attempt (before the staging fix) failed on the missing `repack-q23k.h` header.

## 2026-08-27 repack-q23k fix and rebuild

Root cause confirmed: kalsallama commit `a0cabca6b` adds the new `ggml/src/ggml-cpu/repack-q23k.h`, but the fixed-file-list section of `llama.rn-src/scripts/bootstrap.sh` previously stopped at `repack.h`.

Exact staging-only fix:

```text
cp ./$LLAMA_DIR/ggml/src/ggml-cpu/repack-q23k.h ./cpp/ggml-cpu/repack-q23k.h
```

The line was added immediately after the `repack.h` copy. The header was also copied into both staged mirrors:

- `llama.rn-src/cpp/ggml-cpu/repack-q23k.h`
- `app-build/node_modules/llama.rn/cpp/ggml-cpu/repack-q23k.h`

All three copies are 2,616 bytes with SHA-256 `15BB928BC1D7D98766AC7E6CFD26CAE9CB35339E27FF6F5C77215DD28C24B57E`. A grep of the staged CPU repack lineage showed `repack-q23k.h` as the only newly required repack include; the remaining absent quoted includes are the known optional platform headers and generated OpenCL embed headers. The staged include grep showed no other missing repack-lineage header.

The fresh RAM gate passed at 12.48 GiB. The q63 PPL runner was absent. The app snapshot at build start was:

```text
HEAD 24deb114f79a2500e72ffffefcda4b0e0b0b8b0c
status: ?? docs/competitive-analysis-2026-08.md
```

The one low-priority rebuild attempt used arm64 only, Gradle `org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2`. It ran from `2026-08-27T08:03:14.7384729-04:00` to `2026-08-27T08:04:23.8207427-04:00` (69.1 seconds), exited 1, and `gradlew --stop` returned 0 with no daemons running.

Exact new failure after the header fix:

```text
Execution failed for task ':llama.rn:buildCMakeRelWithDebInfo[arm64-v8a]'.
ninja: error: mkdir(rnllama/CMakeFiles/rnllama.dir/C_/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23): No such file or directory
```

This is the Windows CMake/Ninja object-path-length failure in the deep staging path; the log also contains the unrelated `react-native-worklets` long-object-path warnings. Full corrected-attempt logs: [build-fix.log](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-fix.log) and [build-fix.err](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-fix.err). No APK was produced, so there is no APK path or SHA-256. No S23 install was attempted.

TODO for the app session: `patches/llama.rn+0.12.8.patch` / their bootstrap must gain the same `cp` line, or every fresh build breaks.

`Q66 PREP: BLOCKED build failed — Windows CMake/Ninja path-length error after the repack-q23k staging fix; no APK sha256.`

## 2026-08-27 short-root rebuild

`STAGING MOVED TO: C:\kq66` was used for the rebuild. The copy completed with `robocopy /E /NFL /NDL /NJH /NJS` exit code 0. The generated-directory cleanup removed 17 directories with zero failures, including the root Android build directories, vendored package Android build directories, all `.cxx`, and all local `.gradle` directories. No old `C:\Users\gualt\Desktop\Kalsa` path was found under the copied `android` tree, so prebuild was not rerun. `node_modules\llama.rn\cpp\ggml-cpu\repack-q23k.h` was present with SHA-256 `15bb928bc1d7d98766ac7e6cfd26cae9cb35339e27ff6f5c77215dd28c24b57e`.

The mandatory RAM gate passed at `12.76 GiB` free physical RAM. The build ran once from `C:\kq66\android`, arm64 only, with launcher priority `Idle`, `org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2`. The app snapshot at build time was HEAD `24deb114f79a2500e72ffffefcda4b0e0b0b8b0c` with status `?? docs/competitive-analysis-2026-08.md`. Wall time was `177.1 seconds` (`2026-08-27T08:20:54.6218245-04:00` to `2026-08-27T08:23:51.6755580-04:00`). `gradlew --stop` returned 0 and reported `No Gradle daemons are running.`

The short-root build did not hit the prior path-length error, but failed during `:llama.rn:buildCMakeRelWithDebInfo[arm64-v8a]` while compiling `cpp/tools/mtmd/models/minimax-m3.cpp`. Exact compiler errors included `use of undeclared identifier 'clip_graph_minimax_m3'`, `out-of-line definition of 'apply_rope' does not match any declaration in 'clip_graph_minicpmv'`, and missing `clip_model` members `mm_merger_fc1_w`, `mm_merger_fc1_b`, `mm_merger_fc2_w`, and `mm_merger_fc2_b` (10 errors generated). This was the single permitted retry; no `subst` fallback was used because the error was not path-length-related. Full logs: [build-short.log](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-short.log) and [build-short.err](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-short.err).

No APK was produced and no S23 install or device action was performed. TODO for the app session remains: `patches/llama.rn+0.12.8.patch` / their bootstrap must gain the same `cp` line, or every fresh build breaks.

`Q66 PREP: BLOCKED build failed — short-root C++ minimax-m3.cpp API mismatch; no APK sha256.`

## 2026-08-27 multimodal consistency fix

The repository contains no separate Mac-only build/sync recipe. The established source-build recipe in `README.md` and `.github/workflows/apk.yml` is `npm ci`, `npx expo prebuild --platform android --no-install`, then `android/gradlew assembleRelease`; it uses no mtmd exclusion. The `llama.rn-src` history is a shallow/grafted `v0.12.8` release history with no additional mtmd synchronization recipe.

No supported vision/mtmd exclusion was found. `llama.rn/android/build.gradle` exposes only `rnllamaBuildFromSource`, and Android CMake unconditionally globs `cpp/tools/mtmd/*.cpp` and `cpp/tools/mtmd/models/*.cpp`. Therefore this q66 build retains multimodal sources.

Root cause of the short-root failure: the staged bootstrap copied the older engine's clip/mtmd files while leaving `minimax-m3.cpp` from llama.rn 0.12.8, producing the half-and-half API. A pristine registry tarball, `llama.rn-0.12.8.tgz`, was fetched with SHA-256 `f7b4db9b287a2702b04a978aba4cd480419e0ba83b207b80ee2514c2ec123197`. Its complete `cpp/tools/mtmd` directory was mirrored with `robocopy /MIR` into `C:\kq66\node_modules\llama.rn\cpp\tools\mtmd`. The staged group now matches the pristine package exactly: 54 files, zero missing, extra, or different. `clip-model.h` SHA-256 is `ee06b8d7b00f0059949930430971d756e9dc27c9402c6a63ec3beaaab3c920b1`. The short-root app copy has no sibling `llama.rn-src`; the original source clone was not modified.

The bootstrap manifest review found the mtmd directory replacement at lines 311–327 and the corrected q23k header copy at line 166. A second half-and-half group was found in `cpp/models`: four npm-only files (`hy-v3.cpp`, `laguna.cpp`, `minimax-m3.cpp`, `nanbeige.cpp`) remained despite the bootstrap's `rm -rf ./cpp/models` plus engine copy at lines 207–208. The short-root `node_modules\llama.rn\cpp\models` directory was mirrored with `/MIR` from the prefix-transformed engine-sourced staging copy, removing those four leftovers. The compile-set include check scanned 192 mtmd/model source files: the only absent quoted include is the known `MTMD_VIDEO`-guarded `sheredom/subprocess.h`; unexpected missing includes: 0. The broader read-only scan's other absences are known optional platform/generated headers (CUDA/Vulkan/etc., Hexagon SDK, OpenCL embedded kernels, and CPU feature backends), not active CPU/mtmd dependencies.

TODO for the app session: `patches/llama.rn+0.12.8.patch` / their bootstrap must gain the same `cp ./$LLAMA_DIR/ggml/src/ggml-cpu/repack-q23k.h ./cpp/ggml-cpu/repack-q23k.h` line, or every fresh build breaks.

The raw q23k header copied from the engine also needed the same namespace normalization that bootstrap applies to the rest of `cpp/ggml-cpu`: its declarations were changed from `ggml_*`/`struct ggml_tensor` to `lm_ggml_*`/`struct lm_ggml_tensor` in the short-root vendored header only. This matches the existing prefixed `repack.cpp` definitions. The prior raw-header SHA was `15bb928bc1d7d98766ac7e6cfd26cae9cb35339e27ff6f5c77215dd28c24b57e`; the normalized short-root header SHA is `85bc5b53f2b3986fd4922e8af025397ec571892b0e7d1d62fabb65bfa6da7909` and is the one used for the final attempt.

The final rebuild attempt from `C:\kq66` is recorded below; no S23 install will be performed in this turn.

## 2026-08-27 final consistent-tree rebuild

After the mtmd restore, the short-root `cpp/models` directory was also synchronized to the prefix-transformed engine-sourced model set with `/MIR`; the four stale npm-only files (`hy-v3.cpp`, `laguna.cpp`, `minimax-m3.cpp`, `nanbeige.cpp`) were removed. The q23k header was normalized to the `lm_` namespace used by the staged repack implementation. The compile-set verification passed with zero unexpected missing includes and zero raw unprefixed q23k declarations.

The mandatory RAM gate passed at `15.24 GiB` free physical RAM. The one final build attempt ran from `C:\kq66\android`, arm64 only, at launcher priority `Idle`, with `org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2`. It ran from `2026-08-27T08:47:59.4573441-04:00` to `2026-08-27T08:53:13.4567392-04:00` (314.0 seconds). `gradlew --stop` returned 0 and reported `No Gradle daemons are running.`

The exact new failure was during `:llama.rn:buildCMakeRelWithDebInfo[arm64-v8a]`, compiling the JNI wrapper. `cpp/jsi/JSIParams.cpp` reported missing `common_params.load_mode`, `LLAMA_LOAD_MODE_MMAP`, `LLAMA_LOAD_MODE_MMAP_MLOCK`, `LLAMA_LOAD_MODE_MLOCK`, `LLAMA_LOAD_MODE_NONE`, `common_params_sampling.reasoning_budget_activate_immediately`, and the related `push_back` mismatch (19 errors). `cpp/jsi/RNLlamaJSI.cpp` reported missing `common_chat_params.thinking_end_tags` and the resulting invalid member access (4 errors). This is a wrapper/core API mismatch outside mtmd and not a path-length failure. Full final logs: [build-short.log](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-short.log) and [build-short.err](C:/Users/gualt/Desktop/Kalsa/moe-experiments/scratchpad/agents/q66-app-lifecycle-s23/build-short.err).

No APK was produced, no `subst` fallback was used, and no S23 install or device action was performed. No further build retry was made. TODO for the app session remains: `patches/llama.rn+0.12.8.patch` / their bootstrap must gain the q23k `cp` line and the resulting prefixed-header handling, or every fresh build breaks; the wrapper/core API version alignment also needs resolution before the next build.

`Q66 PREP: BLOCKED build failed — wrapper/core API mismatch in JSIParams.cpp and RNLlamaJSI.cpp; no APK sha256.`

## 2026-08-27 ordering audit and prebuild stop

The authoritative app workflow order is `npm ci` (its `postinstall` runs
`patch-package`) → `KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform
android --no-install` → `android/gradlew assembleRelease` →
`scripts/assert-native-patch.sh`. The Expo plugin only writes
`rnllamaBuildFromSource=true`; it does not synchronize engine or multimodal
files. The staged custom Windows recipe therefore must bootstrap/synchronize
the staged native tree first, run a no-argument `npx patch-package` from the
staging root second, then prebuild.

The app patch was inspected read-only. Its complete touched-file set is:

```text
cpp/jsi/JSIParams.cpp
cpp/jsi/JSISession.h
cpp/rn-completion.cpp
cpp/rn-llama.cpp
cpp/rn-slot.cpp
cpp/jsi/RNLlamaJSI.cpp
```

It contains no `load_mode`, `LLAMA_LOAD_MODE_*`,
`reasoning_budget_activate_immediately`, or `thinking_end_tags` additions and
touches neither `cpp/common/common.h` nor `cpp/common/chat.h`. The bootstrap
fixed copy list overwrites `cpp/common/common.h` and `cpp/common/chat.h`, but
does not copy `cpp/jsi/*` or `cpp/rn-*`; its prefix pass explicitly skips
`cpp/rn-*`. Therefore the app patch and bootstrap have no direct file overlap.

The recorded staging evidence nevertheless shows the problematic order: the
staged `RNLlamaJSI.cpp.orig` was written at 07:18, while bootstrap's internal
`common.h.patch` and `sampling.cpp.patch` rejects were written at 07:26. The
previous PREP entry only said both operations occurred before prebuild; this
timestamp evidence resolves their relative order as patch-package first,
bootstrap second. The post-bootstrap correction was attempted in `C:\kq66`:

```text
npx patch-package
patch-package 8.0.1
Applying patches...
llama.rn@0.12.8 ✔
```

The short-root patch file was restored from the read-only app copy and its
SHA-256 matches `DEC808817345DDC331B39A962CB9B8E5D1D9E0611D31C3434799633C085414B7`.
After that successful apply, the requested staged-header gate still failed:

```text
common_h=False
chat_h=False
HEADER_SYMBOL_GATE=FAIL missing all requested symbols from staged core headers
```

The exact API pieces are still unresolved in the staged tree:

```text
common_params.load_mode                         absent from cpp/common/common.h
LLAMA_LOAD_MODE_MMAP* / MLOCK / NONE            absent from the staged core API
common_params_sampling.reasoning_budget_activate_immediately
                                                  absent from cpp/common/common.h
common_chat_params.thinking_end_tags             absent from cpp/common/chat.h
```

In the pristine `llama.rn@0.12.8` tarball (`f7b4db9b287a2702b04a978aba4cd480419e0ba83b207b80ee2514c2ec123197`), the providers are `cpp/common/common.h` lines 288 and 488, `cpp/common/chat.h` line 280, and the `LLAMA_LOAD_MODE_*` enum is `cpp/llama.h` lines 205–210. The internal staged bootstrap patch `scripts/patches/common.h.patch` is the separate source of the reasoning-budget field, but its failed application left `cpp/common/common.h.rej`; the app patch itself does not add it. No API shim was invented.

The requested prebuild `scripts/assert-native-patch.sh` invocation was run with
Git Bash and the required MSYS path settings. It stopped as designed for the
current no-artifact state:

```text
[assert] FATAL: no release librnllama.so found under android/ — did the build run?
```

No RAM-gated NDK/Gradle attempt was started after this failed gate. Gradle was
not started in this audit, so no `gradlew --stop` was needed. No APK was
produced, no S23 install or device action occurred, and no `subst` fallback was
used. The app session must align the kalsallama core/common API with the
llama.rn wrapper (and make the bootstrap/app patch recipe reproducible) before
another q66 build.

`Q66 PREP: BLOCKED prebuild gate failed — patch-package succeeded but staged core headers lack load_mode, reasoning_budget_activate_immediately, and thinking_end_tags; assert-native-patch.sh found no release librnllama.so; no APK sha256.`

## 2026-08-27 native-artifact mechanism audit

The complete `ai-chat/.github/workflows/dflash-ab.yml` (195 lines) and
`e2e-emulator.yml` (150 lines) contain no step that separately builds or
fetches `librnllama.so`. Both workflows do exactly:

```text
npm ci
KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease -PreactNativeArchitectures=<ABI> --console=plain
bash scripts/assert-native-patch.sh
```

The DFlash workflow uses `x86_64`; the E2E workflow also uses `x86_64`. The
workflow assert is post-build and only scans release output below `android/`.
No `librnllama` producer/fetcher was found in `ai-chat/scripts`, its workflows,
or `BigMoeOnEdge` scripts. The engine checkout's Android documentation builds
llama.cpp engine targets, not the llama.rn JNI wrapper library.

`llama.rn` itself has two mechanisms. Its npm `postinstall` runs
`install/download-native-artifacts.js`, which downloads the upstream release
asset `llama-rn-android-jni-libs.tar.gz` from the package repository and
extracts it to `android/src/main/jniLibs`; the manifest records the configured
SHA-256. Those staged upstream libraries are present, including
`android/src/main/jniLibs/arm64-v8a/librnllama.so` (9,530,928 bytes), but they
are not built from kalsallama and do not contain the Kalsa marker.

The full `plugins/withLlamaFromSource.js` behavior is explicit: unset, `1`, or
any value other than `0` adds/sets Gradle property
`rnllamaBuildFromSource=true`; only exact `0` removes that property and leaves
the prebuilt JNI path. In `android/build.gradle`, source mode sets
`RNLLAMA_BUILD_FROM_SOURCE=ON` and clears `jniLibs.srcDirs`; prebuilt mode links
the files under `android/src/main/jniLibs/${ANDROID_ABI}`.

The CMake target is not an engine-only artifact build. In source mode,
`android/src/main/CMakeLists.txt` adds `rnllama`, then creates JNI targets such
as `rnllama_jni`, `rnllama_jni_v8`, `rnllama_jni_v8_2`, and the dotprod/i8mm
variants. `android/src/main/rnllama/CMakeLists.txt` builds the corresponding
shared targets `rnllama`, `rnllama_v8`, `rnllama_v8_2`, etc. from the vendored
`cpp/` plus the JSI wrapper and links the JNI targets to them. Gradle's Android
external-native-build step is therefore the canonical producer of the release
`.so` files; there is no supported standalone command that turns the
kalsallama checkout alone into `librnllama.so`.

The short-root staging was checked with 14.99 GiB free physical RAM and no
active `llama-perplexity`, Java, Ninja, CMake, or Gradle process. No separate
NDK native build was started because the requested workflow mechanism does not
exist. The previous source-mode Gradle attempt remains the applicable failure:
`cpp/jsi/JSIParams.cpp` and `cpp/jsi/RNLlamaJSI.cpp` do not compile against the
staged kalsallama core/common headers. Switching to upstream prebuilt JNI
would avoid compilation but would discard the Kalsa patch/engine and fail the
native-marker requirement. No APK, no S23 install, and no additional Gradle
attempt were made.

Canonical Windows recipe for the app session: stage/synchronize kalsallama
`cpp/` first; apply the app patch with no-argument `npx patch-package`; set
`KALSA_LLAMA_FROM_SOURCE=1`; run `npx expo prebuild --platform android
--no-install`; run the low-priority arm64-v8a `gradlew assembleRelease` with
`org.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and `NINJAFLAGS=-j2`;
run `gradlew --stop`; finally run `scripts/assert-native-patch.sh` against the
release output. The native assertion is a post-build check, not a prebuild
producer or source gate.

`Q66 PREP: BLOCKED — workflows provide no separate librnllama.so recipe; the canonical source build is Gradle/CMake and remains blocked by the staged wrapper/core API mismatch. No APK sha256.`

## 2026-08-27 clean CI-parity staging

`STAGING MOVED TO: C:\Users\gualt\q66c`

A fresh staging root was created from the read-only app checkout with:

```text
robocopy C:\Users\gualt\Desktop\Kalsa\ai-chat C:\Users\gualt\q66c /E /XD node_modules .git /NFL /NDL /NJH /NJS
ROBOCOPY_EXIT=1
```

The exit code 1 means files were copied. No `BigMoeOnEdge` or raw kalsallama
files were copied; no bootstrap was run; no `repack-q23k.h` was copied. The
app source snapshot remained HEAD
`24deb114f79a2500e72ffffefcda4b0e0b0b8b0c` with only the pre-existing
untracked `docs/competitive-analysis-2026-08.md`.

`npm ci` completed successfully in the fresh root. Its app `postinstall` ran
the required patch-package apply and reported:

```text
patch-package 8.0.1
Applying patches...
llama.rn@0.12.8 ✔
```

The staged patch SHA-256 is
`DEC808817345DDC331B39A962CB9B8E5D1D9E0611D31C3434799633C085414B7`, matching
the read-only app patch. The wrapper marker is present at
`node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:644`:
`system_info += " | kalsa-native-patches"`.

The required engine-provenance check failed. Exact counts in the patch and
staged vendored `cpp/` were:

```text
mmap_prefetch:       patch=0 cpp_files=0
mmap-prefetch-opt:   patch=0 cpp_files=0
q23k:                patch=0 cpp_files=0
a0cabca6b:            patch=0 cpp_files=0
kalsallama:          patch=0 cpp_files=0
kalsa-native-patches: patch=1 cpp_files=1
```

The staged CPU repack directory contains only the base `repack.cpp` and
`repack.h`; `repack-q23k.h` is absent. Thus this clean snapshot is
`llama.rn@0.12.8`'s vendored base plus the current app's wrapper/native marker
patch, not the claimed “llama.rn vendored base + kalsallama engine diff”. The
APK engine provenance cannot honestly be recorded as kalsallama from this
patch, so no prebuild or NDK/Gradle attempt was started. A preflight check saw
14.99 GiB free physical RAM and no active PPL/Java/Ninja/CMake/Gradle process;
the RAM gate was not the blocker.

Canonical CI-parity recipe remains: fresh app staging → `npm ci` (postinstall
patch-package and native-artifact handling) →
`KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform android --no-install`
→ low-priority arm64-v8a `gradlew assembleRelease --console=plain --no-daemon`
with `-Dorg.gradle.workers.max=2`, `CMAKE_BUILD_PARALLEL_LEVEL=2`, and
`NINJAFLAGS=-j2` → `gradlew --stop` → post-build
`bash scripts/assert-native-patch.sh`. This is a source build inside Gradle;
the final APK engine would be llama.rn's vendored cpp plus the app patch. The
recipe was stopped before prebuild because the current app patch does not carry
the required engine modifications.

`Q66 PREP: BLOCKED — clean CI-parity staging succeeded through npm ci, but the app patch contains no mmap/repack/kalsallama engine markers; no APK sha256 or wall time.`

## 2026-08-27 CI-parity build authorization and deviation

Owner decision: proceed with the product represented by `ai-chat` main at
`24deb114f79a2500e72ffffefcda4b0e0b0b8b0c`, despite the engine-marker finding.
For this q66 lifecycle APK, the engine provenance is explicitly:

```text
llama.rn 0.12.8 vendored upstream cpp/ + kalsa-native-patches at JSI level
NOT the kalsallama checkout; mmap-prefetch and repack-q23k are absent
```

This is a valid CI-parity deviation for q66. Streaming-cache features may be
absent; scenario E may collapse to “not exposed”, which the separate PREREG
allows. No raw engine source, bootstrap output, or manual repack header is
being introduced into this staging.

Canonical run from `C:\Users\gualt\q66c`:

```text
KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform android --no-install
RAM gate: FreePhysicalMemory >= 8 GiB
Idle/low cmd.exe -> android\gradlew.bat assembleRelease --console=plain --no-daemon -PreactNativeArchitectures=arm64-v8a -Dorg.gradle.workers.max=2
CMAKE_BUILD_PARALLEL_LEVEL=2 NINJAFLAGS=-j2
android\gradlew.bat --stop
Git-Bash scripts/assert-native-patch.sh
```

The clean staging completed `npm ci` and patch-package successfully. The
remaining build and post-build results are recorded below.

## 2026-08-27 CI-parity fallback artifact

The authorized CI-parity build completed successfully from
C:\Users\gualt\q66c. This artifact is retained as a fallback only; it is
not a kalsallama-engine result.

- APK: C:\Users\gualt\q66c\android\app\build\outputs\apk\release\app-release.apk
- Size: 135,026,435 bytes
- SHA-256: 444CCC8D7116D7CC07ED1998272E21E36C46D59C13CDE63FA148D68199BA7608
- Wall time: 1,479.8 seconds (09:21:29.360 to 09:46:09.144 EDT)
- Gradle exit: 0; gradlew --stop: exit 0, no daemons running
- Post-build scripts/assert-native-patch.sh: exit 1 because
  librnllama.so did not contain kalsa-native-patches
- Marker scan: kalsa-native-patches was present in the packaged
  librnllama_jni*.so files; mmap_prefetch, mmap-prefetch-opt, repack-q23k,
  q23k, a0cabca6b, and kalsallama were absent from the packaged arm64
  native libraries.

The fallback engine is llama.rn 0.12.8's generated vendored tree plus the
app's JSI/RN patch, not the kalsallama checkout. No installation was performed.
