# One copy for three legs: CPU and GPU mat-vec on the NPU tiled layout (2026-10-04)

Design: `DESIGN.md`. Question: can CPU and GPU decode read the NPU's tiled Q4_0 layout in place, close to the
speed of their own layouts?

Builds (engine spikes, not pushed):
- CPU `spike/onecopy-cpu-gemv`: `3ae7a8ea3` (sdot kernel), `cc467bceb` (mac8/mac16 shapes), `4e6c75252` (audit
  fixes: NaN + per-row gates, whole-call timing). S23 binary sha256 `a7ce2c90...8aad8e`
  (`-march armv8.2-a+dotprod+i8mm`; the batch-1 4x8 path runs sdot, not smmla - `repack.cpp:292`).
- GPU `spike/onecopy-gpu-rawq4`: `940d98e07` (tiled kernel v1), `7b15f142f` (audit fixes: one rc convention,
  `mem=` tag, pad lanes, pad_rows + denormal shapes), `8f79172e6` (Adreno compile fixes, engine build options per
  kernel), `253aaad1d` (SoA baseline = the engine's real path: convert + both plane transposes,
  `ggml-opencl.cpp:11507-11511`). Probe sha256 `1d0d612b...51af7`.
- Audit: luna e13768da (hostile, 3 must-fix found and fixed before any timed run).

S23 session 2026-10-04: unplugged, 100 %, battery 28.1 C, Awake, traced 0, Kalsa not running.

## Correctness

- CPU on the S23 (X3/A715): tiled output **bit-identical** to the repacked 4x8 kernel on both LFM2 ffn shapes.
- GPU on the S23, every arm reading the imported dma-buf (`mem=dmabuf`): tiled v1 PASS on all 6 shapes, err
  3-6e-7 of output RMS (incl. rows % 32 = 16 and fp16-denormal scales). The engine's own SoA path PASSes the 5
  real shapes (err 6-8e-4) and FAILs the denormal-scale shape (err 3.05): the shipped Adreno decode mishandles
  denormal scales (rare in real weights; noted, not chased).

## Speed, CPU (`raw/s23-cpu-mask08.grep`, `raw/s23-cpu-maskf8.grep`, ms per mat-vec, 1 thread)

The S23 refuses a single-CPU affinity on cpu6/cpu7 (`taskset 80`: EINVAL); cpu3 (A715) and cpu3-7 are allowed.
An unpinned first run was discarded (raw faster than repack: thread landed on a little core / migrated).

| shape | pin | repack 4x8 | tiled (NPU layout) | raw | tiled speed vs 4x8 | raw vs 4x8 |
|---|---|---:|---:|---:|---:|---:|
| 10752x2048 | cpu3 | 0.826 | 1.163 | 1.510 | 0.71 | 0.55 |
| 2048x10752 | cpu3 | 0.845 | 1.162 | 1.592 | 0.73 | 0.53 |
| 10752x2048 | cpu3-7 | 0.505 | 0.635 | 0.756 | 0.80 | 0.67 |
| 2048x10752 | cpu3-7 | 0.535 | 0.614 | 0.751 | 0.87 | 0.71 |

The 5-thread column of this build includes thread spawn/join per repetition (audit fix 2) and is not used.
Mac M1 Max: tiled 0.76-0.78 of 4x8; the whole gap is the 96 zips per 32x32 tile that build 4-K lanes for sdot
(ablation in `cc467bceb`'s report); broadcast-MAC shapes tie (mac8) or lose (mac16).

## Speed, GPU (`raw/s23-gpu-unplugged.grep`, ms per mat-vec)

| shape | engine SoA | raw GEMV | tiled v1 | v1 vs SoA |
|---|---:|---:|---:|---:|
| ffn_gate_up | 0.233 | 0.404 | 0.482 | 0.48 |
| conv_in_proj | 0.131 | 0.239 | 0.269 | 0.49 |
| ffn_down | 0.332 | 0.371 | 0.635 | 0.52 |
| attn_k | 0.052 | 0.031 | 0.126 | 0.41 |

v1's lane mapping is uncoalesced (adjacent lanes sit in different 32-row bands, n_k_tiles*576 B apart). In this
layout a 32-row band is ONE contiguous stream, so v2 maps 32 lanes onto one tile's 512 contiguous quant bytes
(GLM ad6bb146, running).

## Reading so far

- NPU: native layout, two-copy speed by construction.
- CPU: 0.71-0.87 of its own layout on the S23 (vs 0.53-0.71 for raw). Correct; the gap is instruction count.
- GPU: v1 0.41-0.52 of the engine path; the layout is not the cause yet, the mapping is - v2 decides.

## GPU v2: coalesced mapping (engine `f6259c835`, `raw/s23-gpu-v2-unplugged.grep`, same session, 100 %, 27.7 C)

| shape | engine SoA | raw GEMV | tiled v1 | tiled v2 | v2 vs SoA |
|---|---:|---:|---:|---:|---:|
| ffn_gate_up | 0.238 | 0.407 | 0.486 | 0.441 | 0.54 |
| conv_in_proj | 0.129 | 0.238 | 0.267 | 0.257 | 0.50 |
| ffn_down | 0.332 | 0.369 | 0.632 | 0.557 | 0.60 |
| attn_k | 0.052 | 0.031 | 0.121 | 0.088 | 0.59 |

Coalescing moved v2 only 5-12 %. Every arm reading weights through plain buffer loads (raw GEMV, v1, v2) sits at
22-30 GB/s; the engine's SoA path reads them through an image1d_buffer (texture path) with half math at 37-55 GB/s.
Next (GLM 4205db7f): v3i = v2 + image1d_buffer view on the same imported cl_mem; v3h = v3i + half math. Splits
memory path vs ALU.
