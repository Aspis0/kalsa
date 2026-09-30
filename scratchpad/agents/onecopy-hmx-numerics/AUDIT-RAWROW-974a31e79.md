# Hostile audit: raw-row Q4_0 matvec (`974a31e79`)

**Verdict: FIX FIRST.** Static review found two reachable host-to-DSP admission errors that can return wrong results and read beyond an activation tensor: F16 activations admitted to the F32 flat quantizer, and strided or misaligned F32 activations admitted to the raw decoder. I did not run the simulator or any build; the reported `run-raw-mv.sh` exit 0 is the coordinator's result.

## Ranked findings

### 1. P1 — F16 activations reach a quantizer that reads F32: **CONFIRMED**

The general quantized-weight support check accepts F16 activations. With `GGML_HEXAGON_MM_SELECT=1`, the raw-weight policy bypasses the raw-decode F32 predicate and the precompute disables the tiled path, choosing the flat path. The DSP flat Q4_0 branch selects `quantize_f32_q8_0_flat` without checking activation type. The tensor descriptor preserves the original type and byte strides. This is a real type mismatch, not merely an untested combination: F16 has two-byte elements, while the flat kernel copies `ne0` float elements. For a dense row that requests twice the tensor's logical bytes; for batches it also advances by the F16 row stride between those oversized copies.

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5111:     if (src1->type != GGML_TYPE_F32 && src1->type != GGML_TYPE_F16) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2244:         if (op->op != GGML_OP_MUL_MAT || i != 0 || src->type != GGML_TYPE_Q4_0 || src->ne[0] % QK4_0 ||`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2245:             (opt_mm_select != 1 && (!opt_raw_hmx || !(hmx_sized || ggml_hexagon_raw_decode_op(op))))) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4583:             bool try_tiled = (k_align && opt_mm_select >= 2);`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4624:             // Flat HVX fallback`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4627:                 kparams->kernel_type = HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1627:             quant_task_func = (src0->type == HTP_TYPE_Q4_1 || src0->type == HTP_TYPE_Q4_K) ? quantize_f32_q8_1_flat : quantize_f32_q8_0_flat;`
```text
ggml/src/ggml-hexagon/htp/matmul-ops.c:759:     const size_t src_row_size = src->nb[1];                                                                \
ggml/src/ggml-hexagon/htp/matmul-ops.c:764:     kernel_fn(src_data, dst_data, tmp_data, ne0, ir_last - ir_first, src_row_size, dst_row_size);          \
```
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-flat.h:167:         hvx_copy_f32_aa(tmp_data, src_data, ne0);`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-flat.h:169:         quantize_row_f32_q8_0_flat((float *) tmp_data, dst_data, ne0);`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-flat.h:171:         src_data += src_row_size;`
> `ggml/src/ggml.c:669:     [GGML_TYPE_F16] = {`
> `ggml/src/ggml.c:672:         .type_size                = sizeof(ggml_fp16_t),`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2414:         h.type  = t->type;`

This is reachable through the raw flat route; the new one-row raw-window branch itself is intended for F32 and is separately restricted by `ggml_hexagon_raw_decode_op`. The F16 flat route must either convert F16 correctly or be refused by host admission and stay on CPU.

### 2. P1 — Raw decode ignores `src1->nb[0]` and assumes 128-byte source alignment: **CONFIRMED**

For the one-row raw decode, host admission checks activation type and singleton outer dimensions but not `nb[0]` or the activation data address. Marshalling passes the real `nb[0]` and data offset; the new DSP task casts the pointer to `float *` and advances it as a dense array. A valid view with non-unit element stride is therefore read as dense, producing wrong values and potentially crossing the view's logical extent. The helper used for the copy is explicitly an aligned-source helper and asserts 128-byte alignment. A view offset that breaks that alignment can assert or fault.

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2218:     return opt_raw_hmx && opt_raw_decode && op->op == GGML_OP_MUL_MAT && a && a->type == GGML_TYPE_F32 &&`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2219:            a->ne[1] * a->ne[2] * a->ne[3] == 1;`
> `ggml/src/ggml.c:3336:     return (t0->ne[0]           == t1->ne[0])  &&`
> `ggml/src/ggml.c:3338:            (t1->ne[3]%t0->ne[3] == 0);`
> `ggml/src/ggml.c:3346:     GGML_ASSERT(!ggml_is_transposed(a));`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5127:             if (src1->ne[2] != 1 || src1->ne[3] != 1) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2407:         uint64_t t_offset = (uint8_t *) t->data - sbuf->base();`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2432:             h.nb[0] = t->nb[0]; h.nb[1] = t->nb[1]; h.nb[2] = t->nb[2]; h.nb[3] = t->nb[3];`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:786:     q4_0_raw_act_windows(mmctx->vtcm_src1, (const float *) mmctx->act->data, tmp, mmctx->act->ne[0],`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:55:         hvx_copy_f32_aa((uint8_t *) tmp, (const uint8_t *) (src + g * QK_Q8_0_TILED), active);`
> `ggml/src/ggml-hexagon/htp/hvx-copy.h:129: // copy n fp32 elements : source and destination are aligned to HVX Vector (128)`
> `ggml/src/ggml-hexagon/htp/hvx-copy.h:130: static inline void hvx_copy_f32_aa(uint8_t * restrict dst, const uint8_t * restrict src, uint32_t n) {`
> `ggml/src/ggml-hexagon/htp/hvx-copy.h:90:     assert((unsigned long) dst % 128 == 0);`
> `ggml/src/ggml-hexagon/htp/hvx-copy.h:91:     assert((unsigned long) src % 128 == 0);`

The source comment acknowledges the alignment requirement, but no host check enforces it for this operation. The ordinary aligned, dense decode case is fine; the admitted view case is not.

### 3. P2 — Raw QUANT_BLOCK offload below K=256 is removed: **CONFIRMED**

The parent admitted a one-row raw QUANT_BLOCK matvec without a K minimum. The new shared host/DSP predicate requires K≥256, so when precompute selects QUANT_BLOCK for aligned raw Q4_0 K=32…224, host support rejects it and it falls back to CPU. This is a lost offload path, not a wrong-kernel dispatch. Explicit flat selection remains allowed; the simulator checks the predicate but does not exercise host scheduling or measure this fallback.

> `cc9c541f2:ggml/src/ggml-hexagon/ggml-hexagon.cpp:2228:            (kparams->kernel_type == HTP_MM_KERNEL_HVX_QUANT_BLOCK && one_row);`
> `cc9c541f2:ggml/src/ggml-hexagon/htp/matmul-ops.c:1647:                 matmul_job_func = hvx_mv_2d_raw_q4_0; // op_matmul admits raw here only as a one-row QUANT_BLOCK matvec`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:21: #define HTP_MM_RAW_MV_MIN_K    256 // raw-row matvec: a window of 7 Q4_0 blocks and one more (q4_0-raw-mv-geometry.h)`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:84:            (kernel_type == HTP_MM_KERNEL_HVX_QUANT_BLOCK && n_act_rows == 1 && k >= HTP_MM_RAW_MV_MIN_K);`

### 4. P2 — VTCM sizing uses tiled activation bytes for a much smaller raw-window buffer: **CONFIRMED**

At K=10,752 (`n_k=336`), the raw arranger writes 48 windows × 512 bytes = 24,576 bytes. The QUANT_BLOCK layout builder ignores the `src1_row_size` override and sizes this region as 336 tiled Q8 blocks × 1,152 bytes = 387,072 bytes. This is safe over-allocation, not an undersized buffer. It can inflate host precompute/DSP VTCM needs enough to force flat fallback or reject a path that the raw arrangement itself could fit; whether that happens depends on the target's VTCM budget and other buffers.

> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:19: #define RAW_MV_WINDOW_BLOCKS 7`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:42:     return (n_k + RAW_MV_WINDOW_BLOCKS - 1) / RAW_MV_WINDOW_BLOCKS;`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:20: #define RAW_MV_ACT_WINDOW_BYTES (4 * VLEN)`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:23:     return (size_t) raw_mv_n_windows(n_k) * RAW_MV_ACT_WINDOW_BYTES;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1670:                 src1_row_size = raw_mv_act_bytes(ne10 / 32);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:44: #define HTP_MM_ACT_TILE_SIZE_Q8_0      1152`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:246: static inline size_t htp_mm_q8_0_tiled_row_size(uint32_t ne) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:249:     return nb_32 * HTP_MM_ACT_TILE_SIZE_Q8_0;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:589:                 size_t q_src1_row_size = (wtype == HTP_TYPE_Q4_1 || wtype == HTP_TYPE_Q4_K) ? htp_mm_q8_1_tiled_row_size(ne10) : htp_mm_q8_0_tiled_row_size(ne10);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:592:                 src1_sz = htp_mm_round_up(q_src1_row_size * src1_nrows, 256);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:599:                     uint32_t tile_row_size = n_k_tiles * aligned_tile_size;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:600:                     size_t repacked_vtcm_size = htp_mm_round_up(n_prefetch * tile_row_size, 256);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:601:                     src0_sz = repacked_vtcm_size * n_threads;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:639:     VTCM_LAYOUT_ALLOC(off, off_src1, src1_sz);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:508:     const bool is_repack = (wtype == HTP_TYPE_Q4_0 || wtype == HTP_TYPE_Q4_1 ||`
> `ggml/src/ggml-hexagon/htp/hvx-types.h:11: #define VLEN        (128)`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:82:         raw_mv_act_window(act + (size_t) w * RAW_MV_ACT_WINDOW_BYTES, src, tmp, ne0, w);`
```text
ggml/src/ggml-hexagon/htp/matmul-ops.c:539:     uint32_t tile_row_transfer_size_aligned = n_k_tiles_a * aligned_tile_size;                                                    \
ggml/src/ggml-hexagon/htp/matmul-ops.c:560:             uint8_t * slot = vtcm_src0_ptr + d * tile_row_transfer_size_aligned;                                                  \
```
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:604:                 size_t quant_scratch_size_per_thread = htp_mm_round_up(ne10 * sizeof(float), QK_Q8_0_TILED * sizeof(float));`
> `ggml/src/ggml-hexagon/htp/htp-ops.h:43: #define QK_Q8_0_TILED  128  // 32x32 Q8_0 tiled layout`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:607:                 dst_sz = dst_size_per_thread * n_threads;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:785:     float * tmp = (float *) (mmctx->vtcm_dst + mmctx->vtcm_dst_size_per_thread * ith);`

The raw VTCM window stride is 512 bytes and the buffer is one-row-only under the raw MV predicate. Relative to an aligned VTCM base, its start stays vector-aligned: `off_src1` follows a Q4_0 tile-slot area rounded to 256 bytes, and each window advances by 512 bytes. Q4_0 weight slots use the same per-prefetch tile-row stride as the matvec macro, so switching each DMA payload to raw row bytes does not undersize them. Thread partitions write disjoint windows and all workers pass the quantization barrier before the matvec reads them:

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1667:                     mmctx->quant_ib_first[ith] = (n_win * ith) / n_quant_tasks;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1668:                     mmctx->quant_ib_last[ith]  = (n_win * (ith + 1)) / n_quant_tasks;`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:81:     for (uint32_t w = w_first; w < w_last; w++) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:239:             atomic_fetch_sub(&mmctx->quant_barrier, 1);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:241:         while (atomic_load(&mmctx->quant_barrier) > 0) {`
```text
ggml/src/ggml-hexagon/htp/matmul-ops.c:570:     hvx_mm_run_quant_task(mmctx, ith);                                                                                            \
```
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1757:     worker_pool_run_func(octx->ctx->worker_pool, matmul_job_func, mmctx, octx->n_threads);`

I found no intra-op HVX race in that arrangement/consume sequence. The raw activation arrangement is rebuilt on each call rather than persisted for reuse across calls. Concurrent calls sharing the same HTP VTCM context are governed outside this kernel path and were not established by this static review.

### 5. P2 — The same Q8 group is quantized again for adjacent seven-block windows: **CONFIRMED**

Each seven-Q4-block activation window independently quantizes every intersecting four-block/128-float Q8 group. At K=10,752 there are 336 Q4 blocks and 48 windows. The windows intersect 120 Q8 groups in total, while only 84 distinct Q8 groups exist: 36 repeated group quantizations (43% more group quantizations than a one-pass arrangement). This is correct but undermines the “arranged once” cost model. Reusing each group's `vx_i8` and scale while scattering it to neighboring windows would remove the repeated work.

> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:50:     for (uint32_t g = start / 4; g <= (start + RAW_MV_WINDOW_BLOCKS - 1) / 4; g++) {`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:43:     const uint32_t start = raw_mv_window_start(w, n_k);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:48:     return hex_smin(w * RAW_MV_WINDOW_BLOCKS, n_k - RAW_MV_WINDOW_BLOCKS);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:58:         const HVX_Vector vx_i8 = quantize_128_f32_q8_0(tmp, &r_scale);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:80:                                         uint32_t w_first, uint32_t w_last) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1663:                 const uint32_t n_win = raw_mv_n_windows(ne10 / 32);`

### 6. P3 — Zero scales and denormal values are outside the simulator evidence: **PLAUSIBLE**

No source-level failure for zero or subnormal Q4_0 scales, or denormal activation values, is established here: the kernel multiplies the lane sum by the two half scales in the float epilogue. The fixture uses unit or random finite weight scales in (2^-6, 2), and integer or roughly ±4 activation values, so it omits zero/subnormal weight scales and subnormal activations. Target flush/round behavior for those inputs remains untested.

> `tests/hexagon-sim/raw-mv-fixture.h:28: // fp16 1.0 as the scale of every block (d=1 mode) or a random finite scale in (2^-6, 2)`
> `tests/hexagon-sim/raw-mv-fixture.h:30:     if (unit) { return 0x3C00; }`
> `tests/hexagon-sim/raw-mv-fixture.h:31:     return (uint16_t) ((lcg() & 0x8000) | (0x2400 + lcg() % 0x1C00));`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:41:     const HVX_VectorPair scales = Q6_Wqf32_vmpy_VhfVhf(Q6_V_vdelta_VV(raw, fanout), win->ascale);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:42:     return Q6_Vqf32_vmpy_VsfVsf(Q6_Vsf_equals_Vw(raw_mv_lane_sums(raw, win)),`

## Requested-angle dispositions

### Memory bounds, final row, K tails, and N tails

**Final raw row vector crossing the payload end: REFUTED as an HVX-load defect.** The DSP first DMA-copies each raw row with an exact `n_k * sizeof(block_q4_0)` row length into VTCM; the kernel's unaligned 128-byte loads are from that packed VTCM payload, not from the RPC address. For intermediate rows the final vector reaches two bytes into the next packed row, still inside the payload. For the group's final row, it loads 128 bytes ending at `row_end` and shifts away the first two. At the minimum K=256, the row is 144 bytes, so this early load starts at `row_end-128` without underflow. No HVX vector extent crosses the payload boundary in the reviewed source. The simulator over-read harness tracks `hvx_vmemu` extents against a payload boundary; it does not instrument the DMA engine or run with an RPC allocation ending at a protected page, so that lower-level DMA behavior is not independently tested here.

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:347:     const size_t row_size = n_k * sizeof(block_q4_0);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:348:     dma_queue_push(q, dma_make_ptr(dst, (const uint8_t *) src0->data + ct * 32 * src0->nb[1]), row_size, src0->nb[1], row_size,`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:349:                    hvx_mm_raw_group_rows(src0, ct));`
> `ggml/src/ggml-common.h:194: #define QK4_0 32`
> `ggml/src/ggml-common.h:199: static_assert(sizeof(block_q4_0) == sizeof(ggml_half) + QK4_0 / 2, "wrong q4_0 block size/padding");`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:46: // The raw vector of a row's last window (it ends at the row's end). Every row but the group's last`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:47: // reads 2 bytes into the next row; the last one loads 2 bytes early and shifts, so no load leaves`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:52:     return group_end ? Q6_V_valign_VVR(Q6_V_vzero(), hvx_vmemu(row_end - VLEN), VLEN - window_bytes)`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:53:                      : hvx_vmemu(row_end - window_bytes);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:21: #define HTP_MM_RAW_MV_MIN_K    256 // raw-row matvec: a window of 7 Q4_0 blocks and one more (q4_0-raw-mv-geometry.h)`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:24: _Static_assert((RAW_MV_WINDOW_BLOCKS + 1) * 32 == HTP_MM_RAW_MV_MIN_K, "HTP_MM_RAW_MV_MIN_K is window + 1 block");`
> `tests/hexagon-sim/raw-mv-overread.c:15: #undef hvx_vmemu`
> `tests/hexagon-sim/raw-mv-overread.c:16: #define hvx_vmemu(A) (*((HVX_UVector *) overread_track(A)))`
> `tests/hexagon-sim/raw-mv-overread.c:51:             const ptrdiff_t below = (ptrdiff_t) ((uintptr_t) raw - load_lo);`
> `tests/hexagon-sim/raw-mv-overread.c:52:             const ptrdiff_t above = (ptrdiff_t) (load_hi - ((uintptr_t) raw + payload));`

**K not divisible by 256: REFUTED as an algorithm limitation, subject to K being a multiple of 32 and at least 256.** Window count and final-window start use seven-block arithmetic; the baseline suite includes n_k=9, 13, 63, 65, and 71 (K=288, 416, 2016, 2080, and 2272), none of which needs K%256==0. K=224 remains below the raw matvec admission minimum and is refused by the shared predicate (see dispatch section).

> `tests/hexagon-sim/raw-mv-sim.c:34: static const int k_shapes[] = { 8, 9, 13, 63, 64, 65, 71, 336 };`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:42:     return (n_k + RAW_MV_WINDOW_BLOCKS - 1) / RAW_MV_WINDOW_BLOCKS;`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-geometry.h:48:     return hex_smin(w * RAW_MV_WINDOW_BLOCKS, n_k - RAW_MV_WINDOW_BLOCKS);`

**K remainder / source activation tail: REFUTED for dense F32.** Host and DSP require Q4 K to be a whole 32-element block. The final activation copy is therefore a multiple of 32 floats (128 bytes); the copy helper's vector loop has no short-vector tail and does not need source padding. This does not excuse the admitted non-dense/misaligned view in finding 2.

> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5123:             if (src0->ne[0] % ((src0->type == GGML_TYPE_Q6_K || src0->type == GGML_TYPE_Q4_K) ? QK_K : 32)) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:3815:         if (w->type != HTP_TYPE_Q4_0 || !kernel_ok || w->ne[0] % QK4_0 || w->ne[0] != a->ne[0]) {`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:51:         const uint32_t active = MIN(ne0 - g * QK_Q8_0_TILED, (uint32_t) QK_Q8_0_TILED);`
```text
ggml/src/ggml-hexagon/htp/hvx-copy.h:75:         const uint32_t epv  = 128 / elem_size;                       \
ggml/src/ggml-hexagon/htp/hvx-copy.h:77:         const uint32_t nloe = n % epv;                               \
```

**N not divisible by 32: REFUTED as a source-level output-store defect.** Row groups use valid_rows; the kernel duplicates the last valid row only to fill its four-row compute pass and stores only indices below valid_rows. The harness exercises row counts 31, 17, 5, and 1 for arithmetic, but its 32-float output array and comparison loop only over n_rows do not red-zone or detect an accidental store beyond the logical tail. The test gap is **CONFIRMED**; the source guard is the evidence for the store bound, not that test. The over-read harness uses exact-size weight payloads for 17, 5, and 1.

> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:74:             row[i] = (const uint8_t *) vx + MIN(r0 + i, valid_rows - 1) * row_bytes;`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:104:             if (r0 + i < valid_rows) {`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:105:                 hvx_vec_store_u(&s[r0 + i], sizeof(float), sum[i]);`
> `tests/hexagon-sim/raw-mv-sim.c:35: static const int row_counts[] = { 32, 31, 17, 5, 1 };`
> `tests/hexagon-sim/raw-mv-overread.c:32: static const int row_counts[] = { 32, 17, 5, 1 };`
> `tests/hexagon-sim/raw-mv-sim.c:149:     float out[32] __attribute__((aligned(128))), tref[32] __attribute__((aligned(128)));`
> `tests/hexagon-sim/raw-mv-sim.c:170:     for (int r = 0; r < n_rows; r++) {`

### Host admission versus DSP dispatch: batching and K minimum

The host and DSP ask the same `htp_mm_raw_kernel_admitted` predicate. `QUANT_BLOCK` is admitted only for one activation row and K≥256; `QUANT_ROW` is refused; flat and HMX retain their separate routes. Thus `ne[1] > 1` does not leak into the new one-row raw matvec, and K<256 is not sent to its window code. With `MM_SELECT>=2`, aligned K, and a multithreaded one-row decode whose tiled layout fits, precompute chooses QUANT_BLOCK and the new minimum rejects it at host support, so that case falls back to CPU. If precompute chooses flat (including explicit `MM_SELECT=1` or a VTCM fallback), the separate flat raw-weight implementation remains eligible. Compared with the parent, K<256 loses the old QUANT_BLOCK DSP route; this is a confirmed offload/performance behavior change, not a misroute into the new kernel.

> `ggml/src/ggml-hexagon/htp/matmul-ops.h:82: static inline bool htp_mm_raw_kernel_admitted(int32_t kernel_type, uint64_t n_act_rows, uint64_t k) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:83:     return kernel_type == HTP_MM_KERNEL_HMX_2D || kernel_type == HTP_MM_KERNEL_HVX_QUANT_ROW_FLAT ||`
> `ggml/src/ggml-hexagon/htp/matmul-ops.h:84:            (kernel_type == HTP_MM_KERNEL_HVX_QUANT_BLOCK && n_act_rows == 1 && k >= HTP_MM_RAW_MV_MIN_K);`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4552:         const bool k_align = (ne10 % 32 == 0);`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4586:                 if (src1_nrows < (int)sess->n_threads) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4587:                     kparams->kernel_type = HTP_MM_KERNEL_HVX_QUANT_BLOCK;`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4614:                 if (L.total_bytes <= vtcm_budget) {`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4619:                     goto done_quant;`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:4621:                 HEX_VERBOSE("ggml-hex: %s HVX tiled path VTCM size needed (%zu) > budget (%zu), falling back to HVX flat\n", sess->name.c_str(), L.total_bytes, vtcm_budget);`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:2227:     return htp_mm_raw_kernel_admitted(kparams->kernel_type, src1->ne[1] * src1->ne[2] * src1->ne[3], src1->ne[0]);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:3814:         const bool kernel_ok = htp_mm_raw_kernel_admitted(kparams->kernel_type, a->ne[1] * a->ne[2] * a->ne[3], a->ne[0]);`
> `ggml/src/ggml-hexagon/ggml-hexagon.cpp:5167:     if (ggml_hexagon_is_raw_weight(src0) && !ggml_hexagon_raw_kernel_admitted(&kparams, src1)) {`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:3815:         if (w->type != HTP_TYPE_Q4_0 || !kernel_ok || w->ne[0] % QK4_0 || w->ne[0] != a->ne[0]) {`
> `cc9c541f2:ggml/src/ggml-hexagon/ggml-hexagon.cpp:2228:            (kparams->kernel_type == HTP_MM_KERNEL_HVX_QUANT_BLOCK && one_row);`
> `cc9c541f2:ggml/src/ggml-hexagon/htp/matmul-ops.c:1647:                 matmul_job_func = hvx_mv_2d_raw_q4_0; // op_matmul admits raw here only as a one-row QUANT_BLOCK matvec`

Geometry admission agrees across host and DSP; source format admission does not. Finding 1 is the concrete F16 counterexample, and finding 2 is the stride/alignment counterexample. The shared predicate tests do not cover either.

### Numerics: Q4_0 offset, lane accumulator, and design mismatch

The `-8` correction is exact per lane in the integer stage. Each lane's correction is built as negative eight times the sum of its activation bytes; the low/high nibbles are then accumulated against those bytes with `vrmpyacc`. A lane contains at most eight products, each bounded by `8 × 128`, so each per-window signed sum is at most 8,192 in magnitude—far below int32. The implementation accumulates the scaled window terms in qf32, not in an ever-growing integer accumulator. I found no `-8` or int32 overflow defect, including the last-window zeroed overlap bytes.

> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:70:     const HVX_Vector ones = Q6_Vb_vsplat_R(1);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-act.h:73:     hvx_vmem(win + 2 * VLEN) = Q6_Vw_vsub_VwVw(Q6_V_vzero(), Q6_Vw_vasl_VwR(sum, 3));`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:33:     const HVX_Vector qlo = Q6_V_vand_VV(raw, Q6_Vb_vsplat_R(0x0F));`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:34:     const HVX_Vector qhi = Q6_Vub_vlsr_VubR(raw, 4);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:35:     return Q6_Vw_vrmpyacc_VwVbVb(Q6_Vw_vrmpyacc_VwVbVb(win->corr, qlo, win->xlo), qhi, win->xhi);`
> `ggml/src/ggml-hexagon/htp/q4_0-raw-mv-hvx.h:87:                 acc[i] = Q6_Vqf32_vadd_Vqf32Vqf32(acc[i], raw_mv_lane_terms(raw, &win, fanout));`

There is a **confirmed design/test expectation mismatch**, not a demonstrated accuracy failure: the experiment design says unit-scale mode should be bit-exact, but the implementation and simulator explicitly say its float epilogue is not bit-exact and enforce tolerance instead. Resolve that expectation in the design before using it as a release criterion. The coordinator's reported maximum relative error (~4e-6) is below this harness's 1e-5 threshold, but the harness normalizes by a floor of 1% of the absolute term sum, not plain relative error.

> `~/Projects/kalsa-moe-experiments/scratchpad/agents/onecopy-hmx-numerics/DESIGN-RAW-MATVEC-FABLE.md:21: Integer block sums exact; float epilogue rounds per lane (4-5 partials per block), so output is NOT bit-identical to the tiled dot any more — verify by KLD (expect within noise of 0.005313), not by diff. Bit-exact under unit scales (harness mode).`
> `tests/hexagon-sim/raw-mv-sim.c:9: // The float stage is not bit-exact to the tiled dot and cannot be, even with unit weight scales: the`
> `tests/hexagon-sim/raw-mv-sim.c:180:     const int bad = !(worst_ref <= MAX_REL_ERR && worst_tiled <= MAX_REL_ERR);`
> `tests/hexagon-sim/raw-mv-sim.c:173:         const double floor_ = 1e-2 * mag > fabs(ref) ? 1e-2 * mag : fabs(ref);`

### Test validity and remaining holes

The current negative-control wiring is not vacuous by inspection. `SIM_PREPARE` is spliced into the inner shell before compilation, and injected `-I/tmp/nc` is in `cflags` before the normal HTP include directories. Control 3 changes the fanout table that `check_geometry` checks; control 4 changes the final-row branch whose loads `raw-mv-overread` tracks. Controls 1 and 2 mutate row 3 only after clean references are made. The runner requires all requested `ALL PASS` partitions, an `ALL LOADS IN PAYLOAD` line, and no `FAIL`/`CRASH`. The coordinator reports all four normal partitions passed; I did not rerun normal or negative simulations.

> `tests/hexagon-sim/sim-common.sh:22:       '"${SIM_PREPARE:-:}"'`
```text
tests/hexagon-sim/sim-common.sh:24:         '"$HEXTOOLS"'/hexagon-clang -mv73 -mhvx -mhvx-length=128b -O2 -Wall -Werror -Wno-unused-function '"$cflags"' \
```
> `tests/hexagon-sim/run-raw-mv.sh:25:     3) export SIM_PREPARE="mkdir -p /tmp/nc && cp $htp/q4_0-raw-mv-*.h /tmp/nc/ && sed -i '0,/0x04, 0x04/s//0x08, 0x08/' /tmp/nc/q4_0-raw-mv-geometry.h" ;;`
> `tests/hexagon-sim/run-raw-mv.sh:26:     4) export SIM_PREPARE="mkdir -p /tmp/nc && cp $htp/q4_0-raw-mv-hvx.h /tmp/nc/ && sed -i 's/return group_end ?/return false ?/' /tmp/nc/q4_0-raw-mv-hvx.h" ;;`
> `tests/hexagon-sim/raw-mv-sim.c:63:     hvx_vmem(out) = Q6_V_vdelta_VV(hvx_vmem(in), hvx_vmem(raw_mv_scale_fanout));`
> `tests/hexagon-sim/raw-mv-sim.c:67:         bad += out[4 * l] != 18 * lane_owner_scan(l) || out[4 * l + 1] != 18 * lane_owner_scan(l) + 1;`
> `tests/hexagon-sim/raw-mv-sim.c:156:     tiled_reference(tref, clean, x, n_k, n_rows, &t);`
> `tests/hexagon-sim/raw-mv-sim.c:157:     corrupt(raw, n_k);`
> `tests/hexagon-sim/run-raw-mv.sh:55: passes=$(grep -c "^ALL PASS$" "$LOG")`
```text
tests/hexagon-sim/run-raw-mv.sh:56: if [ $rc -eq 0 ] && [ "$passes" -eq "${#PARTS[@]}" ] && grep -q "^ALL LOADS IN PAYLOAD$" "$LOG" \
```
> `tests/hexagon-sim/run-raw-mv.sh:57:    && ! grep -q "CRASH\|FAIL" "$LOG"; then`

The gate does not exercise host scheduling/descriptor marshalling, F16, strided activations, zero/subnormal scales, or the real DMA endpoint. The arithmetic fixture pads its activation allocation to 128-float boundaries, so that fixture alone is not a red-zone test for the final activation copy; the source bound proof above depends on K being a multiple of 32. The over-read harness separately measures raw `hvx_vmemu` addresses and uses exact logical payload lengths, but its backing allocation intentionally has readable guard space so the tracker—not a hardware fault—detects an overrun.

> `tests/hexagon-sim/raw-mv-fixture.h:49:     const int padded = (k + 127) / 128 * 128;`
> `tests/hexagon-sim/raw-mv-fixture.h:51:         x[i] = i >= k ? 0.0f : unit ? (float) ((int) (lcg() % 255) - 127) : ((float) (lcg() % 2001) - 1000.0f) / 250.0f;`
> `tests/hexagon-sim/raw-mv-overread.c:41:             uint8_t * mem = aligned_alloc(128, (payload + 3 * 128 + 127) & ~127UL);`
> `tests/hexagon-sim/raw-mv-overread.c:46:             // payload in the middle of the allocation: a stray load below or above stays in bounds`

### Two-copy behavior and dead code

**Two-copy/non-raw behavior change: REFUTED at source level.** The tiled Q8_0 quantizer was factored into `quantize_128_f32_q8_0`, and the old tiled wrapper still performs the same helper call, replication layout, and writes. Repacked matvec/matmul wrappers still select the same tiled/flat dot functions. The direct raw dot is selected only by the `RAW_Q4_0 == 2` wrapper; the raw flat conversion wrapper remains `== 1`. This is a source-level diff review, not a bit-for-bit build comparison.

> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:126: static inline HVX_Vector quantize_128_f32_q8_0(float * restrict x, HVX_Vector * r_scale) {`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:158: static inline void quantize_block_f32_q8_0_tiled(float * restrict x, uint8_t * restrict y_block) {`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:162:     const HVX_Vector vx_i8 = quantize_128_f32_q8_0(x, &r_scale);`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:840: MATVEC_2D_REPACKED_IMPL(q4_0,       576,  tiled_vec_dot_q4_0_32x1)`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:854: MATVEC_2D_TILES_IMPL(hvx_mv_2d_raw_q4_0_flat, 576, flat_vec_dot_q4_0_32x1, 1)`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:855: MATVEC_2D_TILES_IMPL(hvx_mv_2d_raw_q4_0,      576, q4_0_raw_mv_32x1,        2)`

I found no orphaned production raw-MV helper: the arranger is selected in hvx_mm_matmul, and the new raw dot is installed in its matvec wrapper. The standalone fanout solver is a Python table generator for the geometry header, not a runtime kernel. The shared tiled quantizer still returns the helper vector to the same replication loop and tile writes; this is source-level reuse review, not a build comparison.

> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1665:                 quant_task_func = quantize_f32_q4_0_raw_act;`
> `ggml/src/ggml-hexagon/htp/matmul-ops.c:1671:                 matmul_job_func = hvx_mv_2d_raw_q4_0;`
> `tests/hexagon-sim/solve-raw-mv-fanout.py:1: #!/usr/bin/env python3`
> `tests/hexagon-sim/solve-raw-mv-fanout.py:2: """Derives the two tables of htp/q4_0-raw-mv-geometry.h and prints them as C.`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:176:     for (int b = 0; b < 4; b++) {`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:188:         HVX_Vector * restrict dst = (HVX_Vector *) (y_block + b * 1152);`
> `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:189:         dst[0] = r0;`
