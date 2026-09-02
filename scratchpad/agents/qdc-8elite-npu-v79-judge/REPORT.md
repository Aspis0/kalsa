# Cell #46 — numeric report

## 10-line summary

1. `job=796233`; `running=09/01/26 8:37:18 PM`; `submitted=8:34:00 PM` (raw/running.txt:1).
2. `T0=2026-09-02T00:41:22Z`; `DONE elapsed=1586`; `npu_dead=0` (raw/serial.txt:1; raw/done.txt:1; raw/events.txt:8).
3. `MUL_MAT`: `ok=505 fail_total=37 skip=928 total=1470`; `EXIT=1` (raw/ops_mm_ph1.txt.census.txt:2-6; raw/ops_mm_ph1.txt:2531; raw/ops_mm_ph1.txt:2576).
4. `MUL_MAT_ID` patched: `ok=301 fail_total=0 skip=511 total=812`; `EXIT=0` (raw/ops_id_ph1.txt.census.txt:2-6; raw/ops_id_ph1.txt:3542; raw/ops_id_ph1.txt:3548).
5. `MUL_MAT_ID` control: `ok=0 fail_total=299 skip=511 total=810`; `judge_nonfinite=60`; `unresolved=2`; `EXIT=1` (raw/ops_id_ph0.txt.census.txt:2-6,8,17; raw/ops_id_ph0.txt:3241; raw/ops_id_ph0.txt:3550).
6. The control raw has `CPU=(nan|-nan|inf|-inf)` diagnostics, but its two malformed verdict boundaries prevent an exact `301` emitted census (raw/ops_id_ph0.txt:36,44-45,569,572-573,2837-2838).
7. SHIP numeric result: `40.2720 +/- 0.87472` versus `40.2837 +/- 0.87513`; `r=-0.029%`; both `EXIT=0` (raw/ppl_summary.txt:1-4).
8. OLMoE numeric result: `9.0620 +/- 0.13192` versus `9.0562 +/- 0.13172`; `r=+0.064%`; both `EXIT=0` (raw/ppl_summary.txt:5-8).
9. Both PPL HTP execute-op proofs, hybrid offload splits, and KV-placement lines are absent from the captured raw logs; rev-3 therefore does not bank either PPL number (raw/ppl_ship_htp.txt:1-12; raw/ppl_olmoe_htp.txt:1-12).
10. Binding status: `judge=PROVISIONAL`; `MUL_MAT_ID=patched-correct`; `MUL_MAT=not patched-correct`; `SHIP=VOID`; `OLMoE=VOID`; `Session 1 D OPEN on ops correctness` (PREREG.md:205-227; raw/ops_mm_ph1.txt.census.txt:7-11; raw/ops_id_ph1.txt.census.txt:7-11).

## Census outputs

The saved outputs are reproduced verbatim. Rev-3 says: “the scan STOPS at the first `tests passed` summary line” and excludes the recap and backend summary (PREREG.md:110-112). The raw summaries are `505/542` (raw/ops_mm_ph1.txt:2531), `301/301` (raw/ops_id_ph1.txt:3542), and `0/301` (raw/ops_id_ph0.txt:3241).

```text
op=MUL_MAT
ok=505
fail_total=37
skip=928
executed=542
total=1470
compute_failed=4
judge_nonfinite=0
htp_nonfinite=0
real_fail=33
other=0
internal_error_lines=36
htp_proof=1
backend_htp0=1
device_hexagon=1
recopy_lines=542
unresolved=0
banner=1
plain_host=1
```

Source: raw/ops_mm_ph1.txt.census.txt:1-19. The HTP proof lines are also present in the raw log: `Backend 2/3: HTP0` and `Device description: Hexagon` (raw/ops_mm_ph1.txt:18-19). The arm-2 banner and per-test repair witness are `PLAIN_HOST=1` (raw/ops_mm_ph1.txt:1,13).

```text
op=MUL_MAT_ID
ok=301
fail_total=0
skip=511
executed=301
total=812
compute_failed=0
judge_nonfinite=0
htp_nonfinite=0
real_fail=0
other=0
internal_error_lines=0
htp_proof=1
backend_htp0=1
device_hexagon=1
recopy_lines=301
unresolved=0
banner=1
plain_host=1
```

Source: raw/ops_id_ph1.txt.census.txt:1-19. The raw HTP proof and `PLAIN_HOST=1` witness are at raw/ops_id_ph1.txt:17-18 and raw/ops_id_ph1.txt:1,27.

```text
op=MUL_MAT_ID
ok=0
fail_total=299
skip=511
executed=299
total=810
compute_failed=0
judge_nonfinite=60
htp_nonfinite=0
real_fail=239
other=0
internal_error_lines=0
htp_proof=1
backend_htp0=1
device_hexagon=1
recopy_lines=0
unresolved=2
banner=1
plain_host=0
```

Source: raw/ops_id_ph0.txt.census.txt:1-19. The control HTP proof is at raw/ops_id_ph0.txt:17-18 and its banner is `GGML_TEST_PLAIN_HOST=0` (raw/ops_id_ph0.txt:1). Conservation is `505+37+928=1470`, `301+0+511=812`, and the saved control total is `0+299+511=810` (raw/ops_mm_ph1.txt.census.txt:2-6; raw/ops_id_ph1.txt.census.txt:2-6; raw/ops_id_ph0.txt.census.txt:2-6).

## Exit codes

For `cmd > log 2>&1; echo $?`, the captured outer command exits are `0` for `ops_mm_ph1`, `ops_id_ph1`, `ops_id_ph0`, `ppl_ship_htp`, `ppl_ship_cpu`, `ppl_olmoe_htp`, and `ppl_olmoe_cpu` (raw/ops_mm_ph1.adb.exit:1; raw/ops_id_ph1.adb.exit:1; raw/ops_id_ph0.adb.exit:1; raw/ppl_ship_htp.adb.exit:1; raw/ppl_ship_cpu.adb.exit:1; raw/ppl_olmoe_htp.adb.exit:1; raw/ppl_olmoe_cpu.adb.exit:1). The inner application exits are the `EXIT=` lines quoted above: `MUL_MAT=1`, control `MUL_MAT_ID=1`, patched `MUL_MAT_ID=0`, and all four PPL arms `0` (raw/ops_mm_ph1.txt:2576; raw/ops_id_ph0.txt:3550; raw/ops_id_ph1.txt:3548; raw/ppl_ship_htp.txt:12; raw/ppl_ship_cpu.txt:12; raw/ppl_olmoe_htp.txt:12; raw/ppl_olmoe_cpu.txt:12).

## Investigation 1 — control band miss

Rule: “Expected: `judge_nonfinite` = **301 exactly**”; “a value outside **290–315** triggers investigation” (PREREG.md:143-146).

The hypothesis that `PLAIN_HOST=0` suppresses the CPU diagnostics is refuted. The old #45 line carries the diagnostic and verdict together: `"[MUL_MAT_ID] inf mismatch: HTP0=1.843750 CPU=-inf   MUL_MAT_ID(type_a=mxfp4,type_b=f32,n_mats=32,n_used=2,b=0,m=2880,n=32,k=2880): FAIL"` (../qdc-8elite-npu-v79-d-rest/raw/ops_MUL_MAT_ID.txt:27). The control carries `PLAIN_HOST=0` (raw/ops_id_ph0.txt:1) but still prints `"[MUL_MAT_ID] inf mismatch: HTP0=-29.375000 CPU=inf ..."` (raw/ops_id_ph0.txt:36) and `"[MUL_MAT_ID] NaN at index 0 (HTP0=21.250000 CPU=-nan) ...: FAIL"` (raw/ops_id_ph0.txt:45).

The format changed: the first control diagnostic has no verdict on its line, while `FAIL` is on the later line (raw/ops_id_ph0.txt:36,44-45). Two boundaries are malformed after ANSI stripping: `host=1FAIL` occurs at raw/ops_id_ph0.txt:572 and `host=1FAIL` occurs at raw/ops_id_ph0.txt:2837; each is followed by another header at raw/ops_id_ph0.txt:573 and raw/ops_id_ph0.txt:2838. These are the two `unresolved` headers, not truncation (raw/ops_id_ph0.txt.census.txt:17; raw/ops_id_ph0.txt:3241,3550).

The raw control has 301 CPU-nonfinite diagnostic lines by direct scan; examples are raw/ops_id_ph0.txt:36,45,569,2837. The summary is `0/301 tests passed` (raw/ops_id_ph0.txt:3241). A rev-3 header-inclusive recount therefore reads `299` resolved `judge_nonfinite` tests plus `2` unresolved headers; the saved `60` is the line-format undercount (raw/ops_id_ph0.txt.census.txt:8,17). The substantive comparison is `299` control FAILs versus `0` patched-arm FAILs (raw/ops_id_ph0.txt.census.txt:3; raw/ops_id_ph1.txt.census.txt:3).

Verdict: the undercount mechanism is resolved as a census/stream-format problem, not absent CPU diagnostics; the exact rev-3 control condition is still not bankable because the emitted census is `60`, not `301`, and `unresolved=2`. Judge status remains `PROVISIONAL`, pending a clean control capture.

## Investigation 2 — `compute_failed=4` versus `INTERNAL-ERROR=36`

Rules: the kit change says non-OK DSP responses become graph `FAILED` and “each DSP error emits BOTH lines” (PREREG.md:41-46). Rev-3 also says `internal_error_lines` is a cross-check, “expected close, NOT required equal: a graph can carry several ops” (PREREG.md:135-137).

Physical header attachment before the summary gives `36` distinct internal-error-bearing headers: `21` later FAIL, `9` later `not supported`, `6` later OK, and `0` headers with more than one internal-error line. Thus the saved `compute_failed=4` leaves `32`: `17` later FAIL/saved `real_fail`, `9` skips, and `6` OKs. Examples: `INTERNAL-ERROR` then `OK` (raw/ops_mm_ph1.txt:97,104-105); `INTERNAL-ERROR` then `not supported` (raw/ops_mm_ph1.txt:1109,1116-1117); and `INTERNAL-ERROR` then `FAIL` without a value diagnostic (raw/ops_mm_ph1.txt:390,397-398).

The four saved `compute_failed` entries include the sequence `INTERNAL-ERROR`, `graph_compute failed`, `FAIL` attached to the `q8_0,m=16,n=6` header (raw/ops_mm_ph1.txt:296-298,306-308; raw/ops_mm_ph1.txt.census.txt:31). Other graph-failure text is embedded on header lines, for example `MUL_MAT(...): compare_graph_backend_judge: ggml_backend_graph_compute failed` (raw/ops_mm_ph1.txt:106) while the saved tail calls it `real_fail` (raw/ops_mm_ph1.txt.census.txt:20). Rev-3 explicitly includes “the header line itself” in attached diagnostic text (PREREG.md:123-131); a strict header-inclusive recount is consequently `compute_failed=28`, `htp_nonfinite=1`, `real_fail=8`, `other=0`, rather than the saved `4/0/33/0` (raw/ops_mm_ph1.txt.census.txt:7-11,20-56; raw/ops_mm_ph1.txt:106,298,379-380).

Verdict: **(c) undetermined as a kit-level propagation diagnosis; not (a)**. There are no multiple internal-error lines per header. The physical stream shows both `INTERNAL-ERROR→OK` and `INTERNAL-ERROR→not supported` (raw/ops_mm_ph1.txt:104-105,1116-1117), but it also shifts diagnostics across adjacent headers and embeds graph-failure text in headers (raw/ops_mm_ph1.txt:104-106,296-298). The raw evidence cannot distinguish DSP/error propagation from output association; the census-format discrepancy is proven, while the kit-level cause is not.

## PPL arms

The SHIP hashes match host/device and the corpus hash matches host/device (raw/sha_ship.gguf.txt:1-2; raw/sha_wiki.test.raw.txt:1-2). The numeric lines are:

```text
SHIP HTP [32] suffix: [29]42.7839,[30]42.1594,[31]41.3898,[32]40.2720,
SHIP HTP final: 1.19.299.610 I Final estimate: PPL = 40.2720 +/- 0.87472
SHIP CPU [32] suffix: [29]42.7595,[30]42.1324,[31]41.3954,[32]40.2837,
SHIP CPU final: 7.01.388.061 I Final estimate: PPL = 40.2837 +/- 0.87513
```

Verbatim sources: raw/ppl_ship_htp.txt:9-10 and raw/ppl_ship_cpu.txt:9-10. `r=40.2720/40.2837-1=-0.029%`; numeric threshold `PASS` is `≤2%` (PREREG.md:169-175). Both arm exits are `EXIT=0` (raw/ppl_ship_htp.txt:12; raw/ppl_ship_cpu.txt:12).

The OLMoE hashes match host/device and the corpus remains the same (raw/sha_olmoe.gguf.txt:1-2; raw/sha_wiki.test.raw.txt:1-2). The numeric lines are:

```text
OLMoE HTP [32] suffix: [29]9.5320,[30]9.4445,[31]9.3531,[32]9.0620,
OLMoE HTP final: 1.17.967.752 I Final estimate: PPL = 9.0620 +/- 0.13192
OLMoE CPU [32] suffix: [29]9.5268,[30]9.4443,[31]9.3472,[32]9.0562,
OLMoE CPU final: 8.08.277.926 I Final estimate: PPL = 9.0562 +/- 0.13172
```

Verbatim sources: raw/ppl_olmoe_htp.txt:9-10 and raw/ppl_olmoe_cpu.txt:9-10. `r=9.0620/9.0562-1=+0.064%`; numeric threshold `PASS` is `≤2%` (PREREG.md:169-175). Both arm exits are `EXIT=0` (raw/ppl_olmoe_htp.txt:12; raw/ppl_olmoe_cpu.txt:12).

Required proof is not present. Rev-3 requires “≥ 1 `HTP0 execute-op MUL_MAT` line” for SHIP and says “Proof absent → METHOD-VOID” (PREREG.md:154-160); no such line occurs in the 12-line SHIP HTP capture, which instead ends with `[32]` and `Final estimate` (raw/ppl_ship_htp.txt:1-12). OLMoE requires `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` (PREREG.md:183-186); no such line occurs in raw/ppl_olmoe_htp.txt:1-12.

The requested hybrid split and KV placement cannot be quoted: no offload or KV-placement line is captured in either HTP log (raw/ppl_ship_htp.txt:1-12; raw/ppl_olmoe_htp.txt:1-12). The CPU logs do show `n_gpu_layers ... 0` (raw/ppl_ship_cpu.txt:2; raw/ppl_olmoe_cpu.txt:2), but the required “no HTP device appears in the offload lines” evidence is absent; execute-op absence is expressly “not evidence either way” (PREREG.md:162-168). Therefore `SHIP=METHOD-VOID` and `OLMoE=METHOD-VOID`; the two numeric PASS values are characterization only.

## Thermal gates

Each line gives `file: max_hal_temp / Thermal status / gate result`.

```text
gate_pre_id_ph0.txt:       42.0 / 0 / GATE_PASS
gate_post_id_ph0.txt:      42.0 / 0 / GATE_PASS
gate_pre_id_ph1.txt:       42.0 / 0 / GATE_PASS
gate_post_id_ph1.txt:      42.0 / 0 / GATE_PASS
gate_pre_mm_ph1.txt:       42.0 / 0 / GATE_PASS
gate_post_mm_ph1.txt:      42.0 / 0 / GATE_PASS
gate_pre_ship_htp.txt:     42.0 / 0 / GATE_PASS
gate_post_ship_htp.txt:    65.6 / 0 / GATE_FAIL
gate_pre_ship_cpu.txt:     57.9 / 0 / GATE_PASS
gate_post_ship_cpu.txt:    74.1 / 3 / GATE_FAIL
gate_pre_olmoe_htp.txt:    53.6 / 1 / GATE_PASS
gate_post_olmoe_htp.txt:   67.2 / 3 / GATE_FAIL
gate_pre_olmoe_cpu.txt:    48.2 / 0 / GATE_PASS
gate_post_olmoe_cpu.txt:   77.2 / 3 / GATE_FAIL
```

Sources for the gate results: raw/gate_pre_id_ph0.txt:1, raw/gate_post_id_ph0.txt:1, raw/gate_pre_id_ph1.txt:1, raw/gate_post_id_ph1.txt:1, raw/gate_pre_mm_ph1.txt:1, raw/gate_post_mm_ph1.txt:1, raw/gate_pre_ship_htp.txt:1, raw/gate_post_ship_htp.txt:1, raw/gate_pre_ship_cpu.txt:1, raw/gate_post_ship_cpu.txt:1, raw/gate_pre_olmoe_htp.txt:1, raw/gate_post_olmoe_htp.txt:1, raw/gate_pre_olmoe_cpu.txt:1, raw/gate_post_olmoe_cpu.txt:1. The corresponding `max_hal_temp` and status lines are raw/therm_pre_id_ph0.txt:32, raw/therm_post_id_ph0.txt:32, raw/therm_pre_id_ph1.txt:32, raw/therm_post_id_ph1.txt:32, raw/therm_pre_mm_ph1.txt:32, raw/therm_post_mm_ph1.txt:32, raw/therm_pre_ship_htp.txt:32, raw/therm_post_ship_htp.txt:32, raw/therm_pre_ship_cpu.txt:32, raw/therm_post_ship_cpu.txt:32, raw/therm_pre_olmoe_htp.txt:32, raw/therm_post_olmoe_htp.txt:32, raw/therm_pre_olmoe_cpu.txt:32, raw/therm_post_olmoe_cpu.txt:32. `GATE_WAIT olmoe_cpu` occurred at `e=913`; the following pre-gate passed (raw/events.txt:6; raw/gate_pre_olmoe_cpu.txt:1; raw/therm_pre_olmoe_cpu.txt:32).

## Binding verdict

Judge repaired: **PROVISIONAL**, not full `REPAIRED`. Rule: “Judge repaired iff ALL hold” including arm-2 banner, recopy equality, zero judge nonfinite, positive OK counts, zero other, conservation, HTP proof, and control `judge_nonfinite = 301` (PREREG.md:205-210). Arm 2 has the banner, `recopy_lines=executed`, zero judge nonfinite, positive OK, zero other, and matching total (raw/ops_mm_ph1.txt.census.txt:2-19); patched `MUL_MAT_ID` has the same properties (raw/ops_id_ph1.txt.census.txt:2-19). The control condition is not emitted: `60`, `unresolved=2` (raw/ops_id_ph0.txt.census.txt:8,17).

Patched-correct by op class: `MUL_MAT_ID=YES` on the saved class metrics; `MUL_MAT=NO`. Rule: “`patched-correct` ... iff `real_fail = 0` AND `htp_nonfinite = 0` AND `compute_failed = 0` AND `ok > 0` AND `other = 0`” (PREREG.md:213-215). The ID class is `0/0/0/301/0` for `real_fail/htp_nonfinite/compute_failed/ok/other` (raw/ops_id_ph1.txt.census.txt:2,7-11); MUL_MAT is `33/0/4/505/0` (raw/ops_mm_ph1.txt.census.txt:2,7-11). The 37-test MUL_MAT defect list remains open.

Model certification: `SHIP=VOID` and `OLMoE=VOID`, despite numeric `PASS`, because the required HTP execute-op proof is absent (PREREG.md:157-160,183-186; raw/ppl_ship_htp.txt:1-12; raw/ppl_olmoe_htp.txt:1-12).

Session 1 D: **OPEN**. Rule: “Session 1 D closes on correctness iff the judge is repaired (full, not provisional) AND Q_ppl-ship = PASS at 32 chunks”; the rule also requires the report to say “D OPEN on ops correctness” when the ops defect sum is positive (PREREG.md:223-227). Here the judge is provisional, SHIP is method-void, and `compute_failed + htp_nonfinite + real_fail = 37` in the saved census (raw/ops_mm_ph1.txt.census.txt:3,7,9-10).

## Open MUL_MAT shapes

The following 37 category/header lines are quoted from the census tail (raw/ops_mm_ph1.txt.census.txt:20-56):

```text
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=5,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=6,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=7,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=8,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=9,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=5,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=6,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=7,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=8,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=9,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=5,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
compute_failed:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=6,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=7,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=8,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=9,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
compute_failed:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=5,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=6,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=7,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=8,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=9,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=16,n=5,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
compute_failed:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=16,n=6,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=16,n=7,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=16,n=8,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=16,n=9,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail: [MUL_MAT] NaN at index 305 (HTP0=nan CPU=-12.339559) cpu_buf="CPU" cpu_buft="CPU"   MUL_MAT(type_a=q4_0,type_b=f32,m=2880,n=32,k=2880,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=16,n=16,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=16,n=16,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=16,n=16,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=16,n=16,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=q4_0,type_b=f32,m=1,n=2048,k=8192,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
compute_failed:   MUL_MAT(type_a=q4_0,type_b=f32,m=1,n=64,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
real_fail:   MUL_MAT(type_a=q4_1,type_b=f32,m=1,n=64,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): FAIL
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=1,n=64,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=mxfp4,type_b=f32,m=1,n=64,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): compare_graph_backend_judge: ggml_backend_graph_compute failed. status=GGML status: error (operation failed) 
real_fail:   MUL_MAT(type_a=iq4_nl,type_b=f32,m=1,n=64,k=256,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): FAIL
real_fail:   MUL_MAT(type_a=q8_0,type_b=f32,m=6,n=4096,k=5120,bs=[1,1],nr=[1,1],per=[0,1,2,3],k_v=0,o=1): [ref-buf] PLAIN_HOST=1 copy-buffer="CPU" cpu_buft="CPU" recopy=get/set
```

## Billing/clocks and deviations

`Running=09/01/26 8:37:18 PM` and `T0=2026-09-02T00:41:22Z` are both recorded (raw/running.txt:1; raw/serial.txt:1). The driver ended at `DONE elapsed=1586` / `21:07:48 e=1586` (raw/done.txt:1; raw/events.txt:8). Page `Ended=9:10:34 PM` is supplied cell metadata and is not present in the raw files; Running→Ended is approximately `33:16`, above the preregistered `30 min` cap (PREREG.md:56-60). The raw run therefore documents the T0/page-clock drift and the over-cap page interval, but no raw Ended timestamp.

Deviations: `FLAG_MISSING --load-mode` (raw/events.txt:1); `STDBUF absent (block-buffered tee declared)` (raw/events.txt:4); one `GATE_WAIT olmoe_cpu` at `e=913`, followed by a passing pre-gate (raw/events.txt:6; raw/gate_pre_olmoe_cpu.txt:1); `SKIP_qwen time` at `e=1586` (raw/events.txt:7). No claim is made here about v73/v75, K-quant experts, speed, decode/tg correctness, other context/batch geometries, KV numerics, governor/app behavior, or sustained thermals/energy (PREREG.md:229-237).
