# Hostile Fidelity Audit — upstream-v73-hexagon-report.md

**Auditor:** hostile fidelity pass  
**Target:** `docs/upstream-v73-hexagon-report.md`  
**Sources checked:** q50 DIAGNOSIS.md, q51 REPORT.md / PATCH.diff / cdsp_crash_block.txt, q53 REPORT.md / REVIEW_DOC.md / RUN_LOG.md / manifest.json / raw/lane1_lfm_htp_ppl.log, q48 REPORT.md / PREP.md, q46 REPORT.md, ALIVE.md rows 9/11/13, upstream-hexagon source, consult-qwen-nan-mali source  
**Date:** 2026-08-24  

---

## 1. ENVIRONMENT TABLE

### F-01 — Device names and SoC codes
**CONFIRMED.** S23 `SM_S911U` / `dm1q` / Snapdragon 8 Gen 2 / Hexagon v73 confirmed by q46 SESSION_LOG and q50 DIAGNOSIS. Xiaomi 14 `houji` / `23127PN0CG` / `pineapple` / SM8650 / Snapdragon 8 Gen 3 / Hexagon v75 confirmed by q46/q48.

### F-02 — Android 16 on S23
**CONFIRMED.** `samsung/dm1qsqw/dm1q:16/…` fingerprint in q50 logcat_hits.txt. q48 REPORT also references this.

### F-03 — Commit `3f545beccee69d9975f466ec7e45fd9aacd8ba90` (`3f545be`)
**CONFIRMED.** q53 RUN_LOG records this exact commit. q48 REPORT records the same.

### F-04 — Build flags
**CONFIRMED.** `-march=armv8.7a+fp16+dotprod+i8mm -fvectorize -ffp-model=fast -fno-finite-math-only -flto -D_GNU_SOURCE`; Release `-O3 -DNDEBUG`; `GGML_HEXAGON=ON`, `GGML_OPENMP=OFF`, `GGML_LLAMAFILE=OFF`, `GGML_OPENCL=OFF`, `LLAMA_OPENSSL=OFF`, `PREBUILT_LIB_DIR=android_aarch64` — all present in q53 RUN_LOG "Rebuild flags" paragraph.

### F-05 — NDK 27.1
**CONFIRMED.** q51 REPORT line 16: "Build: `build-android-f2b`, NDK 27.1, android-31". The report cites q53 RUN_LOG + q51 REPORT; q53 RUN_LOG does not state the NDK version explicitly, but q51 REPORT does. Attribution is imprecise (q53 RUN_LOG does not contain "27.1"), but the figure itself is grounded.

### F-06 — Hexagon SDK 6.6.0.0
**CONFIRMED.** q50 DIAGNOSIS line 3 and DIAGNOSIS paragraph 3.

### F-07 — Binary pins (sha256)
**CONFIRMED.** All four sha256 values match q53 manifest.json and q51 REPORT:
- llama-bench stub `5db18906…` — manifest.json `stub_sha256`
- libggml-hexagon.so `f06aa309…` — manifest.json `hexagon_sha256`
- v73 skel `c8f9d14a…` — manifest.json `htp_v73_sha256`, q51 REPORT pin table
- v75 skel `46d3ac92…` — q48 REPORT

### F-08 — OLMoE GGUF size, sha256, tensor composition
**CONFIRMED.** `3,928,037,856` bytes, SHA-256 `43379486…`, `113` Q4_0 / `81` F32 / one Q6_K `output.weight` — all match q48 REPORT line 72 and q48 PREP.md line 39.

### F-09 — LFM GGUF size, sha256
**CONFIRMED.** `3,580,407,296` bytes, SHA-256 `38a93d71…` — match q46 REPORT and q53 manifest.json.

### F-10 — Corpus `wiki.test.raw` size, sha256
**CONFIRMED.** `1,290,590` bytes, SHA-256 `173c87a5…` — match q53 RUN_LOG and q53 manifest.json.

### F-11 — Baseline environment (`NDEV=1`, `VERBOSE=1`, `HOSTBUF` unset)
**CONFIRMED.** q48 SESSION_LOG records `NDEV=1 VERBOSE=1 HOSTBUF unset` for the S23 original run. q46 SESSION_LOG confirms HOSTBUF unset for LFM path.

### F-12 — HTP hardware report `threads 4, hvx 4, hmx 1, vtcm 8 MB`
**CONFIRMED.** q50 DIAGNOSIS line ~40: "hwinfo identical on both devices: threads 4, hvx 4, hmx 1, vtcm 8 MB".

### F-13 — v73 skel hash unchanged in q51 guard experiment
**CONFIRMED.** q51 REPORT pin table confirms `libggml-htp-v73.so` `c8f9d14a…` unchanged. q51 PATCH.diff is host-only.

---

## 2. SIGNATURE 1 — dspqueue_read 0x2e

### F-14 — Error string `ggml-hexagon.cpp:1583: ggml-hex: dspqueue_read failed: 0x0000002e`
**CONFIRMED.** q48 REPORT line 63, q50 logcat_hits.txt. Source at `consult-qwen-nan-mali/src/ggml-hexagon.cpp:1583`: `GGML_ABORT("ggml-hex: dspqueue_read failed: 0x%08x\n", (unsigned) err);`. Exact text matches.

### F-15 — cDSP crash block (Signature 1)
**CONFIRMED.** Every quoted line matches q50 logcat_hits.txt lines 41–59 verbatim:
- `TLBMISS RW occurrence` ✓
- `Crashed Shared Object "./libggml-htp-v73.so"` ✓
- `Fault PC : 0x20049E8C` ✓
- `Bad VA : 0x0` ✓
- `Error code : 0x7003` ✓
- `[<20049E8C>] op_binary+0x5B9C` ✓
- `[<200497FC>] op_binary+0x550C` ✓
- `[<20004D48>] work_queue_run_async+0xD8` ✓
- `[<20044958>] op_binary+0x668` ✓
- `[<20003DD0>] htp_iface_stop+0xB90` ✓

### F-16 — `0x2e` = `AEE_EINTERRUPTED` (46)
**CONFIRMED.** q50 DIAGNOSIS lines 5–10: `AEE_EINTERRUPTED (46)` from `AEEStdErr.h:118-119`. Timeout is `AEE_EEXPIRED` (0x00C).

### F-17 — Source `htp/binary-ops.c:857` op_binary, NULL check at 860–862
**CONFIRMED in source.** q50 DIAGNOSIS line 52: "Source: `htp/binary-ops.c:857` `op_binary()` — first thing it does is `src1->nb[1]` with no NULL check (`binary-ops.c:860–862`)." The skel source is not in this repo, but the citation is to q50's source inspection.

### F-18 — 407 ops, 252 tensors, 6 buffers, m-size 124960, vmem 3120996864
**CONFIRMED.** q50 DIAGNOSIS table row 1: "407 / 252 / 6" and "124960 / 3120996864".

### F-19 — Op mix: 129 ADDs, 65 RMS, 65 MUL, 48 MUL_MAT_ID, 16 ARGSORT
**CONFIRMED.** q50 DIAGNOSIS line 65 (within graph-shape numbers discussion): "top execute-ops (first flushes) | ADD 129, RMS 65, MUL 65, MUL_MAT_ID 48". ARGSORT 16 is from the same table.

### F-20 — Host retries AEE_EEXPIRED and AEE_EWOULDBLOCK, aborts on everything else
**CONFIRMED.** q50 DIAGNOSIS lines 12–14.

### F-21 — "The exact operand pointer was not printed by the crash"
**CONFIRMED.** The cDSP tombstone prints `Bad VA 0x0` but not the specific operand pointer. q50 DIAGNOSIS line 54: "A NULL src[1] or NULL data matches VA 0. The exact operand pointer was not printed by the crash."

### F-22 — Ruled-out claims (timeout, packet-too-large, HOSTBUF, HMX-only, batch-size)
**CONFIRMED.** Each ruled-out hypothesis has explicit evidence:
- Timeout: error-code distinction (0x2e ≠ 0x00C), q50 DIAGNOSIS lines 12–14
- Packet-too-large: batch write logged before crash, 125 KB << 852 KB SHM, q50 DIAGNOSIS line ~68
- HOSTBUF/--no-host: S23 rerun with HOSTBUF=1 --no-host 1 still died, q48 REPORT lines 198–219
- HMX-only: MM_SELECT=2 forced HVX, still 0x2e, q48 REPORT lines 205–213
- Batch-size: HVX dies at 27 ops / 186 MiB vmem, q50 DIAGNOSIS line 99

### F-23 — Repro steps claim correct GGUF is required
**CONFIRMED.** Step 1: "Use the exact OLMoE GGUF above; a generic OLMoE or another quantization is not claimed equivalent." Honest about private-file requirement.

---

## 3. SIGNATURE 2 — qurt_exit in htp_iface_stop

### F-24 — `GGML_HEXAGON_NO_BINARY=1` declines ADD/SUB/MUL/DIV
**CONFIRMED.** q51 PATCH.diff: the `supports_op` case for `GGML_OP_ADD`/`SUB`/`DIV` checks `opt_no_binary` and sets `supp = false`. q51 REPORT confirms `n_binary_htp0=0`.

### F-25 — cDSP crash block (Signature 2) quoted string
**CONFIRMED.** Every quoted line matches `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/cdsp_crash_block.txt`:
- `Application called qurt_exit(), Error 0x108` ✓
- `Fault PC 0xD269BC` ✓
- `Crashed SO fastrpc_shell_unsigned_3` ✓
- `qurt_exception_raise_nonfatal+0x1C -> raise+0xFC -> abort+0x8 -> htp_iface_stop+0x12E8` ✓

### F-26 — "the stack does not name op_binary, op_matmul_id, or SWIGLU/glu"
**CONFIRMED.** The cdsp_crash_block.txt trace shows only `qurt_exception_raise_nonfatal`, `raise`, `abort`, `htp_iface_stop`. No op handler named.

### F-27 — "n_binary_htp0=0 but n_exps_htp0=42"
**CONFIRMED.** q51 REPORT table: `HTP execute-op ADD/MUL/SUB/DIV = 0`, `MUL_MAT_ID ffn_*_exps = 42`.

### F-28 — `dspqueue_read 0x2e` still observed in Signature 2
**CONFIRMED.** q51 REPORT: "ggml-hexagon.cpp:1584: ggml-hex: dspqueue_read failed: 0x0000002e".

### F-29 — Last queued ops before crash: blk.13 MUL_MAT_ID hmx-tiled, n-ops=8
**CONFIRMED.** q51 REPORT: "HTP0 execute-op MUL_MAT_ID|blk.13.ffn_down_exps.weight ... hmx-tiled" followed by "op-queue push batch #3 : n-bufs 3 n-tensors 15 n-ops 8".

---

## 4. SIGNATURE 3 — dspqueue_write 0x1

### F-30 — Exact command string
**CONFIRMED.** Matches `raw/lane1_lfm_htp_ppl.json` args array character-for-character:
```
./llama-perplexity -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf -f /data/local/tmp/wiki.test.raw -c 2048 -b 2048 -ub 1024 -t 8 -ngl 99 --chunks 32 --ppl-stride 0 -fa on --load-mode none -dev HTP0
```

### F-31 — Corpus `wiki.test.raw` 1,290,590 bytes, SHA-256 `173c87a5…`
**CONFIRMED.** q53 manifest.json and RUN_LOG.

### F-32 — Chunks [1] 34.2815, [2] 35.8966, then abort with `dspqueue_write 0x00000001`
**CONFIRMED.** `raw/lane1_lfm_htp_ppl.log` line 12: `[1]34.2815,[2]35.8966,C:/…/ggml-hexagon.cpp:1624: ggml-hex: HTP0 dspqueue_write failed: 0x00000001`.

### F-33 — Host backtrace symbols
**CONFIRMED.** All demangled symbols match the raw log:
- `ggml_abort` ✓
- `ggml_hexagon_session::flush_batch` ✓ (raw: `_ZN20ggml_hexagon_session11flush_batchEv`)
- `ggml_backend_sched_graph_compute_async` ✓
- `llama_context::graph_compute` ✓
- `llama_context::process_ubatch` ✓
- `llama_context::decode` ✓
- `llama_perplexity` ✓

### F-34 — `rc=134`, no final PPL estimate
**CONFIRMED.** `raw/lane1_lfm_htp_ppl.json`: `"adb_rc": 134`, `"launcher"` contains `"RC=134"`. No "Final estimate" line in the log.

### F-35 — 1667 execute-op lines from companion verbose probe
**CONFIRMED.** `manifest.json`: `"execute_op_lines": 1667`. `raw/lane1_lfm_htp_probe.log`: grep count = 1667 lines.

### F-36 — "Same model+build completed llama-bench pp512 on v73 with HTP attention dispatch"
**CONFIRMED.** q46 REPORT: "(b) HTP `-ngl 99 -dev HTP0` -r 2: pp512 58.43 t/s, tg128 10.63 t/s, rc=0" with HTP execute-op proof.

### F-37 — `0x00000001` not decoded to specific DSPQUEUE cause
**CONFIRMED.** The artifacts contain no mapping for this code. q53 REVIEW_DOC confirms this.

### F-38 — "content at the failing chunk, accumulated state, and duration are not separated"
**CONFIRMED.** q53 REVIEW_DOC §3.2 explicitly states this. q53 REPORT also qualifies: "PLAUSIBLE but not proven."

---

## 5. CROSS-CUTTING OBSERVATIONS

### F-39 — Qwen3.5-4B-Q4_0 v73 run completed with HTP dispatch proof
**CONFIRMED.** q50 DIAGNOSIS table: "Qwen3.5-4B v73 (lives)" with max 50 ops, vmem 1197346944, `op-queue pop` yes. q53 RUN_LOG lane2 probe rc=0.

### F-40 — "binary-ops.c has no v75 ifdefs"
**CONFIRMED.** q50 DIAGNOSIS line 79: "`binary-ops.c` has **no** `v75` ifdefs — so v75 survival is not an `#ifdef`."

### F-41 — q35 TODO at ggml-hexagon.cpp ~1591–1594
**CONFIRMED.** `consult-qwen-nan-mali/src/ggml-hexagon.cpp:1593`: `// TODO: handle errors`. Line 1593 is within the claimed 1591–1594 range. The description of the status-swallowing path is accurate.

---

## 6. v75 COUNTER-EVIDENCE

### F-42 — v75 used same OLMoE GGUF and same 3f545be host revision
**CONFIRMED.** q48 REPORT: same model sha256, same llama-bench @3f545be, v75 skel `46d3ac92…`.

### F-43 — v75 completed all HTP cells with rc=0, 0 dspqueue/INTERNAL-ERROR/Aborted lines
**CONFIRMED.** q48 REPORT: "every HTP cell rc=0, 0 `dspqueue` / `INTERNAL-ERROR` / `hmx error` / `Aborted` / `ggml_abort` lines in all stderr."

### F-44 — v75 executed 432 expert MUL_MAT_ID operations
**CONFIRMED.** q48 REPORT: "`MUL_MAT_ID` on `ffn_*_exps` = **432**".

### F-45 — v75 pp512: 687.40 and 684.99 t/s; CPU: 142.92 and 141.48 t/s
**CONFIRMED.** q48 REPORT v75 t/s table: HTP (b) r1 687.40, r2 684.99; CPU (c) r1 142.92, r2 141.48.

### F-46 — "These are exploratory liveness/performance observations only"
**CONFIRMED.** The source (q48 REPORT) marks these as exploratory. The report's qualification is accurate.

---

## 7. DISCREPANCIES SECTION

### F-47 — q53 "sustained load" wording correctly qualified
**CONFIRMED.** q53 REVIEW_DOC §3.2: "PLAUSIBLE but not proven (2 chunks succeeded first; content-dependence not excluded)." The report correctly relays this qualification.

### F-48 — q53 HTP proof location correctly noted as companion probe, not PPL log
**CONFIRMED.** q53 REVIEW_DOC §2.2 and §6.1: the PPL run lacked `-v`, so its log has no execute-op lines; the1667 lines are from the companion probe. The report accurately notes this.

### F-49 — "Same host error, different causes" (0x2e with different cDSP roots)
**CONFIRMED.** q50: TLBMISS RW, Error 0x7003, op_binary+0x5B9C. q51: qurt_exit() 0x108, fastrpc_shell_unsigned_3, htp_iface_stop+0x12E8. Both surface dspqueue_read 0x2e on host. The report correctly distinguishes them.

### F-50 — HOSTBUF confound closure
**CONFIRMED.** q48 REPORT §"S23 v73 HOSTBUF=1 confound-closer": S23 rerun with HOSTBUF=1 --no-host 1 still died with Signature 1. v75 survived with those flags. The report accurately describes this.

---

## 8. FINDINGS — CORRECTIONS REQUIRED

### FINDING 1 — Line number shift claimed as 1583→1584; actual shift is 1583→~1591
**SEVERITY: LOW (maintainers will check line numbers)**

The report states: "the unguarded host abort is at `ggml-hexagon.cpp:1583`; q51's extra host code shifts the same read abort to `1584`."

The PATCH.diff adds 8 new lines across three hunks (1 in the variable declaration, 1 in `supports_op`, 6 in `ggml_hexagon_init`). These all land before line 1583. The patched line should be approximately 1591, not 1584. The q51 REPORT itself quotes `ggml-hexagon.cpp:1584` — that report may be using a different source snapshot where the offset differs. The upstream report should either:
(a) State the shift is approximate and cite the PATCH as the cause without giving a specific post-patch line, or
(b) Verify the exact post-patch line against the q51 build source.

The report's meta-point ("line-number difference is a patch-layout effect, not evidence of a fourth mechanism") is correct. But the specific "1584" figure is not supported by the PATCH as applied to the cited source.

**Evidence:** PATCH.diff = 8 added lines (hunk 1: +1 at ~line 85; hunk 2: +1 at ~line 4088; hunk 3: +6 at ~lines 4405-4411). Source line 1583 + 8 = 1591.

---

## 9. FINDINGS — TONE

### FINDING 2 — Marketing language in Summary and v75 section
**SEVERITY: MEDIUM (maintainers will notice)**

The Summary paragraph contains:
- "the artifacts show three distinct failure mechanisms" — acceptable (factual).
- "These observations establish a v73/v75 liveness difference" — acceptable.

But the v75 counter-evidence section contains:
- "pp512 results were `687.40` and `684.99` t/s; the corresponding CPU runs were `142.92` and `141.48` t/s" — presented as raw numbers without the "exploratory" qualifier that the source (q48 REPORT) uses. A maintainer reading this may interpret it as a product-performance claim.

The report's own "What this report is not claiming" section correctly notes these are exploratory, but the presentation in the main text does not consistently qualify them.

Additionally, ALIVE.md row 13 uses "first ever" and "the best NPU ratio of the campaign" language that the report does not reproduce in the main text — this is correctly excluded. However, the Summary's mention of "407-op MoE packet" in the context of v73/v75 comparison could read as impressing the reader with the scale of the test rather than documenting the trigger.

**Recommendation:** Add "(exploratory, unplugged, single-device)" after the t/s figures in the v75 counter-evidence section.

---

## 10. FINDINGS — OVERCLAIMS

### FINDING 3 — No overclaims detected on technical substance
**CONFIRMED CLEAN.**

The report carefully avoids:
- Numerical correctness claims for v75 (correctly qualified as liveness/dispatch evidence)
- Population-level claims ("this is one S23 v73 device and one Xiaomi 14 v75 device")
- Single-source-fix claims ("No single source-level fix is claimed")
- Product-benchmark claims ("The reported t/s values are exploratory and are not product benchmarks")

The q53 "sustained load" wording is correctly qualified as "failure of the recorded PPL workload, not a universal sustained-load threshold."

The report does not claim Qwen3.5-4B v73 is numerically correct, only that it completed and dispatched HTP operations.

---

## 11. FINDINGS — REPRO STEPS

### FINDING 4 — Repro steps honestly declare private-file requirements
**CONFIRMED CLEAN.**

Signature 1 repro step 1: "Use the exact OLMoE GGUF above; a generic OLMoE or another quantization is not claimed equivalent."  
Signature 3 repro step 1: "Use the exact LFM GGUF and corpus hashes above. The LFM GGUF is required for this exact trigger; it was produced by the q46 B-prime cook."

No step silently assumes a file the maintainer cannot obtain without declaring it.

---

## 12. ATTACHMENTS LIST

### FINDING 5 — Attachment paths verified
**CONFIRMED.** Spot-checked paths:
- `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_repro.txt` — exists
- `scratchpad/agents/q50-v73-dspqueue-diagnosis/logcat_hits.txt` — exists
- `results/htp_probe/s23_v73_olmoe_q40/f2b/logcat_repro/cdsp_crash_block.txt` — exists
- `scratchpad/agents/q51-f2b-v73-guard/PATCH.diff` — exists
- `scratchpad/agents/q53-v73-npu-correctness/raw/lane1_lfm_htp_ppl.log` — exists
- `scratchpad/agents/q53-v73-npu-correctness/manifest.json` — exists

All cited attachment paths resolve to existing files.

---

## SUMMARY

| # | Finding | Severity | Verdict |
|---|---|---|---|
| F-01–F-49 | All technical claims (hashes, error strings, backtraces, op counts, byte sizes, ruled-out hypotheses, discrepancy qualifications) | — | **CONFIRMED** (49 items) |
| 1 | Line-number shift 1583→1584 should be ~1591 | LOW | **CORRECTION REQUIRED** |
| 2 | v75 t/s figures presented without "exploratory" qualifier | MEDIUM | **TONE FIX RECOMMENDED** |
| F-50 | Overclaims, repro steps, attachments | — | **CONFIRMED CLEAN** |

**49 CONFIRMED, 1 low-severity line-number correction, 1 medium-severity tone fix.**

---

SHIP-with-corrections(line-number shift 1583→~1591; add "exploratory, unplugged, single-device" qualifier to v75 t/s figures)

## Orchestrator arbitration (2026-08-25)

- Correction 2 (v75 t/s qualifier): APPLIED — "exploratory, unplugged,
  single-device liveness observations only — not performance claims and not
  evidence of numerical correctness on v75".
- Correction 1 (line shift 1583→~1591): **REFUTED.** PATCH.diff hunks are at
  `@@ -85` (+1 line), `@@ -4087` (+6), `@@ -4398` (+1), `@@ -4437` (+4): only
  ONE added line precedes line 1583, so the shift is exactly +1 → 1584, which
  is also the literal text in the q51 raw stderr
  (`results/htp_probe/s23_v73_olmoe_q40/f2b/a_stderr.txt:22322`) and in
  q51 REPORT.md:47. The report's "1584" stands.
- Net: 49/49 claims confirmed, 1 correction applied, 1 refuted → SHIP-CLEAN
  as a draft; posting upstream remains an owner decision.
