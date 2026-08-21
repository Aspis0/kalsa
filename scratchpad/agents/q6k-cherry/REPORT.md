# Task #3 — upstream #26476 q6_K flat dense verification

Status: **PASS / COMPLETE**

Scope: llama.cpp submodule only, plus this incremental report and `results/q6k_cherry_s23/` artifacts. The dirty outer `BigMoeOnEdge` worktree is pre-existing WIP and is not being touched, committed, or stashed.

## Step 1 — upstream fetch / identification

- Submodule: `BigMoeOnEdge/third_party/llama.cpp`
- Branch before change: `kalsa/kernel-s3-repack`
- Starting HEAD: `ec7235af687137bb85d8541b027e0c6a01583c1a` (`kalsakernel-v4`)
- `upstream`: `https://github.com/ggml-org/llama.cpp` (fetch-only; push URL unchanged/disabled)
- Fetch: `git fetch upstream master` completed.
- PR #26476 commit: `6503355df0eb4f65875012523263c302fe0088c1`
- Subject: `opencl: fix q6_K flat mul_mat for Adreno A6x/A7x GPUs with older E031 compilers (#26476)`

The upstream commit changes only `ggml/src/ggml-opencl/ggml-opencl.cpp` and `ggml/src/ggml-opencl/kernels/mul_mv_q6_k_f32_flat.cl`. Cherry-pick and conflict-resolution details will be added below immediately after the operation.

## Prior recipe located

The previous S23 runs use the existing shared build tree `build-android-opencl-s3oracle`, configured from llama.cpp with Android arm64-v8a, API 29, NDK 27.1.12297006, Ninja Release, `BUILD_SHARED_LIBS=ON`, `GGML_OPENCL=ON`, embedded OpenCL kernels, and Adreno kernels enabled. The device directory is `/data/local/tmp/s3oracle`; runs use the TLS S23 serial from the PC-side `adb shell`, never Termux. The exact push list and hash-before-run discipline are documented in `results/oracle_consumer_s23/k2_phase1/MANIFEST.md` and `results/qk23_s23/MANIFEST.md` and will be copied into the final manifest for this task.

## Step 1–2 checkpoint

Completed.

- Cherry-pick result: final local commit `5c7e16fa682834ee4d4ba9dca8a18b283af95393`.
- The build and device artifacts were produced from the tree-identical pre-message-amend commit `532ac356c`; the final amend changed only commit metadata and the final commit’s tree is identical.
- The upstream commit applied cleanly to the q6_K kernel file.
- One conflict occurred in `ggml-opencl.cpp` at the q6_K flat program build call. Upstream’s newer helper signature was adapted to this branch’s existing `build_program_from_source(context, device, source, opts)` signature; the new `q6k_opts` is passed unchanged.
- Retained all upstream changes: `q6_k_flat_old_compiler` state/gate, `-DADRENO_OLD_COMPILER=1` only for old E031, q6_K kernel arg 17, the A7X FLASH_ATTN_EXT carve-out, and the scalar q6_K flat kernel path.
- Conflict scope did not include any MoE q2_K/q3_K/q4_K/q5_K implementation, mask-as-arguments code, scalar-uint trans4 code, or test harness changes. Commit diff is exactly two files: `ggml-opencl.cpp` and `mul_mv_q6_k_f32_flat.cl`; `git diff --check` is clean.
- Submodule working tree is clean after the cherry-pick. Outer repository WIP remains untouched.

Build and device verification are complete; the detailed checkpoints below contain the recipe, hashes, raw-log references, and outcomes.

## Build checkpoint — 2026-08-21

- Build tree: `build-android-opencl-s3oracle`
- Command: `C:\Users\gualt\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe -C build-android-opencl-s3oracle test-backend-ops ggml-opencl -j 8`
- Result: **PASS**, exit 0. CMake regenerated the embedded `mul_mv_q6_k_f32_flat.cl.h`; `ggml-opencl.cpp` compiled with only the existing `use_adreno_bin_kernels` unused-parameter warning and an existing TODO pragma warning.
- Configure/build identity: Android arm64-v8a, `android-29`, NDK `27.1.12297006`, Ninja Release, `BUILD_SHARED_LIBS=ON`, `GGML_OPENCL=ON`, embedded kernels ON, Adreno kernels ON; CMake reported the tree-identical pre-amend commit `532ac356c`.

### PC artifacts used for deployment

| artifact | bytes | PC SHA-256 |
|---|---:|---|
| `libggml-opencl.so` | 8378584 | `b9d99fa8d8be3e40661fb2edbde27229d8666fcc58c481cbb0944dd0cfd36773` |
| `libggml.so` | 536880 | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` |
| `libggml-base.so` | 6103496 | `e51ed14311cec90136ed76cd9755696b0e81c6897b9e0b173d525da9cc3ee8e5` |
| `libggml-cpu.so` | 5165056 | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` |
| `libllama.so` | 39807624 | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` |
| `libllama-common.so` | 78377240 | `646bd2d83576e8b6f2755e5ae7d7bee6064cf920bef4a89718a1b9bc115c543d` |
| `test-backend-ops` | 10173424 | `21d6110dc147adf249505a9808fc36075eb58b02e688366a112d02629c58bdb1` |
| `libc++_shared.so` (NDK aarch64) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
| `libomp.so` (NDK clang 18 aarch64) | 1229304 | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` |

The device is reachable at the requested TLS serial. Pre-deploy state: S23 `SM-S911U`, `kalama`, unplugged (`AC/USB/wireless=false`), battery 79%, temperature 27.4 °C. Device `/data` free space is about 1.8 GiB. Device execution will use `/data/local/tmp/s3oracle`; `s3base`, `s3fix`, and `s3printf` remain out of scope.

## Device verification checkpoint — 2026-08-21

Deployment recreated only `/data/local/tmp/s3oracle`, pushed the nine artifacts listed above, set `test-backend-ops` executable, and verified PC/device SHA-256 equality. The two run headers each contain the full nine-artifact on-device hash block immediately before the test process started. Environment matched prior runs: `LD_LIBRARY_PATH=/data/local/tmp/s3oracle`, `GGML_OPENCL_LOG_KERNELS=1`, and HOST_REPACK/DUMP_Q/ORACLE/CVT_OPTS/MOE_OPTS/CVT_VARIANT unset.

Results:

- Dense `./test-backend-ops -o MUL_MAT`: **925/925**, OpenCL OK, rc 0. All ten known dense q6_K flat cases (`m=16`, `n=1..9`, plus the repeated `n=1` case) are `OK`; no `FAIL` or `ERR` lines.
- MoE `./test-backend-ops -o MUL_MAT_ID`: **401/401**, OpenCL OK, rc 0. This preserves the 401/401 baseline. Relevant MoE totals remain q2_K 5, q3_K 5, q4_K 80, q5_K 4, q6_K 3; kernel traces include the existing q2/q3/q4/q5/q6 MoE GEMV/GEMM paths.
- Device compiler logged by both runs: Qualcomm Adreno 740, E031.41.03.62.

Raw logs and the complete deployment/run manifest are in `results/q6k_cherry_s23/`. Final submodule-only commit: `5c7e16fa682834ee4d4ba9dca8a18b283af95393`. No push was performed.
