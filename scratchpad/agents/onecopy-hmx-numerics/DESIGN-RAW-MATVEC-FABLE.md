# Design: DSP decode reading raw Q4_0 rows directly (Fable 5.1, 2026-09-30)

Reviewer: Paseo agent `a4c392fa-ca21-427f-8b39-cf4e488bf10c` (claude-fable-5-1, high, read-only, web).
Engine at `cc9c541f2`. Verbatim design follows; coordinator note: not yet verified by implementation.

**Answer.** Option A (raw-reading matvec) can reach the two-copy speed and is the one to build first. Within a row, quant byte i holds elements i (low nibble) and i+16 (high nibble), so 4 consecutive bytes are 4 consecutive k, exactly what one vrmpy lane wants, and because 18·b ≡ 0 or 2 (mod 4) no 4-byte lane ever straddles the quants of two blocks. A row-streaming matvec (one raw 128-byte vector = 7.1 blocks of one row, activations pre-arranged once per token to the same byte phase with zeros under the scale bytes, the −8 offset folded into a per-token per-lane correction, per-lane fp16 scale fanned out with one vdelta, a qf32 epilogue per vector, one 32-lane reduce per row) costs about 9-10 vector ops per 128 raw bytes: ~25-30 pcycles per 32×32-block equivalent issue-bound, 40-70 with realistic stalls, vs 90-120 for today's tiled dot and ~250 for conversion+dot. Bytes moved per token are identical to the two-copy path, so decode returns to the DDR-bound regime: expected 19-23 tok/s. Option B (shared on-disk layout) does not help the DSP (the CPU q4_0_4x8 interleave has the same phase/fanout problems) and costs a fork-only GGUF type upstream removed (PR #10446). Later, optional: in-place XOR-0x88 of the shared buffer for ~+40 % on the CPU raw lane.

## Kernel per raw vector (row r, vector v)
1. `raw = vmem(row + 128v)` (aligned via DMA dst_stride, below).
2. `qlo = vand(raw, 0x0F)`, `qhi = vlsr_ub(raw, 4)`.
3. `acc = vrmpyacc(corr[v], qlo, xlo[v]); acc = vrmpyacc(acc, qhi, xhi[v])`; `xlo/xhi` = the token's int8 activations at the raw byte phase (byte 18b+2+i <- x[32b+i] / x[32b+16+i], zero at 18b, 18b+1); `corr[v] = −8·(Σxlo + Σxhi)` per lane. Built once per token per distinct K.
4. `s = Vsf_equals_Vw(acc)` (exact, lane sums < 2^15).
5. Scale: `dvec = vdelta(raw, ctrl[v mod 9])` broadcasts each block's d into every lane of that block; `sc = lo(Wqf32_vmpy_VhfVhf(dvec, ascale[v]))`. Whether all 9 segmented-broadcast patterns are one vdelta or need vdelta+vrdelta: UNKNOWN (budget 1-2 permutes).
6. `accf = vqf32_vadd(accf, vqf32_vmpy(s, sc))`.
Interleave 4 rows so x-vectors load once per 4 raw vectors; per-row 32-lane reduce at the end (or batch 32 rows through a transpose-add). Phases: vector at offset 128v has phase (2v mod 18) -> 9 phases, period 1152 bytes = 64 blocks. LFM2 K=2048 = 9 vectors/row; K=10752 = 47.25.

## DMA
One 2-D descriptor per 32-row group with `dst_stride = align_up(n_k·18, 128)` instead of `row_size` (`hvx_mm_push_raw_q4_0`, `matmul-ops.c:351-355`; `dma_queue_push` has independent strides, `dma-queue.h:304`). Tail bytes of the last vector must be masked on the scale side (junk fp16 × 0 can be NaN): mask `dvec` per phase or zero the 32 row tails per push. Descriptors dropping scale bytes / gathering scales: REFUTED as free.

## Numerics
Integer block sums exact; float epilogue rounds per lane (4-5 partials per block), so output is NOT bit-identical to the tiled dot any more — verify by KLD (expect within noise of 0.005313), not by diff. Bit-exact under unit scales (harness mode).

## Plan for the coder
1. `htp/q4_0-raw-mv-hvx.h` (new, <250 lines): `q4_0_raw_act_arrange(...)` (xlo/xhi/corr/ascale per K, from plain int8 + per-block scale; extend `quantize_block_f32_q8_0_tiled`, `hvx-mm-kernels-tiled.h:124-183`, to also emit `vx_i8`/`vd_hf`), and `q4_0_raw_mv_32rows(...)`: 4-row interleaved streaming loop, per-row lane reduce, 32 floats out in the layout `tiled_vec_dot_q4_0_32x1` writes (`:471-475`).
2. `matmul-ops.c`: `MATVEC_2D_RAWROWS_IMPL` (or `RAW_Q4_0 == 2` in `MATVEC_2D_TILES_IMPL`, `:502`): aligned `dst_stride`, zero tails, call the new dot instead of `hvx_mm_raw_q4_0_to_tiles` + `DOT_2X1` (`:575-583`); select at `:1647`. All n_prefetch slots become prefetch slots.
3. `ggml-hexagon.cpp`: raw decode admission stays (`ggml_hexagon_raw_decode_op`, `:2215`); VTCM precompute for the aligned raw slot.
4. Sim: `tests/hexagon-sim/raw-mv-sim.c` + `run-raw-mv.sh`: (a) unit-scale mode bit-exact vs scalar `q4_0_raw_rows_to_tiles` + `tiled_vec_dot_q4_0_32x1`; (b) random scales, max rel err <= 1e-5 vs tiled dot and a double reference; (c) over-read check like `raw-tiles-overread.c`; (d) bench impl reporting pcycles per tile-equivalent, gate <= tiled decode dot; negative controls: scale byte, nibble, phase table.
5. Device (coordinator): ABBA speed table, 1,024-decode KLD, `GGML_HEXAGON_PROFILE=1` per-op times vs two copies.

Risks: 9 vdelta controls; `Vqf32_vmpy_Vqf32Vsf` availability on v73; tail masking; VTCM sizing; last group < 32 rows (zero scale lanes of padding rows).

Rejected: cache hottest tiles (no hot subset in decode); CPU/DSP row split (keeps the hot lane busy); more HVX threads (already 4/4); DMA transpose.

Sources: https://github.com/ggml-org/llama.cpp/pull/29740 · https://github.com/ggml-org/llama.cpp/pull/10446 ·
https://github.com/haozixu/llama.cpp-npu · https://github.com/dlwlzzero/nntrainer/issues/51 ·
https://github.com/ggml-org/llama.cpp/discussions/21702 · Qualcomm Hexagon V73 HVX PRM 80-N2040-54.
