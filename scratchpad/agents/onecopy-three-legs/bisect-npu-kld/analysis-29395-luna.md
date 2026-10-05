# Forensic analysis: Hexagon change 07fc586e3 and Q4_0 N=1 KLD

## Conclusion

For a Q4_0 weight / F32 activation HVX path, the main arithmetic change in `07fc586e3` is the Q8_0 activation quantizer in `hvx-mm-kernels-tiled.h`. It changes activation scale granularity from one scale for 128 values to one scale per 32 values and changes how those four scales are packed into the tiled activation vectors. The Q4_0 dot kernel reads `v_act[8]` as the activation scale for each 32-wide K tile. A scale ordering/packing error here would make the products systematically wrong while leaving the Q4_0 nibble dot products intact. This is the leading code hypothesis for the reported regression, though the source inspection alone does not prove the new `vp01`/`vp23` packing is wrong.

The PR description says the old shared scale was itself an N=1 accuracy defect: “space for a scale every 32 values” (PR #29395, Overview). That supports the new granularity, not the observed large quality loss. Therefore the first experiment should isolate the new scale encoding from all DMA/control-flow changes by reverting only the Q8_0 quantizer hunk. There is no `opt_mm_select` value that restores the old quantizer: `GGML_HEXAGON_MM_SELECT=1` selects HVX-only, but this commit’s HVX dynamic quantizer is still used.

Reported test context: S23 / HTP v73, Q4_0 tiled LFM2 2.6B, N=1, `-dev HTP0`; measured KLD increases from 0.005357 to 0.044953 and PPL(Q) drops below the CPU base. This report is source analysis only; no build or measurement was run.

## Ranked hypotheses

### 1. Q8_0 per-32 scale generation or scale-vector packing is mismatched — high priority to test

**Exact changed hunk:** `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:132–146` before versus `:124–160, :174–206` after.

Before the commit, lines 132–146 reduced the maximum after converting the full 128-value block into half precision, derived one scale, and replicated it:

```c
HVX_Vector vmax_hf = hvx_vec_reduce_max_f16(hvx_vec_abs_f16(vx01_hf));
vmax_hf            = hvx_vec_reduce_max2_f16(hvx_vec_abs_f16(vx23_hf), vmax_hf);

HVX_Vector vd_qf16 = Q6_Vqf16_vmpy_VhfVhf(vmax_hf, Q6_Vh_vsplat_R(0x2008));
HVX_Vector vd_hf   = Q6_Vhf_equals_Vqf16(vd_qf16);
...
HVX_Vector r_scale = hvx_vec_repl_f16(vd_hf);
```

After the commit, lines 124–160 calculate four maxima from the four 32-float HVX vectors, convert them into two interleaved half vectors, form scales, then shuffle the scale vectors:

```c
HVX_Vector vmax0_sf = hvx_vec_reduce_max_f32(hvx_vec_abs_f32(vx[0]));
HVX_Vector vmax1_sf = hvx_vec_reduce_max_f32(hvx_vec_abs_f32(vx[1]));
HVX_Vector vmax2_sf = hvx_vec_reduce_max_f32(hvx_vec_abs_f32(vx[2]));
HVX_Vector vmax3_sf = hvx_vec_reduce_max_f32(hvx_vec_abs_f32(vx[3]));
...
HVX_Vector vmax01_hf = Q6_Vh_vdeal_Vh(Q6_Vhf_equals_Wqf32(Q6_W_vcombine_VV(vmax1_qf, vmax0_qf)));
HVX_Vector vmax23_hf = Q6_Vh_vdeal_Vh(Q6_Vhf_equals_Wqf32(Q6_W_vcombine_VV(vmax3_qf, vmax2_qf)));
...
HVX_Vector vd01_inv_hf = hvx_vec_inverse_f16(vd01_hf);
HVX_Vector vd23_inv_hf = hvx_vec_inverse_f16(vd23_hf);
...
HVX_VectorPair vp01 = Q6_W_vshuff_VVR(vd01_hf, vd01_hf, -64);
HVX_VectorPair vp23 = Q6_W_vshuff_VVR(vd23_hf, vd23_hf, -64);
```

The packing and output hunk at lines 174–206 is:

```c
for (int b = 0; b < 4; b++) {
    HVX_Vector v_act = Q6_V_vror_VR(vx_i8, b * 32);
    HVX_Vector r_scale;
    if (b == 0) {
        r_scale = Q6_V_lo_W(vp01);
    } else if (b == 1) {
        r_scale = Q6_V_hi_W(vp01);
    } else if (b == 2) {
        r_scale = Q6_V_lo_W(vp23);
    } else {
        r_scale = Q6_V_hi_W(vp23);
    }
    ...
    HVX_Vector * restrict dst = (HVX_Vector *) (y_block + b * 1152);
    ...
    dst[8] = r_scale;
}
```

**Why this can explain the symptom:** the Q4_0 tiled dot kernel loops in 32-wide K tiles, points at `y_q + kt * 1152`, reads that tile’s activation vector at index 8, and multiplies it by the weight scale:

```c
uint32_t n_k_tiles = n / 32;
for (uint32_t kt = 0; kt < n_k_tiles; kt++) {
    const HVX_Vector * restrict vptr = (const HVX_Vector *) (tile_ptr + kt * 640);
    const HVX_Vector * restrict v_act = (const HVX_Vector *) (y_q + kt * 1152);
    ...
    HVX_Vector v_scale_w = vptr[4];
    HVX_Vector v_scale_a = v_act[8];
    HVX_Vector v_scale_comb = hvx_vec_mul_f16_f16_to_f32_lower32(v_scale_w, v_scale_a);
```

So the new format is compatible only if the scale stored in each successive 1152-byte activation tile is the scale used to quantize that corresponding 32-element K slice. If `vdeal`/`vshuff` plus low/high extraction associates `vd0..vd3` with a different `b` than the quantized bytes selected by the rotate/delta sequence, each 32-element dot gets multiplied by the wrong scale. That is a systematic per-slice value error and can produce exactly the kind of broad N=1 logit distortion in the measurements. Q8_0 stores no q8_1 sum/offset field; the Q4_0 dot reads only `v_act[8]`, so a Q8_1 sum-as-Q8_0 mismatch is not the direct mechanism for this Q4_0 path.

The 32-wide scale choice itself is consistent with Q4_0’s tiled dot loop and `vptr[4]` weight scale. The likely failure surface is the new scale values / lane ordering / scale arithmetic, not the choice of 32 as the scale block size. The commit changes scale arithmetic from a half reduction over converted inputs to an F32 max followed by half scale and reciprocal math; v73-specific behavior in that sequence is another candidate within this same hunk.

**Cheapest confirmation:** make a one-hunk local revert of only the Q8_0 quantizer function to its parent implementation (shared scale, keeping the commit’s DMA and scheduling changes), rebuild the same target, and rerun the same KLD invocation. A return toward 0.005357 would identify this hunk. If it does, follow with a narrower variant that keeps four scales but replaces only the new `vp01`/`vp23` packing with independently replicated scales in the q8_1-style order, or dump the four written `dst[8]` scale vectors and compare each with its corresponding 32-value max and the scale consumed by `tiled_vec_dot_q4_0_32x1`.

**Upstream context:** PR #29395’s overview says the previous N=1 problem was one activation scale per 128 values although the tiled format has room for one per 32; it lists “Improved Q8_0 accuracy” as a goal. The PR also says DMA validation covered Gemma4 and Qwen3.5 multimodal workloads. That is not evidence that this exact Q4_0 LFM2 decode path on v73 was measured. [PR #29395](https://github.com/ggml-org/llama.cpp/pull/29395)

### 2. Direct DMA activation staging / row-tail handling — lower likelihood for these exact widths

**Exact changed hunk:** `ggml/src/ggml-hexagon/htp/hvx-mm-kernels-tiled.h:979–1008` and `matmul-ops.c:568–612` before versus `hvx-mm-kernels-tiled.h:1162–1182` and `matmul-ops.c:624–694, :696–723, :1902–1943` after; VTCM allocation is `matmul-ops.h:482–630`.

Before the commit, the block quantizer fetched and copied each Q8_0 block into a zero-filled scratch block, including a special partial-final-block branch:

```c
hex_l2fetch(src_ptr, qk * sizeof(float), qk * sizeof(float), 1);
if (c == nb - 1) {
    uint32_t active_elements = ne0 - c * qk;
    hvx_splat_f32_a(tmp_data, 0.0f, qk);
    hvx_copy_f32_aa(tmp_data, src_ptr, active_elements);
} else {
    hvx_copy_f32_aa(tmp_data, src_ptr, qk);
}
quantize_block_f32_q8_0_tiled((float *) tmp_data, dst_ptr);
```

The commit changes the Q8_0 block kernel to read the caller’s source directly, passing the raw pointer into the quantizer:

```c
(void) tmp_data;
...
const float * restrict src_ptr = (const float *) ((const uint8_t *) src + r * src_row_size + c * qk * sizeof(float));
...
quantize_block_f32_q8_0_tiled((float *) src_ptr, dst_ptr);
```

The added transfer calculates the element-sized row bytes and issues strided DMA into the VTCM staging rows:

```c
const size_t row_bytes = ne0 * elem_size;
...
dma_queue_push(dma_q, dma_make_data(dst_base, src_addr),
               dst_row_size, src1_nb1, row_bytes, m_rows);
dma_queue_pop(dma_q);
```

The caller sets raw row stride to a 128-value Q8 block boundary and stages before quantization:

```c
mmctx->vtcm_act_raw_stride = hex_round_up(ne10 * sizeof(float), QK_Q8_0_TILED * sizeof(float));
...
hvx_mm_transfer_src1_dma(octx, kparams, src1, mmctx->vtcm_act_raw, mmctx->vtcm_act_raw_stride, 0, src1_nrows);
...
work_queue_run(octx->ctx->work_queue, quant_task_func, mmctx, n_quant_tasks);
```

**Why it is less likely here:** 2048, 6144, and 10752 are each divisible by 128, so the block quantizer has no partial 128-value final block. Their FP32 row lengths are exactly 8192, 24576, and 43008 bytes, each divisible by 128; therefore the newly padded destination stride equals the actual row byte count. For contiguous rows, the quoted DMA uses `src1_nb1` as its source stride, and all rows are consumed only after `dma_queue_pop`. Those facts make a missing tail-zero or simple stride/padding fault unlikely for the reported shapes. Non-contiguous batched activations or a bad DMA mapping remain possible but are not indicated by these widths.

The VTCM layout gives quantized activation data a persistent region, then lets raw staging overlap the compute-only region:

```c
VTCM_LAYOUT_ALLOC(off_group_a, off_src1, src1_sz);
...
VTCM_LAYOUT_ALLOC(off_group_b, off_src0, src0_sz);
...
VTCM_LAYOUT_ALLOC_OPTIONAL(off_group_c, off_act_raw, act_raw_sz, act_raw_sz > 0);
...
L->total_bytes = off_group_a + hex_smax(group_b_size, group_c_size);
```

The transfer runs before the quantizer and matmul, while quantized activations occupy `off_src1`, so the apparent overlap is phase-based rather than an obvious live alias. I found no direct evidence that this alone corrupts the N=1 output.

**Cheapest confirmation:** retain the new 32-scale quantizer but locally restore the old per-block staging/copy/zero-tail behavior for Q8_0 activations, using the already present `tmp_data` path. Same KLD test. This is the second one-hunk test after the quantizer-scale revert. For an instrumented non-build check, record the 2048/6144/10752-row bytes and source/destination strides at DMA submission; for these exact shapes they should match the values above.

### 3. Another fused matmul route chooses the wrong quantizer or activation row — conditional / lower confidence

For ordinary Q4_0, the Q8_0 tiled row size and quantizer are selected because `htp_mm_weight_has_offset(Q4_0)` is false; the generic quantization task dispatch is:

```c
quant_task_func = htp_mm_weight_has_offset(src0->type) ? quantize_f32_q8_1_tiled : quantize_f32_q8_0_tiled;
```

The Q4_0 mat-vec registration at `matmul-ops.c:788` is:

```c
MATVEC_2D_REPACKED_IMPL(q4_0, 576, tiled_vec_dot_q4_0_32x1)
```

The fused NX path has corresponding Q4_0 registration at `matmul-ops.c:721` and its own q8 activation row choice based on `htp_mm_weight_has_offset(wtype)` in `matmul-ops.h:525`. That still selects Q8_0 for Q4_0; I found no visible q8_1 sum/offset reinterpretation in the Q4_0 dot kernel. The fused path consumes the same tiled activation representation, so a scale packing defect from hypothesis 1 would affect it too.

A batch/chunk bookkeeping error could still arise because this commit replaces in-worker quantization with an explicit DMA-then-quantize phase and renames the activation-row state. However the measured N=1 decode has one activation row, and the shown setup uses the matching row count when scheduling quantization. This does not currently outrank the scale hunk.

**Cheapest confirmation:** if the actual model graph fuses MUL_MAT+ADD, compare KLD with the fusion disabled while holding `GGML_HEXAGON_MM_SELECT` and all else fixed. Otherwise force HVX-only with `GGML_HEXAGON_MM_SELECT=1` to distinguish an HMX selection difference from the HVX Q4_0 path. `MM_SELECT=1` does not revert the commit’s dynamic quantizer, so it cannot by itself confirm the parent-vs-commit change.

## Other requested checks

- The Q8_0 quantizer hunk is the only commit hunk found that changes the arithmetic format/interpretation consumed by a Q4_0 tiled HVX dot.
- The q8_1 quantizer contains sums/offsets for offset weight formats; Q4_0 takes q8_0 by the current selector and the Q4_0 dot kernel reads activation scale at `v_act[8]`, not q8_1’s offset slot.
- For the tested K widths, the DMA staging sizes align exactly and the old zero-padding branch is not entered.
- The VTCM layout does introduce an overlapping staging region but its phase ordering is transfer → quantize → matmul, with the quantized activation buffer separate.
- `git log upstream/master` after `07fc586e3` shows later Hexagon commits including Q2_K/Q3_K activation quantizer work and matmul scalability changes, but no later commit message identifies or fixes a Q8_0 N=1 accuracy regression. The later `a868c3e3c` tiled-kernel diff adds separate Q8_1 sums16/Q2_K support and does not replace the Q8_0 per-32 scale block written here. This is absence of a named fix in the fetched history, not proof that all downstream correctness issues were resolved.
