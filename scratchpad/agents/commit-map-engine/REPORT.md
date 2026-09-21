# The engine repository: what has been done, commit by commit

Reconnaissance of `Aspis0/kalsallama`, read-only, via `git -C` against
`/Users/marco/Projects/kalsallama`. Branch `b11010-merge`, current tip
`2a290390d67311b580ef398fd545e6d060b39897`, plus the four side branches named in the
mission. Mapped against `PLAN.md`, `analysis/GOVERNOR-DEVICE-PLAN.md` (Part 5 defects
5.1-5.6, Part 9 order of work) and `docs/ALIVE.md` (engine release pipeline). Every claim
below carries a `file:line`, a commit hash or a CI run id.

Note on the two anchors in the mission. `b11010-merge` (tip `2a290390d`) and the shipped
pin `8537d097c` are different snapshots of the same branch, and the mission's own figures
(279 non-merge commits, ~72 ours) belong to `8537d097c`, not to `2a290390d`. Both numbers
are given throughout so the two are never confused:

| snapshot | non-merge commits since 2026-09-04 | of ours (Marco Gualtieri) | merge commits by us |
|---|---|---|---|
| `8537d097c` (shipped pin, `PLAN.md` "Engine release") | 279 | 72 | 10 |
| `2a290390d` (`origin/b11010-merge`, current tip) | 296 | 89 | 11 |

The 17 extra ours are the release-pipeline and server work of 2026-09-20/21.

---

## 1. Answer first

### 1.1 The number, and what the branch is mostly made of

89 non-merge commits of ours since 2026-09-04 on the current tip. Exactly 72 of them are
ancestors of `8537d097c`, the commit the app pins; the other 17 landed after that pin.

The branch is **mostly an upstream import**. Of the 296 non-merge commits since 2026-09-04,
206 are upstream llama.cpp work by other authors, 89 are ours, and 1
(`ba33d8b04`, `cli: duration-only phase stamps behind KALSA_PHASE_STAMPS`, 2026-09-15) is by
the `kalsa-orchestrator` identity. The import entered in two lumps, behind merge commits of
ours:

- `3f3558b3b` `Merge upstream snapshot 2026-09-04 (844 commits) into kalsa fork` - 844
  upstream commits brought in at once (`git rev-list --count 3f3558b3b^1..3f3558b3b^2` = 844).
- `6b6d4a980` `Merge tag 'b11010' into b11010-merge` - the upstream tag `b11010`
  (`4bc272fd7`, 2026-09-16). The tags `b11044`-`b11053` in this repo are upstream tags too,
  so "b11010-merge" means "the branch created from `2361be359` with upstream tag b11010 on
  top", not a Kalsa version.

Everything else of ours is small: the median of ours changes 2 files, and 37 of the 89 are
single-file changes.

### 1.2 The three biggest things it accomplished

**(a) A working two-context, per-phase router ("governor v0").** `40051f8ae` created the
policy, runtime, metrics files and the `llama_governor_params` struct; `bb336bdc1` moved
batch partitioning into `src/llama-governor-runtime.cpp`; `73f5fe92f`..`ba296167c` added a
KV commit primitive, shared-cell support, hybrid-memory handoff, staged-V transfer and a
route-cost query; `e9dffddee` added `tools/governor-bench/`. It is validated on CPU golden
tests and on one device cell: `scratchpad/agents/qdc-8elite-governor-crossbackend/REPORT.md`
(QRD8750 / 8 Elite, LFM2.5-2.6B, entry #38) reports TTFT 1434/1470 ms for the governor arm
against CPU 16476/14412 ms, decode at or above CPU, and commit cost 1.80%/1.98% of prefill.

**(b) The engine release pipeline, end to end.** `bd1c9510c`..`2a290390d` build a
Kalsa-owned macOS `kalsa-server`, verify it (double pack, sha256 comparison, `@rpath`
closure), and publish it to Cloudflare R2. Two immutable tags exist and are verified
independently here: `kalsa-server-v1.0.0` -> `4ccef2f85`, tag object `d30c8d475`; 
`kalsa-server-v1.1.0` -> `2a290390d`, tag object `c105c2182`. Runs verified via the API:
`35549848243` (v1.0.0, `workflow_dispatch`, success), `35565687271` (v1.1.0, push on tag,
success), `35564859661` (green branch push at the tagged commit, success). The same window
produced the server-side work the pipeline ships: `X-Kalsa-Cache-Salt` namespaces
(`f44560d66`), context checkpoints inside slot save files (`51b9e6a7f`), atomic slot saves
(`45a0016e9`, `67c0be86b`) and the `X-Kalsa-Slot` inlet (`c2ebfc164`).

**(c) Adreno OpenCL correctness.** The q4_0 GEMM product moved to f32 (`33c3817c4`, re-applied
as `513bf4cea` after a merge lost it), the same treatment extended to q4_K (`67c73d26c`), the
batched-view MUL_MAT redirected to the generic f16 kernel (`2f3b24dee`), the
`get_scale_min_k4` masks passed as kernel arguments in two more MoE kernels (`2361be359`,
`26c7affb7`), and the padded-grid store tails guarded across six GEMV kernels
(`754a96426`, `738346fd6`). Measurements exist for the first two: cell
`scratchpad/agents/qdc-750-mulmat-view/REPORT.md` (MUL_MAT 905/20 FAIL -> 925/0) and cell
`scratchpad/agents/gemm-f32-ship/PLAN.md:13` (median KLD 0.4538 -> 0.004736). The last two
were never measured on a device.

### 1.3 What it did NOT do

Stated against Part 5 and Part 9, verified against the tip `2a290390d`:

- **5.2 (the charger) is untouched.** `src/llama-governor-policy.cpp:63` still returns false
  from `profile_is_valid()` unless `profile.t_idle_valid` when `plugged`. No engine commit
  touches the parser half of 5.2 either: there is no JSON parsing of governor params in this
  repo (`git grep -n 'json' src/llama-ext.h` finds nothing), so `cpp/rn-governor-params.cpp`
  in the binding fork is the whole parser and nothing here moves it.
- **5.3 (the battery floor) is untouched.** `src/llama-governor-runtime.cpp:65-68` still sets
  `prefill_route_ = prefill_route::GPU` on the `requested == CPU` / `Admit` path, and
  `:190-191` routes that to `ctx_prefill`. A low-battery prefill still runs on the GPU context
  while telemetry says CPU.
- **5.5 (the 1-token remainder) is still live, and we introduced it.** `bb336bdc1` added
  `if (count <= 1) { return -2; }` (`src/llama-governor-runtime.cpp:67-68` at that commit,
  `:97-99` at the tip). Prompts of 129/257/385 tokens still leave a remainder of 1 and still
  return `-2`.
- **5.6 (CRITICAL has no exit) is untouched.** The unplugged threshold tuple is still
  `{ 38.0f, 36.0f, 39.5f, 36.5f, 42.0f, 34.0f }` at `src/llama-governor-policy.cpp:44`, with
  `critical_exit = 34.0` colder than `warm_exit = 36.0` (field order in
  `src/llama-governor-policy.h:45-52`); `k_kill_c = 43.0` (`:12`) is unreachable because
  `classify()` tests `temperature >= k_kill_c || >= limits.critical_enter` and
  `critical_enter` never exceeds 42.0 (`:46-49`).
- **5.1 only half done.** `a6642b73d` changed *which* engine the refusal falls to (CPU
  instead of the prefill context), but the refusal still changes engine rather than reducing
  tokens and declaring a pause (`src/llama-governor-runtime.cpp:55-63`).
- **5.4 untouched.** `select_decode` still requires the same thirteen clauses
  (`src/llama-governor-policy.cpp:238-242`), including `generation == V73` while the app
  enables V75/V79. The engine default for `reload_budget_available` is `true`
  (`src/llama-ext.h:259`), so whether the clause is satisfiable is decided by the app.
- **No Part 2b shape refactor.** Rule 1 (device identity never enters a decision) is not
  implemented: `generation` still branches inside the policy at
  `src/llama-governor-policy.cpp:163-176` and `:240`. No commit removes those branches.
- **No Part 1 probes.** No file under `src/` or `ggml/` mentions `gpubusy`, `scaling_max_freq`
  or `kgsl` at the tip; the four probes the plan asks for do not exist.
- **No Part 4 calibration, no NPU lane.** `npu_lane_enabled` defaults to `false`
  (`src/llama-ext.h:252`) and no commit sets it; `prefill_token_cap()` is gated on it
  (`src/llama-governor-policy.cpp:261-263`).
- **No repack work.** No commit of ours adds a line containing `repack`.
- **No gate is claimed.** Neither the commits nor the plan assert G2; the governor work here
  starts the loop the owner's 2026-09-21 decision asked for, it does not close G2.

---

## 2. The topic-grouped map

Every commit of ours appears exactly once, in one of the groups A-M. "Serves" names a gate
(G0-G4), M1, a Part 5 defect, a plan part, the release pipeline, or UNMAPPED.

### Group A - governor core: policy, runtime, thermal (14)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `40051f8ae` | feat(governor): implement tri-engine runtime contract v0.2 | Adds `src/llama-governor-policy.{cpp,h}`, `llama-governor-runtime.cpp`, `llama-governor-metrics.{cpp,h}` and the `llama_governor_params` / `llama_governor_thermo_profile` structs in `src/llama-ext.h`. Introduces `get_thresholds()`, `classify()`, `prefill_engine()`, `admit_prefill()`, `select_decode()` and the constants `k_table_tokens`, `k_cpu_delta_c`, `k_warn_c`/`k_limit_c`/`k_kill_c`. | Part 2 (how the governor decides). It also **creates defects 5.1, 5.3, 5.4 and 5.6 inside this lineage**: the files did not exist at `40051f8ae^` (`git show 40051f8ae --diff-filter=A`). It moves no defect, it establishes them. |
| `bb336bdc1` | fix(governor): partition admitted token batches safely | Moves prefill partitioning from `src/llama-governor.cpp` to the new `src/llama-governor-runtime.cpp`, re-admitting before each chunk and refusing at `if (count <= 1) return -2;`. | Part 2 (chunking). **Introduces defect 5.5**: the guard is new (its parent loop used a fixed `admission.tokens` and executed a 1-token tail). |
| `a945d531b` | fix(governor): repair thermal exit boundaries | Adds `dwell_elapsed()` (a 10-minute `k_dwell_ms`) and a LOWBAT exit that reclassifies after the dwell; changes `can_leave()` to `temperature <= exit_temperature`. | Part 2. Touches the state machine around 5.6 but does not fix it: the tuple at `:44` is unchanged, so `critical_exit < warm_exit` survives. |
| `e131345b7` | governor: expose init failure reason, fix friend/ctor access | Adds `llama_governor_init_with_params_internal(..., std::string * failure_reason)` and `failure_reason()` so the binding can see why init failed without a second log line. | Part 9 step 3 precondition (a failing probe must be legible). Not a Part 5 defect. |
| `6f0a33c0d` | fix(governor): admit safe final prefill tails | Adds the `table == 0` branch in `admit_prefill`: a prompt shorter than `k_table_tokens[0]` is admitted whole instead of refused. | Part 9 step 8 / defect 5.5 - a **partial** move: the policy now admits a 1-token tail, but `bb336bdc1`'s runtime guard still rejects it. |
| `e1a0f5028` | governor: decode prefill batches in admitted chunks | Makes the router carry the chunked-prefill result through `k_prefill_chunked` so prefill chunks decode in the prefill context instead of failing. | Part 2 (chunking executed, not only computed). Defect 5.5 context. |
| `6ed44f567` | governor: expose prefill timing and route facts | Adds `prefill_us`, `prefill_n`, `prefill_ctx_ngl`, `prefill_chunks[128]` to `llama_governor_stats` and `llama_governor_reset_prefill_stats()`. | Part 6 instruments: the governor reporting its own route is the weakest evidence class the plan names, so this is instrumentation, not proof. |
| `135232fa0` | governor: use dedicated prefill chunk sentinel | Changes the internal control value from `1` to `-1001` so it cannot be mistaken for a native decode return. | Part 2 hygiene. UNMAPPED beyond that. |
| `8f939aa7d` | governor: enable measured V79 GPU prefill | Extends `prefill_engine()`'s GPU arm from `V75` to `V75 || V79`, with a comment citing the 8 Elite measurement. | Part 3.1 (Xiaomi profile). It *extends the table*, which is the pattern Part 0.3 criticises; it does not remove it. |
| `3a161adfc` | governor: clear both KV stores | Adds `llama_governor_clear_cache()`, clearing both contexts' memory and resetting both watermarks and the commit counters. | Part 9 step 1-3 precondition and the session/restore contract (G2 "recovery without corruption"). |
| `a6642b73d` | governor: route Wait/CPUFallback prefill to the decode context | On `Wait` or a hot `CPUFallback`, the first prefill batch of a turn pins `prefill_route_ = CPU` and the batch goes to `ctx_decode`. | **Defect 5.1, half** - the fallback is no longer the prefill (GPU) context. It does not implement "reduce tokens, declare the pause". |
| `39c35bd1e` | governor: reset prefill route per turn, keep CPU label, assert generation | Resets `prefill_route_` per turn and keeps `stats_.prefill_engine` honest when the route was pinned to CPU. | Part 6 instrument honesty; touches the same lines as 5.1/5.3 without changing the routing decision. |
| `2a8601c16` | fix(governor): three failing tests, one cause - hybrid memory was cast away | Adds `llama_kv_context_attn_cache()` and routes all commit paths through it, so a hybrid memory is never `dynamic_cast` to `llama_kv_cache` directly. | Part 9 step 7 groundwork (hybrid phones). Not a Part 5 defect. |
| `9c28322ac` | governor: bench_force_gpu_prefill lever | Adds `bench_force_gpu_prefill` to the params and a `prefill_engine()` early return when `gpu_fit == Fit`; default off. | Part 6 instrument (bench-only forcing), explicitly not a product behaviour: "production leaves it false" (`src/llama-ext.h`). |

### Group B - governor tests (5)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `764687712` | test: add governor v0 state handoff harness | Adds `tests/test-governor-v0.cpp`: two CPU contexts, `llama_state_seq_get/set` handoff, byte accounting. | Part 2b acceptance criterion ("the test is written *with* the refactor") - the first stone. |
| `1acb5ef97` | test: harden governor v0 audit coverage | Switches the test to `llama_build_and_test`, tokenises via `common`, separates copied vs restored bytes, adds a logits comparison. | Part 2b tests. |
| `d4f377f9c` | test: reject non-finite governor logits | Treats a non-finite logit delta as an infinite difference instead of letting `std::max` hide it. | Test correctness. |
| `8665e9a9f` | test(governor): cover runtime wrapper callbacks | Adds the C wrapper `llama_governor(llama_governor_params)` constructor and router tests for the inclusive exit boundaries and LOWBAT dwell. | Part 2b tests; also documents the threading contract of the decode-thread methods. |
| `28b8db177` | test(governor): add v0.2 router golden tests | Adds `tests/test-governor-v02-router.cpp`, 243 lines of golden cases over the policy. | Part 2b tests. |

### Group C - KV commit, shared cells, hybrid, staged V, cross-backend bench (14)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `6f3881baf` | feat: generalize shared KV cells | Removes the Gemma4-only `ctx_other` gate (any non-null `ctx_other` is now honoured), turns the `static_cast` on shared memory into a `dynamic_cast` with a throw, and forbids a mismatched `kv_size`. | Part 9 step 7 groundwork. Not a Part 5 defect. |
| `21d3154df` | fix: fence shared KV cache operations | Re-allows a `kv_size` override when a `share` callback is supplied, and fences `clear`, `seq_cp`, `seq_keep`, `seq_div`, `init_batch` and `prepare` from a shared cache with an explicit error. | Part 9 step 7 groundwork. |
| `73f5fe92f` | governor: add KV cache commit primitive | Adds `src/llama-kv-commit.{cpp,h}` with `llama_kv_route_query()` and `llama_kv_commit()`; copies a K/V range between two caches. | Part 2 (the handoff the router needs) and the session contract. |
| `c51cb45f4` | governor: harden KV route compatibility | Replaces the field-by-field `compatible()` with one predicate including per-layer shapes, adds `shares_cells()`, and makes `Direct` require shared cell metadata. | Part 2. |
| `5e0db23ca` | governor: add phase-routing object | The first version of `llama_governor_init/decode/get_context` on two independent contexts; route by batch size. | Part 2. |
| `f2fa43207` | governor: add attach-once instrumentation | Adds `llama_governor_stats` (reused ubatches, splits, graph builds, commit bytes/us/count) and wires `llama_kv_commit_with_stats`. | Part 6 instrument. |
| `12c6dbefa` | governor: count graph builds by ubatch | Counts graph builds as `ubatches_submitted - n_reused` and documents that `n_reused` counts ubatches, not calls. | Part 6 instrument honesty. |
| `dadafd290` | governor: support hybrid memory handoff | Adds `src/llama-hybrid-commit.{cpp,h}` and extends the commit primitive to recurrent state, comparing shapes and element types before copying. | Part 9 step 7 groundwork (hybrid = LFM2.5, the shipping model). |
| `6826ec761` | tests: fix hybrid handoff count oracle | Corrects the expected commit count to `2 * prompts.size() - 1` and asserts a lower bound on bytes. | Test correctness. |
| `408aabb67` | tests: account exact hybrid commit bytes | Computes `kv_bytes_per_token()` and `recurrent_bytes_per_commit()` in the test and records that a delta-net hybrid copies a fixed ~52.7 MB (99.65% of qwen35 bytes) per commit, so the `<2%` commit gate is not trustworthy for short prefills. | Part 6 / Part 4 caution, banked in code. |
| `9ab716ae1` | feat(governor): stage transposed V commits | Adds `src/llama-kv-staged.{cpp,h}` and `llama_kv_route_query_cost()`, so a transposed-V commit can stage through device buffers instead of naive gets. | Part 2 (the transfer the 8 Elite cell measures). |
| `7006b35c0` | fix(governor): bound staged graph cache | Clears the staged plan's `graphs` after each commit so device staging buffers do not accumulate with conversation length. | Part 2 memory bound; a leak fix. |
| `ba296167c` | feat(governor): route phases across devices | Adds the naive/staged mode choice at governor construction, refuses incompatible KV routes at init, and counts naive vs staged commits. | Part 2. |
| `e9dffddee` | feat(governor): add cross-backend benchmark and honest transfer stats | Adds `tools/governor-bench/` and separates K from V transfer counts, with staged selection keyed on the same `v_trans` predicate the mirror path uses. | Part 6 instrument: this is the harness that produced cell `qdc-8elite-governor-crossbackend`. |

### Group D - measurement and timing plumbing (4)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `e31b9144c` | perf: reset async prompt-timing state in llama_perf_context_reset | Calls `synchronize()` and zeroes `t_compute_start_us` / `n_queued_tokens` on reset, so queued work cannot be counted twice. | Part 6 instrument correctness (a bad reset poisons every phase measurement). |
| `3f71159fd` | test: perf-reset asserts non-zero prompt timing and no idle carry-over | Adds `tests/test-perf-reset.cpp` coverage that the reset yields non-zero prompt timing and no carry-over after a 300 ms idle. | Part 6 instrument. |
| `fa64f181a` | mtmd-cli: unconditional phase timing line for measurement cells | Prints `KALSA_VL_TIMING eval_message_ms=... decode_ms=... n_predict_requested=...` on every generation. | Part 6 instrument (vision cells). Unmapped to a Part 5 defect. |
| `2998ad5d6` | fix(cli): silence phase stamp failures | Deletes the two `fprintf(stderr, "warning: KALSA_PHASE_STAMPS: failed to open/write ...")` lines. | UNMAPPED. It removes warnings that `ba33d8b04` (author `kalsa-orchestrator`, 26 minutes earlier) had added; a pair where ours undoes part of someone else's commit. |

### Group E - OpenCL kernels (12)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `33c3817c4` | opencl: compute the Adreno q4_0 GEMM product in f32 | `gemm_noshuffle_q4_0_f32.cl`: `half8` accumulator -> `float8`, with `convert_float8(B) * (float)w` at each of the four nibble positions. | Part 3.1 GPU correctness (GPU prefill on V75/V79). Measured: cell `gemm-f32-ship`. |
| `513bf4cea` | opencl: compute the Adreno q4_0 GEMM product in f32 | The **same patch** as `33c3817c4` (identical stable patch-id `a65b1afb74e0a3809f4d4354eff3e1a78d3b32e1`), re-applied on the `kalsa/opencl-picks` lineage after the merge `3bec271fd` lost it. | Part 3.1. See finding 4.1. |
| `67c73d26c` | opencl: compute the Adreno q4_K GEMM product in f32 | The same product/accumulator change in `gemm_noshuffle_q4_k_f32.cl`, carrying an explicit comment that the q4_K gain and cost are **not** measured. | Part 3.1. Never measured for q4_K; the commit says so. |
| `2f3b24dee` | opencl: use generic f16 kernel for Adreno batched view MUL_MAT | Routes `ADRENO && !ggml_is_contiguous(src0)` f32 src1 to `kernel_mul_mat_f16_f32` with `nrows = 4` instead of the batched path. | Part 3.1 GPU correctness. Measured: cell `qdc-750-mulmat-view`, MUL_MAT 905/20 FAIL -> 925/0. |
| `70b4302bb` | fix(opencl): close the two blocks the 2026-09-04 merge broke | Removes a duplicated `if (ne11 * ne12 < 4) {` that the merge left in `ggml_cl_mul_mat` (a brace-unbalanced duplicate), and restores the missing `CL_CHECK(clReleaseProgram(prog)); GGML_LOG_CONT("."); }` after the q3_K MoE kernel creation in `load_cl_kernels`. | Build integrity after the upstream merge. UNMAPPED to a plan item; it is merge repair. |
| `26c7affb7` | opencl: fix the build of kernel_gemv_moe_q4_k_f32_ns_wimg | Adds `mask_d6/mask_d4/mask_hi2` to the `_wimg` GEMV signature and its `get_scale_min_k4` call. | Part 3.1 MoE correctness on GPU. Build fix; not measured. |
| `2361be359` | opencl: pass the get_scale_min_k4 masks as kernel args in the q4_K dp4a MoE GEMM | Adds the three masks to `gemm_moe_q4_k_q8_1_dp4a.cl` and binds them at arg indices 14/15/16 in `ggml-opencl.cpp`. | Part 3.1 MoE correctness. Extension of `c1bb48d32` (2026-08-20, `Saurias92`) to a kernel that fix did not cover; the commit message states the measurement is the earlier one and that this kernel was never measured. |
| `754a96426` | opencl: guard the padded-grid dst stores in the q4_K/q6_K noshuffle GEMV tail | Adds `if (gid * 2 + 0 < M)` guards to the GLU GEMV and the mc3 variants, plus a hard `#error` when `GGML_OPENCL_USE_ADRENO_BIN_KERNELS` is enabled. | Part 3.1 GPU correctness (out-of-bounds store). Never measured; see finding 4.2 for its `#error`. |
| `738346fd6` | opencl: guard the remaining padded-grid store tails | Same guard class for `gemv_noshuffle_q4_0/q4_1/q4_k/q5_k_f32.cl`, including the split-K partial buffer. | Part 3.1 GPU correctness. Never measured. |
| `cf1bc2395` | opencl: drop the over-broad bin-kernel #error | Removes the `#error` added by `754a96426` and replaces the false comment with a host-side skip plus what is verifiable about the X2-targeted external ILA library. | Engine release / build integrity. A decision *about* a kernel, not a kernel change. |
| `8e081313f` | ggml-opencl: relocate KALSA diagnostic scaffolding to a new file pair | Moves 17 diagnostic/experiment helpers out of `ggml-opencl.cpp` into `ggml-opencl-kalsa-diag.{h,cpp}` (-329/+337 lines) and registers the new TU in `ggml-opencl/CMakeLists.txt`. | Kernel work hygiene (the plan's "prefer reusing existing infrastructure"). UNMAPPED to a gate. |
| `f6ba2786d` | fix(opencl): set OpenCL target version in relocated KALSA diag TU | Defines `CL_TARGET_OPENCL_VERSION` / `CL_USE_DEPRECATED_OPENCL_1_2_APIS` before any `CL/cl.h` include in the new TU. | Build correctness of `8e081313f`. UNMAPPED. |

### Group F - bmoe engine core (2)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `e1866612d` | move bmoe engine core into src/bmoe/ | Adds 22 files under `src/bmoe/` (config, expert stream source, router hook, platform IO, ...), 6892 lines, plus a `file(GLOB ...)` in `src/CMakeLists.txt`. The name-status is 22 `A` and 1 `M`: **nothing was deleted**, because the tree at `e1866612d^` contains zero files matching `bmoe`. | M3 (the large-MoE streaming perimeter). Not in the M1 critical path. See finding 4.3 for the message. |
| `8537d097c` | bmoe: build under minSdk 23 and under -Werror | Guards `AHardwareBuffer_*` behind `#if defined(__ANDROID__) && __ANDROID_API__ >= 26` (two places) and fixes a `RouterHook::predict_at_topk` signature mismatch. | M3 build. This is the shipped pin, so it is also the release identity. See finding 4.4 for the "-Werror" half. |

### Group G - hexagon / NPU judge and test infrastructure (6)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `28b9a1351` | hexagon: add NPU v79 judge diagnostics and error propagation | Adds an `error_count` per session, drained at graph completion so `GGML_STATUS_FAILED` is reported, and 349 lines of `test-backend-ops` judge scaffolding (`GGML_TEST_PLAIN_HOST`). | Part 3.1/3.3 NPU lane, and G3's rule "NPU without evidence stays out" - this is the evidence machinery, not the lane. |
| `ff7ae8009` | tests: tighten NPU judge failure reporting | Reports a non-`SUCCESS` `ggml_backend_graph_compute` status explicitly instead of falling through. | Same. |
| `15ad4b8e3` | hexagon: gate HMX eligibility on logical ne01 %32 | Changes the host gate from padded N to `src0->ne[1] % 32` as well. | Part 3.1 NPU lane correctness. |
| `9a36bf779` | tests: GGML_TEST_EXTRA_MM appends parameterized MUL_MAT cases | Parses `GGML_TEST_EXTRA_MM=type:m,n,k;...` and appends those cases to `test-backend-ops`. | Part 6 instrument (framework for the kernel sweeps). |
| `8b86f9f75` | tests: EXTRA_MM_FIRST prepend; htp: HTP_ZERO_TILE_PAD diagnostic pad zeroing | Adds `GGML_TEST_EXTRA_MM_FIRST` and a build-time-guarded zeroing of the HMX weight tile pad in `ggml/src/ggml-hexagon/htp/matmul-ops.c`, default off. | Part 6 instrument / NPU diagnosis. |
| `cf5510a99` | tests: close the Mellum2 perf scope block in make_test_cases_perf | Adds the two missing closing braces. | Build correctness. UNMAPPED. |

### Group H - MTP (2)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `98bee958d` | fix(mtp): the draft context died on a cache it could not share | Adds `has_mtp_weights()` and refuses an `LLAMA_CONTEXT_TYPE_MTP` context when `load_mtp` was false, instead of letting the MTP graph builders assert; adds `tests/test-governor-v0-mtp-hybrid.cpp`. | The binding's speculative/MTP path; supports the governor's two-context shape (a draft context on a hybrid target). Not a Part 5 defect. |
| `237461a98` | fix(mtp): the denial log was a level the binding renders as info | Raises the "not sharing cells" message to `LLAMA_LOG_WARN` because the binding maps anything below it to "info". | Log-level contract with the binding. UNMAPPED to a plan item. |

### Group I - KV pressure ext API (3)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `9586bf985` | ext: proactive KV pressure callback | Adds `llama_memory_set_pressure_callback()` (a `used_frac` callback fired before a batch, re-armed when utilisation drops), threaded through context, KV cache, iSWA and hybrid memory, plus `--debug-kv-pressure`. | The session/restore contract and G2's "recovery without corruption": compaction must start before a batch fails to fit. |
| `a29edcf49` | ext: kv pressure fixes from DeepSeek audit (F1, F2 + contract docs) | Clamps the trigger to `[0,1]` (anything else disables the hook), documents `used_frac` per memory type (worst stream; iSWA reports the base part only), and narrows the callback type. | Same. |
| `32282997e` | build: ship llama-ext.h with the SDK (audit F5) | Adds `src/llama-ext.h` to the installed headers and copies it in `build-xcframework.sh`. | Release pipeline (the ext API has to reach the binding). Answers audit F5. |

### Group J - small correctness fixes (2)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `592f68684` | fix(kv): llama-kv-cache-iswa.cpp throws std::runtime_error without <stdexcept> | Adds the missing include. | Build correctness. UNMAPPED. |
| `3efb44d6c` | fix(common): guard the threadpool function pointers before calling them | Warns and runs without a threadpool when a backend does not export the API, instead of calling null. | Build/runtime robustness. UNMAPPED. |

### Group K - repository documentation (7)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `ff1f14460` | docs: KALSA_FORK.md - branch map, two lineages, hexagon skels | Creates `KALSA_FORK.md` (47 lines): role, remote policy, branch table. | Repo hygiene. UNMAPPED to plan items; the plan's own repo map lives in the app's `REPOS.md`. |
| `df6ee148c` | docs: KALSA_FORK.md - record cann-off tip 3cfe5ddab | Updates the branch table to the post-CANN-disable tip. | Same. |
| `b617e4efc` | docs: KALSA_FORK.md - do not self-pin HEAD hash | Stops writing the branch's own HEAD into the table. | Same. |
| `550b4796f` | docs: KALSA_FORK.md - governor-v0 pushed at cff0a4a75 | Records the push and notes that a later docs commit will move HEAD. | Same. |
| `4a1444ecd` | docs: KALSA_FORK.md - reconcile branch map after the 2026-09-16 consolidation | Records 18 local branches -> 3 and what `main` absorbed. | Same. |
| `2aca2adb0` | docs: KALSA_FORK.md - separate local main from origin/main | Notes the local `main` was 861 commits ahead of `origin/main` and unpushed. | Same. |
| `134a35cf2` | docs: KALSA_FORK.md - the salvage is merged; stop pinning main's hash | Records that the NPU salvage was cherry-picked, merged and the branch deleted. | Same. |

### Group L - server: slot, checkpoint, cache salt (7) - all POST (after the shipped pin)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `51b9e6a7f` | server : persist context checkpoints in slot save files | Appends a `"SCKP"` v1 appendix of context checkpoints after the llama state payload in a slot save file, plus `test_slot_save.py` coverage. | Engine release pipeline / G2 session contract (a recurrent state cannot be recreated from the final state alone). |
| `f44560d66` | server : add X-Kalsa-Cache-Salt prompt cache namespaces | Threads a `cache_salt` through `server_task` into the prompt cache load/store, and skips a slot whose cached prompt belongs to another namespace. | Release pipeline: `X-Kalsa-Cache-Salt` is the header the desktop/app must send, per the plan's bundling decision. |
| `82d38684f` | server : harden slot checkpoint appendix and extend salt coverage | Bounds the appendix (1024 records, 16 GiB per blob, 64 GiB total, plus a bytes-remaining check), verifies the written length against the file, and adds 340 lines of tests. | Same; write fault-injection is on the plan's ship-gate list. |
| `45a0016e9` | server : make slot saves atomic and reject unknown trailer data | Writes to a temp file and renames over the target, and throws on unknown bytes after the state payload instead of ignoring them. | Same. |
| `67c0be86b` | server : contain slot save failures and use exclusive temp files | Creates the temp file with `fopen(..., "wbx")` and a random suffix so a prearranged symlink cannot redirect the write, and contains save failures. | Same. Directly answers the plan's residual TOCTOU item. |
| `c2ebfc164` | server : add X-Kalsa-Slot header inlet | Reads a case-insensitive `x-kalsa-slot` header and uses it to override the request's `id_slot`; a non-integer value falls back to the body. | Release pipeline (the v1.1.0 inlet) and the desktop port contract. |
| `ac9a09dc6` | server : guard slot actions and prove the inlet adds no exposure | Narrows the header's contract so the value is consumed and never logged, echoed or metricked, and extends `test_slot_header.py`; changes the CI health probe to load a tiny model so Metal actually initialises. | Release pipeline. Its **workflow hunk is the first half of the Metal packaging work**, dropped later by `2a290390d`. |

### Group M - release pipeline and repo CI (11)

| commit | subject | what it changes | what it serves |
|---|---|---|---|
| `bd1c9510c` | ci : add Kalsa-owned macOS llama-server build workflow | Adds `.github/workflows/kalsa-server.yml` (161 lines): a macOS build producing `llama-<version>-bin-macos-<arch>.tar.gz`. | Release pipeline. |
| `add4e4937` | ci : brand the macOS server artifact as kalsa-server | Renames the packaged binary to `kalsa-server` (the CMake target stays `llama-server`) and renames the artifact. | Release pipeline. |
| `c8dff98b0` | ci : harden version, packing and RPATH checks | Derives the build number from `git rev-list --count HEAD`, allowlists the ref name before it reaches shell (length and character checks), double-packs and compares sha256, verifies every Mach-O's `@rpath` closure. | Release pipeline; it closes the `workflow_dispatch` input-as-option hole the plan records. |
| `4ccef2f85` | ci : name tag builds after the tag and publish an immutable release | Adds the `release:` job with `contents: write` and `gh release create --verify-tag`, and refuses to overwrite an existing release. | Release pipeline. **This is the commit the tag `kalsa-server-v1.0.0` points to**, so its GitHub-release path is frozen into that tag. |
| `3a4d5143e` | ci : make the kalsa-server release self-contained | Removes the reusable UI workflow and all artifact uploads (the private-repo artifact quota), builds the UI inside the macOS job, and adds `workflow_dispatch` with `release_tag`. | Release pipeline. |
| `635ea0ed2` | ci(server): publish the verified engine to R2 instead of a GitHub release | Replaces the release job with R2 publication (`head`/put/list scoped token), adds the `force` input and the `KALSA_MATRIX_PAIRS` identity check. | Release pipeline; the R2 move documented in `docs/ALIVE.md`. |
| `f404d9180` | ci(server): fix the R2 emptiness check to use KeyCount | Replaces the listing heuristics with a `key_count()` helper built on `aws s3api list-objects-v2 --query 'KeyCount'`. | Release pipeline. **Its own production run failed on this**: see finding 4.5. |
| `916b8f0bc` | ci(server): decide the R2 existence check with head-object | Throws the KeyCount approach away and decides on three `head-object` calls, with the listing demoted to advisory. | Release pipeline; the shape that actually works (`docs/ALIVE.md`, "Published state"). |
| `c71977809` | ci : ship precompiled Metal libraries in the kalsa-server archive | Builds with `GGML_METAL_EMBED_LIBRARY=OFF`/`GGML_METAL_NDEBUG=ON`, packs `default.metallib` and (SDK >= 26) `ggml-tensor.metallib`, and adds a fail-closed health probe. | Release pipeline, Metal half. **Reverted for the release path by `2a290390d`.** |
| `2a290390d` | ci : drop the Metal packaging work from the kalsa-server release path | Removes the metallib build and the new probe from the workflow, restoring `GGML_METAL_EMBED_LIBRARY=ON` (+4/-179, `tools/` untouched). | Release pipeline; this is the current tip and the v1.1.0 tag target. |
| `f52c481ab` | ci: stop auto-running Huawei CANN workflow on this fork | Removes the `push`/`pull_request` triggers from `.github/workflows/build-cann.yml`, leaving `workflow_dispatch`, and records the reason in `KALSA_FORK.md`. | Repo CI hygiene (Actions minutes). UNMAPPED to a plan gate. |

### Merges of ours (11, listed for completeness; not counted in the 89)

`3bec271fd` (opencl-picks into governor-v0.3), `b51d1e055` (kalsa/gemm-f32-mul),
`348cc9546` (ci/android-bench), `1ab6e0582` (kalsa/adreno-kqkv-viewoffs), `14d4e0612`
(kalsa/energy-phase-stamps), `67a9098cb` (kalsa/kv-pressure), `3f3558b3b` (upstream snapshot,
844 commits), `e0277a37e` (kalsa/upstream-merge-wip), `bc6729409` (NPU v79 judge salvage),
`6b6d4a980` (upstream tag `b11010`), `b255b9f57` (server workflow + checkpoint persistence +
cache_salt, octopus with `c8dff98b0` and `67c0be86b`).

---

## 3. Numbered answers

### 3.1 Which commits are on a branch that is NOT merged, and what each branch would add

Two of the four named branches contain **no commit absent from the tip**:

- **`kalsa-slot-and-metal` = `2a290390d`** - the same object as `origin/b11010-merge`
  (`git rev-list --count origin/b11010-merge..kalsa-slot-and-metal` = 0, and `..` the other
  way = 0). Its reflog shows it was created from `b11010-merge` at `8537d097c` on
  2026-09-20 21:19:03 and then received the same four commits
  (`916b8f0bc`, `c2ebfc164`, `c71977809`, `ac9a09dc6`, `2a290390d`). **It would add nothing.**
  The name is also now misleading: its tip is the commit that *drops* the Metal packaging
  (`2a290390d`, +4/-179 on `.github/workflows/kalsa-server.yml`).
- **`opencl-moe-masks` = `2361be359`** - an ancestor of the tip and identical to
  `origin/main`. Ahead 0, behind 228. **It would add nothing**; the two commits it is named
  for (`2361be359`, `26c7affb7`) are already in the shipped pin. This confirms
  `scratchpad/agents/docs-repo-cleanup-inventory/REPORT.md:26,80,543`.

The other two do carry commits:

- **`mtp-ctx-other` = `284ea0f08`** (ahead 2, behind 232). It adds:
  - `284ea0f08` `fix(mtp): the draft context died on a cache it could not share` - an
    **earlier variant** of the commit that was merged as `98bee958d` (different patch-id
    `d26694827f...` vs `56ed51ed78...`; 61 lines in `llama-model.cpp` vs 55). Nothing lost.
  - `07e081f2b` `fix(mtp): a dense MTP draft on a hybrid target asked to share cells it cannot
    read` - the only unique commit on any side branch. It passes `nullptr` instead of
    `params.mem_other` at one `llama_kv_cache_iswa` construction.
  - **What it would add: nothing functional.** The tip achieves the same result by a different
    route: `src/llama-model.cpp:2705-2706` computes
    `mem_share_iswa = dynamic_cast<llama_kv_cache_iswa *>(params.mem_other) ? params.mem_other : nullptr;`
    and the non-GEMMA4_ASSISTANT branch at `:2778` passes `mem_share_iswa`, so a hybrid
    target already yields `nullptr`. Merging `07e081f2b` would be a no-op or a conflict.
- **`bump-rehearsal-tmp` = `50a00c78e`** (ahead 48, behind 19). **Zero of ours**: every one of
  the 48 unique commits is upstream-authored (hexagon I32 GET_ROWS / GEGLU_QUICK / TOP_K /
  ROLL / im2col / HMX FA head_dim 72, `metal: add MoE and SSM_CONV fusion optimizations
  (#28948)`, opencl bin kernels, vulkan IQ3_S, sycl, ci). It is an upstream-bump rehearsal: it
  merges `upstream/master` onto a branch whose merge-base with the tip is `f6ba2786d`
  (`b33bea25b` merges upstream; `50a00c78e` then merges our `e1866612d`). It does **not**
  contain `8537d097c`. **What it would add if merged: the next 48-commit upstream window** -
  it is a rehearsal proof, not a merge candidate, because it lacks the tip's 20 commits.

### 3.2 Commits that touch the GOVERNOR specifically, and which defect each moves

Files that are the governor: `src/llama-governor-runtime.cpp`, `src/llama-governor-policy.{cpp,h}`,
`src/llama-governor.cpp`, `src/llama-governor.{h}`, `src/llama-governor-metrics.{cpp,h}`.
Params: `llama_governor_params` / `llama_governor_thermo_profile` in `src/llama-ext.h`.
**The params parser is not in this repo** - `git grep -n 'json' src/llama-ext.h` returns
nothing, so the JSON -> struct parsing is entirely `cpp/rn-governor-params.cpp` in
`Aspis0/llama.rn`, and **no commit here touches it**.

| commit | files | Part 5 defect | verdict |
|---|---|---|---|
| `40051f8ae` | policy (A), runtime (A), metrics (A), `llama-ext.h` | 5.1, 5.3, 5.4, 5.6 | **Creates them.** The policy files did not exist before this commit. Also introduces `k_cpu_delta_c` and the `{38,36,39.5,36.5,42,34}` tuple. |
| `bb336bdc1` | runtime | **5.5** | **Introduces it**: `if (count <= 1) return -2;`. Also changes 5.1's execution path (prefill now re-admits per chunk). |
| `a945d531b` | policy | 5.6 (neighbourhood) | Touches the state machine (`can_leave` becomes inclusive, LOWBAT gains a dwell exit) but leaves the inverted `critical_exit < warm_exit` ordering and the dead `k_kill_c` in place. Net: **no defect moved**. |
| `e131345b7` | runtime, `llama-governor.cpp/h` | none | Init-failure propagation. No defect moved. |
| `6f0a33c0d` | policy, runtime(tests) | **5.5** | **Partial move**: the policy now admits a tail shorter than 128 (`table == 0` branch, `src/llama-governor-policy.cpp:204-213`), but the runtime guard still rejects it. |
| `e1a0f5028` | runtime, `llama-governor.cpp/h` | 5.5 (context) | Makes the admitted chunks actually execute in the prefill context. No defect removed. |
| `6ed44f567` | runtime, `llama-governor.cpp/h`, `llama-ext.h` | 5.3 (telemetry) | Exposes `prefill_ctx_ngl` and the chunk list, so a route/telemetry mismatch is at least visible. The mismatch itself (5.3) is untouched. |
| `135232fa0` | `llama-governor.h` | none | Sentinel value. No defect moved. |
| `8f939aa7d` | policy | 5.4 (by extension) | Widens the `gpu_prefill_measured` table from V75 to V75|V79 in `prefill_engine()`. This is the table-as-measurement pattern Part 0.3 names; it is **extended, not removed**. |
| `3a161adfc` | runtime, `llama-ext.h` | none | `llama_governor_clear_cache()` for both contexts. Serves the session contract. |
| `a6642b73d` | runtime, `llama-governor.cpp/h` | **5.1 (half)**, 5.3 (untouched) | The refusal now pins the turn to the CPU context instead of the prefill context, so the fallback is no longer the hottest engine. It still does not reduce tokens nor declare a pause, and 5.3's inversion survives (`src/llama-governor-runtime.cpp:65-68` sets `prefill_route_ = GPU` on the `Admit` path). |
| `39c35bd1e` | runtime | 5.1/5.3 telemetry | Keeps `stats_.prefill_engine` honest when the route was pinned. Does not change the decision. |
| `2a8601c16` | `llama-kv-commit.cpp` (+ tests) | none | Hybrid-cast fix. Not a Part 5 defect. |
| `9c28322ac` | policy, `llama-ext.h` | none | `bench_force_gpu_prefill`, default off. |
| `764687712`, `1acb5ef97`, `d4f377f9c`, `8665e9a9f`, `28b8db177` | tests | none | Tests only; `8665e9a9f` also adds the C wrapper constructor. |

Thermal/power hooks: `llama_governor_thermo_profile` is touched by **one** commit,
`40051f8ae`. `set_thermo_profile` is touched by `40051f8ae`, `6f0a33c0d`, `e1a0f5028`,
`a6642b73d`, `39c35bd1e` and `8665e9a9f` - none of them changes the plugged/t_idle gate at
`src/llama-governor-policy.cpp:63`. So **no commit moves 5.2**.

Also of note for 5.4: `reload_budget_available` in the engine defaults to **`true`**
(`src/llama-ext.h:259`), while the plan describes the app writing it `false` by hand. Which
one wins is decided by the binding's parser, in the other repo.

### 3.3 Commits that touch the KERNELS, and the measured result each should produce

| commit | kernel | claimed / intended result | measured where |
|---|---|---|---|
| `33c3817c4` and `513bf4cea` | `gemm_noshuffle_q4_0_f32.cl` | The half *product*, not the accumulator, is what diverges: median KLD 0.4538 -> 0.004736, same-top-token 62.8% -> 94.8%, at a prefill cost of 0.659x. Adreno 750 / QRD8650. | **Measured.** Cell `scratchpad/agents/gemm-f32-ship` (`PLAN.md:13,124,160`, `REPORT.md:28`, `PREREG.md:50`); `scratchpad/agents/adreno-acc-type/AUDIT.md:12` holds the `0.453822` median-KLD reading and `d_run.sh:494` self-tests it. **Caveat:** `scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:322` records that the `0.659x` cost figure "failed its own validity gate (5.71 °C spread)". |
| `67c73d26c` | `gemm_noshuffle_q4_k_f32.cl` | The same product fix, explicitly *without* a number. | **Never measured.** The commit comment says so: "The q4_K fidelity gain and speed cost are NOT measured for this kernel. Do not infer q4_K measurements from q4_0." |
| `2f3b24dee` | `ggml-opencl.cpp` dispatch (f16 batched view MUL_MAT) | No FAIL on the f16/bf16 batched-view MUL_MAT family. | **Measured.** Cell `scratchpad/agents/qdc-750-mulmat-view/REPORT.md`: baseline `12f6d9b6d` MUL_MAT 905/**20 FAIL** -> candidate `2f3b24dee` 925/**0**; MUL_MAT_ID 407/407 unchanged, FLASH_ATTN_EXT 226/226, pp512 289.04 -> 289.59, tg128 22.67 -> 22.17. Device QRD8650 / Adreno 750, compiler E031.45.02.06. |
| `2361be359` | `gemm_moe_q4_k_q8_1_dp4a.cl` + host arg binds | The literal-mask `get_scale_min_k4` is what E031.41.03.62 miscompiles; masks as kernel args fix it. | **Measured only for other kernels.** The 0/80+0/4 -> 80/80+4/4 and MUL_MAT_ID 391/391 numbers belong to `c1bb48d32` (2026-08-20, `Saurias92`) and the four `*_ns f32` kernels, cell `scratchpad/agents/k2-fix/REPORT.md:20,22,393,399,451` (S23 / Adreno 740 / E031.41.03.62). The commit message states the dp4a kernel "was not in that commit's scope and was not measured", so this is **precautionary by analogy**. |
| `26c7affb7` | `gemv_moe_q4_k_f32_ns.cl` (`_wimg`) | The kernel did not build; the masks are added so it compiles. | **Never measured.** A build fix. |
| `754a96426`, `738346fd6` | `gemv_noshuffle_q4_k/q6_k/q4_0/q4_1/q5_k_f32.cl` | No store past row M when `M % 128 != 0`; the split-K partial tail can no longer land in the next slice's rows. | **Never measured on a device.** No experiment cell in the lab measures these guards; `scratchpad/agents/fork-expertise/BRIEFING.md:641-642` describes them as "pure-suppression correctness fix", which is consistent with no cell existing. |
| `cf1bc2395` | `ggml-opencl.cpp` comment/`#error` | Not a kernel behaviour change. | n/a. |
| `8e081313f`, `f6ba2786d` | diagnostic TU relocation | Build structure only. | n/a. |
| `70b4302bb` | `ggml-opencl.cpp` | Restores two blocks the merge broke. | n/a - merge repair. |

**Repack: no commit of ours touches it.** Searching added lines across all 89 for `repack`
returns three incidental mentions (`8e081313f`, `28b9a1351`, `ff1f14460`) and no code change.
The repack work visible in the branch (`q4_0_4x8`, CPU_REPACK fusion declines) is
upstream/`Saurias92` work from 2026-08-24, outside this window.

### 3.4 Commits that changed nothing observable

- **The duplicate patch pair.** `33c3817c4` and `513bf4cea` are the same patch: identical
  stable patch-id `a65b1afb74e0a3809f4d4354eff3e1a78d3b32e1`, identical subject, same file
  and same 22/17 line stat. Neither is a no-op against its own parent - `33c3817c4` applied it
  on `kalsa/gemm-f32-mul` (parent `a0cabca6b`), `513bf4cea` re-applied it after the merge
  `3bec271fd` because that merge **lost** the change (at `3bec271fd` the kernel is back to
  `half8 c0` at `:38`; at `b51d1e055`, its ancestor, it is `float8 c0` at `:43`). So the
  observable-free commit is the second: it restores what a merge had silently removed.
  Undo pair: **`33c3817c4` (brought in by the merge `b51d1e055`) undone by the merge
  `3bec271fd`, restored by `513bf4cea`.**
- **A `#error` added and removed.** `754a96426` added
  `#error "GGML_OPENCL_USE_ADRENO_BIN_KERNELS reinstates kernel_gemm_moe_q4_k_f32_ns_ila ..."`;
  `cf1bc2395` (2026-09-19 13:01, 66 minutes later) removed it, replacing it with a host-side
  skip plus a corrected comment. Pair: **`754a96426` -> undone by `cf1bc2395`**, for the
  reason `fork-expertise/BRIEFING.md:643` records (it broke a documented upstream
  configuration, `docs/backend/OPENCL.md:85`).
- **The Metal packaging revert.** `c71977809` added the precompiled-metallib build (166 lines)
  and `ac9a09dc6` added its probe; `2a290390d` removed both from the workflow (+4/-179,
  `tools/` untouched). Pair: **`c71977809` (+ the workflow hunk of `ac9a09dc6`) -> reverted by
  `2a290390d`.** The plan records the reason and the failing run: the first real macOS run
  `35560962409` concluded `failure` while the build itself succeeded (verified: that run is a
  `push` on `b11010-merge` at `ac9a09dc6`, conclusion `failure`).
- **The R2 emptiness check twice.** `f404d9180` built `key_count()` and `916b8f0bc` removed it
  in favour of `head-object`. f404d9180's helper is deleted 12 minutes after it was written,
  having failed its production run (finding 4.5).
- **Docs-only.** `ff1f14460`, `df6ee148c`, `b617e4efc`, `550b4796f`, `4a1444ecd`, `2aca2adb0`,
  `134a35cf2` change only `KALSA_FORK.md`. `f52c481ab` changes no shipped product (it only
  removes CI triggers).
- **Warnings added then silenced.** `ba33d8b04` (author `kalsa-orchestrator`) added two
  `fprintf(stderr, "warning: KALSA_PHASE_STAMPS: failed to ...")` lines in
  `tools/cli/cli-context.cpp`; `2998ad5d6` (ours) deleted exactly those two. Pair:
  **`ba33d8b04` -> part-undone by `2998ad5d6`.**
- **Test-only, build-configuration-only (no product change).** `764687712`, `1acb5ef97`,
  `d4f377f9c`, `8665e9a9f`, `28b8db177`, `6826ec761`, `408aabb67`, `3f71159fd`, `cf5510a99`,
  `9a36bf779`, `8b86f9f75`, `ff7ae8009`, `764687712`; `592f68684`, `3efb44d6c` are one-line
  build fixes; `70b4302bb` is merge repair; `135232fa0` changes an internal sentinel value
  only; `f6ba2786d` is a build-flag fix for `8e081313f`.

### 3.5 Commits whose message claims something the diff does not support

Four findings. Only the first is severe.

**(1) `f404d9180` "fix the R2 emptiness check to use KeyCount" - the platform refutes it, in
production, eight seconds later.** The diff builds a `key_count()` helper on
`aws s3api list-objects-v2 --query 'KeyCount'`. Run **`35546215327`** (`workflow_dispatch`,
tag `kalsa-server-v1.0.0`, created 2026-09-20T23:59:20Z, i.e. 8 s after the commit) failed at
step "Publish to R2" with, verbatim from the step log at `2026-09-21T00:04:42.8998650Z`:

```
aws s3api list-objects-v2 returned a KeyCount that is not a non-negative integer: 'None'
```

The next commit, `916b8f0bc`, states the reason in its own comment: "Cloudflare R2 omits
KeyCount from ListObjectsV2, so ...". The fix was abandoned within 12 minutes and the
subsequent dispatch `35549848243` succeeded on the `head-object` version.

**(2) `e1866612d` "move bmoe engine core into src/bmoe/" - nothing was moved.** The
name-status of the commit is 22 `A` (adds) and 1 `M` (the CMakeLists glob); there is not one
`D` or `R`. `git ls-tree -r --name-only e1866612d^ | grep -ci bmoe` = 0: the code was not in
this tree before, so nothing could be moved out of it. The diff is an import of 6892 lines
from somewhere else. What would settle the "from where": the source branch or repository the
files were copied from (a likely candidate is the lab's `BigMoeOnEdge`, but I did not verify
that).

**(3) `8537d097c` "bmoe: build under minSdk 23 and under -Werror" - only the minSdk half is in
the diff.** The 9 changed lines add two `#if defined(__ANDROID__) && __ANDROID_API__ >= 26`
guards and fix a `RouterHook::predict_at_topk` signature mismatch. No compiler flag, CMake
option or CI step is added, so `-Werror` is a claim about a build performed elsewhere. I did
not run a build, so I cannot say the claim is false - only that the diff does not carry it.

**(4) `4ccef2f85` "publish an immutable release" - the path it adds is what the branch then
removes, and the frozen tag keeps it.** The commit adds a `release:` job with
`gh release create --verify-tag`. `635ea0ed2` deletes it. But the tag `kalsa-server-v1.0.0`
points at `4ccef2f85`, so the tag's own workflow still contains that step, and a GitHub
release **does exist**: `gh api repos/Aspis0/kalsallama/releases` returns
`kalsa-server-v1.0.0`, `draft: false`, created `2026-09-20T19:37:57Z`, with two assets
(`kalsa-server-v1.0.0-bin-macos-arm64.tar.gz` and its `.sha256`), and `gh release list` marks
it `Latest`. `docs/ALIVE.md` states "Distribution is on Cloudflare R2 (dl.kalsa.io); the
GitHub-release path is gone" - true of the branch, not of the repository, which still serves
the leftovers of v1.0.0. I could not determine which trigger created it: the release timestamp
precedes every job start time of the two candidate runs (`35532934066` jobs start 19:45:32Z,
`35532939066` cancelled).

### 3.6 Which commits the tip contains (shipped lineage) versus which live only on side branches

- **Shipped lineage** (ancestors of `8537d097c`, 72 of ours): every commit in groups A-M
  except the 17 marked here as POST. The shipped pin contains all the governor core, the
  kernel work, the MTP fix, the KV pressure API, the bmoe core and the docs.
- **Contained in the tip but NOT in the shipped pin** (17, all 2026-09-20/21): `bd1c9510c`,
  `add4e4937`, `51b9e6a7f`, `f44560d66`, `82d38684f`, `45a0016e9`, `67c0be86b`, `c8dff98b0`,
  `4ccef2f85`, `3a4d5143e`, `635ea0ed2`, `f404d9180`, `916b8f0bc`, `c2ebfc164`, `c71977809`,
  `ac9a09dc6`, `2a290390d`. These are the release pipeline and the server slot/checkpoint work.
- **Only on a side branch** (not in the tip at all): `07e081f2b` (ours, `mtp-ctx-other`) and
  `284ea0f08` (ours, `mtp-ctx-other`, an earlier variant of `98bee958d`), plus the 48
  upstream commits unique to `bump-rehearsal-tmp`. **`kalsa-slot-and-metal` and
  `opencl-moe-masks` contain no commit absent from the tip.**

---

## 4. Coverage table

All 89 non-merge commits of ours since 2026-09-04, each exactly once. Verified mechanically:
the group lists contain 89 entries, no duplicate hash, and the symmetric difference with
`git log --no-merges --since=2026-09-04 --author='Marco Gualtieri --format='%h' origin/b11010-merge`
is empty.

| # | hash | group | subject |
|---|---|---|---|
| 1 | `40051f8ae` | A | feat(governor): implement tri-engine runtime contract v0.2 |
| 2 | `bb336bdc1` | A | fix(governor): partition admitted token batches safely |
| 3 | `a945d531b` | A | fix(governor): repair thermal exit boundaries |
| 4 | `e131345b7` | A | governor: expose init failure reason, fix friend/ctor access |
| 5 | `6f0a33c0d` | A | fix(governor): admit safe final prefill tails |
| 6 | `e1a0f5028` | A | governor: decode prefill batches in admitted chunks |
| 7 | `6ed44f567` | A | governor: expose prefill timing and route facts |
| 8 | `135232fa0` | A | governor: use dedicated prefill chunk sentinel |
| 9 | `8f939aa7d` | A | governor: enable measured V79 GPU prefill |
| 10 | `3a161adfc` | A | governor: clear both KV stores |
| 11 | `a6642b73d` | A | governor: route Wait/CPUFallback prefill to the decode context |
| 12 | `39c35bd1e` | A | governor: reset prefill route per turn, keep CPU label, assert generation |
| 13 | `2a8601c16` | A | fix(governor): three failing tests, one cause - hybrid memory was cast away |
| 14 | `9c28322ac` | A | governor: bench_force_gpu_prefill lever |
| 15 | `764687712` | B | test: add governor v0 state handoff harness |
| 16 | `1acb5ef97` | B | test: harden governor v0 audit coverage |
| 17 | `d4f377f9c` | B | test: reject non-finite governor logits |
| 18 | `8665e9a9f` | B | test(governor): cover runtime wrapper callbacks |
| 19 | `28b8db177` | B | test(governor): add v0.2 router golden tests |
| 20 | `6f3881baf` | C | feat: generalize shared KV cells |
| 21 | `21d3154df` | C | fix: fence shared KV cache operations |
| 22 | `73f5fe92f` | C | governor: add KV cache commit primitive |
| 23 | `c51cb45f4` | C | governor: harden KV route compatibility |
| 24 | `5e0db23ca` | C | governor: add phase-routing object |
| 25 | `f2fa43207` | C | governor: add attach-once instrumentation |
| 26 | `12c6dbefa` | C | governor: count graph builds by ubatch |
| 27 | `dadafd290` | C | governor: support hybrid memory handoff |
| 28 | `6826ec761` | C | tests: fix hybrid handoff count oracle |
| 29 | `408aabb67` | C | tests: account exact hybrid commit bytes |
| 30 | `9ab716ae1` | C | feat(governor): stage transposed V commits |
| 31 | `7006b35c0` | C | fix(governor): bound staged graph cache |
| 32 | `ba296167c` | C | feat(governor): route phases across devices |
| 33 | `e9dffddee` | C | feat(governor): add cross-backend benchmark and honest transfer stats |
| 34 | `e31b9144c` | D | perf: reset async prompt-timing state in llama_perf_context_reset |
| 35 | `3f71159fd` | D | test: perf-reset asserts non-zero prompt timing and no idle carry-over |
| 36 | `fa64f181a` | D | mtmd-cli: unconditional phase timing line for measurement cells |
| 37 | `2998ad5d6` | D | fix(cli): silence phase stamp failures |
| 38 | `33c3817c4` | E | opencl: compute the Adreno q4_0 GEMM product in f32 |
| 39 | `513bf4cea` | E | opencl: compute the Adreno q4_0 GEMM product in f32 |
| 40 | `67c73d26c` | E | opencl: compute the Adreno q4_K GEMM product in f32 |
| 41 | `2f3b24dee` | E | opencl: use generic f16 kernel for Adreno batched view MUL_MAT |
| 42 | `70b4302bb` | E | fix(opencl): close the two blocks the 2026-09-04 merge broke |
| 43 | `26c7affb7` | E | opencl: fix the build of kernel_gemv_moe_q4_k_f32_ns_wimg |
| 44 | `2361be359` | E | opencl: pass the get_scale_min_k4 masks as kernel args in the q4_K dp4a MoE GEMM |
| 45 | `754a96426` | E | opencl: guard the padded-grid dst stores in the q4_K/q6_K noshuffle GEMV tail |
| 46 | `738346fd6` | E | opencl: guard the remaining padded-grid store tails |
| 47 | `cf1bc2395` | E | opencl: drop the over-broad bin-kernel #error, keep the honest comment |
| 48 | `8e081313f` | E | ggml-opencl: relocate KALSA diagnostic scaffolding to a new file pair |
| 49 | `f6ba2786d` | E | fix(opencl): set OpenCL target version in relocated KALSA diag TU |
| 50 | `e1866612d` | F | move bmoe engine core into src/bmoe/ |
| 51 | `8537d097c` | F | bmoe: build under minSdk 23 and under -Werror |
| 52 | `28b9a1351` | G | hexagon: add NPU v79 judge diagnostics and error propagation |
| 53 | `ff7ae8009` | G | tests: tighten NPU judge failure reporting |
| 54 | `15ad4b8e3` | G | hexagon: gate HMX eligibility on logical ne01 %32 |
| 55 | `9a36bf779` | G | tests: GGML_TEST_EXTRA_MM appends parameterized MUL_MAT cases |
| 56 | `8b86f9f75` | G | tests: EXTRA_MM_FIRST prepend; htp: HTP_ZERO_TILE_PAD |
| 57 | `cf5510a99` | G | tests: close the Mellum2 perf scope block in make_test_cases_perf |
| 58 | `98bee958d` | H | fix(mtp): the draft context died on a cache it could not share |
| 59 | `237461a98` | H | fix(mtp): the denial log was a level the binding renders as info |
| 60 | `9586bf985` | I | ext: proactive KV pressure callback |
| 61 | `a29edcf49` | I | ext: kv pressure fixes from DeepSeek audit (F1, F2 + contract docs) |
| 62 | `32282997e` | I | build: ship llama-ext.h with the SDK (audit F5) |
| 63 | `592f68684` | J | fix(kv): llama-kv-cache-iswa.cpp throws std::runtime_error without <stdexcept> |
| 64 | `3efb44d6c` | J | fix(common): guard the threadpool function pointers before calling them |
| 65 | `ff1f14460` | K | docs: KALSA_FORK.md - branch map, two lineages, hexagon skels |
| 66 | `df6ee148c` | K | docs: KALSA_FORK.md - record cann-off tip 3cfe5ddab |
| 67 | `b617e4efc` | K | docs: KALSA_FORK.md - do not self-pin HEAD hash |
| 68 | `550b4796f` | K | docs: KALSA_FORK.md - governor-v0 pushed at cff0a4a75 |
| 69 | `4a1444ecd` | K | docs: KALSA_FORK.md - reconcile branch map after the 2026-09-16 consolidation |
| 70 | `2aca2adb0` | K | docs: KALSA_FORK.md - separate local main from origin/main |
| 71 | `134a35cf2` | K | docs: KALSA_FORK.md - the salvage is merged; stop pinning main's hash |
| 72 | `51b9e6a7f` | L | server : persist context checkpoints in slot save files |
| 73 | `f44560d66` | L | server : add X-Kalsa-Cache-Salt prompt cache namespaces |
| 74 | `82d38684f` | L | server : harden slot checkpoint appendix and extend salt coverage |
| 75 | `45a0016e9` | L | server : make slot saves atomic and reject unknown trailer data |
| 76 | `67c0be86b` | L | server : contain slot save failures and use exclusive temp files |
| 77 | `c2ebfc164` | L | server : add X-Kalsa-Slot header inlet |
| 78 | `ac9a09dc6` | L | server : guard slot actions and prove the inlet adds no exposure |
| 79 | `bd1c9510c` | M | ci : add Kalsa-owned macOS llama-server build workflow |
| 80 | `add4e4937` | M | ci : brand the macOS server artifact as kalsa-server |
| 81 | `c8dff98b0` | M | ci : harden version, packing and RPATH checks in kalsa-server |
| 82 | `4ccef2f85` | M | ci : name tag builds after the tag and publish an immutable release |
| 83 | `3a4d5143e` | M | ci : make the kalsa-server release self-contained |
| 84 | `635ea0ed2` | M | ci(server): publish the verified engine to R2 instead of a GitHub release |
| 85 | `f404d9180` | M | ci(server): fix the R2 emptiness check to use KeyCount |
| 86 | `916b8f0bc` | M | ci(server): decide the R2 existence check with head-object |
| 87 | `c71977809` | M | ci : ship precompiled Metal libraries in the kalsa-server archive |
| 88 | `2a290390d` | M | ci : drop the Metal packaging work from the kalsa-server release path |
| 89 | `f52c481ab` | M | ci: stop auto-running Huawei CANN workflow on this fork |

Group sizes: A 14, B 5, C 14, D 4, E 12, F 2, G 6, H 2, I 3, J 2, K 7, L 7, M 11. Total 89.

### UNMAPPED commits

A commit with no plan mapping is a finding, not a reason to hide it. The following have no
gate (G0-G4), no M1, no Part 5 defect, no plan part and no release-pipeline role:

UNMAPPED: `135232fa0` (internal sentinel), `2998ad5d6` (warning removal),
`592f68684` (missing include), `3efb44d6c` (threadpool null guard), `70b4302bb` (merge
repair), `f6ba2786d` (build flag for a relocation), `cf5510a99` (missing braces),
`237461a98` (log level), `8e081313f` (file relocation), `f52c481ab` (CANN CI trigger removal),
`ff1f14460`, `df6ee148c`, `b617e4efc`, `550b4796f`, `4a1444ecd`, `2aca2adb0`, `134a35cf2`
(KALSA_FORK.md maintenance).

What they do anyway: they are build correctness, merge repair, log-level contract, file
organisation, repository documentation and CI-cost hygiene. Two of them are still worth the
reader's attention: `8e081313f` is a 411/324-line relocation that the plan's "prefer reusing
existing infrastructure" rule would want recorded, and `237461a98` encodes a real contract
with the binding (`ggml_log_level` below WARN renders as "info" in the RN log).

---

## 5. What I could NOT verify, and what would settle it

1. **Whether defects 5.1/5.3 behave as the plan says on a device.** I read the code paths
   (`src/llama-governor-runtime.cpp:55-68`, `:190-191`) and they are consistent with the
   plan. A device run with the cable plugged and battery below 45% would settle it; there is
   none in the branch.
2. **The app side.** Every statement about `governorInputs.ts`, `GovernorBatteryModule.kt` and
   `cpp/rn-governor-params.cpp` in section 3.2 comes from the plan, not from a checkout. A
   read of `Aspis0/kalsa` at `origin/main` and `Aspis0/kalsa.rn` at the pinned commit would
   settle the 5.2 chain end to end.
3. **The `0.659x` prefill cost of the q4_0 f32 fix.** The lab's own map
   (`scratchpad/QDC-GPU-GOVERNOR-MAP-2026-09-16.md:322`) says the figure failed its validity
   gate on a 5.71 °C spread; a corrected-kernel prefill timing under the gate would settle it.
   What is NOT in doubt is the KLD: 0.4538 -> 0.004736 is banked in `gemm-f32-ship`.
4. **Whether the padded-grid guards (`754a96426`, `738346fd6`) fix a defect that occurs on
   hardware we own.** No cell measures them. A `test-backend-ops` run on a shape with
   `M % 128 != 0` on the Adreno 740/750, before and after, would settle whether they are a
   real fix or only a suppression.
5. **`8537d097c`'s "-Werror" claim.** No flag in the diff, no run cited. Building that commit
   with `-Werror` on the Android toolchain would settle it.
6. **Whether `f404d9180`'s KeyCount check ever succeeded.** I verified run `35546215327`
   failed on it, and the next commit abandoned it, but I did not enumerate every run in the
   12-minute window (`35546199839` and `35546212697` were cancelled). The full run list for
   `.github/workflows/kalsa-server.yml` between 2026-09-20T23:55Z and 2026-09-21T00:15Z would
   settle it.
7. **Which trigger created the `kalsa-server-v1.0.0` GitHub release.** Its creation time
   (19:37:57Z) precedes the first job start of both candidate runs. The run that owns it is
   not identifiable from the job list I pulled.
8. **The origin of `src/bmoe/`.** `e1866612d` imports 6892 lines with no deletions; I did not
   find the source tree it came from.
9. **The plan's own provenance note for `k_cpu_delta_c`.** Part 0.5 traces it to commit
   `c1bb48d32`; that commit is `opencl: fix q4_K/q5_K MoE MUL_MAT_ID on Adreno 740 - pass
   get_scale_min_k4 masks as kernel args` (2026-08-20, `Saurias92`) and touches only
   `ggml/src/ggml-opencl/*`. In this branch
   `git log -S 'k_cpu_delta_c' -- src/llama-governor-policy.cpp` returns `40051f8ae` and
   `6f0a33c0d` only. The values may well come from the q58 sweep as the plan says separately;
   the commit attribution does not hold in this repository.
10. **`07e081f2b` versus the tip's guard.** I compared code paths, not behaviour: the tip
    reaches the same `nullptr` through `mem_share_iswa`
    (`src/llama-model.cpp:2705-2706`, `:2778`), but I did not run an MTP-on-hybrid load to
    prove the two are equivalent.
