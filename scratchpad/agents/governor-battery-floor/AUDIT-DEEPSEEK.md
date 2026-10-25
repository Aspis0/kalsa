# AUDIT — engine `c0dad89c` battery-floor removal

**Verdict: SHIP.** No bug found; the rule is implemented, the remaining gates behave, and the tests
pass on the host (router/turns/hybrid, below). The findings are notes, not blockers.

## The change — CONFIRMED

    llama-governor-policy.cpp:128   } else if (!profile.plugged && profile.batt_level_pct < 25) {
    llama-governor-policy.cpp:129       state_ = llama_governor_thermal_state::LOWBAT;
    llama-governor-policy.cpp:131       if (profile.plugged || dwell_elapsed(now_ms)) {
    llama-governor-policy.cpp:132           state_ = classify(temp);
    llama-governor-policy.cpp:159   if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
    llama-governor-policy.cpp:160       state_ == ...CRITICAL || state_ == ...Invalid ||
    llama-governor-policy.cpp:161       state_ == ...LOWBAT) { return llama_governor_engine::CPU;
    llama-governor-policy.cpp:247   const bool eligible = valid_schema(params_) && have_profile_ && profile_valid_ &&
    llama-governor-policy.cpp:248       state_ == ...COOLMODE && !hot_plugged_ && ...

Rule check: no `batt_level_pct` gate remains in `prefill_engine()`; the decode eligibility has no
battery predicate and LOWBAT cannot reach it (`eligible` requires `state_ == COOLMODE`,
`:248`). Unplugged <25 → LOWBAT → CPU (`:161`); plugged <25 → no LOWBAT → GPU; unplugged or plugged
25..100 → GPU when the other gates allow. CONFIRMED against the owner rule.

## Bugs / state machine

1. **LOWBAT entry/exit — CONFIRMED correct.** Entry `!plugged && <25` (`:128`); exit immediate when
plugged (`:131`), else after `k_dwell_ms = 10*60*1000` (`:8`, `dwell_elapsed` at `:83-85`).
CRITICAL/Invalid precede LOWBAT (`:122-127` for CRITICAL, `:93-99` makes an invalid profile
`state_ = Invalid`), and `prefill_engine()` returns CPU for both. `get_thresholds()` switches the
temperature bands on `profile_.plugged` (`:42-51`) — pre-existing, unchanged.
2. **Flapping on plug toggle — PLAUSIBLE (design, no hysteresis).** `plugged` clears LOWBAT
regardless of dwell (`:131`), and unplugging at <25 re-enters immediately (`:128`); a charger that
reports plugged/unplugged alternately toggles the prefill route with each sample. This is the literal
owner rule ("plugged in = GPU is never taken away"), and the app samples per completion
(`LlamaService.ts:1745-1757`), so the flap is policy, not a defect. Note only.
3. **One-sample GPU window at the CRITICAL→FAST transition — PLAUSIBLE (pre-existing).** The chain is
exclusive: a sample that leaves CRITICAL sets `FAST` (`:124-127`) and skips the LOWBAT test, so at
20% unplugged one sample can route GPU before the next sample re-enters LOWBAT. The old code had the
same ordering with the same `<25` branch; this commit does not introduce it and does not widen it.
4. **`plugged` is plug presence, not net charging — PLAUSIBLE (minor).**
`GovernorBatteryModule.kt:60 val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0`
is true for a data cable/dock with no charge current; the rule makes it load-bearing, so a docked 20%
phone is exempted from the floor. Matches the letter of the rule.
5. **Plugged baseline validity gate — PLAUSIBLE (pre-existing, unchanged).** `profile_is_valid`
requires `t_idle_valid && t_idle_c > 0 && t_idle_c + 1 < 42` when plugged (`:60-66`), so a plugged
profile with a missing/≥41 C idle baseline is `Invalid` → CPU (`:161`) — a temperature gate, not a
level one, and unchanged here. The Kotlin module populates it (`:67-70` puts `t_idle_valid =
sensorValid` and the current temperature), so the exemption can fire on device; no device run to
confirm.

## Removed behaviour (`select_decode` 45% gate) — CONFIRMED intended and covered

    old: const bool eligible = ... profile_.batt_level_pct >= 45 && state_ == COOLMODE && ...
    new (llama-governor-policy.cpp:247-251): no battery predicate.

Effect: V73 COOLMODE GPU decode is now allowed at 25..44% unplugged (below 25 the state is LOWBAT and
`:248` excludes it; plugged was already exempt via the parent commit). Tested by the changed router
assertion: `tests/test-governor-v02-router.cpp:127-133 low_battery.batt_level_pct = 40; ...
check(policy.select_decode(0).engine == GPU_COOLMODE, "battery above LOWBAT does not gate COOLMODE
decode")` — red if the predicate returns (40 < 45). `grep -n "45" src/llama-governor-policy.cpp
src/llama-governor-runtime.cpp` → empty; the only remaining readers of `batt_level_pct` are the
range check (`:57`) and the LOWBAT entry (`:128`). CONFIRMED.

## Cross-file tracer: `plugged` live on every turn — CONFIRMED

    GovernorBatteryModule.kt:60   val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    GovernorBatteryModule.kt:64   result.putBoolean("plugged", plugged)
    governorInputs.ts:231,233     const plugged = input.plugged; if (typeof plugged !== "boolean" || typeof sensor !== "boolean") return null;
    governorInputs.ts:249         plugged,
    LlamaService.ts:1681-1686     function nativeGovernorThermo(snapshot) { const { thermo_source: _source, ...profile } = snapshot; return profile; }
    LlamaService.ts:1745-1754     async function refreshGovernorBeforeCompletion(...) { const snapshot = await readGovernorThermo(); ... engine.setGovernorThermo(nativeGovernorThermo(snapshot)), ...
    rn-governor-params.cpp:84     result.plugged = bool_or(thermo, "plugged", false);
    llama-governor-policy.cpp:92  profile_ = profile;

`refreshGovernorBeforeCompletion` is called at every completion entry (`LlamaService.ts:1201, 4921,
5374, 5993, 6227`), so the flag is refreshed before each turn, not only at load; the load path
(`:2350/:2374`) carries the same fields. No battery-percent routing gate exists in the binding
(`rn-governor-params.cpp:83` parse, `:97-100` range validation only) or the app
(`governorInputs.ts:230/:248/:279` are plumbing plus the unavailable-profile default). CONFIRMED.

**Sensorless devices (QDC racks) — REFUTED as an issue.** The app refuses to load the governor
without a valid thermo (`LlamaService.ts:2367 governorThermo.sensor_valid &&`), and the binding's
`governor_thermo_profile_is_valid` also requires `sensor_valid` (`rn-governor-params.cpp:94`), so the
fallback `{batt_level_pct: 0, plugged: false, sensor_valid: false}` (`governorInputs.ts:277-283`)
yields no governor at all, CPU-only. When a 0% profile *is* pushed with `sensor_valid=true`, the old
code entered LOWBAT too (`<25` was already there); the 45% clause neither hid nor caused it.

## Test hygiene — CONFIRMED

`tests/test-governor-v02-router.cpp:62-94` `test_prefill_low_battery_routing` (registered `:389`):
plugged 20% → GPU (red if `!profile.plugged` is dropped or the floor returns); unplugged 30% → GPU
(red if the floor returns — the writer's sabotage 1); unplugged 20% → CPU (red if LOWBAT entry is
removed); `lowbat_policy.update_thermal(plugged_lowbat, 1)` at now=1, far below the 10-minute dwell,
then GPU (red if the `profile.plugged ||` exit is removed — sabotage 2). Every new assertion can go
red, and the 25% boundary stays pinned by the older recovery test
(`:191-201`, 20→LOWBAT, 25 +5 min → stays, +10 min → FAST). Tests mutate only local `poll()` profiles
(`:30-37`) and the shared `failures` counter; no env or global mutation. `test-governor-v0-turns.cpp`
moved `low.batt_level_pct` 40→20 (`:349`) with the comment updated (`:373`) — the profile keeps
`plugged` default false, so it exercises unplugged LOWBAT on the CPU target (`:375-378`). CONFIRMED.

## Runs (targeted, `-j 3` max — nothing rebuilt here)

| command (as run) | EXIT |
|---|---|
| `./build/bin/test-governor-v02-router > /tmp/x.log 2>&1` | **0** (`router_v02_golden=PASS`, `router_v02_metrics=PASS`) |
| `./build/bin/test-governor-v0-turns -m .../stories15M-q4_0.gguf > /tmp/x-turns-fix.log 2>&1` | **0** (`governor_low_battery_prefill=PASS engine=CPU`, `governor_v0_turns=PASS`) |
| `KALSA_HYBRID_GGUF=.../LFM2.5-2.6B-QAD-Q4_0.gguf ./build/bin/test-governor-v0-turns -m <2.6B> > /tmp/x-turns-hyb.log 2>&1` | **0** (`governor_v0_turns=PASS turns=3`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-hybrid > /tmp/x-hyb.log 2>&1` | **0**, not 77 (`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`) |

Binary staleness: `build/bin/test-governor-v02-router` (10:44) contains the new test strings and
`test-governor-v0-turns` (10:48) matches its source (10:48); `test-governor-v0-hybrid` (09:40) predates
the commit and links the pre-change policy — its green is not evidence for this change, but the hybrid
test sets no `plugged`/battery override (defaults 100%/unplugged), so the changed branches are not on
its path. PLAUSIBLE (staleness), harmless here.

## Dead code and clean-code checklist

No dead code: `batt_level_pct` is still read by `profile_is_valid` (`:57`) and the LOWBAT entry
(`:128`); `LOWBAT` still has two consumers (`:161`, and `select_decode` indirectly); `hot_plugged_`
still gates the COOLMODE branch (`:178`, `:248`) and the runtime warning. The diff is 3 files
(policy, two test files), no new file, no imports, no secrets; comments updated where the semantics
changed (`turns:373`), the `llama-ext.h` thermo comment (`:266-278`) carries no stale 45% text
(`grep -n 45 src/llama-ext.h` → empty); the commit message names repo, branch and base HEAD, and the
worktree is clean. One nit: the one-line title "remove battery floor" understates that the LOWBAT
entry/exit semantics changed (`!plugged` + immediate plug-exit) and the decode gate was dropped; the
report documents them. CONFIRMED otherwise.

## Delivery — PLAUSIBLE (process, not code)

`git branch -r --contains c0dad89c` → nothing: the commit is local-only. The binding
(`vendor/VERSIONS:9 LLAMA_CPP_COMMIT=b0d5dbd2c…`) and the app (`native/kalsallama.pin
b0d5dbd2c…`) still pin the parent, so neither consumes this change yet; pushing + the two bumps are
required before it is shippable.

## What I could not verify

- No device run: that the S23's plug state reaches the engine per turn (code path verified), the
  flapping behaviour of a real charger, and the COOLMODE decode at 25-44% unplugged.
- The hybrid binary's build-vs-commit staleness (not rebuilt here; `-j 3` only, per the order).
- The writer's sabotage exit codes and the full suite (`ctest -L router`) were not re-run; only the
  four targeted binaries above.

---

# Re-check — mimo F1 fix (`8eac584bb`)

**Verdict: SHIP.** F1 was real, the fix is correct and complete, and no other path reaches a
non-LOWBAT state at <25% unplugged.

**Why I missed F1 (one line):** I audited the removed floor and the LOWBAT entry/exit predicates but
treated the CRITICAL branch as a steady state ("CRITICAL already returns CPU via
`prefill_engine:160`, pre-existing") without tracing the transition *out* of CRITICAL, where the
`else if` chain skips the LOWBAT entry — and before `c0dad89c` the independent `batt < 45 && !plugged`
check covered exactly that window, so removing it did widen the hole; my "does not widen it" note
was wrong.

## The fix — CONFIRMED

    llama-governor-policy.cpp:126   state_ = !profile.plugged && profile.batt_level_pct < 25
    llama-governor-policy.cpp:127       ? llama_governor_thermal_state::LOWBAT
    llama-governor-policy.cpp:128       : llama_governor_thermal_state::FAST;
    llama-governor-policy.cpp:130   } else if (!profile.plugged && profile.batt_level_pct < 25) {
    llama-governor-policy.cpp:162       state_ == ...CRITICAL || state_ == ...Invalid ||
    llama-governor-policy.cpp:163       state_ == ...LOWBAT) {
    llama-governor-policy.cpp:164       return llama_governor_engine::CPU;

Every `state_ =` assignment in the class lives in `update_thermal`
(`grep -n "state_ =" src/llama-governor-policy.cpp`): `:96/:107 Invalid`, `:123 CRITICAL`,
`:126` (the fix), `:131 LOWBAT`, and the classify/thermal transitions at
`:134/:137/:140/:145/:147/:150`. All the latter sit behind the entry test at `:130`, so at
`!plugged && <25` they are unreachable; a fresh policy starts `Unknown`
(`llama-governor-policy.h:62`) and the first sample at <25 unplugged hits `:131`. The only
non-LOWBAT states reachable in that condition are CRITICAL and Invalid, both mapped to CPU by
`:162-164` (`select_decode` excludes LOWBAT from GPU by requiring `state_ == COOLMODE` at `:250`).
`grep -rn batt_level_pct src/` → only
`:57` (range validation), `:126`, `:130` — no other engine, binding or app gate exists, so there is
no second independent guard to rely on and none needed. CONFIRMED: no GPU prefill and no GPU decode
at <25% unplugged.

## The new tests — CONFIRMED red-for-the-right-reason (read)

`test-governor-v02-router.cpp` new cases: `:135-142` (`lowbat_decode` 39.5 °C/20% asserts
`select_decode` CPU and not wait) and `:166-196` (`critical_unplugged` 43.0 °C/20% → CRITICAL; then
`recovered_unplugged` 34.0 °C (inclusive `critical_exit`) at +10 min → without the fix this is FAST
and with `fitted_gpu` (V75/Fit/measured) `prefill_engine()` returns GPU → both the LOWBAT-state and
the CPU-prefill checks fail. `critical_plugged`/`recovered_plugged` 35.9 °C ≤ 36.0 plugged exit at
20% → FAST/GPU (red if the ternary drops the `plugged` term). Each case builds a fresh `policy`;
only the shared `failures` counter is mutated — hygiene clean.

## Runs (rebuilt/verified, `-j 3` max)

| command | EXIT |
|---|---|
| `cmake --build build --target test-governor-v02-router test-governor-v0-turns test-governor-v0-hybrid -j 3 > /tmp/x-build.log 2>&1` | **0** ("no work to do", binaries 11:13; `strings` shows the three new test strings) |
| `./build/bin/test-governor-v02-router > /tmp/x.log 2>&1` | **0** (`router_v02_golden=PASS`, `router_v02_metrics=PASS`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-turns -m <2.6B> > /tmp/x-turns.log 2>&1` | **0** (`governor_low_battery_prefill=PASS`, `governor_v0_turns=PASS turns=3`) |
| `KALSA_HYBRID_GGUF=<2.6B> ./build/bin/test-governor-v0-hybrid > /tmp/x-hyb.log 2>&1` | **0**, not 77 (`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`) |

## Binding sync `463f11f9` — CONFIRMED

`vendor/llama.cpp/src/llama-governor-policy.cpp` sha256 ==
`engine 8eac584bb:src/llama-governor-policy.cpp` (`1262e37b9267d204753418005e88224a7f10a834908636e7232759360785645c`);
`vendor/VERSIONS:9 LLAMA_CPP_COMMIT=8eac584bb…`; delta 9 files = the policy plus version/identity
files (the tests are not in the export). CONFIRMED.

## Remaining notes (non-blocking)

- **Duplicated invariant — PLAUSIBLE (clean code).** `!plugged && batt < 25` now appears twice
  (`:126`, `:130`); a small predicate helper would keep one definition. The two copies agree today.
- **Cable flap at <25 — PLAUSIBLE (design, from the first audit).** No debounce: plug → FAST
  (`:128` via `:130-134`), unplug → LOWBAT (`:131`); the plugged `t_idle` baseline is re-latched each
  cycle (`:112-114`), so the 1.5 °C drift-Invalid guard never fires across toggles. Unchanged by
  this fix, still no test beyond one transition.
- **Plugged-validity gate — PLAUSIBLE (pre-existing).** `profile_is_valid:60-66` can still return
  Invalid (→ CPU via `:162`) for a plugged profile with a missing or ≥41 °C idle baseline; that is a
  temperature/validity gate, not a battery-level gate, and is untouched here.
- **Delivery — PLAUSIBLE (process).** `git branch -r --contains 8eac584bb` and
  `… --contains 463f11f9` are both empty; the app still pins
  `native/kalsallama.pin = b0d5dbd2c` and `package.json llama.rn#e1b98a8c`. Push + the two bumps are
  still required before any device carries the fix.

## What I could not verify (re-check)

- No device run; the CRITICAL-exit-at-<25 scenario is host-only, and the app's per-round thermo
  refresh (`LlamaService.ts:1745-1757`) is the assumed cadence for the one-round exposure window.
- The writer's sabotage exit codes; only the three targeted binaries above were run.
- The hybrid test's own policy profile is the default 100%/unplugged, so its green is a
  no-regression check, not evidence for the LOWBAT paths.
