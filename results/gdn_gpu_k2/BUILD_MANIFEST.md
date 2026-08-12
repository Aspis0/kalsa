# K2 Android OpenCL build manifest

Timestamp (local): 2026-08-12T12:43:36-04:00
Host: Windows 10, cross-compile via Android NDK (PC PPL job left running; build `-j4`)

## Source

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/mmap-prefetch-opt`
- HEAD: `e5605f3bd` (`mmap: fix ABI compatibility of mmap_prefetch (tri-state int32_t)`)
- Source files: **not modified**
- Out-of-tree build: `build-android-opencl-k2/`

## Toolchain

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b, Pkg.Revision 27.1.12297006) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` (3.22.1-g37088a8-dirty) |
| Ninja | same cmake package |
| Target compiler | NDK Clang 18.0.2 (`windows-x86_64` prebuilt) |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |
| OpenCL headers | Khronos `OpenCL-Headers` clone in `deps/opencl-android/OpenCL-Headers` |
| OpenCL link lib | Khronos ICD loader `deps/opencl-android/icd-build-android/libOpenCL.so` (318248 B) |
| Host UI embed | MSVC cl.exe (VS 2022 BuildTools) produced `llama-ui-embed-host.exe`; cmake invoked via `deps/opencl-android/host_cxx.cmd` |

## Exact cmake configure

```
C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe
  -S C:/Users/gualt/Desktop/Kalsa/moe-experiments/BigMoeOnEdge/third_party/llama.cpp
  -B C:/Users/gualt/Desktop/Kalsa/moe-experiments/build-android-opencl-k2
  -G Ninja
  -DCMAKE_TOOLCHAIN_FILE=C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006/build/cmake/android.toolchain.cmake
  -DANDROID_ABI=arm64-v8a
  -DANDROID_PLATFORM=android-29
  -DANDROID_STL=c++_shared
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_MAKE_PROGRAM=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe
  -DBUILD_SHARED_LIBS=OFF
  -DLLAMA_CURL=OFF
  -DGGML_OPENMP=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENCL=ON
  -DGGML_VULKAN=OFF
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16
  -DOpenCL_INCLUDE_DIR=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android/OpenCL-Headers
  -DOpenCL_LIBRARY=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android/icd-build-android/libOpenCL.so
  -DLLAMA_BUILD_TESTS=ON
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DLLAMA_BUILD_TOOLS=ON
  -DLLAMA_BUILD_COMMON=ON
  -DGGML_CCACHE=OFF
  -DHOST_CXX_COMPILER=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android/host_cxx.cmd
```

Build: `cmake --build build-android-opencl-k2 -j 4 --target llama-cli llama-bench test-backend-ops`

Configure notes:
- `Found OpenCL ... (found version "2.2")`
- `OpenCL will use matmul kernels optimized for Adreno`
- kernels `gated_delta_net` and `ssm_conv` embedded
- `ggml commit: e5605f3bd`
- OpenSSL missing → HTTPS disabled (irrelevant for CLI/bench/ops)

## Produced binaries

DT_NEEDED: `libm.so`, `libdl.so`, `libOpenCL.so`, `libc++_shared.so`, `libc.so`.
On-device: vendor `libOpenCL.so` (Adreno) + pushed `libc++_shared.so` via `LD_LIBRARY_PATH`.

| binary | size (B) | sha256 |
|---|---:|---|
| llama-cli | 188020280 | `c86bbe987e16dfb45feef4b860f0c03bb08f01894c153b108e0852f61741eaa9` |
| llama-bench | 126081792 | `a6fc70e3bbaa6b9bc7cb323332ada7044fe657f3e9b17706a773d7e3b20fd5ac` |
| test-backend-ops | 24986176 | `154506736cdbeda7ca3cd5263b2f98328828527af7b13ffebf6e21b3dd7b2bc4` |
| libc++_shared.so (NDK) | (see SHA256SUMS) | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |

Copies: `results/gdn_gpu_k2/bin/`
Full configure/build log: `results/gdn_gpu_k2/build_opencl_ndk.log`

## Model (to push)

- `models_staging/Qwen3.5-2B-Q4_K_M.gguf`
- size: 1280835840 B
- sha256 (`models_staging/SHA256SUMS.txt`): `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`
