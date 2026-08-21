# Queue #13 — q4_K/q5_K/q6_K MoE barrier-safe port

Repo: `BigMoeOnEdge/third_party/llama.cpp`, branch `kalsa/kernel-s3-repack`, base `5c7e16fa6`.

## Commit

Local commit: `9a4112106` — `opencl: make q4/q5/q6 MoE K kernels barrier-safe`.

## Kernel status

| Kernel | Site | Before | After | `%64` bit-identical rationale |
|---|---|---|---|---|
| q4_K GEMV | `gemv_moe_q4_k_f32_ns.cl` row guard and row-indexed q/d/dm/scale loads | Early return before the reduction barrier; loads used `i01` directly | Validity predicate, all lanes continue, invalid lanes load clamped last row, store is predicated | On `ne01 % 64 == 0`, every launched lane is valid, so the clamp selects `i01` and the store predicate is true |
| q5_K GEMV | `gemv_moe_q5_k_f32_ns.cl` row guard and row-indexed q/qh/d/dm/scale loads | Same early-return pattern | Same predicate/clamp/store pattern | Same: every lane is valid, clamp is a no-op and store predicate is true |
| q6_K GEMV | `gemv_moe_q6_k_f32_ns.cl` row guard and row-indexed ql/qh/d/scale loads | Same early-return pattern | Same predicate/clamp/store pattern | Same: every lane is valid, clamp is a no-op and store predicate is true |
| q4_K GEMM | `gemm_moe_q4_k_f32_ns.cl` post-compute row return and d/scale/q image loads | Return before `out_idx` barrier; padded lanes used an invalid row | All lanes reach barriers; row-indexed loads use clamped valid row; stores are predicated | On `ne01 % 64 == 0`, all rows are valid, row offset is unchanged, and all stores execute |
| q5_K GEMM | `gemm_moe_q5_k_f32_ns.cl` post-compute row return and d/scale/q/qh image loads | Same return/OOB pattern | Same predicate/clamp/store pattern | Same: validity is true for every lane and all clamps are no-ops |
| q6_K GEMM | `gemm_moe_q6_k_f32_ns.cl` post-compute row return and d/scale/q/qh image loads | Same return/OOB pattern | Same predicate/clamp/store pattern | Same: validity is true for every lane and all clamps are no-ops |

No uncertain sites remain after inspection. The q4/q5/q6 K2 scale-mask arguments and trans4/scalar-uint code are intentionally untouched. Kernel edits are complete; no q2/q3 or dense kernel was changed.

## Build

Passed: `ninja -C build-android-opencl-s3oracle test-backend-ops ggml-opencl -j 8` returned exit code 0 with `ninja: no work to do` after the configured SDK Ninja build completed. The initial shell attempt was blocked because Ninja was not on `PATH`; the first SDK-Ninja attempt timed out at the wrapper while child compilation continued, then the exact command was rerun cleanly. No device or adb verification was attempted.

Kernel source checks: `git diff --check` passes; no target row early-return site remains.

## Tests added

Added in `tests/test-backend-ops.cpp`: q4_K, q5_K, and q6_K `MUL_MAT_ID` m=96 cases for GEMV (`n=1`) and GEMM (`n=4`), each with `k=256`, `n_mats=4`, and `n_used=2`. These complement the existing q2_K/q3_K cases and exercise `%32 && !%64` row padding. The Android `test-backend-ops` target was built; runtime/device execution is deferred to the separate device session.
