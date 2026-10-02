# AUDIT — c1f8087b "build(deps): bump Expo 57 patches" (branch `expo57-bump`)

Auditor: hostile pass. Subject commit `c1f8087b`, parent `101c2bdd` (= `origin/main` of the
Kalsa app). Worktree `~/Projects/kalsa-expo-bump`, writer luna (gpt). Owner approved the bump;
this pass asks only whether **this commit** is safe and complete to push to app `main`.

Scope claimed by the commit: 21 `expo-*` direct deps re-pinned to later SDK-57 patches,
`package-lock.json` regenerated, `ios.enableSceneSupport: true` added to the
`expo-build-properties` block in `app.config.js`. No git operations were performed on the
worktree; all builds/diffs were done in `/tmp` (`/tmp/pb-old` = parent tree + parent
`npm ci`, `/tmp/pb-new` = HEAD tree + `cp -Rc` node_modules, `/tmp/tb/*` = npm tarballs).

**Bottom line: the commit is safe to push to `main` for Android.** Prebuild output is
byte-identical, autolinking resolution is identical modulo version strings, `react-native`,
`react`, reanimated, worklets, llama.rn and whisper.rn are all unmoved, and the lockfile
regeneration is clean on every axis I could test. The commit message, however, is **not
complete**: it hides one added direct dependency, one transitive MINOR bump, one new
third-party package, and it presents the `PromiseImpl` change as a free win when it is a
crash-to-silent-hang trade. Six findings below are real; none is a blocker.

One correction is load-bearing: **the previous audit's P1-2 ("unguarded global `gc()` added
to the Android runtime", recorded CONFIRMED) is wrong.** That code never compiles into the
app. It must not propagate.

---

## Verdict table

| # | Finding | Verdict | Severity |
|---|---------|---------|----------|
| F1 | `expo-modules-core` `PromiseImpl` double-settle: release crash → silent no-op; commit message sells it as free | **CONFIRMED** (source), Kalsa reachability **REFUTED** | MEDIUM |
| F2 | "Jest 292 suites / 3042 tests EXIT=0" not reproducible; suite has a load-sensitive assertion | **CONFIRMED** (numbers reproduce, green full run does not) | LOW-MED |
| F3 | `expo-constants` added as a **new** direct dependency, never mentioned | **CONFIRMED** | LOW-MED |
| F4 | `expo-modules-jsi` moved **MINOR** 57.0.4 → 57.1.1, forced by `expo-modules-core` itself | **CONFIRMED** | LOW (Android-irrelevant) |
| F5 | New third-party `sandbox-cli-detector@0.2.0` executes inside the CI prebuild step | **CONFIRMED** | LOW |
| F6 | Local `assembleRelease` APK contains **no** `libkalsa_iroh_mobile.so` → it is not the artifact CI ships | **CONFIRMED** | LOW |
| F7 | `expo-file-system` legacy `readAsStringAsync` now materialises the whole file as bytes before decoding | **CONFIRMED** | LOW |
| F8 | `expo-modules-core` `DataPersistor` activity-result classloader change | **CONFIRMED** (fix) | INFO |
| F9 | `expo-notifications` launcher-intent hardening (2 files) | **CONFIRMED** (fix) | INFO |
| F10 | `expo-speech` `TtsState`: init failure resolves `[]` / emits `speakingError` instead of hanging forever | **CONFIRMED** (fix) | INFO |
| F11 | `JavaCallback` `retainedValues` / `retainsJSValue()` — new JNI argument retention | **REFUTED** as Kalsa risk | INFO |
| F12 | `expo-modules-autolinking` `GradlePlugin.sourceDir` nullable + pure-C++ path | **REFUTED** (inert) | INFO |
| F13 | `expo-secure-store` `deleteItemImpl` rewrite | **REFUTED** (equivalent) | INFO |
| — | Prior audit P1-2 "unguarded global `gc()`" | **REFUTED — prior audit is wrong** | — |
| — | Prior audit Android items re-proved on this lockfile | see §1, §3 | — |

---

## 1. Lockfile integrity (`package-lock.json`, `101c2bdd` → `c1f8087b`)

lockfileVersion 3 → 3. 1033 → 1060 package entries: **27 added, 0 removed, 56 version
changes, 83 new/changed entries in total.**

### 1.1 `llama.rn` byte-identical — CONFIRMED

```
JSON.stringify(old["node_modules/llama.rn"]) === JSON.stringify(new["node_modules/llama.rn"])  → true
root deps["llama.rn"]: github:Aspis0/kalsa.rn#7c12bdc6ac5f58206a6b637e87b4e7bc4cacfa0f  (unchanged)
```
Entry (identical in both, `resolved` is the only non-npmjs URL and is expected):
```json
{"version":"0.13.0-rc.4",
 "resolved":"git+ssh://git@github.com/Aspis0/kalsa.rn.git#7c12bdc6ac5f58206a6b637e87b4e7bc4cacfa0f",
 "integrity":"sha512-vcohA8cVifBvuN8fIrSv9ypLZp+Y/pElXolGz94O0RKpboTjJ1yXb7tkIfV+w0JfncBlBcsrNasj4Cp2QTbbJQ==",
 "license":"MIT","bin":{"llama-rn-download-artifacts":"install/download-native-artifacts.js"},
 "engines":{"node":">= 16.0.0"},"peerDependencies":{"react":"*","react-native":"*"}}
```
Independently re-proved at the byte level, not just the lockfile line:
`bash scripts/assert-engine-provenance.sh` → **exit 0**,
`[provenance] OK: 1154 files match Aspis0/kalsa.rn@7c12bdc6ac5f`,
`[provenance] engine inside it: kalsallama@5b596ce432ee == native/kalsallama.pin`.
The commit message's "engine provenance EXIT=0" claim is **true**.

### 1.2 Registry — CONFIRMED clean
Every `resolved` in the new lockfile is `https://registry.npmjs.org/…` except
`node_modules/llama.rn` (git+ssh, unchanged, expected). No other git/http registry, no
`http://`, no entries missing `resolved`.

### 1.3 `integrity` — CONFIRMED complete
All 83 new/changed entries that have a `resolved` have an `integrity`. Entries without a
`resolved`: none (root project only).

### 1.4 `hasInstallScript` — CONFIRMED, zero added
```
old: canvas, fsevents, unrs-resolver        (3)
new: canvas, fsevents, unrs-resolver        (3)      ADDED 0 / REMOVED 0
```
No new lockfile fields either (`fields only in new: []`, `fields only in old: []`), so the
lockfile was not rewritten into a new npm's private schema by accident.

### 1.5 MAJOR / MINOR movers — two exceptions, one of them real

```
!! expo-modules-jsi           57.0.4 -> 57.1.1
!! expo/node_modules/ws        8.21.1 -> 8.22.0
```

**F4 — `expo-modules-jsi` MINOR, CONFIRMED.** This is not a choice the writer made; it is
forced by the bump, from `expo-modules-core`'s own dependency range:

| expo-modules-core | declares |
|---|---|
| 57.0.8 (old) | `"expo-modules-jsi": "~57.0.4"` |
| 57.0.20 (new) | `"expo-modules-jsi": "~57.1.1"` |

Android impact: **none.** `expo-modules-jsi` ships no `android/` directory at all
(`apple/`, `spm.config.json`, `expo-module.config.json` only); `diff -rq` over its whole tree
shows only Swift sources, `Package.swift` and `CHANGELOG.md`. It is also not a direct
dependency of the app. So the MINOR is harmless — but "only the SDK 57 patch line" is not
literally true and the commit message should say so. The second mover, `ws` 8.21.1→8.22.0,
is dev-only (nested under `@expo/cli`).

Unmoved, as required: `react-native` 0.86.2, `react` 19.2.3, `react-native-reanimated` 4.5.1,
`react-native-worklets` 0.10.1, `whisper.rn` 0.7.2, hoisted `@react-native/codegen` 0.86.2,
`hermes-parser` top-level 0.36.1.

### 1.6 New duplicates — CONFIRMED present, REFUTED as an Android/codegen risk

Introduced by this commit:
- `node_modules/@expo/metro/node_modules/{metro,metro-core,metro-config,metro-cache,
  metro-cache-key,metro-file-map,metro-minify-terser,metro-resolver,metro-runtime,
  metro-source-map,metro-symbolicate,metro-transform-plugins,metro-transform-worker,
  metro-babel-transformer,ob1}` at **0.84.5**, while the hoisted `metro*` stay at **0.84.4**
  (`@expo/metro` 56.0.0 → 56.0.2 now pins metro 0.84.5). 17 new nested packages.
- `node_modules/babel-preset-expo/node_modules/@react-native/codegen` **0.86.3** and
  `…/@react-native/babel-plugin-codegen` **0.86.3**, while the hoisted pair stay at 0.86.2
  (`babel-preset-expo` 57.0.5 → 57.0.13 depends on `0.86.3`, exact; `react-native` 0.86.2
  pins `0.86.2`, exact).
- `node_modules/@expo/prebuild-config/node_modules/@react-native/normalize-colors` 0.86.3
  (prebuild-time only, inert).
- Three `hermes-parser` majors coexist as before, plus new nested copies: hoisted 0.36.1,
  `@expo/metro` + `metro` 0.35.0, `babel-preset-expo` 0.36.0.

**Can this break the Android release build or reanimated/worklets codegen? No, and the
green build is the proof, not an assumption.** The Gradle/C++ side uses the hoisted
`@react-native/codegen` **0.86.2** (RN's own), and the build log shows every relevant
codegen task executing:
```
> Task :llama.rn:generateCodegenArtifactsFromSchema
> Task :react-native-reanimated:generateCodegenArtifactsFromSchema
> Task :react-native-worklets:generateCodegenArtifactsFromSchema
> Task :whisper.rn:generateCodegenArtifactsFromSchema   (+ 7 more)
> Task :app:generateCodegenArtifactsFromSchema SKIPPED
```
and the resulting APK ships `libreact_codegen_RNKC.so`, `libreact_codegen_rnsvg.so`,
`libreact_codegen_safeareacontext.so`. The nested 0.86.3 pair is reachable only from Babel,
and `bundleReleaseJsAndAssets` ran Babel during the same successful build. Neither
reanimated nor worklets declares `@react-native/codegen` in `dependencies`, so they cannot
pick up the nested copy. Patch-level skew (0.86.2 vs 0.86.3) inside the same RN release
branch, empirically exercised: **REFUTED**, but it is duplication the writer created and
should have mentioned.

### 1.7 F5 — `sandbox-cli-detector@0.2.0`, CONFIRMED, unmentioned
New entry with no prior existence:
```json
{"version":"0.2.0","resolved":"https://registry.npmjs.org/sandbox-cli-detector/-/sandbox-cli-detector-0.2.0.tgz",
 "integrity":"sha512-4lyHX0ZU0AZKwjgZ1InxZAa3PNpyEb8rOQ+Zss1ReYmhNzW0Q+h1zE5nvniXN0HaAWZaZE1zgVNEirb0R7LmNg==",
 "license":"MIT","bin":{"sandbox-cli-detector":"dist/cli.js"},"engines":{"node":">=18.18"}}
```
Sole depender is `expo/node_modules/@expo/cli` 57.0.27 (`^0.2.0`). It is a brand-new
third-party 0.x package (`davidmokos/sandbox-cli-detector`, "Detect whether the current
process is running inside a sandboxed developer environment") and it is **required by the
Expo CLI telemetry path**:
```
node_modules/expo/node_modules/@expo/cli/build/src/utils/telemetry/Telemetry.js:80
  const sandboxProvider = getSandboxTelemetryContext();
node_modules/expo/node_modules/@expo/cli/build/src/utils/telemetry/utils/sandbox.js:12
  const data = require("sandbox-cli-detector");
```
`apk.yml` runs `npx expo prebuild --platform android --no-install` (line ~331) and sets no
`EXPO_TELEMETRY=0`. So a previously unknown package executes inside the CI prebuild step and
can contribute a "sandbox" field to Expo's CLI telemetry. Mitigations that make this LOW not
worse: no `hasInstallScript`, MIT, dev-only, never packaged into the APK. It is still new
third-party code in the CI path that the commit message does not acknowledge.

### 1.8 F6 — the locally built APK is not the artifact CI ships, CONFIRMED
`/tmp/expo-bump-android.log` exists and ends `BUILD SUCCESSFUL in 14m 16s`, 807 tasks, with
`✅ Hexagon SDK detected — enabling DSP build` and only `arm64-v8a` CMake variants. The
release APK it produced (`android/app/build/outputs/apk/release/app-release.apk`, 171 MB) has
`lib/arm64-v8a` as its only ABI directory, the three HTP skels
(`assets/ggml-hexagon/libggml-htp-v73/v75/v79.so`), and the `*_hexagon_opencl` engine
variants — so NDK (27.1.12297006, same pin as CI), Hexagon SDK version
(`~/.hexagon-sdk/6.4.0.2` locally) and the debug keystore
(`sha256 221e0a31…5e58`, byte-identical to the parent prebuild, and it is the prebuild
template key, so `adb install -r` works across local and CI builds) all line up.

What does **not** line up:
```
$ unzip -l app-release.apk | grep -i iroh
NONE — libkalsa_iroh_mobile.so NOT PACKAGED
$ ls modules/kalsa-iroh/android/src/main/jniLibs/arm64-v8a
(empty)
```
`apk.yml` builds `libkalsa_iroh_mobile.so` with `cargo ndk` and copies it into
`modules/kalsa-iroh/android/src/main/jniLibs/<abi>/` before prebuild. That step never ran
locally, so "arm64 assembleRelease EXIT=0" verified an APK with **no iroh native tunnel
library at all**. The `KalsaIrohModule` JNI side is therefore untested by the local build.
Severity LOW (the expo-module Kotlin half did compile and run through gradle), but the claim
"arm64 assembleRelease EXIT=0" should be qualified as "*without* the iroh .so".

---

## 2. Android behaviour changes in the bumped packages

Method: `npm pack` of both resolved versions of all 18 touched `expo-*` packages, then
`diff -rq`/`diff -u` over `android/`. Only the packages listed below have any Android source
change; for **expo-camera, expo-image-picker, expo-battery, expo-device, expo-asset,
expo-image-manipulator, expo-constants, expo-clipboard, expo-document-picker** the *only*
`android/` difference is `build.gradle`'s own `version`/`versionName` string
(`-version = '57.0.5'` → `+version = '57.0.6'` etc.) — **no Android behaviour change,
REFUTED for each.** Note this is a large *JS* jump for some of them
(expo-image-picker 57.0.7 → 57.0.20, 13 patches); 37 of 292 test files mock `expo-*`, so the
JS side of these bumps is exercised only by the typechecker.

### F1 — `expo-modules-core` `PromiseImpl.kt`, CONFIRMED, and the commit message mis-sells it

`node_modules/expo-modules-core/android/src/main/java/expo/modules/kotlin/jni/PromiseImpl.kt:59`
(new, 57.0.20):
```kotlin
private inline fun checkIfWasSettled(body: () -> Unit) {
  if (wasSettled) {
    return
  }
  body()
  wasSettled = true
}
```
old (57.0.8), same function:
```kotlin
if (wasSettled) {
  val exception = PromiseAlreadySettledException(fullFunctionName ?: "unknown")
  // We want to report that a promise was settled twice in the development build.
  // However, in production, the app should crash.
  if (BuildConfig.DEBUG && jsLogger != null) { ...; return }
  throw exception
}
```
Two things the commit message gets wrong:

1. **DEBUG builds already did not crash.** The old code logged and returned under
   `BuildConfig.DEBUG`. What actually changed is narrower and uglier: on the **release APK
   that CI ships**, a double-settle used to abort the process with
   `PromiseAlreadySettledException("Module.function")`; now the second settle is a no-op and
   the JS `await` hangs forever. The commit says "ignores already-settled Android promises
   rather than crashing" and presents it as a pure win, with no mention that a latent
   double-settle degrades from a named, diagnosable crash into a silent hang.
2. The `BuildConfig`, `logger` and `PromiseAlreadySettledException` imports were deleted,
   so `appContextHolder`/`fullFunctionName` are now written and never read.

**Kalsa reachability: REFUTED for Kalsa's own code.** Every `AsyncFunction` in
`modules/kalsa-iroh/android/src/main/java/expo/modules/kalsairoh/KalsaIrohModule.kt` goes
through one helper (`:126`):
```kotlin
private fun run(pool: ExecutorService, promise: Promise, operation: String, body: () -> Any?) {
  try { pool.execute { try { promise.resolve(body()) } catch (e: Throwable) { reject(...) } } }
  catch (e: Throwable) { reject(...) }   // only reachable if execute() itself threw
}
```
Resolve and reject are mutually exclusive and the outer catch requires submission failure,
so no double-settle is possible there. No `SharedObject` parameter is declared anywhere in
`modules/*/android/src`, and the only Expo packages Kalsa calls whose Kotlin promise logic
differs (`expo-file-system` legacy, `expo-notifications`, `expo-secure-store`,
`expo-speech`) changed for reasons unrelated to settling (see below).

**Failure scenario if it ever fires:** release-only, on the S23 sideload — an `await` in
`src/host/downloadNotifications.ts`, `src/pairing/*` or `src/search/secretStore.ts` never
resolves and never rejects. For `ModelDownloader.ts` specifically the 90 s stall watchdog
(`STALL_TIMEOUT_MS = 90_000`, `:249`, timer at `:416`) would eventually pause the task and
retry once, so a hang there becomes a "stalled" error rather than an infinite spinner; a hang
on a SecureStore or pairing await has no such watchdog and would sit there until the app is
killed. Severity **MEDIUM** as an unreviewed latent-class change, **LOW** as a concrete
regression today.

### F7 — `expo-file-system` legacy `readAsStringAsync`, CONFIRMED

`FileSystemLegacyModule.kt:182` (new) replaced the branchy body with:
```kotlin
val contents = getInputStream(uri, uriStr).use { inputStream ->
  readInputStreamAsString(inputStream, encoding, options)
}
```
and `getInputStream` gained `uri.scheme == null && !uriStr.isNullOrEmpty() -> openResourceInputStream(uriStr)`
(the old null-scheme branch lived inside the string branch only). New
`FileSystemLegacyReader.kt` reads the whole stream with `inputStream.readBytes()` and then
does `String(bytes, Charsets.UTF_8)`, replacing `IOUtils.toString(InputStream)`.

Kalsa uses it — every call site imports `expo-file-system/legacy`
(`src/engine/ModelDownloader.ts:2`, `src/host/useAttachments.ts:29`,
`src/host/agentTurnOptions.ts:11`, `src/screens/documents/useDocumentImport.ts:4`, …):
- Charset: old = platform default, new = explicit UTF-8. On Android these are the same.
  No change.
- Memory: the non-base64 path used to stream into a `StringWriter`; it now holds a full
  `ByteArray` **and** the resulting `String` at once. Peak grows by ~1× file size.
  `useDocumentImport.ts:247` (`readAsStringAsync(ownedUri)`) and `agentTurnOptions.ts:151`
  are the exposed reads. PLAUSIBLE, low, only reachable with a very large import.
- Base64 range reads (`length`/`position`) now loop instead of trusting a single
  `skip`/`read`, so they return *more* bytes where the old code short-read. Kalsa passes
  neither option (`PdfToImages.tsx:274`), so inert. Fix direction.
- The `uriStr = null` default is unreachable: `getInputStream` has exactly one caller
  (`:187`), which passes `uriStr`. No regression.

`FileSystemModule.kt` (the non-legacy module backing `createDownloadResumable`) is
**byte-identical** between 57.0.1 and 57.0.7, so the model-download native path is unchanged.

### F8 — `expo-modules-core` `DataPersistor.kt:118`, CONFIRMED (fix)
```kotlin
-    @Suppress("ParcelClassLoader")
-    val bundle = readBundle(null)
+    val bundle = readBundle(DataPersistor::class.java.classLoader)
```
Activity-result persistence/restore on Android — the path behind **camera, image picker,
document picker and the share intent**, all four of which Kalsa uses
(`src/host/attachFlow.ts`, `src/host/useAttachments.ts`, `src/screens/PairingQrScanner.tsx`,
`src/screens/documents/useDocumentImport.ts`, `plugins/withAndroidShareIntent.js`). A null
classloader is exactly what breaks result restoration after process death on modern Android;
passing the module's loader is a fix. Kalsa's risk is that this is an *unreviewed* change on
the picker path, not that it is wrong. Must be smoke-tested.

### F9 — `expo-notifications`, CONFIRMED (fix), 2 files
`ExpoHandlingDelegate.kt`: `getMainActivityLauncher` is now public and wrapped in
`runCatching {…}.getOrNull()` ("Some OEM ROMs throw … instead of returning null"), and
`NotificationForwarderActivity.kt:23` uses it instead of
`packageManager.getLaunchIntentForPackage`. That is the **notification-tap → open app**
path. Kalsa schedules notifications (`src/host/downloadNotifications.ts:91`
`scheduleNotificationAsync`, sticky progress on the `downloads` channel, ready/failed on
`default`) but never reads a notification response — so the changed code only matters when a
user taps one. Strictly safer.

### F10 — `expo-speech` `SpeechModule.kt`, CONFIRMED (fix)
New `TtsState` (`:23`) with an explicit failure branch at `:190`:
```kotlin
ttsState = TtsState.FAILED
delayedGetVoices.forEach { it.resolve(emptyList<VoiceRecord>()) }
delayedUtterances.forEach { sendEvent(speakingErrorEvent, idToMap(it.id)) }
```
The old file has no failure branch at all: on TTS init failure `delayedGetVoices` and
`delayedUtterances` were never flushed, so `getVoices()` stayed pending forever and queued
utterances were silently dropped. `src/voice/TtsService.ts:95` awaits
`Speech.getAvailableVoicesAsync()` and `:174` calls `Speech.speak(...)`, and **nothing in
`src/` registers a `speakingError` listener** — so after this bump a broken TTS engine
yields an empty voice list and a silent no-op read-aloud instead of a hung promise. Better,
not worse; still worth one smoke step because the user-visible failure is silent.

### F11 — `JavaCallback` `retainedValues` / `retainsJSValue()`, REFUTED as a Kalsa risk
`JavaCallback.h` gains `std::vector<jsi::Value> retainedValues` ("JS values that have to stay
alive until the promise is settled"), `MethodMetadata` gains `retainedArgIndices` /
`retainArguments()`, and `FrontendConverter` gains a virtual `retainsJSValue()`. Only
`SharedObjectIdConverter` returns `true` ("It's true for converters that pass only a
reference to Kotlin, like the shared object id"); `Poly`/`Array`/`List`/`Map`/`Any`/
`Nullable`/`ValueOrUndefined` propagate it. Kalsa declares **no** `SharedObject` parameter
anywhere (`grep -rn SharedObject modules/*/android/src` → nothing), uses only
`expo-file-system/legacy` (the `SharedObject` classes in 57.0.7 are
`FileSystemWatcher`/`FileSystemUploadTask`, new-API only), and `expo-calendar`'s
`SharedObject` classes are in the `next` API Kalsa does not call. The new machinery is
compiled into every app and never fires. Dead weight, no risk.

### F12 — `expo-modules-autolinking` Gradle plugin, REFUTED (inert)
`ExpoAutolinkingConfig.kt`: `GradlePlugin.sourceDir` becomes `String?` and a `version` field
is added ("Published plugins are resolved from a maven repository instead of an included
build"); `SettingsExtension.linkPlugin` now `return`s when `sourceDir == null`;
`ProjectExtension.linkBuildDependence` uses `plugin.classpathCoordinate`, which **throws**
`IllegalArgumentException` if a plugin declares neither. `androidResolver.js` adds
`isPureCxxDependency` and returns `cmakeListsPath = null` for those. Kalsa is unaffected:
neither `llama.rn` nor `whisper.rn` has a `react-native.config.js` and both have
`android/build.gradle`, so `isPureCxxDependency` is false for every dependency; and the
resolved configuration is identical between the two trees modulo version strings:
```
modules resolved: 29 old / 29 new — missing in new: []   extra in new: []
non-version diff lines: 0
```
(the only file-level difference was my own `/tmp/pb-old` vs `/tmp/pb-new` path prefix).

### F13 — `expo-secure-store` `deleteItemImpl`, REFUTED after checking AOSP
The rewrite looks alarming — the old code guarded every `commit()` with `contains()` and
initialised `success = true`, the new code commits unconditionally:
```kotlin
val success = removeItem(getSharedPreferences(), PreferenceManager.getDefaultSharedPreferences(reactContext),
                         key, createKeychainAwareKey(key, options.keychainService))
if (!success) throw DeleteException("Could not delete the item from SecureStore", …)
```
I expected `commit()` to return `false` for a no-op removal of an absent key, which would
have turned Kalsa's idempotent `deleteItemAsync` (`src/search/secretStore.ts:42`,
`src/engine/remote/remoteSecret.ts:30`, both guarded by an `isNotFoundError()` that does
**not** match the string `"Could not delete the item from SecureStore"`) into a user-visible
settings error. That is **wrong**. From AOSP `SharedPreferencesImpl`:
```java
public Editor remove(String key) { synchronized (mEditorLock) { mModified.put(key, this); return this; } }
// commitToMemory(): if (!mapToWriteToDisk.containsKey(k)) { continue; }   // no change recorded
// writeToFile(): if (!needsWrite) { mcr.setDiskWriteResult(false, true); return; }
public boolean commit() { … return mcr.writeToDiskResult; }               // → true
```
A no-op removal returns **true**. The two implementations are equivalent. Side effect only:
the new code creates the (empty) `SharedPreferences` XML file on a delete of an absent key.
Refuted at source and against the platform, not by assumption.

---

## 3. Config plugins and prebuild output — REFUTED, byte-identical

Two prebuilds run into `/tmp` copies of the worktree, one per parent, with the CI env var:
```
/tmp/pb-old: git archive 101c2bdd | tar -x ; npm ci ; KALSA_LLAMA_FROM_SOURCE=1 npx expo prebuild --platform android --no-install   → exit 0
/tmp/pb-new: rsync of HEAD (modules/ intact) ; cp -Rc node_modules ; same prebuild                                                                        → exit 0
```
(The first attempt at `/tmp/pb-new` used `rsync --exclude android`, which silently removed
`modules/*/android` and made autolinking look like it had dropped `kalsa-iroh`,
`kalsa-lifecycle` and `kalsa-thermal`. That was my copy bug, redone with `--exclude
/android`, and the modules are present and linked in the corrected run.)

**`diff -rq /tmp/pb-old/android /tmp/pb-new/android` → exit 0, 46 files on each side.** So
all four files asked about, plus everything else in the tree, are byte-identical:
```
app/src/main/AndroidManifest.xml   IDENTICAL
app/build.gradle                   IDENTICAL
gradle.properties                  IDENTICAL
settings.gradle                    IDENTICAL
build.gradle                       IDENTICAL
debug.keystore                     sha256 221e0a31…5e58 (identical)
```
The added `ios` block cannot reach Android: it is inside the `expo-build-properties` array
element in `app.config.js:150-154`, and `ios.enableSceneSupport` is dispatched by
`node_modules/expo-build-properties/build/iosSceneSupport.js` (`PROPERTY_NAME =
'ios.enableSceneSupport'`), whose `withMods` never registers an Android mod.

The repo's own plugins (`plugins/withAndroidShareIntent.js`, `withCalendarReadOnly.js`,
`withDebuggableRelease.js`, `withDisplayRefreshRate.js`, `withGovernorBattery.js`,
`withLintOff.js`, `withLlamaFromSource.js`, `withLoopbackCleartext.js`) use
`withAndroidManifest`, `withAppBuildGradle`, `withMainActivity`, `withInfoPlist`,
`withDangerousMod`, `AndroidConfig.Manifest.getMainActivityOrThrow`,
`AndroidConfig.IntentFilters.addIntentFilter` from `@expo/config-plugins` 57.0.6 → 57.0.9.
Of those, `build/android/Manifest.js`, `build/index.js` and
`build/plugins/withAndroidBaseMods.js` are **unchanged**. The only Android-side diff in
that package is `build/android/Package.js`, and only in two regexes that accept the Gradle
assignment form `applicationId = "…"`:
```diff
-  const pattern = new RegExp(`(applicationId|namespace) ['"].*['"]`, 'g');
+  const pattern = new RegExp(`(applicationId|namespace)(\\s*=\\s*|\\s+)['"].*['"]`, 'g');
-  const matchResult = buildGradle.match(/applicationId ['"](.*)['"]/);
+  const matchResult = buildGradle.match(/applicationId\s*=?\s*['"](.*)['"]/);
```
No Kalsa plugin imports `Package`, and the identical prebuild output proves
`applicationId`/`namespace` did not move. `@expo/prebuild-config` 57.0.10 → 57.0.16 changes
only `build/plugins/withDefaultPlugins.js` (iOS plugin wiring). **REFUTED: no plugin
depends on changed `@expo/config-plugins` internals; prebuild output does not differ beyond
versions — it does not differ at all.**

---

## 4. Verification claims in the commit message vs reality

Commit message, verbatim:
> `Verified: tsc EXIT=0; Jest 292 suites / 3042 tests EXIT=0; engine provenance EXIT=0; Android prebuild EXIT=0; arm64 assembleRelease EXIT=0.`

| Claim | Verdict | Evidence |
|---|---|---|
| `tsc EXIT=0` | **TRUE** | `npx tsc --noEmit` → `TSC EXIT=0`, empty output |
| engine provenance `EXIT=0` | **TRUE** | `scripts/assert-engine-provenance.sh` → exit 0, 1154 files match `Aspis0/kalsa.rn@7c12bdc6ac5f` |
| Android prebuild `EXIT=0` | **TRUE** | `npx expo prebuild --platform android --no-install` at HEAD → exit 0 |
| arm64 `assembleRelease EXIT=0` | **TRUE but partial** | `/tmp/expo-bump-android.log` exists, `BUILD SUCCESSFUL in 14m 16s`, 807 tasks, arm64-v8a only, Hexagon DSP enabled — but the APK has **no `libkalsa_iroh_mobile.so`** (F6) |
| Jest `292 suites / 3042 tests EXIT=0` | **NUMBERS TRUE, `EXIT=0` NOT REPRODUCIBLE** | see F2 |
| `npm ci` | **not claimed, and not comparable** | lockfile was generated with npm 11.16.0 / node 26.3.0; `apk.yml` uses `actions/setup-node@v4 node-version: 20` (npm 10.x). npm 11 blocked install scripts locally (`npm warn allow-scripts … unrs-resolver@1.12.2 (postinstall: node postinstall.js)`); npm 10 does not. Neither affects the APK (`unrs-resolver` is a dev transitive), but local `npm ci` is not the CI `npm ci`. |

### F2 — the Jest claim, CONFIRMED as a gap
The quoted totals are exactly right and reproduce on **both** parents:
```
HEAD (c1f8087b) : Test Suites: 1 failed, 291 passed, 292 total
                  Tests:       1 failed, 3041 passed, 3042 total
parent(101c2bdd): Test Suites: 1 failed, 291 passed, 292 total
                  Tests:       1 failed, 3041 passed, 3042 total
failure on both: src/screens/PairingScreen.test.ts › "an edit stops the abandoned poll's probes at once"
                 expect(before).toBeGreaterThan(expected)  Expected: > 2  Received: 2
                 at src/screens/PairingScreen.test.ts:1039
```
In isolation the same test passes (`Tests: 32 skipped, 1 passed, 33 total`), so this is a
timing-sensitive assertion, not a regression from the bump — and `ci.yml:43` runs
`npx jest --runInBand`, which is why the writer plausibly saw green. I am not calling this a
regression. I am calling the commit message wrong in kind: it states an exit status it could
not have obtained from the run that produced those numbers, and the suite it leans on has a
load-sensitive poll-count assertion (`expect(before).toBeGreaterThan(2)`) that can redden a
loaded `runInBand` runner. Severity LOW-MED: the claim is the kind of thing that stops being
checked once it is in a commit message.

---

## 5. Commit message: not true and not complete

Required but missing:
1. **The added direct dependency.** `package.json:33` is a `+` line:
   `"expo-constants": "~57.0.20",`. It is not a bump — it is a **new** direct dependency
   (49 → 50 deps). It is *correct* (`src/screens/SettingsScreen.tsx:16`,
   `src/engine/engineIdentity.ts:56`, `src/telemetry/telemetry.ts:187` all import
   `expo-constants`, and it was previously satisfied only by hoisting a transitive), so this
   is a latent-bug fix, but it is undisclosed scope in a message that says "bump Expo 57
   patches". The 22 changed `package.json` lines are 21 re-pins + 1 addition, not 22 bumps.
2. **The transitive MINOR bump** of `expo-modules-jsi` 57.0.4 → 57.1.1, forced by
   `expo-modules-core` 57.0.20's `~57.1.1` (F4). Android-irrelevant, but "patch line" is not
   literally true and a reviewer asking "did anything move MAJOR or MINOR?" deserves the
   answer in the message.
3. **The new third-party package** `sandbox-cli-detector@0.2.0`, which the Expo CLI loads
   during telemetry inside the CI prebuild step (F5).
4. **The cost of the `PromiseImpl` change.** It says "ignores already-settled Android
   promises rather than crashing (expo/expo#46770)". True. Missing: that DEBUG already
   didn't crash, that the release behaviour goes from a named crash to a **silent hang**, and
   that Kalsa's own modules provably cannot double-settle
   (`KalsaIrohModule.kt:126`), so the change buys nothing measurable here.
5. **Base and scope precision.** The base is in the subject line (`HEAD 101c2bdd`) — good —
   but `ios.enableSceneSupport` being in a *dependency-bump* commit is unremarked. It is not
   inert: `expo-build-properties` 57.0.8 has **no** `iosSceneSupport.js` and no
   `enableSceneSupport` in its `pluginConfig`; the property arrives in the bumped line
   (`expo-build-properties/CHANGELOG.md`: "Add `ios.enableSceneSupport` to adopt the UIKit
   scene lifecycle in SDK 57 projects … no-op on SDK 58 and newer",
   expo/expo#50205; plus #50221). That is the real reason for the bump and it is stated as a
   side effect rather than as the motivation.
6. **Qualification of the Android build** — no iroh `.so` locally (F6), arm64-v8a only, and
   no `npm ci` on CI's toolchain.

---

## 6. Galaxy S23 smoke checklist (hand this to the app-chain owner)

Install CI's `apk.yml` artifact with `adb install -r` (same debug keystore — never uninstall;
that deletes the `.kvs` session store). Build with `workflow_dispatch`, `abi=arm64-v8a`,
`debuggable=false`. Then:

**A. Engine load / unload — the core chain**
1. Load a model to completion; confirm TTFT and that the engine reports the expected build id
   (`engineIdentity` reads `expo-constants` `extra`, which this commit promoted to a direct
   dependency — confirm it is populated).
2. Unload the model, then load a *different* model. Repeat 3×. Watch for a hang rather than a
   crash: with `PromiseImpl` no longer throwing, a double-settle shows as a **stuck spinner**,
   not a stack trace. If a load spinner never resolves, check logcat for
   `Trying to resolve promise that was already settled` — note the message is now **absent**
   from release builds, so its absence proves nothing.
3. Force a thermal pause mid-generation (kalsa-thermal + the governor), confirm it pauses and
   resumes rather than wedging.

**B. Hexagon / DSP path**
4. Confirm the APK really carries the HTP assets (`unzip -l app-release.apk | grep ggml-hexagon`
   → `libggml-htp-v73/v75/v79.so`) and that a prefill completes. A wrong skel set hangs HTP
   prefill (the 2026-09 `dspqueue` hang) — that is the failure the CI skel gate exists for.
5. Run one long generation and watch for an ANR or a lib`rnllama_*_hexagon_opencl` fallback to
   CPU: the Hexagon OpenCL variant is in the APK, the local build cannot prove it works.

**C. Model download — the highest-value path**
6. Download a real multi-GB GGUF + mmproj. Confirm progress notifications on the `downloads`
   channel (`sticky`, low importance), the ready notification on `default`, and that the
   progress line disappears afterwards (`dismissNotificationAsync`).
7. **Force a stall and kill the app mid-download, then resume.** This exercises
   `createDownloadResumable` + `AsyncStorage` resume data (`ModelDownloader.ts:367`) and the
   90 s stall watchdog (`:249`, `:416`). Assert: resume continues from the saved offset, the
   final SHA-256 sidecar verifies, and no "incomplete bytes" loop.
8. Abort a download with the UI cancel button while it is stalled — the `onAbort`/`pausing`
   interaction is the part most likely to expose a promise that resolves twice.
9. Airplane-mode mid-download, then back: confirm you get a localized `stalled`/`failed`
   message, **not** an infinite spinner.

**D. Attachments and camera — `DataPersistor` classloader change (F8)**
10. Open the attachment picker, pick an image from Files, confirm it lands and renders.
11. Open the camera, take a photo, confirm the result comes back. **Then force the risky
    path: enable "don't keep activities" in Developer options, take a photo, let the process
    be killed, restore, and confirm the result is still delivered.** `readBundle(null)` →
    `readBundle(classLoader)` exists precisely for this restore.
12. Import a PDF (`expo-document-picker` → `readAsStringAsync`, the F7 byte-array change) and
    a `.docx`. Watch memory; a large import now peaks one extra file-size in bytes. Confirm
    `PdfToImages` still produces page images (`readAsStringAsync` Base64, `:274`).
13. Share into Kalsa from another app (`plugins/withAndroidShareIntent.js` → the same
    activity-result path).

**E. Secure store and pairing**
14. Settings → clear the API-key field of a provider that **never had a key saved** (the
    `isNotFoundError` path, `secretStore.ts:42`). Must be silent.
15. Set a key, restart the app, confirm it survives; delete it, confirm it is gone.
16. Pairing install id (`pairingInstallId.ts:23`) and the remote-brain token
    (`remoteSecret.ts:30`): set, kill, relaunch, clear.

**F. Notifications**
17. Let a download finish with the screen off and the app backgrounded; confirm the ready
    notification arrives with the right channel.
18. **Tap it** — this is `NotificationForwarderActivity` + the reworked
    `getMainActivityLauncher` (F9). Confirm the app comes to the foreground and the download
    screen is the one that opens. Then dismiss the sticky progress line from the shade.
19. Revoke POST_NOTIFICATIONS in settings, start a download, confirm one permission prompt at
    most and no repeat prompts.

**G. Read aloud (`expo-speech` F10)**
20. Read a message aloud. Confirm actual audio on the S23 and that the stop button works. If
    audio is missing there is now **no error** — `speakingError` has no listener in `src/` —
    so "nothing happens" is a legitimate failure mode to report, and the voice list will be
    empty. Check `adb shell cmd texttospeech` availability if in doubt.

**H. iroh / remote tunnel**
21. Do this on the **CI** APK only. The local artifact is missing
    `libkalsa_iroh_mobile.so` (F6), so the local build proved nothing here. Exercise
    `startBridge` → `nodeId` → `openTunnel` (desk lane) → `write`/`read` → `shutdown`; confirm
    each settles exactly once and that a destroyed-module race
    (`KalsaIrohModule.kt:76-81`) still surfaces as a rejection.

**I. Negative control**
22. Before installing the new APK, record `main`-built behaviour for steps 1, 6, 7, 11 and 21.
    Every finding above is a *behaviour-preserving or behaviour-improving* diff; if a step
    fails on the new APK and passed on main, that is a real regression this audit did not
    predict, and it is the whole point of the smoke.
