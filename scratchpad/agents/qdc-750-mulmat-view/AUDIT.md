# AUDIT — 750 f16 MUL_MAT analysis + gate (qdc-750-mulmat-view)

## Findings

F1 — CONFIRMED (analysis line-by-line). All quoted file:line anchors reproduce in the fork
worktree kalsallama-wt-oclpicks-25910: test-backend-ops.cpp:4077-4170 (bs/nr/k_v/o semantics;
the failing view is created at :4161-4162 with view_offs `0` — `o` only repeats outputs);
l4 kernel `mul_mv_f16_f32_l4.cl:498` `src0 = (global char *)((global char *)src0 + offset0);`,
`:519` `const ulong off = r0c * nb01 + (i12 / r2) * nb02 + (i13 / r3) * nb03;`, `:520`
`x4_o[o] = (global half4 *)(src0 + off);`; generic `mul_mv_f16_f32.cl:63`
`ulong offset_src0 = r0*nb01 + (i12/r2)*nb02 + (i13/r3)*nb03;` — the generic kernel is
stride/batch/offset-aware exactly as claimed (also :65 `x = (global half *)(src0 +
offset_src0)`), and r2/r3 are computed identically for both selections. Tensor table correct:
nb01 = 2×2112 = 4224, k_v=k nb01 = 2112, 4224 % 16 = 0, 2112 % 16 = 0 (half4 alignment holds
for both layouts).
F2 — CONFIRMED (the unexplained core, as stated). The l4_y8 kernel IS stride-aware (quotes in
F1) and the visible ne/local sizes are unchanged by the view (1056 % 4 = 0, 128 % 8 = 0), so
"the view changes strides, not sizes" is right — and the analysis does not identify what
differs on the 750. The kernel's sub-group machinery (`intel_reqd_sub_group_size` /
`cl_qcom_reqd_sub_group_size` / `qcom_reqd_sub_group_size("half"|"full")`,
mul_mv_f16_f32_l4.cl:12-18) is a plausible miscompile vector with strided rows — PLAUSIBLE,
unproven; the analysis should label it a hypothesis.
F3 — REFUTED (my hostile check): the compiler-version discriminator does not hold. The
qdc-7pg3-govbench-52 raws contain BOTH `Compiler E031.45.02.06` and `Compiler E031.45.02.16`
lines — the 732 also ran with .02.06 and still passed 925/925 — so a version-narrowed gate
(upstream-#26476 style; the backend already parses the compiler version,
ggml-opencl.cpp:152,163,297 `get_adreno_cl_compiler_version`) would be WRONG: the defect may
not be version-conditional. The chosen board-based scope (`gpu_family == ADRENO`) is the
right one.
F4 — CONFIRMED (gate 2f3b24dee). `const bool adreno_noncontiguous_src0 =
backend_ctx->gpu_family == ADRENO && !ggml_is_contiguous(src0);` and the dispatch
`if (adreno_noncontiguous_src0) { kernel = backend_ctx->kernel_mul_mat_f16_f32; nrows = 4; }
else if (ne11*ne12 < 4) { …1row } else if (adreno_use_lane_split …) { …l4_dr_lq } …` —
the gate routes the whole F16×F32 branch (non-contiguous src0, all Adreno) to the generic
kernel with nrows=4. Contiguous cases (k_v == k, nb01 == ne00×2) are NOT gated ✓; the failing
k_v=2112 cases (nb01=4224 ≠ 2112) are ✓ — the prediction "all 20 turn PASS" is exactly the
gate's behavior, falsifiable by the three pre-registered tests.
F5 — MINOR, PLAUSIBLE. The gate also reroutes in-app batched VIEW matmuls on the 8 Elite and
the 732 (K-cache views in prefill K·Q with GQA) to the slower generic kernel — a performance
regression on the 830 is plausible (the l4_y8 is the fast path; pp512 #58 = 291 t/s was the
750). The PREREG's perf guard covers only the 750 pp512 ±10% — an 8-Elite pp512 bench is
ABSENT from the device test list — add it before adopting the gate.
F6 — MINOR, CONFIRMED. The pre-registered test list lacks an explicit n>1-view case (the
failing family has o=1; `o` only repeats outputs) — add `o=2` (or a view with a non-zero
`view_offs`) MUL_MAT on the 750 to the regression matrix; MUL_MAT_ID 407/407 and
FLASH_ATTN_EXT guards are present ✓.
F7 — CONFIRMED-checks: the baseline-first procedure (step 0, reproduce the 20 FAIL on
12f6d9b6d before counting the candidate) is sound; the fix-as-chosen (option b of Amendment
1) matches the pre-registered Amendment 1; the bare 178a6c449-cherry-pick prediction (H1
REFUTED — the change is quantized-only, F16/F32 excluded) was stated before the run ✓.

## Verdict

GO — build the candidate kit (12f6d9b6d + 178a6c449 + the 2f3b24dee gate) and run the
pre-registered device test on QRD8650. 0 blockers, 2 minors (F5: add an 8-Elite pp512
perf-regression bench to the same session; F6: add an o>1 / non-zero-view_offs MUL_MAT case),
1 nit (F2's unproven hypothesis should be labelled). Gate scope recommendation: keep
`gpu_family == ADRENO && !ggml_is_contiguous(src0)` as-is — the all-Adreno board-based scope
is correct; do NOT narrow by compiler version (F3 refuted).