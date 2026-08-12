# CPU build gap — diagnosis

Date: 2026-08-12
Device: S23 (SM-S911U / dm1q), unplugged llama-bench, Qwen3.5-2B-Q4_K_M, `-t 4`

## Numbers that define the gap

| binary | backends | commit | pp128 tg/s | tg256 tok/s |
|---|---|---|---:|---:|
| Campaign Termux `build-safe` | CPU only | `67d5978` (b10244) | 44.13 | **18.10** |
| K2.2 NDK OpenCL (`-ngl 0`) | OpenCL+CPU | `a92a51627` | 63.62 (82 / 45) | **12.37** |

Sources:
- `results/litert_product/llama_bench_qwen35_2b.json`
- `results/gdn_gpu_k22/s23/logs/bench_cpu.json`

Gate: corrected CPU tg >= 16.3 (within 10% of 18.1).

## Suspect 1 — `-march` / missing dotprod — REFUTED

K2 and K2.2 cmake already passed:

```
-DGGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16
-DGGML_NATIVE=OFF
```

Evidence:

- `results/gdn_gpu_k2/BUILD_MANIFEST.md` lines 43, 47
- `results/gdn_gpu_k22/BUILD_MANIFEST.md` line 27
- `build-android-opencl-k2/CMakeCache.txt`:
  - `GGML_CPU_ARM_ARCH:STRING=armv8.2-a+dotprod+i8mm+fp16`
  - `GGML_NATIVE:BOOL=OFF`
  - `GGML_CPU_REPACK:BOOL=ON`
- `build-android-opencl-k2/compile_commands.json`: every `ggml-cpu` TU
  (including `arch/arm/quants.c` and `arch/arm/repack.cpp`) compiled with
  `-march=armv8.2-a+dotprod+i8mm+fp16 -O3 -DNDEBUG`
- Configure log `results/gdn_gpu_k2/build_opencl_ndk.log`:
  - `HAVE_DOTPROD - Success`
  - `HAVE_MATMUL_INT8 - Success`
  - `HAVE_FP16_VECTOR_ARITHMETIC - Success`

This is **not** a generic `armv8-a` / no-dotprod NDK default.

## Suspect 2 — GGML CPU repack / Q4_K GEMV path — CONFIRMED (root cause)

`GGML_CPU_REPACK` default is ON and **was compiled in** (`-DGGML_USE_CPU_REPACK`
on every ggml-cpu object). It was not compiled out.

Runtime feature probes in this tree are **compile-time macros**, not HWCAP:

```c
// ggml-cpu.c
int ggml_cpu_has_dotprod(void) {
#if defined(__ARM_ARCH) && defined(__ARM_FEATURE_DOTPROD)
    return 1;
#else
    return 0;
#endif
}
int ggml_cpu_has_matmul_int8(void) {
#if defined(__ARM_ARCH) && defined(__ARM_FEATURE_MATMUL_INT8)
    return 1;
#else
    return 0;
#endif
}
```

Because K2 used `+i8mm`, both return 1. Then `repack.cpp`
`ggml_repack_get_optimal_repack_type()` selects **Q4_K → q4_K_8x8_q8_K**
(i8mm 8×8 interleave) for every Q4_K weight with `ne[1] % 8 == 0`:

```
} else if (cur->type == GGML_TYPE_Q4_K) {
    if (ggml_cpu_has_neon() && ggml_cpu_has_matmul_int8()) {
        if (cur->ne[1] % 8 == 0) {
            return &q4_K_8x8_q8_K;   // K2/k22 path
        }
    }
    if (ggml_cpu_has_neon() && ggml_cpu_has_dotprod()) {
        if (cur->ne[1] % 8 == 0) {
            return &q4_K_8x4_q8_K;
        }
    }
}
```

That layout is a GEMM win and a GEMV loss:

- Prompt (large M, nrc=2 i8mm kernel): **faster** than build-safe (82 vs 44 pp)
- Token gen (M=1 GEMV through 8×8 interleaved blocks): **1.46× slower** (12.37 vs 18.10)

The classic ARM Q4_K GEMV (`ggml_vec_dot_q4_K_q8_K` NEON+`vdot` in
`arch/arm/quants.c`, `#elif defined __ARM_NEON`) is what build-safe used.
K2 never takes it for those tensors because the extra-buffer repack steals them.

`GGML_CPU_AARCH64` is not a cmake option in this tree (dropped / renamed).
KleidiAI (`GGML_CPU_KLEIDIAI`) is OFF and only handles Q4_0/Q8_0, not Q4_K —
not this gap.

## Suspect 3 — where `build-safe` came from

On-device Termux, **not** NDK.

- Script: `scripts/build_llama_termux.sh`
- Pin: tag `b10244` / commit `67d5978bb1ba490070ddbd2a7c59c7ec5a60b7cc`
- Flags: `GGML_NATIVE=OFF`, `GGML_OPENCL=OFF`,
  `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16` (default; jelly notes
  used `armv8.2-a+dotprod+fp16` without i8mm)
- Does **not** pass `GGML_OPENMP=OFF` → OpenMP stays at cmake default ON
- Shared `libggml-cpu.so`, backends field in the 18.10 JSON is `"CPU"`

That tree is ~a year older than fork HEAD `a92a51627` (build 9969).
Q4_K ARM 8×8/8×4 extra-buffer interleave is in the fork; b10244 either
lacked it or did not take it for this model. Matching 18.1 means restoring
the **classic Q4_K vec_dot**, not inventing a new ISA.

OpenCL linkage is not required to explain the gap: PP got *faster*, which
is the opposite of a constant OpenCL tax. `backends: "OpenCL"` in the k22
JSON is just "OpenCL was compiled in"; `-ngl 0` still runs the CPU graph.

`GGML_OPENMP=OFF` on the NDK line is a secondary difference vs Termux.
Left unchanged in the first corrected build so the REPACK flip is isolated.

## Corrected build (flags only, no source edits)

Out-of-tree: `build-android-opencl-cpufix/`
Same source: `kalsa/opencl-q6k-dispatch-fix` @ `a92a51627`

Deltas vs K2.2:

| flag | K2.2 | cpufix |
|---|---|---|
| `GGML_CPU_REPACK` | ON (default) | **OFF** |
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+i8mm+fp16` | `armv8.2-a+dotprod+fp16` |
| `CMAKE_C_FLAGS` / `CMAKE_CXX_FLAGS` | empty | `-march=armv8.2-a+dotprod+fp16` |
| `GGML_OPENCL` | ON | ON |
| `GGML_OPENMP` | OFF | OFF |
| `GGML_NATIVE` | OFF | OFF |

Dropping `+i8mm` is belt-and-suspenders: even if REPACK were left ON, the
selector would fall through to `q4_K_8x4` (dotprod) instead of `q4_K_8x8`.
With REPACK=OFF the extra buffer is not registered at all.

On-device dest: `~/gdn_k2/bin_cpufix/`

## Second cause — unstripped NDK `-g` (CONFIRMED, additive)

NDK Release compile lines still carry `-g` (see `compile_commands.json`:
`-g -DANDROID ... -O3 -DNDEBUG`). Unstripped `llama-bench` is **125 370 360 B**.
`llvm-strip --strip-unneeded` yields **6 234 288 B**.

Same flags, same phone, unplugged:

| image | tg256 |
|---|---:|
| unstripped REPACK=OFF | 15.28 (14.58 / 15.98) |
| stripped REPACK=OFF | **18.19** (18.62 / 17.76) |

The remaining ~3 tok/s was I-cache / page-fault tax from 125 MB of DWARF, not
ISA. Termux `build-safe` ships small shared objects, so it never paid this tax.

## Combined result

12.37 → 15.28 (REPACK OFF, classic Q4_K `vdot` GEMV) → **18.19** (strip).
Gate ≥16.3: **PASS** (0.5% above the 18.10 campaign number).
