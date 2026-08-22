# Consumer-side oracle (q4_0) — implementation report

Date: 2026-08-19. PC-only. No adb, no device, no push.

Engine: `BigMoeOnEdge/third_party/llama.cpp` on `kalsa/kernel-s3-repack`.
Local commits on `kalsa/kernel-s3-repack` (not pushed):
- `538341999` first landing of the oracle
- `d8b6528e8` chunks the compare so a 2880×2880×32 weight does not OOM
- `a97f7bd0c` audit fixes F1–F8 (tol, env, hostrepack, bin path, skips)
- `95046b85c` rename wrapper identifier `local` → `n_loc` (OpenCL C reserved)
- `bcdbc9ed6` GEMV_AUDIT dst-readback hook (review B6)

Oracle lives in a new Android build dir `build-android-opencl-s3oracle/` (did not touch `build-android-opencl-s3printf` or `build-android-opencl-s3base`).
Current pushable `libggml-opencl.so` (after `n_loc` rename) is recorded in the fix section below (`085b127f…`). Older hashes in the audit-fix table are historical.

## What it is

A debug path gated by `GGML_OPENCL_ORACLE=1` (inert if unset). After a q4_0 MoE SoA buffer is ready, it asks: **do the compiled GEMV/GEMM dequant idioms, running on the GPU, produce the right floats from that buffer?** Dispatch, subgroup reductions, and the router are not in the path.

It does **not** claim to have measured the Adreno defect. The binary is built; it has not been run on the S23.

## What was implemented (file:line)

### Kernels (LF only)

- `ggml/src/ggml-opencl/kernels/oracle_consumer_q4_0_gemv.cl` (134 lines, 0 CR)
  - `oracle_q4_0_gemv_buffer` — GEMV-style `__global uint *` load of 4 SoA words, then `q4_0_to_fp32_packed8`
  - `oracle_q4_0_gemv_image` — same addressing via `read_imageui` on `image1d_buffer_t`
  - raw q words dumped to a second buffer; the half scale the kernel actually read dumped as `ushort` to a third; dequantized f32 to the first
- `ggml/src/ggml-opencl/kernels/oracle_consumer_q4_0_gemm.cl` (136 lines, 0 CR)
  - `oracle_q4_0_gemm_buffer` / `oracle_q4_0_gemm_image`
  - dequant is the `dequantize_q4_0` macro (half-precision, including `* scale`)
  - two `uint2` sub-blocks = 32 values, matching GEMM's two `read_imageui` pairs

CMake embed list: `ggml/src/ggml-opencl/CMakeLists.txt:118-119`.

Consumer kernels were **not** edited. The helpers currently in tree (HEAD `9dc1ec0cb`) are already **shift-then-mask**. This oracle tests those idioms as they stand. PLAN.md's "then rewrite the macro" is a later experiment, not this one.

### Host

`ggml/src/ggml-opencl/ggml-opencl.cpp`:

| Piece | Lines |
|---|---|
| `#include "../ggml-quants.h"` (to call `dequantize_row_q4_0`) | 15 |
| `kernel_oracle_q4_0_*` + `moe_compile_opts` on the backend ctx | 822-830 |
| `ggml_opencl_oracle_enabled()` — value parse, not presence | 1195 |
| Default MoE opts; `GGML_OPENCL_MOE_OPTS` override; store on ctx | ~3655-3668 |
| Oracle program compile (only if env truthy at backend init) + `ORACLE_PATHINFO` | 3831-3873 |
| `ggml_opencl_oracle_q4_0` — chunked enqueue, blocking readback, compare, log | 7474-7806 |
| Hook after `extra->q_img`; `CL_CHECK` only if oracle enabled (F6) | ~8088-8102 |
| Skip log for 3-D q4_0 that fail the name gate (F5) | 8105-8111 |

Compile is **fail-fast**: `build_program_from_source` is fatal, so a wrapper that does not compile on Adreno will abort at backend init with the driver log, not silently skip.

Hook is **after** both producer (GPU convert or `HOST_REPACK`) and `q_img` creation, same place `DUMP_Q` has already checksummed `extra->q`. `clCreateImage` failure is **not** fatal on the normal path (F6 restored). When the oracle is enabled, `CL_CHECK(err)` still fires because the image read path needs `q_img`.

## How verbatim-ness is guaranteed

Not by retyping the dequant.

At program build (`ggml-opencl.cpp:3810-3829`):

```
oracle_gemv_src = gemv_moe_q4_0_f32_ns.cl[.h]  +  oracle_consumer_q4_0_gemv.cl[.h]
oracle_gemm_src = gemm_moe_q4_0_f32_ns.cl[.h]  +  oracle_consumer_q4_0_gemm.cl[.h]
```

The same `#include "gemv_moe_q4_0_f32_ns.cl.h"` / `gemm_moe_q4_0_f32_ns.cl.h` strings used to build the real consumer programs are concatenated with the wrappers. Wrappers **call** `q4_0_to_fp32_packed8` / `dequantize_q4_0`; they do not contain a second copy.

Two programs, not one, because GEMV has the function and GEMM has the macro.

Residual compiled-code caveat (not a source-text caveat): the oracle program also contains the unused original `kernel_gemv_moe_*` / `kernel_gemm_moe_*` (qcom attributes and all). OpenCL compilers usually compile kernels independently; if Adreno does whole-program opt across kernels in one program, the inlined helper in the oracle kernel could differ from the inlined helper in the real consumer program. Cannot close that from the PC. If that worry survives a first device run, split the helper into a `.cl` fragment shared by both programs.

Addressing in the wrappers is GEMV's (`expert_offset * 4 + ib00 * ne01 * 4 + i01`, then `+ ne01, + 2*ne01, + 3*ne01`). GEMM's image loads use the same SoA layout (`q_sub_offset + sub_block_id_m` and `+ ne01`). Output floats are stored in AoS block order (`sblk = i00 + i01*nb + i02*nb*ne01`) so they line up with `dequantize_row_q4_0`.

## Compile options for the oracle program

Same string as the real MoE gemv/gemm programs, `CL_moe_compile_opts` (`3655-3668`, passed at `3834-3843`):

```
-cl-std=CL{major}.{minor} -cl-mad-enable  -cl-fast-relaxed-math
```

`{major}.{minor}` is the device OpenCL C version (`opencl_c_std`), typically `CL3.0` with `GGML_OPENCL_TARGET_VERSION=300`. Logged at compile time:

```
ggml_opencl: ORACLE compiling consumer idioms with opts: '...'
```

`GGML_OPENCL_MOE_OPTS` replaces the opt tail the same way it does for the real consumers (`-cl-std=` is kept). There is no extra `-D` for the oracle.

These are **not** the general-kernel opts (`-cl-unsafe-math-optimizations -cl-finite-math-only` on top). Intentionally: the consumers never used those.

## Comparison (same run)

For each of the four `(idiom, read)` kernels:

1. Fill outputs with NaN / `0xDEADBEEF` / `0xFFFF` (scale) so a missed store is visible.
2. Enqueue, then **blocking** `clEnqueueReadBuffer` (the queue is created in-order, props=0). There is **no** `clFinish`.
3. **Floats** vs `dequantize_row_q4_0` on the original AoS tensor (`data`). A lane is a mismatch if recovered nibble `lround(y/d + 8)` differs (skipped on non-finite; F8), or `!isfinite`, or `|got-want| > 0.00390625·|d|`.
   Derivation (also in the source comment): GEMM stores `(half)(nibble-8)*(half)d`. Max `|nibble-8|=8` so `|y|≤8|d|`. For `8|d|` in `[2^e, 2^{e+1})`, fp16 ulp is `2^{e-10}`; half-ulp of the product is `2^{e-11}`. Since `|d| ≥ 2^e/8`, `2^{e-11}/|d| ≤ 2^{-8} = 0.00390625`. So `0.00390625·|d|` is 0.5 ulp of any fp16 product at `|y|≤8|d|`. The previous `0.25·|d|` band was ~64× this bound and admitted ≤3% multiplicative scale error on every nibble. The `1e-3` absolute floor is gone (it dominated small `|d|`). GEMV is f32 and should be tighter; same bound is still conservative.
4. **Raw q words** vs the DUMP_Q / HOST_REPACK contract. Distinguishes image-coherence (raw differs) from compiled dequant (raw matches, floats don't).
5. **Raw d (scale) bytes**: the `half` the kernel actually read from `src0_d`, compared to the 2-byte `d` of the AoS `block_q4_0`. Independent channel for scale corruption / FTZ (F2).

`dequantize_row_q4_0` is **called**, not reimplemented (`ggml-quants.c`, via `ggml-quants.h`).

Pattern on first float miss: `got_or_f0` if `q_got == (q_want | 0xF0)`, else `src_ge_0x80` if that source byte is `>= 0x80`, else `nibble_diff`. Raw-only miss: `raw_diff`.

Log lines (machine-parseable):

```
ORACLE_PATHINFO{gemm_bin_loaded=0|1}   # once at backend init when ORACLE is on
ORACLE_WARNING: GGML_OPENCL_HOST_REPACK is unset; ... does NOT isolate the consumer.
ORACLE{tensor=KxNxE, idiom=gemm|gemv, read=buffer|image, hostrepack=0|1, n=..., float_mismatch=K/N, raw_mismatch=K/N, raw_d_mismatch=K/N, first_bad_idx=..., want=..., got=..., pattern=...}
ORACLE_DETAIL{... hostrepack= ...}
ORACLE{tensor=NAME ne=KxNxE, skipped=name_gate}   # 3-D q4_0 that missed the "ffn"+"exps"|"as" heuristic
ORACLE_SUMMARY{..., hostrepack=0|1, gemm_bin_loaded=0|1, all_ok=0|1}
```

`ORACLE_SUMMARY` is cumulative (static counters), printed after every tensor. The last one in the log is the run total.

## Binaries (identify by sha, not by path)

Build: `build-android-opencl-s3oracle/`, Ninja + NDK 27.1.12297006, `ANDROID_ABI=arm64-v8a`, `ANDROID_PLATFORM=android-29`, `ANDROID_STL=c++_shared`, `CMAKE_BUILD_TYPE=Release`, `GGML_OPENCL=ON`, `GGML_OPENCL_EMBED_KERNELS=ON`, `GGML_OPENCL_USE_ADRENO_KERNELS=ON`, `GGML_NATIVE=OFF`, `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+i8mm+fp16`, `LLAMA_BUILD_TESTS=ON`, OpenCL headers/ICD from `deps/opencl-android/`. Same knobs as `build-android-opencl-s3printf` CMakeCache.

**The oracle is in `libggml-opencl.so`.** `test-backend-ops` is a dynamically linked stub; its sha did not change across the last rebuilds of the `.so`. Do not cite the exe sha as proof of which oracle ran.

| file | sha256 | size | mtime (local) |
|---|---|---:|---|
| `bin/libggml-opencl.so` | `3f3df26af2375d3bf88fbb1b718bd2ceb26004e0fd56b9d83c40433007530bac` | 7685072 | 2026-08-19 11:13:04 |
| `bin/test-backend-ops` | `81bfb4d93dcbbab66c6ead93e54ef17d29032ca54df2c032a367be826afacc33` | 10165800 | 2026-08-19 11:13:05 |
| `bin/libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | 536880 | 2026-08-19 11:13:04 |
| `bin/libggml-base.so` | `ca1f1e3f75e2ab0e77f1df21ee98dafdeea7d9ccefcb4593c8b5f4a41cfc5c76` | 6103512 | 2026-08-19 11:09:49 |
| `bin/libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | 5165056 | 2026-08-19 11:09:49 |
| `bin/libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 | 2026-08-19 11:13:04 |
| `bin/libllama-common.so` | `9d5ec0a076cbe8f183bd7f42784750a3b951ad397f6fcbbb5b807769da9758f6` | 78377240 | 2026-08-19 11:13:04 |

NEEDED on the exe: the six `libggml*`/`libllama*` above, plus `libc++_shared.so`, `libm.so`, `libdl.so`, `libc.so`.
NEEDED on `libggml-opencl.so`: `libggml-base.so`, `libOpenCL.so` (device vendor), `libc++_shared.so`, …
NEEDED on `libggml-cpu.so`: **`libomp.so`** as well.

NDK copies (not in the build dir; push them next to the binary):

| file | sha256 | size |
|---|---|---:|
| NDK `libc++_shared.so` | `e69496a4aeb51ebe61d0775ae9fefc76eee640f12317aa5174da67e5d4ec8fd6` | 1794776 |
| NDK `libomp.so` | `ea27efff687f8359fabc728af9a4ea45766714399792344af94b09037d52d0b0` | 1229304 |

`build-android-opencl-s3printf/bin/test-backend-ops` and `s3base` still exist; not overwritten.

Host compile of `ggml-opencl.cpp` produced only pre-existing warnings (`use_adreno_bin_kernels` unused param; a `#pragma message` TODO). No new warnings.

## Exact adb sequence (DO NOT RUN from this session; S23 is in use)

On a free S23, from the repo root on the PC. Recompute sha on device; do not trust the push.

```powershell
$DEV = "/data/local/tmp/s3oracle"
$BIN = "build-android-opencl-s3oracle/bin"
$NDK = "$env:LOCALAPPDATA/Android/Sdk/ndk/27.1.12297006"
adb shell "mkdir -p $DEV"
adb push "$BIN/test-backend-ops" $DEV/
adb push "$BIN/libggml-opencl.so" $DEV/
adb push "$BIN/libggml.so" $DEV/
adb push "$BIN/libggml-base.so" $DEV/
adb push "$BIN/libggml-cpu.so" $DEV/
adb push "$BIN/libllama.so" $DEV/
adb push "$BIN/libllama-common.so" $DEV/
adb push "$NDK/toolchains/llvm/prebuilt/windows-x86_64/sysroot/usr/lib/aarch64-linux-android/libc++_shared.so" $DEV/
adb push "$NDK/toolchains/llvm/prebuilt/windows-x86_64/lib/clang/18/lib/linux/aarch64/libomp.so" $DEV/
```

Verify on device **before** running (must match the table above):

```sh
adb shell "cd /data/local/tmp/s3oracle && sha256sum test-backend-ops libggml-opencl.so libggml.so libggml-base.so libggml-cpu.so libllama.so libllama-common.so libc++_shared.so libomp.so"
```

Expected `libggml-opencl.so` (current, `n_loc` binary) = `085b127f9233d721aa5756e94429195e9b276dc8b9ee86d7d851cf1c52a29be4`.

Run (host-repack so the buffer is byte-exact; oracle on; q4_0 MUL_MAT_ID only):

```sh
adb shell "cd /data/local/tmp/s3oracle && chmod +x test-backend-ops && \
  export LD_LIBRARY_PATH=/data/local/tmp/s3oracle && \
  export GGML_OPENCL_HOST_REPACK=1 && \
  export GGML_OPENCL_ORACLE=1 && \
  ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0'"
```

Optional, same process: `GGML_OPENCL_DUMP_Q=1` to also print the producer checksum. Optional: `GGML_OPENCL_MOE_OPTS='...'` to rebuild consumers **and** the oracle with the same override.

Grep the log for `^ORACLE` / `^ORACLE_SUMMARY` / `^ORACLE_PATHINFO` / `^ORACLE_WARNING`. `all_ok=1` with `hostrepack=1` and `gemm_bin_loaded=0` means every compiled idiom, on both read paths, matched `dequantize_row_q4_0` and the host-repack q **and d** bytes on every q4_0 MoE tensor that took the Adreno SoA path. That would say the **driver-compiled source** GEMV/GEMM dequant idioms are correct on a known-good buffer. It does **not** speak for the offline `_ila` GEMM binary (see below). End-to-end MUL_MAT_ID can still fail (reduction / dst / router) — that is a different question. `GGML_OPENCL_ORACLE=0` / `false` / `""` now leave the probe **off**.

`libOpenCL.so` is the device ICD; do not push the Windows-built `deps/opencl-android/icd-build-android/libOpenCL.so`.

## Chunking (reviewer: memory bomb)

A hostile review of the first landing caught a real abort: `test_mul_mat_id(Q4_0, m=2880, n=32, k=2880, n_mats=32)` is `nelements = 265e6` floats. Allocating `want_f + got_f + fill_f` plus two full-tensor `cl_mem` is ~3.6 GB host + ~1.2 GB device; `CL_CHECK` on `clCreateBuffer` would kill the suite.

The compare now walks **65536-block chunks** (~8 MiB f32 + 1 MiB raw). Kernels take `block_begin`; `sblk = block_begin + gid` is the AoS block index that matches `dequantize_row_q4_0`. Alloc failure logs `skipped=clCreateBuffer_*` and returns; it does not `GGML_ASSERT`. Blocking reads, no `clFinish` on the backend queue. `clEnqueueFillBuffer` for the NaN/`DEADBEEF` sentinel (host write fallback).

This is same-source/same-opts, **not** same compiled program as the real consumer (extra kernels at the end of a concatenated program; helper inlined at a different call site). Logged as such in the verbatim section. Do not sell a green oracle as "the GEMM ISA is proven."

## Blind spot: offline `_ila` GEMM bin kernel (audit F1)

**A green oracle exonerates only the source-compiled GEMM. If the failing configuration uses the bin kernel, the oracle says nothing about it. GEMV has no bin variant and transfers fully.**

Production dispatch prefers `kernel_gemm_moe_q4_0_f32_ns_bin` whenever `libadreno-opencl-kernels.so` loads (`ggml-opencl.cpp` ~20037, created at ~3789-3797 from `gemm_moe_q4_0_f32_ns_ila`). The oracle never probes that blob — it concatenates and driver-compiles the `.cl` source. We do **not** try to oracle the blob.

Mitigation in this build:
- When ORACLE is on, backend init logs `ORACLE_PATHINFO{gemm_bin_loaded=0|1}`.
- `ORACLE_SUMMARY` repeats `gemm_bin_loaded=`.

The prescribed `adb push` list does **not** include `libadreno-opencl-kernels.so`, so the test-backend-ops run should see `gemm_bin_loaded=0` and the source GEMM is what actually runs — oracle GEMM verdict matches that run. The production S23 app ships the blob; a green oracle there would **not** clear the `_ila` GEMM.

## Deviations / risks / untested

- **Not run on Adreno.** Device OpenCL compile of the concatenated programs is untested.
- **PC OpenCL smoke not done.**
- **q4_1 / mxfp4 not added.**
- **Env must be truthy at backend init.** `GGML_OPENCL_ORACLE=0` / `false` / `""` now leave the probe off (F4). If set after `load_cl_kernels`, the hook logs `skipped=kernels_or_buf_null`.
- **Sibling hooks still presence-only.** `GGML_OPENCL_HOST_REPACK` and `GGML_OPENCL_DUMP_Q` treat any set value (including `"0"`) as on. Not changed; the oracle's `hostrepack=` stamp uses the same presence test as the producer so it matches what actually ran.
- **Oracle program ≠ real consumer program.** Same helper source + same opts, extra kernels at the end. A green oracle is not a proof of the consumer ISA, and says **nothing** about `_ila` GEMM (F1).
- **GEMM floats are half.** Bound is now `0.00390625·|d|` (0.5 fp16 ulp at `|y|≤8|d|`); `pattern=mag_only` if only the magnitude test fires. Scale bytes have their own `raw_d_mismatch`.
- **Existing consumer `.cl` files are CRLF in this Windows working tree** (`core.autocrlf=true`). New oracle `.cl` blobs in git are LF (0 CR).
- **Audit follow-up (this commit):** F2 tight tol + scale dump; F6 `CL_CHECK(clCreateImage)` only when oracle on; F4 value parse; F3 `hostrepack=` + WARNING; F1 `ORACLE_PATHINFO`; F5 `skipped=name_gate` once per name for 3-D q4_0; F7 reference built once per chunk; F8 `lround` guarded; `moe_compile_opts` actually used. Pre-existing convert `lws[1]=2` requiring even `nb` is **not** fixed.

## How to read a first device result

| raw_mismatch | float_mismatch | meaning |
|---|---|---|
| 0 (and raw_d 0) | 0 | compiled dequant + both read paths match the host reference, scales included |
| >0 on image only | follows raw | image alias of `extra->q` is not coherent with the buffer (the open paradox) |
| 0 | >0, `pattern=got_or_f0` / `src_ge_0x80` | compiled dequant defect, shift/sign-smear class |
| 0 | >0, `pattern=nibble_diff` | compiled dequant defect, other |
| 0 | >0, `pattern=mag_only` | recovered nibble matches, magnitude does not (fp16/Inf/NaN) |
| >0 on buffer and image, same words | — | addressing / layout bug in the oracle (ours) or the buffer is not the contract |
| raw_d_mismatch > 0 | 0 or >0 | scale half the kernel read ≠ AoS `block_q4_0.d` (convert/FTZ/coherence on `extra->d`) |

Do not "adjust" `dequantize_row_q4_0` if the oracle disagrees with it.

## DEVICE RUN (S23 / Adreno 740, 2026-08-19) — findings only, no fixes

Device: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (`SM_S911U` / `dm1q`). Launched from `adb shell`, `/proc/self/cpuset` = `/`. `/data` had 27G free (75% used). Pushed only the documented list under `/data/local/tmp/s3oracle` (no `_ila` blob, no `libadreno-opencl-kernels.so`). Directory removed after the two runs; `s3base` / `s3fix` / `s3printf` left in place.

On-device sha256 matched PC for every pushed file. **`libggml-opencl.so` = `3f3df26af2375d3bf88fbb1b718bd2ceb26004e0fd56b9d83c40433007530bac`.** Env printed as `HOST_REPACK=[1] ORACLE=[1]` (no trailing space). Compile opts logged: `'-cl-std=CL3.0 -cl-mad-enable  -cl-fast-relaxed-math'`. Driver: OpenCL 3.0 QUALCOMM build 0676.73, compiler E031.41.03.62.

Logs: `results/oracle_consumer_s23/run1/run1.log` and `run2/run2.log` (4116 bytes each, **byte-identical**). A first wrapper attempt used toybox `taskset -a 0xff` and died before the binary (`run1.taskset-fail.log`); that is not a kernel result. Both counted runs used `taskset ff` + cpuset `/`.

### Validity checks

| check | result |
|---|---|
| `ORACLE_PATHINFO{gemm_bin_loaded=0}` | **NOT PRINTED.** Compile of the oracle GEMV program is fatal (`build_program_from_source` → `exit(1)`) and happens *before* that log line. Blob was not pushed, so loaded=0 is the expected counterfactual, but it is not in the log. |
| `hostrepack=1` on ORACLE lines | **No ORACLE lines.** Env was `[1]`; the probe never reached a tensor. |
| no `ORACLE_WARNING` about host-repack | **None** (probe never entered `ggml_opencl_oracle_q4_0`). |
| no `skipped=` for tensors under test | **None.** |
| end-to-end q4_0 MUL_MAT_ID still FAIL ~0.45 | **Tests never ran.** Backend init aborted at oracle program compile. No ERR numbers this session. |

### Per (idiom × read) totals — both runs

None. Zero tensors probed.

| idiom | read | float_mismatch | raw_mismatch | raw_d_mismatch |
|---|---|---|---|---|
| gemv | buffer | n/a | n/a | n/a |
| gemv | image | n/a | n/a | n/a |
| gemm | buffer | n/a | n/a | n/a |
| gemm | image | n/a | n/a | n/a |

`ORACLE_SUMMARY` lines: **none.**

Pattern classification: **none.**

### What the log actually contains (verbatim, both runs)

```
ggml_opencl: ORACLE compiling consumer idioms with opts: '-cl-std=CL3.0 -cl-mad-enable  -cl-fast-relaxed-math'
ggml_opencl: kernel compile error (err=-11):

BC-src-code:139:15: error: parameter name omitted
    uint local,
              ^
```

Qualcomm compiler treats `local` as an OpenCL address-space qualifier / reserved word. The GEMV wrapper uses `uint local` for `get_global_id(0)`. 20 diagnostics, then process exit. GEMM wrapper was never compiled (GEMV program is built first).

run1 and run2 **agree**: same 4116-byte log, same `err=-11`, same first error at `uint local`.

### Verdict

**ORACLE DID NOT RUN — COMPILE FAIL.** Not GREEN. Not a consumer-idiom RED (the dequant idioms were never executed). The probe is inert-by-crash on this driver when `GGML_OPENCL_ORACLE=1`.

End-to-end ERR for this session: **not measured.** The known host-repack q4_0 MUL_MAT_ID ~0.45 figure is *not* reproduced here because `test-backend-ops` never reached the cases.

Pushed files deleted from the device. No kernel edits this turn.

## Fix: reserved identifier `local` (commit `95046b85c`)

Scan of both wrapper `.cl` files against OpenCL C 3.0 reserved words (`global`, `local`, `constant`, `private`, `kernel`, `restrict`, `uniform`, `pipe`, `read_only`/`write_only`/`read_write`, `sampler_t` / image types, `half`/`double`, C keywords, etc.).

**Only identifier collision:** `local` (used as the work-item index). Qualifiers (`__global`, `__kernel`, `__read_only`) and types (`half`, `image1d_buffer_t`, `(float)` casts) are legal uses of reserved tokens, not identifier names.

Exact rename in **wrapper text only** (consumer `.cl` halves untouched):

| file | identifier | new name | count |
|---|---|---|---:|
| `oracle_consumer_q4_0_gemv.cl` | `local` | `n_loc` | 15 |
| `oracle_consumer_q4_0_gemm.cl` | `local` | `n_loc` | 16 |

Comment English ("gid is local to a host chunk") left as-is.

### New binary

`build-android-opencl-s3oracle/bin/libggml-opencl.so`  
sha256 `085b127f9233d721aa5756e94429195e9b276dc8b9ee86d7d851cf1c52a29be4`  
size 7685072, mtime 2026-08-19 12:10:26  
(`n_loc` is the same length as `local`, so size is unchanged; hash is not.)

### PC clBuildProgram smoke

PC OpenCL **exists**: NVIDIA CUDA + Intel(R) OpenCL Graphics (`results/oracle_consumer_s23/pc_clbuild_smoke.py`). Concatenated programs, opts `-cl-std=CL3.0 -cl-mad-enable  -cl-fast-relaxed-math`.

| platform | gemv+wrap | gemm+wrap |
|---|---|---|
| Intel OpenCL Graphics | **CL_SUCCESS** | FAIL — consumer kernel uses qcom `float32` |
| NVIDIA CUDA | FAIL — `as_ushort(half)` overload ambiguous | FAIL — same qcom `float32` |

The reserved-word gate is covered: Intel compiled the GEMV oracle program (the one that died on-device with `uint local`). Full concatenated GEMM cannot succeed on this PC because the **consumer** half requires `cl_qcom_extra_vector_types`. **The GEMM wrapper's compile gate remains the device.**

## DEVICE RUN (S23, after `n_loc` fix) — run3 / run4

Device, cpuset `/`, no `_ila` blob, sha on-device matched PC including `libggml-opencl.so` = `085b127f…`. Env `HOST_REPACK=[1] ORACLE=[1]`. Logs: `results/oracle_consumer_s23/run3/run3.log`, `run4/run4.log` (90273 bytes each). Pushed dir removed afterwards; `s3base`/`s3fix`/`s3printf` untouched. run1/run2 left in place as the compile-fail record.

### Validity gates

| check | run3 | run4 |
|---|---|---|
| `ORACLE_PATHINFO{gemm_bin_loaded=0}` | yes | yes |
| `hostrepack=1` on ORACLE lines | yes (296/296) | yes (296/296) |
| `ORACLE_WARNING` about host-repack | none | none |
| `skipped=` for tensors under test | none | none |
| e2e q4_0 MUL_MAT_ID FAIL ~0.45 | 74/74 FAIL, mean ERR **0.4561** (min 0.397, max 0.804) | 74/74 FAIL, mean ERR **0.4499** (min 0.372, max 0.601) |

ERR means differ (test data regenerated every run); both sit on the known host-repack cluster ~0.45. Tests did **not** suddenly pass.

### Per (idiom × read) totals — both runs identical

74 tensors × 4 lines = 296. Every line `pattern=ok`.

| idiom | read | float_mismatch | raw_mismatch | raw_d_mismatch |
|---|---|---|---|---|
| gemv | buffer | 0 / 322068480 | 0 | 0 |
| gemv | image | 0 / 322068480 | 0 | 0 |
| gemm | buffer | 0 / 322068480 | 0 | 0 |
| gemm | image | 0 / 322068480 | 0 | 0 |

(`float_mismatch` denominator is the sum of `n` across 74 tensors, including the 2880×2880×32 weight at 265420800 floats with 0 mismatches on all four paths.)

### `ORACLE_SUMMARY` last line, verbatim, both runs

```
ORACLE_SUMMARY{tensors=74, lines_bad=0/296, float_mismatch_total=0, raw_mismatch_total=0, raw_d_mismatch_total=0, hostrepack=1, gemm_bin_loaded=0, all_ok=1}
```

run3 and run4 **agree** on the oracle verdict (`all_ok=1`, zero mismatches, same summary string).

Pattern classification: **no mismatches** — no `got_or_f0`, no `src_ge_0x80`, no `nibble_diff`, no `raw_diff`, no `raw_d_diff`.

### Verdict

**ORACLE GREEN** on all four paths: `gemv×buffer`, `gemv×image`, `gemm×buffer`, `gemm×image`.

This is the driver-compiled **source** GEMV/GEMM dequant on a host-repacked buffer. `gemm_bin_loaded=0` (blob not pushed). End-to-end MUL_MAT_ID remains FAIL (mean ERR ~0.45). The compiled consumer dequant idioms, on both read paths, produce the host reference floats and raw q/d bytes.

The next-step decision (consumer rewrite vs GEMV n=1 isolation vs something else) is not made here.

---

## STEP 3 — in-situ GEMV n=1 audit (`GGML_OPENCL_GEMV_AUDIT`)

Date: 2026-08-19. PC-only: implement + Android rebuild + this note. **No device. No push.** Re-review of the classifier diff is the next human step, not a device go.

Engine commits (stacked on `95046b85c`, not pushed):

- `2bdef5c7d` `opencl: add GGML_OPENCL_GEMV_AUDIT in-situ n=1 q4_0 production GEMV probe`
- `6c822d826` `opencl: GEMV_AUDIT classifier + stash fixes (review 2bdef5c7d F1,F3,F5,F6)`
- `d77e82347` `opencl: GEMV_AUDIT LANE_MOD period + SIGN_SMEAR reachability (re-review 6c822d826)`
- `b0684a2b6` `opencl: GEMV_AUDIT glue audit — semantic MUL_MAT_ID vs args-consistent dst`

Same build dir as the oracle: `build-android-opencl-s3oracle/` (did not touch `s3printf` / `s3base` / `s3fix`). **No new `.cl` files**, so the Intel `clBuildProgram` smoke and the reserved-word sweep do not apply. The compile-fail lesson (`local`) is why this step adds host-side observation only.

### Env semantics (plain)

`GGML_OPENCL_GEMV_AUDIT` uses the **same** value-parse helper as `GGML_OPENCL_ORACLE` (`ggml_opencl_env_value_enabled`, 1196–1214). It is **not** a presence check and it is **not** “only the string `1`”:

| value | armed? |
|---|---|
| unset, `""` | off |
| `"0"` | off |
| `"false"` / `"FALSE"` / `"False"` | off |
| `"1"` | **on** |
| any other non-empty string (`"2"`, `"yes"`, `"off"`, `"0 "` with trailing space, …) | **on** |

That is inherited from ORACLE (audit F4 of 2bdef5c7d) and left AS-IS. `HOST_REPACK` / `DUMP_Q` remain presence-only. Optional ints: `GGML_OPENCL_GEMV_AUDIT_MAX_DETAIL` (default 4), `GGML_OPENCL_GEMV_AUDIT_DUMP` (default 12), `GGML_OPENCL_GEMV_AUDIT_STASH_MB` (default 512, clamp 0–4096).

### Design as implemented (file:line)

All in `ggml/src/ggml-opencl/ggml-opencl.cpp`. Classifier lines below were `d77e82347`; GLUE AUDIT is HEAD `b0684a2b6`.

| Piece | Lines |
|---|---|
| `ggml_opencl_env_value_enabled` (shared with ORACLE) | 1196–1214 |
| `ggml_opencl_gemv_audit_enabled` | 1220–1222 |
| `MAX_DETAIL` / `_DUMP` / `_STASH_MB` int parse | 1224–1249 |
| AoS stash counter + cap | 1245–1249 |
| `extra_q4_0::{aos_host,aos_accounted,aos_ne*}` + `reset()` swap-empty | 5912–5976 |
| Stash at MoE q4_0 `set_tensor` (shape skip + byte cap) | 8028–8058 |
| Named ratio-candidate table + 8% band | 20073–20100 |
| `ggml_opencl_gemv_audit_q4_0` — clFinish, readback, host ref, classify, log | 20102–~20670 |
| SIGN_SMEAR per-nibble rates + 0.80/0.20 enrichment | 20342–20359, 20478–20490 |
| Ratio clusters on **bad** dst; LANE_MOD largest divisor; ranked `>` labels | 20400–20590 |
| Hook **after** production `enqueue_ndrange_kernel`, **before** subbuffer release | 20820 |

Production path is untouched when the env is off: the hook is a function call that returns before `clFinish`. No kernel object, arg, or NDRange is replaced when it is on either — the production `kernel_gemv_moe_q4_0_f32_ns` runs first, then the host looks at the buffers.

Trigger: `ggml_cl_mul_mat_id` Q4_0 Adreno-MoE branch with `ne12==1` (the GEMV path). GEMM (`ne12!=1`) is not observed.

### Host reference

For each `i20 ∈ [0, ne20)` and `i01 ∈ [0, ne01)`:

- `expert_id = ids[i20]` (the buffer the kernel was given, not a re-read of the host tensor)
- `i11 = i20 % ne11`
- weight row = original AoS q4_0 at expert `expert_id`, row `i01`
- `dequantize_row_q4_0` + `Σ w[t]*act[i11,t]` in **double**
- compare to `dst[i01 + i20*ne01]` (the index the kernel writes)

### Tolerance (k-length f32 dot vs double)

Logged once as `GEMV_AUDIT_BOUND{...}`.

Higham: `|fl(x·y) − x·y| ≤ γ_k Σ|x_i y_i|` with `γ_k = k u / (1 − k u)` and `u = 2^{-24}` (f32 round-to-nearest), provided `k u < 1`. The kernel also does fp16 scale, a float8 reduce per block, and a 4-subgroup local join — extra O(k) rounding. Working test:

```
abs_ok = 8 * γ_k * Σ|w_i x_i| + 32 * u * |want| + 1e-5
```

NaN/Inf always count as bad. At k=256 this is ~10^{-4} relative on well-scaled rows. An e2e mean ERR of ~0.45 is ~1000× this bound and will flag. This is a defect-isolation threshold, not an IEEE proof.

### Pattern classes (the point of the probe)

Labels are **ranked** (`>` = descending investigation priority). `pattern` is the ranked list; the first token is the primary. `ok` / `UNSTRUCTURED` are exclusive.

| rank | class | meaning |
|---|---|---|
| — | `ok` | `n_bad==0` |
| 1 | `ROUTING_OOB` | an id was outside `[0, n_ex)` |
| 2 | `SIGN_SMEAR` | per-nibble enrichment (see below). **Not** “any byte ≥ 0x80 on a bad row” |
| 3 | `REDUCTION_OR_SCALE:<name>(frac=…)` | cluster of **bad** dst `got/want` at a named constant ≠ 1, `frac≥0.30` of bad-with-ratio. Multiple named clusters can appear, highest frac first |
| 4 | `LANE_MOD_N` | period inferred at mod 128: `N = 128 / n_fully_bad_residues` (rate≥0.80, tot≥4). Guards: count=0, `128%count != 0`, any partial residue (0.20<rate<0.80), period<2. Synthetic: 4 fully-bad → 32; 2 → 64; 1 → 128. **Not** largest-divisor-first (that tagged every 32/64 lattice as 128) |
| 5 | `BLOCK_RUNS` | long contiguous runs of bad `i01` |
| 6 | `ROUTING_EXPERT` / `ROUTING_SLOT` | error rate tied to expert id / `i20` slot |
| — | `UNSTRUCTURED` | nothing above fired |

`ratio_clusters=` on the same line lists every named-constant frac ≥ 0.05 among bad dst (including `1`, which is **not** a REDUCTION label). Median `ratio_med` is still logged; it is no longer the firing test.

#### SIGN_SMEAR (review 2bdef5c7d F1 — was vacuous)

The first landing flagged a **row** ge80 if any of its qs bytes was ≥ 0x80. On random q4_0, P(byte≥0x80)=1/2; a k=256 row has 128 qs bytes ⇒ P(row not ge80)=2^−128≈0. Every failing case was labeled SIGN_SMEAR.

Now: each of the k weight values of a dst maps to its **source qs byte** (ggml q4_0: `y[ib*32+j]`, j<16 → `qs[j]` low nibble, j≥16 → `qs[j-16]` high nibble). A nibble “mismatches” if its dst is bad (the kernel only writes the k-dot; there is no per-nibble got). Then

```
rate_ge80 = n_bad_src_ge80 / n_src_ge80
rate_lt80 = n_bad_src_lt80 / n_src_lt80
```

Label SIGN_SMEAR only when **both** classes have ≥ 32 nibbles **and** `rate_ge80 ≥ 0.80` **and** `rate_lt80 ≤ 0.20`. The gate is **not** weakened.

What the 0.80/0.20 split **can** fire on: structured weights whose error-thresholded rows are ≥4× enriched in ge80 nibbles vs lt80 (rows with/without smear-class bytes separable by |error|). That is a real-weight / non-iid layout, not the test-backend-ops random q4_0 vehicle.

What it **cannot** fire on (and therefore **cannot exclude**): the historic DUMP_Q per-byte signature (`got==want|0xF0` iff `byte≥0x80`, 16/16) **through a k-length GEMV dot on iid random data**. A row's error is then a threshold on |Σ act| over the ~k/2 ge80 positions — a ~50% random selection of rows, each still a ~50/50 nibble mix ⇒ `rate_ge80 ≈ rate_lt80 ≈` global bad rate, ~10σ from 0.80/0.20. Absence of the tag on the prescribed random-data run **excludes nothing** about sign-smear in the consumer. Both rates stay on every `GEMV_AUDIT{...}` line so the reader can judge. A one-time `GEMV_AUDIT_NOTE` restates the reachability bound in the log itself.

#### REDUCTION_OR_SCALE (F6) and LANE_MOD (F5)

Median-of-all-ratios misses a mixed map (60% ok + 40% quartered ⇒ med=1.0). Clustering is on `got/want` of **bad** dst with `|want|>1e-4`. Named constants as before (0.25=1/4sg, 0.5, 0.75=3/4sg, 2, 4, 8, 16, 32, 64, 128, 1/32, 1/64, 1/128, 1); 8% relative band. Fire at frac≥0.30 of bad-with-ratio, excluding the 1.0 bin. The 40% quartered case fires; ~10% noise near 0.25 does not.

LANE_MOD counts fully-bad residues (rate≥0.80, tot≥4) at **mod 128** and sets `period = 128 / count`. A period-32 defect has 4 fully-bad residues → `LANE_MOD_32`; period-64 → 2 → `LANE_MOD_64`; period-128 → 1 → `LANE_MOD_128`. Largest-divisor-first is gone: it tagged every 32/64 lattice as `LANE_MOD_128` because those residues stay fully-bad at 128 (rmax=1, rmin=0). No tag if count=0, if 128 is not divisible by count, if any residue is partial (0.20<rate<0.80), or if period<2 (all-bad).

#### What CAN / CANNOT trigger on the random-data vehicle (test-backend-ops iid q4_0)

| label | on iid random q4_0 GEMV |
|---|---|
| `REDUCTION_OR_SCALE:0.25=1/4sg` (etc.) | **can** — if a constant fraction of **bad** dst have got/want in an 8% band of a named constant |
| `LANE_MOD_32/64/128` | **can** — if dst-row errors form a single residue class with period 32/64/128 (inferred from count of fully-bad residues at 128) |
| `BLOCK_RUNS` / `ROUTING_*` | **can** — spatial / id / slot structure in the dst map |
| `UNSTRUCTURED` | **can** — default when nothing above fires |
| `SIGN_SMEAR` | **cannot** — ~10σ unreachable through a k-dot on iid weights; absence excludes nothing. Reachable only on structured (non-iid) weights |

`GEMV_AUDIT_BAD{...}` dumps the first `DUMP` (default 12) bad entries with `(row, expert, want, got, ratio)` for the first `MAX_DETAIL` (default 4) **failing** cases; later cases are one-line summaries.

Geometry actually enqueued is stamped (`geom_g`, `geom_l`) from the same `global_size` / `local_size` arrays passed to `clEnqueueNDRangeKernel`.

### What the audit can and cannot attribute

**Can:** given the glue the dispatch actually passed, does the **compiled production GEMV** write dst values that match ggml's q4_0 reference? If not, which spatial / routing / ratio / sign-smear pattern does the error map have?

**Cannot / logged-not-verified:**

- The glue itself (`ne00`, `ne01`, `ne11`, `offsetd`, `offset1`, `offset2`, dst index `i01+i20*ne01`, `i11=i20%ne11`). Those are the **same locals** `clSetKernelArg` / enqueue used. They are printed on every `GEMV_AUDIT{...}` line (`glue=logged_not_verified`) so a glue bug is visible, but this probe does not independently re-derive them from tensor `nb[]` / `view_offs` to prove them. It tests the kernel against ggml **given that glue**.
- Whether `src1` is packed the way the image descriptor claims. Readback uses the parent buffer at `offset1` with size `ne00*ne11*ne12*sizeof(float)` — the same size as the subbuffer the kernel's `image1d_buffer_t` was built on. Non-packed `nb[]` would be wrong in both the kernel and the audit.
- GEMM (`ne12!=1`), other quants, the offline `_ila` GEMM blob (GEMV has no bin variant).
- Subgroup reduction internals except as inferred from the dst error pattern (e.g. a clustered ratio of 0.25 is *consistent with* dropping 3 of 4 subgroups; it is not a probe of local memory).

Oracle GREEN already says the compiled dequant idioms on a host-repacked buffer match `dequantize_row_q4_0`. This step asks whether the **real consumer program**, reductions and all, does.

SIGN_SMEAR cannot split a k-dot into per-nibble GPU got; the rates are dst-mismatch inherited onto each contributing nibble. That is enough to stop the vacuous row-OR false positive. On the random-data vehicle the label is ~10σ unreachable even for a true remaining smear (see above); absence excludes nothing. Look at `rate_ge80`/`rate_lt80` and the other labels. The log emits `GEMV_AUDIT_NOTE{...absence_on_random_iid_excludes_nothing}` once per process.

### AoS stash (review F3)

At MoE q4_0 `set_tensor`, a copy of original AoS bytes is kept **only** when the audit env is on. `ne12` (GEMV vs GEMM) is a property of src1 and is unknown here, so a GEMM-only weight cannot be skipped by dispatch shape. Skips that **are** knowable:

- `ne00%32 != 0` or non-positive ne or `ne[3] != 1` → `GEMV_AUDIT_STASH{..., skipped=not_gemv_shape}` (this GEMV kernel cannot consume it)
- process-wide byte cap `GGML_OPENCL_GEMV_AUDIT_STASH_MB` (default 512 MiB, 0 = stash nothing) → `skipped=cap`

`reset()` of a pooled extra **swap-with-empty** (not `clear()`), so a 113 MB weight does not pin RSS for the rest of the process. The counter is decremented on reset.

### Prescribed run: 14 cases, not 12 (review F2)

Keep the same filter. It matches **14** q4_0 n=1 MUL_MAT_ID cases, not 12:

| source | shape (n_mats, n_used, b, m, n, k) | AoS stash |
|---|---|---|
| `test-backend-ops.cpp` ~8865–8873 (12) | `{4,8} × {1,2,4} × {0,1} × 512 × 1 × 256` | < 0.6 MB each (max 8×512×256/32×18 = 576 KiB) |
| qwen3-30b-a3b grid `:9742-9746` bs=1 | `128, 8, 0, 768, 1, 2048` | **113.2 MB** |
| qwen3 grid `:9751-9754` bs=1 | `32, 4, 0, 1792, 1, 2048` | **66.1 MB** |

The two extra cases are informative GEMV n=1, not a problem. `-o MUL_MAT_ID` is an exact op-name match (does **not** pull `MUL_MAT_ID_FUSION`). `-p 'type_a=q4_0.*,n=1,k='` matches `,n=1,k=` and does not match `n_used=1` or the 2880×32 GEMM case.

Tests run sequentially; extras are pooled. With swap-empty, **peak stash for the prescribed run is 113.2 MB** (the qwen3-30b weight), plus a few MB of dst/src1/ids readback. The 66.1 MB case is smaller, not simultaneous. The 2880×2880×32 GEMM weight (149.3 MB) is **not** in this filter; an unfiltered suite would try to stash it and succeed under the 512 MB cap (or skip with `skipped=cap` if the cap is lowered).

Log volume: 14 `GEMV_AUDIT{...}` lines + one `GEMV_AUDIT_BOUND` + up to 4×12 `GEMV_AUDIT_BAD` + possible `GEMV_AUDIT_STASH` skip lines. Tens of KB, not a megabyte flood.

### Binaries (sha, not path) — after LANE_MOD period + SIGN_SMEAR note

Rebuilt `build-android-opencl-s3oracle/` (NDK 27.1.12297006, same CMakeCache knobs as the oracle). Host compile of `ggml-opencl.cpp`: same two pre-existing warnings (`use_adreno_bin_kernels` unused param; a `#pragma message` TODO). No new warnings. No new `.cl`.

**The audit is in `libggml-opencl.so`.** `test-backend-ops` sha is unchanged (dynamically linked stub). `libllama-common.so` changes when CMake re-runs `build-info.cpp`; push it anyway.

| file | sha256 | size | mtime (local) |
|---|---|---:|---|
| `bin/libggml-opencl.so` | `acb41c32692cae4cd95176a154b07cc2a7b3af8fc6012a0e1e79808ce8299351` | 7917296 | 2026-08-19 13:14:14 |
| `bin/test-backend-ops` | `81bfb4d93dcbbab66c6ead93e54ef17d29032ca54df2c032a367be826afacc33` | 10165800 | 2026-08-19 13:14:26 |
| `bin/libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | 536880 | 2026-08-19 13:14:25 |
| `bin/libggml-base.so` | `34dfbfb128c3dcf766919d8715083fa6e293b9522134dc2ee5bc49324e3f3c23` | 6103512 | 2026-08-19 13:13:45 |
| `bin/libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | 5165056 | 2026-08-19 13:14:25 |
| `bin/libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 | 2026-08-19 13:14:25 |
| `bin/libllama-common.so` | `522ae42c258d1bb5d2e92483c239357646c8ea6873b741118e266c1958abdb50` | 78377240 | 2026-08-19 13:14:26 |

NDK `libc++_shared.so` / `libomp.so` hashes unchanged from the oracle section. Expected on-device `libggml-opencl.so` = `acb41c32…`.

### Exact device command — 14 n=1 q4_0 cases, `HOST_REPACK=1` (DO NOT RUN from this session)

Push list: same as the oracle section, dest `/data/local/tmp/s3oracle`. Serial last used: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. From Git-bash with `MSYS_NO_PATHCONV=1`. `adb shell`, not Termux. `/proc/self/cpuset` should be `/`. Do **not** push `_ila` / `libadreno-opencl-kernels.so`. Verify sha on device before running. `ORACLE` stays off (this probe is the production kernel, not the concatenated wrappers). `HOST_REPACK` is still presence-only; `=1` is fine.

```sh
adb shell "cd /data/local/tmp/s3oracle && chmod +x test-backend-ops && \
  export LD_LIBRARY_PATH=/data/local/tmp/s3oracle && \
  export GGML_OPENCL_HOST_REPACK=1 && \
  export GGML_OPENCL_GEMV_AUDIT=1 && \
  ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0.*,n=1,k='"
```

Same filter as before (14 cases, keep it). Optional: `GGML_OPENCL_GEMV_AUDIT_MAX_DETAIL=4` (default), `GGML_OPENCL_GEMV_AUDIT_DUMP=12` (default), `GGML_OPENCL_GEMV_AUDIT_STASH_MB=512` (default). Optional same-process `GGML_OPENCL_DUMP_Q=1`. `GGML_OPENCL_GEMV_AUDIT=0` / `false` / `""` leave the probe **off**; any other non-empty string turns it **on** (same as ORACLE).

Grep: `^GEMV_AUDIT` / `^GEMV_AUDIT_BOUND` / `^GEMV_AUDIT_NOTE` / `^GEMV_AUDIT_BAD` / `^GEMV_AUDIT_STASH` / `^GLUE_AUDIT`. The filter on **this** `test-backend-ops` binary produced **12** MODE_TEST cases, not 14 (the two qwen3-grid n=1 cases are not in this exe's eval list; historically `-p type_a=q4_0` is 74 = 72 nested + 2880 + n=16). Keep the same filter.

---

## STEP-3 DEVICE RUN (S23, `d77e82347` binary `acb41c32…`) — findings only

Session ran, then was aborted after logs were already on the PC. Device dir `/data/local/tmp/s3oracle` was removed. Logs: `results/oracle_consumer_s23/run5/run5.log`, `run6/run6.log`. Env `HOST_REPACK=[1] GEMV_AUDIT=[1]`. cpuset `/`. On-device `libggml-opencl.so` sha matched `acb41c32692cae4cd95176a154b07cc2a7b3af8fc6012a0e1e79808ce8299351`. Filter produced **12** tests (not 14).

### Validity gates

| check | run5 | run6 |
|---|---|---|
| `GEMV_AUDIT_NOTE` | yes | yes |
| `GEMV_AUDIT_BOUND` | yes, `hostrepack=1` | yes, `hostrepack=1` |
| `hostrepack=1` on every `GEMV_AUDIT{` | 12/12 | 12/12 |
| unexpected `skipped=` | none | none |
| e2e FAIL in ~0.45 cluster | 12/12 FAIL, mean ERR **0.485** (min 0.362, max 0.698) | 12/12 FAIL, mean ERR **0.488** (min 0.378, max 0.693) |
| classification agreement | `pattern=ok`, `n_bad=0` all 12 | same |

### `GEMV_AUDIT_NOTE` (quote first, both runs identical)

```
GEMV_AUDIT_NOTE{sign_smear=label_reachable_only_on_structured_weights; absence_on_random_iid_excludes_nothing}
```

Absence of SIGN_SMEAR on this vehicle **excludes nothing**.

### `GEMV_AUDIT_BOUND` (both runs identical)

```
GEMV_AUDIT_BOUND{u=2^-24, gamma_k=k*u/(1-k*u), abs_ok=8*gamma_k*sum_abs+32*u*|want|+1e-5, note=Higham_f32_dot_vs_double_8x_for_block_scale_and_4sg_reduce, sign_smear=rate_ge80>=0.80_and_rate_lt80<=0.20_n>=32, ratio_cluster=frac_bad>=0.30_of_named_const, lane_mod=period=128/n_full_bad, stash_cap_mb=512, max_detail=4, dump=12, hostrepack=1}
```

### Per-case: args-consistent audit vs e2e (run5)

All 12: `n_bad=0`, `pattern=ok`, `ratio_clusters=none`, `ratio_med=1`, `max_abs` ~1.6e-6–2.3e-6. No `GEMV_AUDIT_BAD` dumps (detail=0 because n_bad=0). `LANE_MOD` did not fire. `REDUCTION_OR_SCALE` did not fire.

| case | shape (n_mats,n_used,b) | ne11 | experts | e2e ERR | n_bad | pattern |
|---|---|---|---|---:|---:|---|
| 1 | 4,1,0 | 1 | 1 | 0.3617 | 0 | ok |
| 2 | 4,1,1 | 1 | 0 | 0.5993 | 0 | ok |
| 3 | 4,2,0 | 2 | 1:3 | 0.5446 | 0 | ok |
| 4 | 4,2,1 | 1 | 1:2 | 0.4699 | 0 | ok |
| 5 | 4,4,0 | 4 | 0:1:2:3 | 0.4105 | 0 | ok |
| 6 | 4,4,1 | 1 | 0:1:2:3 | 0.4911 | 0 | ok |
| 7 | 8,1,0 | 1 | 5 | 0.5557 | 0 | ok |
| 8 | 8,1,1 | 1 | 2 | 0.4516 | 0 | ok |
| 9 | 8,2,0 | 2 | 1:2 | 0.4142 | 0 | ok |
| 10 | 8,2,1 | 1 | 1:3 | 0.6975 | 0 | ok |
| 11 | 8,4,0 | 4 | 0:1:4:6 | 0.4435 | 0 | ok |
| 12 | 8,4,1 | 1 | 0:2:3:5 | 0.3823 | 0 | ok |

b=0 and b=1 both fail e2e; both are args-consistent green. n_used=n_mats (no ids view, cases 5–6) also fail e2e / still n_bad=0.

### Per-case run6 (classification identical; numbers differ — regenerated data)

| case | experts | e2e ERR | n_bad | pattern |
|---|---|---:|---:|---|
| 1 | 2 | 0.6927 | 0 | ok |
| 2 | 1 | 0.5386 | 0 | ok |
| 3 | 0:3 | 0.4901 | 0 | ok |
| 4 | 0:2 | 0.3777 | 0 | ok |
| 5 | 0:1:2:3 | 0.5562 | 0 | ok |
| 6 | 0:1:2:3 | 0.4345 | 0 | ok |
| 7 | 4 | 0.4670 | 0 | ok |
| 8 | 5 | 0.4741 | 0 | ok |
| 9 | 0:3 | 0.4923 | 0 | ok |
| 10 | 3:6 | 0.3957 | 0 | ok |
| 11 | 2:4:5:6 | 0.4729 | 0 | ok |
| 12 | 0:5:6:7 | 0.4690 | 0 | ok |

run5 vs run6: **agree** on `pattern=ok` / `n_bad=0` / `ratio_clusters=none` every case. ERR values differ (expected).

### Verbatim `GEMV_AUDIT{...}` lines — run5

```
GEMV_AUDIT{case=1, src0=as, k=256, m=512, n_ex=4, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=2.05797e-06, mean_abs=4.04373e-07, max_rel=2.74944e-05, mean_rel=3.27034e-07, ratio_med=1, ratio_mad=8.64877e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1, geom_g=512x4x1, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67574, n_src_lt80=63498, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=2, src0=as, k=256, m=512, n_ex=4, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.74559e-06, mean_abs=3.72778e-07, max_rel=5.65647e-05, mean_rel=3.90698e-07, ratio_med=1, ratio_mad=9.13767e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0, geom_g=512x4x1, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67942, n_src_lt80=63130, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=3, src0=as, k=256, m=512, n_ex=4, n_used=2, ne11=2, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=2.01867e-06, mean_abs=3.81536e-07, max_rel=0.000112292, mean_rel=3.97001e-07, ratio_med=1, ratio_mad=8.82711e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1:3, geom_g=512x4x2, geom_l=64x4x1, offsetd=313984, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=135482, n_src_lt80=126662, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=4, src0=as, k=256, m=512, n_ex=4, n_used=2, ne11=1, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=1.56716e-06, mean_abs=3.68343e-07, max_rel=1.79843e-05, mean_rel=3.03862e-07, ratio_med=1, ratio_mad=9.21831e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1:2, geom_g=512x4x2, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=134992, n_src_lt80=127152, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=5, src0=as, k=256, m=512, n_ex=4, n_used=4, ne11=4, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=2.3105e-06, mean_abs=3.6577e-07, max_rel=0.00269776, mean_rel=1.80275e-06, ratio_med=1, ratio_mad=8.75151e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:1:2:3, geom_g=512x4x4, geom_l=64x4x1, offsetd=316032, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=270668, n_src_lt80=253620, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=6, src0=as, k=256, m=512, n_ex=4, n_used=4, ne11=1, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=2.21232e-06, mean_abs=3.77719e-07, max_rel=0.00010854, mean_rel=4.78619e-07, ratio_med=1, ratio_mad=8.70863e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:1:2:3, geom_g=512x4x4, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=269068, n_src_lt80=255220, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=7, src0=as, k=256, m=512, n_ex=8, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.83825e-06, mean_abs=3.90041e-07, max_rel=1.50916e-05, mean_rel=2.61835e-07, ratio_med=1, ratio_mad=9.52082e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=5, geom_g=512x4x1, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67800, n_src_lt80=63272, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=8, src0=as, k=256, m=512, n_ex=8, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.86796e-06, mean_abs=3.83316e-07, max_rel=2.53077e-05, mean_rel=3.33905e-07, ratio_med=1, ratio_mad=9.41198e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=2, geom_g=512x4x1, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67602, n_src_lt80=63470, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=9, src0=as, k=256, m=512, n_ex=8, n_used=2, ne11=2, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=1.69889e-06, mean_abs=3.76376e-07, max_rel=2.13639e-05, mean_rel=3.48672e-07, ratio_med=1, ratio_mad=9.39529e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1:2, geom_g=512x4x2, geom_l=64x4x1, offsetd=608896, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=135834, n_src_lt80=126310, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=10, src0=as, k=256, m=512, n_ex=8, n_used=2, ne11=1, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=2.12455e-06, mean_abs=3.84944e-07, max_rel=0.00443103, mean_rel=4.75387e-06, ratio_med=1, ratio_mad=8.82348e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1:3, geom_g=512x4x2, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=134574, n_src_lt80=127570, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=11, src0=as, k=256, m=512, n_ex=8, n_used=4, ne11=4, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=2.03069e-06, mean_abs=3.8021e-07, max_rel=0.00075539, mean_rel=8.17233e-07, ratio_med=1, ratio_mad=9.32237e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:1:4:6, geom_g=512x4x4, geom_l=64x4x1, offsetd=610944, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=269718, n_src_lt80=254570, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=12, src0=as, k=256, m=512, n_ex=8, n_used=4, ne11=1, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=2.29349e-06, mean_abs=3.74436e-07, max_rel=2.06721e-05, mean_rel=3.22011e-07, ratio_med=1, ratio_mad=9.10952e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:2:3:5, geom_g=512x4x4, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=268614, n_src_lt80=255674, n_bad_src_ge80=0, n_bad_src_lt80=0}
```

### Verbatim `GEMV_AUDIT{...}` lines — run6

```
GEMV_AUDIT{case=1, src0=as, k=256, m=512, n_ex=4, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.74421e-06, mean_abs=3.65328e-07, max_rel=2.2009e-05, mean_rel=3.41953e-07, ratio_med=1, ratio_mad=8.8799e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=2, geom_g=512x4x1, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67764, n_src_lt80=63308, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=2, src0=as, k=256, m=512, n_ex=4, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=2.43895e-06, mean_abs=3.74931e-07, max_rel=2.72265e-05, mean_rel=2.89344e-07, ratio_med=1, ratio_mad=9.16259e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=1, geom_g=512x4x1, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=66816, n_src_lt80=64256, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=3, src0=as, k=256, m=512, n_ex=4, n_used=2, ne11=2, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=2.24922e-06, mean_abs=3.79683e-07, max_rel=0.000142442, mean_rel=5.43335e-07, ratio_med=1, ratio_mad=9.50321e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:3, geom_g=512x4x2, geom_l=64x4x1, offsetd=313984, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=134180, n_src_lt80=127964, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=4, src0=as, k=256, m=512, n_ex=4, n_used=2, ne11=1, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=1.69961e-06, mean_abs=3.85323e-07, max_rel=3.00847e-05, mean_rel=3.91476e-07, ratio_med=1, ratio_mad=8.40932e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:2, geom_g=512x4x2, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=134942, n_src_lt80=127202, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=5, src0=as, k=256, m=512, n_ex=4, n_used=4, ne11=4, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=1.87318e-06, mean_abs=3.72824e-07, max_rel=0.000177656, mean_rel=5.04696e-07, ratio_med=1, ratio_mad=9.1528e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:1:2:3, geom_g=512x4x4, geom_l=64x4x1, offsetd=316032, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=270540, n_src_lt80=253748, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=6, src0=as, k=256, m=512, n_ex=4, n_used=4, ne11=1, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=1.81001e-06, mean_abs=3.83811e-07, max_rel=0.000272946, mean_rel=5.46631e-07, ratio_med=1, ratio_mad=8.72947e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:1:2:3, geom_g=512x4x4, geom_l=64x4x1, offsetd=312960, offset1=307840, offset2=303616, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=269454, n_src_lt80=254834, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=7, src0=as, k=256, m=512, n_ex=8, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.87304e-06, mean_abs=3.66434e-07, max_rel=1.31039e-05, mean_rel=2.76554e-07, ratio_med=1, ratio_mad=8.44862e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=4, geom_g=512x4x1, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67534, n_src_lt80=63538, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=8, src0=as, k=256, m=512, n_ex=8, n_used=1, ne11=1, ne12=1, ne20=1, ne21=1, n_elem=512, n_bad=0, n_oob=0, max_abs=1.65192e-06, mean_abs=3.64746e-07, max_rel=0.000170346, mean_rel=6.31079e-07, ratio_med=1, ratio_mad=8.49663e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=5, geom_g=512x4x1, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=67612, n_src_lt80=63460, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=9, src0=as, k=256, m=512, n_ex=8, n_used=2, ne11=2, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=2.09441e-06, mean_abs=3.66895e-07, max_rel=2.23748e-05, mean_rel=2.81619e-07, ratio_med=1, ratio_mad=8.15015e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:3, geom_g=512x4x2, geom_l=64x4x1, offsetd=608896, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=134808, n_src_lt80=127336, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=10, src0=as, k=256, m=512, n_ex=8, n_used=2, ne11=1, ne12=1, ne20=2, ne21=1, n_elem=1024, n_bad=0, n_oob=0, max_abs=1.92196e-06, mean_abs=3.75079e-07, max_rel=0.000161715, mean_rel=6.72992e-07, ratio_med=1, ratio_mad=8.64725e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=3:6, geom_g=512x4x2, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=135734, n_src_lt80=126410, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=11, src0=as, k=256, m=512, n_ex=8, n_used=4, ne11=4, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=2.57031e-06, mean_abs=3.81994e-07, max_rel=0.000839631, mean_rel=7.1477e-07, ratio_med=1, ratio_mad=8.82254e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=2:4:5:6, geom_g=512x4x4, geom_l=64x4x1, offsetd=610944, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=270054, n_src_lt80=254234, n_bad_src_ge80=0, n_bad_src_lt80=0}
GEMV_AUDIT{case=12, src0=as, k=256, m=512, n_ex=8, n_used=4, ne11=1, ne12=1, ne20=4, ne21=1, n_elem=2048, n_bad=0, n_oob=0, max_abs=1.95178e-06, mean_abs=3.8132e-07, max_rel=0.000117837, mean_rel=4.55948e-07, ratio_med=1, ratio_mad=9.17329e-08, ratio_frac_near=1.0000, ratio_clusters=none, pattern=ok, experts=0:5:6:7, geom_g=512x4x4, geom_l=64x4x1, offsetd=607872, offset1=602752, offset2=598528, ne00=256, ne01=512, hostrepack=1, glue=logged_not_verified, detail=0, max_run=0, n_runs=0, rate_ge80=0.0000, rate_lt80=0.0000, n_src_ge80=270620, n_src_lt80=253668, n_bad_src_ge80=0, n_bad_src_lt80=0}
```

### Dominant error structure (plain)

The **compiled GEMV**, given the arguments it was actually passed (GPU ids buffer, `i11 = i20 % ne11`, dst `row + i20*ne01`, host-repacked q4_0), matches `dequantize_row_q4_0` + double dot to ~2e-6. `ratio_med=1`, `ratio_clusters=none`. That is **not** a reduction-scale constant, **not** a lane lattice, **not** unstructured kernel arithmetic.

The **same dispatches** fail the test's semantic check at ERR 0.36–0.70 (both b=0 and b=1). Kernel and the args-consistent audit agree; both disagree with the test. The only components shared by kernel and audit are the **glue values**. `glue=logged_not_verified` is the remaining suspect. No `GEMV_AUDIT_BAD` dumps (nothing to dump against the args-consistent ref).

### Reading-rule notes applied

- `LANE_MOD` did not fire (no lattice tag to distrust).
- SIGN_SMEAR absence excludes nothing (NOTE quoted above).
- Decision channel: `ratio_clusters=none` + `n_bad=0` vs e2e ~0.45. Tags are all `ok`. Numbers: kernel-vs-glue is green; test is red.

---

## GLUE AUDIT (design, stacked after DEVICE RUN) — PC-only, no device

The next instrument. Gated by the same `GGML_OPENCL_GEMV_AUDIT`. No new `.cl`.

### Design as implemented (file:line, HEAD after this commit)

| Piece | Lines |
|---|---|
| `extra_cl::{audit_host,audit_ne,audit_nb}` + swap-empty `reset()` | 5865–5884 |
| `ggml_opencl_gemv_audit_stash_generic` (I32 ids + F32 src1, partial writes) | 5890–5926 |
| Hook at generic `set_tensor` write | 9529 |
| Semantic mapping comment (ggml-cpu.c:1924–1933, 1685–1703) | ~20726 |
| Triple compare + `GLUE_AUDIT{...}` / `GLUE_AUDIT_DIV{...}` / `GLUE_AUDIT_IDS{...}` | 20726–20940 |

Semantic reference (stock CPU `ggml_compute_forward_mul_mat_id`, `use_ref` so the fused K-quant GEMV is off; q4_0 is not a K-quant):

```
for slot in 0..n_ids-1:          // ids->ne[0]
  expert = ids[slot, token=0]    // *(data + view_offs + slot*nb[0] + token*nb[1])
  i11    = slot % ne11           // ggml-cpu.c:1688
  dst[row, slot, 0] = dot(W[expert, row], src1[:, i11, 0])
```

Args-consistent (existing): `expert = packed_gpu_ids[i20]`, `i11 = i20 % ne11`, `dst[row + i20*ne01]`.

Triple comparison, same run: (a) dst vs semantic — expected to track e2e ERR; (b) dst vs args-consistent — expected n_bad=0; (c) GPU ids vs stashed ids (byte/slot); plus GPU src1 vs stashed src1. `bcast=0` when `ne11==n_used`, `bcast=1` when `ne11==1 && n_used>1`. Divergence map: `expert_sem` vs `expert_used`, `src1_col_sem` vs `src1_col_used`, `dst_off_sem` vs `dst_off_used`.

### Path selection: q8_0 / q6_K vs narrow quants (read-only)

`supports_op` `GGML_OP_MUL_MAT_ID` (`ggml-opencl.cpp` 6939–6963): q4_0, q8_0, mxfp4 if contig F32 src1; q4_1/q5_0/q5_1/q4_K/q5_K/**q6_K** only if `use_adreno_moe_kernels` (6673–6675: name contains `as` or (`ffn` and `exps`), and `ne01 % 32 == 0`).

Dispatch in `ggml_cl_mul_mat_id`:

| type | path | file:line |
|---|---|---|
| **q4_0** | if `use_adreno_moe_kernels`: SoA + `kernel_gemv_moe_q4_0_f32_ns` / `gemm_moe_*` (packed ids subbuffer, `i20=gid(2)`, no nb21). Else generic `kernel_mul_mv_id_q4_0_f32_8x_flat` | 21036, fallback 21228 |
| **q8_0** | **not** the Adreno MoE gemv/gemm path. `kernel_mul_mv_id_q8_0_f32_flat` with **stride args** `nb01, nb02, nb11, nb12, nb21, ne20, ne21` | 21813 |
| **q6_K** | **only** `use_adreno_moe_kernels`: same geometry as q4_0 MoE (`kernel_gemv_moe_q6_k_f32_ns`, packed ids subbuffer, `global[2]=ne20`). No generic fallback; `supports_op` is false otherwise | 22252 |

q8_0 75/75 passing is consistent with “glue defect lives in the packed-ids MoE gemv path, not in stride-aware `mul_mv_id_*`”. q6_K 3/3 **uses the same packed-ids MoE glue as q4_0**; if those tests really took `use_adreno_moe_kernels` (they are `test_mul_mat_id` named `as`, `ne01=896` divisible by 32), a glue-only hypothesis has to explain why q6_K gemv would be correct with the same ids/src1/dst setup. This instrument does not answer that; it cites the path.

### Binaries after GLUE AUDIT rebuild (`build-android-opencl-s3oracle/`)

| file | sha256 | size | mtime (local) |
|---|---|---:|---|
| `bin/libggml-opencl.so` | `2ab3624c8f68b79aa70b74234f9b7912e0d9e275d93a4c8d85e92238ae6fcf62` | 7978864 | 2026-08-19 13:41:25 |
| `bin/test-backend-ops` | `81bfb4d93dcbbab66c6ead93e54ef17d29032ca54df2c032a367be826afacc33` | 10165800 | 2026-08-19 13:41:26 |
| `bin/libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | 536880 | 2026-08-19 13:41:25 |
| `bin/libggml-base.so` | `7cf161a2187295679ea031660cc456388057737e4be25331f0f28417cee2abc1` | 6103512 | 2026-08-19 13:38:23 |
| `bin/libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | 5165056 | 2026-08-19 13:40:59 |
| `bin/libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 | 2026-08-19 13:41:25 |
| `bin/libllama-common.so` | `ab84dfa2251e9abfd121dbb05a4bd51ff9d5098570b10f0340b5c8ce33e4ca81` | 78377240 | 2026-08-19 13:41:26 |

Expected on-device `libggml-opencl.so` = `2ab3624c…`. No new `.cl`. Host compile: two pre-existing warnings only.

**Stop.** Hostile review of the GLUE AUDIT commit before any device session. The next S23 window is not this one.

---

## Post-hook dst writer (source, before more instrumentation)

PC-only read of the q4_0 GEMV n=1 MUL_MAT_ID dispatch. Question: after `kernel_gemv_moe_q4_0_f32_ns` and the GEMV_AUDIT hook, does anything else write the same dst `cl_mem`?

### Dispatch, program order (`ggml_cl_mul_mat_id`, q4_0, Adreno MoE, `ne12==1`)

Function: `ggml-opencl.cpp:20932`. Taken only when `use_adreno_moe_kernels` (`6673–6677`: name contains `as` or (`ffn` and `exps`), and `ne01 % 32 == 0`). test-backend-ops names the weight `as`; the 12 n=1 cases have `m=512`, so the gate is true. Device logs already prove the audit hook ran 12/12, so this branch was taken.

| # | op | file:line | writes dst? |
|---|---|---|---|
| 1 | `clCreateSubBuffer` src2 / src1; `clCreateImage` of src1 | 21047–21070 | no |
| 2 | `clSetKernelArg` 0..8: q, d, src1 image, ids sub, **`extrad->data_device`**, `offsetd`, ne00, ne01, ne11 | 21073–21082 | no |
| 3 | `enqueue_ndrange_kernel(kernel_gemv_moe_q4_0_f32_ns, …, dst)` → one `clEnqueueNDRangeKernel` | **21085** (wrapper **967–981**) | **yes — this is the production writer** |
| 4 | `ggml_opencl_gemv_audit_q4_0` (clFinish + blocking read of dst/src1/ids; no write of dst) | **21091** | no (read only) |
| 5 | `clReleaseMemObject(src1_sub_buffer, buf_src1_image, buf_src2)` | 21098–21100 | no dst enqueue |
| 6 | `return` | **21224** | — |

The wrapper `enqueue_ndrange_kernel` (`967–981`) is a single `clEnqueueNDRangeKernel`. No second launch, no profiling extra write unless `GGML_OPENCL_PROFILING` (off in this build).

### Fall-through / second kernel: **not taken**

After the Adreno `if`, the generic `kernel_mul_mv_id_q4_0_f32_8x_flat` is set up at **21228–21268** and enqueued at the common tail **22711**. That tail is **unreachable** on this path because of `return` at **21224**. The GEMM sibling (`kernel_gemm_moe_q4_0_f32_ns` / `_bin`, `kernel_moe_reorder_b`, dst-as-image) is the `else` of `ne12==1` (21102–21223) and is not entered for GEMV n=1.

No `clEnqueueCopyBuffer` / `clEnqueueWriteBuffer` / `clEnqueueFillBuffer` in `ggml_cl_mul_mat_id` at all. The only CopyBuffer in this file that writes a `dst` argument is `transpose_2d` (`5805–5813`), called from convert/get_tensor of **weights**, not from this GEMV path.

### Graph-level double compute: **not in this harness**

`ggml_backend_opencl_graph_compute` (`6608–6650`): one pass, each node once. Fusion patterns are NORM/MUL/ADD, GROUP_NORM/MUL/ADD, RMS_NORM/MUL — not MUL_MAT_ID. `ggml_cl_compute_forward` (`24049`) maps `GGML_OP_MUL_MAT_ID` → `ggml_cl_mul_mat_id` (`24314–24318`) and calls it once (`24399`).

test-backend-ops `test_mul_mat_id` does **not** override `run_whole_graph()` (default false, `1230`). `ggml_backend_compare_graph_backend` (`2183–2204`) therefore computes **one node at a time** (`ggml_graph_view(i, i+1)`), then the callback `get_tensor`s that node. Graph for this test (`4300–4317`): `as`, `ids` (maybe a VIEW), `b`, `out = mul_mat_id`. VIEW is skipped. Sentinels are **later** nodes; they have not been computed when `out` is read. So a later graph node cannot clobber dst before the e2e compare.

### q6_K (the “beautiful fit” check, not forced)

q6_K GEMV (`22252–22425`) is the same shape: enqueue `kernel_gemv_moe_q6_k_f32_ns` at **22305**, release the same three src1/ids objects, `return` at **22425**. No second writer whose q6_K variant would be “the correct one”. If Adreno MoE is off, the q6_K `case` has **no `break`** and falls through into `GGML_TYPE_MXFP4` (`22429`) — that is a different bug, and it is not this path (`as` + `ne01%32==0`).

### What the code actually says

There is **no** post-hook kernel/copy/write of dst in the GEMV n=1 dispatch. The last (and only) dst writer in this function is `kernel_gemv_moe_q4_0_f32_ns` at 21085, **before** the audit snapshot. The only host-side ops after the snapshot in this function are `clReleaseMemObject` of the src1 subbuffer, the src1 image1d_buffer, and the ids subbuffer — not dst. Between that return and the harness read, the OpenCL backend enqueues nothing else for this node.

That does **not** prove the buffer is still intact at `get_tensor` (driver-side image-release coherency, wrong read offset, transform in `get_tensor`). It does refute “a second OpenCL kernel in this dispatch is the last author.”

F32 `get_tensor` (`10618–10622`) is a blocking `clEnqueueReadBuffer` of `extra->data_device` at `extra->offset + view_offs + offset`. No convert. (q4_0 restore kernels in the same function write a **new** temp buffer, and they run only when the harness reads the weight, not `out`.)

---

## DST_READBACK + OVERLAP_MAP + POST_ENQUEUE (Qwen A4, extended)

Source was clean, so the stashed hook was popped and finished. Still gated by `GGML_OPENCL_GEMV_AUDIT`. No new `.cl`. Inert if unset (`snaps.empty()` short-circuit on the enqueue hot path — no `getenv` per kernel).

### What it logs

After the production GEMV audit has a `got[]` (same bytes as `GEMV_AUDIT` / `GLUE_AUDIT`):

- Snapshot: FNV-1a64 of `(cl_mem, offsetd, n_elem*4)`, first4/last4. Cap 64.
- At generic F32 `get_tensor`, after the production `clEnqueueReadBuffer` into `data`:
  - **raw** = a second blocking read of the **snap range**
  - **returned** = checksum of the comparable slice of `data` (exact range, or snap-as-subrange of the get)
  - `DST_READBACK{case, raw_match, returned_match, snap_ck, raw_now_ck, returned_ck, …}`
    - `raw_match=1` iff `raw_now_ck == snap_ck` (device buffer still matches the audit)
    - `returned_match=1` iff the comparable slice of what `get_tensor` handed over matches `snap_ck`; `-2` if the get range does not contain the snap (not comparable); `-1` on read error
    - When `get_off == snap_off` (this vehicle), **`(raw_match=1, returned_match=0)` is structurally unreachable** — both reads hit the same bytes. See the table below.
  - Snap is then **consumed** so a later test reusing the same `cl_mem` does not false-clobber against the previous case.
- `POST_ENQUEUE{name, tensor, bind=1, snap_case, koff, ksize, snap_off, snap_size, n_post_enq}` — env-gated, only after a live snap exists. Logged from `enqueue_ndrange_kernel` when the wrapper’s tensor extra (non-quantized `extra_cl.data_device` + offset + nbytes) overlaps a live snap. Cap 32 lines. OpenCL cannot query bound `cl_mem` args; this is the wrapper’s profiling tensor, not the kernel arg list. False positive if a kernel is passed `dst` as the wrapper tensor but writes elsewhere (`kernel_moe_reorder_b` on the GEMM path). False negative if a kernel writes dst but is passed a different wrapper tensor, or if it uses raw `clEnqueueNDRangeKernel` (restore/transpose).
- `OVERLAP_MAP{n_overlaps, n_snaps, n_live, n_post_enq, n_post_bind}` plus up to 16 `OVERLAP_PAIR{…}` among **live** snaps. Once, when `n_live>=2` at get_tensor, or at process exit.

Reading rule (review B6). This vehicle: `offsetd == extra->offset + view_offs + 0`, so snap offset == get offset. Both the production `get_tensor` read and the hook re-read hit the same bytes. Decision surface = the three reachable match pairs **plus** the offset fields.

| raw_match | returned_match | reading |
|---|---|---|
| 1 | 1 | memory at snap range intact AND the caller received exactly the audited bytes. Readback path clean. |
| 0 | 0 | memory **changed between audit and get_tensor** (clobber / second writer / producer rewrite). `n_post_enq` / `POST_ENQUEUE` say whether a kernel in *our* wrapper did it. 0 post-enq + raw_match=0 = not a kernel we wrap (image release, raw enqueue, driver). |
| 0 | 1 | changed in the microsecond window between get's read and the hook re-read. Near-impossible; would itself be the signal. |
| 1 | 0 | **structurally unreachable** when offsets are equal. Do not wait for this pair. |
| any | -2 | get range does not contain the snap. Not a match pair — read `get_off`/`get_size` vs `snap_off`/`snap_size`. |
| -1 | -1 | re-read failed (`skipped=read_err`). |

### file:line (committed with review B6)

| Piece | Where |
|---|---|
| snap / FNV / OVERLAP_MAP / DST_READBACK | `ggml-opencl.cpp` ~1255–1470 |
| `enqueue_ndrange_kernel` calls `ggml_opencl_gemv_log_post_enqueue` | wrapper ~967–982 |
| POST_ENQUEUE body (needs `extra_cl`) | after `ggml_tensor_extra_cl` ~6085 |
| register snap after audit dst read | ~20571 |
| get_tensor F32 hook (after production read) | ~10871 |

### Binaries after DST_READBACK rebuild (`build-android-opencl-s3oracle/`)

Commit `bcdbc9ed6` on `kalsa/kernel-s3-repack` (review B6). Host compile of `ggml-opencl.cpp`: same two pre-existing warnings only. No new `.cl`. Not pushed.

| file | sha256 | size | mtime (local) |
|---|---|---:|---|
| `bin/libggml-opencl.so` | `25044c5af263f80315d0a3c27737c97c4c49304a29dfeb059f8c58f7d0e27d68` | 7963024 | 2026-08-19 14:34:39 |
| `bin/test-backend-ops` | `81bfb4d93dcbbab66c6ead93e54ef17d29032ca54df2c032a367be826afacc33` | 10165800 | 2026-08-19 13:55:47 |
| `bin/libggml.so` | `3f07bb31e79da8698635286a1a39dd2f21836e32dff9bdf578a1cce01351fb27` | 536880 | 2026-08-19 13:55:47 |
| `bin/libggml-base.so` | `280797c6a9f7add5281359b67e0c89af7868ec8c70e8af59089d12e5a8505af5` | 6103512 | 2026-08-19 14:21:55 |
| `bin/libggml-cpu.so` | `fd9cb4b1f49c60a64eea964a4c19200c2878b74df450bc287cbbe6fdf8dcb0da` | 5165056 | 2026-08-19 13:55:23 |
| `bin/libllama.so` | `f8b11fc34be81291c01cc77a657d267eaf7f102ed6cb6ef708bbaab7730a667d` | 39807624 | 2026-08-19 13:55:47 |
| `bin/libllama-common.so` | `82524a4598e2d25391827cbd47f83ad639ea6da56d974dc0615d03ed0873ee2b` | 78377240 | 2026-08-19 13:55:47 |

The hook is in `libggml-opencl.so` = `25044c5a…` (rebuilt after the B6 comment; log format strings unchanged). `test-backend-ops` sha is unchanged vs GLUE AUDIT (`81bfb4d9…`). Expected on-device so = `25044c5a…`.

---

## SESSION PLAN — next S23 window (do not run until the owner opens it)

Goal: one instrumented run that **cannot end uninterpretable**. Two repeats (run9 / run10), same protocol as run7/run8.

### Binary and push

- Tree: `kalsa/kernel-s3-repack` after the B6 dst-readback commit.
- Identify `libggml-opencl.so` by **sha256 + mtime**, not by path. Record both on PC before push; recompute on device; abort if they differ.
- Dest: `/data/local/tmp/s3oracle` only. Do **not** touch `s3base` / `s3fix` / `s3printf`. Do **not** push `_ila` / `libadreno-opencl-kernels.so`.
- Serial last used: `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. Git-bash `MSYS_NO_PATHCONV=1`. `adb shell`, not Termux. `/proc/self/cpuset` = `/`.
- After the window: pull logs, remove `/data/local/tmp/s3oracle`, leave the phone idle.

### Command (both repeats)

Same filter as run5–run8 (this exe yields **12** MODE_TEST cases, not 14):

```sh
adb shell "cd /data/local/tmp/s3oracle && chmod +x test-backend-ops && \
  export LD_LIBRARY_PATH=/data/local/tmp/s3oracle && \
  export GGML_OPENCL_HOST_REPACK=1 && \
  export GGML_OPENCL_GEMV_AUDIT=1 && \
  ./test-backend-ops test -b GPUOpenCL -o MUL_MAT_ID -p 'type_a=q4_0.*,n=1,k='"
```

`ORACLE` off. `HOST_REPACK` is still presence-only.

Grep: `^DST_READBACK` `^POST_ENQUEUE` `^OVERLAP_` `^GLUE_AUDIT` `^GEMV_AUDIT` `ERR =`.

### Per-case checklist (12/12)

For every `DST_READBACK` line:

1. Record `raw_match`, `returned_match`, `get_off`, `snap_off`, `get_size`, `snap_size`, `n_post_enq`, `n_post_bind`.
2. Confirm `get_off == snap_off` and `get_size == snap_size`. If not: `returned_match` should be `-2` (or a nested-slice `0/1`); that **is** the offset-divergence signal. Stop interpreting match pairs until offsets are explained.
3. Classify on the B6 table only. **Do not wait for (1,0).**

Also: `GLUE_AUDIT` still triple-green? `GEMV_AUDIT n_bad` still 0? e2e `ERR` still ~0.4? `POST_ENQUEUE` count? `OVERLAP_MAP n_live` at exit (expect 0 if every snap was consumed).

### Branch A — any case is (0,0) with equal offsets

Suspect A (clobber between audit and get). `n_post_enq==0` and no `POST_ENQUEUE` ⇒ not a kernel our wrapper saw (image-release of src1, raw enqueue, driver). `POST_ENQUEUE bind=1` ⇒ that kernel name is the next target. Stop; do not pivot to the harness.

### Branch B — any case is (0,1)

The microsecond window. Treat as a signal, not a hook bug. Stop and report; do not fold it into (0,0) or (1,1).

### Branch C — 12/12 `(raw_match=1, returned_match=1)` AND equal offsets AND no `POST_ENQUEUE` / no live overlap

**GPU kernel + OpenCL readback are fully exonerated.** Combined with already-green semantic / args / ids / src1 (run7/run8), the bytes the harness received **are** the audited, semantically correct dst. e2e still red then implicates the **harness side**, not Adreno GEMV.

Harness geometry (do not invert the labels):

- `test_case::eval(b, b_cpu, …)` at `test-backend-ops.cpp:10060` ⇒ `backend1` = GPUOpenCL, `backend2` = CPU.
- Callback `f1 = tensor_to_float(t1)` is **OpenCL**; `f2 = tensor_to_float(t2)` is **CPU**. `err(f1, f2)` is NMSE, threshold `5e-4`.
- For contiguous F32 `out`, `tensor_to_float` is an identity walk of `nb[]`. The auditor’s “out1=CPU, out2=GPU” is **inverted** vs this file; dump `f1`/`f2` with those names.

This tree’s `ggml-cpu` MUL_MAT_ID is **not** pristine upstream. Unique commits on `ggml-cpu.c` vs `origin/master` include `b8a78977d` (fused K-quant GEMV), `5236140e5` (expert-ready hook), `74e37a625`/`b34df7afd`/`4a3ae4e5e` (fused MoE FFN), `8d3c2ea75` (REPACK vs vec_dot trace). For **q4_0** the fused GEMV gate is false (`ggml_cpu_type_is_k_quant` does not include q4_0; `use_ref` also disables it). `one_chunk` mapping (`1685–1703`) and grouping (`1924–1933`) were not rewritten. The expert hook is a no-op unless set. That is **not** an exonerate: `ggml_cpu_extra_compute_forward` still sits in front of stock (`ggml-cpu.c:2027`), and the harness CPU path is this tree, not ggml-org. CPU is a live suspect.

**Pre-planned discriminators (do not invent a third mid-run):**

**(a) Dump the harness comparison buffers vs our semantic reference.** On one failing case, print `f1[i]`, `f2[i]`, and the GLUE_AUDIT semantic `want_sem[i]` (same slot/row as `GLUE_AUDIT_DIV`). The commented element-wise printer is `test-backend-ops.cpp:1485–1487` (`f1` then `f2`). The side that disagrees with `want_sem` is the culprit. Predicted if Branch C holds: `f1 == want_sem` (readback exonerated + GLUE green) and `f2` disagrees (CPU / NMSE / geometry).

**(b) PC-only CPU rerun of the same case against stored ids/src1.** `init_mul_mat_id_tensors` uses `std::random_device` (`test-backend-ops.cpp:4238–4250`) — a later process **cannot** reproduce run5/run7 tensors. run5–run8 logs do **not** contain full ids/src1 dumps (only `experts=` packed lists and glue counters). So (b) needs a dump from the **same** S23 process that printed DST_READBACK: ids, src1, q4_0 AoS (`aos_host` already stashed under GEMV_AUDIT), and CPU `f2`. Then on PC, with **no OpenCL**:

1. Replay this-tree `ggml_compute_forward_mul_mat_id` on those tensors; compare dst to `dequantize_row_q4_0` + double-dot stock mapping (the GLUE semantic).
2. Verify this-tree CPU against **pristine upstream**: `git diff origin/master -- ggml/src/ggml-cpu/ggml-cpu.c` (and `repack.cpp`, which currently has **no** delta vs `origin/master`). Focus on `ggml_compute_forward_mul_mat_id_one_chunk`, grouping, `ggml_cpu_mul_mat_id_should_fuse`, and `ggml_cpu_extra_compute_forward`. Optional: a second worktree of `origin/master` / `upstream/master`, same replay, compare dst. `origin/master` is Helldez; `upstream` is `ggml-org/llama.cpp`.

If (a) already shows `f2 != want_sem` and (b.2) shows one_chunk+grouping identical to origin for q4_0, the remaining CPU suspects are `extra_compute_forward` / ARM `vec_dot_q4_0` / q8_0 activation quant (vec_dot_type) — q8_0-of-acts is a small NMSE, not ERR ~0.4.

### What “done” looks like

Write a DEVICE RUN section with: so sha on device, 12-row table of DST_READBACK matches + offsets, POST_ENQUEUE/OVERLAP counts, e2e ERR, and **exactly one** of Branch A / B / C. If C, name (a) and (b) as the next PC/device work; do not declare the Adreno GEMV guilty or innocent beyond “exonerated at get_tensor.”

No push of this commit. Device only when the owner gives the window.

---

## DEVICE RUN run9 / run10 (DST_READBACK) — Branch C

Binary on device: `libggml-opencl.so` = `25044c5a…` (`bcdbc9ed6`). Env `HOST_REPACK=1 GEMV_AUDIT=1`. 12/12 cases. Cleanup: `/data/local/tmp/s3oracle` removed; `s3base`/`s3fix`/`s3printf` untouched.

Both runs: 12/12 `DST_READBACK raw_match=1 returned_match=1`, `get_off==snap_off`, `n_post_bind=0`, zero `POST_ENQUEUE` lines, `OVERLAP_MAP n_live=0 n_overlaps=0`. GLUE triple-green 12/12. GEMV_AUDIT `n_bad=0`. e2e **0/12 FAIL**, ERR 0.35–0.73. GPU kernel + OpenCL readback exonerated. Logs: `results/oracle_consumer_s23/run9/`, `run10/`.

Per-shape ERR is **data-dependent**, not shape-deterministic (same 12 shapes, different random tensors each run; e.g. `(8,1,0)` 0.379 vs 0.733). Qwen's alignment-conditional mixture as a shape-stable ERR is refuted by this pair of runs.

**A3 (tail-row / padding) is dead.** Six of the 12 cases have `n_used=1` so `n_elem = m × 1 = 512` — no tail rows, no unused expert slots in dst. Those six still fail at ERR 0.36–0.66 (run9: 0.416, 0.529, 0.379, 0.578; run10: 0.484, 0.531, 0.733, 0.378). A compare that accidentally includes padding cannot explain a 512-element dst that is 100% live.

---

## FORENSIC — this-tree CPU vs upstream merge-base (PC, 2026-08-19)

Merge-base with **ggml-org** `upstream/master`: `22b69b6e92e831442fdd287901816ce3aa8a2b43` (`arg: prevent duplicate spec model downloads`). `origin/master` is the Helldez fork (behind); not the upstream base.

`git diff 22b69b6e9 HEAD -- ggml/src/ggml-cpu/` is **only** `ggml-cpu.c` (+854) plus (outside that dir) `ggml/include/ggml-cpu.h` (+25). **Empty** for `repack.cpp`, `arch/arm/**`, `ops.cpp`, `ggml-cpu-quants`. The ARM `quants.c` 4-line `vqtbl1q` change vs `origin/master` is already **in** the upstream merge-base (`ac17f8ac1` ancestor of `22b69b6e9`) — not a Kalsa delta vs ggml-org.

Campaign `cpu:` commits on this branch: `5236140e5` expert-ready hook, `b8a78977d` fused K-quant GEMV, `74e37a625`/`b34df7afd`/`4a3ae4e5e` fused MoE FFN, `8d3c2ea75` REPACK vs vec_dot **trace**.

### Lens: dense q4_0 GEMV n=1 is 46/46 on-device

Dense `MUL_MAT` q4_0 uses the **same** `type_traits_cpu[Q4_0].vec_dot` (`ggml_vec_dot_q4_0_q8_0`) as stock `MUL_MAT_ID` `one_chunk`. If that vec_dot were broken on ARM, dense GEMV n=1 would fail too. It does not. Shared vec_dot is **not** the judge defect. Any CPU-side break in the 12-case harness has to live in **MUL_MAT_ID-specific** code: grouping, expert gather, fused early-return, extra-buffer intercept, work-size.

### Did the naive loop itself move? **No. Semantic mirror is not faithfully-wrong.**

`git diff 22b69b6e9 HEAD -- ggml/src/ggml-cpu/ggml-cpu.c` does **not** contain `ggml_compute_forward_mul_mat_id_one_chunk`, `i11 = id % ne11`, `group rows by src0`, or `MMID_MATRIX_ROW`. HEAD `1685–1703` (one_chunk: `i11 = id % ne11`, `dst_col = id*nb1 + i2*nb2`) and `1924–1933` (group `ids[id,iid1] → expert`) are the merge-base text, line-shifted only. GLUE_AUDIT's semantic copy of those lines is a copy of **pristine** mapping.

### Hunk classification (executed on the S23 harness or not)

Harness facts that gate reachability:

- `test-backend-ops.cpp:10028–10032` / `10094–10095` call `ggml_backend_cpu_set_use_ref(cpu, true)`.
- `ggml_cpu_mul_mat_id_should_fuse` (`ggml-cpu.c:83–100`) returns false if `params->use_ref` **or** if type is not K-quant. q4_0 is not K-quant (`68–79`).
- `ggml_backend_alloc_ctx_tensors` for the CPU graph copy uses the **default host** buft (`ggml-alloc.c:1246–1247` + `ggml-cpu.cpp:410–411`), not `CPU_REPACK`. `extra_compute_forward` therefore does not intercept (needs `src0->buffer->buft == ggml_backend_cpu_repack_buffer_type()`). PC control printed `buft=CPU extra=0`.

| hunk | file:line (HEAD) | MUL_MAT_ID q4_0/q4_1/q5_0/q5_1/mxfp4 harness? | q8_0 / q6_K? | arch |
|---|---|---|---|---|
| expert-ready hook | `ggml-cpu.c:58–66`, call `1956–1960` | no-op unless hook registered (tests do not) | same | portable C |
| fused K-quant GEMV + `should_fuse` | `83–100`, `1728–1810`, early return `1944–1947` | **not taken** (`use_ref` and q4_0) | q6_K **would** take it if `use_ref` were false; harness sets `use_ref` so **not taken**. q8_0 not K-quant | portable C wrapping `vec_dot` |
| fused MoE SwiGLU FFN | `3303+`, `try_fuse_ops` `3835–3854` | no (`GGML_OP_MUL_MAT_ID` alone is not that 5-node span) | no | portable C |
| `GGML_MOE_REPACK_TRACE` / profile (`8d3c2ea75`) | `370–395`, `2026–2031` | fprintf only if env set; does not change compute | same | portable C |
| graph_plan extra FFN scratch on `MUL_MAT_ID` | `3164–3170` | **reaches** every `MUL_MAT_ID` plan (adds bytes). Comment: leftover harmless. Stock terms (`3155–3163`) are **identical** to merge-base `2844–2853`. Larger work buffer, not a different gather | same, all types | portable C |
| naive `one_chunk` / grouping | `1685–1703`, `1924–1933` | **yes, this is the judge** | yes | portable C; **unmodified vs merge-base** |
| ARM `vec_dot_q4_0_q8_0` | `arch/arm/quants.c:297` | yes (`nrc=1` from `one_chunk:1706`) | q4_0 only | **ARM only**. Unchanged vs merge-base. Cleared as *shared* machinery by dense q4_0 GEMV 46/46 |
| `CPU_REPACK` extra (`repack.cpp`) | `4528–4724`, `4791–4806` | **not allocated** by this harness (default host buft). Would, if used, cover q4_0 and also q8_0/q6_K on NEON+i8mm — would **not** spare those controls | ARM/x86 via `ggml_cpu_has_*` | unchanged vs merge-base |

**No smoking gun hunk on the path the 12-case harness actually runs.** The campaign edits either (a) do not fire (`use_ref`, q4_0 not K-quant, no extra buft, no FFN fuse) or (b) only enlarge the work buffer. The mapping the GLUE mirror copies is pristine. `8d3c2ea75` is observation, not arithmetic.

That does **not** prove the device CPU output equals the semantic — only that a Kalsa *delta* in `ggml/src/ggml-cpu` is a weak explanation. The judge-swap (pristine `ggml/src/ggml-cpu` + our OpenCL) is the empirical closer.

### PC x86 control (bounded; does **not** clear ARM)

`tests/test-cpu-mmid-semantic.cpp` (uncommitted), `use_ref=true`, default CPU buft, one of the 12 shapes plus bcast, plus q8_0/q6_K. Built in `build-llama-pc` (AVX2). Features: `avx2=1 neon=0 i8mm=0`.

| type | shape | nmse vs dequant+double-dot | max_ae | buft |
|---|---|---:|---:|---|
| q4_0 | 4×1, m=512, k=256 | 1.52e-5 | 0.027 | CPU extra=0 |
| q4_0 | 4×4 bcast | 1.39e-5 | 0.037 | CPU extra=0 |
| q8_0 | 4×1 | 1.44e-5 | 0.035 | CPU extra=0 |
| q6_K | 4×1 | 1.51e-5 | 0.031 | CPU extra=0 |

`n_fail=0` at the 5e-4 harness threshold. Residual is q8_0-of-activations vs F32 semantic, **not** ERR ~0.4. This is x86 `vec_dot` only.

### Runtime flag to disable REPACK / i8mm?

- `GGML_CPU_REPACK` is **compile-time** (`ggml/CMakeLists.txt:152`, default ON; s3oracle cache `GGML_CPU_REPACK:BOOL=ON`). No env to turn extra bufts off inside `test-backend-ops`.
- `llama` has `no_extra_bufts` (`common.h:583`); **not** used by `test-backend-ops`.
- i8mm in `vec_dot_q4_0` is `#if defined(__ARM_FEATURE_MATMUL_INT8)` compile-time; `one_chunk` passes `nrc=1` so the `nrc==2` i8mm matmul block (`quants.c:315–385`) is skipped anyway; nrc=1 is NEON/dotprod/SVE. No cheap runtime “repack off → snaps to semantic” knob for this harness.

### JUDGE-SWAP + f1/f2 (next, no extra review)

Session A: Android build of this branch with `ggml/src/ggml-cpu` at `22b69b6e9`; OpenCL sources = `bcdbc9ed6`. 12-case filter twice; q8_0 / q6_K / dense q4_0 controls. Hypothesis: 12/12 PASS.

Session B: campaign judge (`25044c5a…`) + `test-backend-ops.cpp:1485–1487` printer. Dump `f1` (OpenCL) / `f2` (CPU). Offline: `f1` vs semantic vs `f2`; row-resolved (uniform vs boundary blocks). Per-shape ERR already known data-dependent from run9/run10.

---

## RESTORE FIX PLAN — Adreno MoE reverse path (design only; not implemented)

This section is the post-round-trip design. It is deliberately separate from the
consumer-oracle verdicts above: `compare_graph_backend` copies the OpenCL weights
through `get_tensor`, so the CPU reference in this test receives a reverse
conversion of the GPU SoA storage. The stored device evidence is
`results/oracle_consumer_s23/roundtrip/roundtrip_AB_stats.log:31,80`:
q4_0 MoE is dirty at `94208/294912` with the GPU producer and
`61440/294912` with `HOST_REPACK=1`; q6_K MoE and dense q4_0 are `0`.
The mismatch signature is qs-only, `got=(want&0x0F)|0xF0`, with `d` and even qs
bytes matching. No source fix is made by this report.

### 1. Blast-radius map

The MoE gate is `ggml-opencl.cpp:6960-6964`: tensor name (`as`, or `ffn` plus
`exps`) and `ne01 % 32 == 0`. The producer/reverse pairs are selected from the
same `program_cvt` kernel family (`ggml-opencl.cpp:1658-1687`). The relevant
`get_tensor` dispatch is listed below.

| quant | MoE producer dispatch | MoE `get_tensor` reverse dispatch | `cvt.cl` reverse idiom | audit status |
|---|---:|---:|---|---|
| q4_0 | `ggml-opencl.cpp:8363-8366` | `ggml-opencl.cpp:9911-9940` → `kernel_restore_block_q4_0_trans4_ns` | `uint4 q_block` → `as_ushort8(q_block)` → `uchar *(&post_block)` at `cvt.cl:376-390`, specifically `382-383` | **affected** |
| q4_1 | `ggml-opencl.cpp:8642-8645` | `ggml-opencl.cpp:10009-10038` → `kernel_restore_block_q4_1_trans4_ns` | same scalar-private alias at `cvt.cl:568-582`, specifically `574-575` | **affected; same defect class** |
| q5_0 | `ggml-opencl.cpp:8772-8775` | `ggml-opencl.cpp:10113-10144` → `kernel_restore_block_q5_0_trans4_ns` | qs reconstruction uses scalar-private `as_ushort8` alias at `cvt.cl:783-797`, specifically `789-790`; qh is already byte-wise at `773-779` | **affected; qh is not the culprit** |
| q5_1 | `ggml-opencl.cpp:8923-8925` | `ggml-opencl.cpp:10217-10249` → `kernel_restore_block_q5_1_trans4_ns` | qs reconstruction uses scalar-private `as_ushort8` alias at `cvt.cl:1014-1028`, specifically `1020-1021`; qh is byte-wise at `1004-1010` | **affected; qh is not the culprit** |
| q4_K | `ggml-opencl.cpp:9344-9346` | `ggml-opencl.cpp:10529-10562` → `kernel_restore_block_q4_k_trans4_ns` | `uint4 qv[8]` then `uchar *qv_bytes=(uchar *)qv` at `cvt.cl:1125-1139`, with the array declared at `1125` | **safe idiom; no restore fix** |
| q5_K | `ggml-opencl.cpp:9497-9499` | `ggml-opencl.cpp:10639-10672` → `kernel_restore_block_q5_k_trans4_ns` | `uint4 qv[8]` then array byte alias at `cvt.cl:1266-1280`, specifically `1274`; qh is explicit bit packing at `1244-1257` | **safe idiom; no restore fix** |
| q6_K | `ggml-opencl.cpp:9616-9647` | `ggml-opencl.cpp:10747-10783` → `kernel_restore_block_q6_k_trans4_ns` | `uint4 qlv[8]` plus `uchar *qlv_bytes=(uchar *)qlv` at `cvt.cl:1395-1413`, specifically `1403`; qh uses an array of `uint` at `1417-1433` | **safe control; measured clean** |
| mxfp4 | `ggml-opencl.cpp:9057-9060` | `ggml-opencl.cpp:10333-10357` → `kernel_restore_block_mxfp4_trans4_ns` | scalar-private `uint4 q_block` → `as_ushort8` → `uchar *(&post_block)` at `cvt.cl:1605-1620`, specifically `1612-1613` | **affected; same defect class** |
| iq4_nl | no MoE `*_trans4_ns` producer; `ggml-opencl.cpp:9242-9246` selects generic or `*_noshuffle` | `ggml-opencl.cpp:10454-10494` selects `kernel_restore_block_iq4_nl_noshuffle`, otherwise `10497-10516` selects generic | direct global byte copy at `cvt.cl:2339-2357`, or byte-wise no-shuffle unpack at `2384-2405` | **present but outside the MoE trans4 blast radius; safe** |

The source-wide discriminator is unambiguous: the only `as_ushort8`/private
`uchar*` restore occurrences are `cvt.cl:382-383`, `574-575`, `789-790`,
`1020-1021`, and `1612-1613`. The K-quant restores instead alias an ARRAY
(`cvt.cl:1133`, `1274`, `1403`), the qh paths are explicit byte/bit assembly,
and IQ4_NL is byte-wise. Thus q4_1/q5_0/q5_1's historical ERRs around
`0.09-0.11` are not evidence for a separate layer: their reverse kernels use
the same miscompiled idiom as q4_0. Their smaller scalar ERR is a quant/layout
and error-metric effect until a corrected round-trip proves otherwise. If q4_K
or q5_K still fails after a clean reverse round-trip, that is a separate
consumer/dispatch investigation; this restore audit does not implicate them.

The non-MoE fallbacks are not this blast radius. For example, q4_0 goes direct
AoS for non-SoA tensors at `ggml-opencl.cpp:9897-9905`, and its ordinary
Adreno path selects `kernel_restore_block_q4_0_noshuffle` at `9961-9979`.
The analogous q4_1/q5_0/q5_1/q4_K/q5_K/q6_K no-shuffle selections are at
`10040-10082`, `10146-10186`, `10252-10297`, `10564-10602`,
`10674-10717`, and `10785-10835`. They must remain controls, not be changed
as part of the MoE trans4 fix.

### 2. Minimal fix proposal per affected kernel

For q4_0, q4_1, q5_0, q5_1, and mxfp4, keep the existing offsets, scale/m
loads, qh copy, and output writes. Replace only the scalar private temporary
and its `as_ushort8` cast with an array-backed byte view:

```c
uint4 q_block[1];
q_block[0].x = src_q[src_q_offset];
q_block[0].y = src_q[src_q_offset + ne01];
q_block[0].z = src_q[src_q_offset + 2 * ne01];
q_block[0].w = src_q[src_q_offset + 3 * ne01];
uchar * packed = (uchar *) q_block;

for (int i = 0; i < QK / 4; ++i) {
    uchar lo = packed[i];
    uchar hi = packed[i + QK / 4];
    dst_qs[2 * i + 0] = (lo & 0x0F) | ((hi & 0x0F) << 4);
    dst_qs[2 * i + 1] = ((lo & 0xF0) >> 4) | (hi & 0xF0);
}
```

Here `QK` is `QK4_0`, `QK4_1`, `QK5_0`, `QK5_1`, or `QK_MXFP4`, and
`dst_qs` is `b->qs`. This is the q6_K-style safe idiom: the byte pointer is
over an ARRAY, not over a scalar vector produced by `as_ushort8`. It is the
exact inverse of the producer contract documented at `cvt.cl:323-329` and
repeated for q4_1/q5_0/q5_1/mxfp4 at `512-519`, `710-720`, `939-949`, and
`1550-1559`: output word `floor(k/8)` contains value `k` in nibble `k%8`.
The source `q_block` values are loaded in word order, so `packed[i]` and
`packed[i+QK/4]` recover the low/high halves without changing the layout.

Do not change qh, d, m/e, or the K-quant/q6_K array-backed restores. Do not
add `printf`, `-cl-opt-disable`, or another compiler-option workaround: the
prior measurements already killed those routes (PLAN.md:1182-1189), and the
source evidence points to the alias shape.

### 3. S23 retrial matrix (list only; do not run from this session)

1. **Round-trip gate, restore-only.** Run the stored q4_0 MoE fixture
   `ne=256x512x4` with `HOST_REPACK=1` (contract-correct producer), then
   `set_tensor → get_tensor → memcmp`: expected **0 mismatches**; `d` and all
   qs bytes must match. Keep q6_K MoE and dense q4_0 as `0` controls. With the
   current GPU byte-wise convert, a correct restore is expected to expose the
   producer-side contract violation already measured in the same fixture:
   **`94208/294912`**, with `got=(want&0x0F)|0xF0`; this is not a restore failure.
   The old broken restore produced `61440/294912` under HOST_REPACK=1 and must
   disappear.

2. **q4_0 e2e recheck.** `HOST_REPACK=1`, the existing 12-case
   `MUL_MAT_ID`, q4_0, `n=1` filter: expected **12/12 PASS**. This is the
   direct test of the causal chain `graph_copy → OpenCL get_tensor → CPU
   reference`; it does not claim that the GPU producer is fixed.

3. **Historical BITSELECT producer revival.** No BITSELECT source is present
   in the current tree, the current stash, or recent `cvt.cl` history; the
   recoverable record is the experiment registry in PLAN.md:1235,
   `1254`, and `1307-1314`. Reconstruct it from the same contract rather than
   copying an unverified old blob: for every producer output byte use the
   equivalent operations

   ```c
   lo = bitselect((uchar)(x0 & 0x0F), (uchar)((x1 & 0x0F) << 4), (uchar)0xF0);
   hi = bitselect((uchar)((x0 & 0xF0) >> 4), (uchar)(x1 & 0xF0), (uchar)0xF0);
   ```

   and retain the byte-wise trans4 stores and qh handling. Label this a
   reconstruction, not recovery of the historical implementation. Run with
   GPU convert and the corrected restore; expected result is **PASS**, with
   round-trip byte equality. If it fails, split producer/readback/consumer
   attribution before interpreting e2e ERR.

4. **Full quantized MUL_MAT_ID matrix.** Repeat with `HOST_REPACK=1` over
   q4_0, q4_1, q5_0, q5_1, q4_K, q5_K, mxfp4, q6_K, q8_0, and IQ4_NL where the
   harness exposes it. Acceptance is zero new failures and, for the MoE
   trans4 set, a byte-clean weight round-trip. Expected controls are q6_K
   MoE **3/3** and q8_0 **75/75**. Then run the GPU-convert arm separately:
   current byte-wise producer is expected to retain its contract mismatch;
   only the contract-correct producer (BITSELECT reconstruction or an
   equivalent producer fix) should be expected to give all-pass e2e.

5. **Dense regression.** Run the established dense suite and compare the
   exact failing set, not only the aggregate: expected historical baseline is
   **915 OK / 10 FAIL**, all ten the known flat dense q6_K path
   (`PLAN.md:1153-1159`). The restore change must not alter dense q4_0 or any
   direct-AoS path.

6. **Honest re-grounding of the historical −55%.** Preserve the measured
   numbers as historical observations, but remove their causal label. The
   `9dc1ec0cb` deltas (q4_0 −54.5%, q4_1 −56.1%, mxfp4 −52.9%, q5_0/q5_1
   −54.7/−43.8%) were obtained while the test's CPU copy could be poisoned by
   `get_tensor`; they are not a clean measurement of a consumer fix. Re-run
   baseline, corrected restore, `HOST_REPACK=1`, and contract-correct GPU
   producer arms, paired by case name, and report separately: (a) producer
   byte correctness, (b) reverse byte correctness, and (c) e2e correctness.
   Until that re-grounding, call −55% an **unattributed historical delta**,
   not a shipped kernel gain or proof that the consumer was the binding
   defect.

### 4. Paper trail to re-ground (no edits in this task)

If the independent forensic audit confirms this restore attribution, the
following records contain claims that become false or materially misleading:

- `PLAN.md:1045-1073` — “all narrow MoE kernels are broken” and the inference
  that the production MoE compute kernel, rather than the test reverse path,
  is the guilty component.
- `PLAN.md:1075-1107` — the claim that the byte-wise producer is byte-exact
  with an exact MoE round-trip; the current round-trip proves the producer and
  restore must be audited as a pair. The q4_K/q5_K “old layout already right”
  conclusion remains supported, but is not evidence that all restores are
  safe.
- `PLAN.md:1111-1168` — “A is closed and explains half; a second cause remains
  in the consumer.” A was a real producer-side issue, but the residual test
  error is not thereby a consumer compute defect; the second named cause is
  `get_tensor` restore.
- `PLAN.md:1174-1208` — “the convert is exhausted” and the conclusion that
  host-repack isolates a consumer. The producer arm still needs a contract
  clean-up after the restore is fixed; host-repack isolated the reverse path,
  not the consumer.
- `PLAN.md:1213-1259` — the “consumers are broken” verdict, the
  `HOST_REPACK=1` proof, and the proposed consumer-first order. The 0.4497
  result was measured against a reference fed by a dirty reverse conversion;
  replace this block with the three-way producer/restore/consumer matrix.
- `PLAN.md:1281-1324` — the −55% causal story, “mechanism measured” as a
  consumer shift/sign-smear, and the claim that BITSELECT's e2e worsening
  proves the buffer is not the cause. The layout contract itself survives;
  the attribution and the unresolved paradox do not.
- `PLAN.md:396-422` and `424-448` — the cross-tree “consumer miscompile” and
  “CPU judge is principal suspect” narratives. The upstream A7X gate remains
  relevant, but the test judge was fed corrupted bytes by OpenCL `get_tensor`;
  this is not evidence of a CPU arithmetic or production-GEMV defect.
- `PLAN.md:455-519` and `549-620` — the Qwen rounds' remaining-byte-divergence
  and “possible separate q4_1/q5 layer” claims. q4_1/q5_0/q5_1 share the same
  restore idiom; q4_K/q5_K remain safe-restore controls, not instances of it.

`docs/ALIVE.md:427-471` needs a corresponding rewrite: its headline says the
“real defect” is in compiled consumers; its table presents the −55% as the
shipped fix; and `447-459` says two independent defects are producer plus
consumer. The facts to retain are the measured historical deltas, the q8_0 /
q6_K controls, and the layout contract. The facts to replace are “every narrow
quant is numerically wrong in production,” “HOST_REPACK proves the consumer,”
and the consumer-side next-step order.

The owner also named a memory record `adreno-moe-two-defects`. No file with
that name is present in this workspace, and the local file-backed memories DB
contains no matching record; if that external record exists, its claim to
rewrite is exactly “producer + consumer compute defects” → “producer contract
issue + `get_tensor` reverse-restore defect,” with q6_K/q4_K/q5_K as controls.

---

## RETRIAL PRE-REGISTRATION — restore fix (PC analysis; no device result)

This section was written before the patched library is run on an Adreno device.
It fixes the numerical and probatory expectations in advance so that a later
round-trip or end-to-end result cannot be relabeled after it is seen. The 12
shapes below are the q4_0, `n=1`, `m=512`, `k=256` Cartesian product in
`tests/test-backend-ops.cpp`: `n_mats in {4,8}`, `n_used in {1,2,4}`, and
`bcast in {false,true}`.

### 1. Closed-form q4_0 NMSE from the restore-poisoning model

Model assumptions are explicit: q4_0 codes are iid uniform on
`n in {0,...,15}`, activations are independent and zero-mean, the scale `d`
is common within a block, and the measured Adreno trigger poisons one half of
the poison-capable positions. These assumptions describe the deterministic
round-trip fixture exactly at the byte-frequency level and give a
pre-registered expectation, not a claim that finite quantized test rows have
perfectly uniform codes.

An AoS q4_0 block has 32 weight values and 16 `qs` bytes. The high nibble of
each odd `qs` byte is poison-capable: 8 values per block. On a trigger, its
q4_0 code becomes `0xF`, hence the weight becomes

```
q' d = (0xF - 8) d = 7 d.
```

The HOST_REPACK round-trip fixture contains

```
Nblock = 256 * 512 * 4 / 32 = 16,384 blocks
Ncand  = 16,384 * 8         = 131,072 odd-qs high-nibble candidates.
```

For the fixture's uniform nibble pattern, a poisoned byte is visibly different
only when its wanted high nibble is not already `0xF`. Therefore

```
P(visible mismatch | candidate)
    = P(trigger) * P(wanted high nibble != 0xF)
    = (1/2) * (15/16) = 15/32,

visible mismatches = 131,072 * 15/32 = 61,440,
poisoning events   = 131,072 * 1/2   = 65,536,
invisible poisons  = 65,536 * 1/16  = 4,096.
```

Thus mismatch-count is not poisoning-count: the observed `61,440` is exactly
`65,536 - 4,096`. Equivalently, each affected byte offset has
`7,680/16,384 = 15/32` visible mismatches. This arithmetic is for q4_0; q5_0
and q5_1 have independent `qh` bits and their byte signatures must be measured
by the per-type sweep rather than extrapolated from this result.

For one unpoisoned q4_0 value, `q = n - 8`, so

```
E[q^2] = (sum_{q=-8}^{7} q^2) / 16 = 344/16 = 21.5.
```

For a poisoned value, `delta q = 7 - q = 15 - n`, hence

```
E[(delta q)^2 | poisoned]
    = (sum_{n=0}^{15} (15-n)^2) / 16
    = 1240/16 = 77.5.
```

The poisoning fraction over all weight values is
`(8/32) * (1/2) = 1/8`. With independent zero-mean activations, cross terms
vanish and `d^2` plus the activation variance cancel between error energy and
signal energy. The expected output NMSE is therefore

```
E[NMSE] = ((1/8) * 77.5) / 21.5
        = 1240 / (8 * 344)
        = 0.4505813953.
```

The prediction is identical for all 12 shapes because each has `k=256` and
the routing/broadcast choice changes which iid row/activation column is used,
not the per-dot energy ratio:

| n_mats | n_used | bcast | expected NMSE |
|---:|---:|:---:|---:|
| 4 | 1 | false | 0.45058 |
| 4 | 1 | true  | 0.45058 |
| 4 | 2 | false | 0.45058 |
| 4 | 2 | true  | 0.45058 |
| 4 | 4 | false | 0.45058 |
| 4 | 4 | true  | 0.45058 |
| 8 | 1 | false | 0.45058 |
| 8 | 1 | true  | 0.45058 |
| 8 | 2 | false | 0.45058 |
| 8 | 2 | true  | 0.45058 |
| 8 | 4 | false | 0.45058 |
| 8 | 4 | true  | 0.45058 |

`0.45058` lands inside the observed per-case `0.36-0.70` band and at its
historical mean near `0.45`; the poisoning model therefore does not require a
second contributor. Pre-registered falsifier: if the exact judge-consumed-byte
replay below systematically falls outside that band or cannot reproduce the
reported ERR, record **second contributor suspected** and do not widen or
retune this model post hoc.

### 2. Intermediate state: fixed restore plus current byte-wise producer

With the new restore and the default producer (`GGML_OPENCL_CVT_VARIANT`
unset), the original-byte round-trip is expected to remain dirty at
**approximately `94,208/294,912`, to be re-measured**. This is deliberately a
soft expectation: `94,208` was measured while the old restore was also broken,
so it is neither a proof nor a bound for the corrected inverse. A zero result
in this arm would contradict the prior producer attribution and must be
investigated rather than celebrated.

The pre-registered end-to-end direction is **downward toward PASS**, even if
the original-byte round-trip remains dirty. `compare_graph_backend` copies the
OpenCL weight into the CPU graph through `get_tensor`; a correct restore is the
inverse of the same SoA contract consumed by GEMV/GEMM, so the CPU judge should
receive the AoS representation of the values the GPU actually consumed. Such
a PASS proves producer/consumer internal consistency, not preservation of the
original model bytes. The contract-correct BITSELECT arm is still required for
the stronger result: byte-clean round-trip *and* e2e PASS. If the restore-only
state instead stays near `0.18`, worsens toward `0.45`, or otherwise remains
red, the producer/consumer/restore inverse assumption is falsified and a
second contributor is suspected.

Pre-registered byte matrix:

| arm | original-byte round-trip | e2e direction |
|---|---:|---|
| fixed restore + HOST_REPACK q4_0 | 0 | PASS |
| fixed restore + default byte-wise producer | about 94,208, re-measure | improve toward PASS; not proof of byte correctness |
| fixed restore + reconstructed BITSELECT producer | 0 for all five affected types | PASS |
| q4_K / q5_K / q6_K and dense controls | 0, no regression | unchanged |

Every round-trip sweep must set `GGML_OPENCL_LOG_WEIGHT_PATH=1` and retain the
`OPENCL_WEIGHT_PATH{...}` line. The five affected MoE cases and the K controls
must say `path=trans4-moe,moe_gate=1`; the 512-wide dense q4_0 control must say
`path=noshuffle,moe_gate=0`. A missing or different path line voids the case
instead of being explained after the result.

### 3. f1/f2 probatory run: two-point calibration

This is an evidentiary requirement, not optional diagnostics. Use a pristine
CPU judge binary (the unmodified merge-base CPU implementation) so the proof
does not share the campaign's semantic mirror or optimized helper. For one
previously failing q4_0 case, persist with hashes: the exact weight bytes
consumed by the judge, ids, src1, `f1` (OpenCL output), `f2` (CPU output), and
the harness-reported ERR inputs.

The two calibration points are pre-registered as follows:

1. **Poisoned-byte point.** Feed the exact dumped judge-consumed poisoned
   bytes, ids, and src1 to the pristine judge. Independently recompute the
   output and the test's NMSE. The recomputed output must match the dumped
   `f2`, and the re-derived ERR must reproduce the observed FAIL (including
   its per-row pattern) within floating-point tolerance.
2. **Clean-byte point.** Replace only the weights with the clean original /
   BITSELECT-round-tripped bytes, keeping ids and src1 fixed. The pristine
   judge must then match `f1` and cross the existing threshold to PASS.

Both points are required. A one-point replay can fit a shared bug and does not
close the forensic audit's final link. The offline NMSE implementation must be
independent of the instrumented test callback; hashes and element counts must
be checked before any numerical comparison.

### 4. Explicitly deferred production obligation

The BMoE-engine production smoke is **not performed in this PC-only task** and
remains open for the later authorized device session. Its acceptance protocol
is fixed now:

- add an enqueue shim that records kernel names during a real fixed-prompt
  BMoE inference; none of the five `kernel_restore_block_*_trans4_ns` kernels
  may appear when `use_extra_bufts=false`;
- log the buffer/storage path that receives each MoE weight; and
- run patched/unpatched fixed-prompt logits A/B with identical model, prompt,
  and runtime settings. Any logits delta falsifies “production is unaffected”
  and blocks that claim even if the test harness becomes green.

Until this smoke is executed, the bounded claim is only source-level:
the restore kernels are dispatched by quantized `get_tensor`, a path not
expected during production inference. It is not yet a measured engine claim.

### 5. PC build record for hostile review

Committed implementation: `eaec5d884` on `kalsa/kernel-s3-repack` (stacked
after inherited harness commit `5cc6f2bd5`). No device command was run.

The existing `build-android-opencl-s3oracle` Release configuration successfully
built targets `ggml-opencl`, `test-backend-ops`, and
`test-opencl-moe-roundtrip` after the commit. NDK clang 18 also accepted
`cvt.cl` with `-cl-std=CL3.0 -fsyntax-only` in both the default arm and with
`-DGGML_OPENCL_CVT_BITSELECT=1` (`rc=0` for both).

Final library record:

```
path:   build-android-opencl-s3oracle/bin/libggml-opencl.so
sha256: 9198f38779db531c92818a9d7b23ba0d471df1d95aba1498b61c9cbf1d07f43c
size:   7,965,240 bytes
mtime:  2026-08-19T18:04:43.8725188-04:00
        2026-08-19T22:04:43.8725188Z
```

An additional unrestricted `all`-targets build was attempted and stopped in
the unrelated pre-existing Android test target `test-chat.cpp` because its
cached include path cannot find `mtmd.h`. The OpenCL library and new harness
had already built successfully; the targeted post-commit build above is green.
No unrelated test/CMake repair was folded into this surgical change.
