# Q40 M1 — Q2_K_8x4 / Q3_K_8x4 pack identity

Status: M1 done on host. Branch pushed. No M2+.

Fork worktree: `C:\Users\gualt\Desktop\Kalsa\moe-experiments\worktree-repack-q23k`
Branch: `kalsa/repack-q23k` at `baaa5a355` (base `1882bf8cd`)
Remote: `origin` = `https://github.com/Aspis0/kalsallama.git`

M0 report remains `scratchpad/agents/q40-m0-repack/REPORT.md`.

## What landed

Scalar oracles walk the packed tiles and write `[ne2][ne1][ne0]` fp32:

- Q2: `scale = sm & 0xF`, `min = sm >> 4`, `dl = d*scale`, `ml = dmin*min`, `y = dl*q - ml` with `q` in 0..3.
- Q3: `s = scale_code - 32`, `q = low2 | (high<<2)`, `dl = d*s`, `y = dl*(q - 4)`.
- `d` / `dmin` go through `GGML_FP16_TO_FP32`, the same conversion as `dequantize_row_q2_K` / `dequantize_row_q3_K`.

Starting from quantized blocks (already fp16 `d`), packed-oracle fp32 is **bit-identical** to native row dequant. There is no extra tolerance.

## Files

| File | Change |
|---|---|
| `ggml/src/ggml-cpu/repack.cpp` | Scalar dequant oracles + sm/q/scale_code getters. |
| `ggml/src/ggml-cpu/repack-q23k.h` | Internal declarations (still not public ABI). |
| `tests/test-repack-q23k-m1.cpp` | Identity harness. |
| `tests/CMakeLists.txt` | Registers the test with `ggml/src` include path. |

## Commits

```
a077cad3f ggml: add scalar Q2_K_8x4/Q3_K_8x4 dequant oracles
baaa5a355 tests: add M1 Q2_K/Q3_K 8x4 pack identity harness
```

Pushed `cef64aa4c..baaa5a355` to `origin/kalsa/repack-q23k`.

## Raw test output

```
M1 identity: fp32 compare is bit-identical; d/dmin use the same ggml_fp16_to_fp32 as dequantize_row_q2_K/q3_K.
== targeted layout ==
  ok Q2 scale=low nibble min=high nibble (sm=0x5A)
  ok Q3 6-bit scale_code round-trip (0,4,..60) and s=code-32
  ok Q3 low-plane order (sb=5 unique 0..3 pattern)
  ok Q3 hmask bit order (single high bit at sb=3 lane=7 -> q=5)
== edge patterns ==
  ok Q2_K all-zero
  ok Q3_K all-zero
  ok Q2_K all-max q/scale/min
  ok Q3_K all-max q/scale_code
  ok Q3_K hmask all-clear (q=0..3)
  ok Q3_K hmask all-set (q=4..7)
== patterned identity ==
  ok pattern q2_K 256x8x1
  ... (all 36 Q2 + 36 Q3 shapes ok) ...
  ok pattern q3_K 1024x32x3
== random identity ==
  q2_K seed=0x00000001 36/36 shapes bit-identical
  q2_K seed=0x00c0ffee 36/36 shapes bit-identical
  q2_K seed=0xdeadbeef 36/36 shapes bit-identical
  q3_K seed=0x00000001 36/36 shapes bit-identical
  q3_K seed=0x00c0ffee 36/36 shapes bit-identical
  q3_K seed=0xdeadbeef 36/36 shapes bit-identical

RESULT: PASS
```

Full copy: `scratchpad/agents/q40-m1-repack/test-output.txt`. Exit 0.

## Pass-criteria table

| Criterion | Result | Notes |
|---|---|---|
| Shape grid ne0∈{256,512,1024} × ne1∈{8,16,24,32} × ne2∈{1,2,3} | PASS | 36/36 Q2 and 36/36 Q3 patterned, bit-identical fp32 vs `to_float` = `dequantize_row_q*_K`. |
| Patterned bytes encode expert/row/block/subblock/plane/scale/min | PASS | Distinct `d`/`dmin`/nibble/`q`/hmask from those indices. A stride or plane swap would fail the grid. |
| Random tensors, several seeds | PASS | 3 seeds × 36 shapes × 2 types, all bit-identical. |
| Edges: all-zero, all-max, Q3 hmask all-set/all-clear | PASS | |
| Q3 low-plane order | PASS | Unique 0..3 pattern only in sb=5. |
| Q3 hmask bit order | PASS | Single high bit at sb=3 lane=7 → reconstructed q=5. |
| Q3 6-bit code round-trip | PASS | scale_code 0,4,...,60 survives pack. |
| Q3 `code-32` signed decode | PASS | Same codes; dequant matches native (`s = code-32`). |
| Q2 scale/min nibble order | PASS | sm=0x5A (scale=0xA low, min=0x5 high). |
| fp16 tolerance | N/A / exact | Both paths convert the **same** stored fp16 `d`/`dmin`. Comparison is bit-identical fp32; no ulp slack. |
| NEON | Not required | Oracle and packers are scalar; host is x86. |

M2 (GEMV kernels) not started.
