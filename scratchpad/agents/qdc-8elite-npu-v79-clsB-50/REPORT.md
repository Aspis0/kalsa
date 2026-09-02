# QDC measurement report — cell #50

## Header

- Job `797063`.
- Device: serial `f25c433a`, Android 16 `sun`, HTP0 / Hexagon v79. `raw/provenance.txt:1` — `f25c433a`; `raw/provenance.txt:2` — `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys`; `raw/list_devices.txt:7` — `ggml-hex: Hexagon Arch version v79`.
- This is a different unit from #48 and #49: #48 `raw/provenance.txt:1` — `b4bd0901`; #49 `raw/provenance.txt:1` — `41c5710f`; #50 `raw/provenance.txt:1` — `f25c433a`.
- Timing: runner start `raw/serial.txt:1` — `serial=f25c433a t0=1788367238 t0_iso=2026-09-02T16:40:39Z`; completion `raw/events.txt:1` — `[12:41:46 e=68] DONE npu_dead=0`; `raw/done.txt:1` — `DONE elapsed=68 npu_dead=0`.
- Stock skel SHA256: `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044`.
- Zeropad skel SHA256: `398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b`.
- #48 tbo SHA256 used by all four runs: `5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`.

  > `raw/kit_sha_host.txt:3` — `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib/libggml-htp-v79.so (CERTIFIED stock, same as banks #43-#49)`
  >
  > `raw/kit_sha_host.txt:4` — `398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b  lib-zeropad/libggml-htp-v79.so (HTP_ZERO_TILE_PAD diagnostic)`
  >
  > `raw/kit_sha_host.txt:5` — `5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f (the #48 reproduction binary, = kit-v3 bin/test-backend-ops; ALL #50 runs use this)`
  >
  > `raw/skel_active.txt:1` — `r1_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/skel_active.txt:2` — `r2_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/skel_active.txt:3` — `r3_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/skel_active.txt:4` — `r4_zpad active_skel=398879cc6c7e02b5b9d943d0f64c453a446150b4c0c2000edc41d8c2b830ca5b tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`

- Configuration: #48 `EXTRA` appended, with `FIRST` unset. `d_run.sh:4` — `All runs use bin/test-backend-ops-153f (the #48 reproduction binary), EXTRA APPENDED (no FIRST).`

  > `d_run.sh:14` — `EXTRA='q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,2880;q4_0:2880,32,1024;q8_0:2880,32,2880;q4_0:2880,64,2880'`
- Kit/list-device binding: `raw/kit_verify.txt:45` — `lib/libmtmd.so: OK`; `raw/kit_verify.txt:46` — `MANIFEST_LINES=45`; `raw/list_devices.txt:15` — `EXIT=0`.

## Headline result

**Grid case 2, binding:** the live NaN reproduced on stock in both runs and persisted on the zeropad skel in both runs. Therefore **T1 (uninitialized VTCM scale-pad) is refuted as the sole cause; T2 is promoted.** Zeroing `[tile_size, aligned_tile_size)` does not cure the defect.

> `raw/summary.txt:1` — `r1_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:2` — `r2_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:3` — `r3_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:4` — `r4_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`

## Binding results

| Run | Arm / active skel | Binding result | NaN index | Test / gate status |
|---|---|---|---:|---|
| R1 `r1_stock` | Stock / `37131e07…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=1`; `545/546` | 388 | Single census q4_0 failure; test `EXIT=1`; pre/post pass |
| R2 `r2_zpad` | Zeropad / `398879cc…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=1`; `545/546` | 359 | Single census q4_0 failure; test `EXIT=1`; pre/post pass |
| R3 `r3_stock` | Stock / `37131e07…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=1`; `545/546` | 353 | Single census q4_0 failure; test `EXIT=1`; pre/post pass |
| R4 `r4_zpad` | Zeropad / `398879cc…` | `INTERNAL-ERROR=0`, `graph_failed=0`, `nan_diags=1`; `545/546` | 334 | Single census q4_0 failure; test `EXIT=1`; pre/post pass |

The runner order is explicitly stock, zeropad, stock, zeropad:

> `d_run.sh:84-87` — `run_probe r1_stock lib`; `run_probe r2_zpad lib-zeropad`; `run_probe r3_stock lib`; `run_probe r4_zpad lib-zeropad`.

Every failing artifact identifies the same census shape:

> `raw/failing_r1_stock.txt:2`, `raw/failing_r2_zpad.txt:2`, `raw/failing_r3_stock.txt:2`, `raw/failing_r4_zpad.txt:2` — `MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)`.

The four test logs end with `EXIT=1` because that one NaN is binding; the captured adb status files are all `0`.

> `raw/ops_r1_stock.txt:2502`, `raw/ops_r2_zpad.txt:2502`, `raw/ops_r3_stock.txt:2502`, `raw/ops_r4_zpad.txt:2502` — `EXIT=1`
>
> `raw/ops_r1_stock.adb.exit:1`, `raw/ops_r2_zpad.adb.exit:1`, `raw/ops_r3_stock.adb.exit:1`, `raw/ops_r4_zpad.adb.exit:1` — `0`

All eight thermal gates passed:

> `raw/gate_pre_r1_stock.txt:1`, `raw/gate_pre_r2_zpad.txt:1`, `raw/gate_pre_r3_stock.txt:1`, `raw/gate_pre_r4_zpad.txt:1`, `raw/gate_post_r1_stock.txt:1`, `raw/gate_post_r2_zpad.txt:1`, `raw/gate_post_r3_stock.txt:1`, `raw/gate_post_r4_zpad.txt:1` — `GATE_PASS`.

## NaN index table across cells

| Cell / arm | tbo / device | NaN index evidence |
|---|---|---:|
| #46, stock | #46 binary | 305 |
| #48, stock R1/R2 | tbo `5cf3565b…`, device `b4bd0901` | 354 / 354 |
| #50, stock R1/R3 | tbo `5cf3565b…`, device `f25c433a` | 388 / 353 |
| #50, zeropad R2/R4 | tbo `5cf3565b…`, device `f25c433a` | 359 / 334 |

Raw quotes:

> `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642` — `[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r2.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=8.473092) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r1_stock.txt:1` — `[MUL_MAT] NaN at index 388 (HTP0=nan CPU=-15.859862) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r3_stock.txt:1` — `[MUL_MAT] NaN at index 353 (HTP0=-nan CPU=10.904273) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r2_zpad.txt:1` — `[MUL_MAT] NaN at index 359 (HTP0=-nan CPU=-0.541000) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r4_zpad.txt:1` — `[MUL_MAT] NaN at index 334 (HTP0=nan CPU=-14.640244) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`.

**Banked finding: NaN index instability.** The same tbo SHA `5cf3565b…` gives #48 index 354 twice, then #50 stock indices 388 and 353. The poisoned slot moves by run/session/device. Since #50 uses a different unit from #48, device variance and run/session variance are not separable here; do not assign the movement to one of them.

### Diagnostic-format note

The NaN diagnostic line format also varies within #50: R1, R2, and R4 carry `dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`; R3 carries `PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`. In #48, both NaN lines carry `PLAIN_HOST=1`; `dev-out` is present on the following line, not on the NaN line. Therefore the embedded `dev-out` form is new in #50 and should be treated as a reporting-path variation, not as a numerical finding.

> `raw/nan_r1_stock.txt:1` — `[MUL_MAT] NaN at index 388 (HTP0=nan CPU=-15.859862) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r2_zpad.txt:1` — `[MUL_MAT] NaN at index 359 (HTP0=-nan CPU=-0.541000) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r3_stock.txt:1` — `[MUL_MAT] NaN at index 353 (HTP0=-nan CPU=10.904273) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r4_zpad.txt:1` — `[MUL_MAT] NaN at index 334 (HTP0=nan CPU=-14.640244) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:593` — `[ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`

## Grid verdict

R1 and R3 are stock and both have the census NaN; R2 and R4 are zeropad and both still have it. This is **grid case 2, binding**:

> `PREREG.md:66` — `2. R1/R3 NaN present AND R2/R4 NaN persists → **T1 REFUTED as sole cause**;`
>
> `PREREG.md:67` — `T2 promoted; deeper DSP instrumentation post-window.`

What dies is the scale-pad-only theory and its candidate cure: zeroing the per-tile pad `[tile_size, aligned_tile_size)` does not remove the failure. What is promoted is T2—VTCM layout/state corruption elsewhere. The poison is state-dependent under the restored dirty-process configuration and position-unstable across runs; the exact source of the movement remains unresolved.

> `PREREG.md:14` — `masked. Net: the trigger needs DIRTY VTCM/process state from prior ops, but the`
>
> `PREREG.md:15` — `zeropad discriminator (T1 scale-pad vs T2 other-VTCM-state) got NO signal`
>
> `PREREG.md:16` — ``because stock never NaN'd. #49's design flaw: `GGML_TEST_EXTRA_MM_FIRST=1` on``
>
> `PREREG.md:62` — `1. R1/R3 NaN present AND R2/R4 clean → **T1 CONFIRMED** (uninit VTCM`
>
> `PREREG.md:63` — `scale-pad is the poison source); the pad zeroing is the candidate fix`

## Zeropad safety

The zeropad skel remains **SAFE** in the append configuration. It introduces no failure beyond the expected census NaN: R2 and R4 have the same single failing q4_0 census shape as the stock runs, and all four summaries have exactly one NaN diagnostic. This is grid case 4 clean, with the F-8 rule respected.

> `PREREG.md:71` — `4. Zeropad arm shows ANY failure beyond the (possibly absent) NaN → zeroing`
>
> `PREREG.md:72` — `unsafe in the append config; T1 readout VOID; banked as a finding.`
>
> `PREREG.md:77-80` — `Expected stock NaN index: 354 (same binary + skel as #48). A different index with the same binary = new fact, banked. Gate letter (per #48 F-8): every former-passing shape must end OK or NS; any FAIL beyond the expected NaN = defect finding.`
>
> `raw/failing_r2_zpad.txt:2` — `MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)`
>
> `raw/failing_r4_zpad.txt:2` — `MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)`

No new F-8 failure was observed; the only failing shape in every run is the expected census q4_0 NaN. The eight pre/post thermal gates are also `GATE_PASS` as recorded above.

## Limitations

- **Device changed.** #50 ran on `f25c433a`, #48 on `b4bd0901`, and #49 on `41c5710f`. The #50 stock pair changes index 388→353 on the same unit and tbo, but the cross-cell movement from #48’s 354 cannot be assigned uniquely to device, run, or session variance.

  > `raw/provenance.txt:1` — `f25c433a`
  >
  > `../qdc-8elite-npu-v79-fixA-48/raw/provenance.txt:1` — `b4bd0901`
  >
  > `../qdc-8elite-npu-v79-clsB-49/raw/provenance.txt:1` — `41c5710f`

- **Two runs per arm.** The interleaved order gives two stock runs and two zeropad runs only; this is enough for the binding case-2 verdict but not a full variance decomposition.

  > `d_run.sh:84-87` — `run_probe r1_stock lib`; `run_probe r2_zpad lib-zeropad`; `run_probe r3_stock lib`; `run_probe r4_zpad lib-zeropad`.

## Candidate angles

The next step is deeper DSP-side instrumentation, explicitly post-window:

> `PREREG.md:67` — `T2 promoted; deeper DSP instrumentation post-window.`

Candidate angles for the desk, not decisions:

- Dequantize path beyond the pad.
- VTCM buffer aliasing between weight and activation areas.
- Double-buffer generation staleness.
- HMX accumulator state.
