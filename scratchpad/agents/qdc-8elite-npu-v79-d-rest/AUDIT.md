# AUDIT — cell #45, hostile, line-by-line

Written from raw files only. No sub-agents. No mercy.

**Parent erratum on finding 7:** REFUTED is itself REFUTED. Binding rc is
`EXIT=1` at `ops_MUL_MAT.txt:4364` and `ops_MUL_MAT_ID.txt:1141`
(`FAIL` then `echo EXIT=$?`). `ops_*.adb.exit` = `0` is the adb shell
status of that echo, not test-backend-ops. REPORT kept EXIT=1 and now
quotes both. Verdicts Q_ops FAIL / Q3 / Q_qwen / D-open unchanged.

## VERDICT

| Arm | Verdict |
|---|---|
| **Q_ops** | **FAIL.** OK=0 both classes. Not patched-correct per PREREG. |
| **Q3** | **CONFIRMED.** Numbers match raw jsonl exactly. Speed only. |
| **Q_qwen** | **CONFIRMED.** Numbers match raw jsonl exactly. Speed only. |
| **D-closed?** | **NO.** Correctness OPEN. Dense speed measured. |

---

## FINDINGS — claim by claim, quoted

### 1. Q_ops census

REPORT: `MUL_MAT OK=0 FAIL=72 skip=928 INTERNAL-ERROR=36 CPU-nonfinite=34`

Raw grep on `ops_MUL_MAT.txt`:
```
grep -c ': OK' → 0
grep -c 'FAIL' → 72
grep -c 'not supported' → 928
grep -c 'INTERNAL-ERROR' → 36
grep -E 'FAIL' | grep -Eic 'CPU=(nan|-nan|inf|-inf)' → 34
```
**CONFIRMED.** Every digit matches.

REPORT: `MUL_MAT_ID OK=0 FAIL=303 skip=511 INTERNAL-ERROR=0 CPU-nonfinite=301`

Raw grep on `ops_MUL_MAT_ID.txt`:
```
grep -c ': OK' → 0
grep -c 'FAIL' → 303
grep -c 'not supported' → 511
grep -c 'INTERNAL-ERROR' → 0
grep -E 'FAIL' | grep -Eic 'CPU=(nan|-nan|inf|-inf)' → 301
```
**CONFIRMED.** Every digit matches. REPORT's `real_fail_minus_judge=2` is 303−301=2. Correct.

### 2. score_judge.sh ok= duplication bug

REPORT: `score_judge.sh stdout is messy (ok=0 duplicated by grep -c exit 1)`

Raw `ops_MUL_MAT.score.txt`:
```
ok=0
0 fail=72 skip=928
judge_nonfinite=34
real_internal=36
real_fail_minus_judge=38
```
The script outputs `ok=$ok` then `fail=$fail skip=$skip` as separate echo lines. When `ok=0` and `grep -c ': OK'` returns exit 1 (no match), the `|| echo 0` fires but the `set -eu` + `tee` pipeline produces the bare `0` on its own line before `fail=72 skip=928`. The duplication is the bare `0` line. **CONFIRMED.** Bug is cosmetic; counts are still correct.

### 3. Q3 NPU avg_ts 862.597863, CPU 199.908504

REPORT: `avg_ts 862.598` and `avg_ts 199.909`

Raw `q3_npu.txt` line 1:
```json
"avg_ts": 862.597863, "samples_ts": [ 857.671, 870.426, 859.696 ]
```
Raw `q3_cpu.txt` line 1:
```json
"avg_ts": 199.908504, "samples_ts": [ 193.883, 204.34, 201.503 ]
```
**CONFIRMED.** REPORT rounds to 3dp. Matches.

### 4. Qwen NPU pp512 355.038544, tg128 8.616385; CPU 107.098663 / 19.625266

Raw `qwen_npu.txt`:
```json
"avg_ts": 355.038544, "samples_ts": [ 354.843, 356.343, 353.929 ]
"avg_ts": 8.616385,   "samples_ts": [ 8.74887, 8.44249, 8.65779 ]
```
Raw `qwen_cpu.txt`:
```json
"avg_ts": 107.098663, "samples_ts": [ 116.345, 95.0429, 109.908 ]
"avg_ts": 19.625266,  "samples_ts": [ 19.6693, 19.8015, 19.405 ]
```
**CONFIRMED.** Every value matches raw jsonl to 6dp.

### 5. sha match both GGUFs

Raw `olmoe_sha.txt`:
```
host=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618
device=9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618
```
Raw `qwen_sha.txt`:
```
host=f1635f9c30430dadae1230ee29047e70251a8926bb569a6eeae95db00ff4bd36
device=f1635f9c30430dadae1230ee29047e70251a8926bb569a6eeae95db00ff4bd36
```
**CONFIRMED.** Both match host=device. PREREG required this;_VOID did not trigger.

### 6. list_devices HTP0 v79

Raw `list_devices.txt`:
```
ggml-hex: Hexagon Arch version v79
ggml-hex: HTP0 hwinfo: threads 6, hvx 6, hmx 1, vtcm 8 MB
  HTP0: Hexagon (0 MiB, 0 MiB free)
```
**CONFIRMED.** HTP0, v79, as required by PREREG.

### 7. EXIT ops=1 benches=0 — **REFUTED**

REPORT: `test-backend-ops -b HTP0 EXIT=1 both ops (same class as #43)`

Raw `ops_MUL_MAT.adb.exit`: `0`
Raw `ops_MUL_MAT_ID.adb.exit`: `0`

**REFUTED.** Both ops exit codes are 0, not 1. REPORT falsely claims EXIT=1. The PREREG warned "Vacuous 0-executed = method fail" — the kernels ran, produced FAIL lines, but the process exited 0. REPORT hallucinated the exit code. This is a factual error in REPORT, though it does not change the verdict (OK=0 still means not patched-correct).

### 8. patched-correct FAIL (REAL≠0 or executed=0)

PREREG: "patched-correct iff REAL=0 and executed>0."

- MUL_MAT: OK=0, INTERNAL=36, real_fail_minus_judge=38. **REAL≠0.** Not patched-correct.
- MUL_MAT_ID: OK=0, real_fail_minus_judge=2. **REAL≠0.** Not patched-correct.
- Both op classes: executed OK = 0.

**CONFIRMED.** REPORT correctly concludes FAIL on patched-correct.

### 9. D OPEN on correctness, measured on dense speed

REPORT: "Treat D as OPEN on correctness, measured on dense speed."

PREREG: "D closes iff Q_ops and Q_qwen both produce a banked number." Q_qwen produced numbers. Q_ops produced a defect census (patched-correct FAIL), not a clean pass. D does not close on correctness. Dense speed numbers exist (Q3, Q_qwen).

**CONFIRMED.** D is OPEN on correctness. Speed is measured. Correct.

### 10. Missing gate_post_q3c / gate_post_qwen_cpu

REPORT: "Missing thermal post for Q3-CPU and Qwen-CPU (gate_pre_q3c exists; no gate_post_q3c / gate_post_qwen_cpu)."

Raw directory listing: `gate_pre_q3c.txt` exists. `gate_post_q3c.txt` does NOT exist. `gate_post_qwen.txt` exists (NPU only). No `gate_post_qwen_cpu.txt`.

**CONFIRMED.** Thermal post-gates for both CPU arms are missing. Pre-gates all GATE_PASS. Thermal constraint PREREG required `gate_post_q3c` to be called before Q3-CPU. Not called. Gaps exist.

### 11. Duplicate jsonl rows

REPORT: `jsonl -o/-oe duplicates each row.`

Raw `q3_npu.txt` contains exactly 2 identical JSON objects (same avg_ns=593580728). Same for `qwen_npu.txt`. The `-o jsonl -oe jsonl` flags both emit results; llama-bench double-writes.

**CONFIRMED.** Cosmetic; averages are computed from the 3 samples inside each JSON, not from duplicate rows.

---

## FIX vs APPLY

| Item | Status | Action |
|---|---|---|
| REPORT EXIT=1 claim | **Wrong.** Raw exit=0. | **FIX** REPORT.md line "EXIT=1 both ops" → "EXIT=0 both ops". |
| score_judge.sh ok= duplication | **Bug, cosmetic.** Counts correct. | **APPLY** as-is for this cell. Fix script separately if desired. |
| Missing gate_post_q3c | **Gap.** No thermal post for Q3-CPU. | **APPLY** — acknowledged in REPORT. Cannot retroactively measure. |
| Missing gate_post_qwen_cpu | **Gap.** No thermal post for Qwen-CPU. | **APPLY** — same. |
| patched-correct verdict | Correct. | **APPLIES.** No fix needed. |

---

## ARITHMETIC APPENDIX

All ratios recomputed from raw jsonl avg_ts values:

**Q3 NPU/CPU pp512:**
```
862.597863 / 199.908504 = 4.3150...
```
REPORT says 4.32×. Rounds to 4.32. **CONFIRMED.**

**Qwen prefill NPU/CPU pp512:**
```
355.038544 / 107.098663 = 3.3150...
```
REPORT says 3.32×. Rounds to 3.32. **CONFIRMED.**

**Qwen decode CPU/NPU tg128:**
```
19.625266 / 8.616385 = 2.2777...
```
REPORT says 2.28×. Rounds to 2.28. **CONFIRMED.**

All three ratios match REPORT to displayed precision.

---

## SUMMARY

REPORT is 10/11 on claims. One factual error: EXIT codes are 0, not 1. Everything else — census digits, sha matches, jsonl values, ratios, D-open verdict, missing thermal gates — checks out against raw. The score_judge.sh duplication bug is real but harmless. D remains OPEN on correctness, CLOSED on speed measurement.
