# Hostile audit — landing `ios/first-build` on `main` (Android parity)

Auditor pass. Read-only. No file in `~/Projects/kalsa-ios` was modified
(`git status --porcelain` empty before and after, `git stash list` empty,
HEAD `17c7e564`, no devices touched). All mutation experiments ran in a throwaway
`git clone` under `/tmp` with `node_modules` symlinked back, then the clone was
deleted. `export PATH=/opt/homebrew/opt/node@22/bin:$PATH` was set per command;
no env var was mutated, nothing was exported outside a single shell.

Scope: `git -C ~/Projects/kalsa-ios diff origin/main...HEAD` at `17c7e564`
(28 files, +1421/−56). Note the diff is three-dot, so it is taken from the merge
base `2e7b4dfd`; `origin/main` has since advanced to `7ec12eb0` (9 commits)
with **zero file overlap** with the branch (see "Landing" §7).

Executed, with real exit codes:

| command | exit |
|---|---|
| `npm run typecheck` (`tsc --noEmit`) | 0 |
| `npx jest` on the 8 touched suites (82 tests) | 0 |
| `bash scripts/assert-engine-provenance.sh` | **1** (`differing entries: 34`) |
| `npx expo prebuild --platform android --no-install` on `2e7b4dfd` and on `17c7e564` | 0 / 0, `diff -r` of the two `android/` trees **empty** (46 files each) |

## Verdict table

| # | area | finding | verdict |
|---|---|---|---|
| 1.1 | Android runtime | every shared-TS change is gated on iOS; no Android input produces a different value | CONFIRMED clean |
| 1.2 | Android runtime | `appleDeviceClassForModelId` is called on all platforms but is inert on Android (`Device.modelId === null` by construction) | CONFIRMED clean |
| 1.3 | Android build | Android `prebuild` tree byte-identical to main | CONFIRMED clean |
| 1.4 | cost/jest | `zeroAvailableMemoryIsReal()` cannot be reached with a non-zero input; under this jest config it always returns `false` | CONFIRMED clean |
| 1.5 | Android risk | no `Platform.OS` guard inside `appleDeviceClass.ts`; the `Mac*` prefix rule is one expo-device change away from classifying an Android device as an Apple Silicon Mac | PLAUSIBLE (low) |
| 1.6 | iOS | the Apple **RAM** fallback is unreachable in production (`totalMemory` is never null on iOS) — only `chipClass` is live | CONFIRMED dead-in-production |
| 1.7 | docs | "the iOS read is NEVER cached" is true for the reader, false for the profile (process-cached, 9 callers) | CONFIRMED overstatement |
| 2.1 | CI | `assert-engine-provenance.sh` diff is 7 comment lines, zero logic | CONFIRMED clean |
| 2.2 | CI | the DIVERGENT gate is impossible in CI (10 jobs, all `ubuntu-latest`, no `pod install`) | CONFIRMED |
| 2.3 | docs | the human runbook still records the gate as exit 0 / "1154 files match" and never mentions the pod-install ordering | CONFIRMED gap |
| 2.4 | iOS | injected comment "Every supported dev Mac is Apple Silicon" is false — Xcode 26 ships an Intel-capable Universal build | CONFIRMED |
| 2.5 | iOS | `Array(build_settings[key]) \| ['x86_64']` silently mis-handles a space-separated String value | PLAUSIBLE (low) |
| 3.1 | privacy | neither Swift module logs anything; no id/memory number is logged on device | CONFIRMED clean |
| 3.2 | privacy | telemetry sends only a bucketed `memoryClass`; no new device attribute becomes reachable | CONFIRMED clean |
| 4.1 | Swift | `observerToken` is mutated from the background `expo.modules.AsyncFunctionQueue` **and** from `ModuleHolder.deinit` | CONFIRMED data race (low impact) |
| 4.2 | Swift | the `.main` observer comment states two things Apple/Expo do not guarantee | CONFIRMED inaccurate |
| 4.3 | iOS JS | `useThermalMonitor` awaits the same native call that `platformThermalStatus` wraps in a 1 s timeout, with no timeout | CONFIRMED inconsistency |
| 4.4 | iOS JS | iOS thermal status commits without the hysteresis the Android path applies | CONFIRMED asymmetry (cosmetic) |
| 4.5 | iOS | iPad-on-Mac is not covered by the simulator `#if`, and it is the destination the release evidence was taken on | PLAUSIBLE (medium, iOS-only) |
| 5.1 | tests | removing the scoping fails 7 tests in 4 suites | CONFIRMED load-bearing |
| 5.2 | tests | the iOS-side pins are load-bearing too (3 separate mutations each caught) | CONFIRMED load-bearing |
| 5.3 | tests | `appleDeviceClass.test.ts` "unmapped identifiers" assertions are tautologies | CONFIRMED decorative |
| 5.4 | tests | the Android no-fallback pin uses `"SM-S911B"`, an input expo-device never produces on Android | CONFIRMED unrepresentative |
| 5.5 | coverage | `getOsAvailableMemoryBytes` (the JS validation wrapper) has zero coverage and is structurally uncoverable (`jest.config.js:5` roots) | CONFIRMED gap |
| 6.1 | commits | `7bceff40`'s message documents `package.json` work that is not in the commit and already exists on main | CONFIRMED |
| 6.2 | commits | `a54ec315`'s message advertises a postinstall and a trimMemory event that `f98c4304` deleted | CONFIRMED stale |
| 6.3 | docs | `MAC-RELEASE-RUN.md` still says "5 iOS commits" and "7 suites / 63 tests"; HEAD is 6 commits / 8 suites / 82 tests | CONFIRMED stale |
| 6.4 | code | `gen-metal-embed.js` is a faithful port of the engine's own CMake flatten (verified against the vendored tree) | CONFIRMED correct |

---

## 1. Android behaviour change

I found **no** shared runtime path where Android computes a different value than
`origin/main`, for any input. The evidence, site by site.

### 1.1 Every gate comparison is iOS-scoped — CONFIRMED clean

`src/engine/memoryEstimate.ts:207-215` (new):

```ts
export function zeroAvailableMemoryIsReal(): boolean {
  try {
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    return Platform.OS === "ios";
  } catch {
    return false;
  }
}
```

Six call sites, all shaped `x > 0 || (x === 0 && zeroAvailableMemoryIsReal())`, so
the `require` runs only when the value is *literally* 0:

- `src/engine/memoryEstimate.ts:223` (`fitMemoryEstimate`)
- `src/engine/deviceProfile.ts:194` (`modelGateVerdict` comparison) and `:224` (`memoryKnown`)
- `src/engine/deviceProfile.ts:391` (`evaluateModelFit`)
- `src/engine/modelGateRAM.ts:111` (`gateOptionFit`)
- `src/host/engineGateHelpers.ts:174` (`profileWithFreshMemory`)

On Android the second disjunct is always `false`, so each expression reduces to
`origin/main`'s `x > 0`. NaN/negative/`null` inputs were already excluded by the
preceding `typeof`/`isFinite` guards, so no third case moved. Cost per call is
therefore not a hot-path concern: a positive budget never enters the function.

**Under jest** the function returns `false` unconditionally in this repo's config.
`jest.config.js:3-4` sets `testEnvironment: "node"` with no `preset: "react-native"`,
and node_modules files are not transformed, so `require("react-native")` throws.
Proven with a throwaway probe test in the `/tmp` clone:

```
DIRECT_REQUIRE: {"ok":false,"err":"SyntaxError: Cannot use import statement outside a module"}
ZERO_IS_REAL: false
```

So every pre-existing suite keeps `origin/main` semantics even if it never mocks
Platform — no hidden test-level behaviour change, and no Node harness
(`scripts/*Harness.mjs`) is affected.

### 1.2 The readers keep their Android behaviour — CONFIRMED clean

`src/engine/memoryEstimate.ts:323-336`:

```ts
export async function getAvailableMemoryBytes(): Promise<number | null> {
  try {
    const { Platform } = require("react-native") as { Platform: { OS: string } };
    if (Platform.OS === "ios") { … return await getOsAvailableMemoryBytes(); }
    if (cachedAvailableBytes !== undefined) return cachedAvailableBytes;
    if (Platform.OS !== "android") { cachedAvailableBytes = null; return null; }
```

`origin/main` had the cache check *before* the `require`; the branch moved it
inside. The only observable difference would be a `require` that throws after the
cache was populated — impossible, since the cache is only written inside the same
`try`. Android `/proc` parsing is untouched.

`src/engine/monitor.ts:66-73`: the iOS branch is inserted before the untouched
`if (Platform.OS !== "android") return null;` at `:73`. `readProcessMemorySample`
(`monitor.ts:122`) still returns `empty` off Android, unchanged.

`src/hooks/useThermalMonitor.ts:139` — the iOS block sits *after* the Android
sysfs block and inside the same `try`, and both Android blocks are byte-identical
to main.

### 1.3 `appleDeviceClass` fallbacks are inert on Android — CONFIRMED clean

`src/engine/deviceProfile.ts:654` calls `appleDeviceClassForModelId(modelId)` with
**no platform guard**. It is still inert on Android, because `modelId` can never
be non-null there: expo-device's Android module defines `modelName`, `designName`
and `productName` but no `modelId` constant
(`node_modules/expo-device/android/src/main/java/expo/modules/device/DeviceModule.kt:50`
is `Build.MODEL` under `Constant("modelName")`), and the JS wrapper normalizes it:

```
node_modules/expo-device/build/Device.js:38
 * Device.modelId; // iOS: "iPhone7,2"; Android: null; web: null
node_modules/expo-device/build/Device.js:42
export const modelId = ExpoDevice ? ExpoDevice.modelId || null : null;
```

With `modelId === null`, `appleClass` is `null`, so `deviceProfile.ts:683`
(`totalMemoryBytes ?? appleClass?.ramBytes ?? null`), `:690`, `:692`
(`socModel: socModel ?? appleClass?.chipClass ?? null`) and `:698`
(`ramTier: getRamTier(reportedTotalMemoryBytes)`) all reduce to main's expressions.

### 1.4 Android build graph — CONFIRMED clean

- `app.config.js:160` adds `./plugins/withLlamaIosSourceBuild`. It is
  `withPodfile`, i.e. `withMod({platform: 'ios', mod: 'podfile'})`
  (`node_modules/@expo/config-plugins/build/plugins/ios-plugins.js:180-188`), so
  the mod is never compiled for an Android prebuild.
- `plugins/withLlamaFromSource.js` (unchanged) is `withGradleProperties`, so the
  two plugins do not contend.
- Proven end to end: `npx expo prebuild --platform android --no-install` in clean
  clones of `2e7b4dfd` and `17c7e564` → both exit 0, 46 files each,
  `diff -r -q` between the two `android/` trees prints nothing.
- `modules/kalsa-lifecycle/expo-module.config.json` now lists
  `"platforms": ["android","apple"]` but keeps the `android.modules` entry, so
  Android autolinking is unchanged.
- The two new `require("../../modules/kalsa-lifecycle/src")` calls
  (`memoryEstimate.ts:328`, `monitor.ts:68`) add no Android module: that path was
  already in the graph via `src/platform/backgroundTimer.ts:14`.
- `package.json` is byte-identical to main (`git diff origin/main...HEAD --
  package.json` is empty) → no lockfile or dependency-graph risk.
- `.gitignore:129-131` is **correct and necessary**: a blanket `ios/` rule exists at
  `.gitignore:43`, and git will not re-include files under an excluded directory,
  so the directory-level negation `!modules/*/ios/` must precede
  `!modules/*/ios/**`. Verified: `git check-ignore -q
  modules/kalsa-lifecycle/ios/NEW.swift` → exit 1 (not ignored). A new `.swift`
  file will be committable.

### 1.5 The one Android-reachable hazard — PLAUSIBLE (low)

`src/engine/appleDeviceClass.ts:97`:

```ts
  if (id.startsWith("Mac")) {
    return { chipClass: "Apple Silicon", ramBytes: EIGHT_GIB };
  }
```

There is no `Platform.OS === "ios"` check anywhere in `appleDeviceClass.ts`, and
`deviceProfile.ts:654` calls it on every platform. The only thing preventing an
Android device from being reported as an Apple Silicon Mac with 8 GiB is the
expo-device fact quoted in §1.3. That is an external dependency's accident, not an
invariant this branch asserts. One `if (Platform.OS !== "ios") return null` at the
call site would make it structural.

### 1.6 The Apple RAM fallback cannot fire in production — CONFIRMED dead code

`deviceProfile.ts:683` uses `appleClass?.ramBytes` only when `totalMemoryBytes` is
null. `totalMemoryBytes` comes from
`asNullablePositiveNumber(Device?.totalMemory)` (`deviceProfile.ts:647`) and on iOS
that constant is:

```
node_modules/expo-device/ios/DeviceModule.swift:33-35
    Constant("totalMemory") {
      ProcessInfo.processInfo.physicalMemory
    }
```

which is always positive, so never null. Therefore on a real iPhone/iPad the
12 GiB/8 GiB table contributes **only** `chipClass`; the RAM column and the
"ONE reported RAM value" fix at `:683`/`:698` are reachable only in jest (where
`totalMemory` is mocked to null). `deviceProfile.test.ts:70-84` ("feeds the tier
from the SAME fallback bytes", "the old bug: … the same 12-GiB device gated as
low") therefore pins a state no device produces. Defensive, harmless — but the
test comment advertises a production bug that cannot happen.

### 1.7 "NEVER cached" is true of the reader, false of the profile — CONFIRMED

`src/engine/memoryEstimate.ts:310-313`:

```
 * device-wide; callers needing fresh values use monitor.ts). The iOS read is
 * NEVER cached: Apple documents os_proc_available_memory as a rapidly
 * changing per-process budget and says not to cache it.
```

`src/engine/deviceProfile.ts:710-732` caches the whole profile — including
`availableMemoryBytes` — in a module-level `cachedProfilePromise` with no TTL, and
has **9** direct callers against **2** for `profileWithFreshMemory`. So a stale
positive jetsam reading taken at first profile build still reaches
`engineEnsure.ts:133`, `engineEnsureLoad.ts:117`, `engineGateHelpers.ts:137` and
`LlamaService.ts:2384`. Apple's doc says "Caching the result is not advised" and
the branch quotes that line; the profile cache is the same cache by another name.

## 2. Android build / CI

### 2.1 `assert-engine-provenance.sh` — comment only — CONFIRMED

The diff is 7 added lines, all beginning `#`, inside the comment block above
`manifest()` (`scripts/assert-engine-provenance.sh:30-36`). Filtering the diff for
`^[+-]` lines that are not `+++`/`---`/comments yields nothing. No behaviour,
no exit-code path, no new env flag, no allowlist.

### 2.2 The 34-file DIVERGENT — measured, documented, impossible on CI — CONFIRMED

Run on this machine (which has run `pod install`):

```
[provenance] lockfile pins Aspis0/kalsa.rn@6b87db167a8f
[provenance] DIVERGENT: the installed engine is not Aspis0/kalsa.rn@6b87db167a8f
[provenance] first differing path: ./vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-embed-argsort.s
[provenance] differing entries: 34
```

Exit 1, exactly the 34 files `gen-metal-embed.js` writes. I confirmed the count
independently: parsing `GGML_METAL_LIBS` out of
`node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-device.m`
with the same regex the script and the Podfile guard use yields 34 kinds, and
`ls` of that directory shows exactly 34 `ggml-metal-embed-*.s` — no missing, no
extra. The generator's own output agrees with the Podfile guard's expectation.

Documentation is present in two places that cross-reference each other:
`scripts/assert-engine-provenance.sh:30-36` and
`plugins/withLlamaIosSourceBuild.js:19-25`. The remedy named there ("Prove the pin
itself in a fresh `npm ci` tree") is real and works.

Impossible on CI — CONFIRMED. All ten workflow jobs are `runs-on: ubuntu-latest`
(`apk.yml:43`, `bench.yml:89,231,1094`, `build-kalsa-apk.yml:20`, `ci.yml:26`,
`dflash-ab.yml:20`, `download-repro.yml:18`, `e2e-emulator.yml:33`, `screens.yml:19`);
no workflow mentions `macos`, `pod install`, or `gen-metal-embed`. A Linux runner
doing `npm ci` never runs the generator, so the fresh tree stays pristine.

### 2.3 The human runbook is stale — CONFIRMED

`MAC-RELEASE-RUN.md:331` records `bash scripts/assert-engine-provenance.sh` →
**0**, "1154 files match". The recorded order in that same table puts the gate
*before* `npx expo prebuild --platform ios --clean` and `pod install` at rows
below it — which is the only reason it passed. After a build the same command
exits 1 with a message that reads like tampering, and there is no `--allow` or env
escape. Nothing in the runbook tells the next operator that. Same file, line 319:
"Branch = 5 iOS commits" (HEAD has six) and line 333: "targeted jest, 7 suites …
63/63" (the sixth commit added `src/host/engineGateHelpers.test.ts`; the eight
touched suites are 82 tests).

### 2.4 `Every supported dev Mac is Apple Silicon` — CONFIRMED false

`plugins/withLlamaIosSourceBuild.js:71-72` justifies dropping the x86_64 simulator
slice with:

```
    # `_generic` references at link. Every supported dev Mac is Apple Silicon,
    # which runs the arm64 simulator natively, so that slice is dead weight
```

Xcode 26 ships a Universal build that "runs on Apple silicon and Intel Macs"
(9to5Mac, 2025-08-05, on the Xcode 26 beta 5 download split); Xcode 26.4 requires
macOS Tahoe 26.2, which still runs on Intel. On an Intel dev Mac this injection
removes the only simulator slice the machine can execute. No Intel Mac is in the
lab, so this is a comment that states a false invariant as a design
rationale — and the rest of the change (build time) is real.

### 2.5 `Array(...)` on a possibly-string build setting — PLAUSIBLE (low)

`plugins/withLlamaIosSourceBuild.js:81`:

```ruby
    build_settings[excluded_archs_key] = Array(build_settings[excluded_archs_key]) | ['x86_64']
```

`Array("i386 x86_64")` is `["i386 x86_64"]`, so a space-separated String value
(the form xcconfig/pbxproj can carry) yields `["i386 x86_64", "x86_64"]` — two
bogus arch names. The failure mode is that the exclusion silently does nothing
(the pre-existing dangling-`_generic` link error returns), not a new break.

### 2.6 Things that are *not* problems — CONFIRMED clean

- `POST_INSTALL_ANCHOR = "  post_install do |installer|\n"`
  (`withLlamaIosSourceBuild.js:65`) matches the pinned SDK 57 template exactly
  (`expo/template.tgz:package/ios/Podfile:59`). If Expo re-indents, prebuild
  throws loudly (`withLlamaIosSourceBuild.js:94-99`) — by design.
- `system('node', …)` adds no new PATH dependency: the generated Podfile already
  requires node on lines 1-2 (`node --print "require.resolve('expo/package.json')"`).
- Deployment targets line up: `app.config.js:18` `deploymentTarget: "16.4"`,
  template default `'16.4'` (Podfile:23), both podspecs
  `s.platforms = { :ios => '16.4' }`.
- New CI surface is six new test files plus two modified ones, picked up by
  `ci.yml:43` (`npx jest --runInBand`) and four other workflows. They pass
  (82/82, ~7 s added). No workflow file is touched by the branch.
- `npm run typecheck` exits 0 — the widened `source` union
  (`thermalThresholds.ts:155`) does not break `toGovernorHint`, whose `source`
  parameter is `string` (`thermalThresholds.ts:177`).

## 3. Security / privacy

### 3.1 Nothing logged on device — CONFIRMED clean

Neither Swift module contains `os_log`, `print`, `NSLog` or any `Logger` usage
(`KalsaThermalModule.swift`, `KalsaLifecycleModule.swift` read in full). The
lifecycle module returns one `Int64`; the thermal module returns a
`[String: Any]` with `platform`/`supported`/`state` only. No identifier, model id,
path, URL or memory number is written anywhere by the branch.

The only new stdout is `scripts/gen-metal-embed.js:214` — a kind count and a
relative directory name, on the developer's machine during `pod install`. No
device data, nothing that leaves the machine.

### 3.2 Telemetry surface unchanged — CONFIRMED clean

The one attribute the branch could have moved is the RAM class:
`src/telemetry/telemetry.ts:931` and `:996` send
`memoryClassFromBytes(ctx.totalMemoryBytes)`, which is bucketed
(`<4gb`, `4-6gb`, …, `unknown` — `src/telemetry/pure.ts:62-78`). Even in the
hypothetical where the Apple fallback fired, that is a coarse bucket, not bytes,
not an id. And per §1.6 it cannot fire anyway. No new data leaves the device.

### 3.3 Bridge surface — CONFIRMED acceptable

`Function("availableMemoryBytes")` is a synchronous Expo function, i.e. it runs
inline on the JS thread (`SyncFunctionDefinition`), which is correct for
`os_proc_available_memory()`: a cheap `gettaskinfo`-class call, and the JS caller
is already `await`ing. `modules/kalsa-lifecycle/src/index.ts:135-148` validates
`typeof`, `Number.isFinite`, `value < 0` and try/catches, so a malformed or
negative native read becomes `null` = unknown, preserving the fail-open contract.

## 4. Bugs, races, leaks in the Swift modules and the iOS JS paths

### 4.1 `observerToken` data race — CONFIRMED (low impact)

`modules/kalsa-thermal/ios/KalsaThermalModule.swift:20`:

```swift
  private var observerToken: NSObjectProtocol?
```

is mutated from two different threads:

- `startObservingThermalState()` / `stopObservingThermalState()`, called by
  `OnStartObserving` / `OnStopObserving` (`:32`, `:37`). Expo wraps those in
  `AsyncFunctionDefinition`, whose default queue is a background serial queue:
  `node_modules/expo-modules-core/ios/Core/Functions/AsyncFunctionDefinition.swift:20`
  (`private let defaultQueue = DispatchQueue(label: "expo.modules.AsyncFunctionQueue", …)`)
  used at `:138` when no `queue:` is given.
- `OnDestroy` (`:39-41`), which Expo posts from
  `node_modules/expo-modules-core/ios/Core/ModuleHolder.swift:175-177`:

  ```swift
  deinit {
      module.willDestroy()
      post(event: .moduleDestroy)
  }
  ```

  `deinit` runs on whichever thread releases the last reference, not on
  `expo.modules.AsyncFunctionQueue`.

A non-atomic Swift stored property written from two queues is a data race: a
lost update leaves a NotificationCenter registration alive after a JS reload (the
block holds `[weak self]`, so it degrades to a no-op, not a use-after-free), or a
double `removeObserver`. No lock, no `@MainActor`, no queue annotation. A lock
around the two accessors, or routing all three lifecycle hooks onto one queue,
would close it.

### 4.2 The `.main` observer comment states two unverified facts — CONFIRMED

`KalsaThermalModule.swift:44-46`:

```swift
    // .main: thermalStateDidChangeNotification posts on the main thread, and
    // sendEvent must not race the JS event emitter off it.
```

Apple does not document a posting thread for
`ProcessInfo.thermalStateDidChangeNotification`, and Expo's `sendEvent`
(`expo-modules-core/ios/Core/Modules/Module.swift:25-27`) is thread-safe by
construction — `OnStartObserving` itself already calls `self.sendEvent` from the
background queue three lines above. Pinning to `.main` is a fine choice; the
justification as written is fiction. (The *other* new comment in the same class —
`:13-16`, that `Module` does not inherit `NSObject` so `#selector` cannot compile
— is **correct**: `AnyModule: AnyObject, AnyArgument` in
`Core/Protocols/AnyModule.swift:4` and `open class BaseModule` in
`Core/Modules/Module.swift:10`.)

### 4.3 Unbounded native call in the monitor — CONFIRMED inconsistency

`src/hooks/useThermalMonitor.ts:139` awaits `getCurrentPlatformThermalState()` with
no bound. The identical native call in the hard-gate reader is bounded:

`src/engine/platformThermalStatus.ts:137-146` →
`withNativeCallTimeout(getCurrentPlatformThermalState(), GOVERNOR_STATUS_READ_TIMEOUT_MS /* 1_000 */, …)`.

If the native read ever hangs, `sample()` never returns while `setInterval`
(`useThermalMonitor.ts:174-176`) keeps starting new ones — unbounded pending
samples on a UI hook. iOS-only, and the current native implementation cannot
hang, so this is consistency debt, not a live bug.

### 4.4 iOS thermal status skips hysteresis — CONFIRMED (cosmetic)

The Android path classifies with
`statusFromTempC(tempC, {prevStatus, prevSource, source: "sysfs"})`
(`useThermalMonitor.ts:127-133`), which damps flapping. The iOS branch commits the
raw mapped status (`useThermalMonitor.ts:141-149`) with no hysteresis, so the
advisory banner can move ok↔warm↔hot frame to frame while Android is damped. The
comment at `:82-84` explains the ref mechanism as if it covered both paths.

### 4.5 iPad-on-Mac is the uncovered target — PLAUSIBLE (medium, iOS-only)

`db0fff3a` fixed exactly this failure: a spurious 0 "fail-closed every model load
(blocked_ram, 'Not running here' pill and a permanently held composer)", and did
so under `#if targetEnvironment(simulator)` only
(`KalsaLifecycleModule.swift:38-40`). The iPad-on-Mac ("Designed for iPad")
destination has `TARGET_OS_SIMULATOR == 0`, is therefore not covered, and — per
the module's own header at `:16-19` — is "unmeasured". Apple's doc gives the
plausible mechanism: `os_proc_available_memory` returns 0 "if the calling process
isn't an app". That is exactly the destination
`MAC-RELEASE-RUN.md:341` records a successful Release build for. Three comments
document the gap; nothing mitigates it.

### 4.6 The generator is a faithful port — CONFIRMED correct

I checked `scripts/gen-metal-embed.js` against the vendored engine's own definition
(`node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal/CMakeLists.txt`):

- kinds: 34 parsed, 34 `.s` present, exact match (see §2.2).
- header prepend order matches CMake's `HEADERS_FOR_SRC` (common.h, then the
  optional headers, each gated on the *kernel's own* `#include`, which is what
  `file(STRINGS ${SRC} … REGEX …)` does) — `gen-metal-embed.js:66-73,111-120`.
- drop list matches the sed `-e '/#include …/d' -e '/#pragma once/d'` set.
- the `__embed_ggml-common.h__` and `#include "ggml-metal-impl.h"` inlining matches
  `sed -e '/…/r file' -e '/…/d'`, and the ordering (filter → ggml-common →
  impl) matches steps 2→3→4.
- `#include "ggml-common.h"` survives in the output exactly as upstream's does; it
  sits inside `#if defined(GGML_METAL_EMBED_LIBRARY) … #else … #endif`
  (`kernels/dequantize.h:7-11`) and the define is set, so it is never opened.
- `.byte` emission instead of `.incbin` produces the same bytes
  (`toAsm`, `gen-metal-embed.js:170-183`).

Fragility worth noting, not fixing here: the kind regex
`/^\s*X\(\s*[A-Z0-9_]+\s*,\s*([a-z0-9_]+)\s*\)/` uses `\s`, which matches newlines,
so any future `X(...)` table added to `ggml-metal-device.m` would be picked up.
An extra kind only adds a harmless `.s`; the Ruby guard
(`withLlamaIosSourceBuild.js:55-58`) re-verifies the full set and raises naming
any missing kind, so the failure mode is loud, not silent.

### 4.7 Security of the write into `node_modules` — CONFIRMED acceptable

Path segments come from `[a-z0-9_]+` only (no `/`, no `.`), so no traversal is
possible from a hostile vendor file. Writes are content-compare-then-write
(`gen-metal-embed.js:204-209`), idempotent, and the Podfile runs the generator
before pods resolve and re-checks the complete set afterwards.

## 5. Tests — do the Android pins bite?

### 5.1 Removing the scoping fails 7 tests in 4 suites — CONFIRMED load-bearing

Mutation in a `/tmp` clone: `return Platform.OS === "ios"` → `return true` at
`memoryEstimate.ts:211`.

```
mut1_exit=1
Test Suites: 4 failed, 2 passed, 6 total
Tests:       7 failed, 59 passed, 66 total

● Android pins origin/main 0-semantics › modelGateVerdict: a 0 available read gates nothing and stays unknown
● Android pins origin/main 0-semantics › modelGateVerdict: known through totalMemory, exactly as origin/main
● Android pins origin/main 0-semantics › evaluateModelFit / decidePreSendFit fail open at 0 available
● fitMemoryEstimate on Android › treats a 0 budget as unknown, exactly as origin/main
● gateModelLoad › 0 available on Android stays the origin/main fail-open (unknown → allow)
● gateOptionFit 0-available semantics are platform-scoped › Android: 0 available prices unknown
● profileWithFreshMemory › keeps the cached sample when the Android read is 0 (origin/main)
```

These are genuine behavioural pins, not decorative ones.

### 5.2 The iOS-side pins bite too — CONFIRMED load-bearing

| mutation | caught by |
|---|---|
| delete the iOS branch in `getAvailableMemoryBytes` (`memoryEstimate.ts:327-334`) | `getAvailableMemoryBytes on iOS › returns 0 unchanged`, `› does not cache` (2 failed) |
| `reportedTotalMemoryBytes = totalMemoryBytes` (`deviceProfile.ts:683`) | `feeds the tier from the SAME fallback bytes the profile reports` |
| `profileWithFreshMemory` back to `> 0` (`engineGateHelpers.ts:170-175`) | `replaces the cached sample with a fresh 0 on iOS` **and** `loadRetryFreshness › a fresh 0 replaces the cached sample on iOS only` |

The last row deserves a note in the branch's favour: I expected the source-grep
pin (`loadRetryFreshness.test.ts:37`,
`expect(HELPERS).toContain("zeroAvailableMemoryIsReal()")`) to be satisfied by the
unused import and therefore vacuous. It is not — the import at
`engineGateHelpers.ts:15` has no parentheses, so the grep matches only the call.

### 5.3 Tautological assertions — CONFIRMED decorative

`src/engine/appleDeviceClass.test.ts:36-42`:

```ts
    expect(appleDeviceClassForModelId("iPhone18,9")).toBeNull();
    expect(appleDeviceClassForModelId("iPhone18,6")).toBeNull();
    expect(appleDeviceClassForModelId("iPhone19,1")).toBeNull();
```

These assert that three keys are absent from a literal object. No table content,
however wrong, can make them fail. Same for `iPhone15,4` / `iPad13,1` /
`SM-S911B` / `""` in the neighbouring case.

### 5.4 The Android pin uses an input Android never produces — CONFIRMED unrepresentative

`src/engine/deviceProfile.test.ts:117-124` mocks Android as
`modelId = "SM-S911B"` and comments "on real devices expo-device modelId is null
here" (quoted in §1.3 as `Device.js:38`). The pin therefore exercises a state the
platform cannot produce; the test that *would* pin the real Android input is the
null case, which is not written.

### 5.5 Structural coverage hole — CONFIRMED

`modules/kalsa-lifecycle/src/index.ts:135-148` (`getOsAvailableMemoryBytes`) is
mocked wholesale by all four suites that touch the iOS memory path
(`memoryEstimate.test.ts:14`, `monitor.test.ts:14`, `deviceProfile.test.ts:31`,
`engineGateHelpers.test.ts:14`), so its validation logic is never executed by any
test. It also cannot get one in place: `jest.config.js:5` is
`roots: ["<rootDir>/src"]`, so a spec next to the module would never be
discovered. The same holds for `useThermalMonitor` (no test file at all),
`KalsaLifecycleModule.swift`'s simulator `#if`, both podspecs, and
`plugins/withLlamaIosSourceBuild.js`.

### 5.6 The device table is correct — CONFIRMED

I checked the iPhone 18 generation against public sources: `iPhone18,1` = 17 Pro
(A19 Pro, 12 GB), `iPhone18,2` = 17 Pro Max (A19 Pro, 12 GB), `iPhone18,3` = 17
(A19), `iPhone18,4` = iPhone Air (A19 Pro, 12 GB), `iPhone18,5` = 17e (A19, 8 GB,
Mar 2026) — matching `appleDeviceClass.ts:63-69`. Apple's own doc confirms the
0-is-real contract the whole branch rests on: "If the calling process isn't an app,
or if the process has already exceeded its memory limit, this function returns
`0`", and "Caching the result is not advised". The residual caveat is
provenance, not accuracy: the *identifier* list is sourced to a community gist
(`appleDeviceClass.ts:22-24`) with no per-row citation, while RAM comes from
MacRumors; the header's "checked 2026-10-01" is consistent with the repo's dates.

### 5.7 Test-hygiene notes — PLAUSIBLE (low)

- Three files share one mutable module-scope `const mockPlatform = { OS: "ios" }`
  and flip it per test (`memoryEstimate.test.ts:9`, `monitor.test.ts:9`,
  `loadGate.test.ts:13`). A new `it` that forgets to set `OS` silently inherits
  the previous case's platform.
- `src/engine/loadGate.test.ts:15` adds a **file-wide**
  `jest.mock("react-native", () => ({ Platform: mockPlatform }))` to serve two new
  tests, changing the module environment of ~30 pre-existing tests in that file.
  They pass, but the file now has a hidden dependency on RN's surface being just
  `Platform`.
- `deviceProfile.test.ts:31` replaces the whole lifecycle module with an object
  exposing only `getOsAvailableMemoryBytes`, while that module also exports the
  Android background-timer API (`modules/kalsa-lifecycle/src/index.ts:26-30`).
  Fine today because the import is lazy, fragile if that ever changes.

## 6. Code quality, comments, commit messages

### 6.1 `7bceff40`'s message describes work that is not in the branch — CONFIRMED

The body states: "`package.json`: expo-asset ~57.0.18, expo-file-system ~57.0.7,
expo-font ~57.0.4, expo-keep-awake ~57.0.2 now declare the lockfile-resolved
versions; expo-constants ~57.0.20 added as a declared direct dependency
(imported by src/, previously transitive-only) … `npm install
--package-lock-only --ignore-scripts EXIT=0`; lockfile diff touches only the root
package's declared ranges".

- `git show 7bceff40 --name-only` → three files: the Swift header,
  `modules/kalsa-lifecycle/src/index.ts`, `src/engine/monitor.ts`.
- `git diff origin/main...HEAD -- package.json` → empty.
- Those exact ranges already exist at `2e7b4dfd` (`package.json:31, 38, 42, 43,
  46`), so the "previously transitive-only" claim is false for the base this
  branch is being landed onto.

For an audit trail this is the one commit-message defect that matters: it asserts
a dependency-hygiene change that a reviewer cannot find.

### 6.2 Stale earlier messages — CONFIRMED

`a54ec315` advertises "`scripts/gen-metal-embed.js` (+ **package.json
postinstall**)" and "`KalsaLifecycleModule.swift` + podspec: **UIKit memory
warning as the same trimMemory event (level 15)**". Both were deleted by
`f98c4304` ("P1-a Android CI: root postinstall removed", "The lifecycle module's
trimMemory event is gone"). Normal for a commit message; misleading for anyone
reading the six commits as the landing description.

### 6.3 Runbook staleness — CONFIRMED

`MAC-RELEASE-RUN.md:319` "Branch = 5 iOS commits"; HEAD has six. `:333` "targeted
jest, 7 suites touched by the 5 commits | 63/63"; the sixth commit added
`src/host/engineGateHelpers.test.ts`, and the eight touched suites are 82 tests
(measured). `:331` gate row, see §2.3.

### 6.4 Smaller quality notes — CONFIRMED

- `src/engine/memoryEstimate.ts:215-216`: `zeroAvailableMemoryIsReal`'s closing
  brace is immediately followed by `export function fitMemoryEstimate` with no
  blank line (visible in the diff).
- `src/engine/modelGateRAM.ts:19` is now a single 133-character import line.
- `-0` (PLAUDSIBLE, low): `availableMiB === 0` is true for `-0`, so a `-0` budget
  is treated as real headroom on iOS (`does_not_fit`) where `origin/main` said
  unknown. Unreachable from `Int64`, reachable from any JS caller of the exported
  `fitMemoryEstimate` / `evaluateModelFit` / `gateOptionFit`.
- `modules/kalsa-thermal/ios/KalsaThermal.podspec:10` adds `s.homepage` — a
  one-line no-op for a local path pod, harmless.
- File sizes are reasonable for this repo: `scripts/gen-metal-embed.js` 224,
  `plugins/withLlamaIosSourceBuild.js` 108, `appleDeviceClass.ts` 101,
  `src/engine/deviceProfile.test.ts` 251.
- No dead exports introduced: `getOsAvailableMemoryBytes` and
  `iosThermalStateToAdvisoryStatus` each have production callers
  (`memoryEstimate.ts:333`, `useThermalMonitor.ts:141`); `appleDeviceClass.ts`
  imports nothing and does no I/O, as its header claims.

## 7. Not verified / out of scope

- No Swift or Metal build was run here (no `xcodebuild`, no `pod install`, no
  device). The Swift race in §4.1 and the embed-generation equivalence in §4.6 are
  argued from sources, not from an instrumented build.
- The iPad-on-Mac `os_proc_available_memory` behaviour (§4.5) is unmeasured; the
  branch itself says so in three places.
- `.s`-file *content* equality against upstream `bootstrap.sh` could not be
  checked: the fork's `scripts/` is not shipped in an npm git install. I verified
  equivalence against `CMakeLists.txt` instead, which is the stronger reference
  anyway.

## 8. Landing

The merge itself is clean: `origin/main` has advanced to `7ec12eb0` (9 commits)
since the branch point, and `comm -12` between the file lists is **empty** — no
overlap, so no conflict to resolve.

Against the stated bar — land on main with **zero** Android behaviour change while
enabling the iOS build — the Android side is clean on every axis I could test:
the shared TypeScript is bit-identical on Android for every input (§1.1-1.3), the
Android `prebuild` tree is byte-identical to main (§1.4), the provenance script
change is comment-only and cannot fire on Linux CI (§2.1-2.2), and no dependency
graph changes (§2.6). The defects I found are iOS-side defects (§4.1, §4.4, §4.5),
test-quality issues (§5.3-5.5), and documentation/commit-message defects
(§2.3, §6.1-6.3) that live mostly in the scratchpad, not in code.

Two things I would still fix before merging, both docs-only and both outside the
diff: the `MAC-RELEASE-RUN.md` gate row and commit count (§2.3), and the
`7bceff40` message (§6.1) — or, if the coordinator prefers a reworded history,
squash the six commits into one accurate message.

**LAND-ON-MAIN: yes.**