# QDC measurement report — cell #49

## Header

- Job `797032`; job start `12:17:03` (cell job record).
- Raw runner start: `raw/serial.txt:1` — `serial=41c5710f t0=1788365912 t0_iso=2026-09-02T16:18:32Z`.
- Completion: `raw/events.txt:1` — `[12:19:36 e=64] DONE npu_dead=0`; `raw/done.txt:1` — `DONE elapsed=64 npu_dead=0`.
- Device: serial `41c5710f`, Android 16 `sun` build, HTP0 / Hexagon v79. `raw/provenance.txt:2` — `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys`; `raw/list_devices.txt:7` — `ggml-hex: Hexagon Arch version v79`; `raw/list_devices.txt:14` — `HTP0: Hexagon (0 MiB, 0 MiB free)`.
- Stock skel: SHA256 `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044`, certified and shared with banks #43–#48. `raw/kit_sha_host.txt:3` — `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib/libggml-htp-v79.so (CERTIFIED stock, same as banks #43-#48)`.
- Zeropad skel: SHA256 `398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b`. `raw/kit_sha_host.txt:4` — `398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b  lib-zeropad/libggml-htp-v79.so (HTP_ZERO_TILE_PAD diagnostic)`.
- Active skel binding: `raw/skel_active.txt:1-4` records stock for R1/R2 and zeropad for R3/R4.

  > `raw/skel_active.txt:1` — `r1_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044`
  >
  > `raw/skel_active.txt:2` — `r2_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044`
  >
  > `raw/skel_active.txt:3` — `r3_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b`
  >
  > `raw/skel_active.txt:4` — `r4_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b`
- Kit verification: 44/44 listed entries are `OK`; `raw/kit_verify.txt:44` — `lib/libmtmd.so: OK`; `raw/kit_verify.txt:45` — `MANIFEST_LINES=44`. (Citation fixed per audit: the original quoted `lib-zeropad/libmtmd.so: OK` at :44, but that text lives at :24.) The device check ended `raw/list_devices.txt:15` — `EXIT=0`.

## Headline result

**The Class B NaN did not reproduce anywhere in this cell: 0 NaN diagnostics across 4 runs and 20 shape executions.** The four run summaries each report `nan_diags=0` and `544/544 tests passed` (`raw/summary.txt:1-4`). The stock skel is the certified #48 skel, and the first target shape header is at `raw/ops_r1_stock.txt:28`, at the cold process head.

## Binding results

| Run | Arm and active skel | Binding result | Process / gate status |
|---|---|---|---|
| R1 `r1_stock` | Stock / `37131e07…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=0`; `544/544` | Four prepended probes pass; census occurrence passes; `EXIT=0`; pre/post gate pass |
| R2 `r2_stock` | Stock / `37131e07…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=0`; `544/544` | Same as R1; `EXIT=0`; pre/post gate pass |
| R3 `r3_zpad` | Zeropad / `398879cc…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=0`; `544/544` | Four prepended probes pass; census occurrence passes; `EXIT=0`; pre/post gate pass |
| R4 `r4_zpad` | Zeropad / `398879cc…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=0`; `544/544` | Same as R3; `EXIT=0`; pre/post gate pass |

Raw quotes:

> `raw/summary.txt:1` — `r1_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=0   544/544 tests passed`
>
> `raw/summary.txt:2` — `r2_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=0   544/544 tests passed`
>
> `raw/summary.txt:3` — `r3_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=0   544/544 tests passed`
>
> `raw/summary.txt:4` — `r4_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=0   544/544 tests passed`

The four logs end with `EXIT=0` at line 2477. The eight gate files—`gate_pre_*` and `gate_post_*` for R1–R4—each contain the single line `GATE_PASS`. The four `nan_*.txt` and four `failing_*.txt` artifacts are empty.

> `raw/ops_r1_stock.txt:2477`, `raw/ops_r2_stock.txt:2477`, `raw/ops_r3_zpad.txt:2477`, `raw/ops_r4_zpad.txt:2477` — `EXIT=0`
>
> `raw/gate_pre_r1_stock.txt:1`, `raw/gate_pre_r2_stock.txt:1`, `raw/gate_pre_r3_zpad.txt:1`, `raw/gate_pre_r4_zpad.txt:1`, `raw/gate_post_r1_stock.txt:1`, `raw/gate_post_r2_stock.txt:1`, `raw/gate_post_r3_zpad.txt:1`, `raw/gate_post_r4_zpad.txt:1` — `GATE_PASS`

In R1, the four prepended q4_0 evaluations are the headers at lines 28, 36, 44, and 52; their result lines are 35, 43, 51, and 53, each `OK`. The fifth q4_0 occurrence is the census occurrence at line 618, followed by `OK` at line 625. The same line pattern holds in R2–R4.

> `raw/ops_r1_stock.txt:28` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/ops_r1_stock.txt:35`, `:43`, `:51`, `:53`, `:625` — `OK`

## Arithmetic reconciliation

The target run has four prepended q4_0 probes plus one census occurrence per run. The binding extra is four entries:

> `d_run.sh:12` — `EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880'`
>
> `PREREG.md:43` — ``GGML_TEST_EXTRA_MM_FIRST=1`` → 4 probe occurrences run FIRST in a cold
>
> `PREREG.md:44` — `process, then the full stock census (which holds the shape once more → 5`
>
> `PREREG.md:45` — `occurrences/run).`

| Run family | Total reported | Extra entries | Census arithmetic | q4_0 exact headers |
|---|---:|---:|---:|---:|
| #49 | 544 | 4 | `544 − 4 = 540` | `28, 36, 44, 52, 618` per run |
| #48 | 546 | 6 | `546 − 6 = 540` | `592` census + `2452, 2460, 2468` extras; `2496` is the failing-list echo |

The #49 census has one q8_0 and one mxfp4 occurrence per run at lines 626 and 634. Thus the target q4_0 shape executes `5 × 4 = 20` times across R1–R4. The #48 extra list and total are independently visible here:

> `../qdc-8elite-npu-v79-fixA-48/d_run.sh:12` — `EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/summary.txt:1` — `mm_r1: INTERNAL-ERROR=0 graph_failed=0   545/546 tests passed`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/summary.txt:2` — `mm_r2: INTERNAL-ERROR=0 graph_failed=0   545/546 tests passed`
>
> `raw/ops_r1_stock.txt:618` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/ops_r1_stock.txt:626` — `  MUL_MAT(type_a=q8_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/ops_r1_stock.txt:634` — `  MUL_MAT(type_a=mxfp4,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`.

For #48, the five q4_0 text matches are therefore one census execution, three appended q4_0 executions, and one copy in the `Failing tests:` list. Its q8_0 count of two is one census plus the extra q8_0; mxfp4 appears once in the census. This closes both cells at a 540-test census.

## Interpretation vs grid

This is the refined mechanism behind grid case 3, but not a formal case-3 confirmation. In #48, the first occurrence of the shape was mid-census and failed in both runs:

> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r2.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=8.473092) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`

In #49, the same certified stock skel passes when the shape is first at the cold process head (`raw/ops_r1_stock.txt:28`, result `:35`). The later stock-position occurrence also passes (`raw/ops_r1_stock.txt:618` and `:625`), which is expected after the probes: it is no longer a first execution and is subject to warm-up masking.

The evidence therefore narrows the uninitialized-memory family: the poisonous garbage requires dirty VTCM/process state from prior operations; a cold process does not produce it, plausibly because fresh pages are zero. This is an inference from the execution ordering and outcomes, not proof of the allocator state.

This is **not grid case 1 or case 2**: R1/R2 are clean, and the zeropad arm has no live NaN against which to discriminate. The result does **not confirm T1**; **T1 versus T2 remains open**.

> `PREREG.md:60` — `1. R1/R2 NaN present AND R3/R4 clean → **T1 CONFIRMED** (uninit VTCM`
>
> `PREREG.md:63` — `2. R1/R2 NaN present AND R3/R4 NaN persists → **T1 REFUTED as sole cause**;`
>
> `PREREG.md:64` — `T2 promoted; deeper DSP instrumentation post-window.`
>
> `PREREG.md:65` — `3. R1/R2 clean at cold-head BUT the stock-position occurrence (mid-census)`
>
> `PREREG.md:66` — `still NaNs → trigger needs DIRTY VTCM from prior ops, not cold boot;`
>
> `PREREG.md:67` — `uninit-memory family refined; the R3/R4 comparison still binds as 1/2.`

## Zeropad safety

The `HTP_ZERO_TILE_PAD` diagnostic skel is **safe in this cell**. R3 and R4 match stock exactly on the binding total—`544/544`—with zero internal errors, graph failures, NaN diagnostics, or failing artifacts. This is the positive grid-case-4 result: zeroing introduced no regression.

> `raw/summary.txt:1-4` — all four runs report `INTERNAL-ERROR=0 graph_failed=0 nan_diags=0   544/544 tests passed`.
>
> `raw/ops_r3_zpad.txt:2471-2477` — `544/544 tests passed`; `Backend HTP0: OK`; `3/3 backends passed`; `OK`; `EXIT=0`.
>
> `raw/ops_r4_zpad.txt:2471-2477` — `544/544 tests passed`; `Backend HTP0: OK`; `3/3 backends passed`; `OK`; `EXIT=0`.
>
> `PREREG.md:68` — `4. Zeropad arm shows ANY new failure vs the #48 baseline (beyond the NaN) →`
>
> `PREREG.md:69` — `zeroing probe unsafe; T1 readout VOID; banked as a finding.`
>
> `PREREG.md:72` — `Gate letter (per #48 F-8 addendum): every former-passing shape must end OK or`
>
> `PREREG.md:73` — `NS; any FAIL = defect finding.`

The F-8 gate letter is respected: every shape is `OK` or `not supported`, with no `FAIL` in either zeropad run. This establishes safety of the diagnostic skel, not causality for the absent NaN.

## Limitations

1. **Design flaw in #49.** `FIRST=1` was enabled on all four runs, so no run replicated #48’s condition in which the first execution of the shape occurred mid-census. The preregistration expected the stock-position occurrence to remain capable of NaN, but prepending the probes warms the process and masks it. The live reproduction was lost.

   > `d_run.sh:68` — `    export GGML_TEST_EXTRA_MM='$EXTRA' && export GGML_TEST_EXTRA_MM_FIRST=1 && \`
   >
   > `d_run.sh:81-84` — `run_probe r1_stock lib`, `run_probe r2_stock lib`, `run_probe r3_zpad lib-zeropad`, `run_probe r4_zpad lib-zeropad`.

2. **Host-binary confound.** The ARM `test-backend-ops` changed between cells: #48 selected `npu-kit-153fdbafd.tgz`, while #49 identifies `test-backend-ops` as `ca82efa8b` and says it adds `GGML_TEST_EXTRA_MM_FIRST`. The NaN index is also binary-dependent: #46 reports index 305, while #48 reports index 354. Therefore cold-head cleanliness could, in principle, include binary luck; it must not be overclaimed as a pure process-state result.

   > `../qdc-8elite-npu-v79-fixA-48/d_run.sh:9` — `KIT_TGZ="$HOME/kalsa-qdc/npu-v79-cell/npu-kit-153fdbafd.tgz"`
   >
   > `raw/kit_sha_host.txt:5` — `06297299f3216c1f6b1028d7e93dc672f04b983c9055e2c67692f15d06268dd9  bin/test-backend-ops (ca82efa8b, stripped; adds GGML_TEST_EXTRA_MM_FIRST)`
   >
   > `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642` — `[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
   >
   > `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`

3. **Discriminator not completed.** Because the live NaN was absent, #49 cannot choose between T1 and T2. A follow-up must restore the #48 execution order before interpreting zeropad as a causal test.

## Recommendation

Run cell **#50** with the #48 ordering and the same host test binary in both arms:

1. Stock certified skel, #48-style six-entry `EXTRA` appended, **no** `GGML_TEST_EXTRA_MM_FIRST`; require a live q4_0 NaN at the stock-position occurrence.
2. Zeropad skel with the identical configuration; compare against that live stock failure. This is the true T1 discriminator.
3. If stock does not reproduce, stop the comparison and record another non-reproduction; do not call zeropad causal.

Estimated billing is approximately **4 minutes**, based on #49.

> `../qdc-8elite-npu-v79-fixA-48/d_run.sh:80-81` — `run_ops mm_r1 MUL_MAT "$EXTRA"` and `run_ops mm_r2 MUL_MAT "$EXTRA"`; no `GGML_TEST_EXTRA_MM_FIRST` is set in that runner.
