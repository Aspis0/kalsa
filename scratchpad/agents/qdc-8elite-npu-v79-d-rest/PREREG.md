# PREREG — Session 1 D remainder + #44 Q3 — cell #45 candidate

Written BEFORE any QDC queue. Commit hash of this file is the lock id.
Does NOT reopen #44 Q1/Q2 (already SURVIVES). Does NOT run q63-on-HTP
(deferred). Same kit pin as #43/#44: `npu-kit-556118a08.tgz`.

## Minutes (binding)

QRD8750 after #44: ~711 min remaining. Hard cap once Running: **20 min
wall**. Billing starts at Running, not Submitted. Connect must be armed
BEFORE submit (watcher + `d_run.sh` on disk). One crash ends the NPU arm;
do not retry that invocation. Remaining arms NOT RUN if cap trips.

## DROP ORDER (stop if elapsed ≥ 16 min of the 20)

1. **Connect + tunnel 6037 + kit.** Jelly 5037 untouched. `--list-devices`
   WITH `LD_LIBRARY_PATH`/`ADSP_LIBRARY_PATH`. Exact backend name; if it
   is not `HTP0`, use the printed name. Vacuous 0-executed = method fail.
2. **Q_ops (patched-judge as SCORE, not a kit rebuild).** Kit 556118a08
   has no judge-code patch. Run `test-backend-ops -b <HTP> -o MUL_MAT`
   then `-o MUL_MAT_ID`. Post-score with `score_judge.sh`:
   - CPU nan/inf/-nan/-inf in the FAIL line → **JUDGE**
   - `dspcall` / `INTERNAL-ERROR` / dspqueue / qurt_exit → **REAL**
   - FAIL with both sides finite → **REAL**
   - OK with executed>0 → **OK**
   Verdict "patched-correct" iff REAL=0 and executed>0. JUDGE counts are
   reported, not FAILs of the kernels. Repeats #43 unpatched census if
   the scorer is not applied — applying the scorer IS the patch.
3. **Q3 (#44 leftover, report-only).** OLMoE Q4_0 requant sha
   `9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`
   (3928038208 B). On-device sha mismatch = METHOD-VOID this arm.
   `llama-bench --device HTP0 -ngl 99 -p 512 -n 0 -r 3 --no-warmup`
   `-o jsonl -oe jsonl`. **No** `GGML_HEXAGON_VERBOSE`. Take pp512 mean
   from jsonl. Optional CPU twin (`-ngl 0`, no `--device HTP0`) only if
   elapsed < 10 min after the NPU run; else skip and declare.
4. **Q_qwen (Qwen3.5-4B Q4_0 dense).** File produced on PC before queue:
   requant Q4_K_M → Q4_0, bytes+sha in `MODEL_QWEN.txt`. If that file is
   missing at queue time this arm is **VOID**, do not block 2–3.
   Bench: `-p 512 -n 128 -r 3` NPU then CPU (CPU only if elapsed < 12 min).
   Q4_0 HTP-supported. Not PPL. Not comparable to q63 C1 (different quant).

Thermal gate AMENDMENT-1 before EACH invocation: live HAL max ≤60 °C
and status ≤1. Fail → remaining NOT RUN.

## Decision rule

- Q_ops: patched-correct iff REAL=0 and executed>0 on both op classes.
  REAL>0 = v79 defect list extended (quote shapes). JUDGE-only FAILs do
  not block SURVIVES-style language for kernels.
- Q3: report pp512 mean r=3. No routing verdict. Not comparable to #43
  1512 (different model) or to #44 verbose r=1 845.9.
- Q_qwen: report pp512 and tg128 means. Seeds v79 dense column. No
  routing verdict.
- Session 1 D closes iff Q_ops and Q_qwen both produce a banked number
  (VOID-on-missing-GGUF does not close D). Q3 is leftover of #44, not
  a D-closer.

## What this cell cannot say

Nothing about v73/v75; nothing about K-quant experts; nothing about PPL;
nothing about HVX 28c (still frozen); no governor routing card.
