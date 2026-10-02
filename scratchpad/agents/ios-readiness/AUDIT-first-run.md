# AUDIT-first-run.md — hostile audit of `1bc2eca0` + `3b21e6c7`

Worktree `~/Projects/kalsa-ios`, branch `ios/first-build`, HEAD `3b21e6c7`.
Subject commits: `1bc2eca0` (Expo SDK 57 patch-line bump + `ios.enableSceneSupport`)
and `3b21e6c7` (simulator-only `nil` fallback in `KalsaLifecycleModule.swift`).
Context read: `FIRST-RUN.md`, `NEXT.md`, `AUDIT-first-build-r2.md`, `~/Projects/kalsa/REPOS.md`.

**Nothing was edited, staged or committed. No npm install/ci, no build.** Reads were against
the working tree, `/tmp/aud1bc`, and the npm registry. Two test runs were executed *in the
worktree, read-only* (`tsc --noEmit`, `jest --ci`) and `scripts/assert-engine-provenance.sh`
was executed (it fetches and compares; it writes only to a `mktemp -d` it deletes).

## Verdict in one line

Both commits **fix what they claim on iOS** and the root cause is real and independently
reproducible — but `1bc2eca0` quietly rewrote **81 lockfile entries / the entire Expo native
Android runtime** on the platform that actually ships, verified by **zero Android builds and
3 of 297 jest suites**, and it carries one Android **release-only behaviour inversion**
(double-settled Expo promises go from *crash* to *silent hang*) that nobody looked for.
`3b21e6c7` is a two-line compile-time `#if` that is correct for what it says, but it does
**not** cover the "not an app" case NEXT.md asked for, and it leaves three code comments
asserting the opposite contract.

---

## 0. Full changed-package inventory (Q1 — every version that moved)

`package.json` declared ranges changed: **17** (lines 29–48).
Lockfile `packages[]`: **54 changed, 27 added, 0 removed** (81 entries moved).
`react-native` **0.86.2 unchanged**, `@react-native/gradle-plugin` **0.86.2 unchanged**
(the Gradle plugin did **not** move — the commit's "Gradle plugin untouched" is true),
`metro` top-level **0.84.4 unchanged**, `jest` **30.4.2 unchanged**, `react-native-worklets`
present before and after, `package.json` `devDependencies` **unchanged**.

| package | declared range (package.json) | resolved old → new | Android native code? |
|---|---|---|---|
| `expo` | ~57.0.9 → **~57.0.26** (:29) | 57.0.9 → 57.0.26 | yes (21 kt + `build.gradle`) |
| `expo-modules-core` (transitive) | — | **57.0.8 → 57.0.20** | yes, **291 kt**, JSI C++, Gradle plugin |
| `expo-camera` | ~57.0.5 → **~57.0.6** (:36) | 57.0.5 → 57.0.6 | yes (19 kt) |
| `expo-notifications` | ~57.0.8 → **~57.0.21** (:47) | 57.0.8 → 57.0.21 | yes (85 kt) |
| `expo-image-picker` | ~57.0.7 → **~57.0.20** (:44) | 57.0.7 → 57.0.20 | yes (18 kt) |
| `expo-image-manipulator` | ~57.0.7 → **~57.0.20** (:43) | 57.0.7 → 57.0.20 | yes (11 kt) |
| `expo-file-system` | **~57.0.1 unchanged** (:41) | 57.0.1 → **57.0.7** | yes (29 kt) |
| `expo-secure-store` | ~57.0.1 → **~57.0.4** (:48) | 57.0.1 → 57.0.4 | yes (8 kt) |
| `expo-sharing` | ~57.0.8 → **~57.0.22** | 57.0.8 → 57.0.22 | yes (11 kt) |
| `expo-calendar` | ~57.0.1 → **~57.0.5** (:35) | 57.0.1 → 57.0.5 | yes (**114 kt**) |
| `expo-asset` | **~57.0.8 unchanged** (:31) | 57.0.8 → **57.0.18** | yes (4 kt) |
| `expo-constants` (transitive) | — | 57.0.8 → **57.0.20** | yes (2 kt) |
| `expo-font` | **~57.0.1 unchanged** (:42) | 57.0.1 → **57.0.4** | yes (3 kt) |
| `expo-keep-awake` | **~57.0.1 unchanged** (:45) | 57.0.1 → **57.0.2** | yes (3 kt) |
| `expo-build-properties` | ~57.0.8 → **~57.0.22** (:34) | 57.0.8 → 57.0.22 | **no** `android/` (config plugin only) |
| `expo-application` | ~57.0.2 → ~57.0.3 (:30) | 57.0.2 → 57.0.3 | yes (1 kt) |
| `expo-battery` | ~57.0.1 → ~57.0.3 (:32) | 57.0.1 → 57.0.3 | yes (5 kt) |
| `expo-blur` | ~57.0.2 → ~57.0.3 (:33) | 57.0.2 → 57.0.3 | yes (7 kt) |
| `expo-clipboard` | ~57.0.1 → ~57.0.2 (:37) | 57.0.1 → 57.0.2 | yes (5 kt) |
| `expo-device` | ~57.0.1 → ~57.0.2 (:39) | 57.0.1 → 57.0.2 | yes (1 kt) |
| `expo-document-picker` | ~57.0.1 → ~57.0.3 (:40) | 57.0.1 → 57.0.3 | yes |
| `expo-linear-gradient` | ~57.0.1 → ~57.0.2 (:46) | 57.0.1 → 57.0.2 | yes (2 kt) |
| `expo-speech` | ~57.0.1 → ~57.0.3 (:51) | 57.0.1 → 57.0.3 | yes (5 kt) |
| `expo-modules-autolinking` | — | **57.0.9 → 57.0.13** | yes (35 kt, **Gradle autolinking**) |
| `expo-modules-jsi` | — | **57.0.4 → 57.1.1** (minor!) | no `android/` |
| `@expo/config-plugins` | — | 57.0.6 → 57.0.9 | build-time (used by `plugins/`) |
| `@expo/prebuild-config` | — | 57.0.10 → 57.0.16 | build-time |
| `@expo/fingerprint` | — | 0.20.6 → 0.20.13 | build-time |
| `@expo/metro-config` | — | 57.0.7 → 57.0.12 | bundler |
| `babel-preset-expo` | — | 57.0.5 → 57.0.13 | **JS transform** |
| `agent-cli-detector` | — | 0.1.4 → 0.1.7 | no |

**Added (27):** 16 × `metro@0.84.5` + friends under `@expo/metro/node_modules/`;
2 × `hermes-{estree,parser}@0.36.0` under `babel-preset-expo/node_modules/`;
`@react-native/{normalize-colors}@0.86.3` under `@expo/prebuild-config/node_modules/`;
**`@react-native/{codegen,babel-plugin-codegen}@0.86.3`** under `babel-preset-expo/node_modules/`;
`expo/node_modules/@react-native/{debugger-frontend,debugger-shell,dev-middleware}@0.86.3`;
`expo/node_modules/ws@7.5.13`; **`sandbox-cli-detector@0.2.0`** (new transitive of `@expo/cli@57.0.27`,
MIT, zero deps, no install script, env detection only — benign).

Gradle SDK levels did **not** move: `ExpoModulesCorePlugin.gradle:65/68/69` reads
`compileSdk/target 36, minSdk 24` identically in 57.0.8 and 57.0.20 (verified by diffing the
extracted tarballs). `app.config.js:144` still pins `minSdkVersion: 33`.

---

## 1. Android impact of `1bc2eca0`

### P1-1 — CONFIRMED, HIGH — an Android **release-only crash class becomes a silent hang**

`expo-modules-core` `android/src/main/java/expo/modules/kotlin/jni/PromiseImpl.kt`,
function `checkIfWasSettled`, 57.0.8 → 57.0.20 (diffed from the npm tarballs):

```kotlin
// 57.0.8 — REMOVED
      val exception = PromiseAlreadySettledException(fullFunctionName ?: "unknown")
      // We want to report that a promise was settled twice in the development build.
      // However, in production, the app should crash.
      if (BuildConfig.DEBUG && jsLogger != null) { … return }
      throw exception
// 57.0.20 — ADDED
      return
```

Changelog: `expo-modules-core` **57.0.10 (2026-08-06)** — *"[Android] Ignore already-settled
promises."* <https://raw.githubusercontent.com/expo/expo/sdk-57/packages/expo-modules-core/CHANGELOG.md>
(PR <https://github.com/expo/expo/pull/46770>).

Concrete failure scenario: any Kalsa path that settles an Expo-module promise twice — an
abort racing a completion, a `finally` next to an early `resolve`, a teardown that fires after
the module released — used to **throw `PromiseAlreadySettledException` and crash the shipping
release APK** on the Jelly Star. After this bump the same code returns a promise that is
**never settled**: no exception, no log, no crash report, a spinner that never resolves and a
field bug that cannot be diagnosed from telemetry. This is the worst class of change to make
blind on the shipping platform: it converts a loud, reproducible, greppable signal into a
silent one. `expo-modules-core` is the promise substrate for **every** Expo module the app
uses (`expo-camera`, `expo-notifications`, `expo-secure-store`, `expo-file-system`,
`expo-image-picker`, …). No Android build was run; no test covers this.

Severity: **high** — device-only, release-only, silent, on the platform that ships.

### P1-2 — CONFIRMED, LOW-MEDIUM — an unconditional global `gc()` lands in the shipping APK's JS runtime

`expo-modules-core` `android/src/main/cpp/RuntimeHolder.cpp:73-75` (new in 57.0.20,
**no `if` guard, not test-only**):

```cpp
  // Exposes a `gc()` function, so tests can force a full garbage collection.
  auto gcPropName = jsi::PropNameID::forUtf8(*runtime, "gc");
  runtime->global().setProperty(*runtime, gcPropName, jsi::Function::createFromHostFunction(
```

Scenario: `typeof gc === 'function'` feature detection in Kalsa or any dependency flips from
false to true in every Android build after this merge, and any `global.gc` assumption elsewhere
stops being safe. A global added to the shipping runtime by an iOS-motivated commit, with no
Android verification. Severity low in probability, but it is free to enumerate: grep the app
for `global.gc` / `typeof gc` before merging.

### P1-3 — CONFIRMED, MEDIUM-HIGH — the root cause is real; the fix is ~18× larger than the minimum, and the two fixes in the commit are independent

**Root cause CONFIRMED by independent means.** `expo-modules-core` changelog
**57.0.9 (2026-08-04)**: *"[iOS] Added module lifecycle hooks that replace the `OnCreate`,
`OnDestroy`, `OnStartObserving` and `OnStopObserving` DSL components: `didCreate`,
`willDestroy`, `didStartListening` and `didStopListening`."* <https://github.com/expo/expo/pull/47542>
Grepping the **entire** extracted `expo-modules-core@57.0.8` npm tarball for `willDestroy`
returns **zero hits**; `expo-modules-core@57.0.20` has it at `ios/Core/Modules/Module.swift:41`,
`ios/Core/Protocols/AnyModule.swift:43,82`, `ios/Core/ModuleHolder.swift:175`. `nm` on the
installed post-bump `ios/Pods/ExpoModulesCore/ExpoModulesCore.xcframework/ios-arm64_x86_64-simulator/…/ExpoModulesCore`
exports 5 `willDestroy` symbols including `000000000014e350 T _$s15ExpoModulesCore10BaseModuleC11willDestroyyyFTj`.
The commit's diagnosis — camera imports it, core@57.0.8 lacks it — is **correct**.

**But**: `expo@57.0.9` declares `"expo-modules-core": "~57.0.8"`, and semver `~57.0.8` accepts
`57.0.20`. `expo-camera@57.0.5` peers on `expo: "*"`. So **a single-package bump of
`expo-modules-core` to ≥ 57.0.9 satisfies every declared range in the tree** and resolves the
dyld abort. That is 1 moved package instead of 17 declared / 54 resolved / 27 added, and it
leaves the Android native runtime (`expo-modules-core` 291 kt, `expo-calendar` 114 kt,
`expo-notifications` 85 kt, `expo-modules-autolinking` Gradle plugin) at 57.0.8.

The honest defence of the large bump is the **second** half of the commit: scene support
requires `expo ≥ 57.0.23` (verified below), which forces the whole-line move. But then the
lockfile churn belongs to `enableSceneSupport`, not to the dyld fix — and the commit message
presents them as one inseparable "align the expo line" action. They are two commits and two
blast radii, and only one of them is an Android change.

Severity: **medium-high** as process (an iOS first-run commit that is going to be merged into
the Android-shipping line moved 12–13 patch releases of the Android module runtime), not as a
predicted defect.

### P1-4 — CONFIRMED, MEDIUM — `package.json` declared ranges now lie about five direct deps

The bump moved resolved versions for direct deps whose **declared range was not touched**:

* `package.json:31` `"expo-asset": "~57.0.8"` → resolves **57.0.18**
* `package.json:41` `"expo-file-system": "~57.0.1"` → resolves **57.0.7**
* `package.json:42` `"expo-font": "~57.0.1"` → resolves **57.0.4**
* `package.json:45` `"expo-keep-awake": "~57.0.1"` → resolves **57.0.2**
* `expo-constants` (transitive, no declared range) 57.0.8 → **57.0.20**

These moved because `expo@57.0.26` declares tighter ranges (`expo-asset: ~57.0.18`,
`expo-constants: ~57.0.20`, `expo-file-system: ~57.0.7`, `expo-font: ~57.0.4`,
`expo-keep-awake: ~57.0.2`), not because `npx expo install --check` asked for them.
Scenario: a maintainer reads `package.json:41` and believes expo-file-system is on 57.0.1;
`npx expo install --check` on the next bump will not re-verify it; and the next
`npm install` that re-resolves could move these again silently. The lockfile is the truth
and the manifest is now a fiction for five packages.

### P1-5 — PLAUSIBLE, MEDIUM — new React Native **patch skew** introduced by the bump

`react-native` itself is genuinely untouched at 0.86.2 — but the bump **duplicated
`@react-native/*` at 0.86.3** into the tree:

```
node_modules/babel-preset-expo/node_modules/@react-native/codegen            0.86.3  (NEW)
node_modules/babel-preset-expo/node_modules/@react-native/babel-plugin-codegen 0.86.3 (NEW)
node_modules/expo/node_modules/@react-native/{dev-middleware,debugger-frontend,debugger-shell} 0.86.3 (NEW)
```

On disk: top-level `@react-native/codegen` = **0.86.2** (what the RN Gradle plugin's codegen
task resolves), nested `babel-preset-expo/node_modules/@react-native/codegen` = **0.86.3**
(what `babel-preset-expo` uses for the JS spec transform). Three `hermes-parser` copies
(0.36.1 / 0.36.0 / 0.35.0) and two `metro` copies (0.84.4 top-level, 0.84.5 nested under
`@expo/metro`) now coexist — `expo@57.0.16` notes *"Bump to `@expo/metro@56.0.2` and
`metro@0.84.5`"* (<https://github.com/expo/expo/pull/49161>).

The app ships `react-native-reanimated` and `react-native-worklets`, both codegen'd native
modules. Scenario: a Fabric/reanimated spec generated by the Gradle path (0.86.2) and
transformed by the Babel path (0.86.3) diverges on a shape change, producing a failure that
appears **only in a minified Hermes release build** — which is exactly the artifact nobody
built here. Cannot be excluded without an Android release build; marked PLAUSIBLE for that
reason, not because it is likely.

### P1-6 — CONFIRMED, MEDIUM — the dyld crash class has **no gate**, because `package-lock.json` does not pin the iOS binaries at all

`ios/Podfile.properties.json` → `"EXPO_USE_PRECOMPILED_MODULES": "true"`; `ios/Podfile:37`
defaults it on; `node_modules/expo-modules-core/ExpoModulesCore.podspec:118` →
`Expo::PackagesConfig.instance.try_link_with_prebuilt_xcframework(s)`. The iOS pods are
**prebuilt xcframeworks fetched from Expo's CDN at `pod install` time**.

Direct evidence that the CDN artifacts are versioned independently of the npm tarballs:

```
grep -rn willDestroy <full expo-camera@57.0.5 npm tarball>        -> 0 hits
grep -rn willDestroy <full expo-modules-core@57.0.8 npm tarball> -> 0 hits
nm -u ios/Pods/ExpoCamera/.../ios-arm64_x86_64-simulator/ExpoCamera
    -> _$s15ExpoModulesCore10BaseModuleC11willDestroyyyFTj
       _$s15ExpoModulesCore9AnyModuleP11willDestroyyyFTq      (2 undefined refs)
```

So the npm sources pinned by the lockfile contain no `willDestroy` at all; the linked binaries
do. `integrity` in `package-lock.json` is a witness for the tarball, **not for the framework
that actually gets linked on iOS**. Nothing in CI compares prebuilt-artifact skew across pods.
Scenario: the next `npm ci` + `pod install` on a different Expo patch combination can abort
with `Symbol not found` before `main` while the lockfile is entirely green and
`assert-engine-provenance.sh` passes. This is a structural gap, not a one-off.

### Q1 sub-answers, short form

* **Did the Gradle plugin move?** No. `react-native` 0.86.2 and `@react-native/gradle-plugin`
  0.86.2 unchanged; `compileSdk/target 36, minSdk 24` defaults byte-identical.
* **Did `llama.rn` resolution change?** **No.** `packages["node_modules/llama.rn"]` is
  byte-identical: same `git+ssh://git@github.com/Aspis0/kalsa.rn.git#6c9b16edc9f53cf9b106ac1e269e44c4904f52e0`
  and same `sha512-U3ZNpuDcyiyR+7gXDkwhuKhytCyRknEdJtIKr8jhVabGkV4lXnlOdbAbHz9oK3LtxOuDkGCIslRwUbPgeaEEsw==`.
* **Would `scripts/assert-engine-provenance.sh` still pass?** **In CI, yes. In this worktree,
  no — I ran it: `EXIT=1`, 38 differing entries.** See P2-2.
* **Do `plugins/` rely on internals that changed?** `plugins/*.js` import
  `@expo/config-plugins` / `expo/config-plugins` (57.0.6 → 57.0.9) and only the stable
  `withAndroidManifest` / `withAppBuildGradle` / `withMainActivity` / `withInfoPlist` /
  `withGradleProperties` / `withPodfile` / `withDangerousMod` surface — **no changed internals
  observed**, and `expo-modules-autolinking` 57.0.10 added `[Android] Resolve symlinks in the
  Gradle plugin sourceDir before it reaches includeBuild` + `[Android] Fix autolinking pure C++
  React Native modules published without includesGeneratedCode: true` (<https://github.com/expo/expo/pull/48514>),
  which touches exactly `llama.rn`'s Android link path — direction is a fix, but it is an
  unreviewed Android autolinking change shipped by an iOS commit.

### P2-2 — CONFIRMED, MEDIUM — the provenance gate fails in the worktree that produced these commits

```
$ bash scripts/assert-engine-provenance.sh
[provenance] lockfile pins Aspis0/kalsa.rn@6c9b16edc9f5
[provenance] DIVERGENT: the installed engine is not Aspis0/kalsa.rn@6c9b16edc9f5
[provenance] first differing path: ./vendor/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c
[provenance] differing entries: 38
EXIT=1
```

The 38 paths, computed independently: **36** `vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-embed-*.s`
written by `plugins/withLlamaIosSourceBuild.js` during `pod install`, plus
`vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-ops.cpp` (binding Patch 1) and
`vendor/llama.cpp/ggml/src/ggml-cpu/arch/arm/quants.c` (binding Patch 2).

`scripts/assert-engine-provenance.sh:28-36` calls the `.s` files an *"accepted iOS divergence"*
but the `manifest()` `find` excludes only `./android/.cxx/*`, `./android/build/*`,
`./ios/build/*`, `./node_modules/*` — so it still exits 1. **Neither audited commit caused
this** (the `llama.rn` lockfile entry is byte-identical); it is branch state produced by the
iOS prebuild/pod work. Two things follow: (a) the branch does not pass its own provenance gate
on the machine that produced it, and (b) because CI starts from `npm ci`, **the two binding
patches live only in `node_modules` and exist in no CI build** — `ggml-metal-ops.cpp`'s
`fa_smem(nsg)` Metal patch is exactly what an iOS release build needs and exactly what CI
would silently lack.

---

## 2. `ios.enableSceneSupport`

`app.config.js:150-158`:

```js
        // iOS 27 (Xcode 27 SDK) refuses to launch apps that keep the
        // AppDelegate-only lifecycle: "Application failed to launch: UIScene
        // life cycle is required for apps built with this SDK". Opt in to the
        // scene lifecycle; expo >=57.0.23 with expo-build-properties >=57.0.20
```

### The two cited claims are CONFIRMED

* `expo/expo#46664` — "[iOS][Xcode 27] Fails on launch because UIScene lifecycle is required",
  label `Issue accepted`, closed 2026-09-23, assignee `chrfalch`. Body quotes exactly
  *"Application failed to launch: UIScene life cycle is required for apps built with this SDK.
  See Technote TN3187 for more information on migration."*
  <https://github.com/expo/expo/issues/46664>
* `expo` changelog **57.0.23 (2026-09-15)** — *"[iOS] Add opt-in UIKit scene lifecycle support
  with React Native startup, deep links, Handoff, and quick actions."*
  <https://github.com/expo/expo/pull/50191>. `expo-build-properties/src/iosSceneSupport.ts:9`
  hard-fails below it: `MINIMUM_EXPO_VERSION = '57.0.23'` and throws
  `` `ios.enableSceneSupport` requires Expo SDK 57.0.23 or a newer SDK 57 patch ``.
  The installed `expo@57.0.26` / `expo-build-properties@57.0.22` satisfy it.

### P3-3 — REFUTED — does it change Android?

**No.** `iosSceneSupport.ts:47-50` returns `config` untouched when
`props.ios?.enableSceneSupport === undefined`, and when set it only calls
`withAppDelegate` and `withInfoPlist` — iOS-only config-plugin mods, ignored during Android
prebuild. `withBuildProperties.js:33` calls the plugin unconditionally but the property name is
`ios.enableSceneSupport`. Android `app.config.js` (`:37-77`) and the `android:` block of
`expo-build-properties` are untouched by this commit.

### P3-4 — REFUTED — deep links, `kalsa://`, universal links, share-in plumbing is intact

Generated `ios/KalsaAIChat/Info.plist` carries the manifest with
`UISceneDelegateClassName = EXExpoAppSceneDelegate`, `UIApplicationSupportsMultipleScenes = false`
(single scene, matches Expo's template). The generated `AppDelegate.swift` is **unchanged in
shape** and still overrides `application(_:open:options:)` and
`application(_:continue:restorationHandler:)`, both of which still call `RCTLinkingManager`.

`node_modules/expo/ios/AppDelegates/ExpoAppSceneDelegate.swift:103` implements
`scene(_:openURLContexts:)` → `SceneEventForwarder.open(url:options:)` →
`appDelegate()?.application(UIApplication.shared, open: url, options: options)` (reaches Kalsa's
override) and, via `notifyLinkingManagerUnlessAlreadyNotified(of:during:notify:)`
(`SceneEventForwarder.swift:103-121`), calls `RCTLinkingManager` **exactly once** — the dedupe
is designed for exactly the generated-Kalsa-delegate case. Cold-start URLs are rebuilt into
`startReactNative(launchOptions:)` so `Linking.getInitialURL()` still works.

Cold-start **double**-delivery (the scene delegate feeds `connectionOptions.urlContexts` into
both launch options and the forwarder) is absorbed by `src/host/shareIn.ts:25` *"URLs this
build has already claimed"*. No duplication.

**However, none of this was exercised by the run.** FIRST-RUN records that
`xcrun simctl openurl kalsa://share?text=…` returned EXIT=0 and then hit a SpringBoard
*"Open in 'Kalsa AI Chat'?"* confirm dialog that it could not dismiss, and stopped. So:

### P3-5 — PLAUSIBLE, MEDIUM — three scene-lifecycle claims remain unproven, one of them load-bearing

* **Universal links.** `app.config.js:44` declares `autoVerify: true` for
  `https://kalsa.io/pair`. The scene path for `NSUserActivityTypeBrowsingWeb` is
  `scene(_:continue:)` + the rebuilt `browsingWebActivity` launch option. No universal link
  was ever delivered in this run. The pairing QR flow — a shipping feature — has zero
  evidence under the new lifecycle.
* **Cold-start share injection.** Deduped by design, but no test exercises the
  `getInitialURL()` + `url`-event pair, and the confirm dialog meant it was never run.
* **Orientation.** Generated `Info.plist` has portrait + portraitUpsideDown on phone and all
  four on iPad. Scene lifecycle does not change the allowed set. Note the pre-existing
  inconsistency that `app.config.js:12` says `orientation: "portrait"` while the iPad plist
  allows landscape — not caused here, but under scenes the iPad now rotates through
  `UIWindowScene` geometry updates where previously the AppDelegate window was the only path.
  Low severity, worth one manual check.
* **Background tasks.** No `BGTaskScheduler` / `BGAppRefresh` / `BGProcessing` usage anywhere
  in `modules/*/ios` or `src/` — **REFUTED** as a risk.
* **The brief's premise about a memory-warning observer is wrong.** `KalsaLifecycleModule.swift`
  has no observer; it exposes one function. The only observer in the codebase is
  `KalsaThermalModule.swift:48`, on `ProcessInfo.thermalStateDidChangeNotification` via
  block-based `NotificationCenter`, which is scene-independent — **REFUTED** as a risk.

---

## 3. `3b21e6c7` — the simulator fallback

`modules/kalsa-lifecycle/ios/KalsaLifecycleModule.swift:21-35`:

```swift
    Function("availableMemoryBytes") { () -> Int64? in
      let bytes = Int64(os_proc_available_memory())
      #if targetEnvironment(simulator)
      if bytes == 0 { return nil }
      #endif
      return bytes
    }
```

**How it detects the simulator — CONFIRMED: compile-time, not runtime.** `#if
targetEnvironment(simulator)` is a preprocessor-time `#if` over `TARGET_OS_SIMULATOR`. No
runtime branch, no `ProcessInfo.processInfo.environment`, no cost.

**What it returns in place of 0 — CONFIRMED: `nil`, i.e. no substitute number.** There is no
host-memory estimate, so the question "is it bounded by real host memory" has no answer to
give: the fallback is unbounded by construction. The JS path is sound and pre-existing:
`modules/kalsa-lifecycle/src/index.ts:132-136` maps any non-number to `null`, and
`src/engine/deviceProfile.ts:714` seeds `availableMemoryBytes: null`, which
`deviceProfile.ts:218-223` treats as *unknown* — so the fail-open path the commit describes is
the real one.

**Does it leak into device builds — CONFIRMED: no.** The `#if` compiles the branch out.
`0 = a real jetsam reading` is preserved verbatim on device. That half of the commit is clean.

**Does it keep 0 = no-headroom on device — CONFIRMED, yes.** Correctly scoped.

### P3-6 — CONFIRMED, MEDIUM — three comments now assert the opposite of the code

`KalsaLifecycleModule.swift:9-12` (module header, **untouched by the commit**):

```
//   - availableMemoryBytes(): os_proc_available_memory(), the per-app jetsam
//     headroom — the closest iOS analog of Android's MemAvailable read. 0 is
//     a real reading (the app is at/over its limit) and crosses to JS
//     unchanged; JS treats it as zero headroom, not unknown.
```

`…:34` returns `nil` on simulator. The header's contract is now false for one build
configuration. `src/engine/monitor.ts:55-57` still says *"0 is a real reading on iOS
(os_proc_available_memory returns 0 when the app is at/over its limit) — callers must treat it
as zero headroom, not unknown"* — true on device, false on simulator, with no note. And
`modules/kalsa-lifecycle/src/index.ts:15` still documents the native method as
`os_proc_available_memory() as bytes` with no mention of a nullable result.

The commit message even quotes the stale header as if it were still the contract
(`the module's documented contract ('0 is a real reading, JS treats it as zero headroom')`).
Scenario: the next reader trusts the header, hardens a gate against `0`, and reinstates the
`blocked_ram` trap on the simulator without knowing why it was lifted.

### P3-7 — CONFIRMED, MEDIUM — the fallback does **not** cover the "not an app" case NEXT.md asked for, and the commit says it does

Commit message: *"This is the Mac/simulator fallback NEXT.md step 1.3 called for."*
`NEXT.md` step 1.3: *"`os_proc_available_memory` returns 0 when not running as an app
(Mac/simulator?): **measure on both** before trusting the fail-closed 0; add a Mac fallback if 0 there."*

`#if targetEnvironment(simulator)` is compiled **out** for the *My Mac (Designed for iPad)*
destination — NEXT.md step 1.2's explicit M1 test target, which builds the device iOS slice
with `TARGET_OS_SIMULATOR == 0`. There, a 0 still means `blocked_ram` and a held composer.
Apple's own contract, already quoted in `AUDIT-first-build-r2.md:317-319`
(`os/proc.h`): *"**0 is returned if the calling process is not an app**, or the calling process
exceeds its memory limit"* — the *first* meaning is exactly the Designed-for-iPad case, and it
is the one left unhandled.

Neither measurement NEXT.md required was taken. This is the same residual the r2 audit named
as P2-1 (*"no environment discrimination and no escape hatch"*), narrowed to one environment
but still described as complete.

### P3-8 — CONFIRMED, LOW-MEDIUM — the change silently disables the RAM gate on the simulator, with no log line and no test

Because the fallback returns `nil` rather than a bound, a **genuine** 0 on the simulator (real
host exhaustion — the simulator *does* have a memory ceiling, it is just not the per-app jetsam
budget) becomes indistinguishable from "no read" and is ignored. Scenario: a simulator run
loads a 4 GB model into a Mac that cannot hold it and the process dies with the host's memory
pressure killer, with the app having logged nothing — FIRST-RUN concedes this in passing
(*"post-fix the module reports null and nothing logs the value — stated here instead of a log
line"*). A gate that silently vanishes is harder to debug than one that fails closed.

Coverage: **zero**. `jest.config.js` sets `roots: ["<rootDir>/src"]`, so `modules/**` is not
even collected, and the Swift file cannot be tested from jest at all. The tests that pin
"0 = zero headroom" (`src/engine/monitor.test.ts:23-26`,
`src/engine/deviceProfile.test.ts:78-81`) were not touched and cannot distinguish the two
environments.

---

## 4. Package-lock hygiene — CONFIRMED CLEAN (no findings)

* **No registry switch.** 1058/1058 `http(s)` `resolved` URLs point at `registry.npmjs.org`.
  No mirror, no proxy, no scoped redirect. No `.npmrc` in the repo or `~`.
* **Integrity present everywhere.** 0 http-resolved entries missing `integrity`; the single
  entry without `resolved` is the lockfile root (`""`).
* **Integrity spot-checked against the registry — all MATCH:** `expo@57.0.26`,
  `expo-modules-core@57.0.20`, `expo-camera@57.0.6`, `expo-notifications@57.0.21`,
  `expo-build-properties@57.0.22`, `expo-asset@57.0.18`, `expo-file-system@57.0.7`,
  `react-native@0.86.2`, `@react-native/gradle-plugin@0.86.2`.
* **No new packages with install scripts.** The complete `hasInstallScript: true` set is
  `canvas@2.11.2`, `fsevents@2.3.3`, `unrs-resolver@1.12.2` — all pre-existing and unmodified
  by this commit. **0 added.** The r2 audit's "no postinstall" property on Android CI holds.
* **0 packages removed**, `lockfileVersion` 3 → 3 unchanged.
* One supply-chain note (benign): `sandbox-cli-detector@0.2.0` is brand new, pulled in by
  `@expo/cli@57.0.27`. MIT, single author `David Mokos`, zero dependencies, no install script,
  purpose is *detecting whether a CLI runs inside a sandbox* (e2b / vercel-sandbox / replit /
  daytona / modal / codespaces / gitpod). New third-party code in the CLI closure, but it
  carries no privilege and is not in the APK.

---

## 5. Tests

**What was run** (`1bc2eca0` message + FIRST-RUN): `npx tsc --noEmit` EXIT=0, and
*"targeted jest (benchRoute, shareIn, ModelDownloader): 3 suites, 42/42 passed"*.

**What should have been run:** the full suite — it costs **30 seconds** and is the repo's own
gate (`.github/workflows/ci.yml:43` `npx jest --runInBand`).

**I ran it** in this worktree, read-only:

```
npx tsc --noEmit          → TSC_EXIT=0
npx jest --ci --silent    → Test Suites: 296 passed, 296 total
                            Tests:       3070 passed, 3070 total
                            Time:        29.892 s      JEST_EXIT=0
```

**Outcome: green.** So this is a process finding, not a broken-build finding — but the
commit cites 42/42 as its proof for a change that rewrote 81 lockfile entries and the entire
Expo Android native runtime, which is 1.4% of the suite.

### P4-1 — CONFIRMED, LOW-MEDIUM — the branch never had CI

`.github/workflows/ci.yml:8-13`:

```yaml
on:
  push:
    branches: [main, feat/**]
  pull_request:
    branches: [feat/**]
```

`ios/first-build` matches neither push filter, and the branch is local-only (never pushed).
So **no CI ran for this branch at any point** — the two commits' "proof" is whatever the
author typed into the message. The full suite would have run on merge to `main` (push filter
matches), and on a PR into `main` (the pull_request filter is on the *base* branch), so the
gate is not lost — it is simply four commits late.

---

## Severity ranking

| # | Finding | Verdict | Sev |
|---|---|---|---|
| P1-1 | `PromiseImpl.kt` double-settle: **crash → silent hang** in Android release | CONFIRMED | **HIGH** |
| P1-3 | root cause real; fix 18× the minimum; dyld fix and scene fix are independent | CONFIRMED | MED-HIGH |
| P1-5 | `@react-native/*` 0.86.3 duplicated against `react-native` 0.86.2; 3 hermes-parser, 2 metro | PLAUSIBLE | MED |
| P1-6 | lockfile pins the npm tarball, **not** the prebuilt iOS frameworks that caused the crash | CONFIRMED | MED |
| P2-2 | `assert-engine-provenance.sh` **EXIT=1** in this worktree (38 paths); CI never had the 2 binding patches | CONFIRMED | MED |
| P3-7 | `#if targetEnvironment(simulator)` misses the iPad-on-Mac "not an app" 0 that NEXT.md/r2 flagged | CONFIRMED | MED |
| P1-4 | 5 direct deps' declared ranges now disagree with the lockfile | CONFIRMED | MED |
| P3-5 | universal links / cold-start share unproven under scenes (never delivered in the run) | PLAUSIBLE | MED |
| P3-6 | 3 comments assert the contract the commit removed | CONFIRMED | MED |
| P4-1 | 3/297 suites run; branch matched no CI trigger | CONFIRMED | LOW-MED |
| P3-8 | RAM gate silently off on simulator, no log line, no test | CONFIRMED | LOW-MED |
| P1-2 | unguarded global `gc()` added to the Android runtime | CONFIRMED | LOW-MED |
| P3-3 | `enableSceneSupport` changes Android | **REFUTED** | — |
| P3-4 | deep links / `kalsa://` / share-in plumbing under scenes | **REFUTED** (by design) | — |
| — | lockfile hygiene: registry, integrity, install scripts | **CLEAN** | — |
| — | `llama.rn` resolution, react-native, Gradle plugin, jest, metro-top-level all unmoved | **CLEAN** | — |

## REFUTED explicitly (claims in the brief or the docs that do not hold)

1. *"the memory-warning notification observer in KalsaLifecycleModule"* — **no such observer
   exists.** `KalsaLifecycleModule.swift` exposes one function and no observer; the codebase's
   only observer is `KalsaThermalModule.swift:48` on `thermalStateDidChangeNotification`.
2. *"a minimal alternative (bump only expo-camera + core)"* — the true minimum is
   **core alone**; `expo-camera` did not need to move (the prebuilt imports `willDestroy`
   identically at 57.0.5 and 57.0.6). But see P1-3: the *second* half of the commit genuinely
   requires `expo ≥ 57.0.23`.
3. *"the lockfile must not change llama.rn"* — it did not; the entry is byte-identical.

## What I could not check (and why it matters)

* **No Android build was performed and none is permitted here.** P1-1, P1-2, P1-5 are all
  release-only Android outcomes; they are argued from source diffs and changelogs, not from a
  green `./gradlew assembleRelease`. **An Android release build of this branch is the single
  highest-value follow-up action.**
* **The old prebuilt pods are gone** (the tree holds post-bump `ios/Pods`), so the exact
  "0 exports / 2 undefined refs" numbers in FIRST-RUN could not be re-measured on 57.0.5/57.0.8
  binaries. The equivalent fact was established a different and stronger way (changelog +
  full-tarball source grep + `nm` on the current binaries).
* **No universal link, no real generation, no decode tok/s** — the run stopped at the SpringBoard
  confirm dialog; those remain unevidenced on the new lifecycle.
* **`os_proc_available_memory` on *My Mac (Designed for iPad)* was not measured** — the exact
  number NEXT.md step 1.2 asked for, and the one that decides whether P3-7 is a latent
  `blocked_ram` trap on the second iOS target.