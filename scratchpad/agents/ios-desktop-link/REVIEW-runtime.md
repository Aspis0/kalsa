# REVIEW — runtime correctness + security: Swift bridge vs Kotlin bridge vs Rust crate

Angle: threading/queues, JS-thread blocking, promise settle-once, shutdown/destroy races, deadline handling,
error-code parity, the node key file, secrets in logs/errors, uniffi handle leaks.
Subject: `~/Projects/kalsa-ios` @ `0e4078c4`. Read-only, critique only. Nothing fixed, nothing pushed.

Files read: `modules/kalsa-iroh/ios/KalsaIrohModule.swift` (258 L), `modules/kalsa-iroh/ios/KalsaIroh.podspec`,
`modules/kalsa-iroh/src/index.ts`, `modules/kalsa-iroh/expo-module.config.json`, `plugins/withIrohXcframework.js`,
`scripts/gen-iroh-xcframework.sh`, `modules/kalsa-iroh/README.md`, `modules/kalsa-iroh/android/.../KalsaIrohModule.kt`
(230 L), `native/kalsa-iroh-mobile/src/{lib,bridge,stream,error,runtime}.rs`, the upstream pinned crate
`kalsa-iroh@637b2f7` (`crates/kalsa-iroh/src/{key,bridge}.rs`), the generated uniffi Swift
(`modules/kalsa-iroh/ios/Generated/kalsa_iroh_mobile.swift`), `node_modules/expo-modules-core/ios/Core/Promise.swift`,
`src/remote/{irohBridge,irohHttp,road,doorRoad}.ts`, `src/pairing/{pairingDeskFetch,pairingConfirmation}.ts`,
`src/room/{roomApi,roomStreamWire,roomAppState}.ts`, `app.config.js`, the generated `ios/KalsaAIChat/Info.plist`.

---

## P0 — app-killing trap in the handle conversion

`modules/kalsa-iroh/ios/KalsaIrohModule.swift:235-237`
```swift
  /// JS numbers arrive as Double; tunnel handles are small integers.
  private static func handle(_ id: Double) -> Int64 {
    Int64(id)
  }
```
**CONFIRMED (crash), PLAUSIBLE (reachability).** Swift's `Double → Int64` conversion is a checked
`precondition`, not a saturating cast: I reproduced both failure modes with this machine's toolchain
(Swift 6.4, Xcode 27):

- `Int64(Double.nan)` → `Fatal error: Double value cannot be converted to Int64 because it is either infinite or NaN` → **Trace/BPT trap (SIGTRAP), exit 133**.
- `Int64(v)` with `v > Int64.max` → `Fatal error: Double value cannot be converted to Int64 because the result would be greater than Int64.max` → SIGTRAP.

`handle(_:)` is called on every `read`, `write` and `shutdown` (lines 82, 95, 107 — `Self.handle(id)`),
and the argument is whatever JS put in the `id` slot. `NaN`, `Infinity` and `1e300` are all ordinary JS
numbers, and nothing between `index.ts` (`write(id: number, …)`) and this line validates them.

The Kotlin bridge cannot have this bug: `id.toLong()` is specified to return `0` for NaN and to saturate
at `Long.MAX_VALUE` (`KalsaIrohModule.kt:88` `tunnel(id.toLong())`, `:104` `tunnels.remove(id.toLong())`),
so a bad id degrades to `"no tunnel 9223372036854775807"` — a rejected promise, not a process kill.

Note the asymmetry that makes this a bug and not a style point: the *same file* hardens the other two
`Double` arguments for exactly this hazard —

`KalsaIrohModule.swift:243-249`
```swift
  /// Deadlines cross as doubles and must land on the crate's u32 without
  /// trapping: NaN and negatives clamp to 0 …
  private static func deadlineMs(_ value: Double) -> UInt32 {
    if !value.isFinite {
      return value > 0 ? UInt32.max : 0
    }
```
— and left the third one bare. (`deadlineMs` itself is correct: truncation toward zero, saturating at
`UInt32.max`, NaN → 0 — exact parity with Kotlin's `toUInt()`. No finding there.)

No current JS caller passes a non-integer handle (every `id` in `irohBridge.ts` comes straight from
`openTunnel`), so this is a latent trap rather than a shipped crash today — but it is one refactor away
(`parseInt`, `id ?? NaN`, a persisted handle, a dev screen) and it kills the app with no crash reporter
invocation, no JS stack, and no Android counterpart. Ranked P0 because the failure mode is an
unrecoverable app kill, not a rejected promise.

## P1 — the serial `control` queue breaks the teardown-responsiveness the split exists for

`KalsaIrohModule.swift:32-34`
```swift
  private let control = DispatchQueue(label: "app.kalsa.iroh.control")
  private let parking = DispatchQueue(
    label: "app.kalsa.iroh.parking", attributes: .concurrent)
```
**CONFIRMED.** The Kotlin bridge uses a *pool* for exactly these calls —
`KalsaIrohModule.kt:44-45`:
```kotlin
  private val parking = Executors.newCachedThreadPool()
  private val control = Executors.newFixedThreadPool(4)
```
with the stated reason at `KalsaIrohModule.kt:38-42`:
> `// Control calls (start, node id, open, shutdown) are short and must stay responsive during teardown: a small fixed pool.`

On iOS, `openTunnel` parks the **serial** control queue for the whole dial, and the dial deadline is 10 s
(`kalsa-iroh@637b2f7/crates/kalsa-iroh/src/bridge.rs:103` `dial_timeout: Duration::from_secs(10)`;
`bridge.rs:240` wraps DNS lookup + hole punching + handshake + stream open). While one dial is parked,
*every* control call queues behind it: `nodeId` (`:59`), `startBridge` (`:48`), `shutdown` (`:105`) and
any second `openTunnel` (`:69`).

Two concrete user-visible consequences, both absent on Android:

1. **Shutdown stops being prompt.** `tunnelShutdown(id)` is the JS side's cancel/teardown path
   (`irohBridge.ts:130-137`, `irohHttp.ts` closes the tunnel on abort/error). The Rust latch that cancels
   a parked `read` is only sent when that queued block finally runs — up to ~10 s late. Every read has
   `timeoutMs = 30000` (`irohHttp.ts:142`), so a cancelled stream keeps a live QUIC connection and a
   parked native thread for 10 extra seconds. On Android, with 4 control threads, this does not happen for
   a single in-flight dial.
2. **Concurrent operations serialize.** `establishDoorRoad` dials per operation
   (`doorRoad.ts:76-80`, `roomApi.ts:151`, `roomStreamWire.ts:69`, `pairingDeskFetch.ts:52`). Two
   overlapping operations (a chat turn plus a room refresh, a pairing poll racing a probe) queue their
   dials instead of running them: N×10 s of setup latency where Android would overlap them.

Also note `startBridge` parks the same serial queue for the whole of `MobileBridge(keyPath:)` — which
binds a UDP endpoint and starts the n0 resolvers (`bridge.rs:66-77`) — so `nodeId` can be seconds behind
a bridge start.

Fix direction: `control` should be a concurrent queue (or at least hold only short bookkeeping while the
dial runs on its own queue, like `parking`). The Kotlin 4-thread pool is the parity target.

## P1 — the node key file lands in an iCloud-backed-up directory, in a plain file, while every other app secret is in the Keychain

`KalsaIrohModule.swift:251-257`
```swift
  private static func keyFilePath() throws -> String {
    let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
    // The crate requires the parent directory to exist; iOS creates the
    // container's Application Support lazily.
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base.appendingPathComponent("iroh-node.key").path
  }
```
**CONFIRMED** (path choice) — three problems, in descending order:

1. **It is backed up.** Apple: *"The contents of the `Library` directory (with the exception of the
   `Caches` subdirectory) are backed up by iTunes and iCloud"* (Apple, *File System Basics*,
   FileSystemProgrammingGuide). So `Library/Application Support/iroh-node.key` is written into device
   backups by default — no `isExcludedFromBackup` is set anywhere in the repo (grep for
   `NSURLIsExcludedFromBackupKey` / `isExcludedFromBackup`: zero hits outside this line's absence), and the
   key survives to a new device on restore, so the node identity silently clones across devices. Android
   explicitly does the opposite for exactly this file: `app.config.js:69` `allowBackup: false`.
2. **It is the only long-lived secret not in the Keychain.** `src/pairing/pairingMap.ts:9` ("the one
   pairing map: every pairing this phone holds, as one SecureStore"), `src/pairing/pairingInstallId.ts:16`,
   `src/search/secretStore.ts:6` all use `expo-secure-store`. The iroh node seed — a permanent device
   identity — goes to a file. On iOS a Keychain item is the app's established answer for that class of
   data.
3. **No data-protection class.** The file is created by the crate's `open_temp` with an explicit `0o600`
   mode (`kalsa-iroh@637b2f7/crates/kalsa-iroh/src/key.rs:113-121`) — good, and I verified the whole
   atomicity story below — but nothing sets `FileProtectionType.complete`; the file inherits the
   container default (`completeUntilFirstUserAuthentication`). For a key only ever read in the foreground,
   `.complete` costs nothing.

Worth stating what is **right** about the key handling, because it is easy to get wrong: the crate writes
`iroh-node.tmp` at `0600`, `sync_all()`s, then `rename()`s onto the final name
(`key.rs:71-79`, `:101-110`, `:117-125`) — atomic publication, no torn key, and the leftover-temp case
is cleaned on failure (`key.rs:75-77`). `NodeKey` has a redacted `Debug` (`key.rs:80-84`), the error enum
never carries key bytes (`error.rs`), and `BridgeError::Io(e)` carries `io::Error::to_string()` only —
**REFUTED: no key bytes, and no key path, reach JS or any log.** So the file's *contents* handling is
sound; what is missing is where on iOS the file is allowed to live.

Fix direction: keep the file path (the crate wants a path), but set
`var v = URLResourceValues(); v.isExcludedFromBackup = true` on the directory, or move the key to a
`Caches`-adjacent/explicitly-excluded location, plus `.complete` protection; better still, mint it
through the same SecureStore path the pairing map uses and hand the crate a temp file it can read.

## P2 — a bridge started concurrently with `OnDestroy` is installed *after* cleanup and never released

`KalsaIrohModule.swift:139-155`
```swift
  private func startBridge() throws {
    lock.lock()
    let isDestroyed = destroyed
    lock.unlock()
    if isDestroyed {
      throw IrohCallError(message: "the module is destroyed")
    }
    let started = try MobileBridge(keyPath: Self.keyFilePath())
    lock.lock()
    let previous = bridge
    bridge = started          // <-- no destroyed re-check here
    lock.unlock()
```
vs `OnDestroy` at `:115-133`, which sets `destroyed = true`, empties `tunnels`, nils `bridge` and
releases the old one. **CONFIRMED** (race), pre-existing on Android (`KalsaIrohModule.kt:188` checks
`destroyed` only at entry, `:200-203` then installs). Window = the whole of `MobileBridge(keyPath:)`,
which is not small: it builds a multi-thread tokio runtime, binds a UDP socket, and starts the n0
resolvers (`bridge.rs:66-77`).

Outcome: `bridge` is set *after* the only cleanup pass has run, so nothing ever drops it — a live tokio
runtime, a bound UDP socket, and the relay handle stay alive for the rest of the process, and
`destroyed` then blocks every later `startBridge`, so it can never be cleaned up either. The `tunnels`
dict is likewise permanently empty while the orphan bridge lives.

Fix direction: re-check `destroyed` under the same lock that installs, and drop the fresh bridge outside
the lock if it raced (the `openTunnel` path already does exactly this at `:176-181`).

## P2 — no `NSLocalNetworkUsageDescription`: the same-Wi-Fi desktop link is silently denied on iOS

**CONFIRMED (key absent) / PLAUSIBLE (impact).** The generated plist has no such key — I dumped it:
```
$ plutil -p ios/KalsaAIChat/Info.plist | grep -i localnetwork   -> (nothing; only NSAllowsLocalNetworking)
```
and `app.config.js:22-31` (the whole `ios.infoPlist` block) adds no `NSLocalNetworkUsageDescription`
and no `NSBonjourServices`; no plugin injects one either (`grep -n "NSAppTransportSecurity\|infoPlist\|NSLocalNetwork" plugins/*.js` → nothing).

On iOS 14+, sending to a LAN address without that key is denied and **no prompt is shown**. This commit
introduces the dependency: iroh hole-punches to the candidate addresses the relay reports, which include
private ones, so on the same-Wi-Fi case — the canonical "phone links to my desktop" scenario — the
direct path is refused and the link silently degrades to (or fails on) the relay. iroh's own docs and the
app-store review treat an undeclared local-network use as a rejection risk too. Severity depends on how
often the LAN path is the only working one, which cannot be measured from a simulator.

Fix direction: add the key with a real sentence to `ios.infoPlist` (and consider `NSBonjourServices`
if any local discovery is ever added), then decide with a measurement on a real iPhone on the same LAN.

## P2 — iOS logs nothing for unexpected failures and cannot produce `KALSA_IROH_LINKAGE`

`KalsaIrohModule.swift:105-114` (`shutdown`) is representative; `:206-214`:
```swift
  private func reject(_ promise: Promise, _ error: Error) {
    let message = (error as? LocalizedError)?.errorDescription
      ?? String(describing: error)
    promise.reject(Self.rejectionCode(error), message)
  }
```
**CONFIRMED.** Compare `KalsaIrohModule.kt:141-153`:
```kotlin
    if (code == "KALSA_IROH_OTHER") {
      try { Log.w("KalsaIroh", unexpectedDiagnostic(operation, error)) } catch (_: Throwable) {}
```
Android writes a class-chain-only diagnostic line for every `KALSA_IROH_OTHER`; iOS writes nothing.
Every unexpected iOS failure is then a bare JS rejection whose only trace is a message string — and the
missing code makes it worse: `rejectionCode` (`:219-237`) has no `KALSA_IROH_LINKAGE` arm, though
`road.ts:38` maps that code and the Kotlin bridge produces it (`KalsaIrohModule.kt:135`
`is LinkageError -> "KALSA_IROH_LINKAGE"`). A dyld/symbol-level failure on iOS (wrong slice, missing
`canImport` target) therefore lands in the catch-all `KALSA_IROH_OTHER` bucket and `road.ts:85-92`
reports `reason: "other"` — the one bucket nobody can triage.

Also a parity nit inside `rejectionCode`: `.Io`, `.KeyCorrupt`, `.Config`, `.Transport` carry a `detail`
and the enum is `LocalizedError` with `errorDescription = String(reflecting: self)`
(`Generated/kalsa_iroh_mobile.swift:948-950`), so iOS sends `io(detail: "…")` as the rejection *message*.
`road.ts:84-85` deliberately ignores messages for logging ("its message may contain private details"),
and the app maps failures to fixed copy (`doorRoad.ts:41-43`), so nothing leaks — but iOS surfaces
strictly more native detail to any crash reporter or unhandled-rejection sink than Android does
(there `e.message` is typically null for uniffi Kotlin exceptions and the code falls back to the class
name, `KalsaIrohModule.kt:128-135`). Worth pinning down deliberately rather than by accident.

## P2 — GCD's shared worker pool bounds `parking` at 64 and is shared with `control`

`KalsaIrohModule.swift:9-12`
> `/// Every native call blocks on purpose … so each runs on its own queue: reads and
>  writes (which park up to their deadline) on a concurrent queue, short control calls on
>  the serial one; … a parked read must never starve another call.`

**PLAUSIBLE.** The Kotlin `parking` pool is `newCachedThreadPool()` — unbounded, so N parked reads always
get N threads and each call's deadline starts immediately. A libdispatch concurrent queue does not give
that guarantee: once the root pool's worker count (64 by default) is occupied by parked
`block_on` calls, further `parking.async` blocks **queue**, and the crate's `tokio::time::timeout`
(`stream.rs:130-140`) only starts once the block runs. So with >64 concurrent reads, read latency becomes
`queue wait + timeout` (unbounded), and because `control` and `parking` are different queues over the
*same* worker pool, saturated reads also stall `shutdown`/`nodeId`/`openTunnel`.

I am not rating this higher because the current JS shape keeps concurrency low — `irohHttp` awaits each
read before the next (`:163`), one tunnel per request (`irohHttp.ts:1-8`), and typical callers hold one
or two tunnels — so I could not construct a realistic 65-way fan-out. But the module's own comment claims
the property the queue does not provide, and Android does provide it. If the fan-out ever grows (a room
with many streams), this is the failure: no error, just calls that take 30 s and then return
`KALSA_IROH_DEADLINE`.

## P3 — everything else

- **`_ = previous` / `_ = current` as the release idiom** (`:154`, `:126-132`). The release is an
  invisible side effect of the GCD closure capturing a Swift class reference; the statements do nothing a
  reader can verify, and there is no comment naming the actual dependency. Same trick is used for the
  `OnDestroy` bridge release. It works today (`Generated/kalsa_iroh_mobile.swift:784-791` gives `Tunnel`
  a `deinit` that frees the handle — see below) but it is a leak waiting for a cleanup commit.
- **The parity claims have no test that can fail.** `src/remote/road.test.ts:117-129` reads the *Kotlin*
  file and asserts its 11 codes are mapped (`expect(nativeCodes).toHaveLength(11)`). Nothing reads
  `KalsaIrohModule.swift`, so the iOS module can drop, rename or mistype a code — as it already has, by
  omitting `KALSA_IROH_LINKAGE` — and `tsc` plus the whole targeted jest run stay green. The commit's
  central claim ("same method names, the same `KALSA_IROH_*` rejection codes, the same deadlines") is
  asserted only by a comment.
- **README line 16 is wrong and was edited by this commit**: "Blocking calls run on a bounded fixed pool
  (8 plain threads)" — the Kotlin module is `newFixedThreadPool(4)` for control plus an *unbounded*
  `newCachedThreadPool()` for reads/writes (`KalsaIrohModule.kt:44-45`). The diff rewrote the surrounding
  paragraph and carried the false number forward, and the new iOS bullet (line 26) repeats the
  unverified "same deadlines / same shutdown semantics" claim next to it.
- **Naming/typing nits in the new Swift**: `Self.deadlineMs(max)` at `:96` converts a *byte count*, not a
  deadline (the name lies at the call site); `try self.currentBridge().nodeId()` at `:62` puts `try` on a
  non-throwing call (`Generated/kalsa_iroh_mobile.swift:657` — `open func nodeId() -> String`); the only
  reason the enclosing `catch` is reachable is the throwing `currentBridge()`.
- **`keyFilePath()` force-indexes and can throw**: `[0]` at `:252` is an unchecked subscript (never empty
  on iOS, but a trap if that ever changes), and `createDirectory` failing rejects with
  `KALSA_IROH_OTHER` — a code the Kotlin path cannot produce, since `File(...).path` cannot fail.
- **Export compliance**: the generated plist keeps `ITSAppUsesNonExemptEncryption = false` while the app
  now bundles its own TLS/QUIC stack (rustls) and mints its own key. Standard HTTPS-class use is normally
  exempt, but the platform-provided-TLS assumption behind that flag is no longer literally true; worth a
  deliberate answer before the App Store submission.
- **Swift 6 forward compatibility**: the module class holds `NSLock`-guarded state and is captured
  un-annotated in `@Sendable` closures (`control.async { … self … }`). Fine under `SWIFT_COMPILATION_MODE
  = wholemodule` with Swift 5.9; a move to Swift 6 language mode will reject it without
  `@unchecked Sendable` (the generated uniffi classes carry it: `Generated/kalsa_iroh_mobile.swift:743`).
- **Script/pod install hygiene**: `gen-iroh-xcframework.sh` has no lock, so two concurrent `pod install`s
  would race on `rm -rf "$OUT"`; `cargo` runs during `pod install` can rewrite the committed
  `native/kalsa-iroh-mobile/Cargo.lock` (dirty worktree from a pod install); the first `pod install` on a
  fresh clone needs network to fetch the pinned git dependency and several minutes of release compile,
  with no progress output beyond two `echo`s (`--quiet`). Not user-facing, but it is a new failure mode
  in the iOS dev loop.
- **iOS suspension is unhandled at the bridge level** (no AppState hook in the module). Room streams are
  covered elsewhere (`roomAppState.ts:24-27` pauses on background and re-dials on active), but an in-flight
  chat turn crossing a background/foreground boundary dies with `KALSA_IROH_DEADLINE` after resume, and an
  iroh-paired credential has **no** HTTPS fallback by design (`doorRoad.ts:12-14`, `:84-88`). This is
  inherent to iOS, not a bug in this commit — but the module could at least half-close tunnels on
  `willDestroy`/inactive so the failure is fast and clean instead of a 30 s timeout.

---

## Checked and REFUTED (do not "fix" these)

- **Promise settled more than once.** No path resolves and rejects the same promise: `openTunnel`
  resolves as its last statement (`:186`) and the caller's `catch` can only run if it throws first.
  Structurally it *is* fragile — `openTunnel(nodeHex:lane:promise:)` resolving the promise it was handed,
  inside a function whose caller wraps it in `do/catch`, is one future edit away from a double settle —
  but it is not a bug today. Note `Promise.tryResolve` (`node_modules/expo-modules-core/ios/Core/Promise.swift:80-90`)
  silently no-ops when the app context is gone, so a settle after `OnDestroy` is a no-op, not a crash.
- **JS thread blocked.** Nothing native runs on it: every `AsyncFunction` body immediately hops to
  `control`/`parking`, and Expo's own `AsyncFunctionDefinition` already runs bodies on
  `expo.modules.AsyncFunctionQueue` (`AsyncFunctionDefinition.swift:23`). `promise.resolve/reject` are
  thread-safe: they marshal through `runtime.schedule(priority: .immediate)` (`Promise.swift:80-90`).
- **uniffi handle leaks.** `Tunnel.deinit` and `MobileBridge.deinit` free their handles
  (`Generated/kalsa_iroh_mobile.swift:784-791`, `:624+`); every construction site releases on the failure
  path too (`:176-181` destroys a raced tunnel, `:146` never assigns a failed init). The `tunnels` dict
  is the owner and `OnDestroy` empties it. The one real leak is the orphan bridge of P2-2.
- **The Rust runtime dying under a parked call.** Sound by construction, and I checked the Swift side
  does not break it: a parked call always holds a strong Swift reference (`self.tunnel(id).read(…)`
  keeps the temporary alive for the call; `currentBridge()` returns a strong ref), and the Rust
  `MobileBridge`/`Tunnel` own `SharedRuntime` clones (`bridge.rs:29-33`, `stream.rs:30-38`), so the last
  `RuntimeOwner` cannot drop while a call is parked. `RuntimeOwner::drop` even re-threads the shutdown
  off an async context (`runtime.rs:31-41`). Android's `dropBridge` runs the same release on a pool
  thread.
- **Deadline parity.** `deadlineMs` matches Kotlin's `toUInt()` exactly for NaN, ±inf, negatives,
  truncation and saturation; the crate rejects `timeout == 0` as `Config` on both paths
  (`stream.rs:66-77`). Empty payload → `Config` on both. Bad base64 → `KALSA_IROH_OTHER` on both
  (Android `Base64.decode` throws `IllegalArgumentException`; iOS `Data(base64Encoded:)` returns nil →
  `IrohCallError`). Invalid lane / not-started / unknown handle → `KALSA_IROH_OTHER` on both, matching the
  Kotlin `IllegalArgumentException`/`IllegalStateException` fallback.
- **Secrets in logs or errors.** `KALSA_ROAD` lines carry only `road/lane/stage/reason/ms/node8`
  (`road.ts:98-115`, asserted by `road.test.ts:131-153`); `irohDialReason` reads the code, never the
  message; `NodeKey` has a redacted `Debug`; `BridgeError::Io` carries `io::Error::to_string()` with no
  path; JS never sees or logs the key file path, and no path crosses the bridge from JS. The missing
  backup exclusion (P1-3) is the only secret-hygiene finding.
- **Android regression.** `git diff origin/main -- native/kalsa-iroh-mobile .github/workflows/apk.yml`
  is empty, `expo-module.config.json` only adds `"apple"`, no npm lifecycle hook was added, and every
  workflow in `.github/workflows/` prebuilds Android only — the injected Podfile code cannot run there.
  (The author also reports `diff -r` byte-identity of the Android prebuild output.)
- **Lock held across a blocking native call.** `lock` is taken and released around dictionary/flag
  access only (`:107-111`, `:119-125`, `:141-144`, `:169-184`, `:194-204`); no `NSLock` is held while a
  Rust call parks, so no lock-order deadlock with the crate's tokio mutexes.

## Environment notes

- PATH `node@22` set as instructed; no builds were run (no xcodebuild, no pod install, no cargo).
- Two tiny standalone Swift scripts under `/tmp` (outside the worktree) were used to prove the
  `Int64(Double)` trap; they were deleted afterwards.
- `git -C ~/Projects/kalsa-ios status --porcelain` was empty before and after this review.