# AUDIT — next main push (charging exemption + binding bump + plan-log fixes)

**Verdict: SHIP.**

No blocking defect found. The engine change is one scoped condition with the `plugged` value traced
end to end from Android to the policy, LOWBAT is untouched, the binding bump is byte-identical for the
two changed files, and both plan-log findings from the previous audit are fixed with tests that pin
them. The notes below are non-blocking.

## 1. Engine `b0d5dbd2c` (on `9875acabe`): charging exempts the 45% prefill floor

### 1.1 `plugged` is populated from the device — CONFIRMED, every hop

    native/GovernorBatteryModule.kt:60   val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    native/GovernorBatteryModule.kt:64   result.putBoolean("plugged", plugged)
    src/engine/governorInputs.ts:231     const plugged = input.plugged;
    src/engine/governorInputs.ts:233     if (typeof plugged !== "boolean" || typeof sensor !== "boolean") return null;
    src/engine/governorInputs.ts:249     plugged,
    src/engine/LlamaService.ts:1681-1686 function nativeGovernorThermo(snapshot) { const { thermo_source: _source, ...profile } = snapshot; return profile; }
    src/engine/LlamaService.ts:2374      thermo: nativeGovernorThermo(governorThermo),
    cpp/rn-governor-params.cpp:152       thermo = parse_governor_thermo(governor.at("thermo"));
    cpp/rn-governor-params.cpp:84        result.plugged = bool_or(thermo, "plugged", false);
    cpp/jsi/RNLlamaJSI.cpp:44            return rnllama::parse_governor_thermo(rnllama_jsi::toJson(runtime, value));   // setGovernorThermo
    src/llama-governor-runtime.cpp:182   const bool ok = policy_.update_thermal(profile, now_ms);
    src/llama-governor-policy.cpp:92     profile_ = profile;
    src/llama-governor-policy.cpp:162    (profile_.batt_level_pct < 45 && !profile_.plugged)) {

Both the load path (`governor.thermo` at init) and the mid-session path (`llamaSetGovernorThermo`,
`LlamaService.ts:1754` uses the same `nativeGovernorThermo`) carry the flag; the binding default is
`false` (the conservative floor), and the Android fallback when the sticky intent is missing also
sets `plugged=false` with `sensorValid=false` (`GovernorBatteryModule.kt:45-51`), so no spurious
exemption. `native/GovernorBatteryModule.kt` and `android/app/.../GovernorBatteryModule.kt` are
byte-identical (`cmp` clean). CONFIRMED.

### 1.2 LOWBAT still forces CPU — CONFIRMED

    src/llama-governor-policy.cpp:128   } else if (profile.batt_level_pct < 25) { state_ = ...LOWBAT; }
    src/llama-governor-policy.cpp:161   state_ == llama_governor_thermal_state::LOWBAT ||

The LOWBAT term is independent of `plugged` and precedes the floor, so <25% is CPU even on the
charger. The existing router tests cover LOWBAT entry/dwell/recovery (`test-governor-v02-router.cpp
:185-194`). No new test pairs plugged with <25%, but the term cannot be reached with the exemption
(the LOWBAT disjunct short-circuits first). CONFIRMED by read; the coverage gap is trivial.

### 1.3 Nothing else in the route changes — CONFIRMED

`git diff --stat 9875acabe b0d5dbd2c` = `llama-ext.h` 16, `llama-governor-policy.cpp` 3, the router
test 29. The policy diff is the one condition; the CRITICAL/Invalid/schema gates, the
`bench_force_gpu_prefill` branch, the V73/V75/V79 branch and the cool-mode branch are untouched
(`:165-182`). `llama-ext.h:404-417`'s rewritten `llama_governor_trim_sequence` comment matches the
code: the `if (failed) return false;` guard exists (`src/llama-governor.cpp:176`) and the
clear/reset-to-zero semantics match `trim_sequence` (`:172-199`). CONFIRMED.

### 1.4 Tests go red for the right reason — CONFIRMED

`tests/test-governor-v02-router.cpp:62-88` `test_prefill_battery_floor` (registered at `:382`):
plugged 30% → GPU (old code: CPU → red); unplugged 30% → CPU (a fix that drops the floor → red);
unplugged 45% → GPU (`<= 45` off-by-one → red). `poll()` (`:30-37`) sets `sensor_valid=true` and the
idle baseline, `batt_level_pct` is assigned per case. The rebuilt binary contains the new strings and
runs green here: `./build/bin/test-governor-v02-router` → **EXIT=0** (`router_v02_golden=PASS`,
`router_v02_metrics=PASS`). Host regressions checked: `test-governor-v0-turns -m stories15M` →
**EXIT=0**; `KALSA_HYBRID_GGUF=<2.6B> test-governor-v0-hybrid` → **EXIT=0**
(`governor_hybrid_rewind p=12 trim_ok=1 max_abs_diff=0.000e+00`); `test-governor-v0-commit` →
**EXIT=0**. CONFIRMED.

**Non-blocking notes.** (a) `EXTRA_PLUGGED != 0` means "plugged to a source", not "charging": a data
cable or a charger negotiating no current would still exempt the floor. Android offers no cleaner
signal in this module; the thermal state still gates CRITICAL. PLAUSIBLE-minor, worth a comment.
(b) The exemption also applies to a hot-plugged profile because `hot_plugged_` gates only the V73
cool-mode branch (`:179`), not the plain GPU branch (`:172-177`) — the state/temperature gates are
unchanged, so this is the intended trade.

## 2. Binding `e1b98a8c` (on `3b203c68`): vendor bump — CONFIRMED

    sha256(engine b0d5dbd2c:src/llama-ext.h)               == vendor/llama.cpp/src/llama-ext.h            EQUAL
    sha256(engine b0d5dbd2c:src/llama-governor-policy.cpp) == vendor/llama.cpp/src/llama-governor-policy.cpp EQUAL
    vendor/VERSIONS:9  LLAMA_CPP_COMMIT=b0d5dbd2c7d23830f9182e64f93f9c4286a8d9d2

`git diff --stat 3b203c68 e1b98a8c` = the two vendored files (16/3) plus the version/identity files
(`lib/*/version.*`, `src/version.ts`, `vendor/VERSIONS`, `build-info.cpp`, `ggml-version.h`,
`llama-version.h`) — nothing else. The prior audit's stale-d.ts finding is closed by the parent
commit: `node_modules/llama.rn/lib/typescript/types.d.ts` now contains `decode_repack` (grep count 1).
CONFIRMED.

## 3. App `70775bcd` (on `57eca607`): plan-log fixes, pins, provenance

### 3.1 Both plan-log findings fixed — CONFIRMED

    src/engine/LlamaService.ts:2400   if (governorBase != null && pricedModel != null && !governorRuntimeOff) {
    (the call now passes governorBase, not governorLoad)

NoFit is now logged: `governorBase` exists with `gpu_fit: "NoFit"` (the old `governorLoad != null`
gate was null exactly there), so a refused lane emits the plan with both prices; the disabled and
invalid-thermo cases (a computed plan, no governor load) also log, which is the requested "whenever a
plan is computed". The A1 runtime-fallback reload is suppressed by `!governorRuntimeOff`, so the
CPU-only reload no longer advertises a Fit plan. Tests: `governorPlanEmission.test.ts` pins the exact
guard expression, the `governorBase,` argument and the absence of `governorLoad` in the emission
slice (a source-shape guard, documented as such because Jest cannot load llama.rn);
`governorPlanLog.test.ts` adds the NoFit plan case. I ran both files → **EXIT=0, 3/3**; `tsc
--noEmit` → **EXIT=0**. Reverting the guard to `governorLoad != null` or dropping
`!governorRuntimeOff` fails the emission guard's regex/`not.toContain` — red for the right reason.
The guard is textual and would false-red if the following `if (governorBase != null &&
!governorBase.enabled)` line is renamed (the slice would run past the log), never false-green the
condition. CONFIRMED.

### 3.2 Pins and provenance — CONFIRMED

    package.json:49   "llama.rn": "github:Aspis0/kalsa.rn#e1b98a8cf7252f94fa0b4fe06afe11b6fbbb78d4"
    native/kalsallama.pin   b0d5dbd2c7d23830f9182e64f93f9c4286a8d9d2
    (== binding vendor/VERSIONS:9)

`bash scripts/assert-engine-provenance.sh` → **EXIT=0**: `lockfile pins
Aspis0/kalsa.rn@e1b98a8cf725`, `OK: 1119 files match`, `engine inside it: kalsallama@b0d5dbd2c7d2 ==
native/kalsallama.pin`. The engine commit is on the pushed branch `kalsa-opencl-upload-oom-throw`
(origin), the binding commit on `origin/kalsarn-governor-engine`. CONFIRMED.

## What I could not verify

- No device run: the charging exemption's field behaviour (a data-only cable, a charger that reports
  plugged but delivers no current) and the actual temperature/battery trajectory on the S23 are not
  measured; the 25%/45% boundaries are policy values.
- The engine's `update_thermal` plugged-baseline interaction with a mid-turn plug/unplug is read-only;
  the app's per-sample updates make it dynamic, but no device trace exists.
- The plan line's on-device emission (once per load, none per turn) is pinned by source shape plus
  the runtime structure (after the idempotent-skip early return), not observed in logcat here.
