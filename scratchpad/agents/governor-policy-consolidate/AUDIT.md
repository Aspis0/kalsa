# Independent audit: governor latch consolidation (three repos)

Auditor: read-only review of local refs `kalsa-governor-policy-consolidate` (`0db9dc68`),
`kalsarn-governor-transport` (`cc804436`), `kalsallama-governor-sole-decider` (`942bc938`),
against the coder report in this directory and the recon report
`scratchpad/agents/governor-policy-duplication/REPORT.md`. Nothing was run on a phone;
no code, branch, or ref was touched in any of the three repos (all reproduction runs were
done in throwaway clones under `/tmp`).

**Verdict: the change may land as it stands, conditional on the landing rules already in
the report being followed exactly** - binding at or before the app, and the `package.json`
plus lockfile bump to `cc804436` as part of the app landing, not as a follow-up. Every
checkable claim in the report reproduced, including all exit codes. Four things the owner
must be told before it lands, in plain terms, because a governor change alters when
prefill is refused:

1. While plugged, prefill can now be refused when the battery temperature drifts more
   than 1.5 C above the value latched at plug-in. Before, the app's latch hid drift from
   the engine entirely, so this refusal could never fire from the app path. This is the
   intended point of the change, but it is new refusal behaviour on real phones.
2. Plugged thresholds and the hot-plugged classification now follow the live battery
   temperature instead of a plug-in-edge snapshot, so routing decisions can change
   mid-session where they previously could not.
3. Loading with an out-of-range plugged baseline (41 C or hotter) still fails with the
   same message (`governor: thermo profile invalid`), but after both models load instead
   of before. Same verdict, later, now sourced from the engine.
4. Via the bench skin only: plugged baselines of 0 C or colder that the app used to
   refuse at load are now accepted by the engine, which derives thresholds from them
   (critical-enter 3.0 C at zero, negative below zero) and then aborts prefill as
   CRITICAL - a silent always-abort instead of a clean load error. Negative values are
   the worst sub-case and are disclosed only in a parenthesis in the report; they are
   not enumerated as a case and no test pins them.

Also worth telling the owner: mid-session sensor glitches (temperature reads 0, sensor
lost) behave exactly as before - `sensor_valid` was already live truth in the old Kotlin
and the push path always fed the engine directly - and the binding layer's deduplication
is the one layer no committed test would catch if it were reintroduced (section 6).

## Verdict summary

| # | Audit item | Verdict |
|---|---|---|
| 1 | Scope, per commit, main checkouts untouched | CONFIRMED |
| 2 | The three deltas re-derived; input space enumerated | CONFIRMED (A, B, C) + two unpinned siblings of A found; no hidden fourth delta |
| 3 | Is the app still a decider? | CONFIRMED transport, with one named caveat |
| 4 | Engine gate covers the removed app gate | REFUTED in the narrow sense: `idle > 0` is not covered; the acceptance is Case A, acknowledged, reachable from bench skin only |
| 5 | Binding remains structural; probe flips | CONFIRMED (probe reproduced by compilation) |
| 6 | Exit codes; pins load-bearing | CONFIRMED (all reproduced); binding layer unpinned - gap |
| 7 | Stale `android/` duplicate chain; deletion safe | CONFIRMED, deletion judged safe |
| 8 | Pin chain and bump requirement | CONFIRMED, with one overstatement ("bit-for-bit identical") |

## 1. Scope

All three refs resolve to the stated SHAs with the stated parents
(`0db9dc68` -> `e5788cf`, `cc804436` -> `0288dc27`, `942bc938` -> `833cde99b`); all three
are local branches, `git branch -r --contains` is empty for each; all three exist only in
worktrees (`kalsa-wt-gov-policy`, `llama.rn-kalsa-wt-gov-transport`,
`kalsallama-wt-gov-sole`), each clean at its commit.

Per-commit real diffs:

- App `0db9dc68`: exactly `native/GovernorBatteryModule.kt`,
  `src/engine/governorInputs.ts`, `src/engine/governorInputs.test.ts`,
  `src/engine/governorBatterySampler.test.ts`, +50/-34, as claimed. No other file.
- Binding `cc804436`: exactly `cpp/rn-governor-params.cpp`. The report says "+0/-6";
  actual is +1/-5 (the `return true;` replacement). Net -4 either way; a trivial
  arithmetic slip in the report, not in the commit.
- Engine `942bc938`: exactly `src/llama-ext.h` (+4/-3, comment-only hunk - verified line
  by line) and `tests/test-governor-v02-router.cpp` (+10, the pin). Explicit zero diff on
  `src/llama-governor-policy.cpp` and `src/llama-governor-policy.h` between base and
  commit: the "byte-identical engine logic" claim is true.

Main checkouts: all three HEADs match the audit table (`e5788cfe`, `0288dc27`,
`833cde99b`). kalsa main's `git status --porcelain | md5` is
`3a62bfa9d784b6734216c6863fad5b96` - byte-identical to the value the report quotes, which
proves the git-visible state did not change between the report and now. llama.rn-kalsa
main is clean except the two untracked pnpm files, as described; kalsallama main's dirty
set (4 OpenCL files, `llama-governor-policy.cpp` V73 hunk, `tests/CMakeLists.txt`,
`test-opencl-moe-roundtrip.cpp`) matches the session snapshot. The dirty V73 hunk was not
carried into the engine commit (zero diff, above).

Anything extra that moved: (a) the declared deletion of the git-ignored stale
`android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt` in kalsa main - the
file is now absent, which is the one intentional main-checkout mutation and it is
git-invisible; (b) the three worktrees and three local branches themselves; (c) a build
directory and the downloaded `stories15M-q4_0.gguf` fixture inside the engine worktree
(both git-ignored); (d) pre-existing untracked files - kalsa main carries `CLAUDE.md`
(mtime Sep 21 23:07, a repo-map mirroring AGENTS.md, from another session) and
`local-artifacts/`; kalsallama main's `CMakeUserPresets.json` and `pkg-snapdragon/` are
dated Aug 31, well before this task. Nothing moved beyond the declared scope.

## 2. The deltas

Re-derivation from code. Old app gate: `governorInputs.ts:178` (verified line number at
`e5788cfe`): `idleValid = idleValidRaw && idle > 0 && idle + 1 < 42`, with `idle` falling
back to 0 when neither degrees nor tenths is finite. Old Kotlin: latch set once per
plugged session iff `present && temperature > 0`, `t_idle_valid = (latch != null)`, held
all session, cleared on unplug; `sensor_valid = present && temperature > 0` live. Old
binding plugged branch: `t_idle_valid && isfinite(t_idle_c) && t_idle_c + 1 < 42` at
parse (:155) and load (`rn-llama.cpp:706`) only - never on runtime pushes
(`rn-llama.cpp:688-689` goes straight to the engine, before and after). Engine:
`profile_is_valid:63`, latch `:99-100`, drift `:101`, clear `:110`, hot `:115`, all
verified at `942bc938` with those exact line numbers.

**Case A (plugged 0.0, valid=true) - CONFIRMED.** Old app: `0 > 0` false, so
`t_idle_valid` forced false, old binding refuses at parse, pre-load. Engine: `0 + 1 < 42`
accepts, latches 0.0, derives critical-enter `min(0+3, 42) = 3.0`, so live 35.0 classifies
CRITICAL and `admit_prefill` returns Abort (and keeps doing so: critical-exit is 1.0,
unreachable). My compiled probe adds a fact the report implies but does not state: the OLD
binding also accepted plugged 0.0 - the refusal came solely from the app's `idle > 0`.
Pinned at both layers (engine test `:175-183`, app test "forwards a zero plugged
baseline").

**Case B (latched 35.0 vs live 36.6) - CONFIRMED, one nuance.** Old: the Kotlin latch
held 35.0 all session, so the engine saw a constant and `|35.0 - 35.0| = 0` never tripped
the 1.5 C drift check; thresholds stayed at 35.0 offsets, `hot_plugged_` stayed false.
New: the engine receives the live value; at 36.6 the drift from the 35.0 reference is
1.6 > 1.5 -> `profile_valid_ = false`, state Invalid, `update_thermal` returns false,
`admit_prefill` Aborts. The report's "for the rest of the session" slightly overstates:
Invalid is not permanently sticky - a later sample back within 1.5 C of the (fixed)
reference passes the drift check and reclassifies via `llama-governor-policy.cpp:131`, so
the abort lasts exactly as long as the drift does. On a phone that stays hot, that is
indefinite; on a cooling phone it recovers. Inside the window, thresholds and
`hot_plugged_` track the live value (a session latched at 36.0 becomes hot-plugged at
live 37.5), which the constant latch could never produce. Both effects are intended per
the mandate; the engine's standing pins (drift trip, replug re-latch) are untouched.

**Case C (plugged 41.0 at load) - CONFIRMED.** `41 + 1 = 42` is not `< 42`: both rules
refuse, and my probe confirms the old binding refused 41.5 at parse while the new binding
accepts it at parse. In the new chain the refusal happens in the engine at governor init
(`rn-llama.cpp:122-124` throws the identical message after both models load). Same
verdict, same message, later, engine-sourced.

### Input-space enumeration (plugged, sensor present, trend finite, battery in range)

The battery path can only emit `temperature > 0` (validity requires it), so rows marked
[bench] are reachable only from the bench skin (`kalsa.bench.thermo`) or a profile with
missing numeric fields.

| t_idle_c | valid | Old end-to-end (app gate active) | New end-to-end (engine sole decider) | Verdict flip? | Covered by the three cases? |
|---|---|---|---|---|---|
| 0.0 [bench] | true | refuse at parse (app `idle > 0`) | accept, latch 0.0, CRITICAL at live >= 3.0, Abort while it persists | REFUSED -> ACCEPTED | Case A, pinned both layers |
| < 0, e.g. -5.0 [bench] | true | refuse at parse (app `idle > 0`) | accept, thresholds from a negative reference (critical-enter -2.0), everything CRITICAL, Abort | REFUSED -> ACCEPTED | disclosed only as a parenthesis inside Case A; NOT enumerated, NOT pinned anywhere |
| missing/NaN with valid=true [bench] | true | refuse at parse (idle falls back to 0) | forwarded as 0.0 + valid -> same as row 1 | REFUSED -> ACCEPTED | same 0.0 family, distinct trigger, not tabulated |
| (0, 41), drift <= 1.5 | true | accept; thresholds fixed at latch | accept; thresholds and hot-plugged track live | accepted by both, outcomes differ | Case B, pinned (drift, replug) |
| (0, 41), drift > 1.5 | true | accept forever (latch masked drift) | Invalid -> Abort while drifted; recovers within 1.5 C of reference | ACCEPTED -> REFUSED | Case B, pinned |
| >= 41.0 (i.e. +1 >= 42) [bench or battery-impossible] | true | refuse at parse, pre-load | parse accepts; engine init refuses post-load, same message | refusal, layer moves | Case C, probed |
| +/-Inf, NaN | true | refuse (NaN fails `idle > 0`; Inf fails `+1 < 42`) | parse accepts; engine `isfinite` refuses -> Invalid/throw | refusal, layer moves | implicit in C; not tabulated |
| <= 0 temp or sensor lost, mid-session | n/a (sensor_valid=false) | push reaches engine, `:54` sensor_valid check -> Invalid -> Abort, recovers on next good sample | identical (new `t_idle_valid` equals `sensorValid`, so no new path) | NO CHANGE | not stated in the report; verified non-delta |
| unplugged, any t_idle_* | any | engine returns true before reading t_idle (`:60-62`); old app gate could null the flag harmlessly | identical; new Kotlin emits valid=true unplugged, still ignored | NO CHANGE | report section 2.1 note, correct |

**Hidden-fourth-delta search result: none that changes production behaviour.** The two
un-tabulated rows (negative baselines; missing-field-with-valid-flag) are siblings of
Case A, bench-skin only, disclosed in part, pinned in none - they are the closest thing
to a hidden delta and should be added to the owner's talking points. The scary-looking
candidate - a mid-session battery glitch killing the session where the latch used to
absorb it - is refuted: the old Kotlin already reported `sensor_valid` as live truth and
the old push path already let the engine Invalid-and-recover on it, so that behaviour is
byte-for-byte unchanged.

## 3. Is the app still a decider?

No - it is a transport with one residual measurement judgment, and I judge that
defensible. The new Kotlin computes `sensorValid = present && temperature > 0` and emits
it as BOTH `sensor_valid` and `t_idle_valid` - the same value under two names. The flag
reports the sensor (present, and the reading is not the dumpsys "no data" 0.0); it says
nothing about whether a baseline is acceptable. The engine imposes no `> 0` requirement
anywhere - that is precisely what the new zero-baseline pin codifies - so the app's
clause is not a copy of engine policy. No consumer treats it as policy: the binding checks
`sensor_valid` structurally and never reads `t_idle_valid` after the change; the engine
consumes the flag as an input to its own rule, which is the agreed layering (the app
vouches for its measurement, the engine judges the value). The honest caveat: the `> 0`
clause is inherited verbatim from the deleted latch's precondition, and it is the reason
Case A is unreachable from the battery path - a policy fragment in miniature, but about
sensor plausibility, not about the governor's thresholds. Redundancy note: with
`t_idle_valid` identically equal to `sensor_valid` on the battery path, the two fields
are now redundant in production and differ only for a hand-made client.

## 4. The engine's gate

REFUTED in the narrow sense the question anticipated. The engine's condition
(`llama-governor-policy.cpp:63`) is `t_idle_valid && isfinite(t_idle_c) && t_idle_c + 1 <
42`. It covers the app's `idle + 1 < 42` half exactly (adding `isfinite`, which the app
got implicitly from its number coercion) but it does NOT cover `idle > 0`. So something
that used to be refused is now accepted by default: any plugged profile with
`t_idle_valid = true` and `t_idle_c <= 0`. When it fires: only from the bench skin or a
profile missing numeric fields (the battery path withholds validity whenever
temperature <= 0, so production cannot produce it). What happens: the engine latches the
value, derives thresholds from it (critical-enter `t_idle + 3`, i.e. 3.0 C at zero,
negative below zero), classifies CRITICAL immediately, and `admit_prefill` returns Abort
for as long as that profile persists - indefinitely for 0.0/negative, since the exit
threshold sits at or below 1.0 C. This is Case A, acknowledged by the report and pinned;
the negative sub-case is the part that is neither enumerated nor pinned.

## 5. The binding

CONFIRMED. What remains in `governor_thermo_profile_is_valid` is `!sensor_valid -> false`,
`!isfinite(trend) -> false`, battery outside 0..100 -> false, then `return true`. All
three are payload sanity: they reject malformed or self-contradictory input, and none of
them encodes the engine's numeric policy. The plugged branch deletion means
`t_idle_valid`/`t_idle_c` now pass through untouched.

Probe reproduced by compiling `scripts/governor-params-test.cpp`-style cases against each
revision (`g++` with the binding's vendored `llama.cpp` headers; old = `0288dc27` main
checkout, new = worktree at `cc804436`):

| case | old binding | new binding |
|---|---|---|
| plugged, t_idle_c=41.5, valid=true | REFUSED (`governor: thermo profile invalid`) | ACCEPTED |
| plugged, t_idle_valid=false | REFUSED | ACCEPTED |
| plugged, t_idle_c=0.0, valid=true | ACCEPTED | ACCEPTED |
| unplugged, sensor_valid=false | REFUSED | REFUSED |

All four lines match the report's section 6.3 (the 0.0 row is my addition and supports
Case A's attribution). The flip is correct under the new layering, not a new hole: every
governor-enabled path reaches the engine's own check - at init
(`rn-llama.cpp:122-124`, same message, after both models load) and on every push
(`rn-llama.cpp:688-689` -> `rn_governor::set_thermo_profile` -> `update_thermal`, whose
`profile_is_valid` rejects unsafe plugged values, returning false to JS without
throwing). The only cost is timing: parse-time refusal becomes post-load refusal, which
is exactly Case C.

## 6. The tests

All claimed exit codes reproduced independently (in throwaway clones, not the
deliverable worktrees):

- App jest BEFORE (`e5788cfe`): exit 0, 94 suites, 1213 tests - exact.
- App jest AFTER (`0db9dc68`): exit 0, 94 suites, 1214 tests - exact. `tsc --noEmit`: 0.
- Engine, standing config (`GGML_METAL=OFF`, `GGML_OPENCL=OFF`, fixture
  `stories15M-q4_0.gguf` passed as `-m`, which the five model-dependent targets require -
  run bare they exit 1 with "--model is required"): BEFORE `833cde99b` rebuilt from a
  fresh clone gives `0 0 77 77 0 0 0` (v0, commit, devices=77, hybrid=77, shared-cells,
  turns, router) plus mtp-hybrid 77; AFTER worktree binaries give the same `0 0 77 77 0
  0 0`, router prints `router_v02_golden=PASS` / `router_v02_metrics=PASS`, zero FAIL
  lines. Identical before and after, exactly as claimed.

Load-bearing check, done by mutation in a clone at `0db9dc68`:

- Reintroducing the old app gate (`idleValid = idleValidRaw && idle > 0 && idle + 1 <
  42`) in `governorInputs.ts` fails exactly the two new pass-through pins: "forwards an
  out-of-range plugged baseline unchanged" and "forwards a zero plugged baseline for the
  engine to judge" (2 failed / 9 passed in that file). A gate that silently returns
  would be caught.
- Reintroducing the Kotlin latch (restore `idleBaselineTenthsC` and the plug-in-edge
  block) fails 2 tests in `governorBatterySampler.test.ts`: "holds no latch state..."
  (the `not.toContain("idleBaselineTenthsC")` absence pin) and "reports the raw sensor
  flag..." (2 failed / 15 passed). Caught.
- The engine pin ("engine rule accepts a zero plugged baseline", "zero baseline derives a
  three-degree critical enter") is present in the committed binary (verified via
  `strings`, and absent from my base build) and fails by construction if anyone ever adds
  a `> 0` clause to the engine gate: `update_thermal` would return false and the state
  would not be CRITICAL. It pins the engine-side boundary decision. Note it tests the
  engine struct directly, so it cannot detect app- or binding-layer reintroduction - the
  app pins cover the app layer, as demonstrated above.

The gap: the binding layer is unpinned. No committed test anywhere - app, binding, or
engine - would fail if someone re-added the plugged branch to
`governor_thermo_profile_is_valid`. The binding repo has no governor test for that
branch; the app's `test:governor-params` harness covers only the structural
`sensor_valid=false` case; the engine pin tests the engine only. The author clearly knows
this (the report states no test asserted the removed rule, and the section 6.3 probe
demonstrates the flip) but the probe was never committed as a test. A three-line addition
to the existing harness (plugged 41.5 must be ACCEPTED at parse, keeping a comment that
the engine owns the refusal) would close it. Not a blocker - the property is enforced
socially by this audit and the report - but the "sole decider" property is currently
unprotected at one of the three layers, which is worse than no pin only in the sense
that it is silent.

## 7. The stale `android/` duplicate

Every link of the chain verified in kalsa main:

1. Untracked: `git ls-files android/` returns 0 files; `git check-ignore -v android/`
   reports `.gitignore:42:android/`. Confirmed.
2. Regenerated unconditionally: `plugins/withGovernorBattery.js` registers
   `withDangerousMod("android")` whose body is `fs.mkdirSync` + `fs.copyFileSync(native/
   GovernorBatteryModule.kt -> android/app/src/main/java/com/kalsa/app/...)` with no
   existence or contents check - it overwrites on every prebuild/run:android sync.
   Registered at `app.config.js:101`. Confirmed.
3. Referenced so gradle would compile it: the plugin's `withMainApplication` half injects
   `import com.kalsa.app.GovernorBatteryPackage` (`MainApplication.kt:3`) and
   `add(GovernorBatteryPackage())` (`:26`) into the generated `MainApplication.kt` (still
   on disk, mtime Sep 16), and gradle's default sourceSet includes `src/main/java`. A
   bare `./gradlew` against the existing `android/` tree would have compiled the stale
   module (which predated the defect-5.2 fields entirely). Confirmed.
4. Current state: the stale `GovernorBatteryModule.kt` under `android/` is deleted
   (absent), `MainApplication.kt` remains, and the deletion is invisible to git because
   the path is ignored.

Judgment: deleting it is safe, including for a CI path that runs gradle without the
plugin step - because such a path cannot work anyway. `android/` is git-ignored, so a
fresh CI clone has no `android/` tree at all and gradle fails before compilation no
matter what; any CI that does have an `android/` tree got it from a prebuild, which runs
the plugin and regenerates a current copy from `native/`. The one degraded scenario - a
warm cached `android/` tree plus a skipped plugin - now fails loudly at compile (missing
class referenced by `MainApplication.kt`) instead of silently shipping the stale
pre-defect module. Silent-wrong to loud-fail is strictly better. No objection.

## 8. The pin chain

Verified: kalsa `package.json:49` pins
`github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` at the app commit AND
in the main checkout, and `package-lock.json` resolves it to the same sha (spec entry and
`git+ssh` resolved URL). The bump to `cc804436` has not been made - it is a real,
pending requirement, and kalsa's own `AGENTS.md` (and `CLAUDE.md`) define the delivery
chain exactly as the report describes (engine -> binding `vendor/VERSIONS` -> app
package.json + lockfile pin -> `scripts/assert-engine-provenance.sh`). Until the bump,
`node_modules` - and therefore any APK built now - keeps the old third copy.

Ordering logic, checked combination by combination:

- Binding first, app second (recommended): safe. The old app only emits values the new
  binding's structural checks accept, so nothing new is refused at parse. One
  overstatement: the report calls this intermediate "bit-for-bit behaviour-identical".
  It is not, quite: for values the old app refuses (it sends `t_idle_valid=false`), the
  refusal moves from parse-time (pre-load) to engine-init (post-load) - same verdict,
  same message, later timing, i.e. Case C applies early. Verdict-identical, not
  bit-identical.
- App first, binding second (the forbidden order): confirmed harmless, as the report's
  note argues. The old binding predicate is numerically identical to the engine's on the
  same forwarded profile (my probe: the old binding ACCEPTS plugged 0.0, like the
  engine), so no input ever gets two different verdicts - only two detection points.
- Engine commit anywhere: order-free, verified empirically - my fresh base build ran the
  old test file (no pin) clean, and the commit itself is comment + additive test only.
- No bump (shipped status quo): behaviourally near-identical today because the stale
  binding copy agrees with the engine on every value; what is lost is (a) the property -
  a future engine-rule change would silently re-diverge from the shipped copy, and (b)
  the new refusal timing - shipped builds keep parse-time refusals instead of the
  engine-init refusals the app now expects. The report's framing ("harmless but the
  duplication persists, so the bump is part of landing edge (1), not optional") is
  accurate, and I concur with treating the bump as part of the landing.

## Residual report inaccuracies (none blocking)

1. Binding diff stated as "+0/-6"; actual "+1/-5" (net -4 either way).
2. "Bit-for-bit behaviour-identical" for the binding-first intermediate - verdict-identical
   is what holds; refused values change detection point (section 8).
3. Case B's "Abort for the rest of the session" - the abort lasts while the drift from
   the fixed reference persists; recovery is possible without an unplug
   (`llama-governor-policy.cpp:131`).
4. The negative-baseline and missing-field sub-cases of Case A are disclosed in a
   parenthesis but not enumerated or pinned (section 2 table).

## Reproduction notes

All verification runs used throwaway clones: `/tmp/audit-kalsa` (jest/tsc at both app
refs, plus the two mutants), `/tmp/audit-engine-base` (fresh Release configure
`GGML_METAL=OFF GGML_OPENCL=OFF`, eight targets built and run at `833cde99b`), and
`/tmp/gov-probe` (probe compiled against both binding revisions with the vendored llama.cpp
headers). The deliverable worktrees and all three main checkouts were only read, never
written; the probe binaries and clones can be deleted freely.
