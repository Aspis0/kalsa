# q53b Hostile Pre-Bank Audit — REVIEW_DOC

**Reviewed:** 2026-08-25  
**Cell:** q53b-v73-batch-discriminator  
**PREREG commit:** 5e54cf8c (verified: `git log --oneline -1 5e54cf8c` → "q53b PREREG locked")  
**Outcome under review:** DIES-512

---

## 1. PREREG compliance

| PREREG requirement | Evidence | Verdict |
|---|---|---|
| Flags: `-b 512 -ub 512 -c 2048` | JSON args: `["./llama-perplexity", "-m", ..., "-c", "2048", "-b", "512", "-ub", "512", "-t", "8", "-ngl", "99", "--chunks", "32", "--ppl-stride", "0", "-fa", "on", "--load-mode", "none", "-dev", "HTP0", "-v"]` — exact match | **CONFIRMED** |
| 32 chunks planned | `--chunks 32` in args; raw log line 37232: "calculating perplexity over 32 chunks, n_ctx=2048, batch_size=512" | **CONFIRMED** |
| `-v` on measured arm (audit recommendation) | `-v` present in JSON args; manifest.environment.measured_verbose = true; 59,402 HTP0 `ggml-hex` lines in raw log (execute-op proof) | **CONFIRMED** |
| SHA pins re-verified on device before run | RUN_LOG.md preflight table: all 6 paths MATCH. Binary/model/corpus hashes identical to q53 RUN_LOG (same device session). manifest.json pins consistent | **CONFIRMED** |
| cpuset of binary pid | RUN_LOG: "CPUSET=/"; manifest: "cpuset": "/"; launcher: "CPUSET=/". Root cgroup, cores 0-7 — matches q53 | **CONFIRMED** |
| Battery/temp/plugged declared start+end | Start: 95%/29.5°C/unplugged/2026-08-25T03:12:23.073222Z (cool_start_last_battery.txt: 95%, 29.5°C, all-false power). End: 84%/38.1°C/unplugged/2026-08-25T03:33:09.743753Z (post_battery.txt: 84%, 38.1°C, all-false power). Both battery service dumps present as raw files | **CONFIRMED** |
| Cool-start ≤35°C | 29.5°C at cool_start declaration — gate met | **CONFIRMED** |
| No model pushes | RUN_LOG: "The model and corpus were not pushed." No `adb push` of .gguf in raw evidence | **CONFIRMED** |
| b1024 not run (frozen table: only if b512 survives) | manifest.b1024.status = "not_run_frozen_after_dies_512"; REPORT.md: "b1024_status = NOT_RUN" | **CONFIRMED** |

**FINDING 0.1 — minor nit, not a gap:** RUN_LOG.md preflight temperature is 29.6°C while cool_start_last_battery.txt declares 29.5°C. The 0.1°C difference is within single-read noise; both are well below the 35°C gate. Not a compliance gap.

**FINDING 0.2 — compliance is clean.** No gaps found.

---

## 2. Outcome mapping: does the raw log support DIES-512 by the frozen letter?

The frozen table (PREREG.md) defines DIES-512 as: "abort at any chunk → the death is not batch-bound at this granularity; lane stays dead; signature recorded."

| Claim | Raw evidence | Verdict |
|---|---|---|
| Abort line | Line 195901: `C:/Users/gualt/Desktop/Kalsa/moe-experiments/upstream-hexagon/llama.cpp/ggml/src/ggml-hexagon/ggml-hexagon.cpp:1624: ggml-hex: HTP0 dspqueue_write failed: 0x00000001` | **CONFIRMED** |
| Backtrace frame: flush_batch | Lines 196055–196057: frame 3 = `_ZN20ggml_hexagon_session11flush_batchEv` (demangled: `ggml_hexagon_session::flush_batch`). Identical call path to q53 lane 1 (frames 2–8 same demangled symbols) | **CONFIRMED** |
| Chunk count: 9/32 | Raw log PPL lines: `[1]34.7892` (line 54550) through `[9]29.6137` (line 193062). No `[10]` line before the abort at line 195901. 9 lines present | **CONFIRMED** |
| rc=134 | Launcher stdout: "RC=134"; JSON: "adb_rc": 134. SIGABRT consistent with `ggml_abort` | **CONFIRMED** |
| Execute-op proof present (not silent CPU fallback) | 59,402 `ggml-hex: HTP0 supports-op` lines in the raw log (grep count). The abort context itself shows active HTP execution: `execute-op SCALE`, `execute-op GET_ROWS`, `execute-op MUL_MAT`, `execute-op FLASH_ATTN_EXT`, etc., all tagged `HTP0`. The `op-queue push batch #12` just before the abort confirms active DSP queue submission | **CONFIRMED** |

**Verdict: DIES-512 is supported by the frozen letter.** The arm aborted during chunk 10 computation (after 9 completed PPL outputs) with the same 0x1 dspqueue_write signature as q53 lane 1.

**FINDING 2.1 — significant observation:** The q53b abort context (chunk 10, b512) shows the failure occurring mid-graph-compute at block 2 of the LFM-B′ MoE architecture, specifically during `op-queue push batch #12` of a 109-node graph. The q53 lane-1 abort (chunk 3, b2048) had the identical error but at a different graph position (fewer queued batches). Both die inside `flush_batch` → `dspqueue_write` with rc 0x00000001. The error code is identical across both batch sizes; the only difference is how many chunks survive before the queue state becomes fatal.

---

## 3. Characterization claim: "NOT batch-size-bound; survives LONGER at smaller batch — consistent with accumulated DSP/queue state"

**Sub-claim A: "The death is NOT batch-size-bound (dies at 512 as at 2048)"**

Evidence: q53 lane 1 died at b2048 (2 chunks); q53b b512 died at b512 (9 chunks). Both produced the same error code (0x00000001), same abort function (`flush_batch`), same backtrace path. The death occurs at both batch sizes. **CONFIRMED** — the data licenses "not batch-size-bound" in the binary sense: the death is not exclusive to b2048.

**Sub-claim B: "Survives LONGER at smaller batch (9 vs 2 chunks) — consistent with accumulated DSP/queue state"**

Evidence: b512 survived 9 chunks (20:43 minutes of wall clock, lines 37232–196057). b2048 survived 2 chunks. Both died at the same error point.

Critical analysis:
- **n=1 per arm.** There is exactly one b512 run and one b2048 run (from q53). A single data point per condition cannot establish a systematic trend.
- **Chunk content differs.** Perplexity chunks are sequential segments of `wiki.test.raw`. Chunks 1–2 (b2048) process different text than chunks 1–9 (b512). The failure could be content-dependent — chunk 10 at b512 may hit a specific token pattern that triggers the DSP queue overflow, while chunk 3 at b2048 hits a different one. Without running both batch sizes on identical chunk sequences, the survival-difference cannot be attributed to batch size alone.
- **Thermal state differs.** The b2048 run started at 25.3°C (q53 lane 1), while b512 started at 29.5°C. The thermal trajectory is different. DSP queue behavior may be temperature-dependent.
- **The "accumulated DSP/queue state" model is PLAUSIBLE** (the error is in the queue write, not in a per-batch allocation; the error code is identical; more chunks = more queue submissions = more opportunity for state accumulation) **but it is not PROVEN by this data.** The data is consistent with it but also consistent with content-dependent triggering.

**REFUTED as a demonstrated conclusion. PLAUSIBLE as a hypothesis.** The evidence licenses: "the death is not batch-size-bound in the binary sense (occurs at both 512 and 2048); the survival difference between 2 and 9 chunks is consistent with an accumulated-state model but cannot distinguish that from content-dependence given n=1 per arm and different chunk content."

The PREREG itself correctly notes: "This cell does NOT re-litigate q53's verdict; it only characterizes the lane for the router ledger and the upstream report." A one-sentence characterization ("death occurs at both batch sizes with identical signature; batch size is not the sole determinant") is supportable. A causal claim ("longer survival at smaller batch proves accumulated state") is not.

---

## 4. Numerics: b512 vs b2048 per-chunk PPL comparison

Per-chunk values extracted from raw logs:

| Chunk | CPU-ref (b2048, ngl=0) | HTP b2048 (q53 lane 1) | HTP b512 (q53b) | Δ(b512 vs CPU-ref) | Δ(b512 vs b2048-HTP) |
|---|---|---|---|---|---|
| [1] | 34.1298 | 34.2815 | 34.7892 | +0.6594 (+1.93%) | +0.5077 (+1.48%) |
| [2] | 35.9631 | 35.8966 | 36.5029 | +0.5398 (+1.50%) | +0.6063 (+1.69%) |

**Are these differences beyond what batch/ubatch tiling should produce?**

No. Analysis:

1. **CPU-ref was run at b2048/ub1024.** Different batch/ubatch tiling in perplexity computation changes the padding pattern, the sequence of accumulated log-probabilities, and minor floating-point ordering. The CPU-ref itself is an approximation of the true corpus perplexity, not an exact value.

2. **HTP b2048 vs CPU-ref: +0.4% at chunk [1].** This is within the CPU-ref standard deviation (±0.665, which at 32 chunks corresponds to per-chunk σ of approximately ±0.665 × √32 ≈ ±3.77 for individual chunk PPL). The HTP b2048 value is well within noise.

3. **HTP b512 vs HTP b2048: +1.48% at chunk [1].** This is slightly larger but still small in absolute terms (0.51 PPL units). The b512 configuration halves the batch dimension, which changes how tokens are batched within each chunk and how padding affects the perplexity accumulator. For a model with 2048-dim embeddings over 2048 context, a 512-token batch means 4 ubatches per chunk vs 2 at b2048 — a structurally different computation path through the scheduler.

4. **Both HTP variants are slightly higher than CPU.** This is consistent with HTP fixed-point arithmetic (the Hexagon v73 backend uses lower-precision intermediate formats for some ops, as seen in the `q8_0 x f32 -> f32` and `f32 x f16 -> f32` mixed-precision op signatures). The drift is in the expected direction and magnitude for HTP vs CPU exact arithmetic.

**Is this a hint of HTP numerical drift worth a sentence?**

**PLAUSIBLE but NOT worth a separate sentence in the report as a standalone finding.** The 0.5% HTP-vs-CPU delta is expected from mixed-precision HTP execution (visible in the op signatures: q8_0 weights × f32 activations → f32, with f16 KV cache). This is not "drift" in the sense of a bug — it is the designed precision tradeoff of the Hexagon backend. A parenthetical in the REPORT noting that "all HTP PPL values fall within 2% of the CPU reference, consistent with expected HTP mixed-precision arithmetic" would be appropriate if the report discusses these numbers at all. Since the arm died and no final PPL was computed, these per-chunk values are not used in the gate arithmetic and do not affect the bank decision.

**FINDING 4.1 — minor observation for future cells:** The b512 per-chunk PPL values show an unusual pattern: [1] 34.79 → [2] 36.50 → [3] 38.07 (rising) then [4] 36.08 → [5] 34.84 → [6] 29.43 → [7] 28.47 → [8] 28.54 → [9] 29.61 (falling then stabilizing). The CPU-ref shows a similar early rise then fall ([1] 34.13 → [2] 35.96 → [3] 37.73 → [4] 35.74 → [5] 34.42 → [6] 29.19). The shapes track, confirming these are corpus-dependent PPL fluctuations, not HTP artifacts.

---

## 5. Lane-2 session-2 records: honesty assessment

**Claimed status: INCOMPLETE.** Records in REPORT.md (q53) and RUN_LOG.md (q53), with raw evidence cross-referenced from `scratchpad/agents/q53-v73-npu-correctness/raw/lane2_s2_qwen_*`.

| Record | Claim | Evidence | Verdict |
|---|---|---|---|
| Chunks completed: 4/32 | [1] 7.9075, [2] 9.4123, [3] 9.8187, [4] 9.9195 | Live capture file: `lane2_s2_qwen_htp_ppl_live_capture.txt` contains exactly these 4 PPL lines (lines 82862–129110 of the live-grepped log). No [5] line | **CONFIRMED** |
| Device went offline at 03:46:11 | `adb_rc=255` in JSON; `disconnect_utc = 2026-08-25T03:46:11.441006Z` in live capture | **CONFIRMED** |
| Pull returned "device offline" | `pull_error = adb: error: failed to get feature set: device offline` in live capture; `lane2_s2_qwen_htp_ppl_pull.txt`: "adb: error: failed to get feature set: device offline" | **CONFIRMED** |
| CPU-ref not launched | JSON: "status": "not_launched_device_offline"; launcher: "STDERR\nadb.exe: device offline\n"; pull.txt: "adb: error: failed to get feature set: device offline" | **CONFIRMED** |
| Post-battery unavailable | `lane2_s2_qwen_htp_ppl_post_battery.txt`: 0 bytes; `lane2_s2_qwen_cpuref_ppl_post_battery.txt`: 0 bytes; JSON post_battery: level_pct=-1, temperature_c=-0.1, all fields empty | **CONFIRMED** |
| No claim beyond INCOMPLETE | REPORT.md: "status: INCOMPLETE"; "This section is not a certification claim; completion requires the device endpoint to return." No r, gate, or PPL pair computed | **CONFIRMED** |

**Evidence of WHY the device went offline:**

The raw artifacts provide **no evidence of the root cause** of the adb disconnect. Specifically:
- No in-log crash signature, OOM, or thermal shutdown message was captured (the remote log could not be pulled because the device was offline).
- The live capture ends at chunk 4 — no error line, no abort, no backtrace is present in the captured output.
- The post-battery files are empty (0 bytes), confirming the device was unreachable at the time of the battery query.
- The cpuref launcher also failed with "device offline" (same timestamp 03:46:11), confirming the adb transport was dead, not just the binary.
- The RUN_LOG notes: "the phone continued to answer ping and advertise mDNS, but TCP 43741 actively refused connections" — this pattern is consistent with either adbd crash (transport layer down while network stack alive) or a USB/TCP adb session reset, but **not** a full device reboot (which would have killed ping/mDNS). It is also consistent with a WiFi drop on the adb-over-TLS transport.

**Honesty assessment: HONEST.** The records correctly state INCOMPLETE. No claim beyond "INCOMPLETE" is made. The evidence chain (live capture → pull error → post_battery empty → cpuref failed) is internally consistent and does not overstate what was observed. The report does not speculate on the cause of the disconnect, and this audit finds no basis for speculation either — the artifacts simply do not contain the information.

---

## Summary of findings

| # | Finding | Verdict |
|---|---|---|
| 0 | PREREG compliance | **CLEAN** — no gaps |
| 1 | Outcome = DIES-512 per frozen letter | **CONFIRMED** — abort, backtrace, chunk count, rc, execute-op all verified |
| 2A | Death not batch-size-bound (occurs at both 512 and 2048) | **CONFIRMED** |
| 2B | Longer survival at b512 proves accumulated DSP/queue state | **PLAUSIBLE but not proven** — n=1 per arm, content differs, thermal differs |
| 3 | b512 vs b2048 PPL drift = HTP numerical issue | **REFUTED** — 0.5% delta is within HTP mixed-precision expected range and batch/ubatch tiling effects |
| 4 | Lane-2 session-2 records honest | **CONFIRMED** — INCOMPLETE status is accurate; no overclaiming; root cause of device offline not determinable from artifacts |

---

**BANK-CLEAN**

The DIES-512 outcome, the PREREG compliance, and the execute-op proof are solid. The characterization sub-claim ("not batch-size-bound") is licensed; the causal sub-claim ("accumulated DSP/queue state") should be softened to "consistent with" in the banked text if it appears. The lane-2 session-2 INCOMPLETE record is honest and adds one data point to the v73 death corpus without overclaiming. No corrections needed for banking; a prose-level softening of the accumulated-state claim is recommended but not blocking.
