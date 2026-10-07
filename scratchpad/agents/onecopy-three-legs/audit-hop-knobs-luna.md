# Hostile audit: decode-hop v2 knobs

Audited **85d017571065bb595e0ce3f58b05a73f5f86d704** against parent **b60dbbfb0aa15adebfc0c420b57f769c1ab760c3**. The branch later advanced to e162b8e for --dev; that commit was excluded. No tests were run. Findings below refer to the target commit's tree; binding references are to the checked llama.rn-kalsa-gov-platform worktree.

## Findings

1. **P2 — CONFIRMED: decode_gpu_burst_windows > 1 cannot spend consecutive burst substitutions.**  
   src/llama-governor-policy-hop.cpp:205-208
   > decode_hop_leg_ = llama_governor_engine::GPU;
   > if (--decode_gpu_burst_left_ == 0) {
   >     decode_gpu_burst_blocked_ = true;
   
   The substitution makes GPU the incumbent. At the next fully-known decision, NPU_FIRST can select CPU from GPU only when CPU beats GPU by the hysteresis; that contradicts the burst predicate requiring GPU >= CPU. Otherwise the incumbent stays GPU or moves to NPU. So a second consecutive gpu_burst decision is unreachable. The limit-2 test confirms only one burst: its next GPU window is explicitly ordinary headroom (tests/test-governor-v02-hop-v2-knobs.cpp:189-194). The exposed count does not implement its advertised multi-window burst. **Fix:** track the underlying NPU_FIRST leg separately from the temporarily selected GPU leg.

2. **P2 — CONFIRMED: the burst guard is released only in one known-headroom branch.**  
   src/llama-governor-policy-hop.cpp:210-220
   > } else if (decode_hop_leg_ != llama_governor_engine::GPU) {
   >     decode_gpu_burst_left_ = 0;
   >     decode_gpu_burst_blocked_ = false;
   > }
   > } else {
   >     // v1's fixed alternation extended to the present legs: cycle the
   >     // list starting at its last element (the CPU), which for two legs is
   >     // exactly v1's odd/even window map
   >     decode_hop_leg_ = present[(window + n_present - 1) % n_present];
   
   An alternation fallback can decide a non-GPU window without clearing the spent/blocked state. The safety path also parks on CPU at src/llama-governor-policy.cpp:467-468 without updating burst state. The new test requires that LOWBAT CPU windows do not release the hold (tests/test-governor-v02-hop-v2-knobs.cpp:230-242), which is stricter than the stated “no back-to-back burst without one non-GPU window in between.” This can require an extra healthy CPU window after a safety CPU window before bursting again. **Fix:** apply the burst release transition to every completed non-GPU window, including alternation and safety-routed CPU windows.

3. **P2 — CONFIRMED: invalid API tau values silently produce inconsistent modes.**  
   src/llama-governor-policy-hop.cpp:47-64
   > if (params_.decode_headroom_tau_s <= 0.0f) {
   >     return; // smoothing off: hop_decide reads the raw samples (today)
   > }
   > const float alpha = static_cast<float>(1.0 - std::exp(-dt_s / params_.decode_headroom_tau_s));
   
   Negative tau silently means raw mode although only zero is documented as raw. NaN bypasses the guard and makes alpha NaN, poisoning finite averages on subsequent updates; positive infinity yields alpha zero and freezes a seeded average. The public params constructor does not validate this field. **Fix:** reject non-finite or negative tau at the API boundary; preserve exactly zero as raw mode.

4. **P3 — PLAUSIBLE: the injected clock rollback handling corrupts the next interval and subtraction can overflow.**  
   src/llama-governor-policy-hop.cpp:58-75
   > dt_s = static_cast<double>(now_us - decode_headroom_last_us_) / 1e6;
   > if (dt_s < 0.0) {
   >     dt_s = 0.0; // never un-average on a backwards clock step
   > }
   > ...
   > decode_headroom_last_us_ = now_us;
   
   After a backwards timestamp, the code clamps this interval but stores the lower timestamp; the next forward sample then uses an interval larger than elapsed monotonic time. Signed subtraction can also overflow at an int64_t wrap before the negative check. Production ggml_time_us() uses a monotonic clock, so rollback is mainly relevant to the injected-clock contract and wrap edge. **Fix:** compare timestamps before subtracting and retain the last accepted timestamp when time regresses.

5. **P2 — CONFIRMED: default benchmark output is not byte-identical to the parent.**  
   Target tools/governor-bench/governor-bench.cpp:249
   > std::printf("run_start arm=%c rep=%d monotonic_us=%lld hop_mode=%s headroom_tau=%.3f\n",
   
   Parent b60dbbfb0:tools/governor-bench/governor-bench.cpp:221
   > std::printf("run_start arm=%c rep=%d monotonic_us=%lld\n", opts.arm, rep, (long long) ggml_time_us());
   
   The target adds fields on every arm, even A/C/G and default arm L with NPU_FIRST/tau 0. Engine hop decisions and hop log lines retain v1 parity (see checks below), but this benchmark line breaks the stated default log/output parity and machine-readable consumers. **Fix:** preserve the old line for default settings and emit knob metadata only when non-default or relevant to arm L.

6. **P3 — CONFIRMED: CLI tau parsing can change the requested value and its header hides small values.**  
   tools/governor-bench/governor-bench.cpp:121-125,249-251
   > const double parsed = std::strtod(argv[i], &end);
   > if (!argv[i][0] || !end || *end || parsed < 0.0 || !std::isfinite(parsed)) {
   >     usage(argv[0]); return false;
   > }
   > out.headroom_tau = static_cast<float>(parsed);
   
   A finite double above FLT_MAX narrows to infinity; a positive value below float range narrows to zero and disables smoothing. The run header then prints only three decimals, so distinct active tau values can be reported as 0.000. **Fix:** range-check before narrowing and print enough digits to round-trip the stored float.

7. **P3 — PLAUSIBLE: an absent leg can retain and later reuse an old EMA.**  
   src/llama-governor-policy-hop.cpp:56-72,78-84
   > const float raw[3] = { cpu_headroom_c, gpu_headroom_c, npu_headroom_c };
   > for (int i = 0; i < 3; ++i) {
   > ...
   > void llama_governor_policy::set_decode_legs(bool npu, bool gpu, bool cpu) {
   >     decode_leg_present_[static_cast<int>(llama_governor_engine::NPU)] = npu;
   >     decode_leg_present_[static_cast<int>(llama_governor_engine::GPU)] = gpu;
   
   Presence changes do not clear or park that leg's average; the setter updates all three averages regardless of the mask. A caller that removes and re-adds a leg mid-turn without sending NaN can make its next finite sample blend with stale history. The built-in one-model availability refresh is per-turn and reset clears the EMA, so this is limited to other same-turn uses of the exposed setter. **Fix:** park/reset a leg's EMA when it becomes absent and require a fresh finite sample when it returns.

8. **P2 — PLAUSIBLE: the public params growth requires an ABI rebuild/version boundary.**  
   src/llama-ext.h:371-373,613-617
   > float decode_headroom_tau_s = 0;
   > llama_governor_leg_weighting decode_leg_weighting = llama_governor_leg_weighting::NPU_FIRST;
   > uint32_t decode_gpu_burst_windows = 1;
   > struct llama_governor_params governor_params);
   
   llama_governor_params is public and passed by value. Appending these members changes its size/layout for separately compiled old consumers; a mixed old-header/new-library call is not ABI-safe. I found no positional aggregate construction in the engine or binding source: the inspected sites default-construct and assign fields (for example, governor-bench-run.cpp:195, binding rn-governor-params.cpp:141). The active binding vendor pin predates this commit, so it must be rebuilt/pinned as a unit before using the new header. **Fix:** require/rebuild all consumers at the same ABI revision or introduce a versioned size-aware params entry point.

## Contract and integration checks

- **Default v1 engine parity — CONFIRMED.** Parent b60dbbfb0:src/llama-governor-policy-hop.cpp:36-41 stores raw samples directly; target set_decode_headroom stores the same raw members then returns at tau zero (37-49). Parent's NPU_FIRST “best other leg” loop (114-124) is unchanged in target (172-185). The default mask remains NPU+CPU, and target's headroom_of selects those raw fields at tau zero (110-124). The hop label remains headroom; the emitted hop format and raw arguments are unchanged (228-234 vs parent 137-141). So the shipped two-model governor route is byte-identical at the decision and hop-log level; finding 5 is the bench-wide output exception.
- **EQUAL equivalence claim — CONFIRMED for engine choices, false for byte-identical telemetry.** With finite effective scores, EQUAL's global argmax plus hysteresis (162-170) yields the same engine choice as NPU_FIRST's argmax over “all except current” plus the same hysteresis (177-185): if current is not global max, both choose that max; if it is, neither can switch uphill. Exact tie order is the shared NPU/GPU/CPU candidate order. Thus EQUAL is decision-wise dead weight; its only observable distinction from NPU_FIRST is the equal hop-rule label/counter classification.
- **Binding threading — REFUTED as a race in the inspected path.** The engine contract says headroom setter and decode must not overlap (src/llama-governor.h:30-36). Binding before_decode_batch samples and calls the setter (cpp/rn-governor.cpp:97-123); its completion caller invokes it immediately before decode on the same path (cpp/rn-completion.cpp:1705-1711). No competing writer was found.
- **Binding knob wiring — CONFIRMED absent in the checked binding parser, but outside this commit's bench-only interface.** cpp/rn-governor-params.cpp:141-175 resets/default-constructs params and parses decode_hop_tokens, but does not read decode_headroom_tau_s, decode_leg_weighting, or decode_gpu_burst_windows. Only the bench setup assigns tau and weighting (tools/governor-bench/governor-bench-run.cpp:195-199); burst windows are assigned only by the new test. The checked binding's vendor/VERSIONS pin is bc5f0207, predating the audited commit. No app exposure is claimed in this commit, so I did not count this as a defect.
- **Test hygiene:** the new test has explicit failure counting and a nonzero exit; it does not read or mutate environment variables. It does not exercise dt=0/negative/wrap, invalid tau, smoothed log values, or a second gpu_burst substitution. The limit-2 check specifically tests an ordinary headroom GPU hold, not a second burst.

