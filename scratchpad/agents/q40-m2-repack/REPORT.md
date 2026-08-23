# Q40 M2 — Q2_K_8x4 / Q3_K_8x4 NEON dotprod GEMV

Status: M2 done. Host PASS (generic). Jelly Star PASS (NEON+dotprod). Branch pushed. M3 not started.

Fork worktree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-repack-q23k`
Branch: `kalsa/repack-q23k` at `e4ae879aa` (base `1882bf8cd`)
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`

M0 report: `scratchpad/agents/q40-m0-repack/REPORT.md`
M1 report: `scratchpad/agents/q40-m1-repack/REPORT.md`

## What landed

Q2_K_8x4 and Q3_K_8x4 GEMV (`M==1`) with q8_K activations:

- Q2: `acc += dx * (d * scale * dot(q,x) - dmin * min * bsum)`, `q` in 0..3, `scale = sm & 0xf`, `min = sm >> 4`.
- Q3: `acc += dx * d * s * (dot(q,x) - 4 * bsum)`, `s = scale_code - 32`, `q = low2 | (high << 2)` reconstructed in registers (never materialized as int8 `q-4`).
- Signed `sdot` into int32; scale/min widened before multiply; integer accumulators flushed per 256-superblock into fp32.
- ARM path: `arch/arm/repack.cpp` under `__aarch64__ && NEON && DOTPROD` (armv8.2-a+dotprod, no i8mm).
- x86 / no-dotprod: generic scalar GEMV via `arch-fallback.h` aliases.
- Trait dispatch: 2-D `MUL_MAT` with `src1->ne[1]==1` only. GEMM stays false (M3). 3-D `MUL_MAT_ID` stays declined (M4).
- Packed offsets use `sizeof(block_q*_K_8x4)`, not native `nb[1]` (Q3 tile 912 B vs native 8*110=880 B).

## Files

| File | Change |
|---|---|
| `ggml/src/ggml-cpu/arch/arm/repack.cpp` | NEON dotprod GEMV kernels after the Q4_K 8x4 family. |
| `ggml/src/ggml-cpu/repack.cpp` | Generic GEMV, `gemv<>` specializations, `work_size`/`compute_forward` M==1 path, `supports_op` GEMV accept. |
| `ggml/src/ggml-cpu/repack.h` | GEMV + generic declarations. |
| `ggml/src/ggml-cpu/repack-q23k.h` | Internal GEMV decls for the test (still not public ABI). |
| `ggml/src/ggml-cpu/arch-fallback.h` | x86/etc. aliases generic → `ggml_gemv_q{2,3}_K_8x4_q8_K`. |
| `tests/test-repack-q23k-m2.cpp` | Geometry pin + GEMV-vs-oracle grid + thread identity. |
| `tests/CMakeLists.txt` | Registers the test with `ggml/src` include path. |

## Commits

```
0540f2fd7 ggml: add Q2_K/Q3_K 8x4 GEMV kernels and M==1 dispatch
e4ae879aa tests: add M2 Q2_K/Q3_K 8x4 GEMV-vs-oracle harness
```

Pushed `baaa5a355..e4ae879aa` to `origin/kalsa/repack-q23k`.

## Build

Host (x86, generic GEMV): `moe-experiments/build-repack-q23k-pc`

Android (Jelly target, A76-class, dotprod-only):

| | |
|---|---|
| dir | `moe-experiments/build-android-repack-q23k-m2` |
| NDK | 27.1.12297006 |
| cmake | 3.22.1 (NDK toolchain) |
| ABI | arm64-v8a |
| platform | android-29 |
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+fp16` (i8mm **off**) |
| `BUILD_SHARED_LIBS` | OFF |
| binary | `bin/test-repack-q23k-m2` |
| size | 8730720 |
| sha256 | `D74D93B5B5FBA95A95018872B4CC7EB4058186B4A043CA3E92DA5C017FF133BA` |

## Device protocol (Jelly Star only)

- Device: `192.168.1.82:35785` product `Jelly_Star` (A76-class, dotprod, no i8mm = v1 target).
- `adb -s 192.168.1.82:35785 shell input keyevent KEYCODE_WAKEUP` before the run.
- Push dest: `/data/local/tmp/kalsarepack` (new dir). LF-only payloads.
- SHA verified both sides: host `Get-FileHash` and device `sha256sum` both `d74d93b5…133ba`.
- First exec failed with `CANNOT LINK EXECUTABLE: library "libomp.so" not found`. Pushed NDK aarch64 `libomp.so` next to the binary and ran with `LD_LIBRARY_PATH=.`. That is an NDK OpenMP runtime dep, not a kernel bug.
- S23 (`adb-R3CW406P8CV`) was attached; **not used**. Xiaomi not touched.
- Full output pulled to `results/repack_q23k/m2_jelly/`.

Post-run re-check (wakeup + sha only, 2026-08-23):

```
d74d93b5b5fba95a95018872b4cc7eb4058186b4a043ca3e92da5c017ff133ba  /data/local/tmp/kalsarepack/test-repack-q23k-m2
total 9744
-rw-rw-rw- 1 shell shell 1229304 2026-04-29 08:39 libomp.so
-rw-rw-rw- 1 shell shell    3382 2026-08-23 15:02 m2.out
-rwxr-xr-x 1 shell shell 8730720 2026-08-23 15:01 test-repack-q23k-m2
DEVICE_RC=0
```

## Geometry pin (M1 residual)

Independent of the dequant oracle. Q2_K `ne0=512`, `ne1=8`, `ne2=3`:

```
tile_bytes = 672
n_tiles    = (ne1/8)*(ne0/256) = 1*2 = 2
payload    = 2*672 = 1344
stride     = (1344 + 63) & ~63 = 1344
e=2 base   = 2 * 1344 = 2688
t=1 offset = 2688 + 1*672 = 3360
```

Packer 3-D slice at that offset matches a 2-D pack of expert 2's second K-block (`memcmp`). GEMV grid includes `ne2=3`, so kernel-vs-oracle also walks `base + e * stride`.

## Host output (x86, neon=0)

Generic GEMV vs dequant-fp32 oracle. Thread-identity skipped (8x4 not selected without neon+dotprod). Full copy: `scratchpad/agents/q40-m2-repack/test-output-host.txt`.

```
M2 GEMV starting
M2 GEMV host neon=0 dotprod=0
kernel vs dequant-fp32(W)*dequant-fp32(q8_K(A)); tol = 1e-4*(1+max|ref|)
== geometry pin ==
  ok Q2 e=2 t=1 offset=3360 (stride=1344 tile=672)
== GEMV vs fp32 dequant-dot ==
  ... 108/108 ok (Q2+Q3 × ne0 256/512/1024 × ne1 8/16/32 × ne2 1/3 × pattern/neg-bsum/random) ...
== thread identity (ggml graph M==1) ==
  skip: host has no neon+dotprod (8x4 not selected)

RESULT: PASS
```

Host oracle is **not** a tautology against the NEON kernel: the reference is dequantized-fp32(W) dotted with dequantized-fp32(q8_K(A)) in fp64, not a second walk of the generic GEMV.

## Raw device output (Jelly)

Full copy: `scratchpad/agents/q40-m2-repack/test-output-jelly.txt` and `results/repack_q23k/m2_jelly/m2.out`.

The last line `RC=True` is a PowerShell `$?` artifact from the wrapper (success). The test binary itself printed `RESULT: PASS` (exit 0).

```
M2 GEMV starting
M2 GEMV host neon=1 dotprod=1
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q2_K_8x4
repack: repack tensor  with q2_K_8x4
kernel vs dequant-fp32(W)*dequant-fp32(q8_K(A)); tol = 1e-4*(1+max|ref|)
== geometry pin ==
  ok Q2 e=2 t=1 offset=3360 (stride=1344 tile=672)
== GEMV vs fp32 dequant-dot ==
  ok pattern q2_K 256x8x1
  ok neg-bsum q2_K 256x8x1
  ok random q2_K 256x8x1
  ok pattern q2_K 256x8x3
  ok neg-bsum q2_K 256x8x3
  ok random q2_K 256x8x3
  ok pattern q2_K 256x16x1
  ok neg-bsum q2_K 256x16x1
  ok random q2_K 256x16x1
  ok pattern q2_K 256x16x3
  ok neg-bsum q2_K 256x16x3
  ok random q2_K 256x16x3
  ok pattern q2_K 256x32x1
  ok neg-bsum q2_K 256x32x1
  ok random q2_K 256x32x1
  ok pattern q2_K 256x32x3
  ok neg-bsum q2_K 256x32x3
  ok random q2_K 256x32x3
  ok pattern q2_K 512x8x1
  ok neg-bsum q2_K 512x8x1
  ok random q2_K 512x8x1
  ok pattern q2_K 512x8x3
  ok neg-bsum q2_K 512x8x3
  ok random q2_K 512x8x3
  ok pattern q2_K 512x16x1
  ok neg-bsum q2_K 512x16x1
  ok random q2_K 512x16x1
  ok pattern q2_K 512x16x3
  ok neg-bsum q2_K 512x16x3
  ok random q2_K 512x16x3
  ok pattern q2_K 512x32x1
  ok neg-bsum q2_K 512x32x1
  ok random q2_K 512x32x1
  ok pattern q2_K 512x32x3
  ok neg-bsum q2_K 512x32x3
  ok random q2_K 512x32x3
  ok pattern q2_K 1024x8x1
  ok neg-bsum q2_K 1024x8x1
  ok random q2_K 1024x8x1
  ok pattern q2_K 1024x8x3
  ok neg-bsum q2_K 1024x8x3
  ok random q2_K 1024x8x3
  ok pattern q2_K 1024x16x1
  ok neg-bsum q2_K 1024x16x1
  ok random q2_K 1024x16x1
  ok pattern q2_K 1024x16x3
  ok neg-bsum q2_K 1024x16x3
  ok random q2_K 1024x16x3
  ok pattern q2_K 1024x32x1
  ok neg-bsum q2_K 1024x32x1
  ok random q2_K 1024x32x1
  ok pattern q2_K 1024x32x3
  ok neg-bsum q2_K 1024x32x3
  ok random q2_K 1024x32x3
  ok pattern q3_K 256x8x1
  ok neg-bsum q3_K 256x8x1
  ok random q3_K 256x8x1
  ok pattern q3_K 256x8x3
  ok neg-bsum q3_K 256x8x3
  ok random q3_K 256x8x3
  ok pattern q3_K 256x16x1
  ok neg-bsum q3_K 256x16x1
  ok random q3_K 256x16x1
  ok pattern q3_K 256x16x3
  ok neg-bsum q3_K 256x16x3
  ok random q3_K 256x16x3
  ok pattern q3_K 256x32x1
  ok neg-bsum q3_K 256x32x1
  ok random q3_K 256x32x1
  ok pattern q3_K 256x32x3
  ok neg-bsum q3_K 256x32x3
  ok random q3_K 256x32x3
  ok pattern q3_K 512x8x1
  ok neg-bsum q3_K 512x8x1
  ok random q3_K 512x8x1
  ok pattern q3_K 512x8x3
  ok neg-bsum q3_K 512x8x3
  ok random q3_K 512x8x3
  ok pattern q3_K 512x16x1
  ok neg-bsum q3_K 512x16x1
  ok random q3_K 512x16x1
  ok pattern q3_K 512x16x3
  ok neg-bsum q3_K 512x16x3
  ok random q3_K 512x16x3
  ok pattern q3_K 512x32x1
  ok neg-bsum q3_K 512x32x1
  ok random q3_K 512x32x1
  ok pattern q3_K 512x32x3
  ok neg-bsum q3_K 512x32x3
  ok random q3_K 512x32x3
  ok pattern q3_K 1024x8x1
  ok neg-bsum q3_K 1024x8x1
  ok random q3_K 1024x8x1
  ok pattern q3_K 1024x8x3
  ok neg-bsum q3_K 1024x8x3
  ok random q3_K 1024x8x3
  ok pattern q3_K 1024x16x1
  ok neg-bsum q3_K 1024x16x1
  ok random q3_K 1024x16x1
  ok pattern q3_K 1024x16x3
  ok neg-bsum q3_K 1024x16x3
  ok random q3_K 1024x16x3
  ok pattern q3_K 1024x32x1
  ok neg-bsum q3_K 1024x32x1
  ok random q3_K 1024x32x1
  ok pattern q3_K 1024x32x3
  ok neg-bsum q3_K 1024x32x3
  ok random q3_K 1024x32x3
== thread identity (ggml graph M==1) ==
  ok threads 1/2/4/8 bit-identical

RESULT: PASS
```

## Pass-criteria table

| Criterion | Result | Notes |
|---|---|---|
| Q2/Q3 NEON dotprod GEMV in `arch/arm/repack.cpp` | PASS | Structural twin of Q4_K 8x4 GEMV; fallback `_generic` if no DOTPROD. |
| Math: Q2 `dx*(d*scale*dot - dmin*min*bsum)` | PASS | Pattern + random + negative bsums. |
| Math: Q3 `dx*d*s*(dot-4*bsum)`, `s=code-32` | PASS | `q` reconstructed in registers. |
| sdot int32, widen scale/min, flush per 256 | PASS | Integer sums per superblock then `vfmaq`/`vfmsq` into fp32 acc. |
| q8_K activations, per-16 bsums, quantized once | PASS | `from_float` once; kernel reads `d`, `qs[256]`, `bsums[16]`. |
| `supports_op` 2-D MUL_MAT M==1 | PASS | Trait GEMV wired; graph path on Jelly (4× `repack tensor with q2_K_8x4` in thread test). |
| GEMM unsupported | PASS | `compute_forward` returns false unless `ne[1]==1`. |
| 3-D MUL_MAT_ID declined | PASS | Explicit `return false` for q23k_8x4 in the MUL_MAT_ID branch. |
| GEMV vs dequant-fp32 oracle | PASS | tol `1e-4*(1+max\|ref\|)`. 108/108 on host and Jelly. |
| Random + patterned + negative bsums | PASS | neg-bsum activations in `[-4,-0.1]`. |
| Shapes ne0 256/512/1024, ne1 8/16/32, ne2 1/3 | PASS | `ne2=3` exercises packed slice stride in the kernel. |
| Threads 1/2/4/max bit-identical | PASS | Jelly 1/2/4/8 via ggml graph. Host skipped (no neon). Graph path used Q2 512×16. |
| Geometry pin e=2 t=1 | PASS | Hand offset 3360; packer slice matches 2-D pack of expert 2. |
| Android armv8.2-a+dotprod, no i8mm | PASS | `GGML_CPU_ARM_ARCH=armv8.2-a+dotprod+fp16`. |
| Jelly run, sha both sides, artifacts pulled | PASS | `results/repack_q23k/m2_jelly/`. S23/Xiaomi not touched. |

## Residual (not blockers)

- Graph thread-identity covers Q2 only. Q3 GEMV is checked vs the oracle on the full grid (including `ne2=3`); dispatch uses compile-time `sizeof(block_q3_K_8x4)`.
- ARM inner loop is per-row `sdot` assembled into 8-wide int32, not a fully 8-column fused schedule. Correctness target for M2, not throughput.
- Device binary needs NDK `libomp.so` beside it (`LD_LIBRARY_PATH=.`). Static OpenMP was not forced in this build.
- `RC=True` in `m2.out` is PowerShell `$?`, not the binary's stdout.

M3 (GEMM 8x4 + RHS tails) not started.
