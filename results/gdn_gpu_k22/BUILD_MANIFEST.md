# K2.2 Android OpenCL build manifest

Timestamp (local): 2026-08-12
Host: Windows 10, incremental rebuild of `build-android-opencl-k2/` (`-j4`, PC PPL job left running)

## Source

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/opencl-q6k-dispatch-fix`
- Base: `e5605f3bd` (`mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)`)
- HEAD: `a92a51627` (`tests: add Q6_K lm_head MUL_MAT shapes that must stay on noshuffle`)
- Commits on branch:
  - `32b318aab` opencl: do not steal Q6_K noshuffle GEMV for large even-vocab M
  - `a92a51627` tests: add Q6_K lm_head MUL_MAT shapes that must stay on noshuffle
- Out-of-tree build: `build-android-opencl-k2/` (reused from K2; cmake re-ran because ggml commit changed)
- Diff: `results/gdn_gpu_k22/fix.diff`

## Toolchain

Same as K2 (`results/gdn_gpu_k2/BUILD_MANIFEST.md`).

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |
| Flags | `GGML_OPENCL=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_VULKAN=OFF`, `GGML_OPENMP=OFF`, `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` |

Configure notes:
- `OpenCL will use matmul kernels optimized for Adreno`
- kernels `gated_delta_net` and `ssm_conv` embedded
- `ggml commit: a92a51627`

Build: `cmake --build build-android-opencl-k2 -j 4 --target llama-cli llama-bench test-backend-ops` (exit 0)

## Produced binaries

Copies: `results/gdn_gpu_k22/bin/`
On-device: `~/gdn_k2/bin_fix/`

| binary | size (B) | sha256 |
|---|---:|---|
| llama-cli | 188022720 | `6b48ee5b1eac7d943f44d3e410f92e9bc5964949dd14fb92d8f104832d938e5d` |
| llama-bench | 126084160 | `2da272069cf9a0601376e5022a676c242c6eb477f3a8ef5a94fb83110299fd7e` |
| test-backend-ops | 24993672 | `e96b7d4c107b9c9dcff50fbdbe51f2ce36a70de5c8b74dae5a02d3b2785261e3` |
| libc++_shared.so (NDK) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |

DT_NEEDED: `libm.so`, `libdl.so`, `libOpenCL.so`, `libc++_shared.so`, `libc.so`.
On-device: vendor `libOpenCL.so` (Adreno) + pushed `libc++_shared.so` via `LD_LIBRARY_PATH=~/gdn_k2/bin_fix`.
