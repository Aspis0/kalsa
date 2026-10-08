# Hostile review: load-step commit 47aa1cc4a

Target: `47aa1cc4a` (parent `2d970bdf3`) in `kalsallama-gov-loadstep`.

## Findings

### 1. [CONFIRMED] [P2] EMA values are stale across a hop, but the load-step exemption changes immediately

Evidence:

- `src/llama-governor-policy-hop.cpp:69`: `const float alpha = static_cast<float>(1.0 - std::exp(-dt_s / params_.decode_headroom_tau_s));`
- `src/llama-governor-policy-hop.cpp:76`: `decode_headroom_smooth_[i] += alpha * (raw[i] - decode_headroom_smooth_[i]);`
- `src/llama-governor-policy-hop.cpp:153`: `const float step_c = engine == decode_hop_leg_ ? 0.0f : load_step;`
- `src/llama-governor-policy-hop.cpp:154`: `return headroom_of(engine) - params_.decode_heat_weight * heat - step_c;`
- `src/llama-governor-policy-hop.cpp:185`: `decode_hop_leg_ = present[best];`
- `src/llama-ext.h:355-356`: `// not the current one (the current leg already reads loaded); 0 = today's` / `// rule.`

The current-leg exception tracks leg identity, not whether its EMA has caught up to its loaded temperature. On a GPU-to-NPU hop, use the S23 steps (NPU 11 C, GPU 14 C) and a threshold-crossing state: GPU EMA 23 C loaded, NPU EMA 38 C idle. Before the hop, NPU scores 38 - 11 = 27 C, exactly 4 C above GPU, so the hop occurs. Immediately after the leg identity changes, with the EMA values unchanged, NPU is treated as 38 C and GPU scores 23 - 14 = 9 C. The perceived NPU lead jumps from 4 C to 29 C: a 25 C role-change discontinuity.

For a concrete reversal, assume tau=10 s, one-second samples, and zero heat weighting. After the hop, let the physical targets be NPU 20 C loaded and GPU 40 C idle; the corrected GPU target is 40 - 14 = 26 C, a 6 C lead over NPU. The stale EMAs start at NPU 38 C and GPU 23 C. With q=exp(-t/tau), the EMA comparison is GPU-candidate minus NPU-current = (26 - 17q) - (20 + 18q) = 6 - 35q. It does not clear the 4 C hop threshold until q <= 2/35, or t >= 2.86*tau: about 28.6 seconds. At one second, the GPU candidate is still about 25.7 C behind. That is a long extra hold even though the settled corrected headrooms favor GPU by 6 C. No added test exercises nonzero load steps with tau > 0.

### 2. [CONFIRMED] [P2] Direct params accept NaN, infinity, and negative load steps

Evidence:

- `src/llama-governor-policy-hop.cpp:160-162`:
  `if (!std::isfinite(headroom_of(present[i]))) {`
  `    all_known = false;`
  `}`
- `src/llama-governor-policy-hop.cpp:179`: `if (best < 0 || effective_of(present[i]) > effective_of(present[best])) {`
- `src/llama-governor-policy-hop.cpp:153-154`:
  `const float step_c = engine == decode_hop_leg_ ? 0.0f : load_step;`
  `return headroom_of(engine) - params_.decode_heat_weight * heat - step_c;`
- `src/llama-governor-policy.cpp:79-84` only normalizes tau:
  `if (!std::isfinite(params_.decode_headroom_tau_s) || params_.decode_headroom_tau_s < 0.0f) {`
  `    LLAMA_LOG_WARN("governor: invalid decode_headroom_tau_s %.6g; "`
  `                   "headroom smoothing is off (raw samples)\n",`
  `                   static_cast<double>(params_.decode_headroom_tau_s));`
  `    params_.decode_headroom_tau_s = 0.0f;`
  `}`
- `src/llama-ext.h:357-359`:
  `float decode_load_step_npu_c = 0;`
  `float decode_load_step_gpu_c = 0;`
  `float decode_load_step_cpu_c = 0;`
- `tools/governor-bench/governor-bench.cpp:65`: `if (!text[0] || !end || *end || parsed < 0.0 || !std::isfinite(parsed)) { return false; }`
- `tools/governor-bench/governor-bench.cpp:69`: `return std::isfinite(value);`

The bench parser rejects non-finite and negative values, but callers of the exported governor APIs can pass `llama_governor_params` directly. A NaN step is not included in `all_known` and can poison ranking: with NPU current and GPU first among the other legs, a NaN GPU score becomes `best`; the CPU comparison against NaN is false, then the final NaN difference prevents a hop even if CPU has ample headroom. A negative step boosts that leg and can make a lower-headroom leg win. Positive infinity effectively disables a leg. These should be normalized or rejected at policy construction.

### 3. [CONFIRMED] [P3] Two new test assertions do not prove the claims in their labels

Evidence:

- `tests/test-governor-v02-hop-v2.cpp:238-239`:
  `llama_governor_policy plain(hop_params());`
  `llama_governor_policy zeroed(zeroed_params);`
- `tests/test-governor-v02-hop-v2.cpp:249-251`:
  `check(decide(zeroed, walk[i][0], walk[i][1], walk[i][2], token) ==`
  `      decide(plain, walk[i][0], walk[i][1], walk[i][2], token),`
  `      "zero load steps decide as today");`
- `tests/test-governor-v02-hop-v2.cpp:297-298`:
  `check(decide(equal, 10.0f, 10.0f, 10.0f, 0) == llama_governor_engine::NPU,`
  `      "equal docked legs: window 0 still opens on the NPU");`
- `tests/test-governor-v02-hop-v2.cpp:267-268`:
  `check(decide(docked, 5.0f, 31.5f, 23.0f, 8) == llama_governor_engine::GPU,`
  `      "S23: a docked NPU lead of 8.5 C keeps the loaded GPU");`
- `tests/test-governor-v02-hop-v2.cpp:283-284`:
  `check(decide(both, 5.0f, 20.0f, 37.0f, 4) == llama_governor_engine::NPU,`
  `      "current leg: docked GPU 3 C ahead keeps the NPU");`
- `src/llama-governor-policy-hop.cpp:171`: `decode_hop_leg_ = present[0];`

The zero-step comparison is self-comparison: a mutation that ignores load steps on both policies still passes. Existing three-leg tests do assert several default outcomes, so this does not invalidate all default coverage. The equal-docked case is vacuous for docking: window 0 assigns `present[0]` directly and does not call `effective_of`, so it tests the existing NPU opening rule, not tie behavior among docked effective headrooms. The S23 and current-leg cases do exercise nonzero steps on the raw path and would fail if the step were ignored or also applied to the current leg.

### 4. [PLAUSIBLE] [P2] Inserting fields into the public params aggregate breaks old downstream layouts

Evidence:

- `src/llama-ext.h:314`: `struct llama_governor_params {`
- `src/llama-ext.h:357-359`:
  `float decode_load_step_npu_c = 0;`
  `float decode_load_step_gpu_c = 0;`
  `float decode_load_step_cpu_c = 0;`
- `src/llama-ext.h:366-368`:
  `const llama_governor_engine * forced_leg_sequence = nullptr;`
  `uint32_t forced_leg_sequence_n = 0;`
  `uint32_t forced_leg_tokens = 0;`
- `src/llama-ext.h:592`: `struct llama_governor_params governor_params);`

No in-repo positional or designated initializer is affected. However, this is an exported params type passed by value. Old downstream binaries need a rebuild, and old positional aggregate initializers that reach the forced-leg fields are source-incompatible because three floats were inserted before those fields. This is conditional on cross-version source/ABI compatibility being part of the engine contract.

## Requested checks with no additional in-tree defect

### Effective-headroom call timing: [REFUTED] [P3] for valid finite, nonnegative steps

Evidence:

- `src/llama-governor-policy-hop.cpp:179`: `if (best < 0 || effective_of(present[i]) > effective_of(present[best])) {`
- `src/llama-governor-policy-hop.cpp:184-185`:
  `effective_of(present[best]) - effective_of(decode_hop_leg_) >= k_hop_hysteresis_c) {`
  `decode_hop_leg_ = present[best];`
- `src/llama-governor-policy-hop.cpp:177-185`: these comparisons finish before the possible assignment to `decode_hop_leg_`.
- `src/llama-governor-policy-hop.cpp:196-201`:
  `const bool wanted = decode_hop_leg_ == llama_governor_engine::CPU &&`
  `    decode_leg_present_[static_cast<int>(llama_governor_engine::GPU)] &&`
  `    effective_of(llama_governor_engine::GPU) >=`
  `        effective_of(llama_governor_engine::CPU);`
  `if (wanted && !decode_gpu_burst_blocked_) {`
  `    decode_hop_leg_ = llama_governor_engine::GPU;`
- `src/llama-governor-policy-hop.cpp:171`: window 0 assigns `decode_hop_leg_ = present[0];` without an `effective_of` call.
- `src/llama-governor-policy-hop.cpp:211`: alternation fallback assigns `decode_hop_leg_ = present[(window + n_present - 1) % n_present];` without an `effective_of` call.

The GPU_BURST call does read the mutable leg after the main loop. If the loop newly selected CPU, however, CPU was already at least as good as GPU among the docked candidates; making CPU current removes its nonnegative dock and can only raise its score, so GPU cannot satisfy the burst comparison. If the loop leaves CPU current, the incumbent has not changed. Thus this is not a reachable ranking error for valid steps. The invalid-negative case is covered by finding 2.

### Hop log line: [REFUTED] [P3]

Evidence: `src/llama-governor-policy-hop.cpp:225-231` remains:

```cpp
LLAMA_LOG_INFO("governor: decode hop %s->%s at token %u (headroom cpu %.1f C,"
               " npu %.1f C, gpu %.1f C, hysteresis %.0f C)\n",
               leg_label(prev_leg), leg_label(decode_hop_leg_), tokens_since_prefill,
               headroom_of(llama_governor_engine::CPU),
               headroom_of(llama_governor_engine::NPU),
               headroom_of(llama_governor_engine::GPU),
               k_hop_hysteresis_c);
```

The commit does not change this format. It still reports the raw/EMA headrooms, not the adjusted effective scores.

### `--heat-per-token` parser behavior: [REFUTED] [P3]

Evidence:

- Current `tools/governor-bench/governor-bench.cpp:116`: `if (filled >= 3 || !parse_nonneg_float(value.c_str(), slots[filled])) { return false; }`
- Parent `2d970bdf3:tools/governor-bench/governor-bench.cpp:113`: `if (filled >= 3 || !parse_nonneg_float(value.c_str(), slots[filled])) { return false; }`

The renamed helper has the same loop, short-circuit, finite/nonnegative conversion, and three-value requirement as the old helper. It accepts and rejects the same `--heat-per-token` values.

### In-tree params construction: [REFUTED] [P3]

Evidence: `tests/test-governor-v02-hop-v2.cpp:39`: `auto params = llama_governor_params{};`

The in-tree uses in `src/`, `tools/`, and `tests/` are default/value initialization followed by member assignment; no non-empty positional or designated `llama_governor_params` initializer was found. See finding 4 for the conditional downstream compatibility risk.

### `run_start` consumers: [REFUTED] [P3] in this checkout

Evidence:

- `tools/governor-bench/governor-bench.cpp:353-354`:
  `std::printf("run_start arm=%c rep=%d monotonic_us=%lld dev=%s hop_mode=%s headroom_tau=%.3f "`
  `            "heat_weight=%g heat_per_token=%g,%g,%g load_step=%g,%g,%g\n",`

Repository-wide `git grep` found only this emitter for `heat_per_token=`; no in-repo parser or consumer exists. The output record is extended, so external consumers that require an exact full-line schema are not covered by this scan.

### Generality, file size, and dead code: [REFUTED] [P3]

The shared parser is used by exactly the two per-leg CLI options and avoids duplicating identical validation. The implementation adds only the field selection and subtraction; the larger test diff adds the requested behavior cases. No newly introduced dead code was found.
