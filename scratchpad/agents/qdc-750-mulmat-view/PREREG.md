# PREREG — Adreno 750 f16/bf16 batched MUL_MAT defect: view/broadcast hypothesis (cell qdc-750-mulmat-view, 6/09)

Owner 6/09: "devi fare tutti e tre" — this is point 3. Written BEFORE any build or device run.

## What is known (evidence on disk)
- The defect is stable across three independent replicas (#16 physical, #55, #58): on QRD8650 (Adreno 750,
  OpenCL compiler E031.45.02.06) `test-backend-ops -o MUL_MAT` gives 905/925 with **20 FAIL**, all of the form
  `MUL_MAT(type_a={f16,bf16},type_b=f32,m=128,n=1,k=1056,b=[bs0,bs1],nr=[nr0,1],per=[0,1,2,3],k_v=2112,o=1)`
  with (bs0,bs1,nr0) ∈ {(1,3,4),(2,1,4),(2,3,4),(4,1,4),(4,3,1),(4,3,4),(8,1,1),(8,1,4),(8,3,1),(8,3,4)} × 2 types
  [scratchpad/agents/qdc-8g3-rerun-58/raw/tbo_mm_sa802498.out, the 20 `FAIL` lines; ALIVE row 41].
  Every failing case is **batched (b≠[1,1]) AND a view (k_v=2112 ≠ k=1056, o=1)**; 14 of 20 also broadcast
  (nr0=4). No non-view, non-batched f16 case fails. Adreno 732 (QRD7675) passes 925/925 with the same kit
  [ALIVE row 36]; Adreno 830 passes [S5 run 6 oracle PASS].
- In-app symptom (S5b run 8, 5/09): forced GPU prefill on the 750 gives greedy ids diverging from CPU at
  index 7 (24/32 differ) [scratchpad/agents/qdc-governor-s5b/raw/sa808770/8-Gen-3_{A,B}_t1_ids.txt].
- Upstream has no report of this symptom (websearch 6/09, PLAN diary). The closest upstream fix is
  **`178a6c449` "opencl: Support broadcast for Adreno MUL_MAT and honor view_offs for Adreno Q8" (#25910,
  merged 2026-07-20)**, and it is **NOT** in our OpenCL pick branch: `git merge-base --is-ancestor 178a6c4
  12f6d9b6d` → false (kalsa/opencl-picks-2026-09 is cherry-picks on base a0cabca6b).

## Hypothesis (falsifiable)
H1: the 750 failures are the Adreno-specific MUL_MAT path mishandling **view offsets and/or broadcast** for
f16/bf16 sources, the same class fixed upstream for Q8 in 178a6c449 (possibly with the f16 path already
covered by that commit, possibly needing the same treatment extended to the f16/bf16 kernels).
Mechanism in the app: with flash attention off, the K·Q attention matmul in prefill is a batched (heads)
MUL_MAT with GQA broadcast (nr=4) reading a VIEW of the K cache — the failing shape family.

## Procedure
0. One variable. Two kits built by the SAME script (`build-kit.sh` in this cell: Docker `arm64-android:v0.7`,
   preset `arm64-android-snapdragon-release`, **GGML_HEXAGON=OFF** in both, targets test-backend-ops + llama-bench):
   **baseline = 12f6d9b6d** (pick branch head) and **candidate = 12f6d9b6d + cherry-pick 178a6c449**. The baseline
   must reproduce the 20 FAIL with this build configuration before the candidate counts; if the baseline does not
   reproduce them, the cell stops and reports (the defect would then depend on the build, not the kernel).
1. Fork: new branch `kalsa/opencl-picks-2026-09+25910` from 12f6d9b6d; `git cherry-pick 178a6c449`; resolve
   conflicts minimally; build must compile for Android (the gov-kit Docker build, same recipe as ALIVE 43/#58).
   Record the kit sha. No other change in the same kit (one variable).
2. QDC session on QRD8650 (one session at a time; after S5b run 9 ends). Run, in this order, with the sha
   verified on device: `test-backend-ops -o MUL_MAT -b GPUOpenCL` → count FAIL (baseline 20);
   `test-backend-ops -o MUL_MAT_ID` (must stay 407/407); `test-backend-ops -o FLASH_ATTN_EXT` (regression guard).
3. Outcomes, decided in advance:
   - **0 FAIL on MUL_MAT, MUL_MAT_ID unchanged** → H1 CONFIRMED at the kernel level. Next: rebase the governor
     branch onto the new pick, pin bump, APK, S5b run "8b" on QRD8650 with force → the pre-registered strict
     oracle must PASS (or PASS-1) on ≥2 same-turn pairs before `GPU_PREFILL_CORRECT.V75` may become true.
   - **20 FAIL unchanged** → H1 REFUTED for the commit as-is. Next step (pre-declared): inspect the f16/bf16
     dispatch in `ggml-opencl.cpp` for the batched+view path (which kernel handles ne02/ne03>1 with nb offsets
     for f16 A) and either port the view_offs/broadcast handling of 178a6c449 to it, or bypass the Adreno
     tiled kernel for views (fall back to the generic kernel) — measured again with the same three tests.
   - **Fewer FAIL (partial)** → report the remaining signatures; H1 partially supported; continue as REFUTED.
   - Any new FAIL in MUL_MAT_ID or FLASH_ATTN_EXT → the pick is rejected regardless of MUL_MAT.
4. Performance guard: `llama-bench` pp512/tg128 on the ship model with the new kit vs #58 (291.11/23.02):
   within ±10% or the difference is reported (a correctness fix that halves prefill is still reported, not hidden).

## What this cell will NOT claim
- Nothing about the 750 in production until the in-app oracle passes (step 3, first bullet).
- Nothing about other SoCs from this kit.

## Amendment 1 (6/09, after reading the cherry-pick, before any device run)
The cherry-pick of 178a6c449 applies cleanly (fork branch `kalsa/opencl-picks-2026-09+25910`, HEAD c7ad97025,
ggml-opencl.cpp +22/−5) but its broadcast/view change is **quantized-only**: the Adreno path normalises BF16 to F16
(`src0t = (src0->type == GGML_TYPE_BF16) ? GGML_TYPE_F16 : src0->type;`) and then excludes F16/F32
(`src0t != GGML_TYPE_F16 && src0t != GGML_TYPE_F32`). For the failing shape (m=128, n=1, k=1056, r2=4) the C++
dispatch selects `kernel_mul_mat_f16_f32_l4_y8` (`mul_mv_f16_f32_l4.cl`), with broadcast via `i12 / r2`, `i13 / r3`
and base offset via `src0 += offset0` (quotes from the fork agent, to be re-verified in ANALYSIS-f16-l4.md).
**Prediction, stated before the run: H1 as-is is REFUTED — the 20 FAIL will persist with the bare cherry-pick.**
**H1′ (refined):** the defect is in how `kernel_mul_mat_f16_f32_l4_y8` (or its dispatch arguments) treats a
batched src0 VIEW (k_v=2112 ≠ k=1056: row stride nb01 and batch stride nb02 are those of the parent tensor, and
view_offs ≠ 0), i.e. an assumption of contiguous rows/batches in the "l4" kernel. Minimal fix candidates, in order
of preference: (a) honour nb01/nb02/nb03 + view offset in the kernel/arguments; (b) gate the l4_y8 selection to
contiguous src0 so views fall back to the generic f16 kernel. The analysis with quoted lines, the chosen fix and the
per-case prediction go to ANALYSIS-f16-l4.md in this cell; the candidate kit becomes pick + fix. Baseline stays 12f6d9b6d.
Kernel-level success criterion unchanged: 0 FAIL on MUL_MAT, MUL_MAT_ID 407/407, FLASH_ATTN_EXT unchanged, then the
in-app oracle (S5b run 8b) before any production change.

## Amendment 2 (6/09, after delta audit #20 GO — before any device run)
- **Compiler-version hypothesis withdrawn**: the 732 raws (qdc-7pg3-govbench-52) contain BOTH `E031.45.02.06` and
  `E031.45.02.16` and pass 925/925 either way, so the discriminator is the GPU (750), not the compiler build. The gate
  stays scoped `gpu_family == ADRENO && !ggml_is_contiguous(src0)`; no version narrowing. The mechanism on the 750
  remains **unexplained** (the l4_y8 kernel is stride-aware); a sub-group/cl_qcom miscompile with strided rows is a
  hypothesis, not a finding. The gate is a workaround with a falsifiable prediction, not a root-cause fix.
- **Regression guards added** (audit #20 F5/F6): (i) on the 750, besides `-o MUL_MAT`, run test-backend-ops with
  the n>1 / o>1 view family visible (`-o MUL_MAT` already includes them; the report must list PASS counts for
  k_v>k cases with n>1 and o>1 separately, not only the 20); (ii) **8 Elite pp512/tg128 with the candidate kit**
  (separate QRD8750 session) before the gate may enter the app pin: the gate reroutes batched V-cache views on every
  Adreno, so a prefill regression on the 830 must be measured, threshold ±10% vs the last 8 Elite CLI numbers on the
  same kit lineage (or reported as a trade-off). Candidate kit = 12f6d9b6d + c7ad97025 (cherry-pick, inert for f16)
  + 2f3b24dee (gate).

## Amendment 3 (6/09 04:15, from S5b run 9 first pair — before the device test)
The in-app strict-oracle FAIL on the 750 is reproduced byte-identically on the 732 (GPU ids sha d4556574… on both;
CPU ids 647f906d… on 732/750/8 Elite), while the 732 passes test-backend-ops MUL_MAT 925/925. So the in-app
divergence is **decoupled from the 20-FAIL family**. Pre-declared readings of the two tests:
- Kernel test on the 750 (unchanged): 0 FAIL with the gate → the gate fixes the batched-view GEMV family; 20 → refuted.
- In-app run 8b (750, forced B, candidate kit in the app pin) AND a mirror on the 732: if the GPU ids change from
  d4556574… (ideally to the CPU 647f906d…) → the l4_y8 non-contiguous path was on the prefill critical path and
  the gate matters in-app; if the ids stay d4556574… → the in-app divergence lives elsewhere (H2 precision, or an A7X
  kernel outside this family) and the gate is a kernel-level correctness fix only. Either way the result is reported
  as such; `GPU_PREFILL_CORRECT` for V73/V75 stays false unless the strict (or PASS-1) oracle passes.

## Amendment 4 — the two remaining guards, pre-registered 6/09 06:00 (before either device run)
Build under test: fork `kalsa/governor-v0.3-on-2f3b24dee` @3bec271fd (governor 9c28322ac + pick c7ad97025 + gate
2f3b24dee); app pin c8d137e; APK from CI run 34025628896 (debuggable, arm64-v8a).

**Guard A — 8 Elite CLI bench with the candidate kit** (QRD8750 session, driver = this cell's d_run.sh with
baseline gpu-kit-12f6d9b.tgz and candidate gpu-kit-2f3b24d.tgz, deadline 40): the BASELINE_GATE of exactly 20
MUL_MAT FAIL does not apply to the 830 (it passes 925/925 on both kits — expected); the driver's baseline gate
must therefore be bypassed for this board (`--no-baseline-gate` or an env flag added before launch, audited),
and the reading is: MUL_MAT/MUL_MAT_ID/FA identical on both kits (925/407/226-229), and **pp512/tg128 candidate
vs baseline within ±10%**. Prior: the gate reroutes the batched V-cache-view matmuls to the generic kernel on every
Adreno; on the 830 a prefill regression is plausible. Pre-declared readings: |Δpp512| ≤ 10% → the gate is
acceptable as-is for the pin; 10–25% → the gate must be narrowed to the 750 (A7X only, or a 750-specific check) before
the pin; > 25% → the gate is rejected for the pin and stays a bench-only experiment.

**Guard B — run 8b in-app on the 750** (QRD8650 session, S5b driver, APK c8d137e, `ABABAB 85`, force on B, same
prompt/oracle as run 8): pre-declared readings (Amendment 3): B ids ≠ d4556574… and == CPU 647f906d… → the gate
was on the prefill critical path AND fixes the in-app divergence (then, and only then, `GPU_PREFILL_CORRECT.V75`
may be reconsidered with ≥2 oracle-PASS pairs); B ids == d4556574… → the in-app divergence is not this defect
(A7X property, H2/H3 open), the gate stays a kernel-level fix, V75 stays false; anything else → reported as new.
B/A TTFT ratio reported against run 8's 0.505 (the gate should not change prefill speed materially: ±10%).
Order: Guard B first if the APK is ready when the next 8650 session opens; Guard A on the 8750 either way.
