# Independent audit, follow-up: the two gap-closing commits

Reviewer: read-only verification of the two follow-up commits that closed the gaps found
in `AUDIT.md` (and section 9 of `REPORT.md`). Binding `kalsarn-governor-transport` moved
`cc804436` -> `b97c581d7968ba516bdf66d05da9ad4d33bda67a` (parent `cc804436`); engine
`kalsallama-governor-sole-decider` moved `942bc938` ->
`35eeeae344939f1d1f90132f6a55dafa6e4ebc38` (parent `942bc938`); app
`kalsa-governor-policy-consolidate` is unchanged at `0db9dc68` (parent `e5788cfe`).
All three refs resolve to those SHAs with those parents. The three worktrees are clean at
their commits (the binding worktree keeps its two pre-existing untracked pnpm files); the
three main checkouts are untouched (`833cde99b`, `0288dc27`, `e5788cfe`). Everything below
was reproduced in throwaway clones under `/tmp`; no repo, ref, or worktree was written.

**Verdict: as far as code correctness goes, the consolidation is closed.** The engine
guard restores the removed app rule's outcome for every input the app can produce, the
two mutation claims reproduce exactly (including which tests fail), the new binding test
is reachable through the repo's own documented test path, the one red suite is the
pre-existing git-lfs fixture and not this commit, and the final delta table is accurate
(A eliminated, B and C remain, no fourth case). What still requires the owner before it
can land is only landing mechanics, and all of it is owner action by the repos' own
rules: (1) the kalsa `package.json` + `package-lock.json` bump off `0288dc27` (to
`cc804436` or `b97c581d`), which has not been made in the worktree or in main; (2) the
binding's vendored-engine sync (`vendor/VERSIONS` still pins engine `4ccef2f8`, which
predates the guard), so a built APK actually carries the guarding engine; (3) the landing
order, binding at or before app; and (4) the commits/pushes themselves - every ref is
local-only, nothing is pushed, and pushing is the owner's call.

## 1. The engine guard

Commit `35eeeae34` touches exactly two files: `src/llama-governor-policy.cpp` +4/-1 and
`tests/test-governor-v02-router.cpp` +11/-6. The policy hunk replaces only the return
statement of `profile_is_valid` (now `llama-governor-policy.cpp:63-67`) with the same
expression plus `profile.t_idle_c > 0.0f` and a two-line comment:

    return profile.t_idle_valid && std::isfinite(profile.t_idle_c) && profile.t_idle_c > 0.0f &&
           profile.t_idle_c + 1.0f < 42.0f;

No threshold or tolerance moved anywhere in the commit: `42.0f`, the `+1.0f` margin, the
threshold table (`get_thresholds`, `:42-51`), the 1.5 C drift check (`:104`), the 37.5 C
hot-plugged line (`:118`), and every constant at `:8-15` are byte-identical. `src/llama-ext.h`
is untouched. The guard sits in the ENGINE, the survivor: the app at `0db9dc68` has no
range rule left (`governorInputs.ts:183` forwards `t_idle_valid: idleValidRaw`, and its
comment says validity is the engine's decision; the Kotlin side emits raw observations,
`GovernorBatteryModule.kt:61-67`). The rule was not put back in the app.

Input space, plugged profile, `sensor_valid=true`, finite trend, battery 0..100,
`t_idle_valid=true` unless stated. Stages: BEFORE = the three pre-change bases
(app `e5788cfe` gate active, binding `0288dc27` plugged branch, engine `833cde99b`);
AFTER-NOGUARD = `0db9dc68` + `cc804436` + `942bc938`; AFTER = same with engine
`35eeeae34` (binding `b97c581d` is tests-only, behaviourally identical to `cc804436`).

| input | BEFORE | AFTER-NOGUARD | AFTER | verdict |
|---|---|---|---|---|
| `t_idle_c = 0.0` [bench-skin only] | refused: app gate `idle > 0` false (`governorInputs.ts:178` at `e5788cfe`) forces `t_idle_valid=false`; old binding refuses at parse, load fails pre-load, `governor: thermo profile invalid` | accepted: engine `0 + 1 < 42` true, latches 0.0, critical-enter 3.0, live ~35 C reads CRITICAL, `admit_prefill` Abort, critical-exit 1.0 unreachable = silent always-abort | refused: `0 > 0` false -> `profile_is_valid` false -> Invalid (`:93-99`); governor init throws the same message post-load (`rn-llama.cpp:121-124`) | old verdict restored; detection moves parse -> engine init, timing only |
| negative, e.g. `-5.0` [bench-skin only] | refused, same chain (`-5 > 0` false) | accepted, thresholds from a negative reference (critical-enter -2.0), everything CRITICAL, silent always-abort | refused (`-5 > 0` false), Invalid, same message at init | old verdict restored, same timing shift |
| missing numeric field, `t_idle_valid=true` [bench-skin / hand-made] | app coercion sends missing to 0 -> identical to row 1 (refuse at parse) | reaches the engine as 0.0 (binding default `rn-governor-params.cpp:87`, `value_or(..., 0.0f)`) -> identical to row 1 | identical to row 1: refused by the same guard at init | old verdict restored |
| NaN | cannot exist in JSON; through the app it coerces to 0 -> row 1; if one reached the old binding, its own `isfinite` refused at parse | engine `isfinite` refuses at init, Invalid/throw | identical to AFTER-NOGUARD (`isfinite` precedes `> 0`) | refused in all three stages; guard adds nothing |
| +/-Inf | refused (app `+1 < 42` fails; hand-made refused by binding `isfinite` at parse) | engine `isfinite` refuses at init | identical to AFTER-NOGUARD | refusal in all stages; layer moves parse -> init, which is the declared Case C family |
| plausible positive, e.g. 35.0, drift <= 1.5 | accepted | accepted | accepted (guard inert at 35 > 0) | no change, correct |
| 41.0 / 41.5 (Case C) | refused at parse, pre-load | parse accepts; engine init refuses post-load, same message | identical (41.5 passes `> 0`, fails `+1 < 42`) | as declared; follow-up changes nothing |

So: the guard restores exactly the removed app rule's outcome, and nothing more, for
every input the app can emit. Both app paths (battery and bench skin) went through the
old gate (`profileFrom` was applied to the bench value too, `governorInputs.ts:190-199`
at `e5788cfe`), and the battery path cannot emit `<= 0` with a valid flag at all
(Kotlin validity requires `temperature > 0`). The one input class where AFTER differs
from BEFORE is a hand-made client that bypasses the app and pushes plugged `t_idle_c <= 0`
with `t_idle_valid=true` straight into the binding: there the OLD chain accepted
end-to-end (the audit's own probe showed the old binding accepted 0.0 at parse, and the
old engine accepted it into the CRITICAL always-abort), while the new chain refuses it at
the engine into Invalid. Both refuse prefill; the difference is state and recovery
semantics, it is unreachable from the app, and it is on the refusal-safe side. I do not
count it as a fourth delta, but it belongs in the owner's talking points for precision.

## 2. The pins are load-bearing - both mutations reproduced

(a) Engine, throwaway clone at `35eeeae34` (`/tmp/followup-engine`, configured
`GGML_METAL=OFF GGML_OPENCL=OFF`, Release, `ninja`-equivalent `cmake --build --target
test-governor-v02-router -j10`):

- unmutated: `router_v02_golden=PASS` / `router_v02_metrics=PASS`, **exit 0**;
- guard deleted (the single expression ` profile.t_idle_c > 0.0f &&` + continuation
  removed): **3 FAIL, exit 1** - `engine rule refuses a zero plugged baseline`,
  `engine rule refuses a negative plugged baseline`, `refused baseline leaves the state
  Invalid` - exactly the three names claimed;
- `git checkout` restore (0-line diff), rebuild: **exit 0**, both PASS lines back.

(b) Binding, throwaway clone at `b97c581d` (`/tmp/followup-binding`, the repo's own
`tests/` CMake, `make governor_params_test`):

- unmutated: **4 passed, exit 0**;
- old plugged branch re-added into `governor_thermo_profile_is_valid`, verified
  byte-identical to the `0288dc27` function: **2 failed / 2 passed, exit 1** - and the
  failing two are exactly `out-of-range plugged baseline forwarded` and
  `missing baseline flag forwarded`, as REPORT.md 9.1 states. The zero-baseline pin
  still passes under this mutant, correctly: the old branch accepted 0.0 (its refusal
  lived in the app gate), so it cannot catch this reintroduction;
- restore (0-line diff), rebuild: **4 passed, exit 0**.

Because the zero pin surviving mutation (b) is exactly the situation the prompt warns
about, I also ran the mutation the pin exists for: transplanting the FULL old app rule
(`t_idle_valid && isfinite && t_idle_c > 0.0f && t_idle_c + 1.0f < 42.0f`) into the
binding. Result: **3 failed / 1 passed, exit 1**, with `zero plugged baseline forwarded
for the engine` among the failures. No pin passes both ways: the pair of tests covers
both the historical branch and the transplanted rule.

## 3. The binding test is wired, not orphaned

At `b97c581d`, `tests/governor_params_test.cpp` (113 lines, four cases) is reachable
through the repo's normal test path with no special knowledge:

- `tests/CMakeLists.txt:127-134` registers a host-only target linking only
  `rn-governor-params.cpp` (`+libm` on Linux) - any configure+build of `tests/` builds it;
- `tests/build_and_test.sh:53-77` builds it (hard-fails if the binary is missing) and
  lists it among the built executables;
- `tests/run_tests.sh:37-42` exits 1 with "Please run ./build_and_test.sh first" when it
  is absent, and `:84-95` runs it as its own suite with its own pass/fail line;
  `TOTAL_SUITES` goes 3 -> 4 (5 when the KV models exist);
- `tests/README.md:13-16` documents `./build_and_test.sh` + `./run_tests.sh` as the test
  path, so the next person running the documented commands gets the suite automatically.

I verified end-to-end in the fresh clone: clone -> configure -> build -> run all work,
and the suite prints its banner and `Governor params tests passed`. Nothing under `cpp/`
changed (`git diff cc804436..b97c581d -- cpp/` is empty).

The one red suite is pre-existing and is the git-lfs fixture: `tests/tiny-random-llama.gguf`
is a 133-byte unfetched LFS pointer (declared size 65,973,792) on this machine, where
`git-lfs` is not installed. Full harness runs in my clone: at `b97c581d`, basic
integration **2 passed / 4 failed**, parallel decoding **28/28**, chat parse **18/18**,
governor params **4/4**, KV skipped, harness **exit 1**. At parent `cc804436` the same
harness gives basic integration 2/6 red, parallel 28/28, chat 18/18, **exit 1** -
identical red, minus the new green suite. The commit did not break it: every model-load
error is `failed to load model from ../tiny-random-llama.gguf`, and the parent fails the
same way with none of this commit's files present.

## 4. The delta table

REPORT.md section 10 claims A eliminated, B and C remaining, no fourth case. Verified:

- **A eliminated in all three sub-cases.** 0.0 and -5.0 are refused by the engine with
  state Invalid, pinned by the two new router assertions (`test-governor-v02-router.cpp:175-189`
  at `35eeeae34`, and both pins demonstrably fail without the guard). The missing-field
  sibling reaches the engine as exactly 0.0 - via the app's fallback-to-0 coercion or the
  binding's `value_or(..., 0.0f)` default (`rn-governor-params.cpp:87`) - so the same
  guard refuses it; its transport half is pinned by the binding's zero-baseline case.
  What survives of A is only the C-shaped timing shift (parse -> engine init, same
  message), which the table says.
- **B as declared.** The follow-up diff touches only `profile_is_valid`; latch
  (`:100-103`), drift (`:104`), clear (`:111-114`), and `hot_plugged_` (`:118`) are
  untouched, and the standing drift-trip and replug pins pass in the unmutated baseline
  run (exit 0, both PASS lines).
- **C as declared.** 41.5 is forwarded at parse (binding pin) and refused at engine init
  with the same message; unchanged by the follow-up. +/-Inf and NaN stay in C's row:
  refused before at parse, refused now by the engine's `isfinite`/range terms at init.
- **No fourth case.** My independent search found only the hand-made-client push nuance
  from section 1 (old chain accepted a bypassing client's plugged `<= 0`, new chain
  refuses it into Invalid; both abort prefill, app-unreachable, refusal-safe). The
  structural checks (dead sensor, trend, battery range) and the unplugged early-return
  (`:60-62`) are unchanged, so the audited non-deltas stay non-deltas.

## 5. The landing note

Re-checked first-hand, all six places:

- kalsa worktree at `0db9dc68` (`kalsa-wt-gov-policy`): `package.json:49` pins
  `github:Aspis0/kalsa.rn#0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2`; `package-lock.json:41`
  (spec) and `:10017` (`resolved` `git+ssh://git@github.com/Aspis0/kalsa.rn.git#0288dc27...`)
  agree.
- kalsa main checkout (HEAD still `e5788cfe`): the same three lines, byte-identical pins.
- The installed copy matches the pin: `node_modules/llama.rn` in BOTH the worktree and
  main still contains the old plugged branch (`cpp/rn-governor-params.cpp:100`,
  `if (!thermo.plugged) return true;` followed by the old rule).
- The binding's `vendor/VERSIONS` pins the vendored engine at `4ccef2f8` - an ancestor of
  the engine base `833cde99b` that predates the whole consolidation; the vendored
  `llama-governor-policy.cpp` has no guard.

So an APK built today carries none of this work. Built from kalsa main it is fully
pre-consolidation (gated app + third binding copy + guardless engine). Built from the app
worktree it is the forbidden intermediate: the app forwards raw values, but the OLD
binding still judges them at parse (41 C still dies pre-load) and the OLD engine still
accepts a bench `<= 0` baseline into the silent CRITICAL always-abort - the exact
behaviour this follow-up exists to remove. The bump to `cc804436`/`b97c581d` and an
engine re-vendor to a commit containing `35eeeae34` are required parts of landing, and
the ordering rule stands: binding at or before the app.

## Reproduction notes

Throwaway clones only: `/tmp/followup-engine` (fresh clone of kalsallama at `35eeeae34`,
standing engine config, `test-governor-v02-router` built three times: baseline, mutant,
restored) and `/tmp/followup-binding` (fresh clone of llama.rn-kalsa, `b97c581d` and
`cc804436`, `governor_params_test` built four times and the full `run_tests.sh` harness
run at both commits). The deliverable worktrees and all three main checkouts were only
read. The clones and logs (`/tmp/followup-*`) can be deleted freely.
