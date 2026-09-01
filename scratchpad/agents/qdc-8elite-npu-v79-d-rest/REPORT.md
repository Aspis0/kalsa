# REPORT — cell #45 (job 796061), 2026-09-01

Hostile audit `AUDIT.md` (mimo) 10/11. One auditor REFUTED was itself
wrong: see EXIT distinction below. Raw on origin `9df8ae6b` + `de36a2cf`.
QDC Job Logs are not the source of truth.

## Session

- Job **796061** `npu-v79-d-rest-45`
  https://qdc.qualcomm.com/reports/job/interactive/796061
- QRD8750 / Snapdragon 8 Elite / Android 16 / serial `f25c433a`
- Submitted 13:45:34, Running 13:46:51, Ended 14:05:58 (page clock)
- `DONE elapsed=468` s. Kit `npu-kit-556118a08.tgz`. Backend listed:
  `HTP0: Hexagon` and `Hexagon Arch version v79` (`raw/list_devices.txt`).
- `--list-devices` ran WITH `LD_LIBRARY_PATH` (unlike #44 script bug).

## Q_ops — patched-judge is a SCORE, not a kit rebuild

`test-backend-ops -b HTP0`: log line `EXIT=1` both ops (the binary's
`$?` after FAIL; same class as #43). `ops_*.adb.exit` is `0` because the
adb shell's last command is `echo EXIT=$?`. Binding rc is the log
`EXIT=` line, not the adb.exit file.
`score_judge.sh` stdout is messy (`ok=0` duplicated by `grep -c` exit 1).
Counts below are from `grep -c` on the raw logs, not from the score file
header.

| op | OK | FAIL | skip | INTERNAL-ERROR | CPU-nonfinite FAILs |
|---|---|---|---|---|---|
| MUL_MAT | 0 | 72 | 928 | 36 | 34 |
| MUL_MAT_ID | 0 | 303 | 511 | 0 | 301 |

PREREG: patched-correct iff REAL=0 and executed>0. **FAIL both classes:**
executed OK = 0. MUL_MAT has 36 INTERNAL-ERROR (real v79 defects, same
family as #43). MUL_MAT_ID is almost all judge-NaN (301/303); 2 FAIL are
not CPU-nonfinite (`real_fail_minus_judge=2`).

This does **not** prove the kernels wrong on the judge-NaN cases (same
HTP-pairing poison as #43). It also does **not** certify correctness.

## Q3 — OLMoE Q4_0 pp512 r=3, no VERBOSE

On-device sha = host `9d0b90c6…`. EXIT=0 both arms. jsonl `-o`/`-oe`
duplicates each row.

- NPU (`--device HTP0 -ngl 99`): avg_ts **862.598** (samples 857.671,
  870.426, 859.696)
- CPU (`-ngl 0`): avg_ts **199.909** (193.883, 204.34, 201.503)

Ratio N/C pp512 = **4.32×**. Report-only. Not comparable to #43 ship-model
1512 (different model) or to #44 verbose r=1 845.9 (different flags).

## Q_qwen — Qwen3.5-4B Q4_0 requant, pp512 + tg128 r=3

On-device sha = host `f1635f9c…`. EXIT=0 both arms. Requant from Q4_K_M;
not PPL-comparable to a native Q4_0; not q63 C1.

| | NPU ngl99 HTP0 | CPU ngl0 |
|---|---|---|
| pp512 | **355.039** (354.843, 356.343, 353.929) | **107.099** (116.345, 95.043, 109.908) |
| tg128 | **8.616** (8.749, 8.442, 8.658) | **19.625** (19.669, 19.802, 19.405) |

Prefill N/C ≈ **3.32×**. Decode CPU/NPU ≈ **2.28×**. Seeds the v79 dense
column. No routing verdict. CPU jsonl `devices=auto` with `n_gpu_layers=0`.

Missing thermal **post** for Q3-CPU and Qwen-CPU (`gate_pre_q3c` exists;
no `gate_post_q3c` / `gate_post_qwen_cpu`). Pre-gates all GATE_PASS.

## Session 1 D

PREREG: D closes iff Q_ops and Q_qwen both produce a banked number.
Q_qwen produced numbers. Q_ops produced a banked **defect/judge census**,
not patched-correct. Treat D as **OPEN on correctness**, **measured on
dense speed**. q63-on-HTP still deferred. HVX 28c frozen.
