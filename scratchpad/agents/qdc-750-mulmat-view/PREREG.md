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
