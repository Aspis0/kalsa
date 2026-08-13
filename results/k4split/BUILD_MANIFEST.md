# K4-SPLIT build manifest

Timestamp (local): 2026-08-13 (PC complete; Android parent+OpenCL compile running)
Host: Windows 10. MarcoKEXP PPL left running (`build-pc/cli/bmoe-cli.exe` pid 34868, `-t 8`).
Builds capped at `-j4`. Did not reuse `build-android/` or edit `build-android.ps1`.

## Source

- Parent: `BigMoeOnEdge` (residency kernel already on `main`: `e926a54`, `342df14`, `8958cdf`)
- Fork: `BigMoeOnEdge/third_party/llama.cpp`
- Branch: `kalsa/split-trunk-gpu` (created locally from `kalsa/opencl-q6k-dispatch-fix`)
- HEAD: `04c5d362afb4ae3cf7762a81e204f6cba15c5480`
  (`tests: add Q6_K n=64 and Q4_K large-M MUL_MAT cases that must not hit the broken flat kernel on Adreno`)
- Working tree was `kalsa/mld-gemv-m1` @ `7670428d6` (clean). Switched in-place so parent
  `add_subdirectory(third_party/llama.cpp)` builds the Q6_K-fix tree. M1 GEMV objects are
  **not** in these binaries. No ggml-opencl / FLASH_ATTN / GEMV source edits.
- Hook: `ggml_cpu_set_expert_ready_hook` present in `ggml-cpu.h` / `ggml-cpu.c`.
- Parent wiring (no fork patch): `--ngl`, `--flash-attn` (default off), `--moe-cpu-experts`,
  `--override-tensor`, `--dense-weights anon-gpu`. See `IMPL_NOTES.md`.

## What failed

- Nothing at configure time (PC and Android).
- Android **link not finished at first write of this file** — see §Android. Update this
  section when `build_android.log` ends.

---

## PC `bmoe-cli` (no OpenCL; flag/link check)

Existing `build-pc/` left untouched (PPL holds `cli/bmoe-cli.exe`).

Recipe: VS 2022 BuildTools + Ninja (same generator as `build-pc/`).

```
vcvars64.bat
cmake -S BigMoeOnEdge -B build-pc-k4split -G Ninja
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_MAKE_PROGRAM=C:/Program Files (x86)/Microsoft Visual Studio/2022/BuildTools/Common7/IDE/CommonExtensions/Microsoft/CMake/Ninja/ninja.exe
  -DBMOE_BUILD_TESTS=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENCL=OFF
  -DGGML_OPENMP=OFF
  -DLLAMA_CURL=OFF
cmake --build build-pc-k4split -j 4 --target bmoe-cli
```

Configure notes (`results/k4split/build_pc_configure.log`):

- `ggml commit:  04c5d362a`
- `bmoe: expert-ready hook present (I/O–compute overlap available)`
- `BigMoeOnEdge: llama.cpp present = ON`
- `BUILD_SHARED_LIBS=ON` (default; exe + ggml/llama DLLs). OpenCL off on purpose
  (desktop ICD is not Adreno).

`--help` lists `--ngl`, `--flash-attn`, `--moe-cpu-experts`, `--override-tensor`, `anon-gpu`
(`results/k4split/bmoe_cli_pc_help.txt`).

| file | size (B) | sha256 |
|---|---:|---|
| bmoe-cli-pc.exe | 347136 | `d2672584ddd8ac6453101850c19fde3eedf15df5390e18dad5efb16f2fa477a0` |
| llama.dll | 2225152 | `6e9835964b61b9465a7b023c190a6411d105220da62623c808704cfca11c20c7` |
| llama-common.dll | 9255936 | `5028afa6b3501bc11242b25988380a6bad405c6619894b5998d0c59c78f588a2` |
| ggml.dll | 67072 | `55ecdff50d65f585d311300a2a2a37a4af359e86fd9ef525e7fad39d36730d9b` |
| ggml-base.dll | 643072 | `c0ed71fde0f1687a3ce559a2dbc19109e2db382b449e8541c74795ac09477b4a` |
| ggml-cpu.dll | 894976 | `265b4cd6217bc4ce9439792c3d83ec4aed45c5bff9eaa8f5d58b87c0f275e683` |

Copies: `results/k4split/bin/` (run with those DLLs on `PATH` or next to the exe).
Logs: `configure_pc.cmd`, `build_pc.cmd`, `build_pc_configure.log`, `build_pc.log`.

---

## Android `bmoe-cli` (OpenCL + Adreno + parent hook)

Out-of-tree: `build-android-opencl-k4split/` (new; not `build-android/`).
Parent source dir so the product binary is `bmoe-cli` with the hook statically linked.

### Toolchain

| item | value |
|---|---|
| NDK | `C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006` (r27b, Pkg.Revision 27.1.12297006) |
| CMake | `C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe` |
| Ninja | same cmake package |
| Target compiler | NDK Clang 18.0.2 (`windows-x86_64` prebuilt) |
| ABI / platform | `arm64-v8a` / `android-29` / `c++_shared` |
| OpenCL headers | `deps/opencl-android/OpenCL-Headers` |
| OpenCL link stub | `deps/opencl-android/icd-build-android/libOpenCL.so` (318248 B); device uses vendor ICD |
| HOST_CXX | not required (parent does not build `llama-cli` / UI embed) |

### Exact cmake configure

```
C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/cmake.exe
  -S C:/Users/gualt/Desktop/Kalsa/moe-experiments/BigMoeOnEdge
  -B C:/Users/gualt/Desktop/Kalsa/moe-experiments/build-android-opencl-k4split
  -G Ninja
  -DCMAKE_TOOLCHAIN_FILE=C:/Users/gualt/AppData/Local/Android/Sdk/ndk/27.1.12297006/build/cmake/android.toolchain.cmake
  -DANDROID_ABI=arm64-v8a
  -DANDROID_PLATFORM=android-29
  -DANDROID_STL=c++_shared
  -DCMAKE_BUILD_TYPE=Release
  -DCMAKE_MAKE_PROGRAM=C:/Users/gualt/AppData/Local/Android/Sdk/cmake/3.22.1/bin/ninja.exe
  -DBMOE_BUILD_TESTS=OFF
  -DBUILD_SHARED_LIBS=OFF
  -DGGML_BACKEND_DL=OFF
  -DGGML_NATIVE=OFF
  -DGGML_OPENCL=ON
  -DGGML_OPENCL_USE_ADRENO_KERNELS=ON
  -DGGML_OPENCL_EMBED_KERNELS=ON
  -DGGML_VULKAN=OFF
  -DGGML_OPENMP=OFF
  -DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16
  -DLLAMA_CURL=OFF
  -DGGML_CCACHE=OFF
  -DOpenCL_INCLUDE_DIR=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android/OpenCL-Headers
  -DOpenCL_LIBRARY=C:/Users/gualt/Desktop/Kalsa/moe-experiments/deps/opencl-android/icd-build-android/libOpenCL.so
```

Build: `cmake --build build-android-opencl-k4split -j 4 --target bmoe-cli`

Configure notes (`results/k4split/build_android_configure.log`):

- `Found OpenCL ... (found version "2.2")`
- `OpenCL will use matmul kernels optimized for Adreno`
- kernels `gated_delta_net` and `ssm_conv` embedded
- `HAVE_DOTPROD` / `HAVE_MATMUL_INT8` / `HAVE_FP16_VECTOR_ARITHMETIC` Success; SVE/SME Failed
- `ggml commit:  04c5d362a`
- `Including OpenCL backend`
- `bmoe: expert-ready hook present (I/O–compute overlap available)`
- `BigMoeOnEdge: llama.cpp present = ON`
- OpenSSL missing → HTTPS disabled (irrelevant for CLI)
- ninja link line is one ELF: `cli/bmoe-cli` ← `libbmoe_core.a` + `libllama.a` +
  `libggml.a` + `libggml-cpu.a` + `libggml-opencl.a` + `libggml-base.a` + stub `libOpenCL.so`

ISA: `armv8.2-a+dotprod+i8mm+fp16` matches K2 OpenCL + campaign Termux (S23 has i8mm).
Product `build-android.ps1` stays `GGML_OPENCL=OFF` and without i8mm — not edited.

### Produced binaries

**IN PROGRESS** at first write. Expected path: `build-android-opencl-k4split/cli/bmoe-cli`.
Log: `results/k4split/build_android.log`. Stage script: `stage_android.ps1`.

| binary | size (B) | sha256 |
|---|---:|---|
| bmoe-cli | (pending compile `-j4`) | (pending) |
| libc++_shared.so (NDK) | 1794776 | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` (copied to `results/k4split/bin/`; matches K2) |

DT_NEEDED: pending `llvm-readelf -d`. Expect K2 set: `libm.so`, `libdl.so`, `libOpenCL.so`,
`libc++_shared.so`, `libc.so`. On-device: vendor `libOpenCL.so` + pushed `libc++_shared.so`
via `LD_LIBRARY_PATH`. Device workspace later: `~/gdn_k2/k4split/` (not this task).

Fallback `llama-cli` OpenCL: **not built**. Parent+OpenCL configure succeeded; hook+ngl
compose in `bmoe-cli`. If the Android link fails, K2.2b `llama-cli` @ `04c5d362a`
(`results/gdn_gpu_k22b/bin/`, sha `0b6be132c2476f6d0848631ecff703ad6400337c612972c2ad43da2a5a8fd8da`)
exists but **hook + `--moe-stream` do not compose in that binary**.

## Not done (out of scope for this task)

- Device push / N1 load / N2 correctness / N3 speed
- PLAN.md
- git push
- Xiaomi / Jelly / S23 SSH
