# OpenCL picks integration report

Repository: `/Users/marco/Projects/kalsallama`

Worktree: `/Users/marco/Projects/kalsallama-wt-opencl`

Branch: `kalsa/opencl-picks-2026-09`

The main working tree was not checked out, switched, stashed, or built.

## Baseline verification

- Existing #26476 equivalent `5c7e16fa6` is present and is an ancestor of the side-branch base; it was not re-picked.

## Picks

### 1. `e8f19cc0ad70` — q4_K/q5_K uint loads

Status: applied cleanly; cherry-pick exit code 0.

Files changed: `ggml/src/ggml-opencl/kernels/mul_mv_q4_k_f32_flat.cl`, `ggml/src/ggml-opencl/kernels/mul_mv_q5_k_f32_flat.cl`.

No conflict hunks required resolution.

### 2. `43d87ff2dd0e` — Adreno image bounds/tiling

Status: conflict; initial `git cherry-pick -x` exit code 1, resolved, then `git cherry-pick --continue` exit code 0.

Files with conflicts: `ggml/src/ggml-opencl/ggml-opencl.cpp` and `ggml/src/ggml-opencl/kernels/gemv_noshuffle_q4_k_f32.cl`.

Resolution: kept the local `view_src` extra lookup, packed-stride and `n_head_kv==1` routing checks, and local q4_K row-major scale/output-guard layout; applied the upstream `view_offs`, explicit `is_kq`, image tile divisibility/dim-3 gates, and clamped `gid_s` to all q4_K fetches. The local `dcd0a7607` Q4_K non-128 redirect remains unchanged because the pick does not make its routing helper unreachable. The final commit message enumerates these resolved hunks.

### 3. `60addddf3c56` — FA multi-subgroup barrier fix

Status: applied cleanly; cherry-pick exit code 0.

Files changed: `ggml/src/ggml-opencl/kernels/flash_attn_f16.cl`, `ggml/src/ggml-opencl/kernels/flash_attn_f32.cl`.

No conflict hunks required resolution.

## Compile check

Configuration: `cmake -S . -B build-opencl-host -DGGML_OPENCL=ON -DGGML_CPU=OFF -DGGML_METAL=OFF -DGGML_OPENMP=OFF -DGGML_NATIVE=OFF -DLLAMA_BUILD_COMMON=OFF -DLLAMA_BUILD_TESTS=OFF -DLLAMA_BUILD_EXAMPLES=OFF -DLLAMA_BUILD_TOOLS=OFF -DLLAMA_BUILD_SERVER=OFF -DLLAMA_BUILD_APP=OFF -DGGML_BUILD_TESTS=OFF -DGGML_BUILD_EXAMPLES=OFF`, exit code 0.

Compile: `cmake --build build-opencl-host --target ggml-opencl`, exit code 2. Generation completed and compilation reached `ggml-opencl.cpp`, then stopped because the host lacks `CL/cl.h`. No container or Android build was run, and no further compile attempt was made.

## Final history

`git log --oneline main..HEAD`:

```text
12f6d9b6d opencl: fix WAR race in the generic FA tile kernels when the WG spans subgroups (#26434)
8fe4bf8d3 opencl: fix out‐of‐bound reads in the Adreno image kernels (#27632)
b7a5e926b opencl: loads quants as uint for q4_K and q5_K flat mv (optimization for Adreno A7x GPUs) (#25780)
```

Final status: clean side worktree with three reviewed commits; device verification remains gated on the S23's return.
