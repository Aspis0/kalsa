# Hostile audit — router/governor v0.2

**Scope**: commits `f7bb1369a`, `e5adc86ab`, `06171a51f` on `kalsa/governor-v0.2`
**Diff base**: `204e78259` → `06171a51f`
**Date**: 2026-09-04

---

## 1. Bugs

### 1.1 LOWBAT is a trap state — no exit path

`src/llama-governor-policy.cpp:118-119` sets `state_ = LOWBAT` when `batt_level_pct < 25`. The if-else chain in `update_thermal()` (lines 112–137) has no `state_ == LOWBAT` branch. Once entered, the only escape is a CRITICAL re-entry (temp ≥ 43). Battery recovery to ≥ 25% falls through all branches without matching, and `state_` stays LOWBAT.

**Scenario**: Battery drops to 20% → LOWBAT. Battery charges to 80%. Governor still reports LOWBAT, still CPU-locked by the 45% floor in `prefill_engine()` (`llama-governor-policy.cpp:147`), but `prefill_engine()` explicitly checks for `LOWBAT` at that line — which means it would be CPU even without the floor. The state machine is wrong regardless.

**Verdict**: **CONFIRMED** — permanent trap state on battery recovery.

### 1.2 CRITICAL exit uses strict `<` where spec says `≤`

`src/llama-governor-policy.cpp:80-82`:
```cpp
bool llama_governor_policy::can_leave(int64_t now_ms, float temperature, float exit_temperature) const {
    return temperature < exit_temperature && now_ms >= state_since_ms_ && now_ms - state_since_ms_ >= k_dwell_ms;
}
```

Spec §3.3 CRITICAL exit: "unplugged ≤34.0 °C; plugged ≤T_idle+1.0 °C". At exactly 34.0 °C unplugged, or exactly T_idle+1.0 plugged, `can_leave` returns false.

**Scenario**: Device cools to exactly 34.0 °C after a 10-minute soak. Code stays CRITICAL. Spec says exit.

Test `test-governor-v02-router.cpp:138-139` explicitly asserts this divergence:
```cpp
policy.update_thermal(poll(340), 10 * 60 * 1000);
check(policy.thermal_state() == llama_governor_thermal_state::CRITICAL, "CRITICAL exit is strictly below 34.0");
```
The test name says "strictly below" — testing the code, not the spec.

**Verdict**: **CONFIRMED** — spec/code divergence, test encodes the wrong behavior.

### 1.3 `decode_baseline_*` not set when tally never closes

`src/llama-governor-runtime.cpp:9-22`:
```cpp
void llama_governor::record_tally() {
    const auto tally = prefill_tally_.snapshot(telemetry_);
    ...
    if (tally.closed) {
        stats_.decode_baseline_cpu_us = tally.post.cpu_us;
        ...
    }
}
```

`decode_impl` at `src/llama-governor.cpp:170-175`:
```cpp
if (is_prefill && last_phase != phase::Prefill) {
    prefill_tally_.begin(telemetry_);
} else if (!is_prefill && last_phase == phase::Prefill) {
    prefill_tally_.end(telemetry_);
    record_tally();
}
```

If the session starts with decode (no preceding prefill), `prefill_tally_` is never begun, `record_tally()` is only called on the prefill→decode transition, so `decode_baseline_*` fields are zero. If the user only ever runs decode (rare but legal), the baseline is permanently zeroed — no delta computation is possible.

**Verdict**: **PLAUSIBLE** — edge case; in practice prefill always precedes decode, but the API doesn't enforce it.

### 1.4 `admit_prefill` always uses CPU thermal delta

`src/llama-governor-policy.cpp:186`:
```cpp
while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) {
```

The thermal admission check always uses `k_cpu_delta_c` regardless of the `requested` engine. For R5 GPU prefill on v75 (which is active in the spec), the admission uses CPU thermal impact, not GPU. If GPU prefill has different thermal characteristics, the admission is incorrect.

The spec §3.4 table only provides CPU and NPU deltas — no GPU delta exists. So the code is arguably correct by omission, but the admission path for GPU requests (`requested == GPU`) goes through the same CPU-delta loop, meaning GPU prefill admission is conservatively throttled by CPU thermal budget. This is safe but undocumented.

**Verdict**: **PLAUSIBLE** — conservative by design, but no spec text justifies it.

### 1.5 `k_warn_c` is dead code

`src/llama-governor-policy.cpp:10`:
```cpp
constexpr float k_warn_c = 40.0f;
```

Used only to compute `k_limit_c` on line 11. Never referenced directly. Harmless but the constant implies a WARN state that doesn't exist in the state machine.

**Verdict**: **REFUTED** (as a bug) — dead code only.

---

## 2. Race conditions

### 2.1 `telemetry_` written and read without synchronization

`src/llama-governor.h:62`: `llama_governor_counter_sample telemetry_` — plain struct, no mutex, no atomic.

`src/llama-governor-runtime.cpp:142-143` `record_telemetry()`:
```cpp
void llama_governor::record_telemetry(const llama_governor_telemetry_sample & sample) {
    telemetry_ = { sample.cpu_us, sample.read_bytes, sample.read_us, sample.stall_us, sample.management_us };
```

`src/llama-governor.cpp:171` `decode_impl()`:
```cpp
    prefill_tally_.begin(telemetry_);
```

`src/llama-governor.cpp:173` `decode_impl()`:
```cpp
    prefill_tally_.end(telemetry_);
```

If `record_telemetry()` is called from a background telemetry thread while `decode_impl()` reads `telemetry_`, this is a data race (undefined behavior under C++11). The spec's stall hooks (`stall_enter`/`stall_exit`) are explicitly designed for cross-thread use (that's why `stall_union_` has a mutex). The absence of synchronization on `telemetry_` is inconsistent with the threading model the stall hooks imply.

**Verdict**: **CONFIRMED** — `telemetry_` is unprotected while `stall_union_` is protected. Either both need locks or the threading model needs documentation.

### 2.2 `set_thermo_profile` races with `decode_impl` on `policy_`

`src/llama-governor-runtime.cpp:125-139` `set_thermo_profile()`:
```cpp
    const bool ok = policy_.update_thermal(profile, now_ms);
```

`src/llama-governor.cpp:164` `decode_impl()`:
```cpp
        const int32_t policy_rc = is_prefill ? admit_prefill(batch, allow_chunking) : select_decode();
```

`llama_governor_policy` has no internal synchronization. If `set_thermo_profile()` is called from a timer thread while `decode_impl()` is mid-execution, `policy_.state_`, `policy_.profile_`, etc. can be torn.

**Verdict**: **CONFIRMED** — `policy_` is not thread-safe. The intended use case (thermal poll from timer, decode on main thread) is a data race.

### 2.3 `stall_union_` IS properly synchronized

`src/llama-governor-metrics.cpp:76-88`: `stall_union_` wraps its state in `std::mutex`. ✓

But `stall_union_` is called from `llama_governor::stall_enter/exit` which are public methods. These ARE thread-safe. This is the only correctly synchronized shared state in the governor.

**Verdict**: **REFUTED** — stall_union is not racy. Everything else is.

---

## 3. Spec conformance (§3.3–3.5 line-by-line)

### 3.1 §3.3 Poll and state transition — CRITICAL exit threshold (§1.2 above)

Spec: "unplugged ≤34.0 °C; plugged ≤T_idle+1.0 °C, plus 10-min soak"
Code: strict `<` in `can_leave()`. Divergence confirmed.

### 3.2 §3.3 LOWBAT transition (§1.1 above)

Spec: "exit when battery is safe"
Code: no exit from LOWBAT. Divergence confirmed.

### 3.3 §3.3 CRITICAL→FAST exit action

Spec §5: "CRITICAL or KILL backstop → abort immediately; kill children, drop HTP, and re-derive at the next load"
Code `src/llama-governor-policy.cpp:114-117`:
```cpp
    } else if (state_ == llama_governor_thermal_state::CRITICAL) {
        if (can_leave(now_ms, temp, limits.critical_exit)) {
            state_ = llama_governor_thermal_state::FAST;
        }
```

CRITICAL exits to FAST — normal operation resumes. Spec §5 says "re-derive at the next load", implying session termination. The §3.3 exit condition defines *when* to leave CRITICAL but not *what state to enter*. FAST is reasonable but undocumented.

**Verdict**: **PLAUSIBLE** — spec is ambiguous about post-CRITICAL state; code behavior is sane but undocumented.

### 3.4 §3.4 Prefill admission — NPU fallback rule

Spec §3.4 order 2: "candidate is NPU → defer in v0.2; select CPU"
Code `src/llama-governor-policy.cpp:195`:
```cpp
    result.rule = requested == llama_governor_engine::NPU ? 2 : requested == llama_governor_engine::CPU ? 9 : 3;
```

NPU request → rule 2, engine stays CPU (set at line 173). Decision is `CPUFallback` (line 201) because `requested != CPU`. This correctly defers NPU to CPU with the right rule number. ✓

### 3.5 §3.5 Decode placement — `cool_pays::Unknown` passes as eligible

Spec §3.5: "cool_pays() == false → cpu"
Code `src/llama-governor-policy.cpp:220`:
```cpp
        params_.cool_pays != llama_governor_cool_pays::No && params_.reload_budget_available && budget_ok;
```

`cool_pays::Unknown` is not `No`, so it passes. The design study says "until measured, the interim rule is to switch when an eligible COOL entry is reached", which would make Unknown = eligible. The spec's "cool_pays() == false → cpu" only gates the `No` value.

**Verdict**: **PLAUSIBLE** — design study supports the code; spec wording is imprecise.

### 3.6 §3.6 NPU seam — confirmed no NPU code snuck in

`src/llama-governor-policy.cpp:144-158` `prefill_engine()` returns CPU, GPU, or GPU_COOLMODE — never NPU.
`src/llama-governor-policy.cpp:206-234` `select_decode()` returns CPU or GPU_COOLMODE — never NPU.
`src/llama-ext.h:146`: NPU is in the enum only.

**Verdict**: **REFUTED** — no NPU selection path exists. Seam is honest.

---

## 4. BigMoE concepts

### 4.1 StallUnion: real interval union — CONFIRMED

`src/llama-governor-metrics.cpp:54-74`: Depth tracking merges overlapping intervals. Non-overlapping intervals are summed. `total()` includes the currently-open interval. Test at `test-governor-v02-router.cpp:198-204` demonstrates nested intervals correctly:

```cpp
stalls.enter(100);
stalls.enter(200);
stalls.exit(300);
check(stalls.total(400) == 300, "nested stall intervals union");
stalls.exit(500);
check(stalls.total(500) == 400, "stall union closes at outer exit");
```

enter(100): depth 0→1, open=100. enter(200): depth 1→2. exit(300): depth 2→1. total(400)=0+(400-100)=300 ✓. exit(500): depth 1→0, total=500-100=400 ✓.

**Verdict**: **CONFIRMED** — real interval union, not a disguised sum.

### 4.2 PrefillTally seeds decode baseline from prefill close — CONFIRMED

`src/llama-governor.cpp:172-174`:
```cpp
    } else if (!is_prefill && last_phase == phase::Prefill) {
        prefill_tally_.end(telemetry_);
        record_tally();
```

`src/llama-governor-runtime.cpp:16-21`:
```cpp
    if (tally.closed) {
        stats_.decode_baseline_cpu_us = tally.post.cpu_us;
        stats_.decode_baseline_read_bytes = tally.post.read_bytes;
        ...
    }
```

`end()` sets `closed=true` and `post=telemetry_`. `record_tally()` snapshots the closed result and seeds decode_baseline from `tally.post` (the telemetry at prefill close). This is exactly the BigMoE PrefillTally pattern: "decode baseline seeds from prefill_tally.post".

**Verdict**: **CONFIRMED** — correct implementation of the pattern.

### 4.3 Cache-budget warning: reachable — CONFIRMED

`src/llama-governor-policy.cpp:37-40`:
```cpp
cache_budget_warning_ = params_.cache_budget_bytes != 0 && params_.expert_cycle_bytes != 0 &&
                       params_.cache_budget_bytes < params_.expert_cycle_bytes;
```

Constructor-time latch. Reachable when `0 < cache_budget_bytes < expert_cycle_bytes`. Test at `test-governor-v02-router.cpp:214-218` verifies with values 10 < 20. Also logged at `src/llama-governor.cpp:48-49`:
```cpp
    if (stats_.cache_budget_warning) {
        LLAMA_LOG_WARN("%s: cache budget is smaller than one expert cycle; streaming will thrash\n", __func__);
    }
```

**Verdict**: **CONFIRMED** — reachable via params.

### 4.4 Lambda knob: honest seam — CONFIRMED

`src/llama-governor-policy.cpp:28-35`: pure predicate `llama_governor_expert_substitution_would_displace`.
`src/llama-governor-runtime.cpp:157-165`: `note_expert_route()` increments a counter only.
`src/llama-governor.cpp:46`: lambda stored from params, never used to modify routing.
`src/llama-ext.h:307`: `expert_substitution_would_displace` is a uint64_t counter in stats.

No displacement, no routing modification, no fake eviction. Counter only.

**Verdict**: **CONFIRMED** — honest seam, no fake displacement.

---

## 5. Test quality

### 5.1 Tests assert spec golden assertions — partially

`test_ledger_and_schema()`: Tests §3.6 (NPU off), §3.1 schema gate. ✓ spec-grounded.
`test_thermal_state()`: Tests §3.3 state transitions, hysteresis widths, trend threshold. ✓ spec-grounded.
`test_admission_and_flip_budget()`: Tests §3.4 predicted-end admission, §3.5 flip budget. ✓ spec-grounded.

However, §1.2 above: `test-governor-v02-router.cpp:138-139` explicitly asserts the code's strict `<` behavior for CRITICAL exit, which diverges from the spec's `≤`. The test name "CRITICAL exit is strictly below 34.0" documents the divergence but doesn't flag it.

### 5.2 Tests that can never fail

All tests construct `llama_governor_policy` directly and call its methods. None instantiate `llama_governor`. This means:
- `stall_enter()` / `stall_exit()` — never tested through the governor wrapper
- `record_telemetry()` — never tested
- `note_expert_route()` — never tested
- `set_thermo_profile()` — never tested
- `decode_impl()` chunking — never tested
- Sequence validation (`n_seq_id` check) — never tested
- Embedding batch rejection — never tested
- Failed governor rejection — never tested

`test_metrics_and_knobs()` at `test-governor-v02-router.cpp:197-226` tests the metrics classes directly, not through the governor API. The test exercises `llama_governor_stall_union_state` (the non-thread-safe inner class), not `llama_governor_stall_union` (the thread-safe wrapper). The mutex path is never exercised.

### 5.3 Missing error-handling tests

No test for:
- `llama_governor_decode` with `governor == nullptr` (returns -1, never tested)
- `llama_governor_set_thermo_profile` with `policy_enabled_ == false` (returns false, never tested)
- Sticky failure: decode after `fail()` (returns -1, never tested)
- `llama_governor_get_stats` with null governor (returns zeroed stats, never tested)

### 5.4 Test infrastructure weakness

`test-governor-v02-router.cpp:8`: `int failures = 0;` — global, not per-test. A failure in `test_ledger_and_schema()` doesn't prevent subsequent tests from running, which is good. But there's no test isolation: each test function creates fresh policies, but if a later test accidentally depends on state from an earlier test, it would silently pass.

**Verdict**: Tests are spec-grounded for the happy path. Missing coverage for the governor wrapper, error handling, and thread-safety.

---

## 6. Clean code

### 6.1 Files over ~250 lines with mixed responsibilities

- `src/llama-ext.h` (398 lines): enums, 5 structs, 12 function declarations. This is the project's public API header — mixed responsibilities are somewhat inherent. But it could be split into `llama-governor-types.h` for the governor-specific types.
- `src/llama-governor-runtime.cpp` (245 lines): Contains both the C API wrappers (`llama_governor_init`, `llama_governor_free`, etc.) and internal governor methods (`record_tally`, `refresh_policy_stats`, `admit_prefill`, `select_decode`). Borderline.

### 6.2 Types/APIs nobody constructs in this tree

- `llama_governor_telemetry_sample` (`llama-ext.h:312-319`): declared, no caller.
- `llama_governor_stall_union` (`llama-governor-metrics.h:49-57`): declared, used only in `llama_governor` member. No standalone caller.
- `llama_governor_stall_union_state` (`llama-governor-metrics.h:37-47`): public, used only by `llama_governor_stall_union` internally and by tests. Could be private.
- `llama_governor_counter_sample` (`llama-governor-metrics.h:6-12`): used only internally by tally.

### 6.3 Preventive exports

`llama_governor_stall_union_state` is a detail of the interval-union implementation. It's exported in the header because the test constructs it directly. If the test used the thread-safe wrapper, the state class could be private.

### 6.4 `llama_governor_params` fields that are never read

- `npu_lane_enabled` — read in `prefill_token_cap()` (`llama-governor-policy.cpp:240`) but only when NPU is off. Token cap of 512 is never actionable.
- `npu_fit` — passed through to stats but never used for admission.
- `htp_trunk_readable`, `htp_experts_readable` — declared in params, never read anywhere.

These are honest seams for future NPU work, not dead code per se. But `htp_trunk_readable` and `htp_experts_readable` are truly unreferenced.

**Verdict**: Minor clean-code issues. No blocking concerns.

---

## 7. Memory

### 7.1 Allocation without release on failure paths

`src/llama-governor-runtime.cpp:55-72` `admit_prefill`:
```cpp
    std::vector<int32_t> chunk_sizes;
    int32_t remaining = batch.n_tokens;
    while (remaining > 0) {
        ...
        chunk_sizes.push_back(count);
        remaining -= count;
    }
```

`chunk_sizes` is a stack-allocated `std::vector`. Destroyed on scope exit. No leak on any path (including early return at line 63-64). ✓

Constructor at `src/llama-governor.cpp:27-43`: proper cleanup on all failure paths. ✓

### 7.2 Growing vectors never trimmed per-turn

No vectors grow across turns. `chunk_sizes` is local to `admit_prefill`. `stats_` is a fixed struct. `telemetry_` is a fixed struct. ✓

### 7.3 `llama_governor_stats` is 310+ bytes of zeroed-on-read

`src/llama-governor-runtime.cpp:113-123` `stats()`:
```cpp
llama_governor_stats llama_governor::stats() const {
    auto result = stats_;
    ...
    return result;
}
```

Copies the entire 310+ byte `stats_` struct on every call. No pooling, no move. For a function called once per turn, this is fine. But `llama_governor_get_stats` at line 241-244 does `*stats = governor->stats()` — double copy (one inside `stats()`, one assignment). Minor inefficiency.

**Verdict**: No memory bugs. No leak paths. No unbounded growth.

---

## Summary of findings

| # | Finding | Severity | Verdict |
|---|---------|----------|---------|
| 1.1 | LOWBAT trap state — no exit on battery recovery | HIGH | CONFIRMED |
| 1.2 | CRITICAL exit strict `<` vs spec `≤` | HIGH | CONFIRMED |
| 2.1 | `telemetry_` data race across threads | MEDIUM | CONFIRMED |
| 2.2 | `policy_` not thread-safe for cross-thread thermals | MEDIUM | CONFIRMED |
| 1.3 | decode_baseline zeroed when no prefill precedes decode | LOW | PLAUSIBLE |
| 1.4 | admit_prefill uses CPU delta for GPU requests | LOW | PLAUSIBLE |
| 3.3 | CRITICAL→FAST not CRITICAL→abort+restart | LOW | PLAUSIBLE |
| 3.5 | cool_pays::Unknown passes eligibility | LOW | PLAUSIBLE |
| 5.2 | Governor wrapper methods untested | MEDIUM | CONFIRMED |
| 5.3 | Error-handling paths untested | MEDIUM | CONFIRMED |
| 5.4 | StallUnion mutex path untested | LOW | CONFIRMED |
| 6.2 | Unreferenced params fields (htp_trunk_readable, htp_experts_readable) | LOW | CONFIRMED |
| 4.1–4.4 | BigMoE concepts | — | ALL CONFIRMED |

---

## FIX list (by severity)

### HIGH — must fix before any device build

**FIX-1**: Add LOWBAT exit in `update_thermal()` at `src/llama-governor-policy.cpp`. After the `state_ == FAST` branch (line 133), add:
```cpp
} else if (state_ == llama_governor_thermal_state::LOWBAT) {
    if (profile.batt_level_pct >= 25) {
        state_ = classify(temp);
    }
}
```
This restores normal classification when battery recovers.

**FIX-2**: Change `can_leave()` at `src/llama-governor-policy.cpp:81` from `<` to `<=` for the temperature comparison:
```cpp
return temperature <= exit_temperature && now_ms >= state_since_ms_ && now_ms - state_since_ms_ >= k_dwell_ms;
```
And update the test at `test-governor-v02-router.cpp:138-139` to assert `FAST` at exactly 34.0 °C.

### MEDIUM — fix before first integration

**FIX-3**: Protect `telemetry_` with the same pattern as `stall_union_`. Either:
- (a) Add a mutex to `llama_governor` and lock in `record_telemetry()` and wherever `telemetry_` is read, or
- (b) Make `telemetry_` an `std::atomic<uint64_t>` for each field (5 atomics), or
- (c) Document that `record_telemetry()` must only be called from the decode thread.

Option (c) is the lightest but contradicts the stall hooks' threading model.

**FIX-4**: Similarly protect `policy_` access, or document that `set_thermo_profile()` must not be called concurrently with `decode()`. Add a note to the public API docs at `src/llama-ext.h:354-358`.

**FIX-5**: Add tests for the governor wrapper:
- `llama_governor_decode` with null governor
- `llama_governor_decode` after sticky failure
- `set_thermo_profile` with policy disabled
- Sequence validation failure (seq_id != 0)
- Embedding batch (n_tokens > 1 but no token data)

### LOW — fix when convenient

**FIX-6**: Remove or document `k_warn_c` at `src/llama-governor-policy.cpp:10`. Either use it directly in a WARN state or delete it.

**FIX-7**: Make `llama_governor_stall_union_state` a private implementation detail. Move it inside `llama_governor_stall_union` or into an internal header. Update the test to use the thread-safe wrapper.

**FIX-8**: Remove unreferenced params fields `htp_trunk_readable` and `htp_experts_readable`, or add an `static_assert` / compile-time check that they're read somewhere.

---

## APPLY / REWORK verdict

**APPLY with fixes.**

The implementation is structurally correct: StallUnion is a real interval union, PrefillTally seeds decode baseline, cache-budget warning is reachable, lambda knob is honest, NPU seam is clean. The spec conformance is strong for the happy path.

The two HIGH bugs (LOWBAT trap, `<` vs `≤`) are real and must be fixed. The race conditions are architectural — they need either locks or API documentation. The test gaps are significant but not blocking for a first integration.

The implementer's REPORT.md claims are largely accurate. The only claim I'd push back on: "StallUnion is a real mutex-protected interval union" — it IS, but the test exercises the non-mutex inner class, so the mutex path is unverified.

Overall: **3 confirmed HIGH bugs, 2 confirmed MEDIUM race conditions, 4 PLAUSIBLE issues, 4 BigMoE concepts CONFIRMED. Fix HIGH items, document MEDIUM threading constraints, ship.**
