# SDK58-TRIAL.md — Expo SDK 58 beta trial on the Kalsa iOS branch (2026-10-02)

Scope: trial Expo SDK 58 beta (iOS 27 / RN 0.88-rc) on worktree `~/Projects/kalsa-ios`,
local branch `ios/first-build`, iOS only. Android was not built and `~/Projects/kalsa`
(main) was not touched. No push, no new branch: the trial is one commit on top of the
rebased baseline and can be dropped with one reset.

## Verdict in one line

The SDK 58 beta **builds, launches, and loads LFM2.5 end to end** on the iOS 27
simulator after two node_modules-only patches (one known from SDK 57, one new in
whisper.rn), with **14 app-side compile/type fixes** — but it ships on an RN **release
candidate** with a binding that survives on a deprecation-shaped runtime path, so the
recommendation is **no-go for main now, re-trial at RN 0.88 stable** (details at the end).

## Git map

- `git fetch origin`; origin/main moved mid-trial from 7ddf39ad to **cbddc1f2** (binding
  pin 3d8fc84a + governor lane-fit); the baseline rebase was redone onto cbddc1f2.
- **SDK 57 baseline: `c67e2df178c57dd440d4d29e141c429481c7f70d`** — rebase of
  ios/first-build onto origin/main cbddc1f2. The old bump commits (1bc2eca0, and
  7de0beed's package.json/lock parts) were dropped/superseded in favour of main; the
  5 iOS-only commits survived replay (f54348f7→d3456a50, 1bbfd3b9→2858a048,
  c19128ec→a15f5c10, 275e982d→4590f50d, 0e5c3e57→c67e2df1 in the first round).
  Proof: `git diff origin/main --stat` = 27 files, all iOS-prep (plugins/, modules/
  kalsa-lifecycle|thermal, scripts/gen-metal-embed.js, src/engine/*, src/hooks/) — no
  package.json/lock. tsc EXIT=0; targeted jest 7 suites / 63 tests EXIT=0; full
  re-validation after the second rebase: npm ci EXIT=0, tsc EXIT=0.
- **SDK 58 trial commit: `7c3240676f93b2a965f46f720c578d9114d135da`** on ios/first-build
  (parent c67e2df1) — the upgrade + app-side fixes, one commit, droppable with
  `git reset --hard c67e2df1`.

## Upgrade mechanics (with citations)

- Command per the SDK 58 beta changelog
  (https://expo.dev/changelog/sdk-58-beta): `npx expo install expo@next --fix`.
  Node requirement per the same page: "Node.js 22.13 or newer on the 22 line, 24.3 or
  newer on the 24 line, or Node.js 26 and later" — this Mac has **v26.3.0**, no action.
- First `--fix` run failed: npm ERESOLVE — react-native-reanimated 4.7.0 declares peer
  `react-native@"0.86 - 0.88"` and npm refuses the `0.88.0-rc.3` prerelease against that
  literal range (npm prerelease rule, not a real incompatibility). Re-ran with
  `npm_config_legacy_peer_deps=true` → EXIT=0. The beta line pins RN 0.88.0-rc.3.
- Second failure was config-only: the CLI cannot rewrite a dynamic `app.config.js`; it
  asked for `expo-asset` in plugins and warned `ios.enableSceneSupport` is a no-op on
  SDK 58 (scene lifecycle is now the default; expo/fyi ios-scene-lifecycle.md says the
  option "is a no-op on SDK 58+" and prebuild warns it can be removed). Both edits made
  manually, then `--fix` EXIT=0.
- **llama.rn pin proven untouched**: `packages["node_modules/llama.rn"]` field-identical
  before/after (version 0.13.0-rc.4, resolved `...kalsa.rn.git#3d8fc84a…`, integrity
  unchanged) — the pin is origin/main's 3d8fc84a, kept per instruction.

## Versions (lockfile resolved, before → after)

| package | SDK 57 baseline | SDK 58 trial |
|---|---|---|
| expo | 57.0.26 | 58.0.2 |
| react | 19.2.3 | 19.3.0 |
| react-native | 0.86.2 | **0.88.0-rc.3** |
| react-native-reanimated | 4.5.1 | 4.7.0 |
| react-native-worklets | 0.10.1 | 0.13.0 |
| react-native-gesture-handler | 2.32.0 | 3.2.1 |
| react-native-safe-area-context | 5.7.0 | 5.9.1 |
| react-native-webview | 13.16.1 | 14.0.1 |
| react-native-view-shot | 5.1.0 | 5.1.1 |
| react-native-keyboard-controller | 1.21.9 | 1.22.4 |
| react-native-svg | 15.15.4 | 15.15.5 |
| expo-build-properties | 57.0.22 | 58.0.9 |
| expo-modules-core | 57.0.20 | 58.0.11 |
| expo-modules-jsi | 57.1.1 | 58.0.7 |
| expo-asset | 57.0.18 | 58.0.10 |
| expo-camera | 57.0.6 | 58.0.7 |
| expo-file-system | 57.0.7 | 58.0.5 |
| expo-notifications | 57.0.21 | 58.0.11 |
| jest | 30.4.2 | 29.7.0 (expo --fix aligned it back) |
| whisper.rn | 0.7.2 | 0.7.2 (unchanged) |
| llama.rn | 0.13.0-rc.4 @ 3d8fc84a | **identical lock entry** |

## What broke, and the fixes

App-side (committed in 7c324067; all are the changelog's documented RN 0.88 changes):

1. **Strict deep-import API** (changelog: deep imports from `react-native/Libraries/*`
   are type errors; opt-out `customConditions: ["react-native",
   "react-native-legacy-deep-imports"]`, removed after 0.88): tsconfig.json opts out —
   react-native-webview 14.0.1 and react-native-view-shot 5.1.1 still deep-import
   `react-native/Libraries/Types/CodegenTypes`. This opt-out also restored the legacy
   component-typed refs, so our `useRef<TextInput>`-style code compiles unchanged while
   it is in place.
2. **webview 14.0.1 types collapse to `never`** even with the opt-out: its
   `WebViewTypes.d.ts` extracts `ComponentProps` from RN 0.88's new `HostComponent`
   typing and references `NativeMethodsMixin`; the shipped types predate RN 0.88-rc
   (types-only; runtime unaffected). `src/components/reactNativeCodegenTypes.d.ts`
   (new) shims the four codegen aliases webview deep-imports, and PdfToImages.tsx uses
   a single local `ComponentType<any>` alias for the pdf.js host. Drop both when webview
   ships RN 0.88 types.
3. **`StatusBar backgroundColor` removed** (changelog: prebuild removals tied to RN):
   App.tsx drops the prop. Android-visible change, iOS unaffected — listed under Android
   impact below.
4. **`TextStyle` props now readonly**: typography.ts `applyFontScale` mutates through a
   narrow mutable view (in-place mutation is that file's documented static-import
   contract).
5. **`Linking.getInitialURL()` resolves `string | null | undefined`**: useShareIn.ts
   collapses undefined to null (same meaning downstream).
6. **expo-asset must be declared in plugins** (install --fix requirement, dynamic
   config); **`ios.enableSceneSupport` removed** from expo-build-properties config
   (no-op + prebuild warning on 58; scene manifest + SceneDelegate.swift generated by
   default — verified in the regenerated `ios/KalsaAIChat/`).

Binding-side (node_modules only; recorded in BINDING-PATCHES.md "SDK 58" section):

1. **Known, not new**: `FATTN_SMEM(nsg)` → `fa_smem(nsg)` at
   llama.rn vendor `ggml-metal-ops.cpp:3518` — same as SDK 57 audits; still required at
   pin 3d8fc84a; build fails without it (error: use of undeclared identifier).
2. **New — whisper.rn 0.7.2**: `RNWhisper.mm:314-325` uses `RCTCxxBridge`, removed from
   RN 0.88 headers → 5 compile errors. Patched with a file-local
   `@protocol RNWhisperBridgeRuntimeAccess` + `id<Protocol>` cast — the exact pattern
   the kalsa.rn fork itself uses in `RNLlama.mm:76`. Compile verified; runtime path
   untested (no voice flow in this trial).

kalsa.rn 3d8fc84a itself had **no new RN 0.88 compile breakage**, and its JSI install
worked at runtime (proof below) — but it works by message-sending `runtime`/
`jsCallInvoker` into the bridgeless `RCTBridge` through that protocol, which the public
0.88 header no longer declares. Deprecation-shaped: works today, unsupported surface.

## Build, launch, load (evidence)

- `npx expo prebuild -p ios --clean` EXIT=0 (69 s wall); `pod install` EXIT=0 (18 s).
  Xcode 27.0 (27A266a), iOS 27.0 simulator runtime 24A434.
- xcodebuild (`-destination 'generic/platform=iOS Simulator'`, derived data
  /tmp/kalsa-ios-dd58): run 1 failed at ggml-metal-ops (patch 1 missing after fresh
  node_modules), run 2 failed at RNWhisper.mm, run 3 **`** BUILD SUCCEEDED **`, EXIT=0**
  (/tmp/ios-build58c.log:38119). Wall times from log births/mtimes: 09:28:24→09:29:29
  (fail 1), 09:30:58→09:31:35 (fail 2), 09:38:40→09:40:11 (success, warm); ≈12 min
  total including both patch interruptions. Both failures were binding-side; zero
  app-target compile errors under RN 0.88-rc.
- Launch: `simctl launch --console-pty` (bundle `com.kalsa.app`; the first launch
  attempt used a stale id and failed FBSOpenApplicationServiceErrorDomain code=4 —
  operator error, not an app defect). Native console: /tmp/kalsa-console58.log —
  `ggml_metal_device_init: GPU name: MTL0 (Apple iOS simulator GPU)` (line 45),
  `llama_model_loader: loaded … 266 tensors … LFM2.5-2.6B-QAD-Q4_0.gguf (GGUF V3)`
  (line 57), `offloaded 0/31 layers to GPU` (line 866), `load time = 1335.03 ms`
  (line 1621). The simulator retains the model container from FIRST-RUN.md (same
  device UDID), so the Documents/models contract was already satisfied.
- JS/Metro telemetry (/tmp/kalsa-metro58.log): `KALSA_FOREGROUND_IDLE_PROTOCOL
  revision=854cd50`, `engine.eagerInit {"modelId":"lfm2.5-2.6b"}`,
  `KALSA_NATIVE_VARIANT {"nGpuLayers":99}`, `KALSA_PREWARM {"op":"done",
  "promptMs":14098.758,"promptN":1889}` — a real 1889-token prefill through llama.rn
  under RN 0.88-rc — and `KALSA_PREWARM {"op":"snapshot_save","ok":true}`. The stale
  KV snapshot was correctly rejected (`meta_mismatch:engineBuild`) and re-saved.
- Screenshots (/tmp/kalsa-ios-shots58/): `01-first-screen.png`, `02-model-loaded.png` —
  chat UI up, pill "LFM2.5 2.6B — On this phone", no red box; the only LogBox banner is
  "Open debugger to view warnings" backed by benign warnings (DrawerLayoutAndroid
  deprecation via react-navigation, a pre-existing require cycle in
  src/domain/miniappBuilders, Reanimated web-deps notice).
- All simulator caveats from FIRST-RUN.md carry over unchanged: CPU backend (0/31
  layers offloaded, `recommendedMaxWorkingSetSize 0.00 MB`), numbers are not
  device datapoints. Generation was not attempted (same headless-tap blocker as
  FIRST-RUN.md "Blocker").
- Cleanup: Metro (PID 58795) killed — port 8081 has 0 listeners; simulator shut down
  (SHUTDOWN_OK).

## Android impact assessment (from the docs; no Android build was run)

Per the SDK 58 beta changelog and linked docs:

1. **R8 minification on by default** in release (`android.enableMinifyInReleaseBuilds=true`,
   opt out via expo-build-properties). Reflection-based libraries need keep rules —
   for Kalsa that means the JNI bindings in llama.rn/whisper.rn and any
   reflection-based serialisation must be proven under R8 before main moves; our
   custom `plugins/withLlamaFromSource` gradle wiring must be re-verified.
2. **Expo Modules 2.0 beta** on both platforms; Android gets the same JSI-call speedups;
   the changelog's TurboModule-vs-Expo-Modules benchmarks are Android numbers — our
   kalsa-lifecycle/kalsa-thermal modules stay DSL-based, no migration forced.
3. `@expo/ui`: `style` prop removed from `RNHostView` (we do not use @expo/ui — no
   impact).
4. Carried from the 7ddf39ad audit (still true on 58): expo-modules-core 57.0.10+
   ignores a second promise settle in release instead of crashing; Kalsa's modules do
   not double-settle.
5. App-side prop removals are mostly cross-platform type-level (`StatusBar
   backgroundColor` is the Android-visible one: the status bar background now follows
   the shell on Android — needs one visual check when main moves; `translucent` and
   `networkActivityIndicatorVisible` are gone with it).
6. `expo-widgets` gains Android support; `expo-app-intents` is alpha — neither is in
   our tree.
7. The `react-native-legacy-deep-imports` tsconfig opt-out is TypeScript-only — no
   Android build impact, but the RN 0.88 runtime itself is the same rc on both
   platforms, so the Android rnllama/whisper .so builds must be re-proven against
   0.88-rc headers (CI builds them; not exercised here).

## Recommendation

**No-go for main today; re-trial the week RN 0.88 stable + Expo SDK 58 stable ship,
then go.** Reasons, weighted:

1. RN `0.88.0-rc.3` is a release candidate; the changelog itself says the stable RN
   will be swapped into the SDK 58 line when it ships. Kalsa's main pins a fork of a
   fork (kalsa.rn over llama.cpp); rebasing that stack onto an rc that will still
   change buys nothing.
2. The binding stack works, but on an unsupported surface: kalsa.rn's bridgeless
   runtime access relies on selectors the public RN 0.88 header no longer declares,
   and whisper.rn 0.7.2 needs a carried node_modules patch to compile at all. Both
   belong upstream before main adopts 58 (BINDING-PATCHES.md item 4).
3. Everything else was routine: 14 small app-side fixes, all matching the published
   migration notes; tsc EXIT=0; full jest 296 suites / 3078 tests EXIT=0
   (`npx jest --runInBand`); prebuild/pod/build/launch/load all green.

What would change the verdict: RN 0.88 stable in the expo SDK 58 line, a whisper.rn
release with bridgeless runtime access, kalsa.rn runtime access modernised, and one
on-device (Jelly-class iPhone) build+load pass — this trial was simulator-only.
