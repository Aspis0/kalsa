# PREREG — v79 experts-on-NPU: does MUL_MAT_ID survive? — cell #44 candidate

Written BEFORE any QDC queue and BEFORE any measurement. The commit hash of
this file is the lock id. Closes PLAN-10DAYS Session 1 block D remainder
(OLMoE all-Q4_0 experts-on-NPU pp512). Not a routing cell. Not PPL. Not a
re-run of #43 test-backend-ops.

Prior art (other generations, not transferred): q48 v73 dispatch-YES then
llama-bench abort rc=134; q55 v75 PPL HTP-vs-CPU on sha `43379486…`.

## Minutes (binding)

QRD8750 catalog at prereg write: **746 min remaining, Unavailable**. Do not
open a session until this PREREG is committed and a hostile audit returns
APPLY. Queue is allowed overnight; **device-minute billing starts at
Running**, not at Queued. Hard cap once Running: **20 min wall**. Remaining
invocations NOT RUN if the cap trips. One crash ends the NPU arm; do not
retry the same line.

## Model

The q55 GGUF (`OLMoE-1B-7B-0924-Instruct-Q4_0.gguf`, 3 928 037 856 B, sha
`43379486db3178d89b338358d298ea0721d6c123e0107d91c5d6179371000500`) is **not
on this Mac**. Source present: `kalsa-models/s23-backup-2026-08-27/OLMoE-1B-7B-0924-Instruct-Q4_K_M.gguf`.

PC step (no QDC minutes): `llama-quantize --allow-requantize` that Q4_K_M to
Q4_0. Record bytes + sha256 of the product **before upload**. This GGUF is
**not** the q55 file and is **not** comparable to q55 PPL. It is sufficient
for the survive/crash question. If quantize fails, VOID the cell on PC; do
not queue QDC.

HTP-supported types only (Q4_0 path). KEXP / Q4_K_M excluded by construction.

## Questions (in order; stop on fail)

1. **Load + dispatch.** llama-bench on the produced Q4_0, NPU arm only,
   `-v`, `-p 512 -n 0 -r 1 --no-warmup -ngl 99 --device HTP0` plus the #43
   HTP env (`LD_LIBRARY_PATH` / `ADSP_LIBRARY_PATH` of the same kit).
   SURVIVE-DISPATCH iff the log contains
   `HTP0 execute-op MUL_MAT_ID` on `ffn_*_exps` (quote ≥1 line).
2. **Survive the invocation.** Same run: exit 0. Non-zero = DOES-NOT-SURVIVE;
   bank the rc and the crash/error tail (v73 catalog: dspqueue_read 0x2e /
   qurt_exit / dspqueue_write 0x1; new signatures quoted verbatim). Do not
   re-run.
3. **Prefill number (only if Q1 and Q2 both pass).** One more NPU invocation
   `-p 512 -n 0 -r 3` (still `-n 0`, no decode). Report pp512 median of r=3.
   Optional CPU twin (`-ngl 0`, no `--device HTP0`) **only if** Q1+Q2 passed
   AND wall remaining ≥ 8 min; else skip and declare so.

## Kit / method

- Same kit as #43: kalsallama `kalsa/governor-v0` @ `556118a08`,
  npu-kit-556118a08 (llama-bench + libggml-htp-v79.so). Do not rebuild unless
  the kit is missing; if rebuilt, pin the new sha in the REPORT.
- Thermal gate AMENDMENT-1 (#38) BINDING: live HAL max ≤60 °C and status ≤1
  before EACH invocation; snapshot after. >15 min cooldown → remaining
  NOT RUN.
- Upload: kit ~22 MB + GGUF ~4 GB. Live-probe rule: projected >45 min upload
  → VOID-before-start (do not sit on a Running session waiting on a stall).
- Backend name: exact device name from a 5-second `--list`/`-h` header, not
  assumed `HTP0` if the banner disagrees. Vacuous 0-executed is a banked
  failure of method, not of v79.

## Decision rule (pre-written)

- **SURVIVES** iff Q1 and Q2 both pass.
- **DOES-NOT-SURVIVE** iff Q1 fails (no MUL_MAT_ID execute-op) OR Q2 fails
  (non-zero exit / crash). Either is a complete answer to Session 1 D.
- Q3 is report-only. No routing verdict. No comparison to #43 ship-model
  2.6B numbers (different model). No comparison to q55 PPL (different file).
- HVX 28c stays frozen regardless: q63 already PASS, so the pre-delegated
  "q63 FAILS" conjunct is false.

## What this cell cannot say

Nothing about v73/v75; nothing about K-quant; nothing about PPL; nothing
about the 36 INTERNAL-ERROR shapes from #43; nothing about the app; nothing
about energy; no governor routing card.
