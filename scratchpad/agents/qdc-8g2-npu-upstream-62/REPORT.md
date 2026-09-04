# REPORT — Cell #62: the pure-upstream kit dies on v73 at ANY size with a TLBMISS in `op_binary` — the S23's Signature 1, not the mapping death (HDK8550)

Date: 2026-09-04 (owner full delegation). QDC job 798985 (`sa803054`), HDK8550 unit `300b45e6`
(v73, Android 16), Started 08:41:50 → Ended 08:49:43 (portal, verified after reload) = 7.9 min billed. Kit `npu-kit-62-upstream.tgz`
(sha 1baee516…, built from upstream/master 64a155d24 = branch kalsa/upstream-snapshot-2026-09-04,
contains #26501 and #28202), model allenai OLMoE Q4_0 `361e8d83…` (sha verified on device),
template T of #60 with `--mmap 0`, `.farf`=0x1F, HOSTBUF unset. PREREG + two lock addenda
audited (AUDIT-PRERUN.md: FIX-THEN-RUN → delta RUN). Driver 08:42:08 → 08:47:25 (push 3 min,
four arms ~30 s each), thermal gate PASS everywhere.

## Verdict: **METHOD-VOID for the mapping question (U1 died) + H4 NEW FINDING on every arm**

| arm | config | proof (n_exps_htp0 at death) | exit | cDSP crash block |
|---|---|---|---|---|
| U0 `up_ngl99` | `-ngl 99` | 33 | 134 | thread `work-queue:2`, **TLBMISS RW**, Fault PC 0x20242B34 = `op_binary+0x50E4` (libggml-htp-v73.so @0x20200000) |
| U2 `up_ngl99_mbuf512` | + `GGML_HEXAGON_MBUF=512` | 32 | 134 | thread `work-queue:1`, TLBMISS RW, same PC |
| U5 `up_ngl99_vmem1800` | + `GGML_HEXAGON_VMEM=1800` | 34 | 134 | thread `htp-main`, TLBMISS RW, same PC |
| U1 `up_ngl8` | `-ngl 8` | 14 | 134 | thread `work-queue:2`, TLBMISS RW, same PC |

Host side in all four: `ggml-hexagon.cpp:2734: ggml-hex: dspqueue_read failed: 0x0000002e`
(the symptom, as in #59/#60). **Zero** `mmap failed` / `defragmentation` FARF lines in any
logcat (raw/logcat_up_*; the only `qurt_vtlb_mmap` lines are the two benign `unable to get ANON
mapping, size b1000 / 100000` at PD start, present in every arm here and in #60's survivors):
the upstream skel's mapping path never failed; the process died
earlier, in compute. The PREREG's precedence rule applies: U1 (1.6 GiB of experts, the
configuration that survived in #60 on our kit) dies → the kit is broken on this device for the
question asked; U0/U2/U5 say nothing about the mapping fix (H1-H3 not claimable).

## The new finding (H4), pinned

- Fault PC 0x20242B34 − load 0x20200000 = 0x42B34 → inside `binary_job_vector_same_shape`
  (raw/crash_pc_resolution.txt: `42b2c: loop0(0x42b34,r13)`, `42b34: v20 = vmem(r9++#0x1)`,
  `42b38: v22.qf32 = vadd(v20.sf,v21.sf)`): the f32 vector-add loop reads `src` through a bad
  address → data TLB miss. The crash reporter names it `op_binary+0x50E4` (op_binary at
  0x3da50, size 0x6e8, is the nearest exported symbol).
- Last host-queued ops before the death (raw/up_ngl8_sa803054.err, same in ngl99):
  `ADD|node_928 x ffn_moe_weighted-15 (view) -> ffn_moe_out-15 … 4:8192 x 4:65536 -> 4:8192`,
  `ADD|ffn_moe_out-15 x ffn_inp-15 -> l_out-15`, then RMS_NORM/MUL of the output norm. The
  queue is asynchronous, so the faulting op is not proven to be the last logged one; the
  strided-view operand (`nb1 = 65536` vs 8192) of the first ADD is the natural suspect and is
  recorded as such, not as a proof.
- **Same family as the S23's original Signature 1** (dossier: q50, `TLBMISS RW`, thread
  `htp-main`, `op_binary+0x5B9C` on the 3f545bec skel) — and the same failure MODE: all four
  #62 crash blocks carry `Bad VA : 0x0` and `Error code : 0x7003`, exactly q50's values (a NULL
  data pointer dereferenced by the vector load); only the code offset differs because the skel
  differs, and the thread differs (`work-queue:N` / `htp-main` here vs `htp-main` on the S23). It reproduces on reference hardware
  with a build 3+ months newer than the S23's — and it does NOT reproduce on our kit
  (022458a28 + kalsa commits: #59/#60 ran the same layer-15 ADDs and died only in mapping, or
  survived at ngl 8/12). Which change separates the two is NOT established here; candidates
  (not tested): our branch's `hexagon: gate HMX eligibility on logical ne01 %32` (736ddd206),
  `HTP_ZERO_TILE_PAD` (ca82efa8b), or upstream changes after #25968 (#26501 work-queue threads
  — the death is in a `work-queue:N` thread, a construct our kit does not have).
- Proof counters are lower than #60's (33/32/34 vs 48 at ngl 99; 14 vs 24 at ngl 8) because the
  process died during the first graph, not after it — consistent with a compute-time fault.

## Consequences

1. Cell #62 does not answer whether #26501/#28202 fix the v73 mapping death: the upstream kit
   cannot get past layer 15's binary ops on this device. A kit that carries upstream's
   defragmentation path AND our branch's binary-op behaviour would be needed (or a bisect of
   the upstream range 022458a28..64a155d24 for the TLBMISS, ≈4 QDC runs of 8 min).
2. Dossier #8 gains a strong upstream-facing fact: **upstream master @64a155d24 crashes on
   Snapdragon 8 Gen 2 (HDK8550, public board) with OLMoE Q4_0 at `-ngl 8` and `-ngl 99` —
   TLBMISS in `op_binary` — reproducible with the public repro recipe, no kalsa code involved.**
   This is the strongest bug report we have (pure upstream + public board + public model).
3. F6 (reformulated in #60) is untouched: it is about OUR kit; nothing here weakens or
   strengthens the partial-offload result.

## Confounds / not established

The kit was built with android-34 (kit-v6: android-31) and the host build needed one retry
(BUILD.md) — a build-environment confound for the crash is not excluded but unlikely to move a
DSP-side data fault. Knob effects (MBUF/VMEM) are moot: all arms died before mapping pressure.
No bisect, no attempt to run upstream's skel with our host lib or vice versa.

## Session accounting

Submitted 08:38:33, Started 08:41:50, driver 08:42:08 → 08:47:25, End Session ref-click + Yes + reload → Completed, Ended On 08:49:43 (7.9 min billed, ~2 idle).
8 Gen 2 pool: 934 → ~926 min. Driver log: raw/driver_sa803054.log.

## Audit response (AUDIT-REPORT.md, before banking)

- FIX-1 accepted: the benign `unable to get ANON mapping` lines are now acknowledged.
- FIX-2 REFUTED by the raw and turned into a stronger statement: #62's crash blocks have
  `Bad VA : 0x0` and `Error code : 0x7003` in all four arms (raw/logcat_up_*, `CDSP0:` lines),
  identical to q50's Signature 1 — same NULL-dereference mode, not a different one; the
  auditor compared the code address (Fault PC) with q50's data address (Bad VA).
- NOTEs (thread-name mismatch, offset beyond the exported symbol's size, billing time from
  the portal) are already stated in the text; the billing time is the portal's "Ended On".
