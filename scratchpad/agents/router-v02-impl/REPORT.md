# Router/governor v0.2 implementation

## Generation 1 — contract and seam audit

- Read `ROUTER-SPEC-V0.2.md`, `GOVERNOR-TRI-ENGINE-DESIGN.md`, and
  `NPU-FIT-MODEL.md` in order. Current NPU ledger remains disabled; unknown
  fit/schema/thermal data fails closed to CPU or wait.
- Target branch: `kalsa/governor-v0.2`, clean at `204e78259`.
- Branch-tip seams read on disk:
  - `src/llama-governor.cpp:131-145`: `const bool is_prefill = batch.n_tokens > 1;`,
    selects `ctx_prefill`/`ctx_decode`, then calls `llama_decode`.
  - `src/llama-governor.cpp:58-62`: calls `llama_kv_route_query(dst_ctx, src_ctx)`
    and rejects `llama_kv_route::Reject` before handoff.
  - `src/llama-governor.cpp:73-78`: selects `Staged` only for
    `MirrorAndCopy && llama_kv_context_can_stage_v(src_ctx)` and calls
    `llama_kv_commit_with_stats(..., src.watermark, end, ..., mode, ...)`.
  - `src/llama-governor.cpp:84-95`: advances both exclusive watermarks only
    after a successful explicit-range commit and accumulates transfer stats.
  - `src/llama-governor.cpp:117-120`: `fail()` sets `failed = true` and logs;
    `src/llama-governor.cpp:124-129` keeps later invalid calls failed.
  - `src/llama-ext.h:119-127`: route enum is `Direct`, `MirrorAndCopy`,
    `Reject`, with `llama_kv_route_query(dst_ctx, src_ctx)`.
  - `src/llama-ext.h:166-173`: `llama_kv_commit_ex` takes explicit
    `seq_id, p0, p1, llama_kv_commit_mode mode, stats`.
  - `src/llama-kv-commit.cpp:290-313`: route implementation returns
    `Reject`, `Direct`, or `MirrorAndCopy` after compatibility checks.
  - `src/llama-kv-commit.cpp:340-343`: commit requires explicit `p1` greater
    than `p0`; mid-copy failures are a known limitation.
  - `src/llama-kv-commit.cpp:356-371`: commit rechecks route, synchronizes,
    handles direct aliases, then hybrid or range commit.
  - `src/llama-ext.h:203-207`: public contract says only sequence 0 is
    supported and decode/commit/route failure is sticky.
  - `src/llama-ext.h:237-240`: `llama_governor_get_stats` is the stats surface.
- Existing `llama_perf_context_data` (`include/llama.h:1535-1545`) exposes
  only prompt/eval wall timings, counts, and graph reuse. There is no stall,
  flash-read, cache-residency, or expert-cycle source in this tree.

Next: add the pure v0.2 policy, state/metrics hooks, then targeted golden tests.

## Generation 2 — implementation slice

- Added `src/llama-governor-policy.{h,cpp}`: ordered CPU-first R1/R5/R8/R9
  placement, v0.3/capability-schema checks, unplugged/plugged thresholds,
  first-poll classification, 10-minute exits, trend guard `+1.5 °C/min`,
  39.5 °C predicted-end admission table, NPU-off fallback, and one
  CPU→GPU engagement per hour.
- Added `src/llama-governor-metrics.{h,cpp}`: `StallUnionState` interval union
  plus mutex wrapper, and `PrefillTally` cumulative pre/post delta closure.
- Extended `src/llama-ext.h` with the deferred `NPU` engine/`npu_fit` stat,
  runtime params, thermal/telemetry input structs, policy stats, and explicit
  stall/telemetry/expert-route hooks. `llama_governor_init` remains compatible;
  `llama_governor_init_with_params` enables v0.2 policy gating.
- Extended `src/llama-governor.cpp` without changing the existing KV seam:
  policy admission can return non-sticky `-2` wait, while token batches are
  internally reduced to the admitted table row; thermal aborts are sticky,
  and selected COOLMODE reports a full-reload requirement. Prefill tally
  starts/ends at phase transitions; decode baselines use its closing sample.
  Embedding batches cannot be safely sliced because `llama_batch` has no
  public embedding stride, so those return non-sticky `-2` for caller chunking.
  No stream/residency source exists to invoke the telemetry/residency hooks in
  this tree.
- Final split leaves `src/llama-governor.cpp` at 197 lines and
  `src/llama-governor-runtime.cpp` at 245 lines.
- Added `tests/test-governor-v02-router.cpp` and a `router` CTest target with
  host-only golden assertions for ledger/schema, thermal transitions,
  admission/chunking, decode gates/flip budget, StallUnion, PrefillTally,
  cache warning, and substitution math.
- Configure command: `cmake -B build-router -DLLAMA_BUILD_TESTS=ON`, real exit
  code `0`. Target build `test-governor-v02-router` real exit code `0`.
- Targeted CTest `test-governor-v02-router` initially exposed and then passed
  the FAST→COOL transition fix; latest real exit code `0`.

## Generation 3 — final audit

Current branch-tip line checks after implementation:

- `src/llama-governor.cpp:165-174`: actual batch phase remains
  `batch.n_tokens > 1`, and policy gating is an extension before the existing
  handoff.
- `src/llama-governor.cpp:178-188`: `PrefillTally` begins/ends at phase
  boundaries; the existing handoff still calls `commit_side`.
- `src/llama-governor.cpp:79-101`: the existing route query, explicit
  `src.watermark` range, and `llama_kv_commit_with_stats` seam remain intact.
- `src/llama-governor-runtime.cpp:9-32`: tally deltas and policy observations
  are copied into governor stats; `:113-122` snapshots open tally/stall
  intervals without closing them.
- `src/llama-governor-runtime.cpp:35-110`: token batches are preflighted into
  safe table rows; unsupported embedding slicing and full reload requests
  return non-sticky `-2`.
- `src/llama-ext.h:146-218`: engine includes deferred `NPU`; params carry
  schema/fit/thermal-adjacent/cache knobs; `:287-309` carries policy,
  StallUnion, PrefillTally, cache-warning, substitution, and `npu_fit` stats.
- `src/llama-ext.h:336-375`: v0.2 initialization and explicit thermal,
  telemetry, stall, and residency-observation hooks are declared.
- `src/llama-kv-commit.cpp:290-313`: branch-tip route behavior is still the
  three-way `Reject`/`Direct`/`MirrorAndCopy` implementation.
- `src/llama-kv-commit.cpp:340-371`: branch-tip commit still requires explicit
  `p1`, rechecks route, synchronizes, and dispatches direct/hybrid/range paths.

Files touched in the target worktree:

- `src/CMakeLists.txt`
- `src/llama-ext.h`
- `src/llama-governor.cpp`, `src/llama-governor.h`,
  `src/llama-governor-runtime.cpp`
- `src/llama-governor-policy.cpp`, `src/llama-governor-policy.h`
- `src/llama-governor-metrics.cpp`, `src/llama-governor-metrics.h`
- `tests/CMakeLists.txt`, `tests/test-governor-v02-router.cpp`

Commits made locally on `kalsa/governor-v0.2`:

- `f7bb1369a` — `feat(governor): implement tri-engine runtime contract v0.2`
- `e5adc86ab` — `test(governor): add v0.2 router golden tests`
- `06171a51f` — `fix(governor): partition admitted token batches safely`

Verification:

- `cmake -B build-router -DLLAMA_BUILD_TESTS=ON`: PASS, real exit `0`.
- `cmake --build build-router --target test-governor-v02-router`: PASS, final
  real exit `0`.
- CTest `test-governor-v02-router`: PASS, 1/1, final real exit `0`.
  The test emits `router_v02_golden=PASS` and `router_v02_metrics=PASS`.

Honest deferred or shaky items:

- NPU is not selected or implemented. The `NPU` enum and `npu_fit` stat/input
  exist only as the deferred seam; no shape census, HTP admission formula,
  PPL certificate, or lane launch was added.
- There is no thermal sensor, device-table loader, model-memory probe, cache
  residency query, expert-cycle source, or streaming counter producer in this
  tree. These are explicit caller-provided inputs/hooks. The substitution
  counter is therefore only incremented when a caller supplies `resident` and
  score observations; no residency behavior is faked.
- `StallUnion` is a real mutex-protected interval union, but it is zero until
  an integration calls the new stall hooks. `PrefillTally` closes supplied
  cumulative counters; existing llama perf data has no flash/stall/mgmt
  counters to populate them automatically.
- COOLMODE is represented as a selected engine plus `decode_requires_reload`;
  the current governor cannot reload model/context ownership itself. It
  returns non-sticky `-2` so the caller can recreate the governor under the
  selected CPU/GPU launch configuration.
- Automatic chunking supports token-backed batches. Embedding batches return
  non-sticky `-2` because the existing public `llama_batch` has no embedding
  stride, and guessing one could corrupt the input.
- Legacy `llama_governor_init` remains policy-disabled for compatibility; v0.2
  callers use `llama_governor_init_with_params` and must submit thermal polls.
- No full test suite, device run, or git push was performed.

## FIXES — hostile audit APPLY

- LOWBAT recovery and inclusive exits:
  `src/llama-governor-policy.cpp:84-86` now reads:
  > `return temperature <= exit_temperature && dwell_elapsed(now_ms);`
  `src/llama-governor-policy.cpp:124-127` now reads:
  > `if (dwell_elapsed(now_ms)) {`
  > `    state_ = classify(temp);`
  > `}`
- Golden coverage:
  `tests/test-governor-v02-router.cpp:128` — “WARM exits at the inclusive
  36.0 boundary”; `:134` — “COOL exits at the inclusive 36.5 boundary”; and
  `:140` — “CRITICAL exits at the inclusive 34.0 boundary”. Lines `:144-154`
  cover LOWBAT entry, pre-dwell recovery, and post-dwell reclassification.
- Wrapper/threading coverage:
  `src/llama-governor.h:13-15` now reads:
  `// Threading contract: decode(), set_thermo_profile(), record_telemetry(),`
  `// note_expert_route(), and stats() are decode-thread methods and must not overlap.`
  `// stall_enter()/stall_exit() are the only worker-thread callbacks; they are mutex-protected.`
  `src/llama-governor.cpp:16-22` supplies a model-free internal governor for
  host-side runtime seam coverage; it does not create contexts or alter the
  model-backed constructor.
  `tests/test-governor-v02-router.cpp:242-259` calls the C wrappers for
  thermal state, telemetry, StallUnion, and expert-route counting.
- Additional local commits: `fb67821b8` (`fix(governor): repair thermal exit
  boundaries`) and `1a33da0f6` (`test(governor): cover runtime wrapper
  callbacks`).
- Fix verification: `cmake --build build-router --target
  test-governor-v02-router` PASS, real exit `0`; direct
  `build-router/bin/test-governor-v02-router` PASS, real exit `0`; targeted
  CTest PASS, 1/1, real exit `0`. Output: `router_v02_golden=PASS`,
  `router_v02_metrics=PASS`.
