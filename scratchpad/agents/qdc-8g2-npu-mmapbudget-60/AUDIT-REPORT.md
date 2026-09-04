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

## Delta audit (second auditor, deepseek)

Hostile re-audit of REPORT.md's refutations; raw files only; all arithmetic via shell.

1. B5 live at fd27 — **CONFIRMED** (auditor-1 REFUTED). File order, logcat_ngl99_vmem1800:
   `03:07:49.691 ... fastrpc_invoke_fd_mmap_destroy fd -1 len 3d501000` (kills fd24) precedes
   `03:07:49.739 ... fd_mmap_create: fd 26 ... size 3d501000`; at the failing request
   `03:07:49.746 ... fd 27 ... size 29a01000` fd24 is dead, fd26 is live. Live set = fd20 0xbc2000
   + fd28 0x1e3200 + fd23 0x883000 + fd26 0x3d501000 + fd22 0x2001000 (+fd16/fd18 12 KiB) =
   1085460992 B = 1035.18 MiB (`python3 -c` sum). REPORT's 1033 MiB right; auditor-1's 2085.5 MiB
   double-counts fd24 AND is self-inconsistent (0x3d501000 = 981 MiB, not 1024; own list sums 2007.6).
2. B2 live at fd31 — **CONFIRMED** (auditor-1 REFUTED). `03:07:18.108 ... fd_mmap_destroy fd -1 len 1cb01000`
   precedes the fd30/fd31 creates at the same timestamp; fd24 dead, fd30 (0x1c201000 = 450 MiB) live.
   Live = fd20+fd32+fd23+fd22+fd30 (+fd17/fd18) = 528667136 B = 504.18 MiB ≈ REPORT "~501 MiB"
   (0.6% low, within ~). Auditor-1's 497.8 MiB miscounts 0x1cb01000 as 443.1 MiB (it is 459.0) and drops fd30.
3. B3 destroys — **CONFIRMED** (auditor-1 REFUTED). `grep -c fd_mmap_destroy
   raw/logcat_ngl12_mbuf1g_sa802961.txt` = 8; timestamps 03:08:50.790-51.226, all tid 15356;
   `exit_thread` 03:08:51.285, same tid → last destroy 59 ms before exit_thread, first 0.495 s.
   "8 destroys at teardown" holds.
4. 3221225472 B — **CONFIRMED** (auditor-1's FIX REFUTED). `printf`: /2^30 = 3 GiB exact;
   /10^9 = 3.221 GB. REPORT "3.00 GiB / 3.22 GB" correct; auditor-1's "3.22 GiB" was the units error.
5. HAP_mmap sentence — **REFUTED as written**: now a labelled inference ("(an inference from those
   two facts, not a quoted statement)") and the FARF fact is quoted exactly (`Error 0x8000054d:
   HAP_mmap2 failed for fd 27 of length 698355712 bytes`, logcat line 296) — but the objdump "fact"
   `call HAP_mmap@plt` at 0x29c4/0x33c4 appears NOWHERE in DISASM.md (no HAP_mmap@plt, no 0x29c4,
   0x33c4, no 0x1ff0 in any file but REPORT.md itself). One of the two quoted facts is uncitable.
6. ANON note — **CONFIRMED**. `grep -c 'unable to get ANON'` = 2 on both
   logcat_ngl8_mbuf1g (lines 39, 76) and logcat_ngl12_mbuf1g (lines 38, 75):
   `qurt_vtlb_mmap: unable to get ANON mapping, size a6000` / `size 100000`, at PD start.
7. Proof/brackets — **CONFIRMED**. Last `proof` lines match the table: B1 189 exit 0, B2 48 exit 134,
   B5 48 exit 134, B6 0 exit 1, B3 297 exit 0, B4 2688 exit 0. Brackets [24]/[48]/[48]/[48]/[36]/[24]
   = PREREG "3 × offloaded layers (24 for B1/B4, 36 for B3, 48 for B2)" + amendment per-graph 48 for
   B5/B6; sig files expected_exps 24/36/48 agree.

New findings (beyond the 7 items):
- N1: auditor-1's 1h arithmetic broken: 0x1cb01000 = 459.0 MiB (not 443.1); its 497.8 MiB matches nothing.
- N2: auditor-1's 1i arithmetic broken: 0x3d501000 = 981 MiB (not 1024); 2085.5 matches nothing (2007.6).
- N3: REPORT B1/B3 "(8 host bufs, 1.59 GiB)"/"(9 host bufs, 2.48 GiB)" are total-mapped sums
  (1623.2 MiB = 1.585 GiB; 2541.35 MiB = 2.482 GiB, DSP 11-create sum = 2541.35 MiB): each true, but
  not conversions of the REPACK-only MiB figures shown beside them — conflated presentation.
- N4: "Two tombstones per dying arm": each tomb dir holds one tombstone + one protobuf (auditor-1 1k stands).
- N5: REPORT "03:08:50.79-51.21" — last B3 destroy is 51.226 (16 ms, immaterial).

Final verdict: **BANK-WITH-FIXES**. All three auditor-1 BLOCKERs are refuted on file evidence,
and auditor-1's own sums were self-inconsistent; the G1b grid binding and the :729 VA-failure
mechanism stand. Required fixes: (a) repair or delete the unsupported `call HAP_mmap@plt` /
0x29c4-0x33c4 citation in point 1 (item 5); (b) wording cleanups N3/N4/N5. No re-run needed.
