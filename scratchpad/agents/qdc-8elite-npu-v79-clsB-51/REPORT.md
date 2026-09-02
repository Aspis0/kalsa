# QDC measurement report — cell #51

## Header

- Job `797407`; billed time approximately 2.5 minutes (cell record).
- Device: serial `87b3a4aa`, Android 16 `sun`, HTP0 / Hexagon v79. `raw/provenance.txt:1` — `87b3a4aa`; `raw/provenance.txt:2` — `qti/sun/sun:16/BQ2A.260305.002-BP2A.250705.008/eng.lnxbui:userdebug/test-keys`; `raw/list_devices.txt:7` — `ggml-hex: Hexagon Arch version v79`; `raw/list_devices.txt:14` — `HTP0: Hexagon (0 MiB, 0 MiB free)`.
- This is the fourth distinct unit in the series: #48 `../qdc-8elite-npu-v79-fixA-48/raw/provenance.txt:1` — `b4bd0901`; #49 `../qdc-8elite-npu-v79-clsB-49/raw/provenance.txt:1` — `41c5710f`; #50 `../qdc-8elite-npu-v79-clsB-50/raw/provenance.txt:1` — `f25c433a`; #51 `raw/provenance.txt:1` — `87b3a4aa`.
- Timing: runner start `raw/serial.txt:1` — `serial=87b3a4aa t0=1788388595 t0_iso=2026-09-02T22:36:35Z`; completion `raw/events.txt:1` — `[18:37:47 e=72] DONE npu_dead=0`; `raw/done.txt:1` — `DONE elapsed=72 npu_dead=0`.
- Control host lib SHA256: `e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba`.
- Fixed host lib SHA256: `e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a`.
- Certified skel SHA256 in both arms: `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044`.
- tbo SHA256 in all arms: `5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`.

  > `raw/kit_sha_host.txt:3` — `5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8  bin/test-backend-ops-153f`
  >
  > `raw/kit_sha_host.txt:4` — `e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a  lib-fix/libggml-hexagon.so`
  >
  > `raw/kit_sha_host.txt:5` — `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib-fix/libggml-htp-v79.so`
  >
  > `raw/kit_sha_host.txt:6` — `e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba  lib/libggml-hexagon.so`
  >
  > `raw/kit_sha_host.txt:7` — `37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044  lib/libggml-htp-v79.so`
  >
  > `raw/libs_active.txt:1` — `r1_ctrl hexlib=e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/libs_active.txt:2` — `r2_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/libs_active.txt:3` — `r3_ctrl hexlib=e91fbcef71f0ece20cf8e33fa26ac2c3b2bdce34ddc662ee926afb40574079ba skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
  >
  > `raw/libs_active.txt:4` — `r4_fix hexlib=e95fa35eed6ec979b9ef7a6cf5098ff738e580bfbd01f38e991202c2ef8dd99a skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`

- Configuration: #50 replica, `EXTRA` appended and `FIRST` unset. `d_run.sh:5` — `All runs use bin/test-backend-ops-153f, EXTRA APPENDED (no FIRST), judge on.`
- Kit/list-device binding: `raw/kit_verify.txt:45` — `lib/mtmd.so: OK`; `raw/kit_verify.txt:46` — `MANIFEST_LINES=45`; `raw/list_devices.txt:15` — `EXIT=0`.

## Headline result

**Grid case 2, binding:** the NaN persists identically under the fixed host lib. The upstream `71102a73f` descriptor type check is **refuted as the Class B cause**: the mechanism predicted the fix arm clean, but both fix runs still fail. The fixed lib did not change NaN presence.

> `raw/summary.txt:1` — `r1_ctrl: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:2` — `r2_fix: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:3` — `r3_ctrl: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`
>
> `raw/summary.txt:4` — `r4_fix: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`

## Binding results

| Run | Host lib | Skel / tbo | Result | Failing test | Process exit |
|---|---|---|---|---|---|
| R1 control | buggy `e91fbcef` | certified `37131e07` / `5cf3565b` | 1 NaN; 545/546 | q4_0 `m=2880,n=32,k=2880` census | 1 |
| R2 fix | fixed `e95fa35e` | same | 1 NaN; 545/546 | same census | 1 |
| R3 control | buggy `e91fbcef` | same | 1 NaN; 545/546 | same census | 1 |
| R4 fix | fixed `e95fa35e` | same | 1 NaN; 545/546 | same census | 1 |

The failure identity is stable across all four runs; no other test is reported as failing. The raw runner records `EXIT=1` for each ops process.

> `raw/ops_r1_ctrl.txt:2493` — ` 545/546 tests passed`
>
> `raw/ops_r1_ctrl.txt:2495-2496` — `Failing tests:` / `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)`
>
> `raw/ops_r1_ctrl.txt:2502` — `EXIT=1`
>
> `raw/ops_r2_fix.txt:2493` — ` 545/546 tests passed`
>
> `raw/ops_r2_fix.txt:2502` — `EXIT=1`
>
> `raw/ops_r3_ctrl.txt:2493` — ` 545/546 tests passed`
>
> `raw/ops_r3_ctrl.txt:2502` — `EXIT=1`
>
> `raw/ops_r4_fix.txt:2493` — ` 545/546 tests passed`
>
> `raw/ops_r4_fix.txt:2502` — `EXIT=1`

> `raw/failing_r1_ctrl.txt:2-3` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`
>
> `raw/failing_r2_fix.txt:2-3` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`
>
> `raw/failing_r3_ctrl.txt:2-3` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`
>
> `raw/failing_r4_fix.txt:2-3` — `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`

The two other run logs contain the same failure lines.

## Grid verdict

This is **grid case 2** verbatim: control NaNs are present and the fix-arm NaNs persist. The descriptor-fix candidate is refuted as the Class B cause.

> `PREREG.md:65-67` — `2. R1/R3 NaN present AND R2/R4 NaN persists → fix **REFUTED** as the cause;` / `Class B returns to parked-with-containment; no further cells without a new` / `design.`

> `PREREG.md:61-63` — `1. R1/R3 NaN present AND R2/R4 clean (expected \`546/546\`) → **root cause` / `CONFIRMED: stale-descriptor reuse (missing type check); Class B CLOSED**` / `with the upstream 2-line fix as the cure.`

The candidate was the upstream descriptor type check: `71102a73f` is the upstream commit, and `022458a28` is its branch cherry-pick.

> `PREREG.md:10-14` — `Upstream llama.cpp fixed on 22 Jul (commit \`71102a73f\`, PR #25968) a missing` / `tensor-TYPE check in the hexagon host's descriptor-reuse test` / `(\`same_shape()\`): a cached descriptor from a PRIOR op with identical` / `shape/strides but different type could be reused. Our branch carries the buggy` / `version (verified: \`ggml-hexagon.cpp:1186\` had no type term). Mechanism match`
>
> `PREREG.md:19-20` — `DSP pad zeroing is inert (T1 refuted, consistent). Cherry-picked as` / ``\`022458a28\` on \`kalsa/npu-judge-v79\` (clean, 2 lines).``

The pre-cell mechanism narrative is dead as an explanation. It matched the fingerprint on paper, but the single-variable cell changed only the host library and left the binding outcome unchanged. Plausible-mechanism matching is not evidence; only the single-variable cell was.

> `d_run.sh:4` — `Arms differ by ONE file: lib/libggml-hexagon.so (buggy e91fbcef) vs lib-fix/ (descfix e95fa35e).`

## Safety gate

The descriptor-fix arms introduce no failure beyond the expected census NaN; grid case 4 is clean and F-8 is respected. The zeropad-skel safety result is inherited from #50, not remeasured in this descriptor-only cell.

> `raw/failing_r2_fix.txt:1-3` — `Failing tests:` / `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`
>
> `raw/failing_r4_fix.txt:1-3` — `Failing tests:` / `  MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1)` / `  Backend HTP0: [ANSI]FAIL`
>
> `PREREG.md:70-72` — `4. Fix arm shows ANY failure beyond the (possibly absent) census NaN → fix` / `unsafe/regression; readout VOID; banked as a finding. Gate letter (#48` / `F-8): every former-passing shape must end OK or NS.`

All eight thermal gates pass.

> `raw/gate_pre_r1_ctrl.txt:1` — `GATE_PASS`; `raw/gate_pre_r2_fix.txt:1` — `GATE_PASS`; `raw/gate_pre_r3_ctrl.txt:1` — `GATE_PASS`; `raw/gate_pre_r4_fix.txt:1` — `GATE_PASS`
>
> `raw/gate_post_r1_ctrl.txt:1` — `GATE_PASS`; `raw/gate_post_r2_fix.txt:1` — `GATE_PASS`; `raw/gate_post_r3_ctrl.txt:1` — `GATE_PASS`; `raw/gate_post_r4_fix.txt:1` — `GATE_PASS`

## Index observations

| Cell / arm | NaN index | Evidence |
|---|---:|---|
| #46 | 305 | `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642` |
| #48, run 1 | 354 | `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` |
| #48, run 2 | 354 | `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r2.txt:592` |
| #50, stock R1 | 388 | `../qdc-8elite-npu-v79-clsB-50/raw/nan_r1_stock.txt:1` |
| #50, stock R3 | 353 | `../qdc-8elite-npu-v79-clsB-50/raw/nan_r3_stock.txt:1` |
| #50, zeropad R2 | 359 | `../qdc-8elite-npu-v79-clsB-50/raw/nan_r2_zpad.txt:1` |
| #50, zeropad R4 | 334 | `../qdc-8elite-npu-v79-clsB-50/raw/nan_r4_zpad.txt:1` |
| #51, control R1 | 338 | `raw/nan_r1_ctrl.txt:1` |
| #51, control R3 | 338 | `raw/nan_r3_ctrl.txt:1` |
| #51, fix R2 | 482 | `raw/nan_r2_fix.txt:1` |
| #51, fix R4 | 360 | `raw/nan_r4_fix.txt:1` |

> `../qdc-8elite-npu-v79-judge/raw/ops_mm_ph1.txt:642` — `[MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r2.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=8.473092) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/nan_r1_stock.txt:1` — `[MUL_MAT] NaN at index 388 (HTP0=nan CPU=-15.859862) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/nan_r3_stock.txt:1` — `[MUL_MAT] NaN at index 353 (HTP0=-nan CPU=10.904273) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/nan_r2_zpad.txt:1` — `[MUL_MAT] NaN at index 359 (HTP0=-nan CPU=-0.541000) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/nan_r4_zpad.txt:1` — `[MUL_MAT] NaN at index 334 (HTP0=nan CPU=-14.640244) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r1_ctrl.txt:1` — `[MUL_MAT] NaN at index 338 (HTP0=nan CPU=-1.843428) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r3_ctrl.txt:1` — `[MUL_MAT] NaN at index 338 (HTP0=nan CPU=23.919586) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r2_fix.txt:1` — `[MUL_MAT] NaN at index 482 (HTP0=-nan CPU=2.925817) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r4_fix.txt:1` — `[MUL_MAT] NaN at index 360 (HTP0=nan CPU=-8.062845) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`

On this unit, the two control runs agree at 338/338, while #50's stock pair disagreed at 388/353. The fix pair differs at 482/360; those runs use different host-library bytes. This is consistent with binary/lib sensitivity of the **index only**, not of NaN presence. Intra-session stability therefore appears unit- or session-dependent; two runs per arm do not establish a law.

The NaN diagnostic format also varies. On disk, only R1 carries the embedded `dev-out` form with `buf="HTP0" host=1`; R2, R3, and R4 carry the `PLAIN_HOST=1 copy-buffer="CPU"` form. Both #48 NaN lines carry the latter form. This is a correction to the supplied R1/R2/R4 grouping, and is treated as two judge reporting paths, not a numerical finding.

> `raw/nan_r1_ctrl.txt:1` — `[MUL_MAT] NaN at index 338 (HTP0=nan CPU=-1.843428) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] dev-out name=out type=f32 op=MUL_MAT buf="HTP0" buft="HTP0" host=1`
>
> `raw/nan_r2_fix.txt:1` — `[MUL_MAT] NaN at index 482 (HTP0=-nan CPU=2.925817) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r3_ctrl.txt:1` — `[MUL_MAT] NaN at index 338 (HTP0=nan CPU=23.919586) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `raw/nan_r4_fix.txt:1` — `[MUL_MAT] NaN at index 360 (HTP0=nan CPU=-8.062845) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/ops_mm_r1.txt:592` — `[MUL_MAT] NaN at index 354 (HTP0=nan CPU=3.173089) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set`

## Eliminated-causes ledger

- **Scale-pad uninitialized VTCM (T1): EXCLUDED as sole cause.** #50 had NaNs on both stock and zeropad arms.
- **Descriptor cross-type reuse: EXCLUDED as the Class B cause.** #51's fixed-library arms still produce the census NaN.
- **Cold-process first-touch: EXCLUDED as the trigger explanation.** #49's cold first execution passed; this cell restored the dirty, #50-style configuration and reproduced the failure.

> `../qdc-8elite-npu-v79-clsB-50/raw/skel_active.txt:1` — `r1_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/skel_active.txt:3` — `r3_stock active_skel=37131e079e14a09c0cfe22637ab2a614e67862924e6e106351bc6f0e864c6044 tbo=5cf3565b20b6c23bab757183c5a61c276727f216c3ece30fce211bdc1bbed5e8`
>
> `PREREG.md:15-18` — `cold process = no` / `prior descriptors → no NaN (#49); dirty state = stale-descriptor hit on the` / `shape's FIRST execution → NaN (#48/#50); which descriptor is hit depends` / `session history → index moves (#50)`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/summary.txt:1-4` — `r1_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed` / `r2_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed` / `r3_stock: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed` / `r4_zpad: INTERNAL-ERROR=0 graph_failed=0 nan_diags=1   545/546 tests passed`

Elimination is progress: the remaining hypothesis is T2, not the descriptor-reuse narrative.

## Consequences

- **Class B: PARKED with containment.** Keep the standing #47-style per-model PPL-cert gate; it remains in force regardless of this cell. No further cells without a new design.
- **Cherry-pick `022458a28`: retain.** It remains correct upstream hardening for the real latent cross-type descriptor-reuse bug, but it is not the Class B cure measured here.
- **T2 remains promoted**, with descriptor cross-type reuse removed from the candidate list.

> `PREREG.md:63-67` — `with the upstream 2-line fix as the cure. Merge decision (main/branch) is` / `a separate step; the per-model PPL cert containment gate STAYS regardless.` / `2. R1/R3 NaN present AND R2/R4 NaN persists → fix **REFUTED** as the cause;` / `Class B returns to parked-with-containment; no further cells without a new` / `design.`

## Limitations

- This is the fourth distinct device in the series (`87b3a4aa`); #50 used `f25c433a`, and #48 used `b4bd0901`. Device variance and run/session variance are not separable.
- There are only two control and two fix runs. The 338/338 control agreement and 482/360 fix disagreement are observations, not a general index law.

> `raw/provenance.txt:1` — `87b3a4aa`
>
> `../qdc-8elite-npu-v79-clsB-50/raw/provenance.txt:1` — `f25c433a`
>
> `../qdc-8elite-npu-v79-fixA-48/raw/provenance.txt:1` — `b4bd0901`

## Candidate angles

Per the post-window rule, the next investigation is deeper DSP-side instrumentation, not another cell under the current design. Candidate angles remain:

- Dequantize path beyond the pad.
- VTCM buffer aliasing between weight and activation areas.
- Double-buffer generation staleness.
- HMX accumulator state.

> `../qdc-8elite-npu-v79-clsB-50/REPORT.md:168` — `T2 promoted; deeper DSP instrumentation post-window.`
>
> `../qdc-8elite-npu-v79-clsB-50/REPORT.md:172-175` — `Dequantize path beyond the pad.` / `VTCM buffer aliasing between weight and activation areas.` / `Double-buffer generation staleness.` / `HMX accumulator state.`
