# M1 Android OpenCL build manifest

Timestamp (local): 2026-08-12
Host: Windows, incremental rebuild of `build-android-opencl-k2/` (`-j4`, PC PPL/`bmoe-cli` left running)

## Source

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/mld-gemv-m1`
- Base: `kalsa/opencl-q6k-dispatch-fix` @ `04c5d362a`
- HEAD: `7670428d6`

Commits on branch:

| sha | message |
|---|---|
| `303eb5965` | opencl: add subgroup-free Q4_K MLD GEMV kernel and tiled convert |
| `2306c171c` | opencl: wire MLD Q4_K convert, env gate, and decode GEMV dispatch |
| `646ff326e` | tests: add Q4_K decode GEMV shapes for the MLD M1 kernel |
| `a8b1854c6` | tests: add Q4_K n=1 shapes to test-backend-ops perf mode |
| `208745803` | opencl: fix MLD Q4_K GEMV — keep GGUF qs packing, no vstore to private |
| `042d76953` | opencl: MLD GEMV reads proven generic Q4_K SOA to isolate dequant |
| `7670428d6` | opencl: MLD default compute is stock SOA flat GEMV; custom scalar is diagnostic |

Out-of-tree build: `build-android-opencl-k2/` (reused from K2; cmake re-ran).

## Toolchain

Same as K2 (`results/gdn_gpu_k2/BUILD_MANIFEST.md`).

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |
| Flags | `GGML_OPENCL=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON` |

Build: `cmake --build build-android-opencl-k2 -j 4 --target llama-cli llama-bench test-backend-ops`

## Produced binaries

Copies: `results/mld_m1/bin/`
On-device: `~/gdn_k2/bin_mld/`

| binary | size (B) | sha256 |
|---|---:|---|
| llama-cli | 188071232 | `2751ea4b21939e08c9de49dadadf447443e09124cb0714ed404a4ea02499a912` |
| llama-bench | 126132520 | `05bcf2e4703da65e0158a2f2eb1d29ee6868feda903621552ce6109e9d79480c` |
| test-backend-ops | 25075528 | `691d194b70c7436984ab0b49635708b67fdca45f14617a1cfd962c357b5f6752` |
| libc++_shared.so (NDK) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
