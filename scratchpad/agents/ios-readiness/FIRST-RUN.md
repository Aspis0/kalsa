# FIRST-RUN.md — first Kalsa iOS run in the simulator (2026-10-02, overnight autonomous)

Scope: first **run** of the app on iOS (all prior work was compile-only, AUDIT-first-compile.md
S2-16: "nothing has ever run on iOS"), plus first model load. Worktree `~/Projects/kalsa-ios`,
branch `ios/first-build`, HEAD at start `5d58e12a`, at end `3b21e6c7` (2 commits). The binding
patches in `node_modules/llama.rn` were re-verified present at the end (Patch 1 `fa_smem(nsg)`
at ggml-metal-ops.cpp:3518; Patch 2 x86 guard at arch/arm/quants.c:1-7).

## Verdict in one line

The app **installs, launches, and reaches its first screen**; the registry default model
**LFM2.5-2.6B loads end to end** (native llama.cpp log proof) and completes a real prefill;
**a chat generation was NOT executed** — it requires UI taps that a headless simulator cannot
synthesize (details in "Blocker" below). All numbers below are iOS-Simulator numbers (Mac-hosted
Metal/CPU), explicitly NOT representative of an iPhone.

## Metro vs Release decision

Debug + Metro chosen. The Debug simulator build was the proven artifact
(`/tmp/kalsa-ios-dd2`, arm64-only); a Release build had never been run in this repo (its
JS-bundle build phase untested) and Debug gives visible JS errors on a code path executing for
the first time ever. Metro ran as one background process (`npx expo start`, port 8081, log
`/tmp/kalsa-metro.log`), restarted once after the dependency bump (PID 38450 → 56736), killed at
the end. The Debug app fetches the bundle from Metro over the host loopback — worked as expected.

## Fix 0 — simulator runtime "not available" (environment, no commit)

`xcrun simctl boot` failed exit **145**, "iOS 27.0 simulator runtime is not available. runtime
path not found", although `simctl list runtimes` listed it and `simctl runtime list` said the
disk image was Ready; `/Library/Developer/CoreSimulator/Volumes/` was empty. Fix:
`killall -9 com.apple.CoreSimulator.CoreSimulatorService` + retry → boot exit **0**. Device:
**iPhone 18 Pro** (75F48641-ABD8-4674-8A02-5322ADFDECE9), iOS 27.0 runtime (24A434), Xcode 27.

## Fix 1 — dyld crash at launch (commit `1bc2eca0`)

First launch died before main:

```
dyld[49256]: Symbol not found: _$s15ExpoModulesCore10BaseModuleC11willDestroyyyFTj
  Referenced from: .../KalsaAIChat.app/Frameworks/ExpoCamera.framework/ExpoCamera
  Expected in:     .../KalsaAIChat.app/Frameworks/ExpoModulesCore.framework/ExpoModulesCore
```

Root cause: Expo SDK 57 ships pods as prebuilt CDN xcframeworks, and the pinned patch line was
mutually skewed — `nm` on the Pods binaries: ExpoModulesCore@57.0.8 exports **0** `willDestroy`
symbols, ExpoCamera@57.0.5 has **2** undefined refs to it. Fix (app repo, commit `1bc2eca0`):
align the expo line to latest patches (expo 57.0.26, expo-modules-core 57.0.20, expo-camera
57.0.6, +13 more expo/* packages per `npx expo install --check`; react-native 0.86.2 and
jest 30 deliberately left untouched) **and** add the iOS 27 mandatory scene lifecycle opt-in
`expo-build-properties` `ios.enableSceneSupport: true` (iOS 27 SDK refuses AppDelegate-only
apps: "Application failed to launch: UIScene life cycle is required for apps built with this
SDK"; expo/expo#46664). Prebuild then generates `UIApplicationSceneManifest` →
`EXExpoAppSceneDelegate` (class verified present in the linked debug dylib, 9 symbol hits).

## Milestone A — first screen (proof)

Screenshot `/tmp/kalsa-ios-shots/02-first-screen.png`: chat UI up, model bar "LFM2.5 2.6B",
no red box, no crash. App's own JS log line: `KALSA_FOREGROUND_IDLE_PROTOCOL revision=854cd50`.

## Fix 2 — model load fail-closed on a spurious 0 (commit `3b21e6c7`)

Model import path (no network): the app's store is `Documents/models/<model.id>/<model.file>`
with a size-EXACT presence check (`ModelDownloader.ts:19,80-83,112-115`; the `lfm2.5-2.6b`
entry declares no sha256, so exact size + path is the whole contract). The preferred
LFM2.5-1.2B files match **no** catalog entry by size; the registry default
(`lfm2.5-2.6b`, `default: true`, `LFM2.5-2.6B-QAD-Q4_0.gguf`, 1_593_894_944 B) is satisfied
byte-exactly by `~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`. Copied via
`xcrun simctl get_app_container … data` into `Documents/models/lfm2.5-2.6b/`.

With the file in place the load was still HELD (pill "Not running here" — its i18n doc: shown
"while a hard RAM/tier refusal stands"): `modules/kalsa-lifecycle` (apple side, added in this
worktree) returns raw `os_proc_available_memory()`, which reads **0 on the simulator**; 0 is
contractually "a real reading, zero headroom" → gate `blocked_ram`. This is exactly the trap
NEXT.md step 1.3 flagged ("os_proc_available_memory returns 0 when not running as an app
(Mac/simulator?): … add a Mac fallback if 0 there"). Fix (commit `3b21e6c7`, native, 12 lines):
under `#if targetEnvironment(simulator)` a 0 read returns nil → JS null → gate "unknown" →
fail-open. Device builds compile the branch out; on-device 0 semantics untouched.

## Milestone B — model loaded (proof + numbers)

Screenshot `/tmp/kalsa-ios-shots/04-model-loaded.png`: pill "LFM2.5 2.6B — On this phone",
held banner gone. App telemetry (Metro log): `engine.eagerInit {"modelId":"lfm2.5-2.6b"}`,
`KALSA_NATIVE_VARIANT {"nGpuLayers":99}`. Native stderr (`/tmp/kalsa-console5.log`, captured
via `simctl launch --console-pty`), path scrubbed:

```
ggml_metal_device_init: GPU name:   MTL0 (Apple iOS simulator GPU)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple2  (1002)
ggml_metal_device_init: simdgroup reduction = false / matrix mul = false
ggml_metal_device_init: has unified memory = false / has bfloat = false / has tensor = false
ggml_metal_device_init: recommendedMaxWorkingSetSize  =     0.00 MB
ggml_metal_library_init: using embedded metal library
ggml_metal_library_compile_all: compiled 'fa_f16' library in 6.504 sec   (…all 34 libs)
llama_prepare_model_devices: using device MTL0 (Apple iOS simulator GPU) - 0 MiB free
llama_model_loader: loaded … 266 tensors from ~/…/Documents/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf (GGUF V3)
print_info: file type = Q4_0 / file size = 1.48 GiB (4.70 BPW) / arch = lfm2 / n_layer = 30
load_tensors: offloading 0 repeating layers to GPU
load_tensors: offloaded 0/31 layers to GPU
load_tensors:   CPU_Mapped model buffer size =  1503.20 MiB
load_tensors:   CPU_REPACK model buffer size =  1511.20 MiB
common_perf_print:        load time =    1561.57 ms
KALSA_SESSION {"op":"load","ms":7,"ok":false,…,"reason":"no_file"}   (KV session restore, first boot)
KALSA_PREWARM {"op":"done","promptMs":19381.889,"promptN":1889,…}
KALSA_PREWARM {"op":"snapshot_save","ok":true,"tokens":1889,…}
```

Reading of the numbers, with the caveat the task demands (simulator ≠ iPhone, and here the
simulator is not even Metal-backed):

- **Backend actually used: CPU** (arm64 simulator slice, Accelerate; mmap+mlock, repack on).
  Metal is initialized and the embedded kernel library compiles, but `n_gpu_layers=99` results
  in **0/31 layers offloaded** — the simulator Metal device reports
  `recommendedMaxWorkingSetSize 0.00 MB`, so llama.cpp refuses to place buffers there.
  `os_proc_available_memory`: raw OS read 0 (pre-fix it fail-closed the gate; post-fix the
  module reports null and nothing logs the value — stated here instead of a log line).
- **Model load 1561.57 ms.**
- **Prefill (app's prewarm telemetry): 1889 tokens in 19,382 ms ≈ 97.5 tok/s** — includes
  first-use one-time costs on a cold process; the separate perf print of a 2-token prompt eval
  shows 38.07 tok/s for single-token-scale calls. Neither number is a device datapoint.
- **Decode tok/s: not measured** — no generation ran (blocker below).
- **Thermal state: no thermal log lines at all** from the app or the OS during the whole run
  (the KalsaThermal module logs nothing at rest; no transitions fired).

## Blocker — why generation did not run (stopped per instructions)

The only prompt-injection surface is `kalsa://share?text=` (`src/app/shareIntent.ts`), and it
**merges into the composer draft, it does not send** (`useShareIn.ts:131-134`). On Android the
harness completes the flow with a UI tap (`device_tap_send()` in
`scripts/device-share-send.sh:113`). On iOS this Mac has no equivalent: no `idb`, `xcrun
simctl` has no tap/keystroke, and this runtime additionally confirms every `simctl openurl`
with a SpringBoard dialog — `kalsa://share?text=Ciao, come stai?` returned exit 0 but lands on
"Open in 'Kalsa AI Chat'? Cancel / Open" and the dialog re-appears on every retry (screenshots
`05-prefilled-stop-point.png`, `06-openurl-retry.png`). Dismissing it, and pressing send,
would both be UI taps; per the brief ("if a UI tap is unavoidable, say so and stop there with
screenshots rather than hacking the app") the run stops here. The prompt never reached the
composer; no model output was produced, hence nothing to summarize.

## Screenshots (kept in /tmp/kalsa-ios-shots/, no binaries in the lab)

- `00-springboard.png` — fresh springboard before install.
- `01-first-launch.png` — after dyld crash (app icon on springboard, app dead).
- `02-first-screen.png` — **Milestone A**: first screen, no red box.
- `03-model-present.png` — held state ("Not running here" pill) driving Fix 2.
- `04-model-loaded.png` — **Milestone B**: pill "On this phone", model loaded.
- `05-prefilled-stop-point.png`, `06-openurl-retry.png` — the stop point (OS confirm dialog).

## Exit codes, tests, commits

- Builds: `xcodebuild … -derivedDataPath /tmp/kalsa-ios-dd2 build` EXIT=0 ×3
  (`/tmp/kalsa-rebuild.log`, `-2`, `-3`), the last two "** BUILD SUCCEEDED **".
- Install EXIT=0 ×3; launches OK (process PIDs 71946, 1998, 12586); `simctl openurl` EXIT=0 ×2.
- `npx expo prebuild -p ios` EXIT=0 ×2 (Podfile KALSA blocks survived: LLAMA_RN_CXX20 +
  KALSA_EXCLUDED_ARCHS_X86_64 both present after regeneration); `pod install` EXIT=0 (inside prebuild).
- `npm install` EXIT=0 ×2 (expo bump; expo/* alignment).
- `npx tsc --noEmit` EXIT=0 (`/tmp/kalsa-tsc.log`). Targeted jest
  (benchRoute, shareIn, ModelDownloader): 3 suites, **42/42 passed**, EXIT=0 (`/tmp/kalsa-jest.log`).
- Commits on `kalsa` repo, branch `ios/first-build` (branch printed before each):
  `1bc2eca0` fix(ios): launch on the iOS 27 simulator (HEAD-at-the-time 5d58e12a named in msg);
  `3b21e6c7` fix(ios): simulator fallback for spurious 0 from os_proc_available_memory
  (HEAD-at-the-time 1bc2eca0 named in msg). No push, no tag, no new branch. The generated
  `ios/` tree and `ios/Pods` are gitignored (prebuild regenerates both).

## Cleanup (background PIDs)

Metro PID 38450 (first), 56736 (after deps bump) — both killed, verified gone. Unified-log
stream PID 49232 — killed, verified gone. `simctl launch --console-pty` wrapper PIDs 49245,
71937, 192, 1988, 12577 — exited when the app was terminated (`simctl terminate` EXIT=0).
`xcrun simctl shutdown all` EXIT=0; 0 booted devices after.

## Not verified / open

- Decode tok/s, TTFT, and a coherent-Italian-reply check — blocked by the tap gate above.
- Everything device-shaped: real Metal offload (the simulator offloads 0/31 layers),
  jetsam semantics of a real 0 from `os_proc_available_memory`, thermal behavior.
- The 1.2B LFM files remain unloadable through the catalog (no registry entry matches);
  they'd need either a dev-catalog entry with exact size or a catalog sha256-free entry.
- The openurl SpringBoard confirm dialog (new behavior on this runtime) deserves a note in
  the future iOS QA harness design (XCUITest or a `simctl`-trusted flow).
