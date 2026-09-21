# REVIEW — commit `6a58ef5` "feat(energy): trace app-side battery voltage per measured turn"

Branch `app-integration-2026-09-20`, parent `96eb9d9`, worktree
`/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-timing` (`Aspis0/kalsa`), not pushed.
Reviewer was independent of the author; all commands below were run read-only in the
worktree, with mutations performed on an `rsync` copy under `/tmp/energy-mutation/repo`.
The worktree's tracked files were verified clean before and after (`git status --porcelain`
shows only pre-existing untracked files).

## VERDICT: PUSH-SAFE WITH NOTED RISK

The commit does what it says and the OFF-by-default claim held up against every path I
could construct. The risk is not in the code — it is that no gate anywhere compiles the
Kotlin this commit's headline feature lives in, and pushing this branch triggers no CI at
all (see claim 5). The first compile of `GovernorBatteryModule.kt` in its new form will be
the S23 device build itself.

---

## 1. OFF BY DEFAULT — CONFIRMED

The gate is `startGovernorBatteryTrace` (`src/engine/governorBatterySampler.ts:77-92`),
the only new entry point, called from exactly one place (`LlamaService.ts:4574`).

Path enumeration, each verified in source:

| Path | Code | Result |
|---|---|---|
| Key absent | `AsyncStorage.getItem` resolves `null` → `energyTraceRequested(null)` = `raw === "1"` = false (sampler.ts:20-22, 26) | returns false, no native call |
| Key = `"0"`, `""`, `"true"`, `"on"`, `" 1"` | `raw === "1"` is exact-match; all false (tested at governorBatterySampler.test.ts:49-54) | false, no native call |
| `getItem` throws | `catch { return false }` (sampler.ts:27-29) | false, no native call |
| Blank `documentDirectory` | `FileSystem.documentDirectory ?? ""` → `if (!baseDir) return false` (sampler.ts:81) — checked **before** the storage read | false, no storage read, no native call |
| Native module missing | `startGovernorBatterySampling` rejects `"GovernorBattery.startSampling is unavailable"` (sampler.ts:60-62) → caught (sampler.ts:89-91) | false; no bridge call possible |
| Native `startSampling` rejects | e.g. interval floor or path blank (`GovernorBatteryModule.kt:94-104`) or open failure (`:126-134`) → JS catch | false; native cleans up in its own catch (`stopSamplingInternal()`, kt:132) |

No-other-caller proof, whole tree including `android/`, `plugins/`, `scripts/`, `archived/`
(everything outside `node_modules`/`.git`):

```
$ grep -rn 'startSampling\|startGovernorBatteryTrace\|startGovernorBatterySampling\|GovernorBattery' <tree> -l | grep -v node_modules | grep -v '.git/'
```
Every hit is: the Kotlin module (definition + package), the registration plugin
(`plugins/withGovernorBattery.js` — copies the file, calls nothing), `MainApplication.kt`
(registration), generated build artifacts, docs, and in `src/`: the sampler, its test,
`governorInputs.ts` (uses `readThermo` only), `deviceProfile.ts` (uses `readSoc` only),
and `LlamaService.ts` (the one start/stop pair at 4574/5402). Nothing else calls
`startSampling` in any language.

Normal turn, key absent: **zero** `GovernorBattery` native calls; exactly **one**
`AsyncStorage.getItem` per turn (a native RKStorage read — this is the "one AsyncStorage
key per turn" the commit message honestly declares, and the same shape as the existing
`kalsa.bench.thermo` gate in `governorInputs.ts:9`). No in-app writer of
`kalsa.bench.energy_trace` exists anywhere, so a shipped install cannot turn this on
without external tooling.

## 2. THE WINDOW BRACKETS ONE TURN — CONFIRMED

Control flow in `streamAssistantTurn`:

- `LlamaService.ts:4574-4577` — `const energyTraceOn = await startGovernorBatteryTrace(...)`.
- `LlamaService.ts:4579` — `try {`. **Nothing** sits between the start and the `try` —
  the commit deliberately starts after the whole setup block (status label, closure
  definitions, `bailIfStopped` at 4532-4566), so a throw in that setup cannot strand a
  started sampler.
- Single `try` / `catch` (5393) / `finally` (5401-5435); `stopGovernorBatteryTrace()` is
  the **first** statement of the `finally` (5402), so nothing earlier in the finally can
  skip it.
- I enumerated every `return` inside the `try` (17 of them: 4582, 4698, 4734, 4814, 4865,
  4904, 4922, 4932, 4985, 5154, 5238, 5269, 5301, 5324, 5353, 5396, plus the bail
  guards) — every one is inside the `try`, so the `finally` runs on all of them.
- `startGovernorBatteryTrace` itself cannot throw (internal catch; the only code outside
  its try is a string build and `Date.now()`), so `energyTraceOn=true` implies native
  start resolved.

Escape paths I could not close by reading: process death, an await inside the turn body
that never settles (a pre-existing turn hang, in which case the turn never ends anyway),
and a `stopSampling` promise that never settles on a dead bridge — the `finally` awaits
the stop before `stopStallWatchdog()` (5402-5403), so a hung stop would stall teardown.
All three are outside what code can guarantee. No throw/abort/early-return/engine-error
path starts the trace without reaching the stop.

## 3. NO LEAK — CONFIRMED

- `startSampling` calls `stopSamplingInternal()` **first** (`GovernorBatteryModule.kt:108`)
  — the native side holds exactly one global session (`samplerLock`, single
  thread/writer/running triple). Two stacked turns can never run two samplers; the second
  start stops the first session (thread joined, writer closed — `:294-316`).
- `stopSampling` when nothing runs: `stopSamplingInternal()` operates on nulls —
  `quitSafely`/`join`/`close` all skipped, `promise.resolve(null)` (`:138-141`). The JS
  `stopGovernorBatteryTrace` additionally catches anything.
- Writing into a previous turn's file is impossible: every start opens a **new** path
  (wall-clock ms + turn id), and `sampleOnce` re-checks `samplerRunning` and **thread
  identity** under the lock before every write (`:217`, `:228`), so a sample that raced a
  stop/re-start drops itself instead of writing into the new session's writer.
- Teardown: `invalidate()` stops the session when the RN context dies (`:143-146`).
- One behavioural consequence, not a leak (LOW finding below): if two turns ever
  overlapped, turn A's `finally` would stop turn B's in-flight sampler (B's trace is
  truncated, flushed per row, never corrupted). `AppShell.tsx` has a single
  `streamAssistantTurn` call site and a `streaming` state (3018); the bench protocol is
  serial, so I rate this theoretical.

## 4. THE DRIFT TESTS ARE REAL — CONFIRMED (verified by my own mutations)

The test reads the **real Kotlin source at runtime**
(`governorBatterySampler.test.ts:32-35`: `fs.readFileSync(<repo>/native/GovernorBatteryModule.kt)`)
and parses `TRACE_SCHEMA_HEADER`, `TRACE_COLUMNS`, and `sampleRow`'s `listOf(...)` with
brace-matched extraction. The header/column strings are **not** duplicated in the test.
The one deliberate duplication is the parser-pinning test's expected column list
(`:216-226`) — that is its job (pin the contract a parser was written against).

Commands and results, on the /tmp copy (baseline: 15/15 pass, matching the worktree):

Mutation 1 — delete the writer field, header untouched:
```
$ perl -0pi -e 's/\n            propertyCsvValue\(voltageMv\),//' native/GovernorBatteryModule.kt
$ npx jest src/engine/governorBatterySampler.test.ts
✕ writes exactly one field per declared column
✕ writes the declared columns in the declared order
Tests: 2 failed, 13 passed
```
Mutation 2 — swap `reading.current` and `reading.chargeCounter` writer fields, header untouched:
```
✕ writes the declared columns in the declared order
Tests: 1 failed, 14 passed
```
(count test correctly still passes — the count is unchanged; the order test catches it.)

Mutation 3 — remove `,voltage_mV` from `TRACE_COLUMNS` only:
```
✕ writes exactly one field per declared column
✕ writes the declared columns in the declared order
✕ keeps the column order a parser was written against
Tests: 3 failed, 12 passed
```
Restore → 15/15. The author's claim reproduces exactly. `COLUMN_OF_FIELD` maps writer
expressions to columns by string; a rename there fails loudly as `UNDECLARED(...)`, not
silently — acceptable.

## 5. WHAT NO GATE COMPILES — CONFIRMED, AND WORSE THAN CLAIMED

- `package.json` scripts: `typecheck` = `tsc --noEmit`; tests run via `npx jest`. No
  gradle/JVM/Android task exists in any script; no husky, no `core.hooksPath`, no
  non-sample git hooks.
- `.github/workflows/ci.yml` (typecheck + jest only): triggers on push/PR to **`feat/**`
  only**. This branch is `app-integration-2026-09-20` — **pushing it triggers no CI at
  all**. Not even tsc.
- `.github/workflows/apk.yml`: `workflow_dispatch` only (manual). It runs
  `npx expo prebuild` (line 174) + `./gradlew assembleRelease` (line 220) — this is what
  would compile the Kotlin, if and only if someone dispatches it.
- `.github/workflows/e2e-emulator.yml` (builds and *executes* the app on an emulator):
  push-gated to `main`, `v4.2-context-compaction`, `feat/moe-stream` only.
- The stale `android/` build tree in the worktree (untracked, dated Sep 20 21:42) contains
  the **v1** module; the current Kotlin has never been compiled anywhere, locally or in CI.

So: no Kotlin is compiled or executed by any gate that fires for this branch — the
author's claim holds — and additionally **nothing at all runs on push**. Untested until
first compile: the entire native surface of this commit (`readVoltageMv`, the v2 header
constants, their use in `sampleRow`/`openTraceWriter`). What would test them: the S23
device build (the declared next step, via `.build-s23-repack.sh` or a manual `apk.yml`
dispatch, both of which prebuild), and post-merge the e2e emulator run on main. A Kotlin
syntax/type error will surface loudly at that build — it is not silent, but it is
unverified at push time. See LOW finding 2 for the stale-`android/` trap.

## 6. THE VOLTAGE CLAIM — CONFIRMED (one noted risk)

- Android SDK documentation (`developer.android.com`, `BatteryManager` reference):
  `EXTRA_VOLTAGE` — integer, **millivolts**; `BATTERY_PROPERTY_CURRENT_NOW` — documented
  in **microamps** (the SPA page would not render fully in my fetch; the units are the
  long-standing documented values and match the code's assumptions).
- Schema header (`GovernorBatteryModule.kt:326-331`):
  `voltage_mV=BatteryManager.EXTRA_VOLTAGE, millivolts` — wording correct.
- Column name (`:332-334`): `voltage_mV` — correct.
- No conversion anywhere: `readVoltageMv` (`:204-213`) emits `getIntExtra` raw into
  `propertyCsvValue`; grep for `voltage` across `src/` finds only a comment; no `/1000`
  or `*1000` on any voltage value in any language. The schema bump to
  `kalsa-governor-battery-trace-v2` is present and pinned by test.
- CURRENT honesty: the header says `current_uA=property-documented unit, calibrate per
  device`, and the test pins that wording (`toMatch(/current_uA=[^;]*calibrat/i)`). Risk,
  not refutation: the header cannot carry the observed per-device factor (mA-like on this
  S23 lives in the commit message and REPORT section C, not in the file), so a consumer
  who trusts the column name and skips the header comment still misreads by ~1000×. The
  mitigation chosen is reasonable for a static constant; a host-side consumer doc must
  carry the observed factor.

## 7. PRIVACY — CONFIRMED

- The only writer of trace bytes is the native sampler into
  `<documentDirectory>energy/…` (app-private files dir). `app.config.js:58`:
  `allowBackup: false` — no Auto Backup path off device either.
- Nothing in `src/` reads the `energy/` directory back (grep for `energy` in src:
  the sampler itself, the new comment in `LlamaService.ts`, and an unrelated
  `useBatteryEta` wording). The file is write-only from the app's perspective; the host
  reaches it via `adb run-as`, outside the app.
- The Kotlin module contains no `Log`/`println` (grep: zero hits); the commit's JS adds no
  `console.log`.
- Telemetry (`src/telemetry/telemetry.ts`) is opt-in ("Opt-in crash/error telemetry …
  TELEMETRY_OPTIN.md v14"), reads only AsyncStorage and POSTs JSON to the worker — it
  imports no file-system module and cannot read the CSV; no code path feeds trace content
  into a telemetry payload or a network call. The project rule (no content, no keys,
  telemetry opt-in) is untouched by this commit.

## 8. `readThermo` REFACTOR BEHAVIOUR-IDENTICAL — CONFIRMED

The parent's inline body (`git show 96eb9d9:native/GovernorBatteryModule.kt`) was:
`registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))`. The new
`stickyBatteryIntent()` (`:198-201`) is byte-for-byte the same call. With `receiver ==
null`, Android's `registerReceiver` **returns the sticky broadcast and registers
nothing** — that is the documented query form, and it is exempt from the Android 14
exported-flag requirements (those apply only to non-null receivers). `readVoltageMv`
calls it once per sample at 1 Hz: no receiver object is created, nothing accumulates, no
unregistration is needed — no per-second leak is possible. Diff-verified: the `readThermo`
hunk changes only the call site, nothing else.

## 9. THE PATH AND ITS FAILURE MODE — CONFIRMED by reading; execution untestable here

- Path: `energyTraceFilePath` = `<documentDirectory>energy/<Date.now()>-t<turnId>.csv`
  (sampler.ts:37-43); `turnId` is the per-process `String(++turnSeq)` (`LlamaService.ts:4029`),
  so the wall-clock ms is what prevents collisions across runs — matches the design note.
- Native writer (`openTraceWriter`, kt:274-292): strips `file://`, `mkdirs()` the parent,
  throws `IllegalStateException("Could not create sampling output directory: …")` on
  failure, appends, writes schema+columns only when the file is empty.
- Rejection chain: that throw → `startSampling`'s catch → closes the writer,
  `stopSamplingInternal()`, `promise.reject` (kt:126-134) → JS `startGovernorBatterySampling`
  rejects → `startGovernorBatteryTrace` catch → `return false` (sampler.ts:89-91) →
  `energyTraceOn=false` → the finally's `if (energyTraceOn)` skips the stop; the turn
  proceeds normally. The unit tests pin the JS half of this (failing start/stop are not
  turn failures). An unwritable directory and ENOSPC both land in this same chain on a
  phone; the failure mode of "silently produce nothing" degrades to "no CSV on disk, turn
  fine, host finds nothing" — visible to the host via `run-as ls`, not to the user.
  I could not execute the Kotlin here (no JVM gate — claim 5); the native half is
  verified by reading only, and the device run settles it.
- Cosmetic (LOW finding 4): `energyTraceFilePath` assumes `baseDir` ends with `/`.
  Expo's `documentDirectory` always does; if it ever didn't, the trace still works but
  lands in a `…filesenergy/` directory.

## 10. HOUSE RULES — CONFIRMED

- `wc -l native/GovernorBatteryModule.kt` = **344** (claimed 344; parent 324, +20);
  `LlamaService.ts` = **6243** (parent 6231, **+12** exactly as declared). Both within
  the declared band.
- Imports: `governorBatterySampler.ts` adds exactly one (`AsyncStorage`, required);
  Kotlin adds none (all symbols already imported); `LlamaService.ts` adds the two
  trace functions. Minimal.
- Comments in the diff are all WHY/trap-style ("EXTRA_VOLTAGE is the only voltage
  route", "The fuel gauge smooths over roughly a second" — pre-existing in the parent,
  not added here; "a failed stop loses no datum"; the bench-only rationale in
  LlamaService). No narration comments added.
- Unrequested refactoring: exactly one — the `stickyBatteryIntent()` extraction — which
  the reuse requires, is behaviour-identical (claim 8), and is declared in the commit
  message. Nothing else moved.

## FINDINGS BY SEVERITY

No HIGH findings. No defect found that breaks shipping behaviour, the OFF gate, the turn
window, privacy, or the turn itself.

**MEDIUM (process, not code):** No gate of any kind fires when this branch is pushed
(`ci.yml` is `feat/**`-only; `apk.yml` is manual; e2e is three named branches), so this
commit's Kotlin — its headline feature — arrives at `main` history never having been
compiled unless the device run (or a manual `apk.yml` dispatch) happens first. The
declared next step is exactly that device run; treat it as mandatory before any merge
toward `main`, not optional validation.

**LOW 1 — `src/engine/LlamaService.ts:5402` / `GovernorBatteryModule.kt:108,294`:** if two
turns ever overlapped, the earlier turn's `finally` stops the later turn's live sampler
(the later trace is truncated, per-row flushed, never corrupted). Single call site +
`streaming` UI state + serial bench protocol make this theoretical today. If a future
feature ever streams concurrently, the sampler needs a session handle instead of a global
single session.

**LOW 2 — stale `android/` tree in the worktree:** the untracked
`android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` (Sep 20 21:42) still
contains the **v1** module. A build that runs `gradlew` without the `expo prebuild` step
would silently compile v1 — CSVs would come out v1-schema (no voltage column) while the
JS side believes v2. Both known build paths (`.build-s23-repack.sh`, `apk.yml`) prebuild,
and the plugin's `copyFileSync` overwrites on every prebuild, so the normal flow is safe;
deleting the stale `android/` tree before the device run would remove the trap entirely.

**LOW 3 — `GovernorBatteryModule.kt:330`:** the header's `current_uA=…, calibrate per
device` warns but cannot state the observed factor (mA-like on this S23). A consumer
trusting column names and skipping the header misreads by ~1000×. Carry the observed
per-device factor in the host-side consumer doc/analysis script.

**LOW 4 — `governorBatterySampler.ts:42`:** `energyTraceFilePath` assumes `baseDir` ends
with `/`. True for Expo's `documentDirectory` by contract; a violation would redirect
traces to `…filesenergy/` (still app-private, still written). Cosmetic.

## WHAT ONLY A REAL DEVICE CAN SETTLE

1. That the new Kotlin compiles and registers (it has never been compiled anywhere).
2. That `readVoltageMv` yields plausible values on the S23 (expect ~3700–4400 for mV) and
   `voltage_status=ok` per row.
3. The CURRENT calibration: the actual scale of `current_uA` values on this fuel gauge
   (the claimed mA-like behaviour) — the number the host analysis needs.
4. That `files/energy/<ms>-t<N>.csv` appears with the v2 header line first, one row ~per
   second of turn, and stops growing at the turn's end.
5. That a failed/absent storage key, or an injected open failure (e.g. ENOSPC), leaves the
   turn healthy with no CSV — the silent-nothing mode, deliberately, end to end.
6. That the only per-turn behavioural delta in a shipped build is the single
   `AsyncStorage.getItem` (logcat/battery diff vs parent build).
