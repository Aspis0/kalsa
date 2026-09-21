# Governor and GPU path re-reconnaissance (current trees)

Read-only. No file outside this report was written. No sub-agents. English only.

**Trees read, with the revision I read them at**

| label | path | revision |
|---|---|---|
| ENGINE | `~/Projects/kalsallama` | branch `b11010-merge`, HEAD `8537d097c32e7307d82540b6da8eb448d7e07107`; `origin/b11010-merge` is `2a290390d67311b580ef398fd545e6d060b39897` and `8537d097c` is its ancestor |
| BINDING | `~/Projects/llama.rn-kalsa` | branch `vendor-migration`, HEAD `0f313bab464ef28a58a8b4b2a37a5d4c1968b54e` |
| BINDING (installed) | `~/Projects/kalsa/node_modules/llama.rn` | git dep at `0288dc2786911d9b7dda6b2961cb3f0afa1e0ee2` |
| APP | `/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-timing` | branch `app-integration-2026-09-20`, HEAD `6a58ef5` |
| LAB | `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck` | HEAD `6fa25fe0` |

**Path re-resolution, done before quoting anything.** The plan's engine paths are stale in name only, not in content:

- `git rev-parse --abbrev-ref HEAD` in `~/Projects/kalsallama` gives `b11010-merge`; the governor files are still `src/llama-governor-*.cpp` and `src/llama-governor.h`.
- `diff ~/Projects/kalsallama/src/llama-governor-policy.cpp ~/Projects/llama.rn-kalsa/vendor/llama.cpp/src/llama-governor-policy.cpp` -> identical. Same for `llama-governor-runtime.cpp` and the installed copy under `~/Projects/kalsa/node_modules/llama.rn/vendor/llama.cpp/src/`. So the engine line numbers hold across the engine repo, the vendored tree and the shipped pin.
- `git diff --stat 8537d097c 2a290390d -- src/llama-governor-policy.cpp src/llama-governor-runtime.cpp src/llama-governor.cpp` -> empty. The governor code did not move between the shipped pin and the release tip.
- The binding parameter parser is at `cpp/rn-governor-params.cpp` in the BINDING repo and at `node_modules/llama.rn/cpp/rn-governor-params.cpp` in the installed dep; `diff` -> identical. The plan's citation (`cpp/rn-governor-params.cpp:86`) is still exact.

---

## Answer first

### The six defects, one line each

| # | name | status in the current trees | owner of the fix |
|---|---|---|---|
| 5.1 | CPU fallback above the threshold | **EXISTS**, unchanged, and **pinned by a passing integration test** at `tests/test-governor-v0-turns.cpp:293-297` | ENGINE |
| 5.2 | the charger poisons the governor | **EXISTS**, but the first thing that fires is a THROW in the BINDING (`cpp/rn-llama.cpp:706-708`, `cpp/rn-governor-params.cpp:155-157`), not the sticky engine abort | APP (supply the data) + BINDING + ENGINE |
| 5.3 | the battery floor inverts the route | **EXISTS**, `src/llama-governor-runtime.cpp:65-68` | ENGINE |
| 5.4 | unreachable lanes | **EXISTS**: four of the clauses can never be true in any shipped configuration | ENGINE + APP (serialisation) |
| 5.5 | a 1-token remainder truncates the answer | **EXISTS**, `src/llama-governor-runtime.cpp:96-99` | ENGINE |
| 5.6 | CRITICAL has no exit | **EXISTS**; the policy recovery is real, the runtime latches `failed`; `critical_exit=34.0` is colder than `warm_exit=36.0` and is **locked by a test** at `tests/test-governor-v02-router.cpp:141-147` | ENGINE |

None of the six is fixed. None stopped reproducing. Two of them are now asserted as correct by tests, which changes the size of the fix.

### The single most important thing I learned

**Two of the six defects are not bugs the code forgot to avoid; they are behaviours a passing test currently demands.** `tests/test-governor-v0-turns.cpp:293-297` asserts that a hot 305-token prefill lands WHOLE on the decode context (`stats.prefill_chunks == "cpu:305"`, `position_matches(get_decode_context(), 304)`, `!position_matches(get_prefill_context(), 304)`). That is defect 5.1 (and 5.3) written down as `governor_hot_cpu_prefill=PASS`. `tests/test-governor-v02-router.cpp:141-147` asserts `critical_exit` at the inclusive 34.0 boundary and calls the 8.0 gap a hysteresis width. So the first step of the owner's order is not "make three small edits"; it is "change three assertions and the code under them", and the person doing it must know that the green test suite will go red on purpose.

The second thing worth knowing before any fix: **on Android the GPU is reachable only through the governor.** `resolveBackendPolicy` returns `{ kind: "cpu-only", reason: "gpu-fit-gate-blind" }` for every Android device (`src/engine/deviceTuning.ts:397`), and `nGpuLayersForBackend` maps that to `0` (`src/engine/deviceTuning.ts:851-859`). The only context in the app with `n_gpu_layers = 99` is `ctx_prefill`, created inside `load_governor_models` (`cpp/rn-llama.cpp:76`). So "the GPU path" and "the governor" are the same code path in the app; there is no second one.

---

## 1. The six defects, re-resolved

### 5.1 The CPU fallback above the threshold

**Still exists.** Current lines, `src/llama-governor-runtime.cpp:53-68`:

```cpp
53    const bool cpu_fallback = admission.decision == llama_governor_decision::CPUFallback &&
54        policy_.thermal_state() != llama_governor_thermal_state::FAST;
55    if (prefill_route_ == prefill_route::Undecided &&
56        (admission.decision == llama_governor_decision::Wait || cpu_fallback)) {
57        prefill_route_ = prefill_route::CPU;
58        stats_.prefill_engine = llama_governor_engine::CPU;
59        stats_.prefill_chunks[0] = '\0';
60        if (admission.decision == llama_governor_decision::Wait) {
61            LLAMA_LOG_WARN("%s: prefill admission is waiting; routing this turn to CPU\n", __func__);
62        }
63        return 0;
64    }
65    if (prefill_route_ == prefill_route::Undecided) {
66        prefill_route_ = prefill_route::GPU;
67        stats_.prefill_engine = requested;
68    }
```

The refusal is produced by the policy table at `src/llama-governor-policy.cpp:196-211`: the table is walked down while `now_c + k_cpu_delta_c[table-1] > k_limit_c`, and when it hits zero with `prompt_tokens >= 128` the function returns `Wait` (`:210-211`). Returning `0` from `admit_prefill` then admits the batch whole, on a context chosen at `src/llama-governor.cpp:190`: `const bool cpu_prefill = is_prefill && prefill_route_ == prefill_route::CPU;` then `target = cpu_prefill ? ctx_decode : ...`, and `ctx_decode` is the `n_gpu_layers = 0` context (`cpp/rn-llama.cpp:77`). So when the phone is hot, the whole prompt goes to the CPU, unsplit. On these phones the CPU is the hot engine (Part 3.1 of the plan: 2B pp2048 CPU +3.6 C against GPU +0.1 C).

- **Which file changed under it:** none of the engine files. What changed is the default `llama_governor_params` used by tests and callers: the struct defaults `reload_budget_available = true` (`src/llama-ext.h:259`) while the app and the parser default it false, which is what blocks 5.4, not 5.1.
- **Owner:** ENGINE.
- **What the fix must touch:** `src/llama-governor-runtime.cpp:55-63` (do not pick the hot engine as the fallback for a heat refusal) and `src/llama-governor-policy.cpp:196-211` (the refusal must be a token reduction, and only a declared pause when no safe chunk exists). `tests/test-governor-v0-turns.cpp:293-297` must be rewritten in the same change.
- **Proof:** a policy-level test that a heat refusal returns a chunk or a declared pause and never `Admit` for the whole batch; a rewritten `run_hot_cpu_prefill` asserting the new route; on device, a `KALSA_GOVERNOR` line whose `prefill_chunks` is not one unsplit count and whose `prefill_ctx_ngl` matches the engine actually used.

### 5.2 The charger poisons the governor

**Still exists**, with two firing points, and the first one is not the one the plan cites.

Engine, unchanged (`src/llama-governor-policy.cpp:60-63`):

```cpp
60    if (!profile.plugged) {
61        return true;
62    }
63    return profile.t_idle_valid && std::isfinite(profile.t_idle_c) && profile.t_idle_c + 1.0f < 42.0f;
```

The engine's own abort path is real: `update_thermal` sets `state_ = Invalid` (`:90-95`), `admit_prefill` returns `Abort` for Invalid (`:188-192`), the runtime calls `fail("prefill admission aborted")` (`src/llama-governor-runtime.cpp:50-52`), `fail` sets the sticky flag (`src/llama-governor.cpp:151-154`), and every later completion returns `fail("governor is failed")` (`:162-164`).

But in the shipped app the governor never gets that far, because the BINDING rejects the profile first:

- `cpp/rn-governor-params.cpp:86` defaults `t_idle_valid` false: `result.t_idle_valid = bool_or(thermo, "t_idle_valid", false);`
- `cpp/rn-governor-params.cpp:92-105` duplicates the engine's validity rule; `:155-157` then throws: `if (!governor_thermo_profile_is_valid(thermo)) { throw std::invalid_argument("governor: thermo profile invalid"); }`
- `cpp/rn-llama.cpp:706-708` throws the same condition again: `if (governor_thermo == nullptr || !governor_thermo_profile_is_valid(*governor_thermo)) { throw std::runtime_error("governor: thermo profile invalid"); }`
- at completion time, `cpp/jsi/RNLlamaJSI.cpp:1211-1213` throws `std::runtime_error("Invalid governor_thermo profile")` when `setThermoProfile` returns false.

The app's own side is confirmed: `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt:40-68` (`readThermo`) returns exactly four keys, `battTempTenthsC`, `battLevelPct`, `plugged`, `sensorValid`; it never returns `t_idle_valid` or `t_idle_c`. `src/engine/governorInputs.ts:166-167` then defaults them (`idleValid = Boolean(input.t_idle_valid)` -> false; `idle = numberValue(input.t_idle_c, 0)` -> 0). `src/engine/governorInputs.ts:179-206` (`readGovernorThermo`) returns that profile, and `src/engine/LlamaService.ts:2314-2327` builds `governorLoad` without checking `t_idle_valid` (it checks only `sensor_valid`), so the invalid profile is sent. `native/GovernorBatteryModule.kt` is byte-identical to the android copy (`diff` empty), so there is no second implementation to fix.

What the user sees today, therefore, is the app's fallback, not a crash: `isGovernorFallback` (`src/engine/governorRuntime.ts:35-45`) matches `governor.*invalid`, `initWithGovernorFallback` retries CPU-only (`:60-78`), and `src/engine/LlamaService.ts:2538-2540, 2643-2646` records `activeGovernorFallbackReason = "governor: thermo profile invalid"`. So a plugged phone silently loses the governor.

- **Which file changed under it:** the BINDING gained a parser-side validity gate (`cpp/rn-governor-params.cpp:92-105`, added in the native patch commit `987799a1`), and the engine tree moved under `vendor/llama.cpp/`. The plan's `cpp/rn-governor-params.cpp:86` is still exact.
- **Owner:** the APP owns the honest measurement (owner decision 2026-09-21); the BINDING owns what the parser does with it; the ENGINE owns the reference-reset bug below.
- **What the fix must touch:** see section 2, which is the reconnaissance the owner asked for.
- **Proof:** a JS unit test that a plugged profile carries `t_idle_valid: true` and a non-zero `t_idle_c`; an engine unit test for unplug then replug; on device, plug the cable, load, and read a `KALSA_GOVERNOR` line with no `fallback_reason`.

### 5.3 The battery floor inverts the route

**Still exists.** Current lines, `src/llama-governor-runtime.cpp:65-68`, quoted in 5.1 above. The mechanism: `prefill_engine()` returns `CPU` when `batt_level_pct < 45` (`src/llama-governor-policy.cpp:153-157`), `admit_prefill` with `requested == CPU` and a small enough prompt returns `Admit` (`:220-221`), and the runtime at `:65-68` then sets `prefill_route_ = prefill_route::GPU` while `stats_.prefill_engine = requested` (which is CPU). `src/llama-governor.cpp:190` picks `ctx_prefill`, i.e. `n_gpu_layers = 99`. Telemetry says CPU; the batch runs on the GPU context.

The floor is genuinely duplicated with two effects: `batt_level_pct < 45` in the policy (`src/llama-governor-policy.cpp:154`) and `batt_level_pct >= 45` in `select_decode` (`:238`), plus the `LOWBAT` state at `< 25` (`:122`).

- **Which file changed under it:** none.
- **Owner:** ENGINE.
- **What the fix must touch:** `src/llama-governor-runtime.cpp:65-68`. The route must follow the requested engine (`prefill_route_ = requested == CPU ? CPU : GPU`), and `stats_.prefill_engine` must agree with the context actually used.
- **Proof:** an integration test that a `FAST`-state, 40 percent battery prefill requested-CPU lands on `ctx_decode` (`position_matches(get_decode_context(), ...)`); on device, a `KALSA_GOVERNOR` line whose route, `prefill_ctx_ngl` and KV placement agree.

### 5.4 Unreachable lanes

**Still exists.** See section 5 for the full enumeration. The one-line version: `select_decode` requires thirteen clauses (`src/llama-governor-policy.cpp:238-242`), of which `generation == V73`, `kexp_cool_scope`, `cool_delta_measured` and `reload_budget_available` can never be satisfied by the shipped app.

- **Which file changed under it:** the app. `buildGovernorParams` (`src/engine/governorInputs.ts:132-143`) sends `reload_budget_available: false` at `:140`, and `GPU_PREFILL_CORRECT` disables `V73` at `:25`. The parser independently defaults `reload_budget_available` to false (`cpp/rn-governor-params.cpp:125`) while the native struct default is true (`src/llama-ext.h:259`).
- **Owner:** ENGINE for the generation clause; APP for the serialisation; a human for which generation may use the lane.
- **Proof:** `tests/test-governor-v02-router.cpp:55-62` already reaches `GPU_COOLMODE` in-process, so the policy is not the blocker; the proof must be an app-side unit test that the keys are sent plus a device `KALSA_GOVERNOR` line with `engine_decode: "GPU"`.

### 5.5 A prompt of 129, 257 or 385 tokens truncates the answer

**Still exists.** Current lines, `src/llama-governor-runtime.cpp:96-99`:

```cpp
96        const int32_t count = std::min<int32_t>(next.tokens, remaining);
97        if (count <= 1) {
98            return -2;
99        }
```

The remainder of 1 is produced by the table: for `remaining == 1`, `table` walks to 0 (`src/llama-governor-policy.cpp:196-199`), then `prompt_tokens < k_table_tokens[0] && now_c + k_cpu_delta_c[0] <= k_limit_c` fires (`:204-205`), so `result.tokens = 1` and `decision == Admit` for a CPU request (`:207-208`). The loop then computes `count == 1` and returns -2. 1329 tokens is safe: `tests/test-governor-v0-turns.cpp:192` asserts `"512+512+128+128+49"` and `tests/test-governor-v02-router.cpp:228` asserts `305` -> `128+128+49`. The defect is exactly the 1-remainder class, so no existing test covers it.

The -2 is explicitly *not* classified as a governor failure: `cpp/rn-governor.cpp:52` (`if (result != 0 && result != -2)`), `cpp/rn-llama.cpp:659` (`if (result != 0 && result != -2 && !was_failed)`). It propagates as a bare negative return into the completion loop and generation stops with no user-visible error.

- **Which file changed under it:** none.
- **Owner:** ENGINE.
- **What the fix must touch:** `src/llama-governor-runtime.cpp:96-99`. A one-token remainder must be merged into the previous chunk (or admitted as a single-token step), not refused.
- **Proof:** a runtime test with prompts 129, 257, 385 asserting no -2 and a complete decode; on device, a 129-token prompt that produces a full answer.

### 5.6 CRITICAL has no exit

**Still exists.** The policy recovery is real (`src/llama-governor-policy.cpp:118-121`):

```cpp
118    } else if (state_ == llama_governor_thermal_state::CRITICAL) {
119        if (can_leave(now_ms, temp, limits.critical_exit)) {
120            state_ = llama_governor_thermal_state::FAST;
121        }
```

The runtime makes it useless: at CRITICAL the first prefill returns `Abort` (`:188-192`) -> `fail("prefill admission aborted")` (`src/llama-governor-runtime.cpp:50-52`), the first decode returns `wait == true` -> `fail("decode admission aborted")` (`:127-132`), and `fail` latches (`src/llama-governor.cpp:151-154`, `:162-164`). `cpp/rn-governor.cpp:44-49` latches a second flag. So a governor that enters CRITICAL once is dead for the life of the context, even after the phone cools.

The threshold inversion is also still there and is worse than the plan says, because a test locks it. Unplugged tuple at `src/llama-governor-policy.cpp:44`:

```cpp
44        return { 38.0f, 36.0f, 39.5f, 36.5f, 42.0f, 34.0f };
```

field order from `src/llama-governor-policy.h:45-52`: `warm_enter, warm_exit, cool_enter, cool_exit, critical_enter, critical_exit`. So `critical_exit = 34.0` < `warm_exit = 36.0`. `k_kill_c` at `src/llama-governor-policy.cpp:12` (43.0) is dead in both branches because `critical_enter` is at most 42.0 (`:44`, `:46-49`), so `temperature >= k_kill_c` can never be the binding clause. `k_warn_c` at `:10` is used only to define `k_limit_c` at `:11`. `tests/test-governor-v02-router.cpp:139-143` asserts the 34.0 boundary and the 8.0 width as intended behaviour.

- **Which file changed under it:** none.
- **Owner:** ENGINE.
- **What the fix must touch:** `src/llama-governor.cpp:151-154` (`fail` must not be terminal for a thermal state that can clear), `src/llama-governor-runtime.cpp:127-132` (a CRITICAL wait is a pause, not a fail), and `src/llama-governor-policy.cpp:44` (`critical_exit` must be above `warm_exit`, or the tuple must be re-read as an ordered scale). `tests/test-governor-v02-router.cpp:139-143` must change with it.
- **Proof:** a runtime test that a CRITICAL turn pauses, the device cools, and the next turn decodes; a policy test that `critical_exit > warm_exit`.

---

## 2. `t_idle_c` and `t_idle_valid`: what the engine means, and what the app can honestly fill

### Where they are read and what they gate

The struct is `llama_governor_thermo_profile` at `src/llama-ext.h:267-274` (`batt_temp_tenths_c`, `batt_level_pct`, `plugged`, `sensor_valid`, `t_idle_valid = false`, `t_idle_c = 0.0f`, `trend_c_per_min = 0.0f`). The parsed copy is `cpp/rn-governor-params.cpp:75-90`.

Three distinct jobs are attached to `t_idle_c`:

1. **Validity gate.** `src/llama-governor-policy.cpp:60-63`: when `plugged`, the profile is valid only if `t_idle_valid` and `std::isfinite(t_idle_c)` and `t_idle_c + 1.0f < 42.0f`. Same rule duplicated in the binding at `cpp/rn-governor-params.cpp:100-104`.
2. **The whole threshold tuple, when plugged.** `src/llama-governor-policy.cpp:42-51`:

```cpp
42    llama_governor_policy::thresholds llama_governor_policy::get_thresholds() const {
43        if (!profile_.plugged) {
44            return { 38.0f, 36.0f, 39.5f, 36.5f, 42.0f, 34.0f };
45        }
46        return {
47            std::min(profile_.t_idle_c + 3.0f, 42.0f), profile_.t_idle_c + 1.0f,
48            std::min(profile_.t_idle_c + 4.5f, 42.0f), profile_.t_idle_c + 1.5f,
49            std::min(profile_.t_idle_c + 7.0f, 42.0f), profile_.t_idle_c + 1.0f,
50        };
51    }
```

So when plugged, every entry and exit threshold is offset from `t_idle_c`: warm at +3/+1, cool at +4.5/+1.5, critical at +7/+1. The unplugged path uses absolute constants and ignores `t_idle_c` entirely.
3. **A stability self-check and one flag.** `src/llama-governor-policy.cpp:97-112`: the first plugged sample latches `t_idle_reference_c_`; any later plugged sample whose `t_idle_c` differs by more than 1.5 C sets `state_ = Invalid` (`:101-107`). Line 112: `hot_plugged_ = profile.plugged && profile.t_idle_c >= 37.5f;`, and `hot_plugged_` blocks both the GPU prefill branch (`:169`) and the whole cool decode lane (`:239`).

### Is it the same quantity as the battery temperature

No, and the engine's own field names say so. `batt_temp_tenths_c` is the live battery temperature (dumpsys tenths of a degree, per the comment on the struct at `src/llama-ext.h:266`). `t_idle_c` is a reference level: the plugged thresholds are "the current battery temperature minus the idle baseline" in effect, because every threshold is written as `t_idle_c + delta`. Feeding the live battery temperature into `t_idle_c` also feeds it into `batt_temp_tenths_c`, so the delta becomes `live - live = 0` and the classification degenerates: warm_enter would equal the live temperature, so the phone would be classified WARM or better at rest by construction.

### When it is valid versus stale, in the engine's own terms

A "valid idle temperature" is a plugged baseline that is:

- finite and below 41 C (`t_idle_c + 1.0 < 42.0`, `src/llama-governor-policy.cpp:63`);
- stable to within 1.5 C for the whole plugged session (`:101`), because the first plugged sample is the reference;
- below 37.5 C if the phone is to keep the acceleration lanes (`hot_plugged_`, `:112`).

Stale means either the profile is invalid (the two conditions above) or `t_idle_valid` is false, which today is always, because the native module never sends the key (`GovernorBatteryModule.kt:40-68`).

### The reference-reset bug the app cannot work around

`have_t_idle_reference_` is set once and never cleared. `src/llama-governor-policy.cpp:96-108` has no `else` branch for `!profile.plugged`. So an unplug, a cool-down and a replug inside one governor session produces `|t_idle_c - t_idle_reference_c_| > 1.5` and invalidates the profile, no matter how honest the app is. Any app-side latch must be paired with a three-line engine change:

```cpp
// src/llama-governor-policy.cpp, in update_thermal, before the plugged block
if (!profile.plugged) {
    have_t_idle_reference_ = false;
}
```

### What the app could measure to fill it honestly

The app already reads the battery temperature every turn (`GovernorBatteryModule.kt:54`, `EXTRA_TEMPERATURE`, tenths of a degree; the sticky intent is re-registered at `:198-201`). What it does not have is a baseline. Three honest options, in increasing cost:

1. **Latch on the plug-in edge.** Poll `EXTRA_PLUGGED`/`EXTRA_STATUS` (already available in the same intent, `GovernorBatteryModule.kt:59`). On the first sample with `plugged == true` after a sample with `plugged == false`, store `battTempTenthsC` as the baseline in AsyncStorage (alongside `kalsa.governor.enabled`, `src/engine/governorRuntime.ts:3`). Then always return the stored value as `t_idle_c` and `t_idle_valid = true` while plugged; clear on unplug. This is the smallest change, it survives process restarts, and it gives a constant value, so the 1.5 C drift check cannot fire. It needs the reference-reset fix above for the replug case.
2. **Cooled-state minimum of a quiet window.** While no turn is running and the platform thermal status is 0, keep `min(battTempTenthsC)` over the last N minutes and use it. Works without a plug-in edge, needs a sampler (the module already has one, `GovernorBatteryModule.kt:93-135`, currently bench-only via `src/engine/governorBatterySampler.ts:11`).
3. **Delta against the unplugged absolute set.** Reuse the unplugged constants (38/36/39.5/36.5/42/34) as absolute plugged thresholds too. That is a redefinition, not a measurement, and it discards the reason the plugged branch exists.

Recommendation: option 1, plus the reset fix. It is the only option that matches what the owner decided (the app supplies real information) without adding a background sampler to production.

### Does the engine's current semantics make the app's job possible

Yes, if and only if the app sends a constant latched baseline and the engine resets its reference on unplug. The engine already latches its own reference (`:98-99`), so it is asking the caller for a session-stable number, which is exactly what option 1 produces. The drift check at `:101` then becomes a harmless guard against a caller that changes meaning mid-session.

### The smallest redefinition, if one is wanted anyway

The real defect is that one field carries two jobs: "the baseline the threshold tuple is offset from" and "the current idle sample the stability check compares". The smallest redefinition is a comment plus a reordering, not a new field:

- state on `t_idle_c` at `src/llama-ext.h:273` that it is the latched plugged baseline, not a live sample;
- keep the 1.5 C check but make it reset the reference and re-latch instead of invalidating the profile (a 5-line change at `src/llama-governor-policy.cpp:96-108`).

That keeps one field, keeps the alignment between the binding parser and the engine, and removes the only two ways the app can be honest and still fail.

---

## 3. The governor input contract, as a table

### 3a. Keys the app sends today

Source: `buildGovernorParams`, `src/engine/governorInputs.ts:123-144`. These go out nested under `governor` in the load params (`src/engine/LlamaService.ts:2402`).

| key | app site | type | unit / domain | notes |
|---|---|---|---|---|
| `enabled` | `governorInputs.ts:130`, `:133` | boolean | - | `force \|\| GPU_PREFILL_CORRECT[generation]`; the parser requires it (`cpp/rn-governor-params.cpp:114-119`) |
| `generation` | `:129`, `:134` | string | `"V73" \| "V75" \| "V79" \| "Unknown"` | regex on `socModel` (`:62-75`); parser accepts `NoHTP` too (`cpp/rn-governor-params.cpp:42-50`) |
| `model_kind` | `:135` | string | `Dense \| Hybrid \| MoE` | `modelKind`, `:76-81` |
| `gpu_fit` | `:136` | string | `Fit \| NoFit` | `gpuFit`, `:84-121` |
| `gpu_prefill_measured` | `:137` | boolean | - | `generation === "V75" \|\| generation === "V79"` |
| `bench_force_gpu_prefill` | `:138` | boolean | - | bench flag |
| `npu_lane_enabled` | `:139` | boolean | - | always `false`; parser throws if true (`cpp/rn-governor-params.cpp:150-151`) |
| `reload_budget_available` | `:140` | boolean | - | always `false`; parser default is also false (`:125`) |
| `forced` | `:141` | boolean | - | **never read by the parser**; app-only telemetry (`src/engine/LlamaService.ts:1773`, `:2353`, `:2642`) |
| `reason` | `:142` | string | - | **never read by the parser**; present only when `enabled == false`; app-only log (`src/engine/LlamaService.ts:2350-2355`) |

### 3b. The thermo object the app sends

Built by `profileFrom` (`src/engine/governorInputs.ts:158-177`), stripped of `thermo_source` by `nativeGovernorThermo` (`src/engine/LlamaService.ts:1650-1656`), attached at `:2325` as `governor.thermo` for the load and pushed per turn through `setGovernorThermo` (`:1723`, JSI at `cpp/jsi/RNLlamaJSI.cpp:827-850`).

| key | produced by | type | unit | value today |
|---|---|---|---|---|
| `batt_temp_tenths_c` | `governorInputs.ts:161`, native `GovernorBatteryModule.kt:54,60` | number | tenths of C | live battery temperature |
| `batt_level_pct` | `:162`, native `:56-58,61` | number | percent, clamped 0-100 | live |
| `plugged` | `:163`, native `:59,62` | boolean | - | live |
| `sensor_valid` | `:164`, native `:63` | boolean | - | `present && temperature > 0` |
| `t_idle_valid` | `:166` | boolean | - | **always false** (native never sends it) |
| `t_idle_c` | `:167` | number | C, float | **always 0** |
| `trend_c_per_min` | `:175` | number | C/min | **always 0** |

### 3c. Keys the parser accepts

Source: `parse_governor_params`, `cpp/rn-governor-params.cpp:107-159`; `parse_governor_thermo` at `:75-90`. The corresponding native struct is `llama_governor_params` at `src/llama-ext.h:243-262`.

| key | parser line | type | default | read by the app? |
|---|---|---|---|---|
| `enabled` | `:114-119` | boolean | required | yes |
| `thermo` | `:120-122`, `:154` | object | required | yes |
| `reload_budget_available` | `:125` | boolean | **false** | yes, sends false |
| `schema_version` | `:126` | number | 3 | **no** |
| `capability_schema_version` | `:127-128` | number | 2 | **no** |
| `generation` | `:129` | string | `Unknown` | yes |
| `model_kind` | `:130` | string | `Unknown` | yes |
| `gpu_fit` | `:131` | string | `Unknown` | yes |
| `npu_fit` | `:132` | string | `Unknown` | **no** |
| `htp_trunk_readable` | `:133` | boolean | false | **no** |
| `htp_experts_readable` | `:134` | boolean | false | **no** |
| `npu_lane_enabled` | `:135` | boolean | false | yes, sends false |
| `gpu_prefill_measured` | `:136` | boolean | false | yes |
| `bench_force_gpu_prefill` | `:137` | boolean | false | yes |
| `cool_prefill_eligible` | `:138` | boolean | false | **no** |
| `cool_delta_measured` | `:139` | boolean | false | **no** |
| `kexp_cool_scope` | `:140` | boolean | false | **no** |
| `cool_pays` | `:141` | string | `Unknown` | **no** |
| `admission_margin_c` | `:142-143` | number | 0.5 | **no** |
| `cache_budget_bytes` | `:144-145` | number | 0 | **no** |
| `expert_cycle_bytes` | `:146-147` | number | 0 | **no** |
| `expert_substitution_lambda` | `:148-149` | number | 0.0 | **no** |

The thermo sub-keys the parser accepts are exactly the seven listed in 3b (`cpp/rn-governor-params.cpp:82-88`).

### 3d. Gaps in both directions

**Fields the parser reads and the app never sends** (defaults apply, no throw): `schema_version`, `capability_schema_version`, `npu_fit`, `htp_trunk_readable`, `htp_experts_readable`, `cool_prefill_eligible`, `cool_delta_measured`, `kexp_cool_scope`, `cool_pays`, `admission_margin_c`, `cache_budget_bytes`, `expert_cycle_bytes`, `expert_substitution_lambda`. Verified by `grep` over `src/` for each name: zero hits. Consequences: `valid_schema` (`src/llama-governor-policy.cpp:17-20`) passes only because the native defaults happen to be exactly `schema_version == 3` and `capability_schema_version == 2`; if either default moves, the governor silently drops to CPU with no app-side change. Three of the dead-lane clauses live here.

**Fields the app sends and nobody reads:** `forced` and `reason`. Confirmed by `grep` for `"forced"` and `"reason"` over `cpp/rn-governor-params.cpp`, `cpp/rn-llama.cpp`, `cpp/jsi/RNLlamaJSI.cpp` restricted to the governor: no hits.

**Fields required on one side and defaulted on the other:** `t_idle_valid` (parser default false, engine policy requires true when plugged) and `reload_budget_available` (native struct default true at `src/llama-ext.h:259`, parser default false at `cpp/rn-governor-params.cpp:125`, app sends false at `src/engine/governorInputs.ts:140`).

---

## 4. The GPU path: kernels, build, runtime compile, and where `exit(1)` fires

### Where the kernels live and how they are built

- Sources: `ggml/src/ggml-opencl/kernels/*.cl`, 186 files at the ENGINE root.
- Build-time embedding: `ggml/src/ggml-opencl/CMakeLists.txt:28-35` defines `GGML_OPENCL_EMBED_KERNELS` and runs `kernels/embed_kernel.py` per kernel (`:42-62`). Upstream option default is ON (`ggml/CMakeLists.txt:267`).
- In the app: `android/src/main/rnllama/CMakeLists.txt:156-210`. It globs `*.cl` (`:164-165`), embeds each with `embed_kernel.py` (`:174-184`), compiles `ggml-opencl/*.cpp` (`cmake/rnllama-sources.cmake:85`), links the `libOpenCL.so` stub (`:186-196`), and defines `GGML_USE_OPENCL`, `GGML_OPENCL_USE_ADRENO_KERNELS`, `GGML_OPENCL_EMBED_KERNELS`, `GGML_OPENCL_SOA_Q`, `GGML_OPENCL_TARGET_VERSION=300` (`:203-209`).
- The app requests the OpenCL+Hexagon variant: `app.config.js:93-99` (`enableOpenCLAndHexagon: true`). `RNLLAMA_ANDROID_VARIANTS` is empty by default (`android/src/main/cmake/rnllama-build-options.cmake:29-50`), so all variants build. On an Adreno+Hexagon arm64 device the JNI layer loads `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl` (`android/src/main/java/com/rnllama/RNLlama.java:200-205`). Only that variant has OpenCL compiled in.

### Where they are compiled at runtime inside the app

- The kernel set is compiled on the device, at runtime, the first time an OpenCL buffer is allocated: `ggml/src/ggml-opencl/ggml-opencl.cpp:13976-13983` (`ggml_backend_opencl_buffer_type_alloc_buffer` calls `cl_program_cache_init` then `load_cl_kernels`).
- `load_cl_kernels` (`:1508-5373`) builds roughly 180 programs through `build_program_from_source` (`:1397-1412`), which calls `build_program_from_source_ex(..., /*fatal=*/true)` (`:1409`).
- Crash-class side note: `ggml_backend_opencl_device_init` only opens a command queue and defers kernel loading (`:6895-6897`, comment `// delay kernel loading until the first buffer is created`).
- There is also a `clCreateKernel`-lazy path for argsort (`:9594`).
- **An on-disk binary cache already exists and already runs in-app.** `ggml/src/ggml-opencl/cl-program-cache.cpp`, header at `cl-program-cache.h`. It is on by default, keyed by SHA-256 over `(source bytes, compile options, CL_DEVICE_NAME, CL_DRIVER_VERSION, CL_PLATFORM_VERSION, format version)` (`cl-program-cache.h` key spec; `cl_program_cache_init` at `:307-340`). Its default directory on non-Windows, non-Apple is `<temp dir>/llama.cpp/cl-cache` (`:184-200`), and the header itself names the Android case: "The throwing overload aborts the process when no usable temp directory exists (e.g. Android app contexts with TMPDIR unset); an empty return here just disables the cache instead." **UNVERIFIED on device:** whether the cache is actually enabled in the app (an unprivileged app usually cannot write the default temp dir). What would settle it: `adb logcat` for `ggml_opencl: kernel cache enabled at` against `kernel cache disabled`.

### Where an `exit(1)` can fire in-app

Nine `exit(1)` sites exist in `ggml-opencl.cpp` (grep: `1364, 1390, 1427, 1438, 3613, 6416, 6434, 6445, 6458, 30862`). One class is reachable from the app:

**Reachable, and it is the reason the plan's GPU-probe item exists:**

```cpp
// ggml/src/ggml-opencl/ggml-opencl.cpp:1364
        if (fatal) {
            exit(1);
        }
```

Condition: `clBuildProgram` fails for any kernel built through `build_program_from_source` (fatal=true), i.e. any kernel in the bulk set. Path: `ggml_backend_opencl_buffer_type_alloc_buffer` (`:13983`) -> `load_cl_kernels` (`:1508`) -> `build_program_from_source` (`:1409`) -> `exit(1)` at `:1364`. Same function, same reachability:

```cpp
// ggml/src/ggml-opencl/ggml-opencl.cpp:1390
            GGML_LOG_ERROR("OpenCL error creating program");
            if (fatal) exit(1);
```

**Not reachable in-app:**

- `:1427` and `:1438` are in `build_program_from_binary`, used only under `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` (not defined by the app build, `android/src/main/rnllama/CMakeLists.txt:203-209`).
- `:3613` and `:30862` are `if (sg_size < 0)` for a GPU family that is neither Adreno nor Intel, but `ggml_opencl_is_device_supported` already refuses any device whose name lacks `Adreno`/`Qualcomm`/`Intel` (`:6610-6634`), so such a family never reaches kernel loading.
- `:6416`, `:6434`, `:6445`, `:6458` are in `ggml_opencl_probe_devices` and fire only on values of `GGML_OPENCL_PLATFORM` / `GGML_OPENCL_DEVICE` (read at `:6397-6398`). An Android app sets neither.
- `CL_CHECK` is `GGML_ASSERT(0)` -> `abort()` (`:67-73`). It would fire if a `fatal=false` build returned `nullptr` and the caller passed it to `clCreateKernel`. Every current `fatal=false` site guards the null program first (checked at `:5586, 5622, 5647, 5804, 5936, 6008, 6031, 6051, 6131, 6155, 6176, 6288`; the two canonical ones are `:5802-5805` and `:6286-6290`, each immediately followed by `if (!prog) { return false; }`). So the abort is a latent trap, not a live one, and any new non-fatal build site must copy the guard.

### What "clean degradation" must mean, concretely

Today: a kernel that fails to compile takes the process down with `exit(1)`. There is no fallback, no catch, and no log the app can see after the fact, because `exit(1)` is a normal process exit, not a crash the app can intercept.

Clean degradation, as a contract:

1. **No `exit(1)` on the compile path.** `build_program_from_source` must take `fatal=false` for the bulk set, like the FA variants already do (`ggml-opencl.cpp:5802-5805`, `:6286-6290`).
2. **Every non-fatal build site guards its null program** before `clCreateKernel` (the existing pattern), so `CL_CHECK`/`GGML_ASSERT(0)` cannot turn a compile failure into `SIGABRT`.
3. **A failed compile poisons the (device, driver) pair, not the app.** Record `vendor`, `CL_DEVICE_NAME`, `CL_DRIVER_VERSION`, `CL_DEVICE_GLOBAL_MEM_SIZE`, `cl_khr_integer_dot_product`, and the build outcome; cache it next to the program cache (which already keys on device and driver, `cl-program-cache.h`). On `fail`, the OpenCL device must report itself unusable, `ggml_backend_opencl_supports_op` must return false for the affected ops, and the scheduler must keep those nodes on CPU.
4. **The governor must see it.** `gpu_fit` becomes `NoFit` for the session, so `src/engine/governorInputs.ts:84-121` returns `NoFit` and `src/engine/LlamaService.ts:2319` refuses `governorLoad`, which lands on the existing CPU-only path (`:2408-2410`, `:2428-2430`).
5. **The app must say so.** `KALSA_GOVERNOR_FALLBACK` with `stage:"accelerator_backend"` already exists (`cpp/jsi/RNLlamaJSI.cpp:676-684` for the "no backend" case); the compile-failure case needs the same line with the driver string.

### What the app does TODAY when the GPU fails or is absent

- **GPU absent (no registered accelerator):** `configureBackendDevices` sets `anyGpuAvailable = false` (`cpp/jsi/RNLlamaJSI.cpp:669-675`), and governor mode throws `"Governor mode requires an available accelerator backend"` (`:676-684`) after logging `KALSA_GOVERNOR_FALLBACK {stage:"accelerator_backend"...}`. `initWithGovernorFallback` (`src/engine/governorRuntime.ts:60-78`) matches the `KALSA_GOVERNOR_FALLBACK` line and retries CPU-only.
- **GPU not used at all:** `resolveBackendPolicy` returns `cpu-only` for every Android device (`src/engine/deviceTuning.ts:376-397`), so `n_gpu_layers` is 0 baseline (`:845-859`, applied at `src/engine/LlamaService.ts:2395`), and the governor-off path forces 0 again (`:2408-2410`, `:2428-2430`). There is a separate one-shot `KALSA_GPU_FALLBACK` retry for the non-governor path (`:2589-2615`), but it cannot fire on Android today because `n_gpu_layers` is never > 0 on that path.
- **GPU present but the governor is off:** nothing uses the GPU. `n_gpu_layers = 0`.
- **The compiler exit(1):** the process dies. No fallback is possible, because `exit(1)` runs inside the native backend below any `try/catch`.

---

## 5. The dead lanes (5.4)

### `select_decode`, `src/llama-governor-policy.cpp:228-256`

```cpp
231    if (!have_profile_ || !profile_valid_ || state_ == llama_governor_thermal_state::Unknown ||
232        state_ == llama_governor_thermal_state::Invalid || state_ == llama_governor_thermal_state::CRITICAL) {
233        result.wait = true;
234        return result;
235    }
236    const bool budget_ok = last_gpu_engagement_ms_ < 0 || now_ms < last_gpu_engagement_ms_ ||
237                           now_ms - last_gpu_engagement_ms_ >= k_flip_window_ms;
238    const bool eligible = valid_schema(params_) && have_profile_ && profile_valid_ && profile_.batt_level_pct >= 45 &&
239        state_ == llama_governor_thermal_state::COOLMODE && !hot_plugged_ &&
240        params_.generation == llama_governor_generation::V73 &&
241        params_.gpu_fit == llama_governor_fit::Fit && params_.cool_delta_measured && params_.kexp_cool_scope &&
242        params_.cool_pays != llama_governor_cool_pays::No && params_.reload_budget_available && budget_ok;
```

`k_flip_window_ms` is one hour (`:6`).

| clause | reachable in a shipped config? | why |
|---|---|---|
| `valid_schema` | yes | native defaults 3/2 (`src/llama-ext.h:244-245`) satisfy `:17-20` |
| `have_profile_`, `profile_valid_` | yes | set by `update_thermal` (`:110-111`) |
| `batt_level_pct >= 45` | yes | not asserted, but the floor is only 45 |
| `state_ == COOLMODE` | yes | battery temp above `cool_enter` 39.5 unplugged (`:44`) or `t_idle+4.5` plugged (`:48`) |
| `!hot_plugged_` | yes | requires unplugged or `t_idle_c < 37.5` (`:112`) |
| `generation == V73` | **NO** | app enables only `V75`/`V79` (`src/engine/governorInputs.ts:14-27`, `:130`); `V73` is `false` and the governor never loads on a V73 phone |
| `gpu_fit == Fit` | yes | on a >8 GiB Qualcomm device with `kvBytesPerToken` and a passing memory estimate (`:84-121`) |
| `cool_delta_measured` | **NO** | key never sent by the app; parser default false (`cpp/rn-governor-params.cpp:139`) |
| `kexp_cool_scope` | **NO** | key never sent; parser default false (`:140`) |
| `cool_pays != No` | moot | key never sent, default `Unknown` passes, but the three clauses above already fail |
| `reload_budget_available` | **NO** | app sends false (`src/engine/governorInputs.ts:140`); parser default also false (`cpp/rn-governor-params.cpp:125`) |
| `budget_ok` | yes | `last_gpu_engagement_ms_ = -1` initially (`src/llama-governor-policy.h:64`) |

### `admit_prefill` and the prefill cool lane

`admit_prefill` (`src/llama-governor-policy.cpp:184-226`) has no lane of its own; it takes `requested` from `prefill_engine()`. Its never-true case is `requested == NPU` (`:207`, `:217`), because `prefill_engine()` (`:152-172`) has no NPU branch at all. The code even writes a rule for it (`:207`: `requested == NPU ? 2 : ...`) that nothing can produce.

The prefill cool lane is `src/llama-governor-policy.cpp:167-169`:

```cpp
167    if (params_.generation == llama_governor_generation::V73 && params_.model_kind == llama_governor_model_kind::MoE &&
168        params_.cool_prefill_eligible && params_.gpu_fit == llama_governor_fit::Fit && !hot_plugged_) {
169        return llama_governor_engine::GPU_COOLMODE;
```

Never true in a shipped config: `generation == V73` (same reason) and `cool_prefill_eligible` (never sent, parser default false at `cpp/rn-governor-params.cpp:138`).

`prefill_rule()` (`:175-182`) has one more dead value: `generation == NoHTP -> rule 1`. The parser accepts `"NoHTP"` (`cpp/rn-governor-params.cpp:44`) but `generationFor` never returns it (`src/engine/governorInputs.ts:62-75`).

### The minimal set of changes that makes the lanes reachable

To make **select_decode's `GPU_COOLMODE`** reachable:

1. Serialise `cool_delta_measured`, `kexp_cool_scope` and `cool_pays` from the app (`src/engine/governorInputs.ts:132-143`), or remove the clauses. Data needed: a measured cool-mode delta for the device in question (the archived S23 KEXP cell is the only one: plan Part 3.2). Serialisation alone is not enough; the clause exists to demand evidence.
2. Send `reload_budget_available: true` when a reload budget exists, or drop the clause. Data needed: a measured reload cost. The commit path already measures it (`src/llama-governor.cpp:104-117`, `stats_.commit_bytes`/`commit_us`), so the budget could be derived from telemetry instead of a hand-set boolean.
3. Deal with `generation == V73`. Either delete the clause (a policy change that must be justified by a measurement on the target phone) or add the target generation to the data row. This is a human decision, not a code discovery: the cool-mode evidence on disk is S23 (V73) only.
4. `test-governor-v02-router.cpp:55-62` already proves the policy reaches the lane when the inputs are set, so no policy rewrite is needed beyond step 3.

To make **prefill `GPU_COOLMODE`** reachable, add step 1's `cool_prefill_eligible` plus the same `V73` decision.

To make the **NPU lane** reachable: `prefill_engine()` needs an NPU branch, and the parser's hard throw must be replaced by a capability check (`cpp/rn-governor-params.cpp:150-151`). Both are explicitly out of scope per the plan; noting them so nobody mistakes "turn the flag on" for a fix.

---

## 6. Device generations

### What `generationFor` maps for our three phones

`src/engine/governorInputs.ts:62-75`:

| phone | SoC | matching test | result |
|---|---|---|---|
| Xiaomi 14 (houji) | SM8650 / PINEAPPLE | `:65` `/(SM8650\|PINEAPPLE)/` and `:71` `/(QRD8650\|SM8650)/` in the fallback text | `V75` |
| Galaxy S23 | SM8550 / KALAMA | `:64` `/(SM8550\|KALAMA\|SM7675\|SM8635)/` and `:73` `/(HDK8550\|SM8550\|...)/` | `V73` |
| Jelly Star | Helio G99, Mali-G57 MC2 | no test matches; the SoC string is MediaTek | `Unknown` |

There are six `.test()` calls, three on `socModel` (`:64-66`) and three on `modelName / modelId / manufacturer` (`:71-73`). No probe; an Exynos or Dimensity falls to `Unknown`.

### Which generations the app actually enables

`GPU_PREFILL_CORRECT` at `src/engine/governorInputs.ts:14-27`: `V79: true`, `V75: true`, `V73: false`, `Unknown: false`. `enabled = force || GPU_PREFILL_CORRECT[generation]` at `:130`. So in production the governor loads on `V75` and `V79` only, and `V73` requires the bench key `kalsa.bench.governor_force` (`:10`, `:146-152`). `Unknown` never loads, which is why the Jelly has no accelerator path (`gpuFit` also returns `NoFit` for `total <= EIGHT_GIB` at `:92`).

### Which code paths test `V73` specifically, and where they block a V75/V79 device

Engine (both block the 8 Elite and the Xiaomi):

- `src/llama-governor-policy.cpp:240`, inside `select_decode`: `params_.generation == llama_governor_generation::V73`. A `V75` or `V79` device can never satisfy it, so the cool decode lane is closed on exactly the two phones where the governor runs.
- `src/llama-governor-policy.cpp:167`, inside `prefill_engine`: `params_.generation == llama_governor_generation::V73`. Same effect for the cool prefill lane.

Engine paths that test the granted generations (the complement):

- `src/llama-governor-policy.cpp:163-165`: `(generation == V75 || generation == V79) && gpu_fit == Fit && gpu_prefill_measured` -> GPU prefill. This is the one lane that works, and only because the app's `gpu_prefill_measured` (`src/engine/governorInputs.ts:137`) plus the Fit gate line up.
- `src/llama-governor-policy.cpp:176`: `generation == NoHTP` -> rule 1. Dead (see section 5).

App: `src/engine/governorInputs.ts:25` (`V73: false`) and `:137` (`gpu_prefill_measured` only for `V75`/`V79`). The native enum is `src/llama-ext.h:197-203` (`Unknown, NoHTP, V73, V75, V79`), and the binding maps strings to it at `cpp/rn-governor-params.cpp:42-50`.

Net: the same `V73` literal appears on both sides (app disables it, engine requires it for the cool lanes), which is why 5.4 is a two-sided defect rather than a policy bug.

---

## 7. What is already measured about the GPU

Every entry names the artefact. **Prefill and decode are labelled, because the corpus has conflated them.**

### Xiaomi 14 / Adreno 750 / SM8650

| what | phase | value | artefact |
|---|---|---|---|
| GPU prefill vs CPU, interleaved, unplugged | prefill | pp128 `186.567 / 58.676` = **3.18x** (the superseding number) | `results/gpu_prefill_recheck_xiaomi/report.md:20-32` |
| the same run, length curve | prefill | pp512 3.95x, pp1024 5.35x, pp2048 6.69x (2B Q4_K_M) | `results/gpu_prefill_recheck_xiaomi/report.md:64-72` |
| 4B Q4_K_M curve | prefill | 4.17x / 5.70x / 6.95x / 6.46x | `results/gpu_prefill_recheck_xiaomi/report.md:78-85` |
| GPU decode vs CPU, interleaved | **decode** | `17.46 / 26.50` = **0.66x (GPU slower)**, n=2 pairs | `results/gpu_prefill_recheck_xiaomi/report.md:42, 48-53` |
| the superseded number | prefill | pp128 `181.652 / 31.459` = 5.77x | `results/xiaomi_ab/phase3_baseline/bench_cpu.json:42` vs `bench_gpu_faoff.json:42` |
| the same run, decode | decode | tg256 `16.149 / 7.066` = GPU 2.3x slower | same two files, line 87 |
| prefill thermal, contiguous | prefill | CPU +2.4/+3.5/+1.7 C at 512/1024/2048; GPU +0.4/-0.7/-0.3 C | `results/xiaomi_ab/task_a_4b_clean/battery_notes.txt:17,26,35,44,53,62,71,80,89,98,107,116` |
| `dumpsys thermalservice` in that run | - | stuck at 73.0/58.8/37.903 every cell, cached, not usable | `results/gpu_prefill_recheck_xiaomi/report.md` section 1 tail |
| NPU prefill vs CPU (not GPU) | prefill | `165.42 / 51.90` = **3.19x**; cell delta +1.3 C total = HTP +0.4 + CPU +0.9 | `results/htp_prefill/xiaomi_v75/cell1/NOTES.txt:35-45` and `battery_series.csv:2-6` |

### QDC reference boards (llama-bench, not in-app)

| board | phase | value | artefact |
|---|---|---|---|
| Adreno 732 (QRD7675, 7+ Gen 3) | prefill | GPU pp512 151.8 t/s | `scratchpad/agents/qdc-7pg3-govbench-52/REPORT.md` |
| Adreno 732 | prefill | FA kernels do not compile: missing `sub_group_shuffle_xor`, then a 1.68 GiB alloc failure and segfault | same report, Q1 exception |
| Adreno 740 (HDK8550) | prefill + decode | GPU pp512 84.1, tg128 16.0 (Q4_K_M) | `scratchpad/agents/qdc-8g2-oclpicks-53/REPORT.md` |
| Adreno 750 (QRD8650) | prefill + decode | GPU pp512 **284.18**, tg128 **23.42**; CPU 16.26 / 11.56 | `scratchpad/agents/qdc-8g3-govbench-55/REPORT.md` Q2 |
| Adreno 750, re-run | prefill + decode | GPU pp512 **291.11**, tg128 **23.02**; vs tuned CPU 98.97 -> prefill **2.94x**, decode GPU 0.80-0.82x | `scratchpad/agents/qdc-8g3-rerun-58/REPORT.md:29, 34, 48` |
| Adreno 750 correctness | - | MUL_MAT 905/925 (20 FAIL, all f16/bf16 batched view-K), MUL_MAT_ID 407/407 | `qdc-8g3-govbench-55/REPORT.md` Q1 and `qdc-8g3-rerun-58/REPORT.md` |
| Adreno 735 (QRD8635) | prefill + decode | GPU pp512 154.82, tg128 16.49; 925/925 and 407/407 | `scratchpad/agents/qdc-8s3-govbench-56/REPORT.md` |
| Adreno 830 (QRD8750, 8 Elite), crossbackend | prefill + decode | prefill ms GPU 1392.6 / CPU 16474.9 / governor 1430.5; decode t/s GPU 23.72 / CPU 21.59 / governor 25.28 | `scratchpad/agents/qdc-8elite-governor-crossbackend/REPORT.md:24-30` |
| Adreno 830, KEXP 17B MoE | prefill + decode | prefill 274.5 (GPU) vs 107.4 (CPU) = **2.56x**; decode 48.9 (GPU) vs 60.7 (CPU) = CPU **1.24x** | `scratchpad/agents/qdc-8elite-speed-kexp/REPORT.md:34-53` |
| Adreno 830, LFM2.5-8B-A1B | prefill | prefill 2.49-2.52 s (GPU/governor) vs 25.1-26.1 s (CPU), about 10x; commit 0.83-0.89 percent of prefill | `scratchpad/agents/qdc-8elite-governor-8b/REPORT.md` |
| in-app A/B on QRD8650 and 8 Elite | prefill + decode | run 4-6: GPU prefill points n=7, CPU A n=4; primary speed endpoint **NOT MET** (0 oracle-PASS pairs) | `scratchpad/agents/qdc-governor-s5b/REPORT.md` |

### Mali / Jelly

| what | status | artefact |
|---|---|---|
| Mali-G57 MC2, 2 CU, driver string on device | measured | `scratchpad/agents/q26-mali-gate/REPORT.md:5, 69` |
| Vulkan lane | every execute path SIGSEGV (rc 139) on first GPU buffer alloc; `vkGetBufferDeviceAddress` pfn NULL | `q26-mali-gate/REPORT.md` |
| OpenCL lane after portability patches | q4_0/q8_0/q6_K **SIGILL 132** on first dispatch; q4_K `CL_INVALID_WORK_GROUP_SIZE` (-54) | `scratchpad/agents/q26b-mali-probe/REPORT.md:218-221` |
| one green island | `MUL_MAT_ID` q8_0 75/75 correct | `q26b-mali-probe/REPORT.md` G3.5 |
| `GGML_OPENCL_ALLOW_UNKNOWN_GPU` | gone from the current engine: `grep -rn ALLOW_UNKNOWN_GPU` over `.cpp/.h/.md` returns nothing | ENGINE, verified by grep |
| owner decision | G57-class PARKED 2026-08-22 | plan Part 3.3, `archived/ALIVE-2026-09-full.md:445` |
| no tok/s | none exists; the quantised ship path aborts | plan Part 3.3 |
| thermal | `Thermal Status 3` (SEVERE) in 9 minutes from cold, battery 51 percent | plan Part 3.3, `archived/PLAN-2026-09-full.md:1603` |

**Prefill/decode warning, applied above:** the Xiaomi 3.18x is prefill; the 0.66x is decode. The 750 QDC 2.94x is prefill; decode on the same board is 0.80-0.82x (GPU slower). The 8 Elite KEXP 2.56x is prefill; the 1.24x is decode in the CPU's favour. No artefact in this list gives an in-app Xiaomi GPU decode win.

---

## 8. App-side signals the governor still lacks

| signal | where it would come from | can an unprivileged Android app read it | what the governor would do with it |
|---|---|---|---|
| CPU frequency cap vs hardware max (`scaling_max_freq / cpuinfo_max_freq`, the only visible throttling signal) | `/sys/devices/system/cpu/cpuN/cpufreq/scaling_max_freq` and `cpuinfo_max_freq`. The app already reads a sibling sysfs path in the same way: `/sys/devices/system/cpu/present` and `cpuN/cpu_capacity` via `readSysfsText` (`src/engine/threadProfile.ts:185-199, 254-278`) | **UNVERIFIED.** `cpu_capacity` is proven readable on the measurement devices; `scaling_max_freq` is normally world-readable but some vendor SELinux policies restrict it. Must be tested on each phone. What would settle it: one `expo-file-system` read of the path on the Xiaomi, S23 and Jelly, logged | A `headroom_cpu` in [0,1] per cluster. Today the governor has no notion of the vendor already throttling it. With it, the prefill table (`src/llama-governor-policy.cpp:196-211`) could reduce tokens before the OS does, instead of after |
| platform thermal status (`PowerManager.getCurrentThermalStatus()`) | Already available: `modules/kalsa-thermal/android/src/main/java/expo/modules/kalsathermal/KalsaThermalModule.kt:43-58`, surfaced through `src/engine/platformThermalStatus.ts:73-82` | **Yes**, already working (no permission needed) | Today it feeds only the hard stop: `readToHardGate` gates at CRITICAL=4 and above (`src/engine/thermalHardGate.ts:32-34, 49-51`), consumed at `src/app/AppShell.tsx:4007` and `:4659` and via `src/hooks/useThermalHardGate.ts:65`. SEVERE=2, which is what the Jelly reaches in 9 minutes, does **not** gate. The governor never sees it: `src/engine/governorInputs.ts` does not read it. It should drive the prefill chunk size and a declared pause, not only a total block |
| per-zone temperatures | `/sys/class/thermal/thermal_zoneN/temp`. The app reads zone0 only, advisory: `src/hooks/useThermalMonitor.ts:116-118` with `src/engine/thermalThresholds.ts` bands | **Partly verified.** zone0 is proven readable (the hook is live). Other zones are often SELinux-restricted on modern Android. UNVERIFIED for zones other than 0 | Diagnostics, and a faster signal than the battery. The plan is explicit that `thermal_zone0` is "an unknown / internal-like sensor, NOT a proven skin" (`src/hooks/useThermalMonitor.ts:6-8`), so it must not be promoted to a governor threshold without identifying the zone |
| GPU frequency or busy (`/sys/class/kgsl/kgsl-3d0/gpubusy`, `.../gpuclk`) | kgsl sysfs | **UNVERIFIED and likely no.** These nodes are commonly mode 0400 root on modern kernels, and the app has no run-as. The corpus' only `gpubusy` value is a hand-transcribed `~49%` already flagged PLAUSIBLE (unevidenced) (`scratchpad/agents/n10-kexp-audit/REPORT.md:42,79`); the plan's `~7.5%` baseline is UNSOURCED (recheck `REPORT.md:324-337`) | Proof that the GPU really ran, and attribution by time correlation. Without it, "the governor chose GPU" is only a log line from the app talking about itself |

Two further gaps worth naming because they are free:

- **The binding already has a device-probe API the app never calls.** `llamaGetBackendDevicesInfo` (`cpp/jsi/RNLlamaJSI.cpp:810-825`) returns `{backend, type, deviceName, maxMemorySize, metadata}` from `rnllama::backend_devices_info` (`cpp/rn-common.hpp:28-133`). It does **not** report the OpenCL driver version or a compile outcome, but it is the right place to add them. `grep -rn "getBackendDevicesInfo" src/` in the APP returns nothing.
- **The governor's own engine identity is already read.** `KALSA_NATIVE_VARIANT` logs `context.androidLib` and `nGpuLayers` (`src/engine/LlamaService.ts:2551-2558`), and `context.systemInfo` feeds `src/engine/engineIdentity.ts:24-40`. That is the natural carrier for a `gpu_probe` verdict without a new API.

---

## 9. Ordered implementation plan, with `file:line` and proof

The owner's order is: three surgical fixes, then the GPU probe, then the runtime probe, then the dead lanes. The plan below keeps that order and adds the prerequisites and the human decisions each step cannot resolve by itself.

### Step 1a - 5.2, because nothing else can be measured while the cable kills the governor

1. **Engine, 3 lines.** Reset the idle reference on unplug, in `update_thermal`, `src/llama-governor-policy.cpp:96-108`. Without it the latched baseline from the app invalidates on every replug.
   - Proof: extend `tests/test-governor-v02-router.cpp` (the `poll(...)` helper at `:19-27` already sets `t_idle_valid` and `t_idle_c`) with a `plugged(idle=35) -> unplugged -> plugged(idle=32)` sequence asserting the profile stays valid.
2. **Engine, comment.** State on `src/llama-ext.h:273` that `t_idle_c` is the latched plugged baseline.
   - Proof: review only.
3. **App, native module.** Return the baseline fields from `readThermo` (`android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt:40-68`): add `t_idle_valid`, `t_idle_c`, `trend_c_per_min`. Baseline = the temperature at the first sample with `plugged == true` after a sample with `plugged == false`, persisted under a new AsyncStorage key next to `kalsa.governor.enabled` (`src/engine/governorRuntime.ts:3`). Clear on unplug.
   - Proof: `src/engine/governorInputs.test.ts` (the mock at `:5-15` returns camelCase keys, so extend it) asserting that a plugged sample produces `t_idle_valid: true` and a stable `t_idle_c`; a second assertion that the value does not move while `battTempTenthsC` rises.
4. **App, JS.** Keep `src/engine/governorInputs.ts:158-177` as the single place that maps the module output to the profile; do not add a second defaulting site.
   - Proof: same test.
5. **Device.** Plug the cable, enable the governor, load the model, read `KALSA_GOVERNOR` from logcat: expect no `fallback_reason` and `thermo_source: "battery"`.
   - This is the cell that unblocks the runtime probe.

### Step 1b - 5.3

6. `src/llama-governor-runtime.cpp:65-68`: route by the requested engine (`prefill_route_ = requested == CPU ? prefill_route::CPU : prefill_route::GPU`) and set `stats_.prefill_engine` to the engine actually used.
   - Proof: a `FAST`-state, `batt_level_pct = 40` case in `tests/test-governor-v0-turns.cpp` asserting the decode context holds the KV (mirroring the existing `position_matches` checks at `:296-297`).
   - Note: `tests/test-governor-v0-turns.cpp:293-297` asserts `prefill_chunks == "cpu:305"` for the hot case, which is also where 5.1 lives; expect to rewrite both in one change.

### Step 1c - 5.1

7. `src/llama-governor-runtime.cpp:55-63` and `src/llama-governor-policy.cpp:196-211`: a heat refusal must reduce the chunk, not select the hot engine for the whole batch; if no safe chunk exists, return a declared pause.
   - Proof: a policy test asserting that a refusal at `now_c` above `k_limit_c` never returns `Admit` for the full batch; a runtime test tracing the route; on device, a `KALSA_GOVERNOR` line whose `prefill_chunks` shows the reduction and whose `prefill_ctx_ngl` matches the actual engine.
   - This is the change most likely to be argued about, because it decides what the user sees. See the human decisions below.

### Step 2 - the GPU probe

8. **Engine, remove the process kill.** `build_program_from_source` (`ggml-opencl.cpp:1397-1412`) must use `fatal=false` for the bulk set, and every non-fatal site must keep the `if (!prog) return false;` guard (pattern at `:5802-5805`, `:6286-6290`). The `exit(1)` at `:1364` and `:1390` then becomes unreachable from the app.
   - Proof: a host test that forces a compile failure (a deliberately broken kernel source under a test define) and asserts the process survives and the op falls back; on device, a killed `clBuildProgram` (inject a syntax error in a scratch build) without `exit(1)`.
9. **Engine, record the probe.** Extend the existing runtime cache rather than adding a subsystem: `cl_program_cache_init` (`cl-program-cache.cpp:307-340`) already keys on device and driver. Add an outcome record `{vendor, CL_DEVICE_NAME, CL_DRIVER_VERSION, CL_DEVICE_GLOBAL_MEM_SIZE, cl_khr_integer_dot_product, ok|fail, error log}` written beside the binaries. Cache invalidation is already correct: a driver change changes the key suffix (`cl-program-cache.h`).
   - Proof: a unit test over the key computation; on device, two loads, the second reading the cached verdict, then a driver-version bump invalidating it.
10. **Binding, expose it.** `backend_devices_info` (`cpp/rn-common.hpp:28-133`) already returns backend, type, device name and memory; add the driver version and the probe verdict. The JSI surface is already wired (`cpp/jsi/RNLlamaJSI.cpp:810-825`).
   - Proof: a JS test asserting the new fields arrive; the app log line `KALSA_NATIVE_VARIANT` (`src/engine/LlamaService.ts:2551-2558`) gains the verdict.
11. **App, consume it.** `gpuFit` (`src/engine/governorInputs.ts:84-121`) must return `NoFit` when the probe says the kernel set does not compile, and `src/engine/LlamaService.ts:2314-2327` already refuses `governorLoad` on `NoFit`.
   - Proof: a JS unit test feeding a failing probe; on device, a phone the kernels fail on stays on CPU with a `KALSA_GOVERNOR_FALLBACK` line and no process death.
   - Effort note: this step is larger than the plan's one-line summary. The honest minimum is items 8-9 (no more `exit(1)`, verdict recorded); item 10-11 makes it a governor input. Items 8-11 are the definition of "clean degradation" in section 4.

### Step 3 - the runtime probe on the Xiaomi

12. **Decide the GPU-activity signal first** (human, see below). If `gpubusy` is unreadable by the app, the probe must read a signal the engine already has: `stats_.prefill_ctx_ngl` (`src/llama-governor.cpp:59`), the grid split from the backend log, or per-turn prefill timing. The app already logs `prefill_ms`, `prefill_chunks`, `prefill_ctx_ngl` (`src/engine/LlamaService.ts:1762-1779`).
   - Proof: a Xiaomi session with the repaired APK showing `prefill_ctx_ngl: 99` and a timing that separates GPU from CPU, plus `gpubusy` leaving its baseline inside the prefill window if and only if the node is readable. If `gpubusy` stays flat while telemetry says GPU, the conclusion is "it engages but does not use the GPU", which must be written as a different result (plan Part 6.2).

### Step 4 - the dead lanes (5.4) and then 5.5, 5.6

13. Serialise `cool_delta_measured`, `kexp_cool_scope`, `cool_pays`, `cool_prefill_eligible`, and set `reload_budget_available` from measured commit telemetry, in `src/engine/governorInputs.ts:132-143`.
    - Proof: `src/engine/governorInputs.test.ts` asserting the keys and types; a device `KALSA_GOVERNOR` line with `engine_decode: "GPU"`.
14. Decide the `V73` clause (`src/llama-governor-policy.cpp:240`, `:167`). See the human decisions.
15. 5.5 (`src/llama-governor-runtime.cpp:96-99`) and 5.6 (`src/llama-governor.cpp:151-154`, `src/llama-governor-runtime.cpp:127-132`, `src/llama-governor-policy.cpp:44`), each with its test change at `tests/test-governor-v02-router.cpp:139-143`.

### What a human must decide, not discover

1. **What the user sees when the phone is too hot** (plan Part 8 item 2). Step 1c forces this: the choice is a slower answer, an honest line, or a declared pause. Today it is an exception.
2. **The speed floor** (plan Part 8 item 1): below how many tok/s is the cool engine unacceptable.
3. **Which generation may use the cool lanes** (step 4 item 14). The evidence on disk is S23/V73 only; opening it to V75/V79 is a decision about an unmeasured trade, not a code change.
4. **Whether the plugged idle baseline is latched at plug-in or learned from a quiet window** (section 2). Both are honest; they differ in code cost and in what happens when the user plugs in a hot phone.
5. **Whether the NPU returns** (plan Part 8 item 4). It is off in two places: `src/llama-governor-policy.cpp:152-172` has no NPU branch, and `cpp/rn-governor-params.cpp:150-151` throws if enabled.
6. **Whether the Jelly is a target or a corner case** (plan Part 8 item 5). `gpuFit` returns `NoFit` by RAM (`src/engine/governorInputs.ts:92`) and `Unknown` generation (`:93`); reversing either is a product decision.
7. **Who owns the `t_idle_c` contract** (app latch or engine redefinition), because steps 1a-3 and 1a-1 must land together to be coherent.

---

## What I could NOT verify, and what would settle it

| item | status | what would settle it |
|---|---|---|
| The app never calls `llamaGetBackendDevicesInfo` | verified by `grep -rn "getBackendDevicesInfo" src/` returning nothing in the APP tree at `6a58ef5`. I did not search the `archived/` or `scripts/` trees | a scoped grep over the whole app checkout including scripts |
| Whether the OpenCL kernel cache is actually enabled in the app | **UNVERIFIED**. `default_cache_dir()` on Android is the temp dir (`cl-program-cache.cpp:184-200`), and the header itself names the Android case where it self-disables | `adb logcat` for `ggml_opencl: kernel cache enabled at` versus `kernel cache disabled` on the Xiaomi and S23 |
| Whether `scaling_max_freq` and `cpuinfo_max_freq` are readable by an unprivileged app on our three phones | **UNVERIFIED**. The mechanism works (the app reads `cpu_capacity` the same way), the permissions do not follow | one `expo-file-system` read per phone, logged |
| Whether `kgsl-3d0/gpubusy` is readable by the app | **UNVERIFIED and probably no**; the plan's own baseline is UNSOURCED | a 60-sample trace from inside the app (not adb shell) on the Xiaomi |
| The exact failure mode the user hits with a plugged cable | both mechanisms exist in code: a thrown parser error (`cpp/rn-governor-params.cpp:155-157`), a thrown load error (`cpp/rn-llama.cpp:706-708`), and the engine sticky abort (`src/llama-governor.cpp:152`). Which one the app reports depends on call order, and I did not run the APK | one plugged-cable load on the S23 or Xiaomi with logcat, reading `KALSA_GOVERNOR_FALLBACK` and `KALSA_GOVERNOR_FALLBACK_RETRY` |
| Whether `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is ever defined in the app build | I read `android/src/main/rnllama/CMakeLists.txt:203-209` (not defined) and `android/src/main/CMakeLists.txt` (ENABLE_OPENCL only). I did not read the generated `build/` CMakeCache | `grep GGML_OPENCL_USE_ADRENO_BIN_KERNELS` in the app's generated build dir |
| Whether two phones reproduce the 5.5 remainder class in production | verified in code and in the policy table arithmetic; not observed on device | a 129-token prompt against the repaired APK |
| The QDC governor in-app results ("0 oracle-PASS pairs") | read from the s5b report; I did not read its raw TSVs | the raw `results.tsv` files under `scratchpad/agents/qdc-governor-s5b/raw/` |
| `governor-bench` is a host tool, not an app tool | verified: `tools/governor-bench/CMakeLists.txt:5` links `llama-common`/`llama`, and `cmake/rnllama-sources.cmake` does not include `tools/governor-bench` (only `tools/mtmd`) | already settled; recorded here so the probe is not designed as a bench tool |
| `forced` and `reason` are never read by the binding | verified by grep over the three binding files | already settled |
