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

**PC step DONE** (lock `6432f211`, product after lock, zero QDC minutes):
`MODEL.txt` — dst
`kalsa-models/OLMoE-1B-7B-0924-Instruct-Q4_0-requant-from-q4km.gguf`,
bytes **3928038208**, sha256
`9d0b90c60a5b4732ba1faeb0b8940523173bf7e2a7f038d5753ce3ac24b98618`,
censure 113 Q4_0 / 81 F32 / 1 Q6_K (same counts as q55, different sha,
+352 B). Quantize bin: `kalsallama/build/bin/llama-quantize`, exit 0,
6823.41 ms.

Post-upload BINDING: sha256 the GGUF **on-device**; mismatch = METHOD-VOID
(do not interpret as DOES-NOT-SURVIVE). #43 did this
(`model_sha_device_793389.txt`).

HTP-supported types only (Q4_0 path). KEXP / Q4_K_M excluded by construction.

## Questions (in order; stop on fail)

1. **Load + dispatch.** llama-bench on the produced Q4_0, NPU arm only,
   `-v`, `-p 512 -n 0 -r 1 --no-warmup -ngl 99 --device HTP0` plus the #43
   HTP env (`LD_LIBRARY_PATH` / `ADSP_LIBRARY_PATH`) **and
   `GGML_HEXAGON_VERBOSE=1`**. `-v` on llama-bench does NOT set
   `opt_verbose` (`llama-bench.cpp` only sets `params.verbose`); the
   execute-op line is gated at `ggml-hexagon.cpp:107` (`if (!opt_verbose)
   return`) and `opt_verbose` is only `atoi(GGML_HEXAGON_VERBOSE)`
   (`ggml-hexagon.cpp:4331,4374`). Proof the line exists under that env:
   q51 `f2b_driver.sh` + REPORT `HTP0 execute-op MUL_MAT_ID|blk.13.ffn_down_exps`.
   #43 kit ran without it; #43 raw has zero execute-op lines.
   Load is a **precondition**, not a verdict: load failure or unsupported
   tensor → **METHOD-VOID**, not DOES-NOT-SURVIVE.
   SURVIVE-DISPATCH iff the log contains `HTP0 execute-op MUL_MAT_ID` on
   `ffn_*_exps` (quote ≥1 line).
2. **Survive the invocation.** Same run: exit 0. Non-zero **after a
   successful load** = DOES-NOT-SURVIVE; bank the rc and the crash/error
   tail (v73 catalog: dspqueue_read 0x2e / qurt_exit / dspqueue_write 0x1;
   new signatures quoted verbatim). Do not re-run.
3. **Prefill number (only if Q1 and Q2 both pass).** One more NPU invocation
   `-p 512 -n 0 -r 3` (still `-n 0`, no decode), **without**
   `GGML_HEXAGON_VERBOSE` (clean number). Printer: `-o jsonl -oe jsonl`
   and take the pp512 mean from the jsonl rows (markdown printer has no
   per-rep median). Optional CPU twin (`-ngl 0`, no `--device HTP0`)
   **only if** Q1+Q2 passed AND wall remaining ≥ 8 min; else skip and
   declare so.

## Kit / method

- Same kit as #43: rebuild/run **from kalsallama `556118a08`**, not from
  branch HEAD `cff0a4a75`/`204e78259`. Artifact npu-kit-556118a08
  (llama-bench + libggml-htp-v79.so). Do not rebuild unless the kit is
  missing; if rebuilt, it must still be from `556118a08` and the new sha
  goes in the REPORT.
- Thermal gate AMENDMENT-1 (#38) BINDING: live HAL max ≤60 °C and status ≤1
  before EACH invocation; snapshot after. >15 min cooldown → remaining
  NOT RUN.
- Upload: kit **10.8 MB** (banked #43, tgz 10 796 556 B) + GGUF ~4 GB.
  Live-probe rule: projected >45 min upload → VOID-before-start (do not
  sit on a Running session waiting on a stall).
- Backend name: exact device name from `--list-devices` (flag `--list`
  does not exist on llama-bench @ 556118a08; `-h` does not enumerate
  devices), not assumed `HTP0` if the banner disagrees. Vacuous
  0-executed is a banked failure of method, not of v79.

## Decision rule (pre-written)

- **SURVIVES** iff Q1 and Q2 both pass.
- **DOES-NOT-SURVIVE** iff Q1 fails (no MUL_MAT_ID execute-op **after a
  successful load**) OR Q2 fails (non-zero exit / crash **after a
  successful load**).
- Either SURVIVES or DOES-NOT-SURVIVE answers the OLMoE experts-on-NPU
  pp512 question. It does **not** close Session 1 D: patched-judge
  test-backend-ops and Qwen3.5-4B dense v79 remain **OPEN** (own cells);
  q63-on-HTP stays **DROPPED** on DOES-NOT-SURVIVE and **deferred** on
  SURVIVES (not this 20 min cap).
- Q3 is report-only. No routing verdict. No comparison to #43 ship-model
  2.6B numbers (different model). No comparison to q55 PPL (different file).
- HVX 28c stays frozen regardless: q63 already PASS, so the pre-delegated
  "q63 FAILS" conjunct is false.

## What this cell cannot say

Nothing about v73/v75; nothing about K-quant; nothing about PPL; nothing
about the 36 INTERNAL-ERROR shapes from #43; nothing about the app; nothing
about energy; no governor routing card.
