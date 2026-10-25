# AUDIT — engine commit c0dad89c (battery floor removal)

Auditor: MIMO. Read-only; no builds, no tests run (per instruction — another auditor owns the build).
Subject: `c0dad89c06f9745b72a421cc76fee26da8717c9e`, repo `kalsallama` @ `/Users/marco/Projects/kalsallama-wt-oom`,
branch `kalsa-opencl-upload-oom-throw`, parent `b0d5dbd2c7d23830f9182e64f93f9c4286a8d9d2` (verified:
`git log --format='%H %P' -1 c0dad89c` exit 0, `%P` = b0d5dbd2c7d...). Diff: 3 files, numstat
`4 5 src/llama-governor-policy.cpp`, `2 2 tests/test-governor-v0-turns.cpp`, `21 14 tests/test-governor-v02-router.cpp`.

Owner rule under audit: battery level never takes GPU away except LOWBAT (<25%) while UNPLUGGED;
plugged in → GPU never taken away.

---

## Angle 1 — `update_thermal` state machine

Chain as read (`src/llama-governor-policy.cpp:122-151`):
`122: if (temp >= k_kill_c || temp >= limits.critical_enter)` → CRITICAL;
`124: } else if (state_ == ...::CRITICAL) { if (can_leave(...)) { state_ = ...::FAST; } }` (125-127);
`128: } else if (!profile.plugged && profile.batt_level_pct < 25) { state_ = ...::LOWBAT; }` (129);
`130: } else if (state_ == ...::LOWBAT) { if (profile.plugged || dwell_elapsed(now_ms)) { state_ = classify(temp); } }` (131-133);
`134: } else if (state_ == Unknown || Invalid) { state_ = classify(temp); }`.

**F1 — CRITICAL recovery bypasses LOWBAT for a full update window. CONFIRMED (blocker).**
When branch 124-127 fires (`state_ = FAST` at 126), the battery test at 128 is an `else if` and is
skipped for that call. State FAST + `batt_level_pct = 20` + unplugged → `prefill_engine()`
(`policy.cpp:158-163`, gate at `161: state_ == ...::LOWBAT`) falls through to GPU
(`169-171` V73/V75/V79 + Fit + measured). The app refreshes thermo once per completion round
(`LlamaService.ts:4921`, inside `for (let round = 0; ...)` at `4866`), so the whole next
prefill+generation round runs GPU at <25% unplugged; only the *following* round's update re-enters
LOWBAT. Reachable whenever a device exits CRITICAL (unplugged: ≤34.0 °C after 10 min dwell,
`policy.cpp:125` + `k_dwell_ms`/`critical_exit`) with battery already <25% — hot phone + dead
battery is a normal combo. **Old code did not have this hole**: the removed floor
`profile_.batt_level_pct >= 45` in prefill was an independent percent check immune to state lag;
the commit replaced it with a purely state-dependent check whose state machine can lag one update
behind. No test covers CRITICAL-exit-at-low-battery (router test asserts entry only:
`tests/test-governor-v02-router.cpp:153-157`, `"KILL backstop precedes LOWBAT"`).

**F2 — LOWBAT entry/exit predicates themselves: CONFIRMED correct.**
Entry `!plugged && batt<25` (128) and exit `plugged || dwell` (131) are mutually exclusive and
exhaustive across the plugged dimension: plugged-any-battery → exit branch runs (contract: plugged
never loses GPU; batt<25 plugged is exitable because entry requires `!plugged`); unplugged+batt≥25
→ exit needs dwell (hysteresis, tested `test-governor-v02-router.cpp:197-201`); unplugged+batt<25 →
branch 130 unreachable, stays LOWBAT. Entry precedes `Unknown/Invalid` (134) so recovery from
Invalid at batt<25 lands LOWBAT directly, not `classify`. Entry does NOT reset `state_since_ms_`
when already LOWBAT (`152: if (state_ != old_state)`), so dwell measures from first entry.

**F3 — cable flap: PLAUSIBLE (no debounce, no test).**
Toggle every turn, batt<25: unplugged→LOWBAT (129, `state_since_ms_` reset via 152-153) →
plugged→`classify(temp)` (131-133) → unplugged→LOWBAT … state and `prefill_engine()` flip
CPU↔GPU every round, and dwell never accumulates across the flap. Decode churn is bounded by the
1-hour flip budget (`policy.cpp:245-246` `budget_ok` gates `eligible` at 247-251), prefill churn is
a context switch (both models resident), so impact = churn + telemetry flapping, not reload thrash.
A flap also re-latches the plugged t_idle baseline every cycle
(`policy.cpp:112-114` `// An unplug ends the plugged baseline; the next plug latches a fresh one.`),
so the 1.5 °C drift-Invalid guard (104-107) never fires across toggles — that reset is pre-existing
by the comment, the flap cadence is new. No test toggles `plugged` more than once
(`test-governor-v02-router.cpp:91` single transition).

**F4 — precedence vs CRITICAL/Invalid/COOLMODE: CONFIRMED OK except F1.**
Branch 1 (122) outranks LOWBAT — thermal safety first, intended. Invalid is decided before the
chain (`93: if (!profile_is_valid(profile))` → `96: state_ = ...::Invalid`) so a dead sensor wins
over LOWBAT. COOLMODE/WARM/FAST branches (136-150) all sit *after* LOWBAT, so no thermal state can
shadow a <25% battery. Only CRITICAL-exit (F1) escapes the battery test.

**F5 — `classify(temp)` right after leaving LOWBAT: CONFIRMED bounded.**
`classify` (`policy.cpp:69-75`) can return CRITICAL/COOLMODE/WARM/FAST. In branch 132 CRITICAL is
unreachable: classify's CRITICAL predicate (`71: temperature >= k_kill_c || temperature >= limits.critical_enter`)
is byte-identical in effect to branch 122, which already ran and failed this call, against the same
`limits` (120) and same `profile_` (assigned at 92). So a LOWBAT exit lands in exactly
{FAST, WARM, COOLMODE}, classified with the *current* thresholds — on plug-exit that is the plugged
form (`43-51`) off a just-latched baseline, which can jump straight to COOLMODE/WARM the moment the
cable goes in. Contract-conformant (plugged keeps GPU), untested beyond the one
`update_thermal(plugged_lowbat, 1)` → GPU prefill case (`test-governor-v02-router.cpp:91-93`).

## Angle 2 — removed `batt_level_pct >= 45` from `select_decode`

Diff: `- ... profile_valid_ && profile_.batt_level_pct >= 45 &&` / `+ ... profile_valid_ &&`
(`policy.cpp:247-251`).

- **25–44% unplugged in COOLMODE now gets GPU_COOLMODE decode. CONFIRMED, intended, tested.**
  Only test: `test-governor-v02-router.cpp:128-133` `low_battery.batt_level_pct = 40;` …
  `check(policy.select_decode(0).engine == ...GPU_COOLMODE, "battery above LOWBAT does not gate COOLMODE decode")`.
  Red-capable: under parent code the 45-gate made this CPU → FAIL. Pins exactly the removed gate.
- **<25% unplugged decode: runs on CPU, but only *incidentally*, and is NOT directly tested. CONFIRMED
  gap.** `select_decode`'s wait-list omits LOWBAT (`policy.cpp:236-241` early-returns only
  Unknown/Invalid/CRITICAL); LOWBAT decode falls out of `248: state_ == ...::COOLMODE` being false →
  `252-254` returns CPU, `wait=false` (correct outcome: decode proceeds on CPU). Nothing asserts
  engine_decode under LOWBAT: the batt-40 test stops at the 25–45 band, and
  `test-governor-v0-turns.cpp` `run_low_battery_prefill` asserts prefill only
  (`:374-378` `stats.prefill_engine == ...::CPU && stats.commit_bytes == 0 ...`) — its single decode
  token (`:381-390`) never checks decode engine/reload. A future change to the COOLMODE predicate
  that lets LOWBAT through has no red test on the decode side.
- Plugged, batt<25, COOLMODE → GPU decode: contract-conformant, untested.

## Angle 3 — cross-file tracer (plugged / batt_level_pct)

Chain, every hop quoted:

1. Kotlin source: `kalsa-wt-bench-apk/android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt:41 fun readThermo`,
   `:58-59` EXTRA_SCALE → `percent`, `:60` EXTRA_PLUGGED → `plugged`,
   `:61 val sensorValid = present && temperature > 0`, `:63-64` put battLevelPct/plugged.
2. TS parse: `kalsa-wt-bench-apk/src/engine/governorInputs.ts:230` default `100` when field missing,
   `:233` non-boolean plugged/sensor → null, `:248-249` forwards, `:277-283` fallback
   `batt_level_pct: 0 / plugged: false / sensor_valid: false` when module/parse unavailable.
3. App push: load once at `LlamaService.ts:2349-2350` (`governorThermo.sensor_valid &&` gate at `2367`),
   **and every completion round**: `LlamaService.ts:4866` round loop → `:4921`
   `refreshGovernorBeforeCompletion` → `:1754 engine.setGovernorThermo(...)`; also fallback round
   `:5374`, plus `:1201, :5993, :6227, :6348`.
4. Binding TS: `llama.rn-kalsa/src/index.ts:722 setGovernorThermo(profile)`.
5. JSI: `llama.rn-kalsa/cpp/jsi/RNLlamaJSI.cpp:831 llamaSetGovernorThermo` → `:847 if (!ctx->setThermoProfile(profile))`.
6. `llama.rn-kalsa/cpp/rn-llama.cpp:702-703` → `cpp/rn-governor.cpp:80-88 profile_valid_ = llama_governor_set_thermo_profile(...)`.
7. Engine: `kalsallama src/llama-governor-runtime.cpp:178-182 policy_.update_thermal(profile, now_ms)` → `policy_` in
   `src/llama-governor-policy.h:57 llama_governor_thermo_profile profile_;`.

**Refresh: every round, not just load. CONFIRMED.** Caveat (pre-existing, same class as the old
floor): no per-token refresh — battery can cross 25% *mid-round* and GPU decode continues until the
next round's update; the removed floor had the identical staleness, so not a regression.

**Other battery-percent gates in the three repos: none left. CONFIRMED.** Greps (all exit 0 unless
noted): engine `rg 'batt_level_pct|plugged' src tests include` → only `policy.cpp:57` range check
(`< 0 || > 100`), `policy.cpp:128` LOWBAT <25, tests; `rg '>= *45|< *45|floor' src tests` → no battery
hits (only unrelated `test-floor` ggml and `cache_floor_mb`). Binding `rg 'batt_level_pct *<|>= *45' cpp android src`
→ only `cpp/rn-governor-params.cpp:97` range check; `rg 'batt|LOWBAT' android` (binding) → no matches
(exit 1). App `rg 'batt_level|battery floor|< *45|>= *45' src android` → forwarding + tests only;
`thermalThresholds.ts:8 (45 / 48 / 52 °C)` and `:45 warmC: 45` are °C banners; `batteryEta.test.ts:41`
is charge-rate estimation. Kotlin has no percent gate (reads and forwards only).

## Angle 4 — default `batt_level_pct: 0, plugged: false, sensor_valid: false`

**REFUTED (as a new bug).** It never reaches the LOWBAT branch: `policy.cpp:54 if (!profile.sensor_valid || !std::isfinite(profile.trend_c_per_min)) return false;` → `:96 state_ = ...::Invalid; return false;`
→ `prefill_engine` CPU via `:160 state_ == ...::Invalid`. The battery test at 128 is downstream of
validity and never runs. This diff does not touch `profile_is_valid`, so **old code behaved
identically** for the sensor-less default (parent's LOWBAT entry also only mattered for valid
profiles). Additionally the app refuses to *enable* the governor without a sensor at load
(`LlamaService.ts:2367 governorThermo.sensor_valid &&`). Pre-existing consequences (accelerator
admission closed, `runtime.cpp:184` warn; decode wait → `-2` at `runtime.cpp:121-127`) are unchanged
by this commit.
Adjacent pre-existing trap (not this commit): `GovernorBatteryModule.kt:58-59` — `EXTRA_SCALE == 0`
yields `percent = 0` while `sensorValid` can still be true; unplugged that is LOWBAT → CPU forever.
Old code routed the same value to CPU too (`<25` entry then `<45` floor), so behavior-neutral.

## Angle 5 — test hygiene

Per-assertion red analysis (reasoned, not executed — builds prohibited):

| assertion | red when… | verdict |
|---|---|---|
| `router:72-73` "plugged 20 percent … GPU prefill" | entry loses `!plugged`, or whole-commit revert (old entry `batt<25` ignores plugged → CPU) | CONFIRMED red-capable |
| `router:79-80` "unplugged 30 percent … GPU prefill" | 45-floor restored (old: CPU) | CONFIRMED red-capable |
| `router:86-87` "unplugged 20 percent … LOWBAT … CPU" | LOWBAT entry removed entirely | PLAUSIBLE red-capable, but **passes under the fully reverted parent code** — pins retained behavior, not the delta (delta is pinned by the two plugged cases) |
| `router:91` "plugging in clears LOWBAT immediately" | exit reverted to `dwell_elapsed` only (now_ms=1 < 10 min → stays LOWBAT → CPU) or old code (entry re-fires on plugged batt<25) | CONFIRMED red-capable |
| `router:93` "…GPU … after LOWBAT" | same | CONFIRMED red-capable |
| `router:130-131` "battery above LOWBAT does not gate COOLMODE decode" (batt 40) | 45-gate restored | CONFIRMED red-capable |
| `router:197-201` dwell/recovery pair | dwell arithmetic broken (inclusive 10-min boundary at `k_dwell_ms`) | CONFIRMED red-capable (unchanged by this commit) |
| `v0-turns:349` `low.batt_level_pct = 20` + `:374-378` prefill==CPU | batt raised to 40 today → state FAST → V75 Fit measured GPU prefill → mismatch → `run()` false → exit 1 (`:717-719`) | CONFIRMED red-capable |

Env save/restore: **N/A — neither test touches env.** `rg 'getenv|setenv|KALSA_' tests/test-governor-v0-turns.cpp tests/test-governor-v02-router.cpp` → no matches (empty stdout). Model path comes from `-m` via
`common_params_parse` (`test-governor-v0-turns.cpp:876-878`); router test needs no model. Nothing to save.
`check()` accumulates and `main` returns 1 on any failure (router `main`, end of file); v0-turns fails
fast per subtest. Comment `test-governor-v0-turns.cpp:373-374` states a true invariant for its setup
(batt 20, `plugged` false by value-init, `sensor_valid = true` at `:350`).

Could NOT verify: REPORT.md's Verification section (build/ctest/sabotage exit codes) — builds were
forbidden this session. REPORT's file:line citations spot-checked (policy 128-132/57/159-162/247-251,
llama-ext.h 230/272-274, router 69-93/128-133/192-201, v0-turns 349/373-378, rn-governor-params
81-88/97-100, governorInputs 226-233/246-250/277-282, RNLlamaJSI:64, binding android find, app
45°-threshold claims) — all matched my reads. No pushes of this commit: `git for-each-ref refs/remotes | grep -i 'c0dad89|upload-oom'` → exit 1 (no match; network push state not provable offline).
No tag (`git tag --contains c0dad89c` empty), on existing branch only (`git branch --contains` →
`kalsa-opencl-upload-oom-throw`), tree clean (`git status --porcelain | wc -l` → 0). Commit message
names repo, branch and Base HEAD b0d5dbd2c7d… = actual parent (same pattern as parent commit
`b0d5dbd2c … @ 9875acabe: …`).

## Checklist (writer's contract)

- No new files; no new imports; no globs; no types/APIs added. `llama-governor-policy.cpp` = 275 lines,
  one responsibility ("governor policy decisions") — passes.
- Test files: `test-governor-v02-router.cpp` 402 lines (was 395), organized as 8 named per-topic test
  functions — not an indistinguishable list, but both it and `test-governor-v0-turns.cpp` (884) exceed
  the ~350 indicative line count and **REPORT.md does not declare that pre-existing excess**. Observation,
  not introduced here.
- Comments: only the rewritten one at `v0-turns.cpp:373-374`; invariant true. No secret values.
- Report honesty: REPORT.md claims match the diff everywhere I checked; its run results unverifiable here.

## Dead code (last)

None found. The deleted `unplugged_floor` block left no orphans; `batt_level_pct` still consumed by
range validation + LOWBAT; no leftover `45` constant/comment in any of the three repos; binding/app
untouched by this commit.

---

## Verdict: **NO**

Reason: F1 — the commit replaced an independent battery-percent gate in `prefill_engine` with a purely
state-dependent one, and the state machine skips the battery test on the CRITICAL-recovery turn
(`policy.cpp:124-127` before `:128`), granting a full GPU prefill+generation round at <25% unplugged.
That is a real regression against the owner's rule, untested, on a reachable path (hot device draining
below 25%). To flip to SHIP: (a) make CRITICAL recovery fall through to the battery test (or re-check
`!plugged && batt<25` after the chain) so LOWBAT engages on the same update; (b) add a red test for
CRITICAL-exit-at-batt<25 prefill, and pin decode-under-LOWBAT (`select_decode` CPU, `wait=false`) —
currently guaranteed only by the COOLMODE predicate at `policy.cpp:248`. F3 (flap) should at minimum be
acknowledged in REPORT.md as untested churn.

---

# Re-check (after F1 fix)

Auditor: MIMO. Read-only, no builds (build/sabotage claims in REPORT.md unverified by me).
Subjects: engine `8eac584bb3411840b3639a06f96ca75301f4f8d6` (parent `c0dad89c06f9745b72a421cc76fee26da8717c9e`,
`git log --format='%H %P' -1` exit 0; numstat `3 1 src/llama-governor-policy.cpp`, `39 0 tests/test-governor-v02-router.cpp`, 2 files only);
binding `463f11f9f47ff0b235267e3bb29136ad8cbbbb13` (parent `de7cdc45…` confirmed; 9 files, 17 ins / 15 del by numstat).

## (1) F1 closed — CONFIRMED

Fix at `src/llama-governor-policy.cpp:126-128`:
`state_ = !profile.plugged && profile.batt_level_pct < 25 ? ...::LOWBAT : ...::FAST;` inside the CRITICAL-exit branch (124-129).

Exhaustive path sweep for any post-call state ∉ {CRITICAL, Invalid, LOWBAT, Unknown} at `!plugged && batt<25`:
- Chain order (`:122-153`): branch `130: } else if (!profile.plugged && profile.batt_level_pct < 25)` precedes **every** GPU-capable transition — `134` classify (LOWBAT exit), `137` classify (Unknown/Invalid), `140` FAST (COOLMODE exit), `145/147` WARM→COOLMODE/FAST, `150-152` FAST→COOLMODE/WARM. On any call with unplugged batt<25 the chain stops at 122/124/130, so branches 132-153 are unreachable in that condition. **CONFIRMED.**
- `classify()` has exactly two call sites, `:134` and `:137` (grep: only 134/137 besides the definition at `:69`); both require `NOT(:130)` ⇒ plugged || batt≥25. classify cannot run at <25% unplugged. **CONFIRMED.**
- Early returns above `:116`: `93-99` (`!profile_is_valid` → `96: state_ = ...::Invalid`) and `105-109` (plugged-baseline drift → `107: state_ = ...::Invalid`). Both → Invalid → prefill CPU (`:161-164`) and decode wait (`:242-245`). No path to FAST/COOLMODE. **CONFIRMED.**
- First profile after load: before any update `!have_profile_` → CPU (`:161`) and state Unknown → decode wait (`:242-243`); first valid update with batt<25 unplugged hits `:130` → LOWBAT; first invalid → Invalid. **CONFIRMED.**
- CRITICAL entry (`:122-123`) and CRITICAL hold (`can_leave` false) both stay CPU. Plugged CRITICAL exit at batt<25 → FAST is contract-correct (plugged keeps GPU). **CONFIRMED.**
- Residual hole class = stale `profile_` between updates (battery crosses 25 mid-round → old state persists): **PRE-EXISTING, non-blocking** — the removed floor/`>=45` gate read the identical `profile_`; app refreshes per round (`kalsa-wt-bench-apk/src/engine/LlamaService.ts:4921` inside loop `:4866`).
- Nit (non-blocking): the predicate `!plugged && batt < 25` is now hardcoded twice (`:126` and `:130`); no `k_lowbat` constant — drift risk if the threshold ever moves.

## (2) New assertions can go red — CONFIRMED (reasoned from code)

- `tests/test-governor-v02-router.cpp:176-182` unplugged recovery (poll 430→340, batt 20, t 0→600000):
  entry: 43 ≥ `k_kill_c` → CRITICAL (`:122`); recovery: 34 ≤ `critical_exit` 34 (inclusive, unplugged tuple `{38,36,39.5,36.5,42,34}` at `:45`) && dwell `600000 ≥ k_dwell_ms` → new ternary → LOWBAT; prefill gate `:163` → CPU.
  Red: revert to unconditional `= FAST` (`:128`) → `:180` FAIL (state FAST ≠ LOWBAT) **and** `:182` FAIL (V75 + Fit + measured → GPU, `:173-177`). **CONFIRMED red.**
- `:185-195` plugged recovery (poll 420/35→359/35, batt 20):
  entry: plugged thresholds `min(35+7,42)=42`, 42 ≥ 42 → CRITICAL; recovery 35.9 ≤ `min(35+1,42)=36` && dwell → ternary: plugged → FAST; prefill → GPU.
  Red: drop `!profile.plugged` from `:126` → LOWBAT → `:193` FAIL **and** `:195` FAIL (CPU ≠ GPU). **CONFIRMED red.**
- `:135-141` decode under LOWBAT (poll 395, batt 20, fresh V73/MoE/Fit policy):
  39.5 < 42/43 → not CRITICAL; `:130` → LOWBAT; `select_decode` early-return (`:242-243`) excludes LOWBAT; eligibility `:250` `state_ == COOLMODE` false → `:254-256` returns default `{engine=CPU, wait=false}` ⇒ `CPU && !wait`.
  Red: add LOWBAT to the wait list → `wait=true` FAIL; admit LOWBAT into eligibility `:250` → every other conjunct holds (V73 `:251`, Fit `:252`, `cool_delta`/`kexp` set, `cool_pays` Unknown `:253`, `reload_budget_available` default `true` at `src/llama-ext.h:259`, `budget_ok` from `-1`, `!hot_plugged_` unplugged) → GPU_COOLMODE ≠ CPU FAIL; remove `:130` → state Unknown→classify(39.5)→COOLMODE → GPU_COOLMODE FAIL. **CONFIRMED red** for the plausible mutations.
- Guard assertions `:174, :178, :187, :191` are preconditions (validity), weak but appropriate. New blocks sit in the correct topic functions (`test_decode_gates`, `test_thermal_state`); no cross-test state leak (each block reassigns `policy = llama_governor_policy(...)`).
- `check()` accumulation → `main` returns 1: unchanged. Env: still none touched. **CONFIRMED.**

## (3) My prior findings — status

- **F1: CLOSED** (above).
- **F2 (decode-under-LOWBAT untested): CLOSED** by `:135-141`.
- **F3 (cable flap churn untested): OPEN, non-blocking.** `rg -i 'flap|toggle|churn' REPORT.md` → no matches (exit 1); the "Fix round F1" section (`REPORT.md:51-56`) does not acknowledge it. Behavior remains contract-conformant; churn bounded by the 1 h flip budget (`policy.cpp:247-248`). Was and stays a documentation/coverage gap, not a code defect.
- **Mid-round staleness: OPEN, pre-existing, non-blocking** (identical class under the old floor; refresh `LlamaService.ts:4921`).
- **Angle-4 sensor-less default: closed as REFUTED** (unchanged; `policy.cpp:93-99` → Invalid, `LlamaService.ts:2367`).
- REPORT's run/sabotage exit codes and `test-governor-v0-hybrid` run: **still unverified by me** (no builds allowed).
- Test-file size: router now **441 lines** (was 395 pre-c0dad89c), above the ~350 indicative; pre-existing file, additions topic-placed; still undeclared as pre-existing excess. Non-blocking.

## (4) Binding `463f11f9` — CONFIRMED clean

- `git show --numstat 463f11f9` exit 0: 9 files = vendored engine diff `vendor/llama.cpp/src/llama-governor-policy.cpp` (3 ins/1 del, hunk byte-for-byte the engine's `:126-128` ternary) + version/commit stamps only: `lib/commonjs/version.js`, `lib/module/version.js`, `lib/typescript/version.d.ts`, `src/version.ts`, `vendor/VERSIONS`, `vendor/llama.cpp/common/build-info.cpp`, `vendor/llama.cpp/ggml/src/ggml-version.h`, `vendor/llama.cpp/src/llama-version.h` (all `c0dad89` → `8eac584`, build 11220→11221). No other files touched. Sums 17/15 match REPORT. **CONFIRMED.**
- `vendor/VERSIONS`: `LLAMA_CPP_REF=8eac584bb3411840b3639a06f96ca75301f4f8d6` and `LLAMA_CPP_COMMIT=` same — pin matches engine HEAD. Commit body names `Engine: 8eac584bb…`, Repo, Branch, Base HEAD `de7cdc45…` = actual `%P`. **CONFIRMED.**
- Identity: `cmp engine/src/llama-governor-policy.cpp vendor/…/llama-governor-policy.cpp` **exit 0**; both SHA-256 `1262e37b9267d204753418005e88224a7f10a834908636e7232759360785645c` — matches REPORT's claim exactly. **CONFIRMED.**
- Hygiene: binding tag --contains → empty; branch --contains → `kalsarn-governor-engine` only; no remote ref at 463f11f9 (grep exit 1) → no push evidence. Engine: no tag, branch-only, no remote ref at 8eac584bb (grep exit 1), both worktrees tracked-clean (`git status --porcelain | wc -l` → 0; binding's only dirt = 2 untracked `pnpm-*.yaml`, disclosed in REPORT). Commit messages name repo/branch/base-HEAD, matching the parent-commit pattern. **CONFIRMED.**
- Chain note (out of scope here): app `package.json` pin + `scripts/assert-engine-provenance.sh` not yet part of these two commits.

## Re-check verdict: **SHIP**

F1 is closed on every path I could construct by code reading; each new assertion is red-capable against the plausible mutations (reasoned, not executed); the binding commit touches only the vendored policy file and version stamps, byte-identical to the engine source. Open non-blocking items: F3 flap untested and unmentioned in REPORT, mid-round staleness (pre-existing), `25` hardcoded twice in policy.cpp, router test file at 441 lines undeclared, and all REPORT run/exit-code claims unverified by this auditor (builds forbidden this session).
