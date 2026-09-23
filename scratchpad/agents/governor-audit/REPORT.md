# Independent review of the governor reconnaissance (current trees, re-anchored)

Read-only. No file outside this report was written. No device commands were run. English only.

## Trees and revisions actually read

| label | path | what I read |
|---|---|---|
| ENGINE | `/Users/marco/Projects/kalsallama` | checkout on `b11010-merge` at `8537d097c`; `main` = `2a290390d`. Governor files byte-identical between the checkout and `main` (`git rev-parse main:src/llama-governor-policy.cpp` = `22c03f522d52` = working tree hash). All citations below hold on `main`. |
| BINDING | `/Users/marco/Projects/llama.rn-kalsa` | checkout on `vendor-migration` at `0f313bab`; `main` = `0288dc27`. `cpp/rn-governor-params.cpp`, `cpp/rn-governor.cpp`, `cpp/rn-llama.cpp` are content-identical between the two (`git diff 0288dc27..0f313bab` on those files is empty) even though the branch histories diverged. |
| APP | `/Users/marco/Projects/kalsa` | `main`, HEAD moved twice while I read (mid-merge `57f410f`, then `e4e8005b`, merge since completed, working tree clean, no MERGE_HEAD, no conflict markers in `src/engine/`). `governorInputs.ts` (`4354eceb`), `governorRuntime.ts` (`52dc3574`), `deviceTuning.ts` (`87d34a27`) byte-stable across the moves; `LlamaService.ts` changed by comment-only hunks (max 2-line drift). |

**Single-version claim: CONFIRMED.** `src/llama-governor-policy.cpp` is blob `22c03f522d5211bc7b8750ce221591da327f0305` on every fork ref I checked (main, b11010-merge, kalsa-slot-and-metal, mtp-ctx-other, opencl-moe-masks, bump-rehearsal-tmp, and their origin counterparts) and in both non-engine copies (`vendor/llama.cpp/src/` in the binding, and the installed `node_modules/llama.rn/vendor/llama.cpp/src/`; `cmp` identical for policy, runtime, governor, header, and `llama-ext.h`). No divergent copy exists. The binding's `rn-governor-params.cpp` is likewise one blob (`38339009`) across all binding refs; `rn-llama.cpp` varies across old binding branches (kalsa, kalsa-step1, v0129), which does not affect this review because the refs named as canonical are identical.

The device plan and recon report were re-read at their new locations (`analysis/GOVERNOR-DEVICE-PLAN.md`, `scratchpad/agents/governor-gpu-recon/REPORT.md`); content matches what the review was scoped against.

---

## Verdict lines

**The six defects:**

- **5.1 CPU fallback above the threshold - CONFIRMED**, `src/llama-governor-runtime.cpp:53-64` routes a heat-refused turn whole and unsplit onto the CPU decode context; pinned by a passing test (see claim 2).
- **5.2 Charger poisons the governor - CONFIRMED**, with a corrected mechanism map: load-time it fires as a THROW in the binding parser (`cpp/rn-governor-params.cpp:155-157`) that the app silently converts into a CPU-only retry; mid-session it fires as the engine's sticky `Invalid` -> `fail()` latch reached through a `setGovernorThermo` call that only logs (`src/engine/LlamaService.ts:1728-1747`). The recon's third firing point (`cpp/jsi/RNLlamaJSI.cpp:1211-1213`) is dead code in the shipped app (finding N2).
- **5.3 Battery floor inverts the route - CONFIRMED**, `src/llama-governor-runtime.cpp:65-68`; triggered not only by `batt_level_pct < 45` but by the LOWBAT state too (finding N10).
- **5.4 Unreachable lanes - CONFIRMED**, `src/llama-governor-policy.cpp:238-242` (thirteen clauses, four never true in a shipped config), `:168-171` (prefill cool lane), plus the parser NPU throw (`cpp/rn-governor-params.cpp:150-152`) and a dead `NoHTP` rule (`:176-178`).
- **5.5 One-token remainder truncates the answer - CONFIRMED**, `src/llama-governor-runtime.cpp:96-99` returns -2, excluded from failure classification at `cpp/rn-governor.cpp:52` and `cpp/rn-llama.cpp:659`, and lands as a silent end of generation at `cpp/rn-completion.cpp:1680`.
- **5.6 CRITICAL has no exit - CONFIRMED**, policy recovery is real (`src/llama-governor-policy.cpp:118-121`) but the runtime latches `failed` (`src/llama-governor.cpp:50-52`, `:128-132`, `:151-156`, `:163-165`); `critical_exit = 34.0` is colder than `warm_exit = 36.0` (`:44`); `k_kill_c = 43.0` is subsumed and dead (`:68`, `:116`); a test locks the 34.0 boundary.

**Claims 2-6:**

- **Claim 2 (tests assert the bugs) - CONFIRMED.** Both cited tests exist and pass against the current code; a third test (`tests/test-governor-v02-router.cpp:216-228`) pins the *opposite* of the runtime on 5.5, which is a new finding (N6).
- **Claim 3 (GPU reachable only through the governor) - CONFIRMED for production**, with one bench-only exception the recon missed (`src/engine/engineParams.ts:94-110`, finding N5).
- **Claim 4 (5.2's real mechanism) - CONFIRMED in all parts**, with two sharpenings: the `rn-llama.cpp:706-708` throw is unreachable in the JSI path (the parser throws first), and the planned app-side fix has a tenths-vs-degrees unit trap neither document states (finding N3).
- **Claim 5 (the GPU `exit(1)`) - CONFIRMED.** Call path verified line by line; the on-disk program cache is keyed on device and driver and self-disables on Android's default temp directory - settled from code, one logcat line confirms which branch fires.
- **Claim 6 (five unverified items) - two are now settled from code** (ADRENO_BIN_KERNELS define, kernel-cache mechanism), one was mis-stated by the recon and is now settled from code (the exact plugged-cable failure), two genuinely need a device (`scaling_max_freq` readability, `gpubusy` readability).

---

## 1. The six defects, line by line

### 5.1 The CPU fallback above the threshold - CONFIRMED

Current code, `src/llama-governor-runtime.cpp:53-64`:

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
```

The refusal comes from the policy table: `src/llama-governor-policy.cpp:196-202` walks the table down while `now_c + k_cpu_delta_c[table-1] > k_limit_c` (with `k_limit_c = k_warn_c - 0.5f = 39.5`, `:10-11`); when the table is exhausted and the small-prompt exception at `:204-205` fails, `:211` returns `Wait`. The runtime's `return 0` at `:63` admits the batch whole; `src/llama-governor.cpp:190-191` then picks `ctx_decode` (`cpu_prefill = is_prefill && prefill_route_ == prefill_route::CPU`), which is the `n_gpu_layers = 0` context (`cpp/rn-llama.cpp:77`). The fallback engine for "too hot to run the table" is the CPU - the hottest engine per the plan's own measurements. Nothing in any tree changed under this defect; it is not fixed and it reproduces.

### 5.2 The charger poisons the governor - CONFIRMED, mechanism corrected and completed

Engine side, unchanged and exactly as the plan describes:

- `src/llama-governor-policy.cpp:60-63` - when `plugged`, the profile is valid only if `t_idle_valid && std::isfinite(t_idle_c) && t_idle_c + 1.0f < 42.0f`.
- `:90-95` - an invalid profile sets `state_ = Invalid`, `profile_valid_ = false`.
- `:188-193` - `admit_prefill` returns `Abort` for Invalid; `src/llama-governor-runtime.cpp:50-52` turns that into `fail("prefill admission aborted")`.
- `src/llama-governor.cpp:151-156` - `fail` sets the sticky `failed = true`; `:163-165` makes every later call return `fail("governor is failed")`.

App side, confirmed: `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt:41-71` (`readThermo`) returns exactly four keys - `battTempTenthsC`, `battLevelPct`, `plugged`, `sensorValid` (`:49-52`, `:63-66`) - never `t_idle_valid` / `t_idle_c` / `trend_c_per_min`. `src/engine/governorInputs.ts:166-167` defaults them to `false` / `0`. `src/engine/LlamaService.ts:2312-2325` gates `governorLoad` on `sensor_valid` only (not `t_idle_valid`), so an invalid plugged profile is sent. `native/GovernorBatteryModule.kt` is the same file (compare clean).

`t_idle_c` as a latched baseline, confirmed: when plugged, the whole threshold tuple is offset from it (`src/llama-governor-policy.cpp:42-51`: warm +3/+1, cool +4.5/+1.5, critical +7/+1, all capped at 42), the first plugged sample latches `t_idle_reference_c_` (`:97-100`), any later plugged sample drifting more than 1.5 C invalidates the profile (`:101-107`), and `hot_plugged_ = plugged && t_idle_c >= 37.5f` (`:112`). It is not the live battery temperature; feeding the live temperature would degenerate the classification (the recon's analysis is correct).

The firing order, corrected - there are two live mechanisms, not three:

1. **Load-time (plugged at load):** `parseGovernorLoadParams` (`cpp/jsi/RNLlamaJSI.cpp:634-637`) calls `parse_governor_params`, which throws `std::invalid_argument("governor: thermo profile invalid")` at `cpp/rn-governor-params.cpp:155-157`. The JSI surfaces it to JS; `isGovernorFallback` (`src/engine/governorRuntime.ts:35-45`) matches it (`governor.*invalid`), and `initWithGovernorFallback` (`:60-81`) retries CPU-only, logging only `KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}` to the console. The user loses the governor silently. **The throw at `cpp/rn-llama.cpp:706-708` is never reached in the JSI path** - parse at `RNLlamaJSI.cpp:636` throws before `loadModel` (`:707-710`) is ever called; `:706-708` is a redundant second gate for callers that bypass the parser (none exist in-tree).
2. **Mid-session (unplugged at load, cable plugged later):** the per-turn push `refreshGovernorBeforeCompletion` (`src/engine/LlamaService.ts:1715-1747`) calls `setGovernorThermo`; the JSI `llamaSetGovernorThermo` returns `false` (it does not throw - `cpp/jsi/RNLlamaJSI.cpp:843-846`); the app catches, logs `KALSA_GOVERNOR_THERMO {valid:false}`, and the completion proceeds. But the engine's policy is now `Invalid`, so the first decode of that completion hits `select_decode`'s Invalid branch -> `fail("decode admission aborted")` (`src/llama-governor-runtime.cpp:128-132`) or `admit_prefill`'s Abort -> `fail` (`:50-52`). The governor is dead for the life of the context, and nothing in the app notices (finding N1).
3. **Dead:** the completion-time throw `cpp/jsi/RNLlamaJSI.cpp:1211-1213` requires `governor_thermo` inside the completion params (`:1175-1180`); the app never sends that key (grep over `src/` and the installed `node_modules/llama.rn/src/`: zero hits). Unreachable in the shipped app.

Can the app fill it honestly? Yes, by latching the battery temperature on the plug-in edge (`GovernorBatteryModule.kt:57` reads `EXTRA_TEMPERATURE`, `:62` reads `EXTRA_PLUGGED` on the same sticky intent) and returning a session-stable value - that matches what the engine's 1.5 C drift check demands of a caller. But the engine must also reset the reference on unplug: `update_thermal`'s reference block (`src/llama-governor-policy.cpp:97-108`) runs only under `if (profile.plugged)` with **no else branch** - after an unplug, cooldown and replug inside one session, an honest new baseline trips `:101-107` and invalidates the profile. The three-line fix belongs exactly where the recon put it.

What a fix must change on each side, precisely:

- **APP:** extend `readThermo` (`GovernorBatteryModule.kt:41-71`) with `t_idle_valid` / `t_idle_c`; latch the baseline at the first plugged sample after an unplugged one; persist it (next to `kalsa.governor.enabled`, `src/engine/governorRuntime.ts:3`); clear on unplug; **convert tenths to degrees before sending** (finding N3). `src/engine/governorInputs.ts:158-177` stays the single mapping site.
- **ENGINE:** add the unplug reset at `src/llama-governor-policy.cpp:97-108`. For the mid-session case the fix is only complete if entering `Invalid` no longer latches `failed` (see 5.6) - otherwise the app-side fix still ends in a dead governor after any plugged push that raced a profile change.
- **BINDING:** no change strictly required - `governor_thermo_profile_is_valid` (`cpp/rn-governor-params.cpp:92-105`) duplicates the engine rule and passes once the app sends valid fields. Optional cleanup: delete the unreachable gates at `cpp/rn-llama.cpp:706-708` and `cpp/jsi/RNLlamaJSI.cpp:1211-1213`, or leave them as defense.

### 5.3 The battery floor inverts the route - CONFIRMED

`src/llama-governor-policy.cpp:152-157`: `prefill_engine()` returns CPU when the state is LOWBAT or `profile_.batt_level_pct < 45`. `admit_prefill` with `requested == CPU` and a table-fitting prompt returns `Admit` (`:220-221`, or the small-prompt path `:204-209`), which is neither `Wait` nor `CPUFallback`, so the runtime falls to `src/llama-governor-runtime.cpp:65-68`:

```cpp
65    if (prefill_route_ == prefill_route::Undecided) {
66        prefill_route_ = prefill_route::GPU;
67        stats_.prefill_engine = requested;
68    }
```

`prefill_route_ = GPU` while `stats_.prefill_engine = CPU`; `src/llama-governor.cpp:190-191` sends the batch to `ctx_prefill` (`n_gpu_layers = 99`, `cpp/rn-llama.cpp:76`). Telemetry says CPU; the KV lands on the GPU context. Additional detail the plan misses: the LOWBAT state (< 25%, `:122-123`) triggers the same inversion through the same `prefill_engine` line, so two distinct battery conditions invert the route. The floor is duplicated with a second effect in `select_decode` (`batt_level_pct >= 45`, `:238`).

### 5.4 Unreachable lanes - CONFIRMED

`select_decode`'s eligibility conjunction is at `src/llama-governor-policy.cpp:238-242` (behind the early-wait guard `:231-235`); counting the thirteen clauses: `valid_schema`, `have_profile_`, `profile_valid_`, `batt_level_pct >= 45`, `COOLMODE`, `!hot_plugged_`, `generation == V73`, `gpu_fit == Fit`, `cool_delta_measured`, `kexp_cool_scope`, `cool_pays != No`, `reload_budget_available`, `budget_ok`. Four can never be true in any shipped configuration:

| clause | why it is dead in a shipped config |
|---|---|
| `generation == V73` (`:240`) | the app enables the governor only for V75/V79 (`src/engine/governorInputs.ts:14-27`, `:130`; `V73: false` at `:25`), and a V73 phone never reaches the governor at all |
| `cool_delta_measured` (`:241`) | never serialised by the app; parser default false (`cpp/rn-governor-params.cpp:139`) |
| `kexp_cool_scope` (`:241`) | same, `:140` |
| `reload_budget_available` (`:242`) | app sends false (`src/engine/governorInputs.ts:140`); parser default also false (`cpp/rn-governor-params.cpp:125`) - note the native struct default is true (`src/llama-ext.h`, `reload_budget_available = true`), so the parser deliberately tightens it |

The same holds for the prefill cool lane `:168-171` (`generation == V73 && MoE && cool_prefill_eligible`, never sent, `cpp/rn-governor-params.cpp:138`) and the NPU lane (the parser throws on `npu_lane_enabled == true`, `cpp/rn-governor-params.cpp:150-152`, and `prefill_engine()` has no NPU branch at all, `:152-173`; the dead rule constants at `:207` and `:217` - `requested == NPU ? 2 : ...` - can never evaluate to 2). One more dead value: `prefill_rule()`'s `NoHTP -> 1` (`:176-178`) - the parser accepts the string (`:44`) but `generationFor` never returns it (`governorInputs.ts:62-75`). The plan's "the hot -> move decode to GPU lane is unreachable on every phone" is exactly right.

### 5.5 One-token remainder truncates the answer - CONFIRMED

`src/llama-governor-runtime.cpp:96-99`:

```cpp
96        const int32_t count = std::min<int32_t>(next.tokens, remaining);
97        if (count <= 1) {
98            return -2;
99        }
```

The policy produces `tokens == 1` for a 1-token remainder (`src/llama-governor-policy.cpp:203-209`: table exhausted, `prompt_tokens < k_table_tokens[0] && now_c + k_cpu_delta_c[0] <= k_limit_c` -> `result.tokens = prompt_tokens`, `Admit` for CPU / `CPUFallback` otherwise). So every prompt congruent to 1 modulo the accepted chunks (129, 257, 385, ... at cold temperature) reaches `count == 1` and the runtime refuses with -2 after earlier chunks of the same prompt have already been decoded. The -2 is explicitly excluded from governor-failure classification (`cpp/rn-governor.cpp:52`, `cpp/rn-llama.cpp:659`), propagates to `nextToken`'s decode loop, and is handled as a normal end of generation: `cpp/rn-completion.cpp:1680` logs `"failed to eval"`, resizes `embd`, sets `has_next_token = false`, and returns - the JS completion resolves with a truncated answer and no error. The plan's description ("the user sees the answer truncate with no error") is exactly what the code does.

### 5.6 CRITICAL has no exit - CONFIRMED

The policy recovery exists: `src/llama-governor-policy.cpp:118-121` leaves CRITICAL for FAST when `can_leave(now_ms, temp, limits.critical_exit)` (temp at or below the exit plus the 10-minute dwell, `:80-86`). The runtime makes it useless: at CRITICAL the first prefill Abort-fails (`:50-52`) and the first decode wait-fails (`src/llama-governor-runtime.cpp:128-132`); `fail` latches (`src/llama-governor.cpp:151-156`) and every later call returns `fail("governor is failed")` (`:163-165`); `rn_governor::decode` latches a second flag (`cpp/rn-governor.cpp:44-60`). Note this stickiness is documented as intended at `src/llama-ext.h:370-374` ("A decode, commit, or route failure is sticky: later calls keep failing rather than falling back") - the header comment and the device plan disagree about whether this is a defect, and a fix must update that contract comment.

The threshold inversion: unplugged tuple `return { 38.0f, 36.0f, 39.5f, 36.5f, 42.0f, 34.0f };` at `src/llama-governor-policy.cpp:44`, field order `warm_enter, warm_exit, cool_enter, cool_exit, critical_enter, critical_exit` (`src/llama-governor-policy.h:45-52`). So `critical_exit = 34.0 < warm_exit = 36.0`: leaving the worst state requires a colder phone than leaving the mild one. Plugged it is inverted differently: `critical_exit = t_idle + 1.0` equals `warm_exit` and is *colder* than `cool_exit = t_idle + 1.5` (`:47-49`). `k_kill_c = 43.0` (`:12`) is dead by construction in both `classify` (`:68`) and `update_thermal` (`:116`): the disjunct `temperature >= k_kill_c` is subsumed because `critical_enter` is at most 42.0 (`:44`, `:46-49`), so the kill clause can never be the binding one. `k_warn_c` (`:10`) feeds only `k_limit_c` (`:11`).

---

## 2. The tests that assert the bugs as correct - CONFIRMED

**Test 1, `tests/test-governor-v0-turns.cpp:293-297`** (`run_hot_cpu_prefill`): after pushing `batt_temp_tenths_c = 381` (38.1 C unplugged -> WARM) at `:273-281`, it decodes a 305-token prompt and asserts:

```cpp
293    const bool prompt_ok = prompt_rc == 0 && stats.prefill_engine == llama_governor_engine::CPU &&
294        stats.commit_bytes == 0 && stats.prefill_us > 0 &&
295        std::strcmp(stats.prefill_chunks, "cpu:305") == 0 &&
296        position_matches(llama_governor_get_decode_context(governor.get()), 304) &&
297        !position_matches(llama_governor_get_prefill_context(governor.get()), 304);
```

That is defect 5.1 (and the 5.3 telemetry lie, in the `cpu:` prefix written by `record_side` at `src/llama-governor.cpp:140`) written down as a PASS: a hot prefill must land whole on the decode context, engine label CPU. The chunk arithmetic at cooler temperature is pinned in the same file at `:192` (`"512+512+128+128+49"` for 1329 tokens at 35.0 C) and in the router test at `:227-228` (`305 -> 128+128+49`) - both consistent with the table walk at `now_c = 35`.

**Test 2, `tests/test-governor-v02-router.cpp:139-143`**:

```cpp
139    policy.update_thermal(poll(420), 0);
140    policy.update_thermal(poll(340), 10 * 60 * 1000);
141    check(policy.thermal_state() == llama_governor_thermal_state::FAST, "CRITICAL exits at the inclusive 34.0 boundary");
142    policy.update_thermal(poll(339), 20 * 60 * 1000);
143    check(policy.thermal_state() == llama_governor_thermal_state::FAST, "CRITICAL hysteresis width is 8.0");
```

The test names call the 42.0 -> 34.0 gap a "hysteresis width", same as the WARM (2.0, `:129-131`) and COOL (3.0, `:135-137`) widths - the inversion of the exit scale is asserted as design.

**What fixing the defects does to the tests:** rewriting 5.1/5.3 turns `governor_hot_cpu_prefill` red until `run_hot_cpu_prefill`'s assertions (`:293-304`, plus the decode-loop assertions at `:313-315` that pin `prefill_engine == CPU` and `commit_bytes == 0` for the whole turn) are rewritten to the new contract; fixing 5.6's threshold turns `:141-143` (and the plugged boundary test at `:116-117`, which pins `critical_exit = t_idle + 1.0`) red. The green suite goes red on purpose, exactly as the recon says.

**Other tests in the same pattern:**

- `tests/test-governor-v02-router.cpp:66-69` - "750 parity keeps CPU decode": pins the `generation == V73` cool-decode gate as correct for V75, i.e. the 5.4 closure of exactly the phones the governor runs on, as a named expectation.
- `:39-43` - "current ledger keeps NPU off" / "NPU defers to CPU": pins the NPU lane closed by construction (with `npu_lane_enabled = true` set, no less - the flag is inert at the policy level and the parser throws on it).
- `:163-169` - pins `hot_plugged_` refusal at idle 37.5, the unsafe-baseline refusal at idle 41.0, and "drifting plugged baseline invalidates profile" (`:169`). The last one pins the drift-invalidation mechanism - the mechanism that makes an honest replug impossible while `have_t_idle_reference_` is never reset. The test never exercises unplug-then-replug, so the gap itself is untested.
- `:106-110` - "KILL backstop precedes LOWBAT" asserts CRITICAL at 43.0, which makes the dead `k_kill_c` clause look load-bearing; it never is (subsumed by `critical_enter` at 42.0).
- `:191-193` and `:216-228` - the inverse inconsistency: the policy is pinned to *admit* a 1-token tail ("short final prompt tail is admitted under the smallest table bound"; "every GPU-requested remainder is admitted" over the 305 partition ending in 49 - and the loop admits a remainder of 1 the same way), while the runtime refuses exactly that remainder with -2. The policy contract and the runtime disagree, and the suite tests only the policy side.

No other governor test (`test-governor-v0*.cpp`, `test-governor-v0-commit`, `-devices`, `-hybrid`, `-mtp-hybrid`, `-shared-cells`) pushes a plugged profile or pins a hot-route; they are all unplugged (`sensor_valid`-only) fixtures.

---

## 3. The GPU is reachable only through the governor - CONFIRMED for production

1. `src/engine/deviceTuning.ts:366-397`: `resolveBackendPolicy` returns `{ kind: "emulator", ... }` for emulators, `{ kind: "gpu-metal", reason: "apple" }` on Apple (`:374`), and for every Android device falls through to `return { kind: "cpu-only", reason: "gpu-fit-gate-blind" };` at `:397` (the comment above it says exactly why: the RAM fit gate cannot see GPU memory).
2. `src/engine/deviceTuning.ts:851-859`: `nGpuLayersForBackend` maps `gpu-metal`/`gpu-opencl` to 99 and everything else to 0 - so Android gets 0. (Its `gpu-opencl` case is itself dead: the resolver never returns that kind - same unreachable-lane pattern as 5.4, finding N4.) Applied at `src/engine/LlamaService.ts:2394`; forced to 0 again on the governor-off path at `:2406-2408` and `:2427-2429`.
3. `cpp/rn-llama.cpp:76`: `prefill_params.n_gpu_layers = 99;` inside `load_governor_models` (mirrored into `owner.params.n_gpu_layers = 99` at `:140` after success); `:77` sets decode to 0. This is the only 99-layer context in the app.

One exception, missed by the recon: the bench override. `src/engine/engineParams.ts:94-110` allows `nGpuLayers > 0` on Android when the same override carries `flashAttn: "off"`. Production never passes an override, so the claim holds for the product; but the `KALSA_GPU_FALLBACK` retry (`LlamaService.ts:2595-2611`) is therefore not "dead on Android" absolutely - it is dead in production and reachable in bench arms.

**Consequence in one sentence:** with the governor off, no GPU path can run at all on Android in production - the two-context load is the only code that ever requests offload, so "the GPU path" and "the governor" are the same path, and a governor disabled by table, by `gpu_fit`, or by an invalid thermo profile means CPU-only with no alternative.

---

## 4. Defect 5.2's real mechanism - CONFIRMED (details under section 1, 5.2 above)

Every part of the claim checks out against current lines: the parser throw (`cpp/rn-governor-params.cpp:155-157`), the app catch-and-silent-CPU-retry (`src/engine/governorRuntime.ts:35-45`, `:60-81`; `src/engine/LlamaService.ts:2537-2539`, `:2642-2646`), `t_idle_c` as a latched plugged baseline that every plugged threshold is offset from rather than a live temperature (`src/llama-governor-policy.cpp:42-51`, `:97-112`), the honest fill path (latch on the plug-in edge - the raw readings are already in the same sticky intent, `GovernorBatteryModule.kt:57-62`), and the mandatory three-line engine change resetting `have_t_idle_reference_` on unplug (block `:97-108`, no else branch). Two corrections to the recon's version: the `rn-llama.cpp:706-708` throw never fires in the JSI path (the parser throws first), and the `RNLlamaJSI.cpp:1211-1213` completion throw is unreachable in the shipped app (`governor_thermo` is never sent per-completion) - the mid-session case actually reaches the engine's sticky latch, which is worse than a throw because the app has no detection for it (finding N1) and the planned app fix has a units trap (finding N3).

---

## 5. The GPU `exit(1)` - CONFIRMED

Ten `exit(1)` sites exist in `ggml/src/ggml-opencl/ggml-opencl.cpp` (31318 lines): `:1364, :1390, :1427, :1438, :3613, :6416, :6434, :6445, :6458, :30862`. (The recon wrote "nine" and listed ten numbers.)

**The reachable class, verified end to end:**

- `ggml_backend_opencl_buffer_type_alloc_buffer` starts at `:13976`; on the first buffer it runs `cl_program_cache_init` (`:13978-13981`) and `load_cl_kernels(backend_ctx)` (`:13983`).
- `load_cl_kernels` (`:1508`) builds the bulk kernel set through `build_program_from_source` (`:1397-1412`), which tries the on-disk cache and otherwise calls `build_program_from_source_ex(..., /*fatal=*/true)` (`:1409`).
- In `build_program_from_source_ex`, a failed `clBuildProgram` (after transient-failure retries) reaches `if (fatal) { exit(1); }` at `:1364`; a failed `clCreateProgramWithSource` reaches the guarded `if (fatal) exit(1);` at `:1390`.

**What the user sees:** the process exits - a clean `exit(1)`, not a signal. No JS exception, no RN error boundary, no crash dialog, no fallback, no retry: the app silently disappears into the launcher, and the only trace is the native log line `"ggml_opencl: kernel compile error (err=...)` printed just before the exit (`:1381-1386`). `exit()` bypasses every try/catch and destructor-based cleanup above it.

**What clean degradation must do instead** (the recon's contract is right; I verified each anchor): compile the bulk set with `fatal=false` like the flash-attention variants already do (`:5802-5805`, `:6286-6290`, both `build_program_from_source_ex(..., /*fatal=*/false, ...)` immediately followed by `if (!prog) { return false; }`); guard every null program before `clCreateKernel` so `CL_CHECK` -> `GGML_ASSERT(0)` -> `abort()` (`:67-73`) cannot turn the same failure into a SIGABRT one line later; mark the (device, driver) pair unusable so `supports_op` keeps affected ops on CPU; record the verdict keyed like the program cache keys its binaries; and surface it to the app so `gpu_fit` becomes `NoFit` and the existing CPU-only load path takes over with a `KALSA_GOVERNOR_FALLBACK` line.

**The other sites, re-verified not reachable in-app:** `:1427`/`:1438` are in `build_program_from_binary`, whose callers are all behind `use_adreno_bin_kernels()` - compile-time `false` unless `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is defined (`:1497-1505`); the app build does not define it (section 6.5). `:3613` and `:30862` fire only when `gpu_family` is neither ADRENO nor INTEL, and `ggml_opencl_is_device_supported` (`:6609-...`) refuses any device whose name/version lacks Adreno/Qualcomm/Intel before registration, so such a family never reaches kernel loading. `:6416`/`:6434`/`:6445`/`:6458` fire only on `GGML_OPENCL_PLATFORM`/`GGML_OPENCL_DEVICE` env values (`:6397-6398`), which an Android app does not set. The comment "delay kernel loading until the first buffer is created" is at `:6895-6896`.

**The on-disk program cache - settled from code:**

- Keyed on device and driver: yes. `compute_key_suffix` (`cl-program-cache.cpp:221-236`) folds `CL_DEVICE_NAME`, `CL_DRIVER_VERSION`, `CL_DEVICE_VERSION`, `CL_PLATFORM_VERSION` and the format version into every key; the key spec is documented in `cl-program-cache.h:17-24`. A driver change invalidates the cache by construction.
- Android default directory: `default_cache_dir()` (`:184-200`) on non-Windows/non-Apple uses `fs::temp_directory_path()`; the comment at `:190-192` names the Android case itself ("aborting overload ... Android app contexts with TMPDIR unset; an empty return here just disables the cache instead"). With no `TMPDIR` in an app's environment, `temp_directory_path` falls back to `/data/local/tmp`, which an unprivileged app uid cannot create files in; `make_dir_recursive` then fails and `cl_program_cache_init` logs `"kernel cache disabled (cannot create directory ...)"` and returns an empty state (`:327-334`) - the cache self-disables and every kernel compiles from source. Nothing in the binding or app sets `TMPDIR` or `GGML_OPENCL_KERNEL_CACHE_DIR` (grep over `cpp/`, app `src/`: zero). The one logcat line that confirms which branch fires on a given phone: `ggml_opencl: kernel cache enabled at '...'` versus `ggml_opencl: kernel cache disabled ...`.

---

## 6. The five unverified items

1. **Kernel-cache state in the app** - settled from code as far as code can: enabled by default, self-disabling under the Android temp-directory conditions (section 5). The residual device question is only which of the two log branches actually fires; settled by `adb logcat | grep "kernel cache"`.
2. **`scaling_max_freq` / `cpuinfo_max_freq` readability from an unprivileged app** - genuinely a device question. The mechanism is proven in the same tree: `src/engine/threadProfile.ts:185-199` (`readSysfsText` via expo-file-system) already reads `/sys/devices/system/cpu/present` and per-core `cpu_capacity` (`:254`, `:276`) in production. Settle with one `readAsStringAsync` of `/sys/devices/system/cpu/cpu7/cpufreq/scaling_max_freq` and `cpuinfo_max_freq` per phone, logged.
3. **`gpubusy` readability** - genuinely a device question; nothing in the code reads kgsl nodes today. Settle with a 60-sample in-app (not adb-shell) read of `/sys/class/kgsl/kgsl-3d0/gpubusy`.
4. **The exact plugged-cable failure a user sees** - now settled from code (it was not, by the recon): plugged at load = parser throw -> silent CPU-only retry, logged only as `KALSA_GOVERNOR_FALLBACK_RETRY {ok:true}`; plugged mid-session = silent sticky governor death after `KALSA_GOVERNOR_THERMO {valid:false}`, with the turn (and every later turn) ending in truncated/empty output and no JS error. A device run would only confirm these log lines; the code decides the behavior.
5. **Whether `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` enters the app build** - settled: no. The installed binding's `android/src/main/rnllama/CMakeLists.txt` defines only `GGML_USE_OPENCL`, `GGML_OPENCL_USE_ADRENO_KERNELS`, `GGML_OPENCL_EMBED_KERNELS`, `GGML_OPENCL_SOA_Q`, `GGML_OPENCL_TARGET_VERSION=300` for the OpenCL variant (`:203-209`); `android/build.gradle` passes no extra defines (its `cmakeArgs` are page-size/STL/variant/Hexagon-SDK only, `:146-160`); and the expo plugin's `enableOpenCLAndHexagon` (`app.config.js:98`) only injects `libOpenCL.so` into the AndroidManifest (`node_modules/llama.rn/lib/commonjs/expo-plugin/withLlamaRN.js:76-90`). The define is compile-time absent, so `build_program_from_binary` and its two unconditional `exit(1)`s are dead in the app build. No generated-build-dir grep needed.

---

## NEW FINDINGS (what the reconnaissance missed), ordered by severity

**N1 (high) - Mid-session plug-in kills the governor for the rest of the session and nothing in the app detects or recovers it.** Chain: `LlamaService.ts:1728-1747` logs `KALSA_GOVERNOR_THERMO {valid:false}` and continues; the policy is `Invalid` (`llama-governor-policy.cpp:90-95`); the first decode of that or the next completion fails sticky (`llama-governor-runtime.cpp:50-52`/`:128-132` -> `llama-governor.cpp:151-156`); subsequent decodes return -1 through `rn_governor::decode` (`cpp/rn-governor.cpp:44-60`) and `nextToken` ends generation silently (`cpp/rn-completion.cpp:1680`). The app never calls `governorFailed()` (grep over `src/`: zero), the stats struct carries no `failed`/`failure_reason` (`src/llama-ext.h:317-359`), and `KALSA_GOVERNOR` telemetry (`LlamaService.ts:1770-1783`) cannot show it. User-visible: every turn after the plug-in produces empty or truncated answers with no error until a full engine reload. Neither the plan nor the recon describes this end-to-end.

**N2 (high) - Two of the recon's 5.2 "firing points" are dead code in the shipped app.** `cpp/jsi/RNLlamaJSI.cpp:1211-1213` requires `governor_thermo` in completion params; the app never sends it (`governorThermoProvided` is always false, `:1175-1180`). `cpp/rn-llama.cpp:706-708` sits after the parser that already threw (`RNLlamaJSI.cpp:636`). Only the parser throw (`rn-governor-params.cpp:155-157`) and the engine latch are live. This matters for sizing the fix: the binding needs no new behavior for 5.2, the app and the engine do.

**N3 (medium-high) - Unit trap in the planned 5.2 fix: `t_idle_c` is degrees C, the app's raw reading is tenths.** `GovernorBatteryModule.kt:63` returns `EXTRA_TEMPERATURE` (tenths); the engine compares `t_idle_c + 1.0f < 42.0f` (`llama-governor-policy.cpp:63`) and `t_idle_c >= 37.5f` (`:112`) in degrees. A naive latch of `battTempTenthsC` (e.g. 350 for 35.0 C) sends 350 "degrees": the gate rejects it (fail-closed, plugged governor permanently off), and any mislatched value below 41 would instead be read as a near-freezing baseline, dragging every plugged threshold to single-digit C and classifying every plugged turn CRITICAL -> Abort. The fix must divide by 10 exactly once, and the engine-side comment declaring `t_idle_c` a latched baseline in degrees C (`src/llama-ext.h`, `llama_governor_thermo_profile`) should say so.

**N4 (medium) - `nGpuLayersForBackend`'s `gpu-opencl` case is unreachable** (`src/engine/deviceTuning.ts:851-859`): `resolveBackendPolicy` never returns `kind: "gpu-opencl"` (its only returns are emulator, gpu-metal, cpu-only, `:370-397`). Same unreachable-lane pattern as 5.4, one tree over; whoever fixes 5.4 should sweep this too.

**N5 (medium) - The `KALSA_GPU_FALLBACK` retry is not universally dead on Android, only in production.** `src/engine/engineParams.ts:94-110` lets the bench override set `n_gpu_layers > 0` on Android when the same override has `flashAttn: "off"`, which makes `LlamaService.ts:2595-2611` reachable in bench arms. The recon's "cannot fire on Android today because n_gpu_layers is never > 0 on that path" needs that qualifier.

**N6 (medium) - The test suite pins the opposite of the runtime on 5.5.** `tests/test-governor-v02-router.cpp:191-193` ("short final prompt tail is admitted under the smallest table bound") and `:216-228` ("every GPU-requested remainder is admitted", over a partition loop that admits a remainder of 1) assert the policy admits 1-token tails; `src/llama-governor-runtime.cpp:96-99` refuses them. A 5.5 fix aligns the runtime with what the tests already demand of the policy - useful to know when arguing the change.

**N7 (medium-low) - Telemetry can actively mislead after a latch.** `llama_governor_stats` has `thermal_state` but no failed flag (`src/llama-ext.h:317-359`); after a CRITICAL latch with later cooldown, `update_thermal` reclassifies the state to FAST (`llama-governor-policy.cpp:118-121`) while the governor is dead, so `KALSA_GOVERNOR` lines report a healthy state and `engine_prefill/engine_decode` from a corpse. Add `failed`/`failure_reason` to stats (or expose `governorFailureReason()` - the binding already has the accessor, `cpp/rn-llama.cpp:678-680`) and consume it in `emitGovernorTelemetry`.

**N8 (low) - `valid_schema` pins `admission_margin_c` to exactly 0.5**, `src/llama-governor-policy.cpp:17-19` (`std::fabs(... - 0.5f) < 0.0001f`). The field parses as a free parameter (`rn-governor-params.cpp:142-143`) but any value other than 0.5 silently disables every acceleration lane (schema-invalid -> CPU prefill, decode gate closed). The recon noted the defaults; the exact-equality pin is the sharper fact: the knob does not exist in practice.

**N9 (low) - LOWBAT also triggers the 5.3 inversion.** `prefill_engine()` returns CPU under the LOWBAT state (`llama-governor-policy.cpp:153-156`), not only under `batt_level_pct < 45`; the same runtime block (`:65-68`) then routes GPU. The plan's 5.3 names only the percentage floor. The fix site is the same; the test matrix should cover both.

**N10 (low) - Recon citation drift (substance unaffected).** `k_flip_window_ms` is at `llama-governor-policy.cpp:9`, not `:6`; the `exit(1)` count is ten, not nine (its own list has ten numbers); the turns-test assertion block is `:293-297` (recon's table says `:293-297` in one place, `:293-297` body confirmed, header table `:141-147` for the router test is `:139-143`); `rn-llama.cpp` load params line is `:2400` not `:2402`, fallback-reason lines `:2537-2539`/`:2642-2646`. All off-by-small; none changes a verdict.

**N11 (info) - Code and plan disagree about the same fact in two recorded places.** (a) Stickiness: the plan calls the latch a defect (5.2/5.6); `src/llama-ext.h:370-374` documents "later calls keep failing rather than falling back" as the contract. (b) Thresholds: the plan calls `critical_exit = 34.0` an inversion; `tests/test-governor-v02-router.cpp:141-143` names the 8.0 gap a hysteresis width. A fix that lands either change must rewrite the contract comment and the test names in the same commit, or the next reader inherits two sources of truth.

**N12 (info) - Bench-skin asymmetry.** The AsyncStorage bench thermo (`kalsa.bench.thermo`, `src/engine/governorInputs.ts:179-188`) can inject a full profile including `t_idle_valid`/`t_idle_c`, so plugged+governor is reachable today in bench runs and unreachable in production. Useful for measuring 5.2's fix; also a way to accidentally benchmark a configuration production can never enter.

---

## Per-defect table: what a fix must touch

| defect | repo | file:line | change |
|---|---|---|---|
| 5.1 | ENGINE | `src/llama-governor-runtime.cpp:53-64` | a heat refusal must not route the whole turn to the hot engine; reduce tokens or declare a pause |
| 5.1 | ENGINE | `src/llama-governor-policy.cpp:196-214` | the table walk must return a reduced chunk; a declared pause when no safe chunk exists |
| 5.1 | ENGINE | `tests/test-governor-v0-turns.cpp:288-320` | rewrite `run_hot_cpu_prefill` (assertions `:293-297`, decode loop `:313-315`) |
| 5.2 | APP | `android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt:41-71` (+ the `native/` copy) | return `t_idle_valid` / `t_idle_c` (degrees, converted from tenths) |
| 5.2 | APP | `src/engine/governorInputs.ts:158-177` (+ a new latch store next to `governorRuntime.ts:3`) | map the fields; latch at the plug-in edge; clear on unplug |
| 5.2 | ENGINE | `src/llama-governor-policy.cpp:97-108` | reset `have_t_idle_reference_` on unplug (3 lines) |
| 5.2 | ENGINE | `src/llama-governor.cpp:50-52`, `:128-132`, `:151-156` | an `Invalid` profile must not latch `failed` (pairs with 5.6) or mid-session plug still dead-ends |
| 5.2 | BINDING | optional cleanup: `cpp/rn-llama.cpp:706-708`, `cpp/jsi/RNLlamaJSI.cpp:1211-1213` | delete or keep-as-defense the two unreachable gates |
| 5.3 | ENGINE | `src/llama-governor-runtime.cpp:65-68` | route by the requested engine; make `stats_.prefill_engine` name the context actually used |
| 5.3 | ENGINE | `tests/test-governor-v0-turns.cpp` | add a 40%-battery / LOWBAT case asserting the decode context holds the KV |
| 5.4 | ENGINE | `src/llama-governor-policy.cpp:240`, `:168-171` | decide the generation clause (human decision; S23/V73 is the only cool-mode evidence) |
| 5.4 | APP | `src/engine/governorInputs.ts:132-143` | serialise `cool_delta_measured`, `kexp_cool_scope`, `cool_pays`, `cool_prefill_eligible`, derive `reload_budget_available` from commit telemetry (`src/llama-governor.cpp:104-117`) - or drop the clauses |
| 5.4 | BINDING | `cpp/rn-governor-params.cpp:150-152` | replace the NPU hard throw only if the NPU lane returns (owner decision; `prefill_engine()` needs an NPU branch too) |
| 5.5 | ENGINE | `src/llama-governor-runtime.cpp:96-99` | merge a 1-token remainder into the previous chunk or admit it as a single-token step (the policy already admits it) |
| 5.5 | ENGINE | `tests/test-governor-v0-turns.cpp` | add 129/257/385-token prompts asserting no -2 and a complete decode |
| 5.6 | ENGINE | `src/llama-governor.cpp:151-156`, `:128-132`, `:50-52` | a CRITICAL wait is a pause, not a fail; `failed` recoverable for states that can clear |
| 5.6 | ENGINE | `src/llama-governor-policy.cpp:44` (and the plugged tuple `:47-49`) | restore an ordered exit scale (`critical_exit > cool_exit > warm_exit`) |
| 5.6 | ENGINE | `src/llama-ext.h:370-374` | update the documented stickiness contract |
| 5.6 | ENGINE | `tests/test-governor-v02-router.cpp:139-143`, `:116-117` | rewrite the boundary/width assertions |
| GPU exit(1) | ENGINE | `ggml/src/ggml-opencl/ggml-opencl.cpp:1409` (+ `:1364`, `:1390`) | bulk builds `fatal=false`; keep the `if (!prog) return false;` guard at every new non-fatal site (pattern `:5802-5805`, `:6286-6290`) |
| GPU probe | ENGINE | `ggml/src/ggml-opencl/cl-program-cache.cpp` (reuse `compute_key_suffix`, `:221-236`) | record the compile verdict keyed on (device, driver) beside the binaries |
| GPU probe | BINDING / APP | `cpp/rn-common.hpp` (`backend_devices_info`) -> `src/engine/governorInputs.ts:84-121` | expose the verdict; `gpuFit` returns NoFit on fail; `LlamaService.ts:2312-2325` already refuses governor load on NoFit |

## What only a device can settle

1. Whether `scaling_max_freq` / `cpuinfo_max_freq` are readable by the app on each of the three phones (one expo-file-system read each, logged).
2. Whether `gpubusy` / `gpuclk` are readable in-app (60-sample trace from inside the app, not adb shell).
3. Which OpenCL kernel-cache branch fires in-app: `logcat` for `ggml_opencl: kernel cache enabled at` versus `kernel cache disabled` (the code guarantees self-disable under the default temp dir; the log names the branch).
4. A live reproduction of 5.5 (a 129-token prompt) and of the mid-session plug sequence (`KALSA_GOVERNOR_THERMO {valid:false}` followed by a silently empty answer) - the code decides the behavior; the run confirms the log signature and shows what a user actually experiences.
5. Whether any current (device, driver) pair actually fails the kernel compile (the E031 miscompile class) - until one does, the `exit(1)` path is reachable but not known-fireable in the fleet.
