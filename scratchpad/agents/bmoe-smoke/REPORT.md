# PRODUCTION SMOKE (pre-registered §4) — LFM2.5-8B-A1B-KEXP on bmoe-cli (S23)

**Session:** 2026-08-19/20. **Repo:** `C:\Users\gualt\Desktop\Kalsa\moe-experiments`. **NO push** anywhere (never BigMoeOnEdge origin/upstream). BigMoeOnEdge working-tree uncommitted changes are NOT mine — do NOT commit/stage/stash/touch; building from the dirty tree is fine.
**Goal:** demonstrate on the REAL engine (bmoe-cli, split residency: GPU trunk via --ngl, CPU experts, use_mmap=true + use_extra_bufts=false per BMoE hard rule 2) that (a) NONE of the 5 trans4 convert kernels nor the 5 restore kernels is ever dispatched during load+generation; (b) MoE expert weights never land in an OpenCL SoA buft (weight-path log); (c) fixed-prompt outputs are IDENTICAL between the kalsakernel-v2 .so (2032b7c7…) and the PRE-fix unpatched .so (25044c5a…/9bc47a9c…) — identical despite one .so having all-broken trans4 paths = the engine provably never takes them.
**Device:** S23 via WIRELESS adb `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (USB shows unauthorized; wireless works). /data 21G free. Model ON device: `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf` (LFM2.5 8B-A1B, bmoe recipe row "lfm2moe"). PC copy: `models/LFM2.5-8B-A1B-KEXP.gguf`.
**Reports:** `scratchpad/agents/bmoe-smoke/REPORT.md` (incremental). **Logs:** `results/oracle_consumer_s23/bmoe_smoke/`.

## STEP 1 — RECON: expert tensor quant types (DONE)

PC gguf dump (`scratchpad/agents/bmoe-smoke/dump_tensors.py`, gguf-py) of `models/LFM2.5-8B-A1B-KEXP.gguf` (256 tensors):
- **Expert tensors (ffn_*_exps):** `ffn_gate_exps`/`ffn_up_exps` = **Q2_K** (44 each); `ffn_down_exps` = **Q3_K** (22). 22 MoE layers, 32 experts, k=4, expert FFN 1792.
- Trunk/dense/attn: Q5_K (dense gate/up, attn Q/K/V/O, shortconv in, token_embd), Q6_K (dense down, shortconv out), F32 (norms/router/conv). Recipe: `reports/moe-lfm25-kexp.md` ("lfm2moe").
- **ALL tensor types in the model: F32, Q2_K, Q3_K, Q5_K, Q6_K. ZERO scalar-trans4-gated tensors (q4_0/q4_1/q5_0/q5_1/mxfp4).**

**Gate-coverage statement (per orchestrator):** the trans4-moe dispatch name gate (`(strstr(name,"ffn")&&strstr(name,"exps"))||strstr(name,"as")` + ne01%32==0) matches the expert tensor NAMES (`blk.N.ffn_*_exps.weight`) and shapes (ne01=2048/1792, %32==0) — so the gate is name-only-matchable. BUT the expert TYPES are Q2_K/Q3_K (K-quants), NEVER the scalar trans4 types. Therefore the 5 scalar trans4 convert + 5 scalar trans4 restore kernels have NO qualifying tensor in this model → claim (a) is expected trivially true. **The decisive evidence for "engine never takes the broken trans4 paths" is the A/B output identity (claim c) vs the archived all-broken .so (25044c5a…); the shim dispatch log (claim a) and weight-path log (claim b) are corroborating direct evidence. Positive control via the roundtrip harness (trans4 kernels MUST appear under shim) stays mandatory.**

## A/B partner identity (DONE; reconciles the sha discrepancy)

- Task cited "PRE-fix unpatched .so (sha 25044c5a…, the 1582f2d83 build)". Archived file: `results/oracle_consumer_s23/retrial/libggml-opencl.unpatched.1582f2d83.so`, actual sha **9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8**. Per retrial MANIFEST: "rebuilt from 1582f2d83 worktree; historical 25044c5a differs by build-info commit hash only; OpenCL sources byte-identical." So **9bc47a9c IS the designated A/B partner** (the "1582f2d83 build," all-broken convert+restore — pre-eaec5d884).
- Fixed side: `2032b7c7e25d0f9488213f757c2fa8f073ba675c18e2a8d333934603a996e2e7` (attempt-2, f63746555).
- **A/B cleanliness (verified):** the only `ggml-opencl.cpp`/`cvt.cl` changes between 1582f2d83 and f63746555 are the 3 trans4 commits (eaec5d884 restore, 39a0b130 attempt1, f63746555 attempt2) — trunk/dense/K/host path byte-identical. So 9bc47a9c vs 2032b7c7 differ ONLY in trans4 kernel code (+build-info, +dormant env-gated diagnostics which are OFF during A/B). Clean A/B.

## STEP 2 — ENQUEUE SHIM (in progress)

Existing `GGML_OPENCL_PROFILING` logs kernel_name per-call (spam, not unique). Adding a tiny value-parsed `GGML_OPENCL_LOG_KERNELS=1` that logs each unique `clEnqueueNDRangeKernel` kernel name once (a set) to stderr. Minimal diff in `ggml-opencl.cpp`, commit on `kalsa/kernel-s3-repack`. The shim build becomes the smoke build; A/B runs use shim env UNSET (shim dormant → ≡ 2032b7c7 behavior).

## STEP 3 — BUILD (planned)

Existing `build-android-opencl-k4split` bmoe-cli is STATIC (`BUILD_SHARED_LIBS=OFF`, 108 MB, OpenCL baked in, NOT swappable — only libOpenCL.so/libc++_shared in NEEDED). The test build `build-android-opencl-s3oracle` is SHARED (`BUILD_SHARED_LIBS=ON`, libggml-opencl.so DT_NEEDED, swappable via LD_LIBRARY_PATH). → Configure a **separate** bmoe-cli build dir from BigMoeOnEdge root with `BUILD_SHARED_LIBS=ON` + `GGML_OPENCL=ON` + `GGML_OPENCL_EMBED_KERNELS=ON` + `GGML_OPENCL_USE_ADRENO_KERNELS=ON` + `BMOE_BUILD_CLI=ON`, NDK arm64 toolchain, so the A/B is a pure LD_LIBRARY_PATH .so swap with ONE binary. Do NOT touch k4split or s3oracle configs.

_(steps 2-5 appended below incrementally)_

## STEP 2 — ENQUEUE SHIM (DONE)

Added `GGML_OPENCL_LOG_KERNELS` (value-parsed via existing `ggml_opencl_env_value_enabled`: on iff set+non-empty+not-0/false) to `enqueue_ndrange_kernel` in `ggml-opencl.cpp`: logs each unique dispatched kernel name once (static `std::set<std::string>`, not per-call spam) to stderr via `clGetKernelInfo(CL_KERNEL_FUNCTION_NAME)`. Forward-decl of the helper added (defined below). Minimal (+17 lines). Committed `8c659e120` on `kalsa/kernel-s3-repack` (parent `f63746555`). cvt.cl untouched. NO push. Dormant when env unset → A/B runs use shim OFF (≡2032b7c7 behavior); shim-ON runs give dispatch evidence.

## STEP 3 — BUILD (DONE; one binary, swappable .so)

Configured a SEPARATE build dir `BigMoeOnEdge/build-android-opencl-smoke` from BigMoeOnEdge root with `BUILD_SHARED_LIBS=ON` + `GGML_OPENCL=ON` + `GGML_OPENCL_EMBED_KERNELS=ON` + `GGML_OPENCL_USE_ADRENO_KERNELS=ON` + `BMOE_BUILD_CLI=ON` + NDK arm64 toolchain (NDK 27.1.12297006, cmake 3.22.1, Ninja). `ggml commit: 8c659e120` (shim build); `bmoe: expert-ready hook present` (GGML_BACKEND_DL=OFF kept it). Built 404/404, exit 0. `bmoe-cli` is DYNAMICALLY linked (DT_NEEDED: libggml-opencl.so, libggml.so, libggml-cpu.so, libggml-base.so, libllama.so, libllama-common.so) → the A/B is a pure LD_LIBRARY_PATH `.so` swap with ONE binary.

**Smoke-build artifacts (PC shas; all device shas matched after push):**
- `bmoe-cli` = `f8eec06b55effcebd73331fe41f2f83d33fe63ea752c9ca1d4e4840aee0d940d`
- `libggml-opencl.so` (the SMOKE .so = fixed-attempt-2 + dormant shim, 8c659e120) = `1bde69130b81a83605ab7d1a1768d2e558c1544d23e7642a3e4f66869a4164d2` — with shim env UNSET ≡ `2032b7c7` (f63746555); same-build as bmoe-cli so ABI-guaranteed (side A).
- support libs: libggml.so=`7b935438…`, libggml-base.so=`494ef629…`, libggml-cpu.so=`2065e7bd…`, libllama.so=`c05d34bb…`, libllama-common.so=`592b134b…`.
- **A/B side B (archived unpatched, all-broken):** `results/oracle_consumer_s23/retrial/libggml-opencl.unpatched.1582f2d83.so` = `9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8` (historical 25044c5a; OpenCL sources byte-identical). Pushed as `libggml-opencl.unpatched.so` alongside the smoke `.so` (`libggml-opencl.smoke.so`).
- Positive-control exe: `test-opencl-moe-roundtrip` (s3oracle, `1e50038b…`).

## Recipe (bmoe-cli, split residency)

`use_extra_bufts=false` is HARDCODED in `core/src/engine/session.cpp:560` (BMoE hard rule 2, no flag). mmap = `--dense-weights mmap` (default). `--ngl 99` (campaign split, trunk→OpenCL GPU). `--moe-cpu-experts on` (experts→CPU; even `off` keeps Q2_K/Q3_K on CPU via OpenCL supports_op). `--temp 0 --seed 0` (greedy deterministic). Model already on device `/data/local/tmp/LFM2.5-8B-A1B-KEXP.gguf`.

## STEP 4 — DEVICE RUNS (in progress)

_(runs appended below)_

## STEP 4(i) — smoke run, shim-ON + weight-path-ON, smoke .so (DONE)

`-c 512 --ubatch 128` (c=2048 failed: OpenCL compute buffer 1.6 GB > Adreno alloc; c=512 → 64.5 MiB fits). 64 tokens generated, 5.5 tok/s, model load 11.9s, TTFT 14.0s, PROC_EXIT=0. `.so` sha `1bde6913…` verified pre-run.

**Claim (a) — CONFIRMED.** 31 unique kernel names dispatched (trunk compute: `kernel_mul_mm_f16_f32_l4_lm`, `kernel_gemv_noshuffle_q5_k_f32`/`kernel_gemm_noshuffle_q6_K_f32`, `kernel_rope_neox_f32`, `kernel_soft_max_4`, `kernel_ssm_conv_f32_f32`, `kernel_rms_norm_mul`, `kernel_cpy_*`, etc.). **ZERO** `kernel_convert_block_*_trans4_ns` and **ZERO** `kernel_restore_block_*_trans4_ns` — none of the 5 trans4 convert kernels nor the 5 restore kernels is ever dispatched.
**Claim (b) — CONFIRMED.** weight-path log: **0** `trans4-moe` paths (experts are CPU via `--moe-cpu-experts on`; trunk Q5_K/Q6_K use noshuffle GEMV/GEMM, not trans4-moe). Expert weights never land in an OpenCL SoA buft.

## STEP 4(ii) — POSITIVE CONTROL (roundtrip harness + smoke .so + shim ON)

**DONE / GATE PASSED after the extended shim rebuild.** The smoke build was rebuilt from llama.cpp `55f43a5744a3e67ce8108774648aeff341c87925` (`ggml-opencl` dependency and `bmoe-cli` relinked). New PC SHA256 values:

- `BigMoeOnEdge/build-android-opencl-smoke/bin/libggml-opencl.so` (side A, extended shim) = `0be5e4bf4c68725f491dae0759c119bd7d213ac5a6ec6aaad5a9d460fde022a6`.
- `BigMoeOnEdge/build-android-opencl-smoke/cli/bmoe-cli` = `f8eec06b55effcebd73331fe41f2f83d33fe63ea752c9ca1d4e4840aee0d940d`.
- Positive-control `test-opencl-moe-roundtrip` = `1e50038be1d264aaccd7d80e9c90b9af9ed1aac78e3eff3a81d128ea64a4d0e1`.

The harness ran on the S23 over authorized USB ADB in fresh `/data/local/tmp/bmoe_smoke`, with `LD_LIBRARY_PATH` pointing at the rebuilt library and `GGML_OPENCL_LOG_KERNELS=1`. The pre-run on-device SHA matched `0be5e4bf…`. **All ten required kernel names appeared** (five `kernel_convert_block_*_trans4_ns` and five `kernel_restore_block_*_trans4_ns`), and all 10 roundtrip cases returned `mismatch=0`; `DONE rc=0`. This establishes that the extended shim observes the direct convert/restore dispatch path and gates the production claim (a).

Log: `results/oracle_consumer_s23/bmoe_smoke/run_ii_positive_control_extended.log`.

## STEP 4(iii) — REDONE PRODUCTION SMOKE + A/B (extended shim build)

Registered recipe was rerun with the same model, prompt `Once upon a time, in a distant galaxy, there was a`, `-n 64 -c 512 --ubatch 128 --ngl 99 --moe-cpu-experts on --dense-weights mmap --temp 0 --seed 0`. The device was S23 / Adreno 740; the model and `s3base`/`s3fix`/`s3printf` were not touched.

**Claim (a) — CONFIRMED (meaningful after the positive-control gate).** With `GGML_OPENCL_LOG_KERNELS=1`, 31 unique production kernel names were recorded during load plus generation; there were **zero** trans4 convert/restore names. The production log has no `kernel_convert_block_*_trans4_ns` or `kernel_restore_block_*_trans4_ns` lines and exited successfully after 64 generated tokens.

**Claim (b) — CONFIRMED.** With `GGML_OPENCL_LOG_WEIGHT_PATH=1`, there were zero `OPENCL_WEIGHT_PATH` lines and zero `trans4-moe` lines. The model’s 66 expert tensors are Q2_K/Q3_K and were reported as CPU-buffer overrides; the production placement was `moe_cpu_experts=on`, `pin_ffn_exps=1`. No expert weight entered an OpenCL trans4/SoA path.

**Claim (c) — CONFIRMED.** Shim and weight-path variables were explicitly unset for both sides. The same single dynamic `bmoe-cli` binary ran with side A `libggml-opencl.so` SHA `0be5e4bf…` and side B archived all-broken `libggml-opencl.so` SHA `9bc47a9ce5c03eab98d3e902cbd2d8bc9b18c282cf6bea291e73562ad4dce8c8` (the designated 1582f2d83 / historical 25044c5a partner). Both runs completed 64 tokens successfully. The generated text lines were byte-for-byte identical:

`Once upon a time, in a distant galaxy, there was a planet named Zylos where a group of explorers found a strange artifact that could control time. The artifact could be used to reverse time, but only for a limited amount of time. The explorers decided to use it to fix a mistake they made earlier in the day. time travel travel travel travel travel... The explorers...`

No per-token logprob/CSV output was available, so the exact generated text is the comparison metric.

Logs: `run_i_extended_shimon_weightpath.log`, `run_iii_ab_sideA_smoke_unset.log`, `run_iii_ab_sideB_unpatched_unset.log`, and `run_iii_ab_compare.log` under `results/oracle_consumer_s23/bmoe_smoke/`.

### Final verdict

| Evidence | Result |
|---|---|
| Positive control: shim sees all 5 convert + 5 restore trans4 kernels | **PASS** |
| (a) Production dispatch has zero trans4/restore kernel names | **CONFIRMED** |
| (b) Production has zero trans4-moe weight paths | **CONFIRMED** |
| (c) Fixed production output is identical vs all-broken partner .so | **CONFIRMED** |

Coverage caveat remains: KEXP expert tensors are Q2_K + Q3_K, so this gate is name-only for the scalar trans4 types; their types are never gated. The decisive production evidence is the clean A/B against the all-broken partner, with the positive control proving the dispatch instrumentation is not blind.

**production immune: DEMONSTRATED**
