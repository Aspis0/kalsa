# Kalsa MoE campaign — queue item #17

Repository: `third_party/llama.cpp`
Branch: `kalsa/kernel-s3-repack`
Base: `c77fe1354`
Remotes: none by design; no remote was added or used.

## Fix A — guard the q6_K flat old-compiler workaround by GPU family

- Site: `ggml/src/ggml-opencl/ggml-opencl.cpp:6028-6031`.
- Found: `q6_k_flat_old_compiler` checked `type == E031` and the version threshold, but did not require `gpu_family == ADRENO`. In the base checkout, the parser's `{}` unknown result value-initialized `type` to E031, so the comparison could make the workaround true on non-Adreno devices.
- Changed: Added the explicit `backend_ctx->gpu_family == ADRENO` conjunct, matching the existing q4_0 flat-kernel gates.
- Adreno/E031.41.03.62: unchanged; it remains `ADRENO && E031 && older-than-E031.45`, so the S23/A7X path keeps the same workaround selection.
- Build result: PASS on the required outer build tree after the Fix B enum-name correction; the exact command is recorded below.

## Fix B — E17 compiler-version parser

- Site: `ggml/src/ggml-opencl/ggml-opencl.cpp:151-155, 162-166, 297-317`.
- Found: The parser had branches for E031 and DX, but this checkout contains no documented E17 driver string or E17 version-field layout. E17 is mentioned only in compiler/kernel workaround comments. The old `return {}` also value-initialized the enum to E031, so an unrecognized string was not an explicit unknown type.
- Changed: Added `ADRENO_CL_COMPILER_TYPE::UNKNOWN_COMPILER`, made it the version struct's default, returned it explicitly for unrecognized compiler strings, and documented why E17 is intentionally not parsed.
- Adreno/E031.41.03.62: unchanged; the E031 branch and offsets are unchanged, and the known E031 string still returns `type == E031, major == 41, minor == 3, patch == 62`, so all existing gates retain their prior outcome.
- Build result: PASS on the required outer build tree. The first attempt exposed an unscoped-enumerator name collision with `GPU_FAMILY::UNKNOWN`; renaming the compiler sentinel to `UNKNOWN_COMPILER` fixed it, and the rerun completed successfully.

## Fix C — `ne01 == 0` MoE clamp underflow

- Host site: `ggml/src/ggml-opencl/ggml-opencl.cpp:22091`.
- Kernel sites audited: `ggml/src/ggml-opencl/kernels/gemv_moe_q2_k_f32_ns.cl:34`, `gemm_moe_q2_k_f32_ns.cl:131`; `gemv_moe_q3_k_f32_ns.cl:44`, `gemm_moe_q3_k_f32_ns.cl:128`; `gemv_moe_q4_k_f32_ns.cl:71`, `gemm_moe_q4_k_f32_ns.cl:233`; `gemv_moe_q5_k_f32_ns.cl:72`, `gemm_moe_q5_k_f32_ns.cl:237`; `gemv_moe_q6_k_f32_ns.cl:44`, `gemm_moe_q6_k_f32_ns.cl:209`.
- Found: The ten barrier-safe clamps use `ne01 - 1` for padded row loads. The graph-level `GGML_OP_MUL_MAT_ID` selector has no `ne01 == 0` guard; it only checks whether any tensor is on device and then calls `ggml_cl_mul_mat_id`, which also had no empty-row guard before dispatch.
- Changed: Added one shared host-dispatch early return when `src0->ne[1] == 0`, before any MoE setup or enqueue. This covers both GEMV and GEMM for q2_K through q6_K, so no kernel-side clamp or barrier-port logic changes are needed.
- Adreno/E031.41.03.62: unchanged for every non-empty shape; the guard is dimension-only and runs before the existing kernel selection, arguments, and dispatch. No device work was performed.
- Build result: PASS on the required outer build tree. Static checks also passed: `git diff --check`, the host guard is present at line 22091, and all 10 q2..q6 GEMV/GEMM clamp sites are present and covered by the shared early return.

## Build verification

- Command: `C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe -C C:\Users\gualt\Desktop\Kalsa\moe-experiments\build-android-opencl-s3oracle test-backend-ops ggml-opencl llama-bench -j 8`
- Result: PASS at final HEAD `0ea21aead`. CMake regenerated, then all 21 Ninja build steps completed; `ggml-opencl`, `test-backend-ops`, and `llama-bench` linked successfully. Only existing compiler warnings were emitted; no device work was performed.
