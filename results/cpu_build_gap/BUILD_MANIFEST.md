# CPU-fix Android OpenCL build manifest

Timestamp (local): 2026-08-12
Host: Windows 10, NDK cross-compile (`-j4`, PC PPL job left running)
Purpose: close the 12.37 vs 18.10 CPU tg gap (see `DIAGNOSIS.md`)

## Source

- Tree: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/opencl-q6k-dispatch-fix`
- HEAD: `a92a51627` (`tests: add Q6_K lm_head MUL_MAT shapes that must stay on noshuffle`)
- Source files: **not modified**
- Out-of-tree build: `build-android-opencl-cpufix/`

## Toolchain

Same NDK/CMake as K2 (`results/gdn_gpu_k2/BUILD_MANIFEST.md`).

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` |
| Ninja | same cmake package |
| Target compiler | NDK Clang 18.0.2 |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |

## Exact cmake configure (deltas vs K2.2 in **bold**)

```
cmake.exe
  -S .../BigMoeOnEdge/third_party/llama.cpp
  -B .../build-android-opencl-cpufix
  -G Ninja
  -DCMAKE_TOOLCHAIN_FILE=.../android.toolchain.cmake
  -DANDROID_ABI=arm64-v8a
  -DANDROID_PLATFORM=android-29
  -DANDROID_STL=c++_shared
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON
  -DBUILD_SHARED_LIBS=OFF
  -DLLAMA_CURL=OFF
  -DGGML_OPENMP=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENCL=ON
  -DGGML_VULKAN=OFF
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
  -DGGML_CPU_REPACK=OFF
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16
  -DCMAKE_C_FLAGS=-march=armv8.2-a+dotprod+fp16
  -DCMAKE_CXX_FLAGS=-march=armv8.2-a+dotprod+fp16
  -DOpenCL_INCLUDE_DIR=.../deps/opencl-android/OpenCL-Headers
  -DOpenCL_LIBRARY=.../deps/opencl-android/icd-build-android/libOpenCL.so
  -DLLAMA_BUILD_TESTS=ON
  -DLLAMA_BUILD_EXAMPLES=OFF
  -DLLAMA_BUILD_SERVER=ON
  -DLLAMA_BUILD_TOOLS=ON
  -DLLAMA_BUILD_COMMON=ON
  -DGGML_CCACHE=OFF
  -DHOST_CXX_COMPILER=.../deps/opencl-android/host_cxx.cmd
```

Configure evidence (`results/cpu_build_gap/build_cpufix.log` + CMakeCache):

- `GGML_CPU_REPACK:BOOL=OFF`
- `GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+fp16`
- `HAVE_DOTPROD - Success`
- `HAVE_MATMUL_INT8 - Failed` (intentional: no `+i8mm`)
- `HAVE_FP16_VECTOR_ARITHMETIC - Success`
- `Adding CPU backend variant ggml-cpu: -march=armv8.2-a+dotprod+fp16`
- `ggml commit: a92a51627`
- compile_commands: 15/15 ggml-cpu TUs have `-march=armv8.2-a+dotprod+fp16`; **0** have `GGML_USE_CPU_REPACK`

Build: `cmake --build build-android-opencl-cpufix -j 4 --target llama-cli llama-bench` (exit 0)

## Produced binaries

NDK Release injects `-g` even at `-O3` (see compile_commands). Post-link
`llvm-strip --strip-unneeded` is **required**: unstripped llama-bench is 125 MB
and loses ~3 tok/s on tg256 vs the 6.2 MB stripped image (I-cache / page faults).

Copies: `results/cpu_build_gap/bin/` (stripped)
On-device: `~/gdn_k2/bin_cpufix/` (K2 `bin/` and K2.2 `bin_fix/` untouched)
Device sha256 matches PC (verified 2026-08-12 via ssh, after strip).

| binary | size (B) | sha256 |
|---|---:|---|
| llama-cli (stripped) | 14396712 | `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80` |
| llama-bench (stripped) | 6234288 | `5092a319dd43a4e62095cc49ce15b329be96d0188734e7380d8935fe56b01ea3` |
| libc++_shared.so (NDK) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` |
| llama-cli unstripped (not shipped) | 187289328 | `c90e34cadf713ae0d5dc60164084af5e903bbeab16782b2d7177e6f54537e3fc` |
| llama-bench unstripped (not shipped) | 125370360 | `e9c25631134b697c5ccb32e73514ed46ce7f6c14173126d2cbd9eca39d392c56` |

`LD_LIBRARY_PATH=~/gdn_k2/bin_cpufix:/vendor/lib64`

## Bench command (UNPLUGGED, batt >= 45)

```
llama-bench -m ~/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf -t 4 -ngl 0 -p 128 -n 256 -r 2 -o json
llama-bench -m ~/gdn_k2/models/Qwen3.5-2B-Q4_K_M.gguf -t 4 -ngl 99 -fa off -p 128 -n 256 -r 2 -o json
```

On-device runner: `results/cpu_build_gap/run_cpufix_bench.sh` (also at `~/gdn_k2/bin_cpufix/run_cpufix_bench.sh`)
Logs: `~/gdn_k2/cpufix/logs/` → pulled to `results/cpu_build_gap/after/`

## Bench results (S23 SM-S911U, UNPLUGGED, batt 71→68%, Qwen3.5-2B-Q4_K_M, `-t 4 -r 2`)

| binary | ngl | pp128 | tg256 | notes |
|---|---:|---:|---:|---|
| Termux build-safe `67d5978` | 0 | 44.13 | **18.10** | campaign |
| K2.2 unstripped + REPACK ON + i8mm | 0 | 63.62 | **12.37** | before |
| cpufix unstripped + REPACK OFF | 0 | 36.12 | **15.28** | after/bench_cpu_unstripped.json |
| **cpufix stripped + REPACK OFF** | 0 | 37.86 | **18.19** | after/bench_cpu.json ; gate ≥16.3 **PASS** |
| cpufix stripped | 99, fa off | 82.01 | **10.25** | after/bench_gpu_faoff.json |

Honest GPU/CPU tg ratio (same stripped binary): **10.25 / 18.19 = 0.56×**
(GPU is slower than the fixed CPU baseline on this device.)
