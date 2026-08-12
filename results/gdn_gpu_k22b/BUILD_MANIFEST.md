# K2.2b Android OpenCL build manifest

Timestamp (local): 2026-08-12
Host: Windows 10, incremental rebuild of `build-android-opencl-k2/` (`-j4`, PC PPL job left running)

## Source

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/opencl-q6k-dispatch-fix`
- Base: `e5605f3bd` (`mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)`)
- HEAD: `04c5d362a` (`tests: add Q6_K n=64 and Q4_K large-M MUL_MAT cases that must not hit the broken flat kernel on Adreno`)
- Commits on branch (K2.2 + K2.2b):
  - `32b318aab` opencl: do not steal Q6_K noshuffle GEMV for large even-vocab M
  - `a92a51627` tests: add Q6_K lm_head MUL_MAT shapes that must stay on noshuffle
  - `dcd0a7607` opencl: fix Q6_K GEMM comment and stop stealing Q4_K noshuffle for large even-M
  - `04c5d362a` tests: add Q6_K n=64 and Q4_K large-M MUL_MAT cases that must not hit the broken flat kernel on Adreno
- Out-of-tree build: `build-android-opencl-k2/` (reused from K2.2; cmake re-ran because ggml commit changed)
- Diff: `results/gdn_gpu_k22/fix.diff` (full branch vs `e5605f3bd`)

## Toolchain

Same as K2 / K2.2 (`results/gdn_gpu_k22/BUILD_MANIFEST.md`).

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |
| Flags | `GGML_OPENCL=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_VULKAN=OFF`, `GGML_OPENMP=OFF`, `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` |

Configure notes:
- `OpenCL will use matmul kernels optimized for Adreno`
- kernels `gated_delta_net` and `ssm_conv` embedded
- `ggml commit: 04c5d362a`

Build: `cmake --build build-android-opencl-k2 -j 4 --target llama-cli llama-bench test-backend-ops` (exit 0)

## Produced binaries

Copies: `results/gdn_gpu_k22b/bin/`
On-device: `~/gdn_k2/bin_fix2/` (on-device sha256 matches)

| binary | size (B) | sha256 |
|---|---:|---|
| llama-cli | 188023256 | `0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da` |
| llama-bench | 126084696 | `1456239bc3a033e9d6198d2370516990e0e97c0dc939c54d94b2bf7fb8e18aca` |
| test-backend-ops | 24999288 | `8f0037c90f9edf2e70ac56c4ba9c5874d625999b140f85bfb84ed8f9a954b0ea` |
| libc++_shared.so (NDK) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |

DT_NEEDED: `libm.so`, `libdl.so`, `libOpenCL.so`, `libc++_shared.so`, `libc.so`.
On-device: vendor `libOpenCL.so` (Adreno) + pushed `libc++_shared.so` via `LD_LIBRARY_PATH=~/gdn_k2/bin_fix2`.
