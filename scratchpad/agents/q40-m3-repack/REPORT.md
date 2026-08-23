# Q40 M3 — Q2_K_8x4 / Q3_K_8x4 NEON dotprod GEMM

Status: M2 audit fixes applied. M3 done. Host PASS (generic). Jelly Star PASS (NEON+dotprod). Branch pushed. M4 not started.

Fork worktree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-repack-q23k`
Branch: `kalsa/repack-q23k` at `0992b7a2d` (base `1882bf8cd`)
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`

M0: `scratchpad/agents/q40-m0-repack/REPORT.md`
M1: `scratchpad/agents/q40-m1-repack/REPORT.md`
M2: `scratchpad/agents/q40-m2-repack/REPORT.md`

## DeepSeek M2 audit — two fixes

Kernel math was confirmed (vzip permutation + geometry pin 3360). Two holes closed before GEMM.

### FIX 1 — Q3 thread identity

`test_threads` was Q2-only. It now runs Q2 and Q3, both 512×16 graph, threads 1/2/4/8, `memcmp` bit-identical.

Jelly:

```
== thread identity (ggml graph M==1) ==
  ok q2_K threads 1/2/4/8 bit-identical
  ok q3_K threads 1/2/4/8 bit-identical
```

Host skips (no neon+dotprod, 8x4 not selected). Same as M2.

### FIX 2 — declined extra must not fall through to native

Auditor cite: `ggml-cpu.c:2027-2031`. If `ggml_cpu_extra_compute_forward` returns false, native `mul_mat` runs. A q23k_8x4 extra means the bytes are tiled; native `block_q2_K` / `block_q3_K` walks would be silent wrong output.

**Idiom chosen:** `GGML_ABORT` inside `ggml_cpu_extra_compute_forward` (traits.cpp), not inside the kernel hot loop.

- If `get_tensor_traits` returns a q23k trait and `compute_forward` returns false → abort (`q23k_8x4 extra declined op=%s; refusing native fallthrough on tiled layout`).
- Belt: if `src0->extra` is still a q23k trait after no extra handled the op → abort (`q23k_8x4 tiled src0 reached native compute`).

Why not return a status: `ggml_compute_forward` ignores extra's false as "use native". Why not abort in `ggml_compute_forward` itself: that file should stay generic; the extra path is the exact fallthrough gate.

**Test idiom:** `ggml_set_abort_callback` + `longjmp`. `ggml_abort` always `abort()`s after the callback, so the callback longjmps to keep one binary testable on Jelly without a subprocess death-test. Negative case is 3-D `MUL_MAT_ID` (declined through M3; M4 will enable it). Host without neon never attaches the extra → skip, with a nullptr-helper pin.

Jelly:

```
== declined op on q23k extra must abort (not native garbage) ==
  ok helper: nullptr extra is not q23k
  ok abort on declined MUL_MAT_ID: .../traits.cpp:26: q23k_8x4 extra declined op=MUL_MAT_ID; refusing native fallthrough on tiled layout
```

Three extra copies of the same abort line appear on stderr (other CPU workers hit `GGML_ABORT` before the test thread longjmps). The test still records PASS / RC=0. Not silent native compute.

## M3 what landed

RHS policy from the decisions table:

- `M==1` → GEMV (`block_q8_K`)
- `M % 4 == 0` → GEMM chunks (`block_q8_Kx4` 4×4 interleave)
- other M → GEMM on `M - M%4` rows, GEMV per leftover column (row)

Weight indexing still uses `sizeof(block_q*_K_8x4)`, never native `nb[1]` (Q3 912 vs 880).

`supports_op` accepts 2-D `MUL_MAT` at any M. 3-D `MUL_MAT_ID` stays declined.

Math unchanged: Q2 `dx*(d*scale*dot - dmin*min*bsum)`; Q3 `dx*d*s*(dot-4*bsum)` with `s=code-32`, `q=low2|(high<<2)`.

## Files

| File | Change |
|---|---|
| `ggml/src/ggml-cpu/traits.cpp` | Abort if q23k extra would fall through to native. |
| `ggml/src/ggml-cpu/repack.cpp` | Generic GEMM, `gemm<>` specs, `forward_mul_mat_q23k`, `extra_is_q23k`, any-M `supports_op`. |
| `ggml/src/ggml-cpu/arch/arm/repack.cpp` | NEON dotprod GEMM, reuse GEMV unpack helpers. |
| `ggml/src/ggml-cpu/repack.h`, `repack-q23k.h`, `arch-fallback.h` | GEMM decls + x86 aliases. |
| `tests/test-repack-q23k-m2.cpp` | Q3 threads + abort pin. |
| `tests/test-repack-q23k-m3.cpp` | GEMM grid, graph, threads, #19561 stress. |
| `tests/CMakeLists.txt` | Registers M3 with `ggml/src` include. |

## Commits

```
384174993 ggml: Q2_K/Q3_K 8x4 GEMM and refuse native fallthrough
0992b7a2d tests: M2 Q3 thread pin, native-fallthrough abort, M3 GEMM harness
```

Pushed `e4ae879aa..0992b7a2d` to `origin/kalsa/repack-q23k`.

## Build

Host (x86 generic): `moe-experiments/build-repack-q23k-pc`

Android (same recipe as M2):

| | |
|---|---|
| dir | `moe-experiments/build-android-repack-q23k-m2` |
| NDK | 27.1.12297006 |
| ABI | arm64-v8a, platform 29 |
| `GGML_CPU_ARM_ARCH` | `armv8.2-a+dotprod+fp16` (i8mm **off**) |
| `BUILD_SHARED_LIBS` | OFF |
| m2 sha256 | `15F07E7922C28CE1DDAED5C65B0F390CE66A181035FD3E24B4A93F6A07428660` (8790464) |
| m3 sha256 | `12B57D3B82920EEB9FAF5F4DB4A7E291BDD67AA532D6444F45906A1C2A28BBD7` (8786704) |

Device sha256sum matched both hashes (lowercase). `libomp.so` already in `/data/local/tmp/kalsarepack`; ran with `LD_LIBRARY_PATH=.`. `KEYCODE_WAKEUP` before the run. S23/Xiaomi not touched.

## Host

M2 `RESULT: PASS` (generic GEMV grid + geometry pin; threads/abort skipped).

M3 `RESULT: PASS` — 252/252 kernel cases (`2 types × 3 K × 3 N × 2 ne2 × 7 M`). Graph skipped (no neon).

Full copies: `scratchpad/agents/q40-m3-repack/test-output-m2-host.txt`, `test-output-m3-host.txt`.

ASan/UBSan: not run. Host is MSVC x86; this pin's NDK/Jelly recipe has no sanitizer variant. Kernels use fixed 4×8 stack acc, not VLAs — the #19561 class. Jelly stress M=33 N=64 K=512 passed.

## Raw Jelly M2 (audit rerun)

Full: `results/repack_q23k/m3_jelly/m2.out`. `RC=0` is the device shell `$?`.

```
M2 GEMV starting
M2 GEMV host neon=1 dotprod=1
... 108/108 GEMV vs oracle ok ...
== thread identity (ggml graph M==1) ==
  ok q2_K threads 1/2/4/8 bit-identical
  ok q3_K threads 1/2/4/8 bit-identical
== declined op on q23k extra must abort (not native garbage) ==
  ok helper: nullptr extra is not q23k
  ok abort on declined MUL_MAT_ID: .../traits.cpp:26: q23k_8x4 extra declined op=MUL_MAT_ID; refusing native fallthrough on tiled layout

RESULT: PASS
RC=0
```

## Raw Jelly M3

Full: `results/repack_q23k/m3_jelly/m3.out`. `repack: repack tensor with q*_K_8x4` on stderr is mixed in because the wrapper used `2>&1`.

```
M3 GEMM starting
M3 GEMM host neon=1 dotprod=1
M%4==0 GEMM; tails GEMV; M==1 GEMV; tol = 1e-4*(1+max|ref|)
== GEMM/GEMV kernel vs fp32 dequant-dot ==
  ... 252/252 ok pattern q2_K/q3_K {256,512,1024}x{8,16,32}x{1,3} M={1,2,3,4,5,8,9} ...
== ggml graph GEMM (neon+dotprod) ==
  ok graph q2_K 512x16 M=1
  ok graph q2_K 512x16 M=2
  ok graph q2_K 512x16 M=3
  ok graph q2_K 512x16 M=4
  ok graph q2_K 512x16 M=5
  ok graph q2_K 512x16 M=8
  ok graph q2_K 512x16 M=9
  ok graph q3_K 512x16 M=1
  ok graph q3_K 512x16 M=2
  ok graph q3_K 512x16 M=3
  ok graph q3_K 512x16 M=4
  ok graph q3_K 512x16 M=5
  ok graph q3_K 512x16 M=8
  ok graph q3_K 512x16 M=9
== thread identity GEMM graph M=8 ==
  ok q2_K threads 1/2/4/8 bit-identical
  ok q3_K threads 1/2/4/8 bit-identical
== #19561-style stack stress M=33 N=64 K=512 ==
  ok stress q2_K 512x64 M=33
  ok stress q3_K 512x64 M=33

RESULT: PASS
RC=0
```

## Pass-criteria table

| Criterion | Result | Notes |
|---|---|---|
| M2 Q3 threads 1/2/4/max bit-identical | PASS | Jelly 512×16 graph. Host skip. |
| Declined q23k extra → loud failure, not native garbage | PASS | `GGML_ABORT` in `ggml_cpu_extra_compute_forward`. Negative graph `MUL_MAT_ID`. |
| M=1,2,3,4,5,8,9 vs oracle | PASS | Kernel 252/252 host+Jelly. Graph M set on Jelly. |
| Only M%4==0 uses GEMM; tails GEMV; M==1 GEMV | PASS | `forward_mul_mat_q23k`. M=1,2,3,5,9 exercise tails. |
| K 256/512/1024, N 8/16/32, ne2 1/3 | PASS | Direct kernel on packed slices. |
| #19561-style stack stress | PASS | M=33 N=64 K=512, both types, 4 threads, vs oracle. |
| Thread invariance both types on GEMM graph | PASS | M=8, 1/2/4/8, Q2 and Q3. |
| `supports_op` 2-D MUL_MAT any M | PASS | Graph M=2..9 accepted on Jelly. |
| 3-D MUL_MAT_ID declined | PASS | `supports_op` false + abort if forced. |
| Android armv8.2-a+dotprod, no i8mm | PASS | Same as M2. |
| Jelly sha both sides, artifacts | PASS | `results/repack_q23k/m3_jelly/`. S23 unused. |

## Residual (not blockers)

- Abort test stderr repeats the message from worker threads; main thread longjmps and scores PASS.
- ARM GEMM still per-column `sdot` assembled into 8-wide acc (correctness, not a fused 8×4 schedule).
- Host ASan/UBSan not run (MSVC recipe). Device stress is the stack-smash pin.
- `libomp.so` still required beside the binary.

M4 (`MUL_MAT_ID` via `nb[2]`) not started.
