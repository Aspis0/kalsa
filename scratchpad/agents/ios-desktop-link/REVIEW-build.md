# Review — build pipeline, Android identity, and cross-file

Reviewed `~/Projects/kalsa-ios`, branch `ios/desktop-link`, commit `0e4078c4` against `ee8b5f25`. Read-only review; no builds or tests run here. The existing `IMPL.md` reports a successful Debug simulator build, but Release/device/App Store archives were not measured.

## Findings (ranked)

### P0 — CONFIRMED: the iOS node private key is included in normal app backups

`modules/kalsa-iroh/ios/KalsaIrohModule.swift:251-256`:

> `let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]`
> `return base.appendingPathComponent("iroh-node.key").path`

The Rust bridge creates/loads the identity at this path (`native/kalsa-iroh-mobile/src/bridge.rs:37-48`). There is no `isExcludedFromBackup` assignment in the iOS module. Apple documents that Application Support is included in regular backups and says to set `isExcludedFromBackup` to exclude an item ([Using the File System Effectively](https://developer.apple.com/documentation/foundation/using-the-file-system-effectively)). This key is the stable node identity credential; backing it up lets a restored device reuse/clone that identity and puts the secret in the backup set. The platform policy is inconsistent: `app.config.js:69` says `allowBackup: false` for Android, where the same file lives under `filesDir`.

### P1 — CONFIRMED: a 10-second dial blocks every iOS control call behind it

`modules/kalsa-iroh/ios/KalsaIrohModule.swift:32-34` creates a serial `control` queue; `:68-70` dispatches `openTunnel` onto it, and `:175` synchronously calls `currentBridge().connect(...)`. The Rust contract says `native/kalsa-iroh-mobile/src/bridge.rs:43`:

> `The dial itself is bounded by brain's 10 s dial deadline.`

Thus a slow dial holds the only control queue for up to 10 seconds. `nodeId`, `startBridge`, and `shutdown` are also dispatched onto that queue (`KalsaIrohModule.swift:47-75, 104-113`), so they wait behind the dial. Android uses a four-thread control pool (`KalsaIrohModule.kt:44-45`), so this serialization is iOS-specific. It is especially visible after JS aborts a dial: `src/remote/irohBridge.ts:57-61, 72-89` rejects promptly but later queues shutdown of a late handle, while iOS control work remains occupied.

### P2 — CONFIRMED: clean Rust installs fail on missing Apple targets without a targeted preflight or setup guidance

`scripts/gen-iroh-xcframework.sh:23-28` checks only for `cargo` and `xcodebuild`; it then invokes the two Apple targets at `:31` and `:35` without checking/installing either rustup target. `modules/kalsa-iroh/README.md:31-35` asks for “a Mac with the Rust toolchain and Xcode” but does not name the target components. A normal rustup install with only its host target therefore reaches Cargo's missing-target error during `pod install`. `set -euo pipefail` makes this fail closed, so this is a first-build setup failure rather than stale output being silently accepted; the diagnostic should identify the required targets or the build recipe should provision them.

### P2 — CONFIRMED (conditional workflow): an existing Xcode workspace can silently link stale `Generated/` after Rust changes

The only generation call is injected into Podfile evaluation: `plugins/withIrohXcframework.js:20-25` runs `scripts/gen-iroh-xcframework.sh`; README `modules/kalsa-iroh/README.md:31-35` likewise says it is produced “at pod install.” The podspec consumes the generated Swift and XCFramework (`modules/kalsa-iroh/ios/KalsaIroh.podspec:21-23`). An ordinary build of an already-generated workspace does not evaluate the Podfile, so editing the Rust crate and rebuilding from Xcode without rerunning `pod install` leaves the ignored framework untouched and can package old behavior. The current script is fresh on each Podfile evaluation, but there is no Xcode build phase or input fingerprint to cover this path.

### P2 — CONFIRMED: malformed JS tunnel handles can trap the Swift process at the number conversion

`modules/kalsa-iroh/ios/KalsaIrohModule.swift:234-237` converts an arbitrary JS `Double` with `Int64(id)` before it can return the “no tunnel” error. The JS contract accepts a general `number` (`modules/kalsa-iroh/src/index.ts:14-20`), and exported tunnel methods pass the value straight through (`:72-86`). Swift's checked floating-point-to-integer conversion traps for NaN or values outside `Int64`; Kotlin's corresponding `id.toLong()` (`KalsaIrohModule.kt:90, 97, 105`) saturates/converts and then performs a map lookup. Normal handles returned by `openTunnel` are small and safe, so this requires a malformed caller/handle, but it is a native crash rather than a rejected promise.

### P2 — PLAUSIBLE: Release app-size/dead-strip outcome is not established by the current evidence

The generator does use Cargo Release (`scripts/gen-iroh-xcframework.sh:31, 35`), and the crate requests `opt-level = "z"`, `strip = "symbols"`, and `lto = "thin"` (`native/kalsa-iroh-mobile/Cargo.toml:49-52`). However, the implementation report calls the 36.9 MB slices “unstripped archives” (`IMPL.md:112-115`), records a +16,161,296 B / ≈15.4 MiB Debug simulator dylib delta (`:116-120`), and explicitly says Release/device and App Store-style archive sizes were not measured (`:121-123, 145`). The Cargo profile requests stripping/LTO, but that evidence does not establish how much the final app linker dead-strips or what ships. The two-slice 70 MB XCFramework is a local build artifact, not the installed app size. No private Apple API references were apparent in the static archive's undefined-symbol scan; it referenced public CoreFoundation, SystemConfiguration, Security, and Network symbols. A Release archive/export scan remains unverified.

### P3 — CONFIRMED: the JS identity-path comment is now wrong on iOS

`modules/kalsa-iroh/src/index.ts:53-55` still says:

> The key file's path is resolved natively from the app's filesDir (`<filesDir>/iroh-node.key`, owner-only); no
> path crosses the JS bridge.

The new iOS implementation uses Application Support (`KalsaIrohModule.swift:251-256`), while Android uses `Context.filesDir` (`KalsaIrohModule.kt:198`). The nearby README already documents both paths; the JS API comment should not describe Android as the cross-platform path.

### P3 — CONFIRMED: Android prebuild is unchanged, but the full Android JS build is not byte-identical

The implementation report says Android prebuild output was byte-identical (`IMPL.md:96`), and this commit changes no Android module, Rust crate, or workflow. But `modules/kalsa-iroh/src/index.ts:47` changes the observable missing-module error from “(Android only)” to “in this build.” The Android JS bundle therefore changes, even though normal Android bridge behavior and the native prebuild/Gradle pipeline are unchanged.

### P3 — PLAUSIBLE: Cargo may rewrite the lockfile during a Podfile build

The script invokes `cargo rustc` and `cargo run` without `--locked` (`scripts/gen-iroh-xcframework.sh:31, 35, 45-46`). UniFFI itself is correctly pinned exactly (`Cargo.toml:20-21`; `Cargo.lock:3465-3466, 3481-3483` both resolve to 0.32.2), so there is no current bindgen/crate version skew. Still, if the manifest and lockfile drift, Cargo is allowed to resolve and rewrite `Cargo.lock` during `pod install` instead of failing the build. This is a reproducibility guard, not a current UniFFI mismatch.

## Explicit checks that came back clean

- **UniFFI version skew — REFUTED:** the crate declares `uniffi = "=0.32.2"`; the lockfile resolves both `uniffi` and `uniffi_bindgen` to 0.32.2; `uniffi-bindgen` is the in-tree binary calling `uniffi::uniffi_bindgen_main()` (`Cargo.toml:20-21, 33-35`; `src/bin/uniffi-bindgen.rs:1-3`). No separately installed CLI can drift from the crate.
- **`set -euo pipefail`, partial outputs, and repeat generation — REFUTED as silent-reuse failures:** the script has `set -euo pipefail` (`:15`), verifies both libraries (`:38-40`), removes `Generated/` before generating bindings (`:42-46`), and removes/recreates the XCFramework before assembly (`:54-61`). The Podfile raises on a failed script (`withIrohXcframework.js:23-25`). A failed `pod install` cannot continue with the old output.
- **Podfile ordering — REFUTED:** the generated Podfile has the llama Metal generation block first and the iroh block second (`ios/Podfile:1-20`); both execute before pod resolution. The duplicate `kalsa_root` assignment is harmless.
- **Android prebuild plugin effect — REFUTED:** `withIrohXcframework` adds an iOS `withPodfile` mod only (`plugins/withIrohXcframework.js:16, 28-37`); the implementation report records an Android prebuild tree diff with zero lines (`IMPL.md:96`).
- **Linux CI — REFUTED:** all eight workflows are unchanged in the commit. Workflow build commands run `expo prebuild --platform android` and/or `cargo ndk`; none runs iOS prebuild, CocoaPods, Xcode, or this generator. The Podfile-only mod does not enter those Linux jobs.
- **Ignore ordering — REFUTED:** `.gitignore:125-136` puts `modules/kalsa-iroh/ios/Generated/` after the Apple-source negations, and `git check-ignore` confirms Generated is ignored while the Swift source remains trackable.
- **Deadline clamping parity — REFUTED:** Swift clamps/truncates/saturates into `UInt32` (`KalsaIrohModule.swift:239-249`); Kotlin uses `Double.toUInt()` (`KalsaIrohModule.kt:91, 97`), whose documented semantics are truncation, zero for negative/NaN, and `UInt.MAX_VALUE` above range ([Kotlin `Double.toUInt`](https://kotlinlang.org/api/core/kotlin-stdlib/kotlin/to-u-int.html)). The comment claiming this matches Android is accurate.
- **Bitcode — REFUTED as a blocker:** the generated app project sets `ENABLE_BITCODE = NO` (`ios/KalsaAIChat.xcodeproj/project.pbxproj:380`). The app and pod build succeeded per `IMPL.md`; no bitcode setting was added by this commit.
