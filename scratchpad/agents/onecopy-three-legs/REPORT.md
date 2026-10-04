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

## GPU v3: image1d_buffer reads (engine `83541c1b1`, `raw/s23-gpu-v3-unplugged.grep`, unplugged, 96 %, 27.9 C)

First v3 build (`f97c8bd59`) reported "views unsupported" on S23 and Mac: the probe queried
`CL_DEVICE_IMAGE_MAX_BUFFER_SIZE` (a `size_t`) into a `cl_uint`, the query failed and the ignored rc left 0.
Fixed in `83541c1b1` (every device query now rc-checked). S23 limit: 134217728 px.

| shape | engine SoA | tiled v2 | v3i (image) | v3h (image + engine expr) | v3i vs SoA |
|---|---:|---:|---:|---:|---:|
| ffn_gate_up | 0.240 | 0.440 | 0.414 | 0.414 | 0.58 |
| conv_in_proj | 0.132 | 0.258 | 0.240 | 0.238 | 0.55 |
| ffn_down | 0.333 | 0.558 | 0.526 | 0.523 | 0.63 |
| attn_k | 0.052 | 0.089 | 0.089 | 0.090 | 0.58 |

The image path gives 5-7 %, not the gap. Op count of v2/v3: per 32x32 K-tile a lane does 32 MACs but converts its
16 fp16 row scales with exact bit math (~160 ops) - the kernel is ALU-bound (~0.38 ms predicted for ffn_gate_up
at ~1 T fp32 op/s vs 0.41 measured). The engine converts scales natively and flushes fp16 denormals (its
scales_denorm FAIL). Next: v4 with native scale conversion and a cheaper per-weight path (GLM cd71bdf3).

## GPU v4: native scale conversion (engine `381948fa2`, `raw/s23-gpu-v4-unplugged*.grep`, unplugged, 94 %, 27.6-28.6 C)

Quants via the CL_RGBA/UINT32 image1d_buffer view, scales via a second CL_HALF_FLOAT view of the same region
(`read_imagef` converts; Apple rejects `half*` kernels). ~162 ALU ops per lane per K-tile vs ~416 in v3i.

| shape | engine SoA (r1/r2) | tiled v4 (r1/r2) | v4 speed vs SoA |
|---|---:|---:|---:|
| ffn_gate_up | 0.239 / 0.239 | 0.269 / 0.267 | 0.89 |
| conv_in_proj | 0.128 / 0.129 | 0.152 / 0.148 | 0.84-0.87 |
| ffn_down | 0.332 / 0.331 | 0.257 / 0.255 | 1.29-1.30 |
| attn_k | 0.052 / 0.052 | 0.039 / 0.040 | 1.30-1.33 |
| pad_rows | 0.064 / 0.064 | 0.055 / 0.056 | 1.14-1.16 |

v4 errors 6-9e-7 of output RMS (SoA 6-8e-4) and v4 PASSes the fp16-denormal shape (the texture unit converts
denormals exactly; SoA flushes them). Sum over the four model shapes: SoA 0.751 ms, v4 0.717 ms - parity in
aggregate, NOT per shape (ffn_gate_up and conv_in_proj 13-19 % slower, the other three faster).

Hostile audit (luna 3a6510f3): kernel correct, SoA arm is the engine's real path at these shapes (the four
shape-specialised gemv programs match none of them). NOT yet proved: (a) zero-copy - the views sit on a
sub-buffer of the import, but no check that the driver reads the same physical memory; (b) timing fairness - v4
runs after four arms reading the same bytes (warm caches), and the warmup iteration entered the minimum; (c) a
view with nonzero offset inside the import. Fixes in progress (GLM 2504ca07): alias check, cache eviction +
reversed order, warmup excluded, nonzero-offset shape. Until then this table is a direction.

## GPU v4 after the audit fixes (engine `e3d3c32f4`, `raw/s23-gpu-v4-final-{normal,v4first}.grep`, unplugged, 92 %, 27.6 C)

- **Zero-copy proved on the real import:** after both v4 views exist and a GPU dispatch has read them, the CPU
  writes a pattern through the dma-buf mapping (+ `DMA_BUF_IOCTL_SYNC`) and the GPU reads it back through both
  views: `INFO alias quant=PASS scale=PASS` in both runs.
- Timing: 64 MiB cache eviction before every arm, warmup excluded from the minimum, run twice (normal order and
  v4 timed first). New `off_nudge` shape: v4 view at a non-aligned offset (`poff 7`) PASS.

| shape | SoA normal / v4-first | v4 normal / v4-first |
|---|---:|---:|
| ffn_gate_up | 0.240 / 0.239 | 0.265 / 0.279 |
| conv_in_proj | 0.131 / 0.130 | 0.152 / 0.150 |
| ffn_down | 0.334 / 0.329 | 0.256 / 0.253 |
| attn_k | 0.052 / 0.052 | 0.037 / 0.036 |
| sum of the four | 0.757 / 0.750 | 0.710 / 0.718 |

Only failure: the engine SoA path on fp16-denormal scales (expected, its flush). **Result: the GPU decodes from the
shared NPU-layout copy, zero-copy, at aggregate parity with its own path (per shape 0.84-1.44x).**

## Where the three legs stand on ONE copy (NPU tiled layout), S23

| leg | decode mat-vec vs its own layout | note |
|---|---|---|
| NPU | 1.00 | its native layout (two-copy speed by construction) |
| GPU | ~1.0 aggregate (0.84-1.44 per shape) | v4, zero-copy proved, more precise than the engine path |
| CPU | 0.71-0.73 (cpu3) / 0.80-0.87 (cpu3-7) | sdot + 96 zips per tile; bit-identical |

## Gate G: NPU from the tiled HOST buffer (2026-10-04, S23 unplugged, `gate-g/`)

Engine `feat/governor-onecopy` (`~/Projects/kalsallama-gov-onecopy`): `7460d6210` (loader: buffers with
`requires_set_tensor` go through `set_tensor`, not `read_raw`), `b9543b6e4` (ops on tiled weights are HTP-only:
`offload_op` claims them at batch 1, an unsupported one aborts), `16b2a093d` (luna audit fixes: tiled = HOST
buffer + REPACK so flag-off is unchanged, views to root, opfilter through the abort, WEIGHTS-only repack, no
async chunks). Binaries sha256 `186447a7...` (llama-bench), `10c229ce...` (llama-perplexity); skel release
`61c8d6f5...` (timed arms), debug `d40e98c6...` (HMX proof only).

What it took to make arm B real (each caught by the script's proof gates, not by the numbers):
1. `GGML_HEXAGON_HOSTBUF=1` alone leaves `-ngl 99` weights in the HTP0 device buft; `-ot` must place them.
2. The fork scheduler sends a host-buffer-weight op to the CPU unless the device's `offload_op` opts in, and
   Hexagon opts in only above a batch threshold: decode ran on the CPU reading tiles (214 splits, 2.25 tok/s,
   wrong output) until `b9543b6e4`.
3. Small f32 norm/conv weights in a host buft fall to the CPU the same way (198 splits): arm B places only the
   Q4_0 matrices (`-ot proj.weight|ffn_gate|ffn_up|ffn_down|attn_q.weight|attn_k.weight|attn_v.weight|attn_output=HTP0-HOST`).
4. The first timed sessions ran a debug skel (`HTP_DEBUG=1`, no `NDEBUG`): both arms at pp512 503 / tg128 9.1
   (ratio 1.00, `raw/session2-t5-debugskel.grep`). Release skel restores the reference.

Proofs (both arms, `raw/session3-t5-releaseskel.grep`): A no HOST-REPACK, no HTP0-HOST buffer; B 166 HOST-REPACK
tensors = 1369571328 bytes, HTP0-HOST model buffer, both 2 graph splits, 3993 tiled MUL_MAT tags, 0 flat,
`hmx-mm-2d` on prefill (220 / 238 lines).

| arm | pp512 | tg128 | mean KLD | max KLD | same top p |
|---|---:|---:|---:|---:|---:|
| A two copies | 899.12 | 22.73 | 0.005313 | 0.094590 | 97.059 % |
| B one copy (tiled HOST) | 891.14 | 22.61 | 0.005313 | 0.094590 | 97.059 % |
| B2 | 888.96 | 22.65 | 0.005313 | 0.094590 | 97.059 % |
| A2 | 890.14 | 22.46 | 0.005313 | 0.094590 | 97.059 % |

`-t 5 -r 3 -ub 512`, every arm started <= 33.0 C battery, thermal status 0. **B/A: pp512 0.995, tg128 1.002;
KLD identical to the last digit. Gate G PASS:** the NPU reads the shared tiled copy at two-copy speed.
Per-op check (profiled, debug skel): blk.5.ffn_gate 659 vs 658 us, ffn_down 431 vs 430 us.
Not measured here: memory saving (max RSS does not count dma-buf: A 287 MB, B 294 MB) - step 2 measures PSS
and dma-buf.

## Step 0 check: shared tile header (engine `474ca75fe`, `raw/session4-step0-474ca75fe.grep`, S23 unplugged)

`ggml/src/ggml-q4_0-tile32.h` (layout constants, packer, scalar ref dot); Hexagon calls it; host test byte-identical
to the old packer on 8 shapes + IQ4_NL (`cc777fd12`, luna audit c9af7460: no byte difference; release skel hash
unchanged `61c8d6f5...` after the 576 -> named constant). Same ABBA script as gate G (binaries `d2738237...`,
`b80e4324...`): A 897.87 / 22.68, B 892.80 / 22.57, B2 893.67 / 22.36, A2 892.64 / 22.62 (pp512 / tg128); B/A pp
0.998, tg 0.992; KLD 0.005313 all four. NPU numbers unchanged: step 0 PASS.
