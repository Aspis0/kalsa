# Adreno 750 f16/bf16 batched MUL_MAT view analysis

## Step A — test semantics

`tests/test-backend-ops.cpp:4077 — "const std::array<int64_t, 2> bs;  // dims 3 and 4"`
`tests/test-backend-ops.cpp:4078 — "const std::array<int64_t, 2> nr;  // repeat in dims 3 and 4"`
`tests/test-backend-ops.cpp:4080 — "const int64_t k_v; // size of k in memory, resulting in a non-contiguous view for k_v > k, no view for k_v == 0"`
`tests/test-backend-ops.cpp:4081 — "const uint32_t o; // number of outputs"`
`tests/test-backend-ops.cpp:4148 — "const int64_t k_physical = k_v == 0 ? k : k_v;"`
`tests/test-backend-ops.cpp:4149 — "a = ggml_new_tensor_4d(ctx, type_a, k_physical, m, bs[0],       bs[1]);"`
`tests/test-backend-ops.cpp:4150 — "b = ggml_new_tensor_4d(ctx, type_b, k_physical, n, bs[0]*nr[0], bs[1]*nr[1]);"`
`tests/test-backend-ops.cpp:4161 — "a = ggml_view_4d(ctx, a, k, m, bs[0],       bs[1],       a->nb[1], a->nb[2], a->nb[3], 0);"`
`tests/test-backend-ops.cpp:4162 — "b = ggml_view_4d(ctx, b, k, n, bs[0]*nr[0], bs[1]*nr[1], b->nb[1], b->nb[2], b->nb[3], 0);"`
`tests/test-backend-ops.cpp:4170 — "for (uint32_t i = 1; i < o; ++i) {"`

For each failing tuple, `k_v=2112`, `k=1056`, `o=1`, and the view offset is the literal `0`; `o` only controls repeated outputs.
For F16 and BF16 (2-byte elements) and F32 (4-byte elements):

| tensor | ne | relevant byte strides | view_offs |
|---|---|---|---|
| src0 A | `[1056,128,bs0,bs1]` | `nb00=2`, `nb01=4224`, `nb02=540672`, `nb03=540672*bs0` | `0` |
| src1 B | `[1056,1,bs0*nr0,bs1]` | `nb10=4`, `nb11=8448`, `nb12=8448`, `nb13=8448*bs0*nr0` | `0` |

The no-view `k_v=0` comparison has the same visible `ne`, but src0’s root stride is `nb01=2112` (then `nb02=270336`, `nb03=270336*bs0`); src1’s corresponding physical row/batch strides are `4224`, `4224`, and `4224*bs0*nr0`. Thus `k_v` is the single test parameter that changes the physical K pitch; `nb01` is the first differing tensor term, with higher strides derived from it.

## Step B — dispatch and kernel

`ggml/src/ggml-opencl/ggml-opencl.cpp:19113 — "cl_ulong offset0 = extra0->offset + src0->view_offs;"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:19135 — "GGML_TENSOR_LOCALS(cl_ulong, nb0, src0, nb);"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:19141 — "int r2 = ne12/ne02;"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:19142 — "int r3 = ne13/ne03;"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:19080 — "const enum ggml_type src0t = (src0->type == GGML_TYPE_BF16) ? GGML_TYPE_F16 : src0->type;"`
The `nb01/nb02/nb03` arguments are the view’s `src0->nb[1..3]`; they are not recomputed from visible `ne00`.

For a contiguous tensor with this shape, the existing custom F16/F32 branch reaches:
`ggml/src/ggml-opencl/ggml-opencl.cpp:20314 — "} else if (can_multi_out &&"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:20315 — "backend_ctx->kernel_mul_mat_f16_f32_l4_y8 != nullptr) {"`
`ggml/src/ggml-opencl/ggml-opencl.cpp:20316 — "kernel = backend_ctx->kernel_mul_mat_f16_f32_l4_y8;"`
The exact argument list is `ggml-opencl.cpp:20337-20360`: args 0/2/4 are the three buffers; 1/3/5 are `offset0/offset1/offsetd`; 6–8 are `ne00/ne01/ne02`; 9–12 are `nb00/nb01/nb02/nb03`; 13–15 are `ne10/ne11/ne12`; 16–19 are `nb10/nb11/nb12/nb13`; 20/21 are `ne0/ne1`; 22/23 are `r2/r3`.

`ggml/src/ggml-opencl/kernels/mul_mv_f16_f32_l4.cl:498 — "src0 = (global char *)((global char *)src0 + offset0);"`
`ggml/src/ggml-opencl/kernels/mul_mv_f16_f32_l4.cl:519 — "const ulong off = r0c * nb01 + (i12 / r2) * nb02 + (i13 / r3) * nb03;"`
`ggml/src/ggml-opencl/kernels/mul_mv_f16_f32_l4.cl:520 — "x4_o[o] = (global half4 *)(src0 + off);"`
`ggml/src/ggml-opencl/kernels/mul_mv_f16_f32.cl:63 — "ulong offset_src0 = r0*nb01 + (i12/r2)*nb02 + (i13/r3)*nb03;"`
The l4_y8 kernel uses `nb01/nb02/nb03` and `offset0` for rows and batches, but its inner K load is contiguous `half4`; it assumes `ne00 % 4 == 0` and the y8 launch assumes `ne01 % 8 == 0`.
This case satisfies both (`1056 % 4 == 0`, `128 % 8 == 0`), so the view changes strides, not global/local sizes.

## Step C — fix choice

Chosen fix: gate all Adreno F16/F32 specialized selection when src0 is non-contiguous and use the generic `kernel_mul_mat_f16_f32`. That kernel accepts the same offsets/strides and computes `r0*nb01 + (i12/r2)*nb02 + (i13/r3)*nb03`; this avoids relying on the failing Adreno l4 specialization while preserving contiguous dispatch.

Verbatim fix diff:

```diff
diff --git a/ggml/src/ggml-opencl/ggml-opencl.cpp b/ggml/src/ggml-opencl/ggml-opencl.cpp
@@
             if (src1t == GGML_TYPE_F32) {
+                const bool adreno_noncontiguous_src0 =
+                    backend_ctx->gpu_family == ADRENO && !ggml_is_contiguous(src0);
                 // heuristic for packing more work for Adreno
@@
-                if (ne11 * ne12 < 4) {
+                if (adreno_noncontiguous_src0) {
+                    kernel = backend_ctx->kernel_mul_mat_f16_f32;
+                    nrows = 4;
+                } else if (ne11 * ne12 < 4) {
```

Prediction: all 20 listed failures (10 `(bs0,bs1,nr0)` tuples × F16/BF16) select the generic stride-aware kernel and turn PASS, because every one has `k_v=2112>k` and therefore non-contiguous src0. The no-view and non-batched-view controls remain correct; contiguous Adreno dispatch is unchanged.
