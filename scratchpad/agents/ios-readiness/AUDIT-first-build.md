# Hostile audit: `22f337fd` (`ios/first-build`)

Scope: read-only review of the named commit. No checkout files were changed. I did not run `npm install`, `npm ci`, Jest, CocoaPods, or an Xcode build. I did run the new generator against a copied pinned vendor tree in `/tmp` and compared its embedded bytes with the engine's CMake flattening pipeline.

## Findings, ranked

### P1 — CONFIRMED: the new postinstall breaks Android provenance-gated builds

> `package.json:6` — `"postinstall": "node scripts/gen-metal-embed.js",`

`npm ci` runs this root lifecycle script on every platform. The generator writes 34 ignored assembly files into the *installed binding package*:

> `scripts/gen-metal-embed.js:202-208` — `const outPath = path.join(METAL_DIR, \`ggml-metal-embed-${kind}.s\`);` … `fs.writeFileSync(outPath, asm);`

At the pinned binding commit, those paths are ignored (`llama.rn@6c9b16ed:.gitignore:76`: `vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-embed*.s`). They are absent from a clean commit tarball. The existing provenance gate hashes every regular file in the packed and installed trees and does not exclude these `.s` files:

> `scripts/assert-engine-provenance.sh:38-42` — `find . -type f ... -print0 | LC_ALL=C sort -z | xargs -0 ...`
>
> `scripts/assert-engine-provenance.sh:101-105` — `manifest "$WORK/packed" ...`; `manifest "$INSTALLED" ...`; then `diff -u ...`

The gate explicitly says any extra build output under the installed copy is a divergence (`assert-engine-provenance.sh:28-29`). The new hook therefore makes the gate report `DIVERGENT` after install. This hits Android workflows that run both commands, including `apk.yml` (`npm ci` line 80, provenance assertion line 86), `build-kalsa-apk.yml` (assertion line 60), and `e2e-emulator.yml` (assertion line 61). Other Ubuntu workflows also now run the generator on every `npm ci`, even when they do not run the provenance gate.

The generator itself is Node-only (`gen-metal-embed.js:27-28` imports only `fs` and `path`); it does not shell out to `od`, `sed`, or `xxd`, so GNU/BSD utility differences and missing Linux tools are **REFUTED** as a current failure mechanism. Its outputs stay under `node_modules/llama.rn/vendor/...`; it does not write outside the installed dependency. If the vendor Metal directory is absent, however, it throws at `gen-metal-embed.js:179-182` and exits 1 at 215-219. A future/different binding pin without the expected layout therefore makes `npm ci` itself fail.

**Android product-code regression: REFUTED.** The TS changes add explicit iOS branches; the existing Android branches remain the selected branches. `memoryEstimate.ts:298-306` checks iOS before the old non-Android return; `monitor.ts:59-67` does likewise; `useThermalMonitor.ts:120-138` keeps the Android sysfs path and only enters the new reader for `Platform.OS === "ios"`. `appleDeviceClassForModelId("Pixel …")` returns `null`, so the device-profile fallbacks do not change Android values. The confirmed Android regression is the postinstall/provenance interaction, not a changed Android RAM or thermal return value.

### P1 — CONFIRMED: a real iOS zero-memory result fails open at the load gate

Apple defines `os_proc_available_memory()` as bytes available to the current app and says it returns `0` when the app has exceeded its memory limit. The native bridge returns that zero unchanged; the JS validator rejects only negative values:

> `KalsaLifecycleModule.swift:25-26` — `Int64(os_proc_available_memory())`
>
> `modules/kalsa-lifecycle/src/index.ts:128-132` — accepts finite `value` whenever `value < 0` is false, then returns it.

The new iOS reader thus makes `0` a numeric `availableMemoryBytes`. The live load gate treats zero as unknown and allows the load:

> `src/engine/deviceProfile.ts:185-198` — the volatile RAM check requires `availableMemoryBytes > 0`.
>
> `src/engine/deviceProfile.ts:211-223` — if the volatile value is not positive but `totalMemoryBytes` is positive, the verdict is `allowed: true` / `"ok"`.
>
> `src/engine/deviceProfile.ts:478-480` — the pre-send fit path maps `"unknown"` to `{ allow: true, bannerKey: "model.memoryUnknown" }`.

Concrete failure: iOS reports zero at/over the process limit; the load path passes zero through `engineLoad.ts:115-121`, fit becomes unknown, and the model load is allowed into a process Apple says has already crossed its limit. A second path makes this worse: `profileWithFreshMemory` accepts only `availableMemoryBytes > 0` (`engineGateHelpers.ts:165-173`); on zero it returns the previous cached positive profile, so a stale headroom estimate can be used instead of the zero reading.

Apple also says this value is a rapidly changing per-process budget, not device-wide free RAM, and advises against caching it ([Apple API documentation](https://developer.apple.com/documentation/os/os_proc_available_memory)).

### P1 — PLAUSIBLE: the new Swift module is missing the import for its C API

> `modules/kalsa-lifecycle/ios/KalsaLifecycleModule.swift:13-14` — `import ExpoModulesCore`; `import UIKit`
>
> `modules/kalsa-lifecycle/ios/KalsaLifecycleModule.swift:25-26` — calls `os_proc_available_memory()`.

There is no `import os` and no bridging-header include in the new podspec. Apple's API is declared in `os/proc.h`; Apple's platform material identifies it as iOS 13+ and unavailable on macOS ([Apple WWDC22](https://developer.apple.com/videos/play/wwdc2022/10106/)). With iOS deployment target 16.4 (`KalsaLifecycle.podspec:13`), API availability itself is old enough; visibility of the declaration is the likely compile failure (`cannot find 'os_proc_available_memory' in scope`). Xcode is absent here, so this remains a static, high-confidence compile risk rather than a reproduced diagnostic.

The selector concern is **REFUTED**: Expo's own module API documents the same `Module` subclass + `NotificationCenter.addObserver(... selector: #selector(...))` + `@objc` handler pattern ([Expo module API](https://docs.expo.dev/modules/module-api/)). Expo's `Module` base is not an `NSObject` subclass in the installed source, but Expo explicitly supports this pattern. The new lifecycle module removes the observer in both `OnStopObserving` and `OnDestroy`; registration begins only when a JS listener exists. UIKit is imported for the UIApplication notification. The deployment target is above the function's iOS availability.

Mac caveat: `os_proc_available_memory` is explicitly unavailable for macOS; this commit has no Mac-specific fallback. That means a native macOS/Catalyst build cannot rely on this API. For the “Designed for iPad” app-on-Mac runtime and the iOS simulator, the commit contains no execution evidence that the function returns zero; Apple documents zero for non-app processes or an app over limit, not “all Macs” or “all simulators.” Any returned zero still takes the fail-open path above.

### P2 — CONFIRMED: the `iPhone18,x` prefix maps real devices to the wrong chip and RAM

> `src/engine/appleDeviceClass.ts:61-63` — “The whole iPhone18,x generation (2025) is Apple Intelligence class with 8 GiB”
>
> `src/engine/appleDeviceClass.ts:72-74` — every `iPhone18,` ID returns `{ chipClass: "A19", ramBytes: EIGHT_GIB }`.

`iPhone18,1` is iPhone 17 Pro, whose chip is A19 Pro and reported RAM is 12 GB; `iPhone18,2` is Pro Max, also 12 GB. `iPhone18,4` is iPhone Air, also A19 Pro / 12 GB. The prefix also includes base-tier devices with different specs. The source table therefore invents one chip/RAM answer for a heterogeneous family. Apple publishes chip names but not iPhone RAM; MacRumors reports its RAM figures from Xcode 26 and explicitly says Apple does not advertise them ([iPhone 17 RAM report](https://www.macrumors.com/2025/09/09/iphone-17-pro-iphone-air-ram-amounts/)). The model-ID mapping and 17 Pro's 12 GB figure are independently listed by [EveryMac for `iPhone18,1`](https://everymac.com/ultimate-mac-lookup/?identify=iPhone18%2C1); Apple's [iPhone 17 Pro specifications](https://support.apple.com/en-my/125090) identify A19 Pro.

The exact mappings `iPhone16,1` → iPhone 15 Pro / A17 Pro / 8 GB and `iPhone17,1` → iPhone 16 Pro / A18 Pro / 8 GB are consistent with the reported identifiers/specs ([iPhone16,1](https://everymac.com/ultimate-mac-lookup/?identify=iPhone16%2C1), [iPhone17,1](https://everymac.com/ultimate-mac-lookup/?identify=iPhone17%2C1), [Apple iPhone 16 Pro specs](https://support.apple.com/en-gb/121031)). The broad `iPhone18,` rule is the material error. The new test's `iPhone18,9` expectation validates an unverified suffix and repeats the incorrect A19/8-GiB assumption (`appleDeviceClass.test.ts:16-24`).

The comment's “2025 generation” is not a safe property of this identifier prefix: the 2026 iPhone 17e is reported as `iPhone18,5` ([EveryMac](https://everymac.com/ultimate-mac-lookup/?identify=A3575%2A)).

### P2 — CONFIRMED: mapped RAM is written to the profile but ignored for its RAM tier

> `src/engine/deviceProfile.ts:634` — `const totalMemoryBytes = asNullablePositiveNumber(Device?.totalMemory);`
>
> `src/engine/deviceProfile.ts:672` — `totalMemoryBytes: totalMemoryBytes ?? appleClass?.ramBytes ?? null,`
>
> `src/engine/deviceProfile.ts:680` — `ramTier: getRamTier(totalMemoryBytes),`

Concrete failure: if Expo's `totalMemory` is null on a mapped iPhone, the returned profile says 8.59 billion bytes but classifies the same device as `low`, because the tier uses the nullable local value rather than the fallback value. `modelGateVerdict` can then refuse a model on `blocked_tier` even though the map was added to supply known Apple RAM. This is not a decimal/binary boundary issue: `EIGHT_GIB` is 8,589,934,592 bytes and exceeds the decimal 6.9-billion high-tier cutoff, so an 8-GB iPhone is `high` when the actual or fallback byte count is used. Byte→MiB conversions in the fit path use 1,048,576 consistently.

### P2 — CONFIRMED: the new iOS reading is cached contrary to its API contract

> `src/engine/memoryEstimate.ts:283-285` — iOS jetsam headroom is described as “Cached for process lifetime.”
>
> `src/engine/memoryEstimate.ts:293-304` — returns `cachedAvailableBytes` before reading and stores the iOS result in that cache.
>
> `src/engine/deviceProfile.ts:692-714` — the full `DeviceProfile` is also process-lifetime cached.

Apple says this is an instantaneous process-limit-minus-footprint snapshot, can change frequently, and “don’t cache it” ([Apple API documentation](https://developer.apple.com/documentation/os/os_proc_available_memory)). The new uncached reader in `monitor.ts` is appropriate for live sampling, and `engineLoad.ts` also uses it for the fit gate. However, the cached profile still feeds the settings/model-choice surface; the fresh-profile helper keeps stale data when its new read is zero. Scenario: memory changes after initial profile creation and the UI continues to price the model against the old headroom for the rest of the process. This is distinct from the zero-as-unknown fail-open above.

### P2 — CONFIRMED: the Podfile guard accepts a partial embed set

> `plugins/withLlamaIosSourceBuild.js:28-31` — `unless Dir[File.join(metal_dir, 'ggml-metal-embed-*.s')].any?` then `end`.

The engine's `ggml-metal-device.m` declares one start/end pair per listed library (`ggml-metal-device.m:470-480`); CMake generates 34 assembly files (`CMakeLists.txt:39-74, 86-93`). The guard checks only that *one* file exists. A killed/interrupted postinstall or stale partial tree with one `.s` passes prebuild, and the eventual pod compile/link fails on the missing symbols. The error text claims missing embeds are caught before linker failure, which this predicate does not guarantee.

The rest of the Podfile injection is sound on inspection: it checks a marker before inserting, prepends at the top, sets the ENV before CocoaPods evaluates the podspec, and `File.expand_path('../node_modules/...', __dir__)` resolves from the generated `ios/Podfile` to the app's root `node_modules`. Repeated normal `expo prebuild` runs are idempotent. No quoting/path error found.

### P2 — PLAUSIBLE: the all-Mac RAM fallback is an arbitrary 8-GiB value

> `src/engine/appleDeviceClass.ts:8-12` — says RAM values are “Apple's nominal specs” and are fallback-only.
>
> `src/engine/appleDeviceClass.ts:75-78` — every identifier starting with `Mac` maps to chip class `Apple Silicon` and 8 GiB.

A Mac model identifier does not encode whether the host has 8, 16, 32, or more GiB. If Expo total memory is unavailable on a 16-GiB Apple Silicon Mac running the iPad app, the profile substitutes 8 GiB and labels it as a nominal fact. That is conservative (it does not overstate memory), but still fabricated and can understate the host's memory class. The app-on-Mac path and Expo's `totalMemory` value were not runnable here. iPad-on-Mac requiring Apple Silicon makes the broad `Mac` prefix plausible for chip family, not for RAM amount or a specific chip model.

### P2 — CONFIRMED: the new tests encode bad fixture data and omit the risky integration paths

`appleDeviceClass.test.ts:16-24` asserts the bad prefix mapping, including `iPhone18,9`, instead of checking the actual mixed `iPhone18,x` models. It does not exercise the `buildDeviceProfile` fallback/tier combination where the `ramTier` bug lives. `platformThermalStatus.test.ts:100-118` does test the pure enum mapping, but the module mock at lines 3-5 forces “native module absent”; it does not exercise the newly linked Swift module or `useThermalMonitor` integration. No new test covers the postinstall side effect, Podfile guard completeness, or Swift compilation.

I found no environment or global-state mutation in these two tests that needs restoration. The Expo module mock is scoped to that Jest test file.

### P3 — CONFIRMED: the new trim-memory event currently has no JavaScript consumer

> `modules/kalsa-lifecycle/src/index.ts:104-117` — exports `addTrimMemoryListener`.
>
> `KalsaLifecycleModule.swift:7-10, 63-66` — sends level 15 for a UIKit memory warning.

There is no app call site for `addTrimMemoryListener`; the native observer starts only after a listener is attached, so the new trim event is currently inert. I cannot find a current JS consumer whose numeric threshold semantics would be broken by level 15. If a consumer is added, 15 is specifically Android `TRIM_MEMORY_RUNNING_CRITICAL`; UIKit's memory-warning notification is a coarse signal, not an equivalent Android trim-level scale. This is dead event surface, not a current regression. The iOS available-memory function in the same native module is used.

## Metal embedding results (no finding against the stated CMake identity)

The symbol contract matches. The engine macro says each name is the `ggml_metallib_<name>_{start,end}` stem (`ggml-metal-device.m:110-112`); its extern declarations are:

> `ggml-metal-device.m:470` — `extern const char ggml_metallib_##s##_start[]; extern const char ggml_metallib_##s##_end[];`

CMake emits the corresponding Mach-O underscore symbols (`CMakeLists.txt:128-133`), and the new script emits the same `.section __DATA,__ggml_metallib`, `.globl`, and labels (`gen-metal-embed.js:44, 159-175`). There is no explicit alignment in either CMake or the generated assembly; the payload is byte-addressed as `char` and passed with an explicit `end - start` length (`ggml-metal-device.m:488-490`), so an extra alignment directive or trailing NUL is not required. The payload ends with the flattened source's newline, not a NUL.

I copied the generator and only its required vendor inputs to `/tmp`, ran it there, emulated CMake's cat/sed flattening for the CMake source list, decoded the generated `.byte` directives, and compared buffers: **34 kinds, zero byte mismatches**. No vendor checkout file was touched. The output is byte-identical to this pin's CMake payloads.

The binding's `scripts/bootstrap.sh` is not an equivalent oracle: at the pinned revision it concatenates `common.h`, optional `dequantize.h` / `quantize.h`, and the kernel (`bootstrap.sh:129-144`), but it does not prepend/remove the CMake pipeline's `fa_common.metal` and `fa_vec_common.metal`. The new script explicitly follows CMake rather than bootstrap (`gen-metal-embed.js:14-20`), and the CMake identity check passes. `.byte`, `.globl`, and the shared Mach-O section are architecture-neutral in this use and mirror upstream's emitted syntax; arm64 device and x86_64 simulator assembly were not actually assembled because Xcode is unavailable.

## Privacy and remaining checks

No new device identifier egress found. `appleDeviceClassForModelId` and `DeviceProfile.modelId` are used locally. Telemetry emits coarse `deviceBucket`, `modelCategory`, and `memoryClass` fields (`src/telemetry/telemetry.ts:926-931`); it does not add or transmit the raw Apple hardware identifier. The existing telemetry `modelId` is reduced through `modelCategoryFromId`, not populated from this new Apple profile field.

No additional Android behavior change, malformed Podfile path, external-tool dependency, or generated write outside `node_modules` found. The main unverified boundary is native compilation/runtime: no Xcode build, simulator, or device run was possible.
