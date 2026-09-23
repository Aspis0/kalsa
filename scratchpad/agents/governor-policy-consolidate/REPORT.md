# Governor policy consolidation: app measures, binding transports, engine decides

Coder report. Task: close the triplicated governor idle-baseline latch/validity policy
across three repos. No push, no tag, no release, never upstream.

Read first: `scratchpad/agents/governor-policy-duplication/REPORT.md` (EXPLORER, 508 lines),
which supplies file:line for every site. This report records what was changed, the
before/after behaviour, the tests that pin it, and the real exit codes.

## 1. Bases, worktrees, method

All work done in detached worktrees; the three main checkouts were not committed to and
no ref in any repo was pushed.

| repo | main checkout state | worktree | base (detached HEAD) |
|---|---|---|---|
| app `kalsa` | dirty (unrelated uncommitted V73/RAM-gate work in `governorInputs.ts`, `governorInputs.test.ts`, `LlamaService.ts`, `AGENTS.md`) | `/Users/marco/Projects/kalsa-wt-gov-policy` | `e5788cfee46dd76dacd6893913d6c5f67b6ec762` (= recon base) |
| binding `llama.rn-kalsa` | clean except untracked pnpm files | `/Users/marco/Projects/llama.rn-kalsa-wt-gov-transport` | `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` (= recon base) |
| engine `kalsallama` | dirty (unrelated uncommitted V73 routing + OpenCL work), HEAD moved past recon ref | `/Users/marco/Projects/kalsallama-wt-gov-sole` | `833cde99b47b81f5f6a2a6309fbb8504033174f5` (current `main`) |

Engine base note: the recon read ref `1068eb03d`. Main has moved to `833cde99b`, which
already contains the engine defect-5.2 commit `61db879b8c`. The only governor-file
difference between `1068eb03d` and `833cde99b` is a 5-line V73 prefill-routing hunk and an
OpenCL test-include block; `src/llama-ext.h` and `tests/test-governor-v02-router.cpp` are
byte-identical, and every line the recon cites (`llama-governor-policy.cpp:63,98-111,115`)
is unchanged. `833cde99b` is the tip the change must land on, so it is the base.

Engine build config: the standing records ("77 = skip, no device on this Mac") come from a
build with `GGML_METAL=OFF`, `GGML_OPENCL=OFF` (checked against the main `build/`
CMakeCache). The worktree was configured the same way. A first configure with default
options (`GGML_METAL=ON`) made `test-governor-v0-devices` find the Metal GPU and run the
device path (exit 1, genuine host check at `tests/test-governor-v0-devices.cpp:240`); that
run was discarded as a configuration artifact, not a code result, and the build was
reconfigured to the standing config before any baseline was recorded.

Evidence plan:
- app: full jest suite (`npx jest`, 94 suites) in the worktree, before and after.
- engine: the seven standing governor targets run as binaries, alphabetical order, real
  exit codes, before and after. The eighth governor target
  (`test-governor-v0-mtp-hybrid`) is also run and reported, but it is model-dependent
  (needs an MTP-layer model, skips 77 on the `stories15M` fixture), not device-dependent,
  and is not one of the standing seven - see section 6.
- binding: `scripts/governor-params-test.cpp` (the app's `test:governor-params` harness)
  compiled against the changed binding file, exit code reported.

No phone was used or needed.

## 2. BEFORE/AFTER behaviour table

"Before" = the three pre-change bases (kalsa `e5788cfe`, binding `0288dc27`, engine
`833cde99b`). "After" = the three commits in section 9.

### 2.1 Which condition decided what, at each site

| Site | Question | BEFORE (who decided, with which condition) | AFTER |
|---|---|---|---|
| App/Kotlin `native/GovernorBatteryModule.kt` | When is a plugged baseline captured? | SECOND LATCH: plug-in edge (`plugged && idleBaselineTenthsC == null && present && temperature > 0`, old :66-72), held all session, cleared on unplug; emitted `t_idle_valid = (latch != null)`, `t_idle_tenths_c = latched value` | No latch, no rule. Emits raw observations: `t_idle_tenths_c = live temperature`, `t_idle_valid = present && temperature > 0` (a sensor fact, not a verdict), new :61-69 |
| App/TS `src/engine/governorInputs.ts` | Is the baseline in range? | SECOND DECIDER: `t_idle_valid && idle > 0 && idle + 1 < 42` (old :178), a verbatim copy of the engine's plugged rule, applied before transport; also refused any idle <= 0 (engine does not) | Pass-through: `t_idle_valid: idleValidRaw` (:183). Only the tenths->degrees lift remains (:169-177) - unit conversion is transport, the range gate is gone |
| Binding `llama.rn-kalsa/cpp/rn-governor-params.cpp` | Is a plugged profile acceptable? | THIRD DECIDER: plugged branch `t_idle_valid && isfinite(t_idle_c) && t_idle_c + 1.0f < 42.0f` (old :102-104); failure threw `governor: thermo profile invalid` at parse (`:155`) and at load (`rn-llama.cpp:706`) | Payload sanity only (:92-101): `sensor_valid`, `isfinite(trend)`, battery 0..100. Plugged rule removed. The engine re-checks the same profile at governor init (`rn-llama.cpp:122` -> engine verdict -> same message `governor: thermo profile invalid`) and on every poll |
| Binding JSI `cpp/jsi/RNLlamaJSI.cpp:42` | - | Pure field copy | Unchanged (was already transport) |
| Engine `src/llama-governor-policy.cpp` | latch / gate / drift / clear / hot | SOLE SURVIVOR (unchanged): gate `:63` (`t_idle_valid && isfinite && +1 < 42`), latch first plugged sample `:99-100`, drift > 1.5 C -> Invalid `:101`, clear on unplug `:110`, `hot_plugged_ = plugged && t_idle_c >= 37.5f` `:115`, thresholds offset from incoming `t_idle_c` `:42-50` | Byte-identical logic. Only its doc comment in `src/llama-ext.h` (which described the removed app latch) was corrected, and a pin test added |

Unplugged polls: BEFORE the app emitted `t_idle_valid=false` (latch cleared); AFTER it
emits the raw sensor flag and live temperature. Both binding (`!plugged -> structural
only`) and engine (`profile_is_valid` returns true for unplugged before touching
`t_idle_*`, `:61-62`) ignore `t_idle_*` when unplugged: no behaviour change.

### 2.2 The exact cases where the old app rule and the engine rule disagreed

All values in degrees C. These are the statements for the owner.

**Case A - the numeric rule disagreement: `t_idle_c = 0.0`, plugged, `t_idle_valid = true`
(only reachable from the bench-skin path; the battery path cannot emit 0 because
`t_idle_valid` requires `temperature > 0`).**
- App rule `idle > 0 && idle + 1 < 42`: 0 > 0 is false -> app forced `t_idle_valid = false`
  -> binding plugged rule then refused -> parse threw `governor: thermo profile invalid`.
- Engine rule `t_idle_valid && isfinite && t_idle_c + 1 < 42`: 0 + 1 = 1 < 42 -> ACCEPTS,
  latches reference 0.0, and derives plugged thresholds from it: `critical_enter =
  min(0.0 + 3.0, 42.0) = 3.0` -> the live 35.0 reads CRITICAL immediately -> `admit_prefill`
  returns Abort. (Any negative baseline, e.g. -5.0, is the same: engine accepts, old app
  refused.)
- AFTER: the engine's answer is what ships. Pinned by the new engine test (section 5) and
  the new app pass-through test.

**Case B - the latch disagreement (production battery path): baseline latched at 35.0,
live temperature reaches 36.6 while still plugged.**
- BEFORE: Kotlin held 35.0 for the whole session, so the engine always received 35.0;
  drift `|35.0 - 35.0| = 0 <= 1.5` never fired. Profile stayed VALID, thresholds stayed at
  35.0 offsets (critical enter 38.0), `hot_plugged_` stayed false (35.0 < 37.5) even as the
  phone heated. The app latch MASKED the engine's drift check.
- AFTER: the engine receives the live value; at 36.6 the drift from the latched 35.0 is
  1.6 > 1.5 -> `profile_valid_ = false`, state Invalid -> `admit_prefill` -> Abort while
  the drift lasts: the engine recovers as soon as a later sample lands within 1.5 C of
  the latched reference, no unplug needed. Inside the window (e.g. live 36.4)
  thresholds and `hot_plugged_`
  now track the incoming value, so a baseline-latched-at-36.0 session becomes
  `hot_plugged_` at live 37.5 (drift 1.5, still accepted), which the constant app latch
  could never do.
- This is an intended consequence, not a defect: the engine's drift check and its test
  (`test-governor-v02-router`: "drifting plugged baseline invalidates profile", 35.0 ->
  36.6) were written for raw input. The mandate fixes the engine as the survivor.

**Case C - same numeric rule, different layer: plugged at load with battery at 41.0
(41 + 1 = 42, not < 42; both rules refuse).**
- BEFORE: app gate set `t_idle_valid = false` -> binding plugged rule threw at parse,
  before any model loaded.
- AFTER: raw value forwarded; binding parse ACCEPTS (structural checks pass); the refusal
  happens in the engine at governor init (`rn-llama.cpp:122` -> engine `profile_is_valid`
  false -> Invalid) and throws the SAME message `governor: thermo profile invalid`, after
  the two models were loaded. Same verdict, same message, later, sourced from the engine.
  Verified by the binding probe (section 6): before = REFUSED at parse, after = ACCEPTED
  at parse.

**Case D - the two independent latches could diverge (closed by construction).**
- BEFORE: the app latch cleared on the first unplugged sample IT SAW; the engine reference
  cleared on the first unplugged sample IT RECEIVED (`setGovernorThermo` pushes are gated
  by `activeGovernorActive && engine === context` and a timeout wrapper, while `readThermo`
  is polled per JS call). An unplug+replug seen by only one side left the two latches
  holding different references, and the engine's 1.5 C drift check then judged the app's
  held value against its older reference - an Invalid from two honest latches.
- AFTER: one latch, in the engine. Divergence is impossible by construction.

**No STOP was needed:** every behaviour delta above is exactly the mandated layering
(app forwards raw, binding transports, engine decides); the engine's thresholds,
tolerances and routing are byte-identical before and after (verified by the zero-diff on
`src/llama-governor-policy.cpp` between base and commit, section 9).

## 3. What changed, per repo (scope check)

| repo | commit | files | lines |
|---|---|---|---|
| kalsa | `kalsa-governor-policy-consolidate` | `native/GovernorBatteryModule.kt`, `src/engine/governorInputs.ts`, `src/engine/governorInputs.test.ts`, `src/engine/governorBatterySampler.test.ts` | +50 / -34 |
| llama.rn-kalsa | `kalsarn-governor-transport` | `cpp/rn-governor-params.cpp` only | +0 / -6 (plugged branch removed) |
| kalsallama | `kalsallama-governor-sole-decider` | `src/llama-ext.h` (doc comment, +4/-3), `tests/test-governor-v02-router.cpp` (pin, +10) | no logic change |

Nothing else was touched: no file moved, renamed, or tidied; no other file in the app's
`src/engine/` (136 files, 33,297 lines, 24 policy files) was edited; the engine's
`llama-governor-policy.cpp/.h` are unchanged by this task (the main checkout's dirty V73
hunk there belongs to another session and was not touched or carried into the worktree).
`src/engine/LlamaService.ts` (thermo forwarding, strips only `thermo_source`) needed no
change - it was already pure transport.

## 4. The stale `android/` duplicate: is it compiled, and is it dead?

File: `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` (11,864 bytes,
mtime Sep 16), in the kalsa MAIN checkout only.

**Proof chain:**
1. It is NOT source: `git ls-files android/` returns 0 files; `git check-ignore -v` reports
   `.gitignore:42:android/` - the whole `android/` tree is a git-ignored, generated
   prebuild output. It exists in no commit and in no worktree.
2. It is a generated COPY: `app.config.js:101` registers `./plugins/withGovernorBattery`,
   whose `withDangerousMod("android")` runs an UNCONDITIONAL
   `fs.copyFileSync(native/GovernorBatteryModule.kt -> android/.../GovernorBatteryModule.kt)`
   (`plugins/withGovernorBattery.js:24`) on every `expo prebuild` / `expo run:android`
   sync. The single source of truth is `native/GovernorBatteryModule.kt` (tracked).
3. The copy on disk was STALE: 0 occurrences of `idleBaselineTenthsC` / `t_idle_valid` /
   `t_idle_tenths_c` versus 8 in `native/` - it predates the defect-5.2 fields entirely
   (mtime Sep 16 < commit `e5788cf`, Sep 21).
4. It WOULD have compiled: `android/.../MainApplication.kt:3,26` imports and registers
   `GovernorBatteryPackage` from the same package, and gradle's default sourceSet includes
   `src/main/java`. So a bare `./gradlew` invocation without a prebuild would have compiled
   the STALE module and silently rebuilt the original defect (no `t_idle_*` fields at all).
   No APK build outputs exist under `android/app/build/` (checked), so no evidence any APK
   was ever compiled from it; it is dead as source, live as a trap.

**Action: deleted** the stale copy from the main checkout working tree (proof of death =
points 1-3: an ignored generated artifact whose generator always overwrites it from
`native/`). Consequences: the next prebuild regenerates a CURRENT copy (the plugin checks
no contents); the next bare-gradle run fails loudly on the missing class instead of
silently shipping a stale module. The deletion cannot appear in any commit because git
ignores the path - `git status --porcelain | md5` of the main checkout was
`3a62bfa9d784b6734216c6863fad5b96` BEFORE and identically `3a62bfa9d784b6734216c6863fad5b96`
AFTER: the main checkout's git-visible state is untouched.

## 5. Tests: what pins the survivor, and what was changed deliberately

**Pins added (engine - the survivor's home):**
- `tests/test-governor-v02-router.cpp` (new, in commit `942bc938`): feeds a plugged raw
  profile with `t_idle_valid = true, t_idle_c = 0.0` and asserts (a) the engine rule
  ACCEPTS it - the exact value the app's removed gate refused - and (b) the state derives
  to CRITICAL from the zero baseline (critical enter 3.0). This pins the boundary between
  the two rules where the engine now rules alone. The existing pins are untouched and
  still pass: 41.0 refused ("unsafe plugged baseline is refused"), 35.0 -> 36.6 drift trip,
  unplug keeps valid, replug latches fresh, hot 37.5 refuses acceleration.

**Tests CHANGED to match the deliberate behaviour change (stated here, in each test file's
own comment, and in each commit message - never quietly):**
1. `governorBatterySampler.test.ts` "latches the idle baseline on the plug-in edge and
   clears it on unplug" - asserted the removed Kotlin latch regex. REPLACED by "holds no
   latch state and reports the live temperature" (asserts `idleBaselineTenthsC` is absent
   and `t_idle_tenths_c` carries `temperature`). The companion test's expected strings were
   updated from `idleTenths` to `sensorValid`/`temperature`; its "no `t_idle_c` from
   native" half is kept.
2. `governorInputs.test.ts` "refuses a tenths value that leaks into the degrees field" -
   asserted the removed app gate (`t_idle_valid: false` for `t_idle_c: 350`). REPLACED by
   "forwards an out-of-range plugged baseline unchanged" (asserts pass-through; the engine
   refuses it, `llama-governor-policy.cpp:63`). Renamed: "lifts the latched plugged idle
   ..." -> "lifts the native plugged temperature ...".
3. Added an app-side pin for Case A: "forwards a zero plugged baseline for the engine to
   judge" (`t_idle_c: 0` must come out `t_idle_valid: true`) - the exact old-app/old-engine
   disagreement value.

No test asserted the removed binding rule (the binding has no governor tests; the app's
`test:governor-params` harness covers only the structural `sensor_valid=false` case, which
is kept - see section 6).

## 6. Evidence: real exit codes

### 6.1 App suite (kalsa worktree, `npx jest`)
- BEFORE (`e5788cfe`, clean worktree): **exit 0** - 94 suites, 1213 tests, all passed.
- AFTER (`0db9dc68`): **exit 0** - 94 suites, **1214** tests, all passed (+1 added pin,
  1 rewritten in place, 1 renamed, latch test inverted).
- Bonus `npx tsc --noEmit`: **exit 0**.
- No phone involved; all native interactions are jest-mocked.

### 6.2 Engine governor tests (kalsallama worktree, standing config `GGML_METAL=OFF`,
`GGML_OPENCL=OFF`; binaries run directly, alphabetical order, real `$?`)

| # | target | BEFORE (`833cde99b`) | AFTER (`942bc938`) |
|---|---|---|---|
| 1 | test-governor-v0 | 0 | 0 |
| 2 | test-governor-v0-commit | 0 | 0 |
| 3 | test-governor-v0-devices | 77 | 77 |
| 4 | test-governor-v0-hybrid | 77 | 77 |
| 5 | test-governor-v0-shared-cells | 0 | 0 |
| 6 | test-governor-v0-turns | 0 | 0 |
| 7 | test-governor-v02-router | 0 | 0 |
| (8) | test-governor-v0-mtp-hybrid | 77 | 77 |

The seven standing targets give **`0 0 77 77 0 0 0` before and after - exactly the standing
expectation**; router prints `router_v02_golden=PASS / router_v02_metrics=PASS`, zero FAIL
lines, including the new pin. The eighth target, `test-governor-v0-mtp-hybrid`, is
model-dependent (needs an MTP-layer model; skips 77 on the `stories15M` fixture), not
device-dependent, and is not one of the standing seven - it was run anyway and is stable at
77.

**Failed runs and their classification - nothing failed from this change:**
- A first baseline with default cmake options (`GGML_METAL=ON`) gave devices **exit 1**
  (`governor-devices: automatic staged/naive selection missing`,
  `tests/test-governor-v0-devices.cpp:240`): the test found the Metal GPU, ran the device
  path instead of skipping, and a pre-existing host check failed. That run was made BEFORE
  any edit, is a configuration mismatch with the standing records (which come from
  `GGML_METAL=OFF`), and is a genuine PRE-EXISTING host-test issue, unrelated to this
  change. The build was reconfigured to the standing config; all numbers above are from the
  standing config.
- Pre-existing genuine defect found, NOT caused, NOT fixed (out of scope):
  `npm run test:governor-params` (kalsa `scripts/governor-params-test.sh`) fails at clean
  HEAD with `fatal error: 'llama-ext.h' file not found` - its include flags predate the
  vendored layout (`node_modules/llama.rn/vendor/llama.cpp/src/llama-ext.h`). It fails
  identically before and after this change.

### 6.3 Binding check (the app's governor-params harness, compiled with corrected include
paths against pinned `node_modules` copy vs the changed worktree copy)
- BEFORE (pinned `0288dc27` copy): build **exit 0**, run **exit 0**, `governor_params=PASS`.
- AFTER (`cc804436` copy): build **exit 0**, run **exit 0**, `governor_params=PASS`
  (the structural `sensor_valid=false` refusal the harness requires is kept).
- Direct probe of the REMOVED rule (same harness, extra cases):
  - plugged `t_idle_c=41.5`, `t_idle_valid=true`: BEFORE `REFUSED (governor: thermo profile
    invalid)` -> AFTER `ACCEPTED` (engine refuses it later, same message, at init).
  - plugged `t_idle_valid=false`: BEFORE `REFUSED` -> AFTER `ACCEPTED` (same engine path).
  - unplugged `sensor_valid=false`: BEFORE `REFUSED` -> AFTER `REFUSED` (structural check
    kept - no change where none was mandated).

## 7. Pin-chain consequence: what must land first, and in what order

The three commits are independent and each passes its own suite at its own base, but the
landing order has one hard edge and one free one:

1. **`kalsarn-governor-transport` (binding) must land at or before
   `kalsa-governor-policy-consolidate` (app).** Reason: once the app sends raw values, the
   binding's third copy would be a second judge of raw input - the exact state being
   closed. Landing the binding first removes the third judge while the sender is still the
   old gated one: every value the old app sends satisfies the structural checks exactly as
   today, so the intermediate is verdict-identical: a value the old chain refuses is still
   refused with the same message, only detected later (engine init instead of parse, the
   same shift Case C declares). Landing them together is
   equally safe.
   - Note on verdicts: because the binding copy and the engine rule were numerically the
     same predicate on the same forwarded profile, even the forbidden order (app first)
     never produced two DIFFERENT verdicts - only two detection points (parse and engine
     init), both with the message `governor: thermo profile invalid`. The hard edge is
     about not leaving a second decider active, not about divergent answers.
2. **`kalsallama-governor-sole-decider` (engine) is order-free**: test + doc only, no
   behaviour; it passes at every intermediate state (verified: it was the FIRST thing built
   and run against the untouched base). Landing it before the app change means the pin is
   in place before raw values start flowing - recommended, but not required.
3. Delivery-chain consequence (kalsa `AGENTS.md`): the app pins the binding by commit in
   `package.json` (`"llama.rn": "github:Aspis0/kalsa.rn#0288dc27..."`). After the binding
   commit `cc804436` exists, the pin must be updated to it for shipped APKs to actually
   carry the transport change; until then `node_modules` keeps the old third copy. That is
   harmless (it agrees with the engine, section note above) but the duplication persists in
   the binary, so the pin bump is part of landing edge (1), not optional.

## 8. Commits (local refs only - nothing pushed)

| repo | ref | commit sha | parent | working tree |
|---|---|---|---|---|
| kalsa (app) | `kalsa-governor-policy-consolidate` | `0db9dc68228fa7a074fddffc13acf0ccb30493a3` | `e5788cfee46dd76dacd6893913d6c5f67b6ec762` | `/Users/marco/Projects/kalsa-wt-gov-policy`, clean |
| llama.rn-kalsa (binding) | `kalsarn-governor-transport` | `cc80443609bda38f0152730549b2861882d52964` | `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` | `/Users/marco/Projects/llama.rn-kalsa-wt-gov-transport`, clean |
| kalsallama (engine) | `kalsallama-governor-sole-decider` | `942bc938c9c3a551194b0d0e8690511ed6ade84c` | `833cde99b47b81f5f6a2a6309fbb8504033174f5` | `/Users/marco/Projects/kalsallama-wt-gov-sole`, clean |

- All three refs are local branches in their repos; `git branch -r --contains <sha>` is
  empty for all three (not on any remote). No `git push`, no tag, no PR, no release.
- The three main checkouts are untouched: same HEADs (`e5788cfe`, `0288dc27`, `833cde99b`)
  and byte-identical dirty status as before this task (the other sessions' uncommitted V73/
  OpenCL work was never carried into or out of the worktrees).
- The only main-checkout mutation is the deletion of the git-ignored stale `android/`
  copy (section 4), invisible to `git status` (md5 identical before/after).
- Each commit carries `Assisted-by: pi` (binding commit uses conventional format because
  that repo's lefthook/commitlint hook requires it).

## 9. Audit follow-up: two gaps closed, two words corrected

`AUDIT.md` (same directory): may land, every checkable claim confirmed, with two
gaps and two overstatements to close. Both gaps are now closed by new commits ON
TOP of the landing refs - no ref rewritten, nothing pushed, all work in the three
existing worktrees. The app ref is unchanged: `kalsa-governor-policy-consolidate`
stays at `0db9dc68228fa7a074fddffc13acf0ccb30493a3` (parent `e5788cfe`).

### 9.1 Gap 1 closed: the binding's deduplication is pinned

| ref | new commit | parent |
|---|---|---|
| `kalsarn-governor-transport` | `b97c581d7968ba516bdf66d05da9ad4d33bda67a` | `cc80443609bda38f0152730549b2861882d52964` |

Files: new `tests/governor_params_test.cpp` (113 lines), plus the wiring that
makes it a harness case rather than a one-off binary: registered in
`tests/CMakeLists.txt` (+9/-0, a host-only target that links only
`rn-governor-params.cpp` - a JSON parse test does not need the whole library),
built by `tests/build_and_test.sh` (+12/-1), run by `tests/run_tests.sh` (+20/-2)
as its own suite with its own pass/fail line and exit code. Total +154/-3, four
files, nothing under `cpp/` touched.

Four cases:
1. dead sensor refused at parse with the exact message
   `governor: thermo profile invalid` - the structural check the binding keeps;
2. plugged `t_idle_c=41.5, t_idle_valid=true` -> ACCEPTED at parse (the engine
   refuses it at init, same message);
3. plugged `t_idle_valid=false` -> ACCEPTED at parse (engine judges);
4. plugged `t_idle_c=0.0, t_idle_valid=true` -> ACCEPTED at parse (the engine now
   refuses it, section 9.2).

Load-bearing proof by mutation, the same method the audit used for the two app
layers:
- Re-add the removed plugged branch of `governor_thermo_profile_is_valid`
  (`if (!thermo.plugged) return true; return thermo.t_idle_valid &&
  std::isfinite(thermo.t_idle_c) && thermo.t_idle_c + 1.0f < 42.0f;`), rebuild
  (`make governor_params_test -j4` in `tests/build`), run: **2 failed / 2 passed,
  exit 1** - exactly cases 2 and 3 fail (`out-of-range plugged baseline forwarded`,
  `missing baseline flag forwarded`).
- Revert (`git diff cpp/` empty, byte-identical to `b97c581d`), rebuild, run:
  **4 passed, exit 0**.

Harness run at `b97c581d` (`tests/run_tests.sh`, real exit codes): parallel
28/28 exit 0, chat parse 18/18 exit 0, **governor params 4/4 exit 0** (its suite
banner and `Governor params tests passed` line both print), basic integration 2/6
-> harness exit 1. That one red suite is pre-existing and not from this change:
`tests/tiny-random-llama.gguf` is an unfetched git-lfs pointer on this machine
(git-lfs not installed), the suite's build inputs are untouched by this commit
(only `tests/` files changed), so it fails the same way at `cc804436`.

### 9.2 Gap 2 closed: 0 C or colder is refused again, by the engine

| ref | new commit | parent |
|---|---|---|
| `kalsallama-governor-sole-decider` | `35eeeae344939f1d1f90132f6a55dafa6e4ebc38` | `942bc938c9c3a551194b0d0e8690511ed6ade84c` |

Diff: `src/llama-governor-policy.cpp` +4/-1, `tests/test-governor-v02-router.cpp`
+11/-6, nothing else. The engine - the survivor - now owns exactly the rule the
removed app gate enforced: `profile_is_valid` requires `t_idle_c > 0.0f` for a
plugged profile, beside the existing `t_idle_valid && isfinite && +1 < 42`. No
threshold, tolerance, or other policy line changed. The app-side rule was NOT
restored: the layering mandate stands, the decision belongs to the engine.
`src/llama-ext.h` needed no edit - it already says the policy judges the raw
baseline through the validity gate, which now includes the `> 0` half.

Outcome restored: a plugged baseline of 0 C or colder (0.0, negative, or a
missing numeric field with `valid=true` - the bench-skin-only family) is REFUSED
again with `governor: thermo profile invalid`, the old verdict. Detection point:
engine init via `rn-llama.cpp:122-124` (the same path as Case C) instead of app
parse - timing only, no verdict change. The silent always-abort (critical-enter
3.0 C at zero, negative below zero) is gone.

The pin flips with the guard: the previous commit's zero-acceptance pin asserted
the opposite and would have gone red, so it is REPLACED, not left standing - the
test now requires zero refused, -5.0 refused, and state Invalid after the
refusal. Load-bearing proof by mutation: delete the `profile.t_idle_c > 0.0f &&`
guard, rebuild `ninja test-governor-v02-router`, run: **3 FAIL, exit 1**
(`engine rule refuses a zero plugged baseline`, `engine rule refuses a negative
plugged baseline`, `refused baseline leaves the state Invalid`). Restore from
`35eeeae34`, rebuild, run: **exit 0**, `router_v02_golden=PASS /
router_v02_metrics=PASS`.

Audit residuals closed by this section: its item 4 (0 C or colder now accepted,
negative sub-case disclosed only in a parenthesis) is gone as a behaviour; its
residual inaccuracy 4 (sub-cases never enumerated, never pinned) is closed -
section 10 row A enumerates them and the two tests pin 0.0, -5.0, the missing
flag, and 41.5. Supersessions inside THIS report: section 2.2 Case A's AFTER
column (engine accepts 0.0 -> CRITICAL abort) no longer holds; section 5's "no
test asserted the removed binding rule" and its zero-acceptance pin description
are closed by 9.1/9.2; section 2.1's "byte-identical engine logic" was true of
the original commits and stops being true of the engine gate at `35eeeae34`
(+4/-1 in `profile_is_valid`).

### 9.3 The two overstatements corrected (words only, no code)

- Section 7 (binding-first intermediate): "bit-for-bit behaviour-identical" now
  reads **verdict-identical**, with the reason: a value the old chain refuses is
  still refused with the same message, only detected later (engine init instead
  of parse, the shift Case C declares). (Audit residual inaccuracy 2.)
- Section 2.2 Case B: "Abort for the rest of the session" now says the abort
  lasts while the drift lasts - **the engine recovers as soon as a sample lands
  within 1.5 C of the latched reference**, no unplug needed. (Audit residual
  inaccuracy 3.)

### 9.4 Landing note (pending, required)

Re-checked first-hand this session: kalsa `package.json:49` and
`package-lock.json` (spec line 41, resolved `git+ssh` URL line 10017) still pin
`0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` - in the app worktree at `0db9dc68`
AND in main. Until that pin moves to `cc804436`, `node_modules` - and every APK
built from it - keeps the OLD third copy of the plugged rule. **The bump to
`cc804436` is a required step of the app landing, not a follow-up**, and the
ordering is unchanged: **binding at or before the app** (binding-first is
verdict-identical for the old sender; app-first stays the forbidden order). The
binding ref tip is now `b97c581d` (= `cc804436` plus the host-only test); a bump
to `cc804436` carries the transport change, a bump to `b97c581d` carries it plus
the pin.

### 9.5 Verification runs for this follow-up (real exit codes)

- App suite (kalsa worktree at `0db9dc68`, not modified by this follow-up):
  `npx jest` -> **exit 0**, 94 suites, **1214 tests**, 0 failed. The app's
  zero-baseline pass-through pin still passes: the app still forwards 0 with
  `t_idle_valid=true`, and the engine now judges it.
- Engine (kalsallama worktree at `35eeeae34`, standing config `GGML_METAL=OFF`,
  `GGML_OPENCL=OFF`, Release; the eight governor targets rebuilt with `ninja`;
  binaries run directly from `build/bin` in alphabetical order, real `$?`). The
  five model-dependent targets were run WITH the fixture:
  `-m build/tinyllamas/stories15M-q4_0.gguf`. Bare they exit 1 with
  `error: --model is required` (verified first-hand) - the trap the audit first
  hit. `test-governor-v0-hybrid` and `test-governor-v02-router` take no `-m`.

| # | target | exit |
|---|---|---|
| 1 | test-governor-v0 (-m fixture) | 0 |
| 2 | test-governor-v0-commit (-m fixture) | 0 |
| 3 | test-governor-v0-devices (-m fixture) | 77 |
| 4 | test-governor-v0-hybrid | 77 |
| 5 | test-governor-v0-shared-cells (-m fixture) | 0 |
| 6 | test-governor-v0-turns (-m fixture) | 0 |
| 7 | test-governor-v02-router | 0 |
| (8) | test-governor-v0-mtp-hybrid (-m fixture) | 77 |

Seven standing targets: **0 0 77 77 0 0 0** - the standing expectation,
unchanged by the guard - plus mtp-hybrid 77; router prints
`router_v02_golden=PASS / router_v02_metrics=PASS`, zero FAIL lines anywhere.
- Binding (at `b97c581d`): governor suite **4/4 exit 0** inside `run_tests.sh`;
  mutation **exit 1** (2 failed / 2 passed), revert **exit 0** (4 passed) -
  detail in 9.1.

## 10. Every behaviour delta the consolidation still produces (final table)

After `b97c581d` and `35eeeae34`, versus the three pre-change bases (kalsa
`e5788cfe`, binding `0288dc27`, engine `833cde99b`):

| Declared delta | Still produced? | Exact residual behaviour |
|---|---|---|
| A: bench plugged baseline 0 C or colder REFUSED -> ACCEPTED -> derived CRITICAL -> silent always-abort | **NO - verdict flip eliminated** | Old verdict restored: refused with `governor: thermo profile invalid` in both chains (0.0, negative, and missing-field siblings together); where it is detected moved parse (pre-load) -> engine init (post-load), the same residual shape as delta C, no verdict change. Pinned: engine refuses 0.0 and -5.0 with state Invalid; binding forwards 41.5, the missing flag and 0.0, and still refuses the dead sensor. |
| B: the app latch masked drift; plugged thresholds follow the live reading | **YES - as declared** | Drift > 1.5 C above the plug-in reference -> Invalid -> Abort while the drift lasts; the engine recovers as soon as a sample lands within 1.5 C of the latched reference, no unplug; inside the window thresholds and `hot_plugged_` track the live value. Pinned by the standing drift-trip and replug pins. |
| C: plugged 41.0 refused after load instead of at parse | **YES - as declared** | Same verdict, same message `governor: thermo profile invalid`, sourced from engine init instead of binding parse; pre-load -> post-load timing only. +/-Inf and NaN baselines sit in the same row: refused at parse before, refused at engine init after, detection point only. |

Plainly: **fewer.** Two of the three declared verdict deltas remain (B and C).
Delta A survives only as C's timing/layer shift (parse -> engine init, same
message); its verdict flip is gone. No fourth delta was found by the audit and
none reappears here: every plugged input the old chain refused, the engine now
refuses with the same message, and the audited non-deltas (mid-session sensor
loss, unplugged polls) are untouched.
