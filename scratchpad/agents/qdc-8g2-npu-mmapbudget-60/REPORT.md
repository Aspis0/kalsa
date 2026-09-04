# REPORT — Cell #60: the v73 death is a DSP virtual-address failure in `mmap_buf` (HDK8550)

Date: 2026-09-04 early morning (owner full delegation). QDC job 798892 (`sa802961`), device
`47874641`, HDK8550 (Snapdragon 8 Gen 2, Hexagon v73, Android 16). Session Started 06:02:56 →
Ended 06:11:27 (portal, verified after reload) = **8.5 min billed** (8 Gen 2 pool 944 → ~935);
device work 06:03:23 → 06:09:37 (model push 3 min, six arms ~30 s each). PREREG + amendment 1
audited pre-run (AUDIT-PRERUN.md: FIX-THEN-RUN → P2/P6 refuted by arithmetic and by reading →
delta audit RUN). Thermal gate PASS on all 12 pre/post snapshots (HAL 33-35 °C, status 0), zero
retries. Kit npu-kit-59 (same skel as #59), model allenai OLMoE Q4_0 `361e8d83…` (sha verified
on device), `--mmap 0`, HOSTBUF unset throughout.

## Verdict: **G1b** (budget real, the vmem/eviction knob does not save it) — and the mechanism is now named

| arm | config | HTP-REPACK bytes | proof n_exps_htp0 (cumulative; PREREG per-graph expectation in brackets) | exit | DSP-side line (FARF via `llama-bench.farf`, logcat `adsprpc`) |
|---|---|---|---|---|---|
| B1 `ngl8_mbuf1g` | `-ngl 8` | 1575 MiB (8 host-registered buffers, 1.59 GiB total) | 189 [24] | **0** | — |
| B2 `ngl99_mbuf512` | `-ngl 99`, `GGML_HEXAGON_MBUF=512` | 3600 MiB (12 host bufs, max 459 MiB) | 48 [48] | **134** | `qurt_vtlb_mmap: unable to get virtual address, size 1b901000` → `Error 0x80000483: fastrpc_mmap failed pa 0x31c400000` → `HAP_mmap2 failed for fd 31 of length 462426112` → `mmap failed : va FFFFFFFF fd 31 size 462426112` → abort (`htp_iface_start+0x1348` = main.c:729) |
| B5 `ngl99_vmem1800` | `-ngl 99`, `GGML_HEXAGON_VMEM=1800` | 3600 MiB (8 host bufs) | 48 [48] | **134** | same chain, `fd 27 size 698355712`, `pa 0x31cc00000` |
| B6 `ngl99_vmem0` | `-ngl 99`, `GGML_HEXAGON_VMEM=0` (measure) | — | 0 [48] | 1 | host: `measured max vmem 3221225472` (= 3.00 GiB, 3.22 GB), then `buffer mapping failed … size 698355712 … error 0x00000001` at model load → METHOD-VOID as an arm, number banked |
| B3 `ngl12_mbuf1g` | `-ngl 12` | 2475 MiB (9 host-registered buffers, 2.48 GiB total) | 297 [36] | **0** | — |
| B4 `ngl8_tg128` | `-ngl 8 -p 0 -n 128` | 1575 MiB | 2688 [24] | **0** | — (128 decode tokens through 8 expert layers on HTP) |

Proof counts are cumulative over all graphs of the run (pp16 + 8 tg tokens, or 128 tg); the
PREREG's "3 × layers" is the per-graph figure, so the survival criterion is "≥ per-graph count with
exit 0", met by B1/B3/B4. Signature identification: both deaths carry `htp_iface_start+0x1348`
on this skel = main.c:729 (DISASM.md), now CONFIRMED by the FARF text of that very line
("mmap failed : va %p fd %u size %u" with va = FFFFFFFF). One tombstone (+ its .pb) per dying arm pulled.

## What the cell established

1. **The 0x2e death is a DSP virtual-address allocation failure, not a host bug and not an
   arch-wide "MoE on v73 dies".** QuRT's `qurt_vtlb_mmap` cannot find a virtual range for a
   ~0.46-0.70 GB weight buffer; the skel's `HAP_mmap` call (objdump: `call 0x1ff0 <HAP_mmap@plt>` at
   0x29c4 and 0x33c4, now quoted in DISASM.md) returns -1 — the shell reports the failure under the name
   `HAP_mmap2 failed for fd 27 of length 698355712`, so on this firmware the two entry points
   evidently share the implementation (an inference from those two facts, not a quoted statement); the skel's `mmap_buf()` has no
   fallback and aborts; the PD dies; the host sees `dspqueue_read 0x2e`.
2. **Partial offload works on v73 — prefill AND decode.** OLMoE with 8 or 12 of 16 expert
   layers on HTP0 (1.6-2.5 GiB HTP-resident) ran pp16/tg8 to completion with expert
   dispatches proven (189/297), and B4 ran 128 decode tokens with 2688 expert dispatches — the
   first v73 NPU decode ever recorded in this project (the S23 died at pp16 with ngl 99).
3. **It is not a clean cumulative-bytes budget.** B6's probe says ~3 GiB of pinned mappings fit
   (three 1 GiB + one 256 MiB → fail), and B3 kept 2.48 GiB live (DSP log: 11 creates, the 8
   destroys are at 03:08:50.790-51.226, within 0.5 s of the fastrpc `exit_thread` line at
   03:08:51.285, i.e. teardown) — consistent with #59's death at the fourth ~1 GiB buffer (3.07 GiB
   live + 0.7). But B2 and B5 die with FAR less live: reconstructing the DSP `fd_mmap_create/
   destroy` sequence in file order (timestamps in raw/logcat_*), B2 had ~501 MiB live (fd20 11 +
   fd32 1 + fd23 8 + fd22 32 + fd30 449) after 6 evictions when the 441 MiB map (fd31,
   462426112 B) failed, and B5 ~1033 MiB live (fd20 11 + fd28 1 + fd23 8 + fd26 981 + fd22 32;
   fd24's 981 MiB was destroyed at 03:07:49.691, before fd26 was created at 49.739) when the
   666 MiB map (fd27, 698355712 B) failed at 03:07:49.746. In B5 the whole map/drop thrash
   (five ~1 GiB maps and four drops) happened inside 120 ms at 03:07:49.63-49.75. The failures follow map/unmap churn (the skel's
   `prep_op_bufs` eviction fired because 3.57 GiB > max_vmem) → the proximate cause is a VA
   allocation failure after unmaps. Readings not discriminated by this cell: (i) fragmentation
   of the PD's VA space (holes smaller than the request); (ii) QuRT TLB page-alignment
   constraints (a 666 MiB request needing an aligned power-of-two region); (iii) VA not, or
   lazily, reclaimed after `fd_mmap_destroy` (B5 created 4.8 GiB cumulatively before the
   failure, so a pure no-reclaim allocator would have failed earlier — partial reclaim is
   possible). A hard ~2 GiB PD cap (Qualcomm fastrpc #137 for older parts) is REFUTED for this
   HDK by B3's 2.48 GiB live survival and B6's 3.0 GiB probe. All three readings are the class upstream is now patching (#28202 "op batch
   buffers sorted by size to avoid address space fragmentation", 2026-09-02; #26501 mmap
   refactor/retry, 2026-08-27 — neither in our kit).
4. **The two cheap host knobs do not fix it in this build**: smaller buffers (MBUF=512) and a
   tighter vmem budget (VMEM=1800) both die; the measure mode (VMEM=0) is destructive on v73
   here (subsequent host `fastrpc_mmap` fails with error 0x1 after the probe buffers are
   released) — it must not be used on v73 with this build.
5. **The `.farf` mechanism works on QDC**: `llama-bench.farf` = `0x1F` in ADSP_LIBRARY_PATH
   routes FARF ERROR (and the fastrpc shell's own errors) to logcat tag `adsprpc`. Compile-time
   FARF HIGH lines (`prep-bufs …`) are not in the skel, so per-batch vmem accounting was not
   visible. Cost: zero. Keep it in every NPU driver from now on.

## Grid mapping (binding text in PREREG.md + amendment 1)

- B1 survives with proof, B2 dies at :729, B5 dies at :729 → **G1b**. H2 (per-mapping size
  limit) is REFUTED (B2's 462 MB mapping failed while 1 GiB ones had succeeded in B3). H1 in its
  "cumulative bytes" form is only half right: bytes matter (#59, B6's 3 GiB probe, B3's 2.48 GiB
  survival) but the proximate failure in B2/B5 is VA allocation after churn. G6 not triggered
  (B2 had 12 host mappings ≤ 16; its death is the :729 family). B3 brackets the safe region at
  ≥ 2.48 GiB live / 2475 MiB of experts for this model.
- Policy F6 ("experts-on-NPU = v75-class-only") is REFORMULATED, not repealed: on v73,
  experts-on-NPU is viable when the HTP-resident weights stay in the region this cell verified
  (≤ ~2.5 GiB, no eviction churn); a MoE whose experts exceed ~3 GiB dies in this build
  regardless of MBUF/VMEM. Owner call whether partial-offload MoE on v73 is a router option
  worth measuring for speed (this cell measured none — non-goal).

## Not established / confounds

- Whether the fragmentation is QuRT alignment (power-of-two TLB pages) or allocator policy —
  needs a skel with FARF HIGH or a synthetic map/unmap probe; not this cell.
- Whether upstream #26501 + #28202 fix B2/B5: the discriminating next cell (#61) is the same
  driver on a kit rebuilt from a base that includes both PRs (or the two picks on
  kalsa/npu-judge-v79) — B2, B5 and a plain `-ngl 99` arm.
- Inherited confounds from #59 unchanged (newer build than the S23's, allenai model bytes,
  Android 16, `--mmap 0`). The B6 probe's destructive side-effect is recorded, not explained.
- Incidental t/s of the surviving arms are in raw/*.out (jsonl) and are NOT reported here.

## Session accounting

Submitted 06:01:49, Started 06:02:56, driver 06:03:23-06:09:37, End Session ref-click + Yes
06:11, reload → Completed, Ended On 06:11:27. 8.5 min billed, ~2 min idle. Tunnel killed after.

## Audit response (AUDIT-REPORT.md, before banking)

- BLOCKER 1 (B5 live ≈ 2085 MiB) REFUTED by file order with timestamps: the `-len 981 MiB`
  destroy at 03:07:49.691 precedes the creation of fd26 (49.739), so it is fd24; live at the
  failing fd27 request = 1033 MiB (composition above). The auditor double-counted fd24.
- BLOCKER 2 (no destroy lines in B3) REFUTED: `grep -c fd_mmap_destroy` on
  raw/logcat_ngl12_mbuf1g_sa802961.txt = 8, timestamps 03:08:50.790-51.210; text amended to
  quote them and the exit_thread time.
- BLOCKER 3 (HAP_mmap → HAP_mmap2 causal claim) ACCEPTED as wording: rewritten as an inference
  from the objdump call target plus the shell's message.
- FIX "3.2 GiB" REFUTED (units): 3221225472 B = 3.00 GiB = 3.22 GB; both now printed.
- FIX B2 live bytes: exact composition now given (501 MiB).
- FIX alternatives to fragmentation: added (i)-(iii), with the 2 GiB-cap reading refuted by B3/B6.
- FIX per-graph expectations: added in brackets in the proof column.
- NOTE added: every arm, survivors included, logs `qurt_vtlb_mmap: unable to get ANON mapping,
  size a6000` / `size 100000` at PD start (raw/logcat_*, first `CDSP0:` lines) — non-fatal, not
  part of the death chain.
- Delta audit 2 (deepseek, AUDIT-REPORT.md "second auditor"): all three refutations CONFIRMED on
  file evidence; item 5 accepted — the two `call HAP_mmap@plt` sites were read from objdump but
  not transcribed: DISASM.md now quotes them; N3/N4/N5 wording applied. Verdict BANK-WITH-FIXES → fixes applied.
