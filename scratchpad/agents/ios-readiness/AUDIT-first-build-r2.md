# Hostile re-audit r2: `ffd5867c` (fix round) vs `AUDIT-first-build.md`

Scope: commit `ffd5867c` on local branch `ios/first-build` (base `22f337fd`), repo
`~/Projects/kalsa-ios`. Read-only against both checkouts. No git operations were
performed, no file in any checkout was written, no `npm install`/`npm ci` was run.
Everything executable ran either read-only or against copies in `/tmp/kalsa-r2`.

What I ran (all under 5 min):

- `git -C ~/Projects/kalsa-ios show ffd5867c` (full diff, 1030 lines), `git status`
  before and after (kalsa-ios clean before and after; nothing staged/committed).
- Extracted the injected Ruby block **in memory** (no file written to the repo) and
  ran `ruby -c`, plus a full simulation in `/tmp/kalsa-r2/sim` (stub generator, real
  `ggml-metal-device.m` copy): success, generator-failure, missing-embed cases.
- Drove the plugin's `withPodfile` mod twice against a fake config (idempotency).
- Ran `pod install` in `/tmp/kalsa-r2/podtest` (CocoaPods 1.17.0) to observe real
  Podfile `__dir__` semantics.
- Ran `bash scripts/assert-engine-provenance.sh` (network fetch + `npm pack` happen
  in the script's own mktemp dir; checkout untouched).
- Ran `npx tsc --noEmit`, targeted jest (6 suites), and full jest (296 suites).
- `swiftc -typecheck` (Swift 6.3.3, CommandLineTools SDK) for the observer shape and
  for `import os` + `os_proc_available_memory` visibility; read the installed
  `expo-modules-core` iOS sources for every DSL name used.
- Web lookups for the iPhone 17 family identifiers/chips/RAM and two iPad pairs.

---

## Verdict table (the seven audit items)

| # | Audit item | Verdict |
|---|---|---|
| 1 | Android CI safety / provenance comment | **CONFIRMED fixed**; comment is comment-only and its claims check out on this machine (one P3 fragility) |
| 2 | Ruby in the Podfile injection | **CONFIRMED** — valid Ruby, array-arg `system`, `__dir__` semantics proven under real CocoaPods, scan == generator (34/34 identical, same order), idempotent (1 block, re-run byte-identical) |
| 3 | `os_proc_available_memory` 0/null semantics | **CONFIRMED** at every gate; **REFUTED** the Android-0 regression path (parse failure yields `null`, never `0`); one P2 residual (fail-closed with no environment discrimination) |
| 4 | Swift observers / `import os` / DSL | **CONFIRMED** as far as static checking allows (DSL names/signatures verified against installed sources; `import os` visibility proven with a real swiftc typecheck); full compile still unverifiable (no Xcode) |
| 5 | `appleDeviceClass.ts` values | **CONFIRMED** for the entire iPhone 17 family and both spot-checked iPads; **CONFIRMED defect** in the iPad15,x comment (P3); Mac arm skipped (P2, carried over) |
| 6 | Tests test the subject / restore state | **CONFIRMED** for 5 of 6 touched suites; **CONFIRMED** weak subject in `loadRetryFreshness.test.ts` (source-text assertion) |
| 7 | Anything broken or silently skipped | **CONFIRMED**: audit P2 "iOS reading cached contrary to API contract" only half-fixed while the commit claims "never cached"; Mac 8-GiB fallback skipped; see findings |

Claims in the commit message that I reproduced independently:

- `npx tsc --noEmit exits 0` — **CONFIRMED** (exit 0, 3.9 s).
- `targeted jest exits 0 (52 tests)` — **CONFIRMED** (6 suites, 52 tests, 1.95 s).
- `full jest exits 0 (296 suites / 3070 tests)` — **CONFIRMED** (296/3070, 5.5 s).
- `this machine's tree exits 1 on exactly those 34 generated paths` — **CONFIRMED**
  as to exit 1, `differing entries: 34`, first differing path
  `./vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-embed-argsort.s`, and the
  installed tree contains exactly `34` `ggml-metal-embed-*.s` files. ("Exactly
  those" is one count away from proof — see finding P3-5 for the residual gap.)
- `a fresh npm ci writes no *.s into node_modules/llama.rn` — **CONFIRMED by
  construction** (`npm ci` forbidden here): `package.json` has no lifecycle script
  at all, and the installed `llama.rn` package has no `prepare`/`install` script.

---

## Item 1 — Android CI safety

### 1a. postinstall removal — CONFIRMED

`package.json:5-6`:

> `"scripts": {`
> `    "start": "expo start",`

`grep -rn "postinstall\|prepare\|preinstall" package.json` → no hits. The installed
binding (`node_modules/llama.rn/package.json`) has no `prepare`/`install` either
(only `bootstrap`, `sync:vendor`, `docgen`, `test`, …), so `npm ci` — root or git
dependency — runs nothing that writes into `node_modules/llama.rn`.

Exhaustive search for other writers on the Android path:

- `scripts/gen-metal-embed.js` is referenced nowhere in `.github/workflows` and no
  longer in `package.json`; its only caller is the injected Podfile block.
- All seven workflows run `npx expo prebuild --platform android --no-install`
  (`apk.yml:339`, `bench.yml:208`, `build-kalsa-apk.yml:72`, `dflash-ab.yml:85`,
  `download-repro.yml:48`, `e2e-emulator.yml:157`, `screens.yml:78`). Platform
  filtering is real: `@expo/cli .../prebuild/configureProjectAsync.js:92-94` passes
  `platforms` into `compileModsAsync`, and
  `@expo/config-plugins/build/plugins/mod-compiler.js:167-170`:
  > `if (platforms && !platforms.includes(platformName)) {`
  > `  debug(`skip platform: ${platformName}`);`
  > `  continue;`
  so `withLlamaIosSourceBuild`'s podfile mod body (the only thing that runs the
  generator) never executes on an Android prebuild.
- `scripts/assert-engine-provenance.sh` writes only into its own `mktemp -d` work
  dir (fetched tarball, `npm pack` of the fetched fork); it never writes into
  `INSTALLED`.
- Gate/CI ordering verified: `apk.yml:80 npm ci` → `apk.yml:86 assert` (likewise
  `build-kalsa-apk.yml:54/60`, `e2e-emulator.yml:55/61`) — all before any prebuild,
  and prebuild is Android-only anyway.

**Failure scenario (attempted):** none found. **REFUTED** — the confirmed Android
regression of the base commit is closed.

### 1b. The provenance comment — comment-only diff, claims true

`git show ffd5867c -- scripts/assert-engine-provenance.sh | grep -E "^[+-]" |
grep -vE "^\+\+\+|^---" | grep -v "^+#"` → **empty**: every added line starts with
`#`, zero deletions. **CONFIRMED: no logic change.**

The comment (`scripts/assert-engine-provenance.sh:30-36`):

> `# KNOWN, accepted iOS divergence: on a machine that ran 'pod install',`
> `# plugins/withLlamaIosSourceBuild.js generates the gitignored`
> `# vendor/llama.cpp/ggml/src/ggml-metal/ggml-metal-embed-*.s INSIDE the`
> `# installed tree … The manifest does not exclude them, so this gate reports`
> `# DIVERGENT on exactly those paths there — expected, not tampering. Prove`
> `# the pin itself in a fresh 'npm ci' tree, where no generator has run.`

Claim-by-claim:

1. "generates … INSIDE the installed tree" — **CONFIRMED**: 34 `.s` files exist at
   `node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal/`.
2. "The manifest does not exclude them" — **CONFIRMED**: `manifest()` excludes only
   `./android/.cxx/*`, `./android/build/*`, `./ios/build/*`, `./node_modules/*`.
3. "reports DIVERGENT on exactly those paths" — **CONFIRMED on this machine**:
   `exit=1`, `differing entries: 34`, first path is an embed, embed count = 34.
   The only code that writes embeds is `gen-metal-embed.js:206-211`
   (`fs.writeFileSync(outPath, asm)` for `ggml-metal-embed-<kind>.s` only); no
   podspec script phase writes into the package (`grep script_phase|prepare_command`
   on `llama-rn.podspec` → nothing); no `.DS_Store` inside the package.
4. "fresh `npm ci` tree, where no generator has run" — **CONFIRMED by construction**
   (no lifecycle scripts; see 1a).

Residual (P3-5 below): "exactly 34" is an invariant nobody enforces.

---

## Item 2 — Ruby in the Podfile injection

Extracted block (`plugins/withLlamaIosSourceBuild.js:36-54`), verbatim output of the
extraction:

```ruby
# KALSA_LLAMA_FROM_SOURCE_IOS
ENV['RNLLAMA_BUILD_FROM_SOURCE'] = '1'
kalsa_root = File.expand_path('..', __dir__)
unless system('node', File.join(kalsa_root, 'scripts', 'gen-metal-embed.js'))
  raise "Kalsa: node scripts/gen-metal-embed.js failed (#{$?}) - cannot build the llama.rn Metal embeds"
end
metal_dir = File.expand_path('../node_modules/llama.rn/vendor/llama.cpp/ggml/src/ggml-metal', __dir__)
device_source = File.read(File.join(metal_dir, 'ggml-metal-device.m'))
kinds = device_source.scan(/^\s*X\(\s*[A-Z0-9_]+\s*,\s*([a-z0-9_]+)\s*\)/).flatten
raise 'Kalsa: no GGML_METAL_LIBS entries found in ' + metal_dir if kinds.empty?
missing = kinds.reject { |kind| File.exist?(File.join(metal_dir, 'ggml-metal-embed-' + kind + '.s')) }
unless missing.empty?
  raise 'Kalsa: Metal embed assembly missing for ' + missing.join(', ') + ' in ' + metal_dir
end
```

- **Valid Ruby: CONFIRMED** — `ruby -c injection.rb` → `Syntax OK`; the fully
  generated Podfile (injection prepended to a real template) also `Syntax OK`.
- **`system` array args / no shell: CONFIRMED** — `system('node', File.join(...))`
  is the multi-argument form (execvp, no shell). Paths with spaces/metacharacters
  cannot inject. Empirically invoked a stub `node` twice (T1/T2/T3 below).
- **`__dir__` semantics: CONFIRMED two ways.** (a) Plain-ruby run from a fake
  `ios/` dir resolves `kalsa_root` to the repo root and `metal_dir` to the repo's
  `node_modules` (T4 output: `/private/tmp/kalsa-r2/sim`, `.../sim/node_modules/...`).
  (b) Real CocoaPods: in `/tmp/kalsa-r2/podtest`, a Podfile printing `__dir__` under
  `pod install` printed `/private/tmp/kalsa-r2/podtest` **before**
  "Analyzing dependencies" — CocoaPods evaluates the Podfile with its own path, so
  `__dir__` = `<root>/ios` and `../node_modules/...` and `../scripts/...` are right,
  and the block runs before pod resolution (ENV is set at line 2, before any
  podspec evaluation).
- **Runtime behavior (simulated, `/tmp`, real 34-kind `.m` copy):**
  - T1 clean run: `stub generator wrote 34`, `exit=0`.
  - T2 generator failure (`STUB_FAIL=1`): `RuntimeError: Kalsa: node scripts/gen-metal-embed.js failed (pid 332 exit 1) …`, `exit=1` → pod install dies loudly. **CONFIRMED.**
  - T3 one embed deleted with a no-op generator: `Kalsa: Metal embed assembly missing for rope in /private/tmp/.../ggml-metal`, `exit=1` → names the kind. **CONFIRMED.**
- **Kind scan == JS generator parse: CONFIRMED** (not just argued — executed both on
  the pinned `ggml-metal-device.m`): Ruby `scan` → 34 kinds; `metalLibKinds`'s
  `/^\s*X\(\s*[A-Z0-9_]+\s*,\s*([a-z0-9_]+)\s*\)/gm` (`gen-metal-embed.js:54`) →
  same 34, **identical order** (`diff` empty). Ruby `^` is line-anchored by default,
  JS needs `/m` — both have it. Same file, same regex, same authority (the engine's
  `GGML_METAL_LIBS` table).
- **Idempotency across `expo prebuild` reruns: CONFIRMED.** The mod returns early
  when the marker is present (`withLlamaIosSourceBuild.js:58`
  `if (cfg.modResults.contents.includes(MARKER))`). Driving the mod twice with the
  same template: `occurrences after pass1: 1`, `idempotent (pass2 == pass1): true`,
  `injection before target: true`. Independently: the real generated
  `ios/Podfile` (gitignored, left by the writer's run) contains the marker
  **exactly once** (`grep -c … → 1`), injection at line 1.

No quoting, path, or ordering defect found in the injection.

---

## Item 3 — `0` = no headroom, `null` = unknown (highest-risk item)

### 3a. The 0/null semantics reach every named site — CONFIRMED (quotes)

- `memoryEstimate.ts:201-206` (`fitMemoryEstimate`):
  > `const avail =`
  > `  typeof availableMiB === "number" &&`
  > `  Number.isFinite(availableMiB) &&`
  > `  availableMiB >= 0`
  → `0` becomes `avail = 0`; only `null`/non-finite/negative collapse to `unknown`
  (doc comment `memoryEstimate.ts:189-193` restates it).
- `memoryEstimate.ts:306-315` (`getAvailableMemoryBytes`): iOS branch first,
  `return await getOsAvailableMemoryBytes();` — **uncached**; the process cache
  (`:317 if (cachedAvailableBytes !== undefined) return cachedAvailableBytes;`) is
  now Android-only. `null` from the module returns as `null`.
- `deviceProfile.ts:186-206` (`modelGateVerdict`): `availableMemoryBytes >= 0 && …
  modelNonEvictableMiB > 0` → at 0 with a positive charge → `blocked_ram`;
  `deviceProfile.ts:218-223`: `memoryKnown` now counts `>= 0` so 0 is **known**.
- `deviceProfile.ts:383-390` (`evaluateModelFit`): `availableBytes >= 0` → 0 MiB
  reaches `fitMemoryEstimate` → `does_not_fit` → `model.tooLarge`.
- `deviceProfile.ts:479-482` (`decidePreSendFit`): `fit.verdict === "does_not_fit"`
  → `{ allow: false, reasonKey: "model.tooLarge" }` at 0.
- `modelGateRAM.ts:105-116` (`gateOptionFit`): `input.availableMemoryBytes >= 0`
  → option prices `does_not_fit` instead of `unknown`.
- `engineGateHelpers.ts:167-172` (`profileWithFreshMemory`): `>= 0` — a fresh 0
  **replaces** the cached sample instead of keeping a stale positive one.
- `monitor.ts:59-78` (`getAvailableMemoryBytesUncached`): iOS branch returns the raw
  module value (0 passes); doc comment `:56-58` states 0 is real. No comparison was
  changed in `monitor.ts` (diff is comment-only there).
- `modules/kalsa-lifecycle/src/index.ts:136-141`: `value < 0` → null; `0` accepted.

Tests pin all of this (`memoryEstimate.test.ts:26-45`, `deviceProfile.test.ts:88-141`,
`loadGate.test.ts:55-65`, `monitor.test.ts:21-43`), and I ran them (52 passed).

### 3b. Android reachability of a 0 that previously meant "unknown" — REFUTED as a regression

The audit's specific hypothesis (parse failure returning 0):

- `memoryEstimate.ts:263-267`:
  > `const m = /^MemAvailable:\s*(\d+)\s*kB\s*$/m.exec(meminfoText);`
  > `if (!m) return null;`
  > `const kB = Number(m[1]); … return kB * 1024;`

  Missing key, missing `kB`, unreadable file, non-string input — every failure mode
  returns **`null`**, never `0`. `Number(m[1])` only ever sees `\d+` (can't be `""`
  or `NaN`).
- `monitor.ts:70-77`: `Platform.OS !== "android" → null`; `text == null → null`;
  `return parseMemAvailableBytes(text)` — same null-on-failure.
- `memoryEstimate.ts:317-335`: Android caches the **parse result** (`null` allowed);
  the iOS module is only invoked under `Platform.OS === "ios"` (`:308`), and
  `monitor.ts:63` likewise. `getOsAvailableMemoryBytes` is unreachable on Android.
- `deviceProfile.ts:687 availableMemoryBytes` comes from
  `getAvailableMemoryBytes()` (`:669`) — same parse. (`asNullablePositiveNumber`,
  `:561-564`, is applied only to `Device.totalMemory` (`:642`), never to the
  available reading, so a genuine iOS 0 is not filtered to null on the profile path —
  the new test `deviceProfile.test.ts:78-81` asserts `availableMemoryBytes === 0`.)

Therefore the only way any **changed** comparison (`deviceProfile.ts:192`,
`:221`, `:387`; `memoryEstimate.ts:204`; `modelGateRAM.ts:109`;
`engineGateHelpers.ts:169`) can see `0` on Android is a literal
`MemAvailable:       0 kB` line from the kernel — a true zero-headroom reading,
which previously fail-opened as "unknown" and now fail-closes. That is a semantic
delta on Android, but it cannot be produced by a parse failure or by the iOS module,
and a literal zero MemAvailable is not a state Linux reports outside total collapse.
**REFUTED: the hypothesized Android regression (0-from-parse-failure) does not
exist. PLAUSIBLE (theoretical only): genuine-0 now blocks on Android too.**

### 3c. Residual risk the fix creates — see finding P2-1 below (fail-closed, no environment discrimination).

---

## Item 4 — Swift

### 4a. Block-based observers — CONFIRMED

`KalsaThermalModule.swift`:

- Token retained: `:18 private var observerToken: NSObjectProtocol?`;
  `:48 observerToken = NotificationCenter.default.addObserver(forName:object:queue:)`.
- Removed on stop and destroy: `:35-37 OnStopObserving { self.stopObservingThermalState() }`,
  `:39-41 OnDestroy { self.stopObservingThermalState() }`,
  `:58-62 stopObservingThermalState` (`guard let token` → `observerToken = nil` →
  `removeObserver(token)`).
- No double add: `:45 guard observerToken == nil else { return }`. Expo itself only
  fires `OnStartObserving` at listener-count 0→1
  (`EventObservingDefinition.swift:58-64`), and even a spurious re-fire is absorbed
  by the guard; stop→start re-registration creates a fresh token. **CONFIRMED.**
- `OnDestroy` is real: `EventListenersFactories.swift:11-13` →
  `EventListener(.moduleDestroy, …)`, posted at `ModuleHolder.swift:174`. **CONFIRMED.**
- `[weak self]` in the block: no retain cycle; after module dealloc the block
  no-ops.

### 4b. `sendEvent` thread safety — behavior CONFIRMED, comment's rationale REFUTED

`KalsaThermalModule.swift:49-51`:

> `// .main: thermalStateDidChangeNotification posts on the main thread, and`
> `// sendEvent must not race the JS event emitter off it.`

The reason is wrong: `BaseModule.sendEvent`
(`expo-modules-core/ios/Core/Modules/Module.swift:23-25`) calls
`appContext?.eventEmitter?.sendEvent(...)`, and
`LegacyEventEmitterCompat.swift:25-31` immediately does `runtime.schedule { … }`,
marshalling onto the JS runtime thread itself — `sendEvent` is safe from any thread.
Queue `.main` is harmless (and guarantees snapshot ordering); the code is fine, the
comment overstates. Also note `OnStartObserving` runs as an Expo
`AsyncFunctionDefinition` (`EventObservingDefinition.swift:51`), i.e. possibly off
the main thread, while `observerToken` is mutated — start/stop come from Expo's
module queue and the block from `.main`, but nothing marks `observerToken`
`@unchecked Sendable`/atomic. Theoretical, not practical. **PLAUSIBLE (P3).**

### 4c. `import os` — CONFIRMED (proven, not assumed)

`KalsaLifecycleModule.swift:15 import os`; the module contains no other Foundation
symbol, `import UIKit` correctly removed (no UIApplication use remains).

`swiftc -typecheck` (Swift 6.3.3) on:

```swift
import os
let x = os_proc_available_memory()
```

→ `error: 'os_proc_available_memory()' is unavailable in macOS` with
`note: … has been explicitly marked unavailable here` pointing at
`os/proc.h:87` — i.e. **the declaration is found via `import os`** (not
"cannot find in scope", which was the audit's failure hypothesis). `os/proc.h` in
the SDK reads:

> `API_UNAVAILABLE(macos) API_AVAILABLE(ios(13.0), tvos(13.0), watchos(6.0))`
> `extern size_t os_proc_available_memory(void);`
> `@result … 0 is returned if the calling process is not an app, or the calling`
> `process exceeds its memory limit.`

Deployment floor 16.4 ≥ iOS 13 availability; macOS is excluded because the pod
targets iOS only. The audit's P1-c is **REFUTED as a compile failure** to the extent
static tooling can decide (no Xcode → no full build; see boundary).

### 4d. Compiles against the installed expo-modules-core DSL — CONFIRMED as to names/signatures

Every identifier in both files exists in `node_modules/expo-modules-core/ios` with
matching shapes:

- `AnyModule.swift:6 public protocol AnyModule: AnyObject, AnyArgument`;
  `Module.swift:10 public typealias Module = AnyModule & BaseModule`;
  `BaseModule` is `open class BaseModule` (not an NSObject) → the comment at
  `KalsaThermalModule.swift:11-14` ("does not inherit NSObject, so @objc/#selector
  … cannot compile") is **true**.
- `Module.swift:23 public func sendEvent(_ eventName: String, _ body: [String: Any?] = [:])`.
- Factories: `Name` (`ModuleFactories.swift:4`), `Events` (`ObjectFactories.swift:33`),
  `OnStartObserving`/`OnStopObserving` (`ObjectFactories.swift:47/54`, both
  `@_implicitSelfCapture … -> EventObservingDefinition`),
  `OnDestroy` (`EventListenersFactories.swift:11`), `Function<R>` with **no
  constraint on R** (`SyncFunctionFactories.swift:20-30`, conversion via
  `appContext.converter.toJS(result, returnType, …)` `SyncFunctionDefinition.swift:104`),
  `AsyncFunction<R>` (`AsyncFunctionFactories.swift:20-30`), `Int64: AnyArgument`
  (`AnyArgument.swift:45`).
- `definition()` implementations get `@ModuleDefinitionBuilder` implicitly
  (`AnyModule.swift:17-18`), so the multi-statement bodies are legal.

Independent shape checks with `swiftc -typecheck` (pure Swift, `/tmp`):
`sendEvent("evt", [String: Any] value)` compiles (value-to-optional promotion into
`[String: Any?]` is legal — this call existed in the base commit but had never been
compiled by anyone), and the `observerToken` + `guard let self else` +
`removeObserver(token)` shape compiles clean under Swift 6.3.

Foundation visibility through `import ExpoModulesCore` alone (the thermal file has no
`import Foundation`): **CONFIRMED by empirical precedent** — shipped Expo modules do
exactly this: `node_modules/expo-battery/ios/BatteryModule.swift:1` is
`import ExpoModulesCore` (only import) and uses `ProcessInfo` (`:26`) and
`NotificationCenter` (`:45-59`); `expo-clipboard/ios/ClipboardModule.swift:1` same,
uses `NotificationCenter` (`:99`). Those compile in every production iOS build of
those packages.

Residual: no actual Xcode compile was possible; exotic issues (macro/expansion,
optimization-only diagnostics) remain unverified. **PLAUSIBLE only in the
"never-built branch" sense.**

---

## Item 5 — `appleDeviceClass.ts` vs sources

Header cites (`appleDeviceClass.ts:19-27`): adamawolf gist (identifiers), Apple tech
specs 125089/125090/125091/125092/126470 (chips), MacRumors Xcode-26 report (RAM),
EveryMac A3575 (17e).

Spot-checks performed (web):

| Entry (file:line) | Claim | Evidence | Verdict |
|---|---|---|---|
| `appleDeviceClass.ts:55` `"iPhone18,1": A19 Pro / 12 GiB` | 17 Pro, A19 Pro, 12 GB | appledb `iPhone18,1` → iPhone 17 Pro, SoC A19 Pro; MacRumors (Xcode 26): 17 Pro 12 GB; Apple 125090 = "iPhone 17 Pro - Tech Specs" | CONFIRMED |
| `:56` `"iPhone18,2": A19 Pro / 12 GiB` | 17 Pro Max | appledb/DeviceAtlas → 17 Pro Max; MacRumors: Pro Max 12 GB; 125091 = "iPhone 17 Pro Max - Tech Specs" | CONFIRMED |
| `:57` `"iPhone18,3": A19 / 8 GiB` | base 17 | appledb `iPhone18,3` → iPhone 17, SoC A19; MacRumors: 17 = 8 GB; 125089 = "iPhone 17 - Tech Specs" | CONFIRMED |
| `:58` `"iPhone18,4": A19 Pro / 12 GiB` | iPhone Air | appledb/ipswdl `iPhone18,4` → SoC A19 Pro; MacRumors: Air = 12 GB; 125092 = "iPhone Air - Tech Specs" | CONFIRMED |
| `:59` `"iPhone18,5": A19 / 8 GiB` | 17e (2026) | appledb `iPhone18,5` → SoC A19, model A3575; 126470 cited for 17e. RAM 8 GB is single-sourced (EveryMac A3575) — Apple publishes none | CONFIRMED (RAM: single source, PLAUSIBLE+) |
| Apple article IDs in header | 125089/90/91/92 = 17 / 17 Pro / 17 Pro Max / Air | fetched titles exactly | CONFIRMED |
| `:74-75` `iPad15,3/iPad15,4 = M3 / 8 GiB`, comment `:73 // M3 iPad Air 11" / 13"` | both M3 Air | appledb/iPad Air: **`iPad15,3`,`iPad15,4` are BOTH the 11-inch M3 Air**; the 13-inch is `iPad15,5`/`iPad15,6` (ipswdl iPad15,5 = "iPad Air 13-inch (M3)", EveryMac iPad15,6) | values CONFIRMED; **comment CONFIRMED WRONG** (see P3-3); 13-inch M3 Air unmapped |
| `:85-88` `iPad16,3/iPad16,4 = M4 / 8 GiB` | iPad Pro 11" M4 | appledb: iPad Pro 11-inch (M4) = `iPad16,3`,`iPad16,4` | CONFIRMED (8 GiB = base-tier, and header `:11-12` documents 16-GiB variants recorded as 8 GiB — true and conservative) |
| Unknown → null | `:96 return null` after exact lookup and the Mac arm; prefix arm deleted | test `appleDeviceClass.test.ts:43-48` asserts `iPhone18,9`/`iPhone18,6`/`iPhone19,1` → null | CONFIRMED |

Mac arm (`:97-99 if (id.startsWith("Mac")) … EIGHT_GIB`) — unchanged from the base
audit's P2 (arbitrary 8 GiB, not a property of the identifier). Not mentioned in the
fix round. See P2-3.

---

## Item 6 — Tests

| Suite | Subject actually exercised? | State restored? | Verdict |
|---|---|---|---|
| `appleDeviceClass.test.ts` | yes — calls `appleDeviceClassForModelId` on all 5 new IDs + null cases | no globals/mocks at all | CONFIRMED sound |
| `deviceProfile.test.ts` | yes — drives the real `getCachedDeviceProfile` → `buildDeviceProfile` (the exact site of the ramTier bug) with mocked RN/expo-device/module; asserts `totalMemoryBytes`/`ramTier`/`socModel`/`availableMemoryBytes=0` | `:42-46 beforeEach` → `__resetDeviceProfileCacheForTests()` (export exists, `deviceProfile.ts:732`), `mockAvailableMemoryBytes.mockReset()`, mock fields re-seeded; `jest.mock` is file-scoped | CONFIRMED sound |
| `memoryEstimate.test.ts` | yes — `fitMemoryEstimate` (0/null/neg/NaN), `getAvailableMemoryBytes` (0, non-caching, null) | `:51-53 beforeEach` → `__resetAvailableMemoryCacheForTests()` (`memoryEstimate.ts:341`) | CONFIRMED sound; gap: no Android-branch test for the relocated cache check (P3-6) |
| `monitor.test.ts` | yes — pass-through of 0/positive/null + re-read | `mockReset` in `beforeEach`; module stateless | CONFIRMED sound |
| `loadGate.test.ts:55-65` | yes — end-to-end `gateModelLoad` with `getAvailableBytes → 0` → `allow:false`, `refusedBy:"fit"` | fresh `baseInput()` per test | CONFIRMED sound |
| `loadRetryFreshness.test.ts:36-37` | **no — asserts source text**: `expect(HELPERS).toContain("availableMemoryBytes >= 0")` / `not.toContain("&& availableMemoryBytes > 0")` | n/a (reads files) | CONFIRMED weak subject (P3-4): passes even if the comparison were unreachable elsewhere; style consistent with the pre-existing tests in that file, but it is not a behavior test |

No test mutates globals outside its file registry (checked `jest.config.js` +
`jest.mock` usage); full suite 296/3070 green — no cross-file leakage observed.

Untested surfaces (both claimed by the commit message but only asserted in prose):
fresh-`npm-ci` purity, `pod install` generator invocation, Ruby guard completeness,
and any Swift compilation. The commit does disclose the last one.

---

## Findings, ranked

### P2-1 — PLAUSIBLE: the fix flips 0 to fail-closed with no environment discrimination and no escape hatch

> `os/proc.h:85-88` (SDK) — `… @result The remaining bytes. 0 is returned if the
> calling process is not an app, or the calling process exceeds its memory limit.`

> `deviceProfile.ts:192` — `availableMemoryBytes >= 0 &&` … `:204 return verdict(false, "blocked_ram");`
> `deviceProfile.ts:387` — `availableBytes >= 0` → `:395 { verdict: "does_not_fit", reasonKey: "model.tooLarge" }`
> `modelGateRAM.ts:109` — `input.availableMemoryBytes >= 0` → option `does_not_fit`

The audit demanded that 0 reach the gates, and it does. The unfixed half is that 0
has two meanings in Apple's own contract, and the code can now only ever see the
fatal one. Concrete failure scenario: on any environment where the function returns
0 for "not an app"/unsupported semantics rather than over-limit (Designed-for-iPad
on Mac, possibly simulator — the base audit explicitly recorded that "the commit
contains no execution evidence that the function returns zero" in those
environments, and this commit adds none), every model load, every pre-send fit, and
every RAM-priced option is hard-refused with `model.tooLarge`/`blocked_ram`, forever,
with no diagnostic distinguishing "over limit" from "API meaningless here", and no
corroboration check (e.g. against `totalMemoryBytes` or repeated samples). Xcode
still absent; the commit itself lists "Swift compilation, the Metal assembly link,
on-device runs" as unverified. Not a violation of the audit mandate — a residual
risk left undiagnosed and undisclosed. **PLAUSIBLE.**

### P2-2 — CONFIRMED: audit P2 ("iOS reading cached contrary to its API contract") is only half-fixed, and the commit message claims otherwise

> commit message — `The iOS read is never cached: getAvailableMemoryBytes()
> re-reads os_proc_available_memory on every call (Apple: don't cache it); only the
> Android /proc read stays process-cached.`

But the second cache the original audit named is untouched:

> `deviceProfile.ts:687` — `availableMemoryBytes,` (stored in the profile object)
> `deviceProfile.ts:706-710` — `export function getCachedDeviceProfile(): Promise<DeviceProfile> { if (!cachedProfilePromise) { cachedProfilePromise = buildDeviceProfile()…`
> `src/screens/SettingsScreen.tsx:1436` — `availableMemoryBytes: deviceProfile.availableMemoryBytes,`
> `src/host/engineGateHelpers.ts:153-156` — `getCachedDeviceProfile() freezes availableMemoryBytes for the process …`

`buildDeviceProfile` calls `getAvailableMemoryBytes()` exactly once
(`deviceProfile.ts:669`) and the process-lifetime profile keeps that number for the
life of the app. `profileWithFreshMemory` rescues only `confirmDownloadGate.ts:53`;
the Settings model picker (three call sites: `SettingsScreen.tsx:1332, 1436, 1453`)
still prices gates against the frozen sample. Failure scenario: app starts with
2 GiB headroom, user later sits at an over-limit 0 — the picker keeps saying the
model fits; conversely a 0 read at first launch sticks as blocked_ram for the whole
session even after memory recovers. The blanket "never cached" sentence in the
commit message is therefore false as written, and the fix round does not say it
left this half open. **CONFIRMED** (carried-over audit P2, silently under-fixed).

### P2-3 — CONFIRMED (skipped silently): the all-Mac 8-GiB fallback from audit P2 is unchanged and unmentioned

> `appleDeviceClass.ts:97-99` — `if (id.startsWith("Mac")) { return { chipClass: "Apple Silicon", ramBytes: EIGHT_GIB }; }`

The commit message enumerates P1-a/b/c and the identifier-map half of P2; the Mac
arm (audit P2: "an arbitrary 8-GiB value … fabricated and can understate the host's
memory class") appears nowhere. Still the same fabricated fallback.
**CONFIRMED skipped.**

### P3-1 — CONFIRMED: `iPad15,4` is mislabeled; the 13-inch M3 Air is silently unmapped

> `appleDeviceClass.ts:73-75` — `// M3 iPad Air 11" / 13".` / `"iPad15,3": …` / `"iPad15,4": …`

Sources say `iPad15,3`/`iPad15,4` are **both** the 11-inch M3 Air (Wi-Fi and
cellular); the 13-inch is `iPad15,5`/`iPad15,6`. Failure scenario: none functional —
chip/RAM values are right either way — but the comment claims 13-inch coverage that
does not exist, and a real 13-inch M3 Air returns `null` (generic fallback) while
its 11-inch sibling maps. Comment wrong, data harmless. **CONFIRMED.**

### P3-2 — CONFIRMED: guard accepts any existing `.s`, and nothing ever prunes stale embeds

> `withLlamaIosSourceBuild.js:50` — `missing = kinds.reject { |kind| File.exist?(...) }`
> `node_modules/llama.rn/llama-rn.podspec:47` — `"#{llama_cpp}/ggml/src/ggml-metal/*.{h,m,cpp,s}",`

Existence-only check (content/freshness unverified), and `gen-metal-embed.js:200-210`
writes but never deletes. After a future binding pin that *drops* a kind, a stale
`ggml-metal-embed-<old>.s` survives, gets compiled by the podspec glob (harmless
extra symbols), and the provenance gate's "exactly those paths / 34" comment becomes
stale count. Interrupted-generation is genuinely covered (the generator runs first
and raises nonzero — T2/T3), so the original P2's partial-set scenario is closed;
this is the residue. **CONFIRMED (latent).**

### P3-3 — CONFIRMED: the new `loadRetryFreshness` test asserts source text, not behavior

> `loadRetryFreshness.test.ts:36-37` — `expect(HELPERS).toContain("availableMemoryBytes >= 0");`
> `expect(HELPERS).not.toContain("&& availableMemoryBytes > 0");`

It would pass if the corrected comparison sat in dead code; the `not.toContain` is
vacuously true of the current source. Consistent with the file's pre-existing style,
but it is a grep, not a test of `profileWithFreshMemory`. The behavioral companion
test (fresh 0 replaces the cached sample) does not exist. **CONFIRMED.**

### P3-4 — CONFIRMED: provenance comment is true but operationally empty; "exactly 34" is unenforced

The comment (`assert-engine-provenance.sh:30-36`) documents the divergence but gives
no verification procedure: on an iOS dev machine the gate can now *never* exit 0,
and stderr prints only the first differing path plus a count. Nothing tells the
operator "count must equal the embed count". Two concrete ways "exactly those paths"
breaks without any tampering: stale embeds after a pin bump (P3-2), and any stray
file a Finder/IDE drops inside the package (`.DS_Store` audit: none present today).
The script also prints no list of the 34 paths on divergence. **CONFIRMED (process
gap, not a logic bug).**

### P3-5 — PLAUSIBLE: `system('node', …)` is PATH-dependent; failure message can be empty

> `withLlamaIosSourceBuild.js:43-44` — `unless system('node', File.join(kalsa_root, 'scripts', 'gen-metal-embed.js'))` / `raise "… failed (#{$?}) …"`

Array-arg form is injection-safe (**CONFIRMED**), but if `node` is not on the
invoking environment's PATH (GUI-launched Xcode, sanitized CI image), `system`
returns `nil`, `$?` is `nil`, and the raise prints `failed ()` — loud, but the
message misdirects (blames the generator instead of "node not found"). `pod install`
from a terminal/`expo run:ios` is fine (verified by simulation). **PLAUSIBLE.**

### P3-6 — CONFIRMED: an Android regression test for the relocated cache check is missing

The only Android-relevant logic change in `memoryEstimate.ts` is moving
`if (cachedAvailableBytes !== undefined) return …` from first line (`:305` pre-fix)
to after the iOS branch (`:317`). Every new test pins `Platform.OS = "ios"`
(`memoryEstimate.test.ts:9`, `monitor.test.ts:9`, `deviceProfile.test.ts:9`).
No test asserts the Android cache still hits, or that an iOS read cannot poison/
read the shared `cachedAvailableBytes`. The behavior is provably unchanged by
inspection (see item 3b), but the suite that claims to cover "both cached and
uncached readers" never runs the Android arm. **CONFIRMED (coverage gap).**

### P3-7 — CONFIRMED: `addTrimMemoryListener` is now a documented permanent no-op on iOS, with no guard

> `modules/kalsa-lifecycle/src/index.ts:101-105` — `Android-only by definition: the Apple lifecycle module deliberately does not re-emit…`

Removing the dead iOS event matches audit P3 and nothing consumed it (repo-wide grep
for `addTrimMemoryListener` outside its definition: zero hits). But the JS function
still happily subscribes on iOS (`:105-118` has no `Platform` check) and will return
a live-looking subscription that can never fire. Documented, consumerless, low harm.
**CONFIRMED (dead API surface, knowingly kept).**

### P3-8 — REFUTED-as-defect / noted: `modelGateVerdict` still says "ok" for zero headroom when the charge is unknown

> `deviceProfile.ts:197-206` requires `modelNonEvictableMiB > 0` to block;
> `deviceProfile.test.ts:82-89` asserts `availableMemoryBytes: 0, modelNonEvictableMiB: null → allowed: true, reason: "ok"`.

At a genuine over-limit 0, a caller whose estimate fails open (null charge) gets
green "ok". Enshrined by test, so deliberate — but it means "0 is known" and
"nothing needs charging" collapse into the same verdict. **CONFIRMED behavior,
intent debatable.**

---

## What the fix round got right (hostile but fair)

- Every mechanism the base audit's four P1/P2 items identified was actually
  exercised, and I could reproduce each claimed verification locally (ruby, pod,
  jest, tsc, gate exit codes, swiftc symbol visibility).
- The Ruby injection is the strongest part: valid, injection-safe, `__dir__`
  correct under real CocoaPods, generator-failure and partial-set failure both
  raised loudly in simulation, marker-guard idempotent in code and in the real
  generated `ios/Podfile`.
- The Android CI hole is genuinely closed, and proven at three independent layers:
  no lifecycle scripts anywhere in the install path, platform-filtered prebuild mods,
  gate ordering in all seven workflows.
- The 0/null semantics are wired end-to-end exactly as the audit demanded, with
  behavioral tests at four levels (pure fit, gate verdict, pre-send fit, load gate).
- `import os` — the base audit's highest-confidence compile fear — is wrong, and I
  disproved it with a real compiler rather than an assertion.
- Identifier table: five-for-five on the iPhone 17 family including chips and RAM,
  with Apple's own article IDs resolving exactly as cited.

## Residual boundary (unchanged)

No Xcode → no Swift compile, no link of the 34 `.s` files, no simulator/device run,
no confirmation of what `os_proc_available_memory()` returns on Mac/simulator.
`npm ci` was forbidden, so the fresh-install purity claim is verified by code
inspection and gate structure rather than reproduced. Nothing in either checkout was
modified; `git status` in `kalsa-ios` is clean before and after this audit.
