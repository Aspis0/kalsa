# HOSTILE AUDIT — Cell #60 REPORT.md

Auditor: automated. Angles: number fidelity, grid binding, unsupported claims, PREREG omissions, prose.

## 1 — Numbers vs raw

| # | Claim (REPORT.md) | Raw evidence | Verdict | Sev |
|---|---|---|---|---|
| 1a | B1: "1575 MiB (8 host bufs, 1.59 GiB)", proof 189 | .err line 572: `HTP0-REPACK model buffer size = 1575.01 MiB`; 8 `mapped buffer` lines; .out: `n_exps_htp0=189 exit=0` | CONFIRMED | — |
| 1b | B2: exit 134, proof 48 | .out: `n_exps_htp0=48 exit=134` | CONFIRMED | — |
| 1c | B5: exit 134, proof 48 | .out: `n_exps_htp0=48 exit=134` | CONFIRMED | — |
| 1d | B3: "2475 MiB (9 host bufs, 2.48 GiB)", proof 297 | .err line 698: `HTP0-REPACK model buffer size = 2475.01 MiB`; 9 `mapped buffer` lines; .out: `n_exps_htp0=297 exit=0` | CONFIRMED | — |
| 1e | B4: proof 2688 | .out: `n_exps_htp0=2688 exit=0` | CONFIRMED (note: 128×3×8=3072 theoretical; 87.5% realized) | NOTE |
| 1f | B6: "measured max vmem 3221225472 (3 GiB)" then "256 MiB fail" | .err line 33: `HTP0 measured max vmem 3221225472`; line 24: `size 268435456 fd 25 error 0x00000001`. Measure-phase creates: 12 MiB + 3×1024 MiB + 256 MiB(fail) = 3456 MiB. The "3 GiB" is 3.22 GiB (3221225472 bytes). | PLAUSIBLE (imprecise rounding) | FIX |
| 1g | B6: "3×1 GiB + 256 MiB fail → 3 GiB, then load failure error 0x1" | Load phase .err line 850: `buffer mapping failed size 698355712 fd 28 error 0x00000001`. CONFIRMED that the 256-MiB probe fails and the subsequent model-load 698-MiB also fails. | CONFIRMED | — |
| 1h | B2 live bytes at failure "~0.53 GB" | FARF trace: fd 20(bc2000=12.3MiB) + fd 32(1e3200=1.89MiB) + fd 23(883000=8.51MiB) + fd 24(1cb01000=443.1MiB) + fd 22(2001000=32.0MiB) = 497.8 MiB ≈ 0.486 GiB. REPORT says 0.53 GB — inflated by ~9%. | PLAUSIBLE (wrong by ~46 MiB) | FIX |
| 1i | B5 live bytes at failure "~1.08 GB" | FARF trace: fd 20(bc2000) + fd 28(1e3200) + fd 22(2001000) + fd 26(3d501000=1024MiB) + fd 24(3d501000=1024MiB) = 2085.5 MiB ≈ 2.04 GiB. REPORT says 1.08 GB — off by ~1.0 GiB (nearly half the value). | REFUTED-by-my-reading | BLOCKER |
| 1j | B3: "8 destroys at exit" | .err has 9 `mapped buffer` lines (load-time creates). No `fd_mmap_destroy` lines in the .err or logcat for B3 (ngl12_mbuf1g). The claim is unsupported by the evidence I can read. | REFUTED-by-my-reading | BLOCKER |
| 1k | B2/B5 tombstones: "Two tombstones per dying arm pulled" | tomb_ngl99_mbuf512_sa802961/ contains `tombstone_00` + `tombstone_00.pb` (1 human-readable); tomb_ngl99_vmem1800_sa802961/ contains `tombstone_01` + `tombstone_01.pb` (1 human-readable). Each arm has ONE tombstone + one protobuf. | PLAUSIBLE (if .pb counts; ambiguous) | NOTE |
| 1l | Session "8.5 min billed" | Device work 06:03:23–06:09:37 = 6.23 min. Portal "Ended On 06:11:27" vs "Started 06:02:56" = 8.5 min. Idle gap ~2 min confirmed. | CONFIRMED | — |

## 2 — Grid application

| # | Claim | Evidence | Verdict | Sev |
|---|---|---|---|---|
| 2a | G1b = "B1 survives, B2 dies :729, B5 dies :729" | B1 proof 189 exit 0; B2 exit 134, sig `dspqueue_read 0x2e`; B5 exit 134, same sig. Both die at `htp_iface_start+0x1348` = main.c:729 (logcat lines 462, 325). | CONFIRMED | — |
| 2b | "H2 REFUTED" (per-mapping size limit) | B2's fd 31 (462 MiB) failed while B3's fd 24–26 (1028/1019/1028 MiB) succeeded — same firmware, same session. H2 predicted B2 (smaller buffers) would survive and B1 (larger) would die. | CONFIRMED | — |
| 2c | F6 reformulation is within PREREG G1 text | PREREG G1: "F6 is REFORMULATED from 'experts-on-NPU = v75-class-only' to 'v73: HTP-resident weight bytes must stay under a budget'". REPORT reformulates identically. | CONFIRMED | — |
| 2d | "first v73 NPU decode ever" | ALIVE row 13: S23 v73 OLMoE died at pp16 (rc=4, empty jsonl) — never reached decode. Cell #60 B4: `-p 0 -n 128` on v73, 128 decode tokens with proof 2688. `results/htp_probe/s23_v73_olmoe_q40/` shows no prior v73 decode. | CONFIRMED | — |

## 3 — Unsupported claims

| # | Claim (REPORT.md) | Evidence | Verdict | Sev |
|---|---|---|---|---|
| 3a | "HAP_mmap calls HAP_mmap2 internally on this firmware" | FARF line 441: `HAP_mmap2 failed for fd 31`. This shows the DSP shell CALLS `HAP_mmap2`, not that `HAP_mmap` calls it. No FARF line proves the internal calling relationship. | REFUTED-by-my-reading | BLOCKER |
| 3b | "fragmentation" (sole reading of "unable to get virtual address" with low live bytes) | Alternatives the REPORT should name: (1) QuRT 32-bit PD VA space hard-capped at 2 GiB (fastrpc #137 says "limited to 2GB on older devices") — B2 at 0.49 GiB is below 2 GiB, so QuRT may use a different sub-allocator limit; (2) VA alignment / power-of-two page constraints leaving no contiguous range; (3) QuRT internal fragmentation from non-reclaimed mappings after `fd_mmap_destroy`. The REPORT asserts fragmentation without acknowledging alternatives. | PLAUSIBLE (fragmentation is one reading; not the only one) | FIX |
| 3c | "measure mode is destructive" | B6 .err: `measured max vmem 3221225472` → 4 successful creates (3.2 GiB) → 256-MiB fail → model-load `buffer mapping failed size 698355712 error 0x00000001`. The measurement itself completed; the DESTRUCTIVE effect is on the subsequent model load. REPORT conflates measurement with post-measurement load failure. | PLAUSIBLE (the effect is real; the label "destructive" is imprecise) | NOTE |

## 4 — PREREG omissions

| # | PREREG promise | REPORT coverage | Verdict | Sev |
|---|---|---|---|---|
| 4a | "expected_exps per-graph" vs cumulative (PREREG defines survival as per-graph count) | REPORT table footnote explains cumulative but does NOT state the per-graph expected counts for each arm (24/48/36) as separate numbers. The mapping is left implicit. | REFUTED (omitted) | FIX |
| 4b | G6 check: B2's `mapped buffer` line count vs 16 slots | REPORT says "G6 not triggered (B2 had 12 host mappings ≤ 16)". The actual `mapped buffer` count in B2 .err is 12 lines (confirmed). Stated but not elaborated. | CONFIRMED | — |
| 4c | B6 informative status (PREREG: "its N is banked whatever the arm's exit") | REPORT states `measured max vmem 3221225472 (3 GiB)` and notes the load failure. The measure result is banked. | CONFIRMED | — |

## 5 — Prose / structure

| # | Issue | Evidence | Verdict | Sev |
|---|---|---|---|---|
| 5a | "8 or 12 of 16 expert layers" — B1 is ngl8 (8 layers), B3 is ngl12 (12 layers). The text says "8 or 12" which is correct. | d_run.sh: `ngl8` and `ngl12` arms | CONFIRMED | — |
| 5b | Proof footnote says "3 × layers is the per-graph figure" but the proof counts (189, 297, 2688) don't decompose cleanly into `N_graphs × 3 × layers` for all arms. B4: 128 decode tokens × 3 × 8 = 3072 theoretical, proof 2688 (87.5%). | .out files confirm n_exps_htp0 values. | NOTE (minor: proof is a lower bound, not exact) | NOTE |
| 5c | Verdict line: "G1b (budget real, the vmem/eviction knob does not save it)". Grid G1b = "B1 survives, B2 dies :729, B5 dies :729". Table confirms all three. | Verdict consistent with table. | CONFIRMED | — |

## Summary

**BLOCKER (3):** 1i — B5 live bytes miscalculated by ~1.0 GiB; 1j — B3 "8 destroys at exit" unsupported; 3a — "HAP_mmap calls HAP_mmap2" unsupported causal claim.

**FIX (4):** 1f — B6 "3 GiB" should be 3.2 GiB; 1h — B2 live bytes off by ~46 MiB; 3b — "fragmentation" should list alternatives; 4a — per-graph expected_exps omitted.

**NOTE (4):** 1e — B4 proof 2688 vs theoretical 3072; 1k — tombstone file count ambiguous; 3c — "destructive" label imprecise; 5b — proof decomposition inexact.
