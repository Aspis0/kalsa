# Hostile audit — `5e25e717` + `cc217efb` (iOS follow-ups + iOS KV cache default)

Auditor pass. **Read-only.** No file in `~/Projects/kalsa-ios` was modified:
`git status --porcelain` empty before and after, `git diff --quiet HEAD` clean on
every audited file, HEAD `cc217efb` on `ios/first-build`. All mutations ran in a
throwaway `git archive HEAD` tree at `/tmp/mut` with `node_modules` symlinked
back; the audited worktree was never touched. No device was touched.
`export PATH=/opt/homebrew/opt/node@22/bin:$PATH` was set per command; no env var
was mutated, nothing exported outside a single shell.

Scope: `git diff d6d0f425..cc217efb` — 2 commits, 21 files, +341/−143.
Baseline note: `d6d0f425` is **not** an ancestor of `main`; `main` (`de52fdf1`) is
an ancestor of it, so the branch is 19 commits ahead of main. "Android parity"
below is measured against `5e25e717` (the parent of the two commits), which is
what "origin/main does" means for these files.

Executed, with real exit codes:

| command | exit |
|---|---|
| `npx tsc --noEmit` | 0 |
| `npx jest` kvCacheProfile, kvCachePref, contextProfile, deviceTuning, loadGate (5 suites, 46 tests) | 0 — matches the commit's "46 tests" claim exactly |
| `npx jest` sessionPersistence | 0 |
| `npx jest` deviceProfile, appleDeviceClass, monitor, memoryEstimate (4 suites, 38 tests) | 0 — matches `5e25e717`'s "38 tests" claim exactly |
| `npx jest` copyTruth, sheetCopyVisible, reportStrings | 0 |
| `xcrun swiftc -parse` on both touched Swift files | 0 / 0 |
| `xcrun -sdk {iphoneos,iphonesimulator} swiftc -typecheck -target arm64-apple-ios16.4[-simulator]` on the `isiOSAppOnMac` + `NSLock` patterns | 0 / 0 |
| mutation M7 (revert the load path) over **all** `src/engine` + `src/host` suites (177 suites, 1712 tests) | 0 — see §4 |

## Verdict table

| # | area | finding | verdict |
|---|---|---|---|
| 1.1 | Android compute | all 8 resolution sites compute byte-identical values on Android | CONFIRMED clean |
| 1.2 | Android render | the two row **labels** are byte-identical on Android (en + it) | CONFIRMED clean |
| 1.3 | Android render | the **hint** is NOT byte-identical: `settings.kvCacheHint` was rewritten for both locales | **CONFIRMED defect** (commit claim REFUTED) |
| 1.4 | Android render | the `> 0` gate hides the "High costs N MiB more" line only under a bench `nctx` < 128 | CONFIRMED, bench-only, low |
| 1.5 | robustness | `resolveKvCacheProfile` dropped the per-field `?? "q8_0"` / `?? "q4_0"` fallbacks; a partial profile now yields `undefined` | PLAUSIBLE (not reachable today) |
| 1.6 | jest | `require("react-native")` **throws** in this repo's jest config, so `isIos()` is `false` in every suite that does not mock it | CONFIRMED (measured: 178 µs/call) |
| 2.1 | iOS paths | every path that reaches the engine resolves q8_0/q8_0 (init options, governor lane, engineOverride, bench, remote, NPU lane) | CONFIRMED clean — no q4_0 V reaches the engine on iOS |
| 2.2 | iOS `.kvs` | the discard really is the existing `cacheTypeV` compare, no new mechanism | CONFIRMED |
| 2.3 | iOS truthfulness | an explicit "Standard" is silently overridden; the label shows the bits and a note explains it | CONFIRMED acceptable |
| 2.4 | iOS evidence | the justification is a **Mac** llama-bench run at 2048 decode depth; the app ships n_ctx 16384 where only the mixed pair was measured | **CONFIRMED defect** (durable false claim in code + commit) |
| 3.1 | Swift lock | no deadlock, no lock held across `sendEvent`, every `observerToken` access is inside the lock | CONFIRMED correct |
| 3.2 | thermal timeout | the 1 s bound does NOT establish the invariant the commit claims — the same `sample()` then hits a second, **unbounded** native call | **CONFIRMED defect** |
| 3.3 | `isiOSAppOnMac` | semantics + availability verified against the iPhoneOS 27 SDK; guard is correct | CONFIRMED correct |
| 3.4 | Apple gate | the gate bites (test M6), but `ramBytes` was left in place as dead data while the header was reworded | CONFIRMED (dead data / "fallback removed" is half true) |
| 3.5 | deviceProfile | a new **unguarded** `require("react-native")` is the only bare probe in the file | CONFIRMED (new failure mode, contained by `.catch`) |
| 4.1 | pins | the iOS pin and the Android pin both bite (M1, M2); loadGate's iOS pin bites (M3) | CONFIRMED |
| 4.2 | coverage | contextProfile, deviceTuning and **the load path itself** can each be reverted with the whole suite green (M4, M5, M7) | **CONFIRMED defect** (the commit's central invariant is unpinned) |
| 5.1 | commits | every "Verified:" line I re-ran reproduces exactly | CONFIRMED accurate |
| 5.2 | comments | stale `loadGate` comment kept through the rewrite; stale live doc; "Xcode 26" on an Xcode 27 box | CONFIRMED (minor) |

Nothing here is a correctness regression on Android and nothing hands a q4_0 V
cache to the engine on iOS. The two findings I would not merge without a fix are
**2.4** (a durable, false measurement claim that the next engineer will cite) and
**4.2** (the rule that motivated the commit has no test on the load path).

---

## 1. Android behaviour change, site by site

`isIos()` is false on Android by construction, so `resolveKvCacheProfile`
(`src/engine/kvCacheProfile.ts:48-54`) reduces to `choice ?? catalog ?? {q8_0,
q4_0}`. That is what I compared against each pre-commit line.

### 1.1 Compute — CONFIRMED identical

| site | before (`5e25e717`) | after (`cc217efb`) | Android result |
|---|---|---|---|
| `engineEnsureLoad` | `:165 kvCache: kvCache ?? model.kvCache` | `:167 kvCache: resolveKvCacheProfile(kvCache, model.kvCache)` | identical (`kvCache` may only be a complete `KV_CACHE_CHOICES` entry — `kvCachePref.ts:40-43`) |
| `contextProfile` | `:204-205 input.kvCache?.k ?? "q8_0"` / `?.v ?? "q4_0"` | `:209 resolveKvCacheProfile(input.kvCache, null)` | identical; `kvCache` never reaches the n_ctx branch (grep: `contextProfile.ts` touches `kvCache` only at `:209`) |
| `deviceTuning` | `:744-745 input.model.kvCache?.k ?? "q8_0"` / `?.v ?? "q4_0"` | `:746 resolveKvCacheProfile(input.model.kvCache, null)` | identical |
| `loadGate` | `:62 input.kvCache ?? input.model.kvCache` + `:68 kvCache: chosenKv ?? undefined` + `chosenKv?.k ?? "q8_0"` | `:65 resolveKvCacheProfile(input.kvCache, input.model.kvCache)`, `kvCache: chosenKv` | identical: the extra third fallback equals the old inline `"q8_0"/"q4_0"` |
| `LlamaService.initEngine` | `:2272-2273 options.cacheTypeK ?? "q8_0"` / `?.cacheTypeV ?? "q4_0"` | `:2275-2276 resolveKvCacheProfile(null, null)` | identical |
| `SettingsScreen` ×6 | `kvCacheChoice?.k ?? entry.kvCache?.k ?? "q8_0"` (`:1122`, `:1444`) | `resolveKvCacheProfile(kvCacheChoice, entry.kvCache)` (`:1138`, `:1246`, `:1310`, `:1342`, `:1467`, `:1370`) | identical |
| `i18n` | static strings | `{k}`/`{v}` templated | see §1.2 |

Measured, not argued: a probe over both catalog models × every offered context
size (`/tmp/mut/src/engine/__audit_probe.test.ts`) reported
`PROBE formula differences old vs new: 0`, and `PROBE row standard (q8_0/q4_0)
-> q8_0/q4_0`, `PROBE row high (q8_0/q8_0) -> q8_0/q8_0`. The identity holds
because `kvBytesPerTokenAtProfile(base, "q8_0", "q4_0") === base` exactly
(`kvQuantCost.ts:58-76` scales by `(k+v)/base`, which is 1 for the measured
profile).

### 1.2 Render — labels CONFIRMED identical, hint CONFIRMED different

`applyParams` (`src/i18n/index.ts:57-63`) substitutes `{k}`/`{v}`, so with
`kvCacheBitLabel` (`SettingsScreen.tsx:210-218`) returning `"8"`/`"4"`:

* en Standard: before `"Standard (K 8-bit, V 4-bit)"` → after
  `"Standard (K {k}-bit, V {v}-bit)"` → renders `"Standard (K 8-bit, V 4-bit)"`. **Byte-identical.**
* en High: `"High (K 8-bit, V 8-bit)"` → identical. it Standard/High: identical
  (no hyphen in the it template either).
* `accessibilityLabel={label}` (`:1776`) therefore also identical.

**DEFECT (1.3)** — `settings.kvCacheHint` was rewritten and Android renders the
new text:

```
before 5e25e717:src/i18n/en.ts:141-142
  "How precisely the attention cache is stored. High keeps V at 8 bits instead of
   4 and costs more memory. Takes effect on the next model load."
after  cc217efb:src/i18n/en.ts:141-142
  "How precisely the attention cache is stored — the label on each profile shows
   the bits it loads. Takes effect on the next model load."
```

and the same for `src/i18n/it.ts:140-141` ("High tiene V a 8 bit invece di 4 e
costa più memoria" → "l'etichetta di ogni profilo mostra i bit che carica"). The
commit message for `cc217efb` states **"Android copy is unchanged"** — that is
REFUTED. The reword is justified (the old sentence is a lie on iOS), but it is
an Android-visible copy change and the commit should have said so. No test pins
it either way: `copyTruth.test.ts` / `sheetCopyVisible.test.ts` / `reportStrings.test.ts`
all exit 0 before and after.

**DEFECT (1.4)** — `SettingsScreen.tsx:1815` added `kvCacheHighCostMiB > 0`. On
Android the delta is `16..32 MiB` for every offered context (min offered context
is 8192; LFM delta 2048 B/token, Qwen 4096 B/token), so the line never moves in
normal use. It does move under a bench override: `requestedContextTokens` comes
from `resolveRequestedContextTokens({benchNCtx, ...})` (`:1218-1223`), and
`kalsa.bench.nctx=128` gives `Math.round(2048*128/1048576) === 0`, where main
rendered "0 MiB more at the 128-token context you asked for." and this build
renders nothing. Bench-only; arguably an improvement, but it is a difference.

**PLAUSIBLE (1.5)** — the old code defended per field
(`input.kvCache?.k ?? "q8_0"`, `?.v ?? "q4_0"`); the new one defends per object
(`choice ?? catalog ?? SHIPPED`). A partial object `{k:"q8_0"}` used to resolve to
`q8_0/q4_0` and now resolves to `{k:"q8_0", v:undefined}`, which
`kvBytesPerElement` rejects (`kvQuantCost.ts:40-44`) → `modelAtKvProfile` returns
the model **unpriced** and `resolveContextProfile` returns `cacheTypeV:
undefined`. TypeScript blocks it today and no reachable producer builds one
(`readKvCacheChoice` only ever returns a `KV_CACHE_CHOICES` entry), but the
defensive net is thinner than the code it replaced.

### 1.3 `isIos()` cost and behaviour

* **Hot paths**: `resolveKvCacheProfile` is called ~2×/render from
  `modelChoices` plus 4 `useMemo`s. In the app `require("react-native")` is a
  Metro cache hit, so the cost is a function call and a string compare. Not a
  concern.
* **Under jest**: CONFIRMED that it is *not* free and *not* what the code
  assumes. This repo's `jest.config.js` uses `testEnvironment: "node"` with no
  react-native preset, so the probe printed
  `PROBE rn: threw SyntaxError: Cannot use import statement outside a module` and
  `PROBE3 2000 resolveKvCacheProfile calls (require throws): 355.49 ms`
  (**178 µs/call**, because jest re-evaluates and re-throws the module on every
  call — the failure is not cached). Consequence: `isIos()` is **false in every
  suite that does not `jest.mock("react-native")`**, i.e. every pre-existing
  suite silently exercises the Android branch. That is exactly why §4.2 has
  three unobserved revert sites.

---

## 2. iOS correctness

### 2.1 Path sweep — no q4_0 V reaches the engine on iOS

I enumerated every producer of `cacheTypeK/V` and every engine entry point:

| path | resolves through the rule? |
|---|---|
| app load `engineEnsureLoad.ts:167 → :224-225` | yes (twice: at `:167` and again inside `resolveContextProfile`) |
| `resolveContextProfile` `contextProfile.ts:209` | yes — the rule is applied there too, so a caller cannot hand the engine a pair the platform would not run |
| fit gates `loadGate.ts:65` | yes |
| `gateModelLoad` `loadGate.ts:221` | yes — it consumes the already-priced model from `loadGateFitModel:76` |
| `gateForModel` / `confirmDownloadGate:64` / `useModelDownload:179` / `engineEnsure:146` / `engineLoad:95` | yes — all funnel into `loadGateFitModel` |
| `initEngine` omitted-caller default `LlamaService.ts:2275` | yes |
| governor lane `LlamaService.ts:2320-2330` | yes — `effectiveCacheTypes(cacheTypeK, cacheTypeV, override)` then `npuLaneCacheTypes` (`governorInputs.ts:36-46`), both fed the resolved types |
| `pricedModel` `LlamaService.ts:2287` | yes |
| `engineOverride` (`engineParams.ts:68-133`) | cannot reintroduce q4_0: the only cache-type write is `flashAttn:"off" → cache_type_v = "f16"` (`engineParams.ts:90`) |
| bench overrides (`kalsa.bench.*`) | no KV key exists; `getEngineOverride` carries nGpuLayers/nThreads/nUbatch/flashAttn/moeStream/useMmap only (`engineParams.ts:25-41`) |
| remote backend `remoteHostEnsure.ts:37` | irrelevant: no `cacheType*` reference exists under `src/engine/remote/` |
| session disk calibration | keyed on the *active* types (`sessionDiskCalibration.ts:92-98`), so the iOS key is `…@q8_0/q8_0` |

Only remaining `q4_0` literals in `src/` are the catalog (`ModelRegistry.ts:232`,
`:287`), the dev catalog, the remote-model entry, the `KV_CACHE_CHOICES` ids and
the type union — none of them reach the engine without passing the rule.

Pricing is consistent with allocation: `loadGate.ts:65` yields
`kvBytesPerToken` 6656→**8704** (LFM) and 13312→**17408** (Qwen) on iOS
(measured, `/tmp/mut` probe), and `SettingsScreen` prices all four display
surfaces at the same pair (`:1139`, `:1250`, `:1311`, `:1476`).

### 2.2 `.kvs` discard — CONFIRMED, no new mechanism

`sessionMetaMismatchField` compares `cacheTypeV` (`sessionPersistence.ts:533`);
the meta is written from `activeCacheTypeV ?? ""` (`LlamaService.ts:3588`) which
is assigned the resolved value at `LlamaService.ts:2816-2817`; the restore expects
the same field (`LlamaService.ts:3828-3829`, `:4001-4002`); the static prefix
snapshot goes through the same comparator (`staticPrefixSnapshot.ts:149-151` with
`expectedStaticPrefixMeta:86-87`). So a q4_0-V file written by a pre-change build
is refused on iOS. The commit's claim is accurate.

*(Pre-existing, out of scope, worth a line: `activeCacheTypeV` records the
*requested* type, not the type after `flashAttn:"off"` forced f16 — so the meta
and the engine can disagree in that bench-only cell. Not introduced here.)*

### 2.3 Overriding the user's explicit choice — acceptable and shown

On iOS a fresh install highlights "Standard" (`effectiveKvCacheChoiceId`,
`SettingsScreen.tsx:1198`) and both rows render `K 8-bit, V 8-bit`; the note
`settings.kvCacheSameProfile` is printed when the rows coincide (`:1380-1386`,
`:1849-1852`). Tapping the other row changes the stored id and the skip-reload
key correctly fires a no-op (`LlamaService.ts:2445-2446` compares the resolved
types), which is the honest outcome. The per-row `N MiB` figure is still priced
at q8_0/q8_0 (`:1807-1810`), so the memory cost is visible even though the
"costs more memory" sentence left the hint. Residual nit: the row *name*
"Standard" now means 8-bit V on iOS and 4-bit V on Android; the parenthetical is
truthful, the name is not.

### 2.4 DEFECT — the evidence does not say what the comment says

`kvCacheProfile.ts:43-44` (and the `cc217efb` commit message) states:

> "LFM2.5-2.6B measured 31 tok/s at the catalog's q8_0/q4_0 against 97 with both
> sides q8_0"

`scratchpad/agents/ios-engine-choice/REPORT.md` line 1 and lines 119-145 say
where those numbers come from:

* `REPORT.md:3` — "**measured on the Mac** … MacBook Pro M1 Max … All
  measurements are engine throughput on the Mac (**no phones** …)".
* `REPORT.md:206-214` — the 97.48 figure is a *coordinator follow-up cell* with
  `-p 0 -n 128 -d 2048 -r 3`, while the 31.27 figure is the main-table cell
  `lfm_app_d2048` with `-p 512 -n 128 -d 2048` (median of 3 invocations × 5
  internal reps). Different prompt length and repeat structure; the report itself
  says "treat as ±5 %".
* Depth: both cells are `-d 2048`. The app does not ship there.
  `contextProfile.ts:11` `HIGH_RAM_N_CTX = 16384` with
  `:200 totalMemoryBytes >= CTX_UPGRADE_MIN_TOTAL_BYTES (7.5e9)` — every iPhone
  with ≥ 8 GB reserves **16384**, and my `/tmp/mut` probe confirms `nCtx=16384`
  at 8 GiB. The report measured the *mixed* pair at ~15.9k depth
  (`REPORT.md:141`: 13.00 tok/s) and **never measured q8_0/q8_0 there**.

So: (a) a Mac measurement is presented in a code comment as an iOS measurement,
and (b) the win is demonstrated at a quarter of the KV depth the app actually
reserves, where the KV share of the footprint is 4× larger and where the report's
own data shows decode collapsing to 13 tok/s. The direction is very likely right
(the dequantizing mixed-V attention path is a real effect, and +32/+64 MiB of KV
is a cheap price), but the *stated* justification is a durable false claim that
the next engineer will cite, and the depth-16k cell is the one that would decide
it. Minimum fix: say "measured on M1 Max via llama-bench at -d 2048, not on
device" in the comment and the commit, and record the open 16k-depth question.

---

## 3. `5e25e717`

### 3.1 Swift observer lock — CONFIRMED correct, no deadlock

`KalsaThermalModule.swift:22` adds `private let observerLock = NSLock()` and both
mutators take it with `defer { unlock }` (`:50-51`, `:66-67`). Every read/write
of `observerToken` in the file (`:52`, `:55`, `:68`, `:69`) is inside one of those
two functions, and both `OnStopObserving` (`:40-42`) and `OnDestroy` (`:44-46`)
route through `stopObservingThermalState`, so no unlocked access remains — the
race the commit describes is real and is closed.

Deadlock analysis: the lock is held across `NotificationCenter.addObserver`
(`:55`) and `removeObserver` (`:70`), both of which are non-blocking and take no
module state. The observer body (`:59-62`) runs on `.main` and calls only
`sendEvent` and `currentSnapshot` — it never re-enters either locked method, so
there is no lock cycle and no self-deadlock on the non-recursive `NSLock`.
Crucially the lock is **not** held across `sendEvent` in `OnStartObserving`:
`:36` releases before `:37`. Correct.

### 3.2 DEFECT — the thermal timeout does not deliver the claimed invariant

`5e25e717`'s justification (and the comment at `useThermalMonitor.ts:28-29`) is
that without the bound "a hanging bridge call cannot pile up samples behind the
interval". The pile-up premise is right — `:186 timer = setInterval(() => { void
sample(); }, intervalMs)` starts a new `sample()` every interval regardless —
but the fix is incomplete, because the *same* `sample()` body then falls into a
second native call that is **not** bounded:

```
useThermalMonitor.ts:144-153   if (Platform.OS === "ios") { await withNativeCallTimeout(getCurrentPlatformThermalState(), 1_000, …) }
useThermalMonitor.ts:159-162   } catch { /* fall through to memory proxy */ }
useThermalMonitor.ts:164-166   const bytes = await getAvailableMemoryBytesUncached();
monitor.ts:66-72               if (Platform.OS === "ios") { … return await getOsAvailableMemoryBytes(); }   // NO timeout
modules/kalsa-lifecycle/src/index.ts:139-147   const value = await module.availableMemoryBytes();            // NO timeout
```

If the bridge is what hangs — the premise of the change — the timeout is
guaranteed to be taken, and 1 ms later the fallback issues the *same* unbounded
call, so the sample still never settles and one pending sample per interval still
accumulates. The bound converts "hang forever" into "1 s, then hang forever", and
additionally flips a hung iOS sample from "keep the previous status" to
"commit a `memory_proxy` sample" (`:176-181`), which overwrites the
`platform_thermal` source with the free-RAM proxy. Everything else about the
change is right: the same 1 s bound and the same label already exist at
`platformThermalStatus.ts:133-143`, the rejection is caught by the enclosing
`try`, and `withNativeCallTimeout` swallows the loser (`nativeCallTimeout.ts:30`).

### 3.3 `isiOSAppOnMac` guard — CONFIRMED correct against the SDK

`KalsaLifecycleModule.swift:37-41`. Verified from the installed SDK rather than
from memory:

* `iPhoneOS27.0.sdk/usr/include/os/proc.h:85` —
  `API_UNAVAILABLE(macos) API_AVAILABLE(ios(13.0), tvos(13.0), watchos(6.0))`, and
  `:81-82` — "0 is returned if the calling process is not an app, or the calling
  process exceeds its memory limit". So both halves of the comment are true: 0 is
  a real reading on hardware, and the "no iOS per-app limit" platforms are
  exactly the ones where 0 carries no headroom meaning. The cited Apple URL is
  supported by the header.
* `Foundation.framework/Headers/NSProcessInfo.h:527-528` — "The value of this
  property is `YES` only when the process is an iOS app running on a Mac", and
  `API_AVAILABLE(macos(11.0), ios(14.0), …)`. Availability is iOS 14, so it
  compiles against the pod's 16.4 floor; my `-typecheck` at
  `arm64-apple-ios16.4` and `…-simulator` exits 0.
* The `#if targetEnvironment(simulator)` branch is untouched, so the simulator
  path is unchanged regardless of what `isiOSAppOnMac` reports there.

The comment rewrites in `KalsaLifecycleModule.swift:11-18`,
`modules/kalsa-lifecycle/src/index.ts:18-22` and `:126-137`, and
`src/engine/monitor.ts:53-60` all match the code. Accurate.

### 3.4 Apple-class gate — bites, but the column is dead data

The gate (`deviceProfile.ts:657-659`) is real and pinned: mutation M6 (delete the
`Platform.OS === "ios"` ternary) fails exactly
`buildDeviceProfile on Android makes no Apple class › refuses every Apple model id`
— exit 1.

But "the unreachable Apple RAM fallback is removed" is only half true. The
*read* is gone (`deviceProfile.ts:681-690` now reports `totalMemoryBytes` and
`getRamTier(totalMemoryBytes)` straight from the Expo read), while the entire
`ramBytes` column stays in production source — `appleDeviceClass.ts:40` (type),
and every entry of `EXACT_MODEL_IDS`/`PREFIX_RULES` — and is now referenced by
nothing but its own test (`appleDeviceClass.test.ts:9-51`). The header was
reworded from "RAM figures are a FALLBACK only" to "`ramBytes` is reference data:
… no caller consults the column" (`appleDeviceClass.ts:8-11`), which is an
accurate description of dead code. Deleting the column and its test would be
smaller and would stop the next reader from re-deriving a fallback from it.

Two further points on this commit:

* **Robustness regression, PLAUSIBLE.** `deviceProfile.ts:657` is the only
  `require("react-native")` in the file that is *not* inside a `try` — compare
  `:589`, `:532`, `:552`, all of which are guarded and return `null`. A failure
  there now rejects `buildDeviceProfile` and the whole profile collapses through
  `getCachedDeviceProfile`'s `.catch` (`:711-729`) to
  `ramTier: getRamTier(null)` = `"low"`, i.e. every model goes `blocked_ram`.
  The old code could not fail that way, because the fallback it deleted was the
  thing that kept a null Expo read survivable.
* **The deleted pin.** The test that asserted the fallback's coherence
  ("feeds the tier from the SAME fallback bytes the profile reports") was
  rewritten, not inverted: nothing now pins what iOS reports when
  `expo-device.totalMemory` is unavailable. The justification
  (`deviceProfile.ts:651-656`: "positive by construction") is plausible —
  `ProcessInfo.physicalMemory` is a hard constant — but it is an assertion about
  a third-party module, made in a comment, in exchange for deleting a defence
  whose failure mode is fail-closed. Worth one line of evidence or the fallback
  back.

---

## 4. Tests — what bites and what does not

All mutations ran in `/tmp/mut` (`git archive HEAD`, `node_modules` symlinked),
one at a time, restoring the original after each.

| id | mutation | suites run | exit | result |
|---|---|---|---|---|
| M1 | delete `if (isIos()) return IOS_KV_CACHE;` (`kvCacheProfile.ts:52`) | kvCacheProfile, loadGate | **1** | exactly 2 failures: the two iOS pins (`iOS: unset and Standard both load q8_0/q8_0`, `iOS prices the estimate at q8_0/q8_0`). Matches the commit's claim verbatim. |
| M2 | `return choice ?? catalog ?? SHIPPED` → `catalog ?? choice ?? SHIPPED` | kvCacheProfile, loadGate | **1** | 2 failures: the Android pass-through pin + `prices KV at the chosen cache profile, not the catalog's`. The Android pin bites. |
| M3 | revert `loadGate.ts:65/71/76` to the pre-commit form | loadGate | **1** | 1 failure: the iOS 8704 pin. |
| M6 | delete the `Platform.OS === "ios"` gate in `deviceProfile.ts:658` | deviceProfile | **1** | 1 failure: `refuses every Apple model id — the guard is the platform, not the id`. |
| **M4** | revert `deviceTuning.ts:746` to `input.model.kvCache ?? {q8_0,q4_0}` | deviceTuning | **0** | **7/7 pass.** No pin. |
| **M5** | revert `contextProfile.ts:209` the same way | contextProfile, loadGate, deviceTuning | **0** | **39/39 pass.** No pin. |
| **M7** | revert `engineEnsureLoad.ts:167` to `kvCache: kvCache ?? model.kvCache` | **all `src/engine` + `src/host` (177 suites, 1712 tests)** | **0** | **everything green.** |

**DEFECT (4.2).** M7 is the one that matters: the load path — the single place
that decides what `initEngine` receives — can be reverted to the pre-change
resolution and the entire engine + host test surface stays green. M5 shows the
same for `resolveContextProfile`, M4 for the tuning report. So "Every resolution
site goes through the rule" is true in the code and tested in exactly two places
(`kvCacheProfile.ts`'s own unit and `loadGate`'s estimate); the two sites that
would actually put q4_0 into the engine are unpinned, and the six
`SettingsScreen` render sites have no test at all (no `SettingsScreen` test
mentions `resolveKvCacheProfile`, `KV_CACHE_CHOICES` or the labels; the only two
files matching are `kvCacheProfile.test.ts` and `kvCachePref.test.ts`).

Cheapest fix that closes it: one `contextProfile.test.ts` case with
`jest.mock("react-native", () => ({ Platform: { OS: "ios" } }))` asserting
`resolveContextProfile({ hybrid: true, kvCache: { k: "q8_0", v: "q4_0" },
catalogCtx: 8192 }).cacheTypeV === "q8_0"`, plus one `deviceTuning` case for
`result.kv`. Both are pure functions with no I/O; the mock pattern is already in
`kvCacheProfile.test.ts:8`.

Environment: nothing was exported outside a single shell, no device was touched,
no stash was created (`git stash list` empty), and the worktree is byte-identical
to `cc217efb` (`git status --porcelain` empty, `git diff --quiet HEAD` clean on
all audited files, verified after every mutation round).

---

## 5. Code quality, comments, commits

### 5.1 Commit accuracy — CONFIRMED good

Every "Verified:" line I re-ran reproduces exactly: `tsc --noEmit` exit 0; the 5
suites / 46 tests for `cc217efb` and the 4 suites / 38 tests for `5e25e717`, both
exit 0; "removing the platform branch fails exactly the two iOS pins" is M1, and
it does fail exactly those two; `swiftc -parse` on both Swift files exits 0. The
Apple-gate reasoning (an Android id cannot reach the `Mac*` prefix rule) is
correct, and the new test pins it. Two claims are overstated: "Android copy is
unchanged" (REFUTED, §1.3) and the unqualified 31-vs-97 measurement (§2.4).

### 5.2 Dead code and duplication

* `ramBytes` column: dead (§3.4).
* `KV_CACHE_CHOICES[].k/.v` are dead **on iOS** — `resolveKvCacheProfile` ignores
  them there, so only the `id` matters. Not wrong (the ids are the storage
  contract, `kvCachePref.ts:35-37`), but worth knowing before someone "simplifies"
  the ids into bits.
* `isIos()` is a third copy of the platform probe (`deviceProfile.ts:589`,
  `:657`, `kvCacheProfile.ts:27-35`; 16 such probes repo-wide). House style, but
  the silent `catch → false` in `kvCacheProfile.ts:32-34` is the one copy where a
  failure mode is a *wrong KV pair on the platform that must never see it*, with
  no log line. A one-time module-level memo, or an explicit log on the failure
  path, would remove that.
* `SettingsScreen.tsx` is 2995 lines and grew by 103/−68 in this commit;
  `LlamaService.ts` is 6742. The KV panel now has 6 `resolveKvCacheProfile` call
  sites in one screen — a `useKvCacheOptions()` hook would have made the
  platform rule a single decision instead of six, which is also what §4.2 needs.
* `kvCacheBitLabel` (`SettingsScreen.tsx:210-218`) hardcodes `q8_0`/`q4_0` for a
  type that admits eight quants and falls back to printing the raw name. The
  fallback is the right call; the switch is unavoidable without a table.

### 5.3 Stale comments/docs left behind

* `loadGate.ts:70-71` — "an explicit value wins and **skips the high-RAM
  upgrade**". `resolveContextProfile` has no kvCache-conditioned branch at all
  (`contextProfile.ts:187-203` branches only on `explicitNCtx`,
  `catalogCtx`, `hybrid`, `totalMemoryBytes`); the claim is false and it was
  already there at `5e25e717:loadGate.ts:63-64`, so `cc217efb` rewrote the two lines
  above it and left the wrong one below.
* `docs/KV-WINDOW-AND-THERMAL-2026-09-17.md:78-86` — "the cache is already
  quantized (K q8_0, V q4_0) … `ModelRegistry.ts:241` carries exactly
  `kvBytesPerToken: 6656`, so the registry and the engine agree". On iOS the
  engine now allocates 8704; the doc (live, not `archived/`) is stale and no note
  was added. The archived `archived/docs/KALSA_DEPENDENCIES.md:42` is out of scope.
* `plugins/withLlamaIosSourceBuild.js:73-77` — "Xcode **26** still ships an
  Intel-capable Universal build"; the toolchain on this machine is
  `Xcode 27.0 (27A266a)`. The rest of that comment is a genuine improvement: the
  old "Every supported dev Mac is Apple Silicon" was an invariant the code never
  relied on, and the new text says so.

---

## Defect list (ordered)

| id | severity | finding | fix |
|---|---|---|---|
| **2.4** | medium (truthfulness, durable) | `kvCacheProfile.ts:43-44` + commit present a Mac llama-bench measurement at 2048 decode depth as an iOS fact; the app reserves 16384 on ≥7.5 GB devices, a depth the report never measured for q8_0/q8_0 | reword the comment and the commit to name the machine, the tool, the depth and the "no phones" caveat; log the 16k-depth cell as the open question |
| **4.2** | medium (regression risk) | the load path (`engineEnsureLoad.ts:167`) and `contextProfile.ts:209` can each be reverted with 1712 tests green | two `jest.mock("react-native")` cases in `contextProfile.test.ts` and `deviceTuning.test.ts` |
| **3.2** | low-medium | the 1 s thermal bound does not stop sample pile-up; the fallback native read at `monitor.ts:71` is unbounded | bound `getAvailableMemoryBytesUncached` on the iOS branch with the same `withNativeCallTimeout`, or state the limit honestly in the comment |
| **1.3** | low | `settings.kvCacheHint` changed on Android (en + it) while the commit claims "Android copy is unchanged" | fix the commit text; optionally pin the hint in `copyTruth.test.ts` so the next platform-conditional copy change has to be declared |
| **3.5** | low | `deviceProfile.ts:657` is the only unguarded `require("react-native")` in the file; a failure collapses the whole profile to `ramTier "low"` | wrap in try/catch like `:589`, or reuse a small local probe helper |
| **3.4** | low | `ramBytes` retained as dead data with a reworded header | delete the column and its test entries |
| **1.5** | low | per-field `??` fallbacks dropped in favour of per-object | restore a field-level guard, or accept and say so |
| **1.4** | info | `> 0` hides the High-cost line under a bench `nctx` < 128 on Android | none needed |
| **5.3** | info | stale `loadGate.ts:70-71` comment, stale `docs/KV-WINDOW…` line, "Xcode 26" on an Xcode 27 box | fix the three lines |
| **2.3** | info | the row *name* "Standard" means 8-bit V on iOS, 4-bit on Android (the parenthetical is truthful) | rename the ids, or accept |

## Recommendation

Nothing found here breaks Android, and nothing hands a q4_0 V cache to the
engine on iOS. The Swift lock, the `isiOSAppOnMac` guard and the Apple-class gate
are all correct and verified against the SDK and by mutation. Fix 2.4 and 4.2
first (one comment + two tests), then 3.2; the rest are cheap edits that can
follow on the branch.