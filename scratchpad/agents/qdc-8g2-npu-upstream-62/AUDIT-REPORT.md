# AUDIT-REPORT — Cell #62 REPORT.md

Hostile read-only audit. All arithmetic via shell/python3.

## Verdict: **BANK-WITH-FIXES**

No BLOCKERs. Two FIX items, four NOTEs. All table numbers, arithmetic, and grid binding
confirmed against raw.

---

## (1) Numbers vs raw — all CONFIRMED

- **Exit codes**: All four arms exit 134. `up_ngl99_sa803054.out:1: proof n_exps_htp0=33 exit=134`, `up_ngl99_mbuf512_sa803054.out:1: …n_exps_htp0=32…`, `up_ngl99_vmem1800_sa803054.out:1: …n_exps_htp0=34…`, `up_ngl8_sa803054.out:1: …n_exps_htp0=14…` ✓
- **Thread names**: U0/U1=work-queue:2, U2=work-queue:1, U5=htp-main — confirmed via logcat grep. ✓
- **Fault PC**: `logcat_up_ngl8_sa803054.txt: CDSP0: Fault PC   :    0x20242B34`, load 0x20200000. ✓
- **Arithmetic**: python3: `hex(0x3da50 + 0x50e4)` = `0x42b34`. ✓
- **op_binary**: `DISASM-upstream.txt: 0003da50 g DF .text 000006e8 op_binary`. ✓
- **mmap/defrag**: `grep -c 'mmap failed' logcat_up_*_sa803054.txt` → all 0. ✓ (but see FIX-1)
- **Last ADD**: `up_ngl8_sa803054.err:8872: …ADD|node_928 x ffn_moe_weighted-15 (view)…4:8192 x 4:65536 -> 4:8192`. ✓
- **dspqueue**: `up_ngl8_sa803054.err: ggml-hexagon.cpp:2734: ggml-hex: dspqueue_read failed: 0x0000002e`. ✓

## (2) Grid — CONFIRMED, no H1/H2/H3 slippage

REPORT: "METHOD-VOID for the mapping question (U1 died) + H4 NEW FINDING on every arm".
Body: "U0/U2/U5 say nothing about the mapping fix (H1-H3 not claimable)". PREREG binds
U1 dies → METHOD-VOID; any arm with non-mapping death → H4. Correctly applied.

## (3) S23 comparison — FIX-2 applies

| Attribute | S23 (upstream-v73-hexagon-report.md:30-40) | #62 | Match |
|---|---|---|---|
| Fault type | TLBMISS RW | TLBMISS RW | ✓ |
| Symbol | op_binary+0x5B9C | op_binary+0x50E4 | ✗ offset |
| Thread | htp-main | work-queue:2/1/htp-main (only U5) | partial |
| Bad VA | 0x0 (NULL deref) | non-NULL (0x42b34) | ✗ different mode |
| Skel | 3f545bec | 64a155d24 | noted |

**FIX-2** [FIX]: REPORT doesn't note S23 had `Bad VA 0x0` (NULL deref) while #62's address
is non-NULL (0x42b34 in `binary_job_vector_same_shape`). Material failure-mode difference.

NOTE-1: Only U5 thread matches S23's `htp-main`. REPORT quotes S23 thread without noting mismatch.

## (4) "Does NOT reproduce on our kit" — CONFIRMED

`qdc-8g2-npu-mmapbudget-60/raw/ngl8_mbuf1g_sa802961.err`: same layer-15 ADDs with
`4:8192 x 4:65536` strides queued. `ngl8_mbuf1g_sa802961.out: proof n_exps_htp0=189 exit=0`.
No TLBMISS. Same ops, different outcome.

NOTE-2: #60's surviving run also has 2 `unable to get ANON mapping` lines — confirms they're
benign background noise.

## (5) Candidates — CONFIRMED, properly hedged

All listed as "candidates (not tested)". The #26501 observation ("work-queue:N thread, a
construct our kit does not have") is structural correlation, not causal claim.

## (6) Consequence 2 — CONFIRMED

Every element (board HDK8550, sha 361e8d83…, commit 64a155d24, -ngl 8/99, TLBMISS in
op_binary) present in MODEL_SHA.txt, logcat, and table.

## (7) Omissions and prose

**FIX-1** [FIX]: REPORT says "Zero mmap failed / defragmentation FARF lines in any logcat"
(correct for those strings) but omits 2 `qurt_vtlb_mmap: unable to get ANON mapping` lines
per logcat (sizes b1000, 100000). These indicate vTLB pressure. They don't change the grid
binding (#60's surviving run has them too), but should be acknowledged.

NOTE-3: "7.9 min billed" is a portal metric not verifiable from raw. Driver log shows 5m17s
active. Plausible but unverifiable.

---

## Items

| # | Sev | Finding |
|---|---|---|
| FIX-1 | FIX | Acknowledge `unable to get ANON mapping` lines in "Zero mmap/defrag" summary |
| FIX-2 | FIX | Note S23 `Bad VA 0x0` (NULL deref) vs #62 non-NULL — different failure mode |
| NOTE-1 | NOTE | Only U5 thread matches S23's htp-main |
| NOTE-2 | NOTE | #60 survives with same `unable to get` lines — confirms benign |
| NOTE-3 | NOTE | 7.9 min billed not verifiable from raw |
