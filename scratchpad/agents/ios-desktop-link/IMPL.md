# IMPL — iOS phone↔desktop link (kalsa-iroh Apple bridge)

Branch `ios/desktop-link` at `0e4078c4` in `~/Projects/kalsa-ios` (local only, never
pushed). Base: `origin/main` = `ee8b5f25`. Everything below ran on the M-series Mac,
Xcode 27.0 (27A266a), Rust 1.96.0, node 22 (homebrew), Expo SDK 57 / RN 0.86.2.

## What was built

1. **Pairing entry (step 1) — verified, nothing to fix.** `expo prebuild --platform
   ios` turns `app.config.js` `scheme: "kalsa"` into the generated
   `ios/KalsaAIChat/Info.plist`:

   ```xml
   <key>CFBundleURLTypes</key>
   <array>
     <dict>
       <key>CFBundleURLSchemes</key>
       <array>
         <string>kalsa</string>
         <string>com.kalsa.app</string>
       </array>
     </dict>
   </array>
   ```

   So `kalsa://pair#<base64url>` opens the app; `src/host/HostOverlays.tsx:153-169`
   feeds it to `parsePairingInvite` — RN `Linking`, no platform branch. QR scan is
   expo-camera (cross-platform). Universal links (`kalsa.io/pair`, Associated
   Domains + AASA) are NOT configured — out of scope; QR/paste/scheme cover entry.

2. **Tailscale road (step 2) — verified, nothing changed.** `grep -rn "Platform.OS"`
   over `src/pairing/`, `src/remote/`, `src/host/HostOverlays.tsx`,
   `modules/kalsa-iroh/src/`: no matches. `pairingUrls.ts` accepts HTTPS anywhere +
   HTTP loopback only; `remoteUrl.ts` sends Authorization on the same rule — both
   platform-neutral. Generated iOS Info.plist ATS is unchanged from main:
   `NSAllowsArbitraryLoads=false`, `NSAllowsLocalNetworking=true` — an HTTPS
   tailnet door needs no exception; plain `http://100.x` is refused by the JS policy
   on both platforms. No code touched.

3. **iroh road (step 3) — the actual work.** Commit `0e4078c4`, 10 files, +435/−20:
   - `native/kalsa-iroh-mobile` is **byte-identical to origin/main** (`git diff
     origin/main -- native/kalsa-iroh-mobile` = empty): it already compiles for
     Apple as-is — the Android JNI context and iroh/jni/ndk-context deps are behind
     `cfg(target_os="android")` / `[target.'cfg(target_os="android")'.dependencies]`.
     Apple builds use `cargo rustc --crate-type staticlib` (invocation-only emit
     override), so the Android `.so` build path is untouched; `.github/workflows/apk.yml`
     diff is empty too.
   - `scripts/gen-iroh-xcframework.sh` (mode 100755): builds release staticlibs for
     `aarch64-apple-ios` + `aarch64-apple-ios-sim`, generates uniffi Swift bindings
     from the device `.a` (in-tree `uniffi-bindgen` bin, pinned =0.32.2), assembles
     `modules/kalsa-iroh/ios/Generated/KalsaIroh.xcframework` with the uniffi
     header+modulemap embedded (that is how the generated Swift resolves
     `canImport(kalsa_iroh_mobileFFI)` via CocoaPods' XCFrameworkIntermediates
     headers path — a first attempt that ALSO put a modulemap in `Generated/` broke
     the build with a module redefinition, fixed by keeping exactly one).
   - `plugins/withIrohXcframework.js` injects the script call at the top of the
     generated `ios/Podfile` (marker `# KALSA_IROH_XCFRAMEWORK`), failing pod
     install loudly on nonzero — same seam as `withLlamaIosSourceBuild.js` /
     `gen-metal-embed.js`. Registered in `app.config.js` plugins after
     `withLlamaIosSourceBuild`.
   - `modules/kalsa-iroh/ios/`: `KalsaIroh.podspec` (static framework,
     `vendored_frameworks = Generated/KalsaIroh.xcframework`, links
     SystemConfiguration/CoreFoundation/Security — chosen from the actual `nm -u`
     output: `_SCDynamicStore*` (netwatch), `_SecTrust*` (rustls), `_CF*`)
     + `KalsaIrohModule.swift` mirroring the Kotlin bridge: same method names
     (`startBridge/nodeId/openTunnel/write/read/shutdown`), same `KALSA_IROH_*`
     rejection codes, same deadline clamping (NaN/negative → 0 → crate Config
     error, like Kotlin `toUInt()`), same destroyed-race tunnel shutdown, key file
     at `<Application Support>/iroh-node.key` (created with intermediate dirs,
     lands 0600). Blocking calls run on a serial control queue / concurrent parking
     queue, never the JS thread.
   - `expo-module.config.json` registers `"apple": {"modules": ["KalsaIrohModule"]}`;
     Expo autolinks the pod from `modules/kalsa-iroh/ios` (same as
     KalsaLifecycle/KalsaThermal). `index.ts` error message is now
     "KalsaIroh native module unavailable in this build".

   **CI (Linux) stays unaffected:** the Podfile (and thus the injected script)
   only exists after `expo prebuild -p ios`, which apk.yml never runs; no npm
   lifecycle hook was added; `Generated/` is gitignored (`.gitignore` rule placed
   after the `!modules/*/ios/**` negations — no binaries in git).

## Proofs (real exit codes)

| step | command | result |
|---|---|---|
| Apple compile | `cargo check --release --target aarch64-apple-ios-sim` | exit 0 (44 s, crate unmodified) |
| slices | `cargo rustc --release --lib --target <t> --crate-type staticlib` ×2 | exit 0 |
| bindings | `cargo run --bin uniffi-bindgen -- generate --library <device.a> … --language swift` | exit 0 |
| xcframework | `bash scripts/gen-iroh-xcframework.sh` | exit 0 |
| prebuild | `npx expo prebuild --platform ios --no-install` | exit 0 |
| pods | `pod install` (ios/) | exit 0; KalsaIroh in Podfile.lock:115 |
| app build | `xcodebuild -workspace KalsaAIChat.xcworkspace -scheme KalsaAIChat -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath build SKIP_BUNDLING=1 build` | **exit 0, BUILD SUCCEEDED** |
| launch | `simctl boot/install/launch --console-pty` iPhone 17 Pro, iOS 27.0 sim | install exit 0; app ran (real prewarm on device-sim) |
| JS log | Metro terminal | `LOG  [ios-probe] module present: true` and `LOG  [ios-probe] nodeId ok: f210d194f50b6436b099722040d10cc99605b87e20a7ca8c721bed3879390568` — a real `startBridge()` + `nodeId()` through Rust→uniffi→Swift→JS, no "Android only" error |
| key file | sim container `Library/Application Support/iroh-node.key` | exists, 88 B, mode 0600 |
| Android prebuild | `expo prebuild -p android --no-install` on origin/main worktree (in /tmp) vs this branch; `diff -r` | **exit 0, 0 lines — byte-identical** |
| crate path | `git diff origin/main -- native/kalsa-iroh-mobile .github/workflows/apk.yml` | empty |
| gates | `npx tsc --noEmit` | exit 0 |
| gates | `npx jest src/pairing src/remote src/engine/remote --silent` | exit 0 — 44 suites, 398 tests passed |
| gates | `npm ci` then `bash scripts/assert-engine-provenance.sh` | npm ci exit 0; **provenance exit 0** ("OK: 1154 files match Aspis0/kalsa.rn@6b87db167a8f") |

Provenance note: on this Mac (which ran pod install) the same gate reports DIVERGENT
on exactly the 34 generated `ggml-metal-embed-*.s` files — the condition documented
in the script's own header as the accepted iOS-dev-machine state; the fresh-`npm ci`
run above is the honest gate and passes.

The probe was a temporary DEV-only `useEffect` in App.tsx, reverted before the
commit (`git status App.tsx` clean in `0e4078c4`).

## Sizes

- Rust staticlib slices (release, `opt-level="z"`, unstripped archives):
  device `aarch64-apple-ios` 36,876,536 B; simulator `aarch64-apple-ios-sim`
  36,891,512 B; `KalsaIroh.xcframework` on disk 70 MB (du).
- uniffi Swift binding 38,070 B + FFI header 24,891 B (generated, gitignored).
- App delta (Debug-iphonesimulator): `KalsaAIChat.debug.dylib` 54,313,440 B
  (origin/main-equivalent build, apple registration off) → 70,474,736 B with the
  module = **+16,161,296 B (≈ 15.4 MiB)**; `.app` bundle 146 MB → 161 MB; main
  executable 58,480 B unchanged. Rebuild with the committed config reproduced
  70,474,736 exactly.
- NOT measured: Release/device archives (strip will shrink the Rust code well below
  the Debug number; the Android release `.so` 11.16 MB remains the only stripped
  datapoint, per the crate README).

## Kalsa Brain / Tailscale on this Mac (report only — NOT paired)

A Kalsa Brain IS running locally: `kalsa-brain` (PID 66314) with `kalsa-server`
llama.cpp on 127.0.0.1:8130 (Qwen3.6-35B-A3B-UD-Q4_K_M). Tailscale is connected:
this Mac = `marcos-macbook-pro` 100.74.116.126, active peers `marcolenovo` (windows,
direct), `tablet-v477jrig` (relay nyc), `xiaomi-14` (direct); `jelly-star` offline
2 d. Per instructions I did NOT pair and did not dial the Brain from the app.

## What is NOT verified

- End-to-end pairing/tunnel with Kalsa Brain (claim/complete on the desk lane,
  `/props` on the door lane, streamed chat over iroh) — needs the owner's desktop
  confirmation; only the endpoint-create/node-id call ran.
- The Tailscale road end-to-end (Brain's HTTPS door with a cert iOS trusts; host
  Tailscale routing from the simulator).
- Real iPhone behavior: UDP/NAT mapping (iroh #4424), relay failover (#4319),
  iOS suspension/foreground reconnect of QUIC, Local Network prompt — simulator
  cannot test these.
- x86_64 simulator slice: not built (the Podfile already excludes x86_64 from
  iphonesimulator SDKs for all pods; dev Macs are Apple Silicon).
- Release build, device slice link, and app-store-style archive sizes.
- Universal links (`kalsa.io/pair` AASA) — not configured, not tested.

## Lab hygiene

`/tmp/kalsa-main-baseline` git worktree removed (`git worktree remove --force`).
The regenerated `android/` prebuild output was deleted from the worktree. Nothing
in `~/Projects/kalsa` or `kalsa-moe-experiments` was modified; nothing pushed.

## Fix round (2026-10-02, evening) — review-response commit `c4cd72ab`

One commit on top of `0e4078c4` (branch `ios/desktop-link`, base `ee8b5f25`): 3 files,
+137/−28 (`KalsaIrohModule.swift`, `app.config.js`, `scripts/gen-iroh-xcframework.sh`).
Android files untouched; nothing pushed; the temp `App.tsx` probe was reverted before the
commit. Per-item disposition of REVIEW-runtime.md / REVIEW-build.md (coordinator triage):

1. **P0 handle trap — fixed.** `handle()` now mirrors Kotlin `id.toLong()`: NaN → 0,
   `>= 2^63` → `Int64.max`, `<= -2^63` → `Int64.min`, otherwise truncate toward zero
   (finite, in range — the checked conversion cannot trap). A malformed id lands in
   `no tunnel <n>` → `KALSA_IROH_OTHER`, same as Kotlin (`KalsaIrohModule.kt:90,217`).
   Other Double→Int sites: `deadlineMs` was already trap-free (review-verified parity,
   untouched); `Double(id)` in `openTunnel` is Int64→Double (lossless, no trap).
2. **P1/P2 threading — fixed.** `control` is now a concurrent queue (one 10 s dial no
   longer serializes `nodeId`/`startBridge`/`shutdown`/other dials); reads and writes
   each get a dedicated 1 MB-stack `Thread` via a `park(_:)` helper (Kotlin's unbounded
   cached pool has no GCD equivalent that leaves libdispatch's capped shared worker
   pool). Choice explained in the queue comment in the file.
3. **P1 key hygiene — fixed.** `markPrivate(_:)` sets `isExcludedFromBackup` and
   `completeUntilFirstUserAuthentication` on the parent dir when we create it and on
   the key file after the crate creates it (startBridge re-marks every start, so a
   pre-existing file gets covered). Verified in the sim container: `-rw-------` (0600)
   + xattr `com.apple.metadata:com_apple_backup_excludeItem: com.apple.MobileBackup`
   on the file. Path unchanged (crate reads it); atomic temp+rename untouched.
4. **P2 startBridge race — fixed (iOS only).** `destroyed` re-checked under the same
   lock that installs; a raced fresh bridge is dropped on a parked thread and the call
   rejects. Android's latent race left as is, per triage.
5. **P2 local-network prompt — fixed.** `NSLocalNetworkUsageDescription: "Kalsa
   connects directly to your Kalsa desktop on the same network."` in `ios.infoPlist`.
   Android prebuild byte-identity re-proven: `expo prebuild -p android --no-install`
   on `ee8b5f25` vs this branch in /tmp, `diff -r` **exit 0, 0 lines**
   (/tmp/kalsa-fix-android-diff.txt). Key confirmed in the regenerated
   `ios/KalsaAIChat/Info.plist`.
6. **P2 logging + LINKAGE — fixed.** `reject` prints `[KalsaIroh] KALSA_IROH_OTHER: <message>`
   (code + message only; crate errors carry io::Error text, never key bytes/paths, and
   payloads never become messages). `rejectionCode` maps the uniffi machinery failures
   (fileprivate `UniffiInternalError` — stale handle/unknown enum case/rust panic) to
   `KALSA_IROH_LINKAGE` via a runtime type-name check (type is not nameable across
   files); that is the iOS analog of Kotlin's `is LinkageError`, and `road.ts:38`
   already maps the code (road.test.ts 23/23 still green).
7. **P2 build script — fixed.** (a) missing rustup targets fail before the compile with
   the exact command (`rustup target add aarch64-apple-ios-sim` — proven with a shimmed
   rustup, exit 1); (b) rebuilds only when a `.inputs.sha256` stamp beside the output
   (inside gitignored Generated/) stops matching the hash of Cargo.toml + Cargo.lock +
   src/** — proven: pod-install run built + stamped, standalone re-run reused in 0.08 s
   exit 0; a failed build leaves no stamp, so stale output is never silently linked;
   (c) all three cargo invocations carry `--locked` (Cargo.lock clean in git status).
   `set -euo pipefail` kept; bash-3.2-safe (no arrays under `set -u`).
8. **Release size (iphonesimulator, full bundle, fresh derived data):** `.app`
   **97.9 MB** (100,260 KiB, incl. `main.jsbundle` 7,983,444 B); main binary
   **44,879,568 B** (`__TEXT` 19,398,656 B). iroh contribution from the `-map` link map
   (post-dead-strip): rust staticlib members 7,129,074 B + pod Swift 55,924 B =
   **6.85 MiB (16.0% of the binary)**. **Dead-stripping is ON**: `-Xlinker -dead_strip`
   on the link line and a "Dead Stripped Symbols" section in the map. "Without the
   module" rebuild was not run (pod install + full rebuild too costly); the map number
   is the linked contribution instead.

### Gates (real exit codes)

| gate | result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx jest src/remote/road.test.ts --silent` | exit 0, 23/23 (only TS surface touched is app.config.js — not jest-covered; no other TS file touched) |
| `pod install` (regenerated ios/, runs the new gen script) | exit 0 |
| `xcodebuild … -configuration Debug -sdk iphonesimulator SKIP_BUNDLING=1 build` | exit 0 (`BUILD SUCCEEDED`) |
| simulator relaunch (iPhone 18 Pro, Metro) | `LOG [ios-probe] module present: true` + `LOG [ios-probe] nodeId ok: f210d194f50b6436b099722040d10cc99605b87e20a7ca8c721bed3879390568` |
| `npm ci` then `bash scripts/assert-engine-provenance.sh` | npm ci exit 0; provenance exit 0 ("OK: 1154 files match Aspis0/kalsa.rn@6b87db167a8f") |
| `xcodebuild … -configuration Release -sdk iphonesimulator build` | exit 0 (also the item-8 size source) |

Notes from this round: SDK 57 `expo prebuild --platform ios` (even without `--clean`)
cleared the whole gitignored `ios/` tree — Pods/workspace/build had to be regenerated
via `pod install` (which exercised the new gen script end to end); `ios/.xcode.env.local`
recreated (`NODE_BINARY=/opt/homebrew/opt/node@22/bin/node`). One compile fix during the
round: the iOS 27 SDK's new Foundation has no settable `URL.resourceValues` property —
`setResourceValues(_:)` is the working form (first Debug run exited 65, second exited 0).
