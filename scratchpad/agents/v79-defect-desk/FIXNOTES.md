# v79 defect desk — FIXNOTES (rev-3)

Writer: same desk. No push. Compile-unverified on this Mac (no Hexagon SDK); build via Docker kit pipeline.

## REPORT.md per finding

- **F1 — DISAGREE with audit 35/36 and with ARBITRATION F1-upheld.** Kept 36/36 on test-m % 32 ≠ 0. The alleged counterexample is a log-interleave misread:
  - `ops_mm_ph1.txt:1794` header `q4_0 m=576,n=512,k=576`
  - `:1803` `OK` (m=576 verdict)
  - `:1801` INTERNAL-ERROR + `:1802` `graph_compute failed` belong to the *next* test (`:1804` `m=1 n=2048 k=8192`, `:1805` FAIL) — same pattern as n=4 OK `:105` vs n=5 stderr `:104`
  - m=576 is **absent** from `Failing tests:` `:2533-2570` (37 FAILs = 36 INTERNAL-ERROR + 1 Class B NaN)
  - Later DSP gates exist but did not fire: alignment `matmul-ops.c:2328`, VTCM `if (vtcm_used > vtcm_budget) return -1` `:2369-2372`, DMA height `(n_cols / 32) * n_k_tiles` `:2488`
  - Also: n=16 is 4/5 quants (iq4_nl not in failing list `:2560-2563`)

- **F2 — accepted.** Added m=1,n=64 trace: host m = `src1->ne[1]` = 64 > 4 → HMX (`ggml-hexagon.cpp:2196-2199`); DSP n = `src0->ne[1]` = 1, 1%32≠0 → fail (`matmul-ops.c:2978-2979,:2327`). type+blocks: q4_0 INTERNAL-ERROR is `:1816` (ref-buf `:1812-1813` `type=q4_0` `blocks=8`; header `:1819`); `:1826` is q4_1's (ref-buf `:1822-1823`). Replaced "n≤4 → HVX" with host-m = test-n.

- **F7 + ARBITRATION — accepted as OPEN, refused audit's promote-to-primary.** Class B is two candidates, neither established. (1) fp16 acc disfavored by bound + q8_0 same path `:655-671`. (2) scale-pad undermined: q8_0 `hvx_vmem(+1024)` `:442` reads 1024-1151, tile 1088 (`matmul-ops.h:25`) aligned 1152 (`:32`) — 64 valid + 64 pad, identical to q4_0 `:49` / tile 576 aligned 640. Open HVX question left for device: does `Q6_V_lo_W(Q6_W_vshuff_VVR(v_sc,v_sc,-2))` consume only low 64 B? mxfp4 clamp `:340-345` kept as real. VTCM over-budget (`matmul-ops.c:2369-2372`) excluded (would INTERNAL-ERROR). VTCM **layout undercount** (silent corruption, no INTERNAL-ERROR) is **not** excluded — AUDIT-2 D-F1 — remains a device-discrimination candidate.

- **F11 — accepted.** One-sentence proof: any currently-passing HMX shape already satisfies DSP `src0->ne[1]%32==0` at `matmul-ops.c:2327/2596/2841`, so tightening the host gate cannot regress a passing shape.

- **F12 — verified, dims present.** See below.

- **F13 — partial disagree.** Added A4 `q4_0 m=576 n=512 k=576` as aligned HMX *control* (today OK `:1803`), not as INTERNAL-ERROR diagnostic. Class A %32 does not need a cell to diagnose.

## Code fix

Repo `/Users/marco/Projects/kalsallama`, branch `kalsa/npu-judge-v79` (verified `git branch --show-current` before edit). Gate is inside `ggml_hexagon_matmul_is_hmx_eligible`. Did not touch `supports_op` or any DSP file. HVX fallback already at `:2595-2596`.

**Second caller.** `mm_is_hmx_eligible` (`ggml-hexagon.cpp:3469-3482`) is the other call site; `is_mergeable_mul_mat` (`:3488`: `return ggml_is_quantized(t->src[0]->type) && !mm_is_hmx_eligible(t);`) keys merging on `!eligible`. Unaligned-N quantized MUL_MAT pairs therefore flip from "HMX-eligible, not merged" to mergeable; merged ops run the non-HMX HVX path. Safe: those shapes were already failing on DSP (`matmul-ops.c:2327` → `:3044`); the merged-op path is now consistently HVX. Aligned-N merge decisions bit-identical (`:2172` OR; `ne01_padded` at `:2579` and `:3480` both `is_repack ? hex_round_up(...) : ...`).

**Dead `ne01_padded % 32` clause.** For the five repack types `ne01_padded = hex_round_up(ne01, 32)` (`:2579`/`:3480`) is always a multiple of 32, so `ne01_padded % 32 != 0` is always false; for F16/F32 `ne01_padded = ne01`, so the first clause is implied by the logical one. Kept deliberately so the parameter stays used (still consumed by `ggml_hexagon_precompute_hmx_mm_params` via `:2590`).

```
--- a/ggml/src/ggml-hexagon/ggml-hexagon.cpp
+++ b/ggml/src/ggml-hexagon/ggml-hexagon.cpp
@@ -2168,8 +2168,8 @@ static bool ggml_hexagon_matmul_is_hmx_eligible(
     const int ne12  = src1->ne[2];
     const int wtype = src0->type;
 
-    // HMX weight tile requires N to be 32-aligned.
-    if (ne01_padded % 32 != 0) {
+    // Host gate must match the DSP %32 contract on logical N (src0->ne[1]), not just padded N.
+    if (ne01_padded % 32 != 0 || src0->ne[1] % 32 != 0) {
         return false;
     }
```

On-disk after commit (`ggml-hexagon.cpp:2171-2174`):
```
    // Host gate must match the DSP %32 contract on logical N (src0->ne[1]), not just padded N.
    if (ne01_padded % 32 != 0 || src0->ne[1] % 32 != 0) {
        return false;
    }
```

Logic: if `src0->ne[1] % 32 != 0`, return false → existing HVX path. If `src0->ne[1] % 32 == 0`, behaviour unchanged (padded check still held for those shapes). `ne01_padded` kept in the condition so the parameter stays used.

**Compile-unverified on this machine.** No Hexagon SDK. Syntax/logic review + `git diff` only.

## Commit

- hash: `736ddd206b68bb88fd4f625a1ee9593794528c11`
- short: `736ddd206`
- msg: `hexagon: gate HMX eligibility on logical ne01 %32 (host must match DSP contract)`
- **not pushed**

## F12 outcome

Dims **are** on #47 execute-op lines (`k:m x k:n`). Full logs: `scratchpad/agents/qdc-8elite-npu-v79-ppl-v/raw/` (the `qdc-8elite-npu-v79-judge/raw/` copies are 12-line stubs). All HMX `MUL_MAT` `src0->ne[1]` %32-aligned (0 unaligned).

- ship `qdc-8elite-npu-v79-ppl-v/raw/ppl_ship_htp.dev.txt:26872`: `2048:6144 x 2048:1024|...|hmx-tiled` — 6144%32=0
- olmoe `qdc-8elite-npu-v79-ppl-v/raw/ppl_olmoe_htp.dev.txt:20398`: `2048:2048 x 2048:1024|...|hmx-tiled` — 2048%32=0

Unique HMX src0 ne1: ship {512,2048,6144,10752}; olmoe {64,1024,2048}. Host fix inert on these models.

## Disagreements

1. **AUDIT F1 / ARBITRATION F1-upheld.** "still INTERNAL-ERROR" for m=576 is false. Quote ARBITRATION.md:7-11 attributing `:1800-1801` to m=576; quote raw `:1803` OK and failing-list absence. The 36/36 %32 claim stands.
2. **AUDIT F8 promote-to-primary** — already refuted by ARBITRATION (1024+128=1152>1088). Followed arbitration: neither Class B theory established. Did not follow audit "Fix text: Demote theory #1 to ruled out and promote theory #2".
3. **AUDIT F13 "Class A DOES need a cell for the m=576 outlier"** — m=576 is not an outlier fail. A4 is a no-regression control, not a diagnostic for a second Class A gate.
4. **AUDIT-2 E-F2 pin `736ddd206`.** Accepted as "not 93e9592fa". Future kit is branch tip `153fdbafd` (gate `736ddd206` + `GGML_TEST_EXTRA_MM` `153fdbafd`); A-arms require the tip. AUDIT-2:244 stopped at the gate commit; HEAD has moved.

## Revision log

- **rev-2:** F1 dissent, F2/F7/F11/F12/F13, host gate commit `736ddd206`.
- **rev-3 (AUDIT-2, 2026-09-02).** No code change, no push.
  - Kit pin → `153fdbafd`; A-arms require it.
  - q4_0 m=1 n=64 INTERNAL-ERROR `:1816` not `:1826` (`:1812-1813` q4_0 `blocks=8`; `:1826` is q4_1).
  - F12 paths → `qdc-8elite-npu-v79-ppl-v/raw/`.
  - Second caller `is_mergeable_mul_mat` `:3488`; dead `ne01_padded % 32` clause documented.
  - Class B: VTCM undercount not excluded.
