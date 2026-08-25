# q53 REPORT — v73 NPU correctness gate on S23 (expanded per audit REVIEW_DOC)

PREREG locked `7ec4c231`. Device unplugged throughout (declared: AC/USB/Wireless/
Dock all false at start). Battery 72% / 25.3 °C at start (cool-start gate met),
21% / 33.8 °C at last capture. cpuset: `/` (root, cores 0-7), read from
`/proc/<binary-pid>/cpuset` of the backgrounded binary itself (launcher
`run_q53_device.py:121`, `$pid=$!`) — compliant. All sha pins MATCHED before
first run (see RUN_LOG.md preflight). Corpus-only push; no model pushes.

## Lane 1 — LFM-B′ trunk-on-NPU (the gated lane)

```
PPL_HTP_LFM        = NaN   (arm ABORTED, rc=134, no final estimate)
PPL_CPUref_LFM     = 32.4892 +/- 0.66534   (32/32 chunks, -c 2048)
r                  = NaN
HTP_execute_op     = 1667 lines (probe, raw/lane1_lfm_htp_probe.log) — lane
                     genuinely on NPU before and when it died; proof held
gate               = FAIL (by the frozen letter: "either arm NaN")
```

Abort mechanism (raw/lane1_lfm_htp_ppl.log): chunks [1] 34.2815, [2] 35.8966
computed, then `ggml-hexagon.cpp:1624: HTP0 dspqueue_write failed: 0x00000001`
→ ggml_abort in `ggml_hexagon_session::flush_batch`. Workload: perplexity
batch_size=2048, n_ctx=2048, 69.95 s/pass. Audit REVIEW_DOC confirms this is a
**third distinct v73 death signature** (dspqueue_WRITE 0x1 in flush_batch) vs
q50 (`dspqueue_read 0x2e`) and q51 (`qurt_exit` in htp_iface_stop). Same
model+build ran clean at llama-bench pp512 (q46): the "dies under sustained
batch-2048 load" reading is PLAUSIBLE but not proven (2 chunks succeeded
first; content-dependence not excluded — audit finding kept as stated).

FAIL-vs-VOID arbitration (orchestrator, recorded): the frozen letter lists
"either arm NaN/inf" under FAIL and reserves VOID for silent CPU fallback
(execute-op proof lost). The proof was NOT lost; the arm produced no final
number → r=NaN → **FAIL by the letter**. Under either reading the ledger
consequence is identical: the v73 trunk-NPU lane is NOT certified. A batch-
size discriminator (-b 512, batch was not pinned by PREREG) is queued as a
NEW cell, not a re-run of this one.

## Lane 2 — dense/hybrid on v73 (conditional, NOT gated)

```
Model: Qwen3.5-4B-Q4_0 (already on device, sha 298fcb5f… MATCH)
HTP probe: rc=0, execute-op proof present (raw/lane2_qwen_htp_probe.log)
HTP PPL:   INTERRUPTED at 8/32 chunks (adb-tls disconnect, rc=255);
           chunk values [1] 7.9075 [2] 9.4123 [3] 9.8187 … (healthy so far)
CPUref:    not run (device unreachable)
Lane 2 verdict: INCOMPLETE — no certification claimed either way.
Completion (~40 min) possible at next device window (screen on, same wifi).
```

## Secondary (recorded, not gated)

5-prompt generation NOT executed: llama-cli does not cross-build at the
pinned commit (host `inttypes.h` failure at llama-ui-embed, 2 attempts,
raw: build_llama-cli*.log). No alternate binary used (PREREG hygiene).

## Manifest corrections (audit)

Chunk counts: lane1 HTP 2/32 completed before abort; lane1 CPUref 32/32;
lane2 HTP 8/32; lane2 CPUref 0/32. Raw evidence: `raw/` (battery brackets
pre/post per run, launcher stdout with BINARY_PID/CPUSET/RC per run, pulled
device logs). Future PPL launchers: add `-v` to the measured arm too (audit
recommendation; this run had `-v` only on probes).

## Consequences

- Router (q54) ledger: **R7 (v73 trunk-NPU) and R6 (v73 dense-NPU) stay OFF**
  — no v73 NPU lane is certifiable today; combined with q52 (behavioral FAIL
  of the B′ trunk), the B′ road is stopped on both axes.
- Upstream v73 dossier gains a third characterized death mechanism with
  complete raw evidence.
- The NPU menu that remains live is v75-class, itself still owing its own
  correctness cell (Xiaomi window, q55 candidate).

## Lane 2 (session 2) — partial recovery attempt

```
Model: Qwen3.5-4B-Q4_0 (already on device, sha 298fcb5f… MATCH)
HTP probe: PID 11993, cpuset /, RC=0, execute-op proof present
HTP PPL: PID 14265, cpuset /, RC=255 (adb disconnect), 4/32 chunks
           [1]7.9075 [2]9.4123 [3]9.8187 [4]9.9195
CPUref: not launched (device offline)
r: NaN
gate: NOT_COMPUTED
status: INCOMPLETE
```

The live capture and launcher/pull records are in
`raw/lane2_s2_qwen_htp_ppl_live_capture.txt`,
`raw/lane2_s2_qwen_htp_ppl_launcher.txt`, and
`raw/lane2_s2_qwen_htp_ppl_pull.txt`. This section is not a certification
claim; completion requires the device endpoint to return.
