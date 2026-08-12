# CPU build gap (S23): 12.37 → 18.19 tg

Same phone, same `Qwen3.5-2B-Q4_K_M.gguf`, same `-t 4`, llama-bench tg256,
**unplugged**. No source edits — flags + post-link strip only.

## Cause

Two independent build-config bugs, stacked.

**1. `GGML_CPU_REPACK=ON` + `+i8mm` stole Q4_K GEMV.**
K2/k22 already compiled `-march=armv8.2-a+dotprod+i8mm+fp16` (`HAVE_DOTPROD`
Success in `results/gdn_gpu_k2/build_opencl_ndk.log`). This was **not** a
generic armv8-a NDK default. Because feature probes in this tree are compile-time
macros, `ggml_cpu_has_matmul_int8()` returned 1 and `repack.cpp` converted
every Q4_K weight with `ne[1]%8==0` to `q4_K_8x8_q8_K`. That layout is a GEMM
win (pp 82 vs build-safe 44) and a GEMV loss (tg 12.37 vs 18.10).
`build-safe` is on-device Termux (`scripts/build_llama_termux.sh`, pin
`67d5978` / b10244, `GGML_OPENCL=OFF`) and never took this extra-buffer path.

**2. NDK Release still links `-g`.** Unstripped `llama-bench` is 125 MB.
Termux ships small `.so`s. `llvm-strip --strip-unneeded` → 6.2 MB and the
remaining ~3 tok/s come back.

OpenCL linkage at `-ngl 0` is not the gap: pp got *faster* under the broken
build.

## Fix

Out-of-tree `build-android-opencl-cpufix/`, same tree
`kalsa/opencl-q6k-dispatch-fix` @ `a92a51627`:

- `-DGGML_CPU_REPACK=OFF`
- `-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16` (no `+i8mm`)
- `-DCMAKE_C_FLAGS=-march=armv8.2-a+dotprod+fp16` (same for CXX)
- `GGML_OPENCL=ON`, `GGML_NATIVE=OFF`, `GGML_OPENMP=OFF`, `-j4`
- post-link `llvm-strip --strip-unneeded`

Device: `~/gdn_k2/bin_cpufix/` (k2 `bin/` and k22 `bin_fix/` untouched).
sha256 device == PC:

| file | sha256 | size |
|---|---|---:|
| llama-bench | `5092a319dd43a4e62095cc49ce15b329be96d0188734e7380d8935fe56b01ea3` | 6234288 |
| llama-cli | `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80` | 14396712 |
| libc++_shared.so | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | 1794776 |

## Numbers

llama-bench `-p 128 -n 256 -r 2`. Batt 71→68%, never plugged.

| binary | ngl | pp128 tok/s | tg256 tok/s |
|---|---:|---:|---:|
| Termux build-safe (`67d5978`) | 0 | 44.13 | **18.10** |
| K2.2 NDK (REPACK ON, +i8mm, unstripped) | 0 | 63.62 | **12.37** |
| cpufix unstripped, REPACK OFF | 0 | 36.12 | 15.28 |
| **cpufix stripped, REPACK OFF** | 0 | 37.86 | **18.19** |
| cpufix stripped | 99, `-fa off` | 82.01 | **10.25** |

Gate: tg ≥ 16.3. **PASS** (18.19 / 18.10 = 1.005×).

Honest GPU/CPU tg ratio on the fixed binary: **10.25 / 18.19 = 0.56×**.
Adreno OpenCL is slower than this CPU baseline on S23 for this model.

Full evidence: `results/cpu_build_gap/` (`DIAGNOSIS.md`, `BUILD_MANIFEST.md`,
before/after JSONs).
