# Bench APK: prove the tracked debuggable release path at e206a94

Repo: `~/Projects/kalsa` (app). Work done in own worktree/ref `~/Projects/kalsa-wt-bench-apk`,
local branch `bench-apk-e206a945` (no upstream), HEAD `e206a945bf39610681bc50b989f5a4d179a0b889`.
`git status --short` clean before and after (only gitignored `android/` + `node_modules/` present).
Nothing pushed, no ref published, nothing installed on either phone. The only adb command run was
host-side `adb devices` (device enumeration); no shell, install, or push touched either device.

## 1. Verdict: the mechanism already exists. No second mechanism was built.

Audit item 9 is confirmed on both points, from repo contents and from the artifacts themselves:

1. **The `KALSA_DEBUGGABLE` plugin exists and is tracked.** `plugins/withDebuggableRelease.js`
   patches the generated `android/app/build.gradle` during prebuild: it inserts `debuggable true`
   into the `release` build type (idempotent - returns unchanged if the line is already there).
   The gate lives in tracked `app.config.js` (lines 71-73 at `e206a94`):

   ```js
   ...(process.env.KALSA_DEBUGGABLE === "1"
     ? ["./plugins/withDebuggableRelease"]
     : []),
   ```

   Both files exist *at commit `e206a94` itself* (`git show e206a945:app.config.js` and
   `git show e206a945:plugins/withDebuggableRelease.js` both succeed; `3aae1be`, which added the
   gate, is an ancestor of `e206a94`).

2. **The workflow already builds a debuggable release.**
   `.github/workflows/build-kalsa-apk.yml` (present at `e206a94`) runs
   `npx expo prebuild` then `./gradlew assembleRelease`, and sets
   `KALSA_DEBUGGABLE: ${{ github.ref == 'refs/heads/bench-dev-models' && '1' || '0' }}`
   on both the prebuild and the build steps (lines 60 and 66).

What each produces, per inspection of the workflow and of a local reproduction:

| | turned on by | variant | debuggable | JS bundle | signing |
|---|---|---|---|---|---|
| shipping build | gate unset or `!= 1` | `assembleRelease` | no | embedded (no Metro) | Expo default: `signingConfigs.debug` |
| bench build | `KALSA_DEBUGGABLE=1` at **prebuild** time | `assembleRelease` | **yes** | embedded (no Metro) | same |
| CI `bench-dev-models` | push to that branch | `assembleRelease` | yes | embedded | same |

Notes:
- The gate is read by `app.config.js`, i.e. at prebuild time only. Setting it for the gradle step
  alone does nothing; setting it at prebuild is what re-applies the patch to a regenerated
  `android/`.
- The `bench-dev-models` branch is currently absent from this clone and from `origin`
  (`git branch -a | grep bench` and `git ls-remote --heads origin | grep bench` both empty); the
  workflow file survives, the branch does not. Reachability of the *code path* from `e206a94` is
  not affected: the plugin + gate are in the commit tree, and `e206a94` is contained in
  `origin/engine-pin-kalsallama` (a push-trigger branch of the same workflow).
- `-PrnllamaHexagon=false` (workflow line 73 and the local recipe) has **no reader** anywhere in
  `node_modules/llama.rn/android/` or the generated project - it is a no-op today. The switch that
  actually decides the DSP build is the `HEXAGON_SDK_ROOT`/`HEXAGON_TOOLS_ROOT` env vars (llama.rn
  `android/build.gradle` lines 143-146). Stated as observed, not changed.

## 2. Why today's artifact had no flag (evidence on the artifact, not the config)

Today's APK `~/Projects/kalsa-wt-landing/android/app/build/outputs/apk/release/app-release.apk`
(app commit `e206a94`, built 16:28):

- `aapt2 dump xmltree --file AndroidManifest.xml` piped to `grep -c debuggable` -> **0**.
- Its embedded `assets/app.config` plugin list **omits** `./plugins/withDebuggableRelease`.
- size 152,760,583 bytes, sha256
  `d3c66bdb135d394b4bec741c96d89128efc3172cd8ef583e7f2347fdeddf00e3`.

So the build was made with the gate off. The one-line hand edit that existed in that worktree's
gitignored `android/app/build.gradle` was wiped by the next `expo prebuild` (`.gitignore` line 42)
and never regenerated, because regeneration only happens when `KALSA_DEBUGGABLE=1` is in the
environment. Root cause as stated by the owner: confirmed.

## 3. The path works: proof from a clean prebuild, then from the artifact

### 3.1 Clean-prebuild survival (config-level, both directions)

In the fresh worktree (no `android/` at checkout):

```
KALSA_LLAMA_FROM_SOURCE=1 KALSA_DEBUGGABLE=1 npx expo prebuild --platform android --no-install
  -> android/app/build.gradle line 117: debuggable true          (android/ created from scratch)
KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform android --no-install      # no gate
  -> grep -c "debuggable true" android/app/build.gradle -> 0     (default stays safe)
KALSA_LLAMA_FROM_SOURCE=1 KALSA_DEBUGGABLE=1 npx expo prebuild --platform android --no-install
  -> line 117: debuggable true                                   (restored)
```

A clean `expo prebuild` therefore reproduces both states deterministically, and the non-debuggable
state is the default. The mechanism survives the event that destroyed the hand edit.

### 3.2 Build command (exact recipe - second person, clean checkout, copy-paste block)

Same recipe as today's build (documented in `app-landing/REPORT.md` lines 125-134) except the gate:

```sh
git clone <repo> kalsa && cd kalsa && git checkout e206a945bf39610681bc50b989f5a4d179a0b889
KALSA_LLAMA_FROM_SOURCE=1 npm ci
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools   # this Mac; CI provisions its own
export ANDROID_SDK_ROOT=$ANDROID_HOME
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export HEXAGON_SDK_ROOT=/nonexistent/hexagon-sdk                   # CI has no Hexagon SDK; without this
export HEXAGON_TOOLS_ROOT=/nonexistent/hexagon-sdk/tools           # line this Mac auto-enables the DSP
                                                                   # build and configure fails (QAIC artifacts)
export KALSA_LLAMA_FROM_SOURCE=1 KALSA_DEBUGGABLE=1                # <- the bench lever
npx expo prebuild --platform android --no-install
cd android && ./gradlew assembleRelease --no-daemon --max-workers=3 \
    -PreactNativeArchitectures=arm64-v8a -PrnllamaBuildFromSource=true -PrnllamaHexagon=false \
    --console=plain
```

Output: `android/app/build/outputs/apk/release/app-release.apk`.

CI equivalent: push to `bench-dev-models` (or check out that ref); the workflow sets the gate
itself. No repo change is needed for either route.

### 3.3 Load capping (operational instruction, applied and recorded)

The first uncapped assemble was interrupted during an NDK-wide load spike (load avg ~105 across
~10 cores, machine-wide). Before the successful run:

- gate: `while pgrep -f ninja; do sleep 30; done` - waited until **no** compile was running
  anywhere (the other arm64 engine build had no live ninja/clang process at gate time);
  gate passed 22:41:17, load {49.25 44.49 23.52}.
- assemble flags: **`--no-daemon --max-workers=3`** plus `CMAKE_BUILD_PARALLEL_LEVEL=2` and
  `NINJAFLAGS=-j2` (the CI runner-fit caps) so `org.gradle.parallel` cannot spawn a worker per
  core and per-module ninja jobs stay at 2.
- result: `BUILD SUCCESSFUL in 10m 1s`, 764 tasks; load at finish {10.69 38.03 36.72} and
  dropping. Idle gradle daemon stopped afterward; no ninja, no gradle client left running.

### 3.4 Artifact inspection (the artifact, not the config)

```
path  : /Users/marco/Projects/kalsa-wt-bench-apk/android/app/build/outputs/apk/release/app-release.apk
size  : 159,233,414 bytes (151.86 MiB)
sha256: bfb5b4f95ff27eb749dac4e35a1a08366142d67eef1e198fba13b9dd37ddacdc
```

(a) **debuggable=true in the APK's own manifest.**
`aapt2 dump xmltree --file AndroidManifest.xml <apk>` -> one match, line 145:

```
A: http://schemas.android.com/apk/res/android:debuggable(0x0101000f)=true
```

`versionName "0.1.0"`, package `com.kalsa.app` (unchanged - `run-as com.kalsa.app` applies).

(b) **JS bundle embedded, no Metro.**
`unzip -l` -> `assets/index.android.bundle`, 6,063,480 bytes, **byte-identical** to today's APK
(sha of the extracted stream equal). Manifest grep for devlauncher/devsettings/devclient/metro -> 0
matches; `expo-dev-client` is not in `package.json`. Release variant bundles at build time; the app
cannot load from a packager.

(c) **Same chain.** Read from inside both APKs:

- `assets/app.config` -> `extra.engineBuildId`:
  `kalsa-eng-v2:1725f3a838b0b799f715136a16e6e18ace4f609bd89acb9258ec5c47c819b231` - **identical**
  in mine and in today's APK (matches `app-landing/REPORT.md` round-2 stamp for this pin pair).
- The two `assets/app.config` payloads differ in exactly one place: mine contains
  `"./plugins/withDebuggableRelease"`, today's does not. Everything else byte-equal.
- Repo pins at HEAD: `package.json` llama.rn `5b966218eadb...`, `native/kalsallama.pin`
  `1577495b92096fca572f57a35b71607bacac85d5` - the required binding/engine pair.
- `bash scripts/assert-native-patch.sh` (the workflow's post-build gate) -> exit 0,
  "native patch and q23k engine verified in all release binaries".
- `diff` of the two generated projects: `app/build.gradle` differs by the single line
  `debuggable true`; `gradle.properties` and root `build.gradle` identical.

Size delta vs today's APK (+6.47 MB) is fully accounted for by that one line: the non-debuggable
build produced ART-profile/dex-layout intermediates (`merged_art_profile`, `binary_art_profile`,
`combined_art_profile`, `merged_startup_profile`, `dex_metadata_directory`) that the debuggable
build does not, and packaged `assets/dexopt/baseline.prof{,m}`; dex files 3 (26.4 MB) vs 21
(32.7 MB). JS bundle identical; the `lib/arm64-v8a/*.so` set is identical (same 24 files, sizes
within ~500 bytes each - build-path strings differ between worktrees).

## 4. Does anything need adding to make it survive a clean prebuild?

**No.** The plugin, the gate, and the CI wiring are all tracked at `e206a94`; section 3.1 shows a
clean prebuild reproduces both states. What failed today was building with the gate off while a
hand edit sat in ignored `android/`. The only invocation change is putting
`KALSA_DEBUGGABLE=1` in the environment *at prebuild time* (section 3.2). Per the
one-mechanism rule, no script, no second plugin, no gradle variant was added, and nothing was
committed. Optional follow-up for the owner (not done): a `workflow_dispatch` input or reviving
`bench-dev-models` would give CI-side bench APKs through the *same* gate; that is a workflow edit
to discuss, not something this round implemented.

## 5. Arming the trace without `run-as`: what exists, what does not (reported only, nothing built)

The flag `kalsa.bench.energy_trace` is read by `src/engine/governorBatterySampler.ts`
(`readBenchEnergyTraceEnabled`, AsyncStorage). Candidates and repo reality:

1. **Intent extra / deep link - channel exists, command does not.**
   `plugins/withAndroidShareIntent.js` already patches `MainActivity.onCreate`/`onNewIntent` and
   rewrites `ACTION_SEND`/`SEND_MULTIPLE` into `kalsa://share?...` URLs, which reach JS through the
   `Linking` listener in `src/app/AppShell.tsx` (lines 3640-3653). A `kalsa://` parameter such as
   `bench?energy=1` would ride working plumbing; only the URL case and the flag write are missing.

2. **In-app developer toggle - pattern exists, energy toggle does not.**
   `src/bench/benchConfig.ts` writes the other bench keys from inside the app
   (`AsyncStorage.setItem` for `kalsa.bench.devmodes/thinking/format/speculative/engine/...`) and
   `src/screens/SettingsScreen.tsx` has the matching bench panel (nCtx, no-repack, mmap, dev
   models). A repo-wide grep for `BENCH_ENERGY_TRACE_KEY` finds only the constant and the reader -
   **no code path writes the energy flag from inside the app today**.

3. **File in app-specific external storage - nothing exists.**
   No `getExternalFilesDir`/`ExternalDirectory` usage anywhere in `src/`, `native/`, or `plugins/`.
   The trace CSV path is internal (`energyTraceFilePath` under the app's own files dir,
   `files/energy/*.csv`). `react-native-fs@2.20.0` is already a dependency and can address
   `ExternalDirectoryPath`, so only the check would have to be written.

Also checked: `expo-dev-client` is absent (no dev-client toggles); the sticky intent in
`native/GovernorBatteryModule.kt` is an `ACTION_BATTERY_CHANGED` read, not an arming path.

To arm the *shipping* artifact (non-debuggable), the two live options are (1) and (2): both are
small, both reuse existing plumbing, and either removes `run-as` from the measurement loop. (3)
also removes `run-as` for the host side but needs an app-side sentinel check. Per instruction,
none of them was implemented in this round.

## 6. Constraint log

- Own worktree/ref only: `kalsa-wt-bench-apk` / branch `bench-apk-e206a945`, no upstream, no
  push, no PR, no commit (`git status` clean).
- No install on either phone; no device-side command of any kind (adb used once for host
  enumeration). Device-side `run-as` proof remains scheduled by the owner.
- One heavy build at a time: pre-launch ninja gate (3.3); capped assemble flags recorded (3.3);
  build log `/tmp/bench_build_3.log` (prior attempts: `/tmp/bench_build_1.log`,
  `/tmp/bench_build_2.log`).
