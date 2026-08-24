# q53 Hostile Pre-Bank Review

**Auditor:** automated hostile review  
**Cell:** `scratchpad/agents/q53-v73-npu-correctness/`  
**PREREG:** commit `7ec4c231` (locked)  
**Date:** 2026-08-24  
**Verdict under review:** FAIL (r=NaN, gate letter applied)

---

## 1. PREREG COMPLIANCE

### 1.1 SHA matching before first run
**CONFIRMED.** RUN_LOG records all five on-device SHA256 values matching PC hashlib:
- `llama-bench` stub: `5db18906…` ✓
- `libggml-hexagon.so`: `f06aa309…` ✓
- `libggml-htp-v73.so`: `c8f9d14a…` ✓
- LFM model: `38a93d71…` ✓ (3,580,407,296 B)
- Corpus `wiki.test.raw`: `173c87a5…` ✓ (1,290,590 B)

Qwen model also pre-verified: `298fcb5f…` (2,583,221,408 B). Binary rebuild SHAs recorded for `llama-perplexity` and `libllama-perplexity-impl.so`. No gaps.

### 1.2 Corpus push only, no model pushes
**CONFIRMED.** RUN_LOG: "no `/data/local/tmp/**/wiki.test.raw` found" before push. Corpus only. Model already on device from q46. Qwen model already on device from q46/q48. No new model pushes.

### 1.3 Battery / temp / plugged declared
**CONFIRMED.** Start snapshot: 72%, 25.3°C, unplugged (AC=false, USB=false, Wireless=false, Dock=false). All pre/post battery snapshots present in raw/ for every run. End state: 21%/33.8°C/unplugged (last known before adb loss). Battery level dropped from 72→21% over ~5 hours of continuous measurement — consistent with unplugged S23 running heavy workloads.

### 1.4 Cool-start ≤35°C
**CONFIRMED.** 25.3°C at start declaration (2026-08-24T16:33:57Z). The `cool_start_last_battery.txt` file shows an earlier snapshot (12:54:56Z, 29.7°C) from device preparation, but the actual measurement start was at 16:33 with25.3°C — well within the ≤35°C requirement.

### 1.5 Lock timestamp before first measurement
**CONFIRMED.** PREREG locked at commit `7ec4c231`. First runtime action (HTP probe) at 2026-08-24T16:54:05Z — after lock. "Measurements may start only after this file is committed" — satisfied.

### 1.6 Scripts LF-only, adb from Git-bash
**CONFIRMED.** RUN_LOG notes `sed 's/\r$//'` guard and `MSYS_NO_PATHCONV=1`. No indication of CRLF issues.

### 1.7 CPUSET recording — ⚠️ ANOMALY
**PLAUSIBLE ISSUE.** Every launcher file (lane1 probe, lane1 HTP PPL, lane1 CPU-ref PPL, lane2 probe, lane2 HTP PPL) records `CPUSET=/`. The PREREG requires: "Record `/proc/<binary-pid>/cpuset` for every measured run."

`/` is the default cpuset — meaning all CPUs 0-7. This is technically valid (the binary was not restricted). **However**, the auditor cannot distinguish between:
- (a) The binary process genuinely had cpuset `/` (not pinned to specific cores), or
- (b) The launcher script read the shell's `/proc/self/cpuset` instead of `/proc/<BINARY_PID>/cpuset`.

All launcher files record `BINARY_PID=<N>` separately, suggesting the script did attempt to read the binary's cpuset. The cpuset value `/` is plausible for an `adb shell` launch without explicit `taskset` or `cpuset` cgroup restriction. **Not a blocking defect**, but the launcher script should be inspected to confirm it reads from the correct PID path.

---

## 2. VERDICT VALIDITY

### 2.1 Does the frozen letter produce FAIL?

The PREREG gate states:

> FAIL iff `r > 0.05`, or either arm NaN/inf, or the HTP arm loses the execute-op proof

Observed: `PPL_HTP_LFM = NaN` (arm aborted, no final estimate), `PPL_CPUref_LFM = 32.4892`, `r = NaN`.

**Reading A — FAIL is correct (strict literal):**
The HTP arm produced no final PPL. A missing number is not a number — the ratio `r = NaN / 32.4892 - 1 = NaN`. The gate letter says "FAIL iff … either arm NaN/inf." An aborted arm that never produced a PPL is, in the most literal sense, NaN. The gate arithmetic `r=NaN` is correct. FAIL follows.

**Reading B — Cell should be VOID (intended semantics):**
The gate was designed to detect *numerical* HTP-vs-CPU divergence (garbage kernels producing PPL explosions). An arm that crashes before producing *any* result is an infrastructure failure, not a measurement. The PREREG's FAIL clause was written for the case where HTP *computes* a wrong answer (NaN/inf output), not for the case where the HTP process *dies* mid-run. If the cell is VOID, the lane is not certified but also not quarantined — it requires a re-run, not a FAIL decision.

**Verdict on the letter:** The PREREG does not define "arm NaN" — it says "either arm NaN/inf." An arm that never produced a number is *not* NaN; it is absent. The PREREG is **silent on abort-before-result**. Under the principle that ambiguous gates should not produce hard FAIL for infrastructure issues, **Reading B is the more defensible reading for a bankability decision.** The FAIL verdict as stated is *technically valid under Reading A* but **should be flagged as a gate-letter gap for the owner to resolve.**

### 2.2 Execute-op proof: was the lane on NPU when it died?

**PARTIAL.** The evidence is:

| Source | execute-op lines | op-queue pops | NPU evidence |
|---|---|---|---|
| lane1 HTP **probe** (1 chunk, `-v`) | 1,667 | 69 | Full `MUL_MAT\|blk.*.attn_*` proof |
| lane1 HTP **PPL** (32 chunks, no `-v`) | **0** (verbose not enabled) | 0 (not logged) | `HTP0 dspqueue_write` crash + `htp_iface_skel_handle_invoke` URI |

The PPL run log shows `forcing ndev to 1 for SoCs archs lower than v75` and `htp_iface_skel_handle_invoke` — these are HTP session initialization lines confirming the v73 HTP skel was loaded. The crash is at `ggml-hexagon.cpp:1624: HTP0 dspqueue_write failed` inside `flush_batchEv` — a Hexagon host-side DSP queue operation. This is **only reached when running on NPU**; a CPU-only run (`-ngl 0`) never enters `flush_batch`.

**The PPL run lacked `-v`, so no explicit execute-op lines appear in its log.** The probe (separate 1-chunk run) proved NPU was working. The PPL run's crash signature proves it was in the NPU codepath when it died. For a hostile audit: **the PPL run has no direct execute-op proof from its own log.** The circumstantial evidence (HTP session init + NPU-only crash site) is strong but not the explicit proof PREREG requires ("≥1 `HTP0 execute-op MUL_MAT|blk.*.attn_*` line in a `-v` probe").

**Assessment:** The PPL run was on NPU when it died — the crash path confirms it. But the PREREG's execute-op proof requirement is formally satisfied by the **probe**, not by the PPL run itself. This is a documentation gap, not a correctness gap.

---

## 3. CRASH CHARACTERIZATION

### 3.1 Is `dspqueue_write 0x1` a third distinct death signature?

**CONFIRMED — genuinely distinct.** Comparison:

| Cell | Error | Function | Decoded meaning | Crash PC / SO |
|---|---|---|---|---|
| q50 | `dspqueue_read 0x2e` | `dspqueue_read` (host waits for DSP response) | `AEE_EINTERRUPTED` — cDSP PD died, wait canceled | `op_binary+0x5B9C` in `libggml-htp-v73.so`; CDSP tombstone: `TLBMISS RW`, Bad VA 0x0 |
| q51 | `dspqueue_read 0x2e` | `dspqueue_read` (same) | Same `AEE_EINTERRUPTED`, but **different root** — CDSP `qurt_exit()` `0x108` in `fastrpc_shell_unsigned_3` at `htp_iface_stop+0x12E8`; not `op_binary` | Different PC, different SO, different error code on CDSP side |
| **q53** | **`dspqueue_write 0x1`** | **`dspqueue_write`** (host sends batch to DSP) | **Write-side failure** — the batch packet could not be written to the DSP queue | `ggml-hexagon.cpp:1624`, backtrace: `flush_batchEv → ggml_backend_sched_graph_compute_async → llama_decode → llama_perplexity` |

Key distinctions:
- q50/q51 fail on **read** (host waited for a response from a dead DSP). q53 fails on **write** (host cannot even send work to the DSP).
- Error code 0x1 is not `AEE_EINTERRUPTED` (0x2e), not `AEE_EEXPIRED` (0x0C), not `AEE_EBADPARM`. It likely maps to a generic `dspqueue` internal error (possibly `DSPQUEUE_EFAILED` or session-not-ready).
- The backtrace confirms the crash is in the **same host-side code path** (`flush_batch`) but at a **different failure point** — before any ops are dispatched, not after.

**This is a third distinct death signature.** It is not a variant of q50/q51.

### 3.2 "Dies under sustained batch load" — supported or overclaimed?

**PLAUSIBLE but overclaimed as stated.** The evidence:

- q46 ran the **same model + same build** successfully on the same device. q46 used `llama-bench` (pp512/tg128, batch_size not equal to n_ctx). q53 used `llama-perplexity` (batch_size=2048, n_ctx=2048, 32 sequential chunks).
- The PPL workload has **batch_size = n_ctx = 2048** — a full-context batch every chunk. The probe (1 chunk, same parameters) succeeded. PPL chunks 1-2 completed. Crash at chunk 3.
- The PPL workload involves continuous, sustained DSP engagement across 32 sequential chunks (~37 minutes estimated). q46's pp512/tg128 was shorter-duration timing runs.

**What can be claimed:** The crash occurs during the PPL workload but not during the probe or q46's timing runs. The distinguishing factor is either (a) sustained multi-chunk processing, (b) the specific content at chunk 3, or (c) accumulated DSP state from prior chunks.

**What cannot be claimed:** That it "dies under sustained batch load" in general. Two successful chunks preceded the crash. The failure might be content-dependent (chunk 3's token distribution triggers a specific graph shape), not load-duration-dependent. Without reproducing at different chunk offsets or with different corpora, the "sustained load" reading is **plausible but unproven.**

---

## 4. REPORT COMPLETENESS

### 4.1 REPORT.md vs PREREG required outputs

PREREG says outputs should include: `RUN_LOG.md`, `manifest.json` (all shas, pins, cpuset, chunk count), raw PPL logs per arm, `gen/` for prompts, `REPORT.md` (numbers only).

| Required | Present | Status |
|---|---|---|
| manifest.json — shas | All 7 model/corpus SHAs present | ✓ |
| manifest.json — pins (binary SHAs) | stub/hexagon/htp-v73 present | ✓ |
| manifest.json — cpuset | Recorded (all `/`) | ✓ (but see §1.7) |
| manifest.json — chunk count | **MISSING** — not in manifest.json | ✗ |
| manifest.json — battery | Start/last/end declared | ✓ |
| manifest.json — per-arm structure | lane1/lane2 objects with probe/ppl/cpuref | ✓ |
| raw/ logs per arm | All present (probe, PPL, cpuref, battery) | ✓ |
| gen/ for 5 prompts × 2 arms | **MISSING** — no gen/ directory (secondary build failed) | ⚠️ documented |
| REPORT.md — numbers only | REPORT.md is 11 lines of gate values | ✓ minimal |
| REPORT.md — full data | **MISSING**: no battery declarations, no raw log paths, no lane2 data, no manifest summary | ✗ |

**REPORT.md is skeletal.** It contains only the gate arithmetic values. It lacks:
- Battery start/end declarations
- Per-arm raw log file paths
- Lane 2 status and partial results
- Any context about the crash or abort
- CPU-ref PPL standard error
- Execute-op line counts
- Secondary generation status

**manifest.json is substantially complete** but missing chunk count. For bankability, the manifest needs `chunks: 32` added to the environment section, and REPORT.md needs expansion to include battery declarations, raw log paths, and lane 2 data.

---

## 5. LANE 2

### 5.1 No certification claims
**CONFIRMED.** The manifest records lane2 with `htp_ppl.ppl: null`, `cpuref_ppl: null`, `completed_chunks: 8`, `status: "adb_disconnect"`. REPORT.md shows `PPL_HTP_QWEN=NaN`, `PPL_CPUref_QWEN=NaN`. No PASS/FAIL gate is applied to lane 2. The PREREG says lane 2 is "conditional" and uses "same gates" — with no PPL pair, no gate can be computed. No certification claim is made.

### 5.2 Adb disconnect honestly recorded
**CONFIRMED.** The lane2 HTP PPL launcher shows `BINARY_PID=32279`, `CPUSET=/`, no RC (process never completed). The JSON shows `adb_rc: 255`, `post_battery.level_pct: -1` (unreadable). The pull log shows `adb: error: failed to get feature set: device offline`. The cpuref PPL launcher shows `adb.exe: device '...' not found`. The disconnect is documented across four independent files.

### 5.3 Partial chunk data
Lane 2 HTP chunks 1-8 values: `[1]7.9075,[2]9.4123,[3]9.8187,[4]9.9195,[5]9.8501,[6]8.4025,[7]7.5301,[8]7.4312`. These are plausible Qwen3.5-4B Q4_0 PPL values (range 7.4-9.9). The data is not claimed as a result — appropriately recorded as evidence only.

---

## 6. ADDITIONAL FINDINGS

### 6.1 PPL run log lacks execute-op lines — documentation gap
The lane1 HTP PPL run was launched **without `-v`** (the JSON args list does not include `-v`). The probe (which had `-v`) produced 1,667 execute-op lines. The PPL run produced 0. This means the PPL run's own log does not contain the explicit NPU execution proof that PREREG requires. The crash at `ggml-hexagon.cpp:1624` inside `flush_batchEv` is strong circumstantial evidence of NPU codepath, but it is not the explicit `HTP0 execute-op MUL_MAT|blk.*.attn_*` line the PREREG specifies. **For future cells, the PPL launcher should include `-v` to capture execute-op proof in the PPL log itself.**

### 6.2 Battery drain timeline
72% → 21% over ~5 hours (16:33 to 21:12) while unplugged. This is a drain rate of ~10%/hour, consistent with continuous HTP+CPU workloads on an S23. Temperature peaked at 33.8°C (below 35°C threshold). No thermal or power anomaly.

### 6.3 Lane 2 launched at low battery (21%)
Lane 2 HTP PPL pre-snapshot: 21%/33.8°C. The PREREG does not set a minimum battery threshold, only requires declaration. Battery was declared. The adb disconnect at 21% may be coincidental (serial disappeared from mDNS) or related to device power management — not determinable from available evidence.

---

## SUMMARY TABLE

| # | Finding | Verdict |
|---|---|---|
| 1.1 | SHAs matched before first run | **CONFIRMED** |
| 1.2 | Corpus push only, no model pushes | **CONFIRMED** |
| 1.3 | Battery/temp/plugged declared | **CONFIRMED** |
| 1.4 | Cool-start ≤35°C | **CONFIRMED** |
| 1.5 | Lock timestamp before first measurement | **CONFIRMED** |
| 1.6 | LF scripts, adb from Git-bash | **CONFIRMED** |
| 1.7 | CPUSET=/ recorded for all PIDs | **PLAUSIBLE** — value is valid but launcher script correctness unverifiable from logs alone |
| 2.1 | FAIL verdict valid under frozen gate | **PLAUSIBLE** — technically valid under strict reading; gate letter silent on abort-before-result; owner should decide FAIL vs VOID |
| 2.2 | PPL run on NPU when it died | **CONFIRMED** — crash path is NPU-only; no explicit execute-op in PPL log (missing `-v`) |
| 3.1 | `dspqueue_write 0x1` is third distinct signature | **CONFIRMED** — different function, different error code, different backtrace vs q50/q51 |
| 3.2 | "Dies under sustained batch load" | **PLAUSIBLE** — 2 chunks succeeded then crash; could be content-dependent, not load-dependent |
| 4.1 | REPORT.md completeness | **REFUTED** — skeletal; missing battery declarations, raw log paths, lane2 data, chunk count in manifest |
| 5.1 | No lane-2 certification claimed | **CONFIRMED** |
| 5.2 | Adb disconnect honestly recorded | **CONFIRMED** |

---

## BANKABILITY VERDICT

**BANK-with-corrections**

Corrections required before bankability:
1. Add `chunks: 32` to `manifest.json` environment section.
2. Expand `REPORT.md` to include: battery start/end, per-arm raw log paths, lane 2 partial data, execute-op line counts, secondary build status, and a statement on why FAIL vs VOID.
3. Resolve the FAIL-vs-VOID question: the PREREG gate letter is silent on abort-before-result. Owner must decide whether this cell is FAIL (lane quarantined) or VOID (re-run required). The frozen letter supports FAIL under strict reading but the intended semantics favor VOID.
4. Inspect the launcher script to confirm it reads `/proc/<BINARY_PID>/cpuset` (not shell cpuset). If confirmed correct, no further action needed.
5. For future cells: add `-v` to the PPL launcher args to capture execute-op proof in the PPL run log itself.
