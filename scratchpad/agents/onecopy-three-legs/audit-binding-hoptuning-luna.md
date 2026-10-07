# Hostile audit: one-copy decode-hop tuning

Scope: `054565d3..1eb78bfe -- . ':!bin'`, plus the requested vendor comparison `b60dbbfb0..5cb7e14a0` (`src/` and `include/`). Read-only audit; no tests run and no commit made.

## Findings

1. **P2 — CONFIRMED, conditional bypass: any unknown present-leg zone disables the tuned rule.**  
   `vendor/llama.cpp/src/llama-governor-policy-hop.cpp:143-148,193-197`

   > `if (!std::isfinite(headroom_of(present[i]))) {`
   > `    all_known = false;`
   > `}`
   > `decode_hop_leg_ = present[(window + n_present - 1) % n_present];`

   `rn_thermal_legs::sample()` returns NaN for a leg with no usable zones or one unreadable zone (`cpp/rn-thermal-legs.cpp:103-117`); the one-copy leg mask reflects built contexts, not zone availability. If any present leg is NaN, EMA and heat scoring are skipped and the policy uses fixed alternation. The row still supplies 10/7/2.8/3.2/4.7, but they have no effect in this state. This is the engine's explicit fallback, but it can silently defeat the row tuning. **Fix:** define and log the intended partial-zone policy, or make unavailable-zone legs ineligible before scoring.

2. **P3 — CONFIRMED: the heat-unit contract is stale and contradicts this row's measured scale.**  
   `vendor/llama.cpp/src/llama-governor-policy-hop.cpp:129-140`; `tests/legs_table_test.cpp:69-73`

   > `// effective headroom: the heat weighting (battery C*s/token, a lab`
   > `// constant per leg) subtracts weight*heat from a leg's raw headroom;`
   > `// tau 10 s smoothing, heat weight 7, skin C per 1k decode tokens per leg.`

   The binding supplies skin rise per 1,000 tokens (2.8/3.2/4.7), not the battery C*s/token units documented by the engine API. The current S23 score scale is intentional: the owner fitted weight 7 against these same constants, so there is no missing `/1000` in this implementation. The stale contract invites future rows/callers to mix incompatible scales. **Fix:** document the row values and heat-weight units explicitly, or normalize both values and fitted weight together.

3. **P3 — CONFIRMED: zero-tau two-model execution has an extra clock read.**  
   `vendor/llama.cpp/src/llama-governor-policy-hop.cpp:37-48`

   > `set_decode_headroom(cpu_headroom_c, npu_headroom_c, gpu_headroom_c, ggml_time_us());`
   > `if (params_.decode_headroom_tau_s <= 0.0f) {`

   The public setter reads the clock before the zero-tau early return. Thus hop-enabled two-model loads retain the same raw samples, decisions, and hop log text, but are not literally byte-for-byte execution-equivalent to `054565d3`; they pay one clock read per feed. **Fix:** bypass the timestamped overload when tau is zero.

4. **P3 — CONFIRMED test gap: the new tests stop at table output.**  
   `tests/legs_table_test.cpp:71-83`

   > `bool test_row_returns_tuning() {`
   > `    return all_three(rn_legs_for(s23_facts())) &&`
   > `           tuning_is(rn_legs_for(s23_facts()), 10.0f, 7.0f, 2.8f, 3.2f, 4.7f);`

   These assertions are not vacuous: they check real row results and explicit zero defaults. No test covers transfer into the one-copy governor or verifies that a post-setter one-copy demotion constructs the two-model governor with zero tau/weight. The source currently keeps the tuned copy local, but the critical demotion invariant is unguarded. **Fix:** add a host-testable per-branch params builder and assert matched-row, no-row, and demotion values.

5. **P3 — PLAUSIBLE log ambiguity: appended values describe the row, not necessarily an applied tuning.**  
   `cpp/rn-llama.cpp:444-457`

   > `"gpu_driver:\"%s\", dotprod:%d, one_copy:%d, tau_s:%g, heat_w:%g, "`
   > `if (leg_set.one_copy && governor_params.npu_lane_enabled) {`

   The line is emitted before the NPU-lane gate and before `KALSA_HTP_FALLBACK` or a one-copy load failure can demote the call. On those paths it still prints `one_copy:1` and the S23 tuning values, although the two-model governor gets zero tuning. Existing field names are retained; `tau_s`, `heat_w`, and `heat_tok_*` are appended, with no rename. If lab greps treat this as applied-config evidence, it can report a false positive. **Fix:** label these as row candidates or log a separate applied-tuning result after load selection.

## Checks that found no further defect

- **Values, fields, and row/no-row behavior — REFUTED as bugs.** `cpp/rn-legs-table.cpp:67-70` has the requested exact tuple; `:161-174` copies those five values on a match and returns `{}` otherwise. `rn_leg_set` and `llama_governor_params` defaults are zero. The matching path copies into `onecopy_params` only (`cpp/rn-llama.cpp:402-410`); the two-model path builds from the untouched `governor_params` (`:493`, `:640-642`). One-copy demotion falls through to that two-model branch (`:468-478`), so no tuned value leaks in-process.
- **EMA clock and turn reset — REFUTED as bugs.** `cpp/rn-governor.cpp:134-147` samples at the same pre-increment token multiples used by the engine's `tokens_since_prefill / decode_hop_tokens` window. `set_decode_headroom` uses elapsed `ggml_time_us()` deltas in seconds (`vendor/llama.cpp/src/llama-governor-policy-hop.cpp:50-78`). `reset_decode_hop()` clears raw values, EMA values, and timestamp validity (`vendor/llama.cpp/src/llama-governor-policy.cpp:507-521`); the engine calls it at turn/prefill latches. No other reset bypass was found.
- **Effective score and field tracing — REFUTED as bugs.** The engine reads the row's tau for EMA selection and maps each heat field to the matching CPU/GPU/NPU leg before applying `headroom - weight * heat` (`vendor/llama.cpp/src/llama-governor-policy-hop.cpp:111-140`). The new `decode_leg_weighting` defaults to `NPU_FIRST`; the binding does not override it, so this row changes smoothing and heat only.
- **Two-model policy parity — REFUTED for decisions and hop logs.** At tau 0 the engine reads the raw fields, weight defaults to 0, and the pre-existing NPU_FIRST comparison/log format remains unchanged. Finding 3 is only the additional clock-call overhead.
- **Vendor bump — REFUTED for drift.** Every changed engine `src/` file in `b60dbbfb0..5cb7e14a0` byte-matches the corresponding vendored file; `include/` has no changes. The remaining vendor changes are the pin and generated version stamps (`vendor/VERSIONS`, build-info, ggml/llama version headers). No other vendor paths changed.
