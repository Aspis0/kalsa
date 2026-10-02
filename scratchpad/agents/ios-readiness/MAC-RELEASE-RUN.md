# MAC-RELEASE-RUN.md — Release build for "My Mac (Designed for iPad)" (2026-10-02, morning autonomous)

Scope: build the Kalsa iOS app as **Release** for the `platform=macOS,arch=arm64,variant:Designed for
[iPad,iPhone]` destination on the M1 Max (macOS 26.6.2, Xcode 27.0 27A266a) with Marco's free
Personal Team, run it, and measure real Metal (device name, `recommendedMaxWorkingSetSize`, offloaded
layers, load time, `os_proc_available_memory`). Worktree `~/Projects/kalsa-ios`, worked detached at
**c67e2df1** (SDK 57 baseline; branch `ios/first-build` not moved, not committed, not pushed; restored
at the end — verified `ios/first-build` still at `7c324067`).

## Verdict in one line

**The Release build succeeds (EXIT=0, signed by Personal Team MH9XLJ79Q9, free-team push-entitlement
worked around), but the app could NOT be launched headlessly** — every launcher is gated behind the
lock screen (the session was locked all morning): `open` hits the LaunchServices "unsupported bit"
(-10661), direct exec is kernel-killed ("load code signature error 4"), xctrace hangs, and Xcode
automation needs a consent dialog only an unlocked desktop can answer. **Neither owner question is
answered by this run**: (a) Release launch past the UIScene check — not verified on the new build;
(b) Metal offload of LFM2.5 — not verified, no numbers. The overnight session (00:58) DID run an
earlier build via Xcode on the unlocked desktop and it crashed at exactly the UIScene check — the
current baseline carries `enableSceneSupport: true` which that build predated (evidence below).

## Build pipeline (all real exit codes)

| step | exit | log |
|---|---|---|
| `git switch --detach c67e2df1` | 0 | — |
| `npm ci` | **0** | /tmp/ios-mac-npmci.log |
| binding patches 1+2 re-applied to `node_modules/llama.rn` | 0 | byte-checked vs BINDING-PATCHES.md (3518 `fa_smem`; quants.c 4327 lines) |
| `npx expo prebuild --platform ios --clean` (incl. pod install) | **0** | /tmp/ios-mac-prebuild.log |
| `pod install` (explicit) | **0** | /tmp/ios-mac-podinstall.log |
| xcodebuild Release, run 1 | **65** | /tmp/ios-mac-release.log |
| xcodebuild Release, run 2 | **0**, `** BUILD SUCCEEDED **` (/tmp/ios-mac-release2.log:69696) | /tmp/ios-mac-release2.log |

Podfile KALSA blocks verified after prebuild (one `LLAMA_RN_CXX20` + one `KALSA_EXCLUDED_ARCHS_X86_64`).
Destination verified present: `xcodebuild -showdestinations` →
`{ platform:macOS, arch:arm64, variant:Designed for [iPad,iPhone], id:00006001-001828DC029A801E, name:My Mac }`
(/tmp/ios-mac-dest.log). The build compiles llama.cpp with `GGML_USE_METAL -DGGML_METAL_EMBED_LIBRARY=1`,
target `arm64-apple-ios15.1`, SDK iPhoneOS27.0 — real Metal kernels embedded, correct for the iPad-on-Mac runner.

## Signing (free Personal Team)

- Team id from Xcode prefs (`IDEProvisioningTeamByIdentifier`): **MH9XLJ79Q9** "Marco Gualtieri
  (Personal Team)", `isFreeProvisioningTeam = 1`. `security find-identity` = 0 identities (no dev
  cert yet); `-allowProvisioningUpdates` created everything.
- Command line only (never written to a tracked file): `DEVELOPMENT_TEAM=MH9XLJ79Q9 -allowProvisioningUpdates`.
- Result: `codesign -dv` → `TeamIdentifier=MH9XLJ79Q9`, `Identifier=com.kalsa.app` (bundle id NOT
  refused by the free team); `codesign --verify --deep --strict` EXIT=0.

### Blocker 1 — push entitlement (run 1, EXIT=65)

```
/tmp/ios-mac-release.log:1290: error: Cannot create a iOS App Development provisioning profile for
"com.kalsa.app". Personal development teams, including "Marco Gualtieri", do not support the Push
Notifications capability.
```

expo-notifications adds `aps-environment: development` to `ios/KalsaAIChat/KalsaAIChat.entitlements`
(and that key is the ONLY content of the file). Fix: `CODE_SIGN_ENTITLEMENTS=/tmp/kalsa-mac-entitlements.plist`
on the command line, where the /tmp file is an EMPTY entitlements dict — no tracked file touched,
nothing else lost (nothing else was in there). Cost: push notifications don't work in this Mac test
build (irrelevant to the Metal question). Upstream note for the app-chain owner: a free-team Mac run
needs this either as a build flag or via an app.config.js entitlements override.

## Launch attempts — all blocked on the LOCKED SCREEN

The Mac's session is locked the whole morning ("Touch ID or Enter Password"; screenshots
/tmp/kalsa-mac-shots/01, 02, 03). I did not touch credentials. Each launcher tried, with evidence:

1. **`open` / Finder / `lsregister -f` + `open`** (from /tmp and from ~/Applications) → exit 1,
   "The application cannot be opened because it has an incorrect executable format." Root cause in
   the unified log:
   ```
   /tmp/kalsa-mac-all-stream.log:5629: CoreServicesUIAgent: (LaunchServices)
   [com.apple.launchservices:open] LAUNCH:Application cannot be launched because its unsupported
   bit is set, com.kalsa.app … status=-10661
   ```
   MobileInstallation builds the bundle record fine (`_LSServerRegisterItemInfo result = 0`),
   `UIRequiredDeviceCapabilities` is already `arm64` (not the classic prebuild `armv7` bug) — the
   unsupported bit is the iOS-app-on-Mac gate that only the sanctioned install/launch path clears.
2. **Direct exec of the binary** (sandboxed and unsandboxed, `env` clean) → SIGKILL (exit 137), no
   output, no container created. Kernel reason:
   ```
   kernel: proc 21067: load code signature error 4 for file "KalsaAIChat"  (10:36:41, log show)
   kernel: proc 29987: load code signature error 4 for file "KalsaAIChat"  (10:44:05, log show)
   ```
   An iOS-platform binary is only exec-able in the sanctioned iOS-on-Mac launch context.
3. **`xcrun xctrace record --template 'Time Profiler' --launch -- <app>`** → hangs at "Launching
   process: KalsaAIChat.app" past the 20 s time limit (killed after ~6 min); only an empty
   `RunIssues.storedata` in the trace. No process ever appeared.
4. **Xcode Apple Events** (`tell application "Xcode" …`, sdef has `run`/`debug` + settable
   `active run destination`) → `-1712 AppleEvent timed out` on ANY scripting query, including on a
   freshly restarted idle Xcode; `get version` answers instantly (served from metadata). Conclusion:
   the Automation consent prompt ("… wants to control Xcode") cannot be displayed/answered while the
   screen is locked. Accessibility IS granted (System Events works), but UI scripting is pointless
   against the lock screen.
5. **Xcode GUI** (the sanctioned launcher): unusable headless+locked. Overnight proof it works when
   the desktop is unlocked: see below.

Pre-launch prep that never got to be used: LFM2.5 file verified byte-exact for the catalog contract
(`~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1_593_894_944 B; layout
`Documents/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf` under
`~/Library/Containers/com.kalsa.app/Data` once a first launch creates the container).

## The overnight crash (00:58) — strongest signal for owner question (a)

`~/Library/Logs/DiagnosticReports/KalsaAIChat-2026-10-02-010131.ips`: platform **7 (iOS app on
Mac)**, `com.kalsa.app`, launched 00:58:04, EXC_BREAKPOINT (SIGTRAP) 2.4 s later, faulting thread:

```
UIKitCore +0xcc436c ___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke
libdispatch … -[UIApplication workspace:didCreateScene:withTransitionContext:completion:]
```

That is exactly the iOS 27 "UIScene lifecycle required" kill. That build predates the current
baseline: **c67e2df1 carries `enableSceneSupport: true` (app.config.js:153)**, prebuild generates
`UIApplicationSceneManifest` (verified on the simulator, FIRST-RUN.md Fix 1), so the new Release
build should pass — but it did not get to run here. NOT VERIFIED.

## Deltas left in the tree (all in gitignored, prebuild-regenerated `ios/`; no tracked file changed)

- `ios/KalsaAIChat.xcodeproj/project.pbxproj:456,530` — `DEVELOPMENT_TEAM = MH9XLJ79Q9;` inserted at
  project level (Xcode GUI builds need it; the xcodebuild CLI override alone doesn't help Cmd+R).
- `ios/KalsaAIChat.xcodeproj/xcshareddata/xcschemes/KalsaAIChat.xcscheme:44` — LaunchAction
  `buildConfiguration` Debug → **Release**.
- `/tmp/kalsa-mac-entitlements.plist` — empty entitlements dict used for the
  `CODE_SIGN_ENTITLEMENTS` override.
- `node_modules/llama.rn` — BINDING-PATCHES.md 1+2 re-applied (fresh after `npm ci`).
- Removed afterwards: the stray `~/Applications/KalsaAIChat.app` copy. Kept: build product at
  `/tmp/kalsa-mac-dd/Build/Products/Release-iphoneos/KalsaAIChat.app` (signed, provisioned, ready).

Branch restored: `git switch ios/first-build` → `7c324067` (untouched), worktree clean.

## Not verified / open

- Owner question (a): Release launch past the UIScene check on the Mac — build ready, launch blocked.
- Owner question (b): Metal device name, `recommendedMaxWorkingSetSize`, "offloaded N/M layers",
  load time, `os_proc_available_memory` headroom on the Mac — **no numbers; do not cite any**.
- Generation/typing: unattempted (would have been System Events keystrokes; moot on a locked screen).
- Decode tok/s, TTFT: untouched (same blocker chain as every prior run).

## Cheapest unblock for a human (5 minutes, unlocked desktop)

1. Unlock the Mac once. When the automation prompt appears, allow the agent host to control Xcode
   (or run it yourself: `open ~/Projects/kalsa-ios/ios/KalsaAIChat.xcworkspace`, Product →
   Destination → My Mac (Designed for iPad), Cmd+R — scheme is already Release, team already set).
2. If launched from Xcode: native stderr (ggml/llama lines) lands in Xcode's console; from a
   terminal, `log stream --predicate 'process == "KalsaAIChat"'` catches the JS/os_log side.
3. Then `open ~/Library/Containers/com.kalsa.app/Data/Documents` and drop the model:
   `mkdir -p …/models/lfm2.5-2.6b && cp ~/kalsa-models/mac/LFM2.5-2.6B-QAD-Q4_0.gguf …/models/lfm2.5-2.6b/`
   and relaunch (size-exact catalog contract, ModelDownloader.ts:19,80-83).

## Log inventory (/tmp)

`ios-mac-npmci.log`, `ios-mac-prebuild.log`, `ios-mac-podinstall.log`, `ios-mac-dest.log`,
`ios-mac-release.log` (EXIT=65), `ios-mac-release2.log` (EXIT=0), `kalsa-mac-entitlements.plist`,
`kalsa-mac-profile.plist` (decoded embedded.mobileprovision: Mac UDID 00006001-001828DC029A801E
provisioned, exp 2026-10-09), `kalsa-mac-all-stream.log` (unsupported bit at :5629),
`kalsa-mac-ls-stream.log`, `kalsa-mac-console1.log` (0 B — direct exec). Screenshots:
`/tmp/kalsa-mac-shots/01-permission-dialog.png` (black — display asleep), `02-after-wake.png` +
`03-xcode-check.png` (lock screen evidence). No binaries in the lab.

---

# Run 2 (unlocked) — 2026-10-02, ~11:46–13:05 autonomous, desktop unlocked

Scope: Marco at the Mac accepting dialogs. Same Release build as run 1
(`/tmp/kalsa-mac-dd/Build/Products/Release-iphoneos/KalsaAIChat.app`, Personal Team MH9XLJ79Q9).
Both owner questions are now ANSWERED, plus a working generation measurement.

## Verdict in one line

**A: YES** — the Release build launches past the UIScene check on "My Mac (Designed for iPad)"
(six clean launches, app alive for minutes, generating turns; zero crash reports from any launched
session). **B: full Metal numbers captured** — Apple M1 Max, unified memory,
`recommendedMaxWorkingSetSize` 55662.79 MB, **all 31/31 layers offloaded**, warm model load 314.7 ms.
**Generation: RAN** — prompt typed via UI automation, real decode ≈ **31.2 tok/s** (214 tokens).

## Getting it launched (run 1's blockers, cleared)

| step | exit | evidence |
|---|---|---|
| `open /tmp/kalsa-mac-dd/.../KalsaAIChat.app` retry | 1 | still the -10661 unsupported-bit gate; direct exec of even the INSTALLED wrapper is kernel-killed (`KalsaAIChat-2026-10-02-124002.ips`: SIGKILL "Code Signature Invalid", termination "Binary with wrong platform", 12:40:02 — that .ips is my exec probe, not a UI crash) |
| `open ~/Projects/kalsa-ios/ios/KalsaAIChat.xcworkspace` + AppleScript `run workspace document 1` | 0 | AppleScript consent answered by Marco; workspace doc reachable |
| GUI build run 1, run 2 | **failed** | toolbar destination was "Any iOS Device (arm64)" (AppleScript's `active run destination` lied); set via Product → Destination menu (item name includes the OS: "My Mac (Designed for iPad) 26.6.2"); AppleScript `set active run destination` is refused (-10003) — UI-scripting the menu is the way |
| GUI build run 3 | **failed** | `node: No such file or directory` — `ios/.xcode.env.local` pinned `/opt/homebrew/Cellar/node/26.3.0/bin/node`, deleted by a Homebrew upgrade (26.10.0_1); failed phases: ReactNativeDependencies, hermes-engine |
| **fix: `ios/.xcode.env.local` → `export NODE_BINARY=/opt/homebrew/bin/node`** | — | gitignored file, durable fix, left in place |
| GUI build run 4 | **0, launched** | pid 24012 at 12:23:59, alive 38 s at first check |

Also: `ios/KalsaAIChat/KalsaAIChat.entitlements` (gitignored, prebuild-regenerated) emptied to a bare
`<dict/>` so the free team can sign the GUI build (same workaround as run 1's CLI override; push
still absent in this Mac test build). Backup at `/tmp/kalsa-mac-entitlements-backup.plist`.
`git status` clean throughout — no tracked file changed, nothing committed.

## Answer A — UIScene check in Release: YES

- pid 24012 (12:23:59): alive 38 s, UI up (`/tmp/kalsa-mac-shots/14-run2-first-launch.png`).
- `open -b com.kalsa.app` LAUNCHES the app after one Xcode install (12:26, pids 25823/29409/43048) —
  the run-1 `-10661` gate is cleared by the sanctioned install, so future runs don't need Xcode.
- pid 52174 (12:57:17, Xcode/LLDB): alive 6:26+ while generating.
- Crash reports: only the overnight ones (00:44, 01:01) plus my 12:40 exec probe; **no .ips from any
  launched session** — the 00:58 overnight crash at `___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`
  does not reproduce; `enableSceneSupport: true` (c67e2df1) is confirmed as the fix.

## Answer B — Metal / load numbers

Model placement: the run-1 container guess was wrong. The Xcode-run iOS-on-Mac app runs with
`CFFIXED_USER_HOME=~/Library/Containers/1F508ED9-9C94-4040-992C-5340682FACE8/Data` (UUID-named
container; the bundle-id `~/Library/Containers/com.kalsa.app` stays empty). Model placed at
`.../Data/Documents/models/lfm2.5-2.6b/LFM2.5-2.6B-QAD-Q4_0.gguf`, 1_593_894_944 B byte-exact
(catalog contract: size check only, no sha256 in the registry entry; `ModelRegistry.ts:272`,
`ModelDownloader.ts` `isFileComplete`). App state flipped "Download 1.6 GB" → "Ready · local" on
relaunch, load auto-started.

Native ggml lines reached Xcode's debug console (stderr; `log stream` never sees them, and `log
stream --level debug` catches no app JS line in Release either). Console captured by UI automation:
activate Xcode → cliclick click into the console pane → Cmd+A, Cmd+C via cliclick → `pbpaste`.
Captures: `/tmp/kalsa-xcode-console3.log` (291 KB, contains the whole load + one full turn).
Quoted lines (`/tmp/kalsa-xcode-console3.log:NN`):

```
:136  ggml_metal_device_init: GPU name:   MTL0 (Apple M1 Max)
:141  ggml_metal_device_init: has unified memory    = true
:146  ggml_metal_device_init: recommendedMaxWorkingSetSize  = 55662.79 MB
:194  llama_prepare_model_devices: using device MTL0 (Apple M1 Max) (unknown id) - 53083 MiB free
:958  load_tensors: offloading output layer to GPU
:959  load_tensors: offloading 29 repeating layers to GPU
:960  load_tensors: offloaded 31/31 layers to GPU
:961  load_tensors:   CPU_Mapped model buffer size =   205.08 MiB
:962  load_tensors:  MTL0_Mapped model buffer size =  1512.20 MiB
:967  llama_context: n_ctx                 = 16384
:972  llama_context: flash_attn            = enabled
:1017 llama_kv_cache:       MTL0 KV buffer size =   104.00 MiB
:1578 KALSA_NATIVE_VARIANT {"androidLib":"","nGpuLayers":99}
```

- Metal device name: **Apple M1 Max** (`MTL0`), `MTLGPUFamilyApple7`, metal4 kernels, residency
  sets + shared buffers on (`:136-146` block).
- **has unified memory: true** (`:141`).
- **recommendedMaxWorkingSetSize: 55662.79 MB** (`:146`); cross-checked with a standalone Swift
  `MTLCreateSystemDefaultDevice` probe on the same machine: 55,662,788,608 B — matches exactly
  (`/tmp/kalsa-metal-probe.swift`).
- **Offloaded layers: 31/31** (`:960`; app asked nGpuLayers=99 = all, `:1578`).
- **Load time: 314.72 ms** — `common_perf_print: load time = 314.72 ms` (`:3172`, warm page cache;
  first cold load was not instrumented). Buffers: 1512.20 MiB mapped to MTL0, KV 104.00 MiB
  (n_ctx 16384), compute reserve 127 MiB / 18.44 ms (`:1535`).
- **Memory-headroom line: NOT LOGGED.** The app's `KALSA_MEMORY` turn line carries only memory-facts
  fields, all -1 (`:3180` — memory features disabled), and no `os_proc_available_memory` value is
  printed anywhere in the captured flow. Closest real readings: ggml's device free
  "53083 MiB free" (`:194`) and Metal heap `(1512.59 / 53084.17)` MiB. Do not cite an
  os_proc_available_memory number for the Mac — there isn't one.
- **Prewarm: skipped by design** — `KALSA_PREWARM {"op":"skip","reason":"kv_holds_chat"}`
  (`:1587`): the restored KV already holds the chat. KV resume evidence:
  `KALSA_KVRESUME n_tokens=2126 … resumable=1` (`:1582`) and
  `KALSA_SESSION {"op":"load","ms":8,"ok":true,"tokensOnDisk":2126,…}` (`:1584`). The previous
  session (12:44, screenshot `20-xcode-console.png`) showed
  `KALSA_PREFIX_MEASURED {"tokens":1889,"restored":true}` and
  `KALSA_PREWARM {"op":"restore","ok":true,"tokens":1889,"hash":"321764276"}`.

## Generation — RAN, two real turns

Typed via UI automation (cliclick into the composer, prompt `Ciao, chi sei?`, Return). The model
answered correctly in Italian both times ("Sono LFM, il Liquid Foundation Model, costruito da Liquid
AI…", screenshots `22-prompt-cliclick.png`, `23-second-gen.png`). Numbers from the second turn
(`/tmp/kalsa-xcode-console3.log:3172-3178`):

```
:3172 common_perf_print:        load time =     314.72 ms
:3173 common_perf_print: prompt eval time =     283.08 ms /    17 tokens (   16.65 ms per token,    60.05 tokens per second)
:3174 common_perf_print:        eval time =    6854.66 ms /   214 runs   (   32.03 ms per token,    31.22 tokens per second)
:3175 common_perf_print:       total time =    7341.54 ms /   231 tokens
:3178 KALSA_TELEMETRY {"turnId":"1",…,"tokensCached":2357,"tokensEvaluated":2143,"tokensPredicted":213,
      "promptMs":283.082,"predictedMs":7034.042,"predictedPerSecond":30.281…,"prompt_n":17}
```

**Decode ≈ 31.2 tok/s** (native) / 30.3 tok/s (app telemetry), prefill 60.1 tok/s, TTFT-equivalent
promptMs 283 ms — on M1 Max, LFM2.5-2.6B QAD-Q4_0 fully on GPU, n_threads=4 threadpools (`:1577`).
213 predicted tokens include the thinking block (the visible answer is the post-thinking text).

## Deltas left in the tree (all gitignored; branch `ios/first-build` untouched, nothing committed)

- `ios/.xcode.env.local` — NODE_BINARY → `/opt/homebrew/bin/node` (fixes Homebrew upgrades; needed
  by any future Xcode GUI build).
- `ios/KalsaAIChat/KalsaAIChat.entitlements` — empty dict (free-team signing).
- From run 1: scheme Launch = Release, project-level DEVELOPMENT_TEAM.
- App left running under the Xcode debugger (pid 52174). Screenshots `14-23` in
  `/tmp/kalsa-mac-shots/`; console captures `/tmp/kalsa-xcode-console{2,3}.log`;
  `/tmp/kalsa-mac-run.log` = unified-log stream (system noise only — no app lines land there in
  Release).

## Still open

- Cold-model load wall time (first load was not instrumented; 314.72 ms is warm).
- `os_proc_available_memory` headroom on the Mac: the app never logs it; if it matters, it needs an
  app-side log line (memory telemetry disabled in this build) — or accept ggml's "53083 MiB free".
- Whisper/embedding models on the Mac: untouched.

---

# Run 3 (main, no node_modules patches) — 2026-10-02, ~15:05–17:00 autonomous

Scope: prove the binding fixes work **from the pin**. `origin/main` (`2e7b4dfd`) pins
`kalsa.rn` **6b87db16**, which carries the two BINDING-PATCHES.md fixes as real commits
(`fa_smem(nsg)` at ggml-metal-ops.cpp:3518; the positive `#if defined(__aarch64__) ||
defined(__ARM_NEON)` guard in arch/arm/quants.c). Rebuild + run everything with a **pristine
`node_modules`** — zero hand patches. Worktree `~/Projects/kalsa-ios`, branch `ios/first-build`;
nothing pushed, lab not committed, no tracked file changed.

## Verdict in one line

**PASS** — branch rebased onto main (0 conflicts), all gates exit 0 with no patches, both builds
succeed, and the freshly installed Release build **loads LFM2.5 with 31/31 layers on Metal**
(`load_tensors: offloaded 31/31 layers to GPU`, Apple M1 Max, `recommendedMaxWorkingSetSize
55662.79 MB`). The Mac **locked itself again mid-run** (~15:40); everything after that was done
headlessly (AppleScript + `open --stderr`) without touching credentials.

## Branch surgery

- `git tag local/sdk58-trial 7c324067` (local tag only) preserves the SDK 58 trial.
- Branch = 5 iOS commits rebased onto `origin/main` `2e7b4dfd`:
  `a54ec315` (first-build readiness, was d3456a50), `f98c4304` (audit fix round, was
  2858a048), `d8426d0b` (EXCLUDED_ARCHS, was a15f5c10), `db0fff3a` (simulator 0-fallback,
  was 4590f50d), `7bceff40` (truthful memory-0 comments, was c67e2df1). Trial dropped.
- **Conflicts: none** (the only overlap, `package.json`, auto-merged; main's pin bump +
  iOS-prep line coexist).

## Verification gates (all real exit codes, node 22)

| step | exit | note |
|---|---|---|
| `npm ci` | **0** | /tmp/ios3-npmci.log; pristine — both former patch sites verified fixed natively in the pin |
| `bash scripts/assert-engine-provenance.sh` | **0** | 1154 files match `Aspis0/kalsa.rn@6b87db167a8f`; engine `kalsallama@5b596ce432ee` == pin |
| `npx tsc --noEmit` | **0** | /tmp/ios3-tsc.log |
| targeted jest, 7 suites touched by the 5 commits | **0**, 63/63 | appleDeviceClass, deviceProfile, loadGate, memoryEstimate, monitor, platformThermalStatus, loadRetryFreshness (/tmp/ios3-jest.log) |
| `npx expo prebuild --platform ios --clean` | **0** | /tmp/ios3-prebuild.log |
| `pod install` (explicit) | **0** | Podfile: 1× LLAMA_RN_CXX20, 1× KALSA_EXCLUDED_ARCHS_X86_64, 1× post_install |
| xcodebuild Debug, `generic/platform=iOS Simulator` | **0**, BUILD SUCCEEDED, 0 errors | /tmp/ios3-simdebug.log, fresh `/tmp/kalsa-ios3-dd-sim` |
| xcodebuild Release, Mac destination | **0**, BUILD SUCCEEDED, 0 errors | /tmp/ios3-macrelease.log, fresh `/tmp/kalsa-ios3-dd-mac`, signed TeamIdentifier=MH9XLJ79Q9, `codesign --verify --deep --strict` EXIT=0 |

Signing was CLI-only as before: `DEVELOPMENT_TEAM=MH9XLJ79Q9 CODE_SIGN_ENTITLEMENTS=/tmp/kalsa-mac-entitlements.plist`
(empty dict) `-allowProvisioningUpdates`. Two build attempts failed with **exit 64** first — a
destination-syntax trap worth recording: `variant:Designed for [iPad,iPhone]` (the `-showdestinations`
print form) and `variant=Designed for [iPad,iPhone]` both die in xcodebuild's parser — **the comma
inside the brackets breaks the key=value splitter** ("unreadable input 'iPhone]' at end of value").
`-destination 'id=00006001-001828DC029A801E'` is the reliable form.

## Launch — the lock screen returned, so: a headless playbook (the new result of this run)

The session locked again ~15:40 (screenshots /tmp/kalsa3-shots/02-after-wake.png = "Touch ID or
Enter Password"). No credentials touched. What worked headlessly, in order:

1. **xctrace `--launch` is useless here**: it resolves the launch to the *installed* wrapper (ran
   the old run-2 build), then hung past `--time-limit 90s` exactly like run 1. Killed.
2. **LLDB can launch-stop but not run** an uninstalled iOS-on-Mac binary: `process launch -s`
   survives (suspended at entry), a full `process launch` dies with SIGKILL "Code Signature
   Invalid" (crash report KalsaAIChat-2026-10-02-154324.ips) — the AMFI exec gate again.
3. **`open -b com.kalsa.app --stderr F --stdout F` WORKS — and captures native stderr** (the
   ggml fprintf lines land in F). Runs fine on a locked session. *Caveat discovered the hard way:*
   it launches the **installed** app, never an arbitrary bundle — an `lsregister -f` of a /tmp
   build did not take over the `-b` lookup, and the first capture therefore caught the **old**
   run-2 build (caught by md5 comparison of the wrapper binary + main.jsbundle; its 31/31 line is
   NOT pin evidence).
4. **The install itself still needs Xcode, but no human**: the workspace document from run 2 was
   stuck ("Build operations are disabled: … has changed and is reloading" — read via
   `properties of scheme action result`), and close/open AppleEvents time out (-1712) on the
   locked screen. `killall -9 Xcode` + `open -a Xcode …xcworkspace` + AppleScript
   `run workspace document 1` worked end to end: fresh **Release** build (scheme LaunchAction
   edited to Release, team in pbxproj — both gitignored generated files, see Deltas), ~25 min
   compile, install + launch under the debugger (16:13).
5. Xcode **reinstalled the app to a NEW wrapper UUID**
   `/private/var/folders/…/X/49B73DC1-D061-54D1-B5D6-3B482FF68A02/d/Wrapper/KalsaAIChat.app`
   (old install 695EEEB5-… was half-deleted by my failed in-place `rm` — read-only FS — so the
   reinstall was mandatory anyway). Identity verified: no `.debug.dylib` (Release), binary/main.jsbundle
   md5 differ from both run-2's build and my CLI build (Xcode embeds its own paths), bundle
   contains the pin's `BUILD_COMMIT '5b596ce'`.
6. Stopped the debug session via AppleScript `stop workspace document 1`, then relaunch:
   `open -b com.kalsa.app --stderr /tmp/kalsa3-final-stderr.log --stdout …` → **EXIT=0**, app up,
   model auto-loaded from the same UUID container (`1F508ED9-…`, `CFFIXED_USER_HOME` confirmed via
   `ps -E`; the byte-exact 1_593_894_944 B GGUF is still there).

## The load lines (this run's evidence, /tmp/kalsa3-final-stderr.log:10-20,67,130-136)

```
ggml_metal_device_init: GPU name:   MTL0 (Apple M1 Max)
ggml_metal_device_init: GPU family: MTLGPUFamilyApple7  (1007)
ggml_metal_device_init: has unified memory    = true
ggml_metal_device_init: recommendedMaxWorkingSetSize  = 55662.79 MB
llama_prepare_model_devices: using device MTL0 (Apple M1 Max) (unknown id) - 53083 MiB free
load_tensors: offloading output layer to GPU
load_tensors: offloading 29 repeating layers to GPU
load_tensors: offloaded 31/31 layers to GPU
load_tensors:   CPU_Mapped model buffer size =   205.08 MiB
load_tensors:  MTL0_Mapped model buffer size =  1512.20 MiB
llama_context: n_ctx                 = 16384
```

**31/31 on Metal, from the pin, no node_modules patches.** That is the binding owner's fold-in
confirmed end to end (compile + link + run + GPU offload).

## Deltas left in the tree (all in gitignored, prebuild-regenerated `ios/`; branch clean at `7bceff40`)

- `ios/.xcode.env.local` recreated (`NODE_BINARY=/opt/homebrew/opt/node@22/bin/node`) — prebuild
  `--clean` had wiped run 2's copy.
- Scheme LaunchAction `buildConfiguration` Debug → Release (for the Xcode GUI install run).
- `project.pbxproj`: `DEVELOPMENT_TEAM = MH9XLJ79Q9` in both app-target configs (GUI signing;
  the CLI build proved the team can stay on the command line).
- `ios/KalsaAIChat/KalsaAIChat.entitlements` emptied to `<dict/>` (free-team GUI signing; backup
  of the regenerated version at /tmp/kalsa3-entitlements-backup.plist).
- Xcode left open on the workspace, no debug session; app instance stopped at end of run.

## Open

- Decode tok/s / cold-load time on the new build: not measured (no generation attempted this run;
  the task's bar was the 31/31 load line).
- `xcodebuild`'s destination parser can't take the `[iPad,iPhone]` variant string — use
  `id=<mac-udid>`; worth remembering for campaign scripts.
- Stale LaunchServices leftovers: the half-deleted old wrapper dir (system-managed) and my
  `lsregister -f` of the /tmp bundle (harmless; the installed record won every lookup).
