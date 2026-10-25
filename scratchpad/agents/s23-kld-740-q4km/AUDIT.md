# AUDIT - s23-kld-740-q4km REPORT.md (sections 1-11) and raw/

Reviewer: independent, read-only. Everything below was re-derived from the raw files, the
engine worktree `/Users/marco/Projects/kalsallama-wt-1068` at commit `1068eb03d` (clean tree),
and the lab archive. Line references are given per claim.

## Answer to the deciding question

Yes, with tightly drawn caveats. The measurement itself is sound as far as this audit can
take it: every quoted statistic is transcribed faithfully from `raw/gpu-arm.log`, the
aggregation was verified against the tool source at the audited commit (127 scored positions
per chunk, cumulative per-chunk rows, pooled median over 1778 positions, binomial same-top),
the corpus is byte-identical to the one behind the archived 750 numbers (md5 recomputed on
the Mac copy), and both arms ran where they claim: a silent full CPU fallback is excluded by
a 15x per-pass timing gap and by a KLD far above the instrument's quantization floor with
same-top far above chance, and a mis-specified reference is excluded by the PPL(base)
agreement. The gate failure is enormous in both limbs, so no plausible error of the flagged
kinds could flip the verdict. These numbers may be quoted as: on one Galaxy S23 (SM-S911U,
Adreno 740, driver E031.41.03.62), one unreplicated native run at engine `1068eb03d`,
LFM2.5-2.6B Q4_K_M, `-fa off`, seed 42, the pre-registered conjunctive gate failed at median
KLD 0.394993 (limit 0.005) and same-top 63.892% (limit 95%), n=1778. They may NOT be quoted
for three things the report also says or implies. (1) "The engine behaves like the unfixed
path" (REPORT.md:159-161) is a causal claim the source contradicts: at `1068eb03d` the only
Q4_K GEMM kernel reachable on this device carries the f32-product fix (`67c73d26c`, a
verified ancestor), so the defensible reading is that the fixed kernel ran and did not
rescue this quant on this device, not that the fix was absent; which kernel actually
executed is not provable from the archived raw (banner filtered, cl-cache deleted) and needs
a runtime artefact. (2) "Same instrument, verbatim commands" (REPORT.md:31,34) is true of
the CLI protocol but false of the binary: the 750 acceptance ran a purpose-built probe kit
with `KALSA_GEMM_MATH`/`KALSA_GEMM_PREC` env selection (omitted from the report's quoted
command), a different engine commit, and a cloud QRD dev board, and the model quant differs
(Q4_0 vs Q4_K_M, declared). (3) The hygiene record (battery, cleanup, settings) is entirely
report-author assertion with no archived raw artefact; on a phone with a known prior
settings-overwrite incident those claims cannot be taken on assertion. Two facts worth
stating alongside any quote: the pooled PPL delta is -0.727638 +/- 1.031892, indistinguishable
from zero, so this is specifically a token-distribution/top-1 failure concentrated in a tail
of positions (max KLD 17.95); and the engine's own policy file carries a same-day owner
enablement of V73 explicitly labeled "not a measurement" that these numbers now contradict -
under the lab's R6 protocol the numbers are exactly the evidence the owner must weigh, not a
mechanical close of the lane.

---

## Item 1 - NUMBERS: CONFIRMED as transcriptions and as internally consistent; independent recomputation impossible

**Transcription.** Every number in REPORT.md section 8 matches `raw/gpu-arm.log`
line-for-line: median KLD 0.394993 (gpu-arm.log:41), same-top 63.892 +/- 1.139 %
(gpu-arm.log:64), Mean PPL(Q)-PPL(base) -0.727638 +/- 1.031892 (gpu-arm.log:32), Mean KLD
0.661847 +/- 0.023464 (gpu-arm.log:35), Mean PPL(Q)/PPL(base) 26.475441/27.203079
(gpu-arm.log:27-28). CPU arm: 14 chunks, PPL = 27.2114 +/- 2.08767 (cpu-arm.log:7-9). No
discrepancy found.

**Recomputation.** Not possible from the archived raw, and the report does not pretend
otherwise: `raw/` holds only the tool's printed tables. The per-position reference file
`cpu.kld` was deleted from the phone (REPORT.md:180-182) and never archived, so no
independent recomputation of KLD, same-top or PPL delta can be done by anyone. The audit
therefore verified the statistics at the next best level, the tool source at the audited
commit, plus numerical consistency checks of the printed tables against that source.

**Aggregation, verified from source** (`tools/perplexity/perplexity.cpp` at `1068eb03d`):
- Scored positions per chunk = `n_ctx - 1 - n_ctx/2` = 256-1-128 = 127 (:1758-1760, `first =
  n_ctx/2` at :1792); logits are requested only for pos >= 128 and the last position of each
  chunk is excluded. 127 x 14 = 1778. The report's "127 per chunk x 14 chunks" (REPORT.md:143)
  is exactly right.
- The per-chunk table rows are CUMULATIVE, not per-chunk: the `kld` accumulators are declared
  outside the chunk loop and never reset, and each row prints the running mean and SEM
  (:1897-1912). Data confirms: row 14 equals the final statistics block exactly (PPL 26.4754,
  KLD 0.66185, same-top 63.892).
- Median KLD is the median of all 1778 pooled KLD values, sorted, even-count average of the
  two middle values (:1950-1952). Not a median of chunk medians.
- Same-top is n_same_top/count with binomial SE sqrt(p(1-p)/(count-1)) (:2004-2005).

**Consistency checks passed.** The binomial SEs pin the running sample size: row 1
62.205 +/- 4.320 % matches n=127 exactly (sqrt(0.62205 x 0.37795 / 126) = 4.319 %), row 7
1.616 % matches n=889, row 14 1.139 % matches n=1778. The report's own cross-check
(REPORT.md:146-147) reproduces. The same construction on the 750 gives the same check:
94.826 +/- 0.525 % implies n=1778 (variant-stock-mul.log), confirming "same construction".

**Are the +/- figures sound for 1778 positions?** As descriptive SEs, yes, with two caveats.
The same-top SE is a plain binomial SE that ignores within-chunk correlation, so it is
optimistic; at a 31-point margin this is irrelevant. The KLD and PPL-delta SEs are SEMs of an
extremely heavy-tailed distribution (max KLD 17.95 vs median 0.395, gpu-arm.log:36,41), so
"mean +/- SEM" understates the spread; the gate correctly uses the median, for which the tool
quotes no CI, but at n=1778 the median's sampling noise is negligible against a 79x threshold
margin.

**Two anomalies, noted for completeness, neither verdict-changing.** (a) Deriving chunk 14
alone from the cumulative rows (row 14 minus row 13, equal 127 counts) gives KLD ~1.38 and
same-top ~59.1 %, about twice the pooled level; the 750 run shows no such tail-chunk
excursion (derived 0.00615 vs pooled 0.0067). Content-dependent, or a weak hint of something
at the corpus tail; all chunks fail the gate individually anyway (lowest pooled same-top
62.2 %). (b) The reported `cpu.kld` size 455,196,580 B (REPORT.md:133) does not exactly
reconcile with the writer's format: 8-byte magic `_logits_` + n_ctx + n_vocab header plus 14
x 127 x 128,000 x 2 B = 455,168,016 B expected (perplexity.cpp:461-467 save path; n_vocab
128,000 from the same gguf's archived metadata, s23-native-gpu-bench/raw/q1_bench_fa.out:219)
- a +28,564 B excess, unexplained. The file is deleted; size unverifiable. Functionally the
file was read without error by the GPU arm (perplexity.cpp:1868-1872 fails hard on short
reads) and its PPL(base) matches the CPU arm (below).

**PPL(base) 27.203079 vs CPU arm 27.2114, explained.** The save mode writes log-probs
quantized to uint16 (`log_probs_uint16`, perplexity.cpp:1758; written by `process_logits` to
the stream at :618-628); the GPU arm recomputes PPL(base) from that quantized file over the
same 1778 positions. The 0.03 % shift and the near-identical SEMs (2.086201 vs 2.08767) fit
quantization noise. Independent corroboration that the reference file stores quantized
log-probs: the 750 log's minimum KLD is negative (-0.000009, variant-stock-mul.log), which is
only possible against quantized values.

**Arithmetic of the verdict lines:** 0.394993/0.005 = 79.0x, /0.004736 = 83.4x, 95-63.892 =
31.1 pp, 94.826-63.892 = 30.9 pp - all as stated (REPORT.md:151-153).

## Item 2 - PROTOCOL COMPARABILITY: PARTIAL (flags, corpus, chunks, seed all match; "verbatim commands" and "same instrument" are not accurate)

**Matched, verified:**
- Flags: `-c 256 -b 256 -s 42 --temp 0 -fa off` with `-ngl 0` / `-ngl 99` on CPU/GPU arms,
  identical in both raw command lines (cpu-arm.log:2, gpu-arm.log:2) and identical in
  pattern to the 750's commands (adb-exit.log, sa812265b).
- Corpus: `adreno-precision-bisect/corpus.txt`, md5 recomputed on the Mac copy =
  `1d037601b756c2cdc94292273b8bce34`, 3079 words, 18233 bytes - exactly as claimed
  (REPORT.md:78). The 750 pushed the same file (adb-exit.log push line). The claimed
  on-device md5 is an author assertion (no device md5sum transcript in raw/).
- Chunk count: 14 in both 740 arms and in both 750 logs, same n_ctx/batch/n_seq, and the
  127-per-chunk scoring set is identical by construction.
- KLD mode against a CPU reference logits file: save flag without `--kl-divergence` on CPU
  arm, both flags on GPU arm (command lines; perplexity.cpp:1699, arg.cpp:2502,2509 - the
  cited source lines check out).
- The quoted 750 numbers all match the archived logs verbatim: 0.004736 / 94.826 +/- 0.525 /
  +0.349474 +/- 0.084951 / 0.006651 +/- 0.000186 (variant-stock-mul.log), CPU arm 22.9415 in
  35 s (cpu-kld.log, elapsed_seconds=35).

**Not verbatim, and not declared:**
1. The report's "Exact commands (from `adb-exit.log`)" (REPORT.md:34) omits the env prefix
   the archive records on the 750 GPU arm: `export KALSA_GEMM_MATH='stock'
   KALSA_GEMM_PREC='mul'` (adb-exit.log, variant-stock-mul.log command line). In the probe
   kit those knobs selected the fixed (mul) kernel variant; they are load-bearing there
   (the kit's default/control, stock:half, reproduced the broken 0.4538). The 740 engine
   contains no such knobs at all (zero hits for KALSA_GEMM in the `1068eb03d` tree).
2. "Same instrument" (REPORT.md:31) is false at the binary level: the 750 numbers came from
   `kit-gemm-acc-probe` built from `kalsallama-wt-accprobe` @`7ef9389bc` (two files changed
   from pinned `2f3b24dee`, per PREREG.md/REPORT.md of that cell); the 740 numbers came from
   the production engine at `1068eb03d`, built fresh. Protocol-identical, not
   binary-identical.
3. The 750 device was a QRD8650 dev board on Qualcomm Device Cloud (board-properties.txt:
   `pineapple`), not a phone; the report says only "QRD serial 80003b9c". Cross-device-class
   comparison, on top of the declared quant difference (Q4_0-QAD vs Q4_K_M).
4. Cosmetic: the 740 CPU log lacks the tokenizer lines the 750 log shows (engine-version log
   differences); both arms' `-fa off` KV-padding warning matches the 750 logs.

No flag, corpus or chunk-count difference exists. The comparison's value survives, but it is
a protocol clone, not a binary clone, and the report should say so.

## Item 3 - DID EACH ARM RUN WHERE IT CLAIMS: CONFIRMED by strong indirect evidence; direct in-log evidence correctly described as absent

**CPU arm on CPU.** `-ngl 0` (no offload, by construction), CPU-only system_info line
(cpu-arm.log:5), and ~70 s/pass implied by the internal clock (start 0.02 to final estimate
at 16:31.8, cpu-arm.log:9).

**GPU arm on GPU.** Four independent lines of evidence:
1. Timing: "kl_divergence: 4.70 seconds per pass" (gpu-arm.log:8) vs ~70 s/pass on the same
   work in the CPU arm - 15x. A full CPU fallback would reproduce the CPU arm's timing.
2. Outcome: a full CPU fallback would recompute the reference bit-for-bit (same binary, same
   flags, same n_threads=8, deterministic CPU kernels) and yield KLD at the instrument floor
   (the 750's accepted run floors at ~1e-5, with negative minima from file quantization) and
   same-top ~100 %. Observed: KLD 0.395, same-top 63.9 % - and the divergence can only be
   produced by GPU-executed arithmetic, since any op computed identically to the CPU would
   agree with the reference. A 2.6B dense model is overwhelmingly GEMM, so the divergent
   arithmetic is in the Q4_K GEMMs.
3. Reference integrity: PPL(base) 27.203079 vs the CPU arm's own 27.2114 (0.03 %, explained
   above); a wrong reference (other model/corpus/seed) would collapse same-top to ~1/128,000
   = 0.001 %, not 63.9 %.
4. The engine build is OpenCL-enabled and works on this device: raw/opencl-banner.log shows
   `QUALCOMM Adreno(TM) 740`, driver `E031.41.03.62` (:4,:8), captured by test-backend-ops
   from the same build (its first line is test-backend-ops output, :1) in the same session
   directory (kernel cache path :7). libomp demonstrably loaded in both measured arms
   (OPENMP = 1 in system_info, cpu-arm.log:5, gpu-arm.log:6).

**The honest gaps, which the report states correctly.** `llama-perplexity` filters the ggml
backend INFO logs - an archived finding (adreno-acc-type/REPORT.md, "nei suoi log non
compare nemmeno `ggml_opencl: selected platform`"), visible in this run as the empty `I `
line at gpu-arm.log:5 where the banner would sit (the 750's GPU log shows the identical
artifact). So the GPU arm's own log contains no OpenCL line, and the banner file is
test-backend-ops, a different process. `llama-bench` was (correctly) not used here at all,
so its useless backend column is moot. What cannot be excluded from the logs is PARTIAL
fallback of individual ops - notably timely, because the audited commit's own subject is "no
exit(1) on the OpenCL compile path" (a compile-failure path that continues rather than
aborting). Mass fallback is excluded by items 1-2; a fallback of, say, one attention op
would only shrink the divergence, not fake it.

## Item 4 - THE REGIME CLAIM: PARTIAL (numbers confirmed; pointer imprecise; causal framing overstated)

**The archived numbers check out.** Pre-fix 750: `stock:half` = 0.453822 / 62.823 +/- 1.146 %
/ PPL delta 8.400806 - in adreno-acc-type/REPORT.md (control row of the eight-measure table)
and its raw (variant-stock-half.log, variants.tsv). Post-fix accepted: 0.004736 / 94.826 %
(variant-stock-mul.log). Both verbatim as the 740 report quotes them. Pointer inaccuracy:
the report cites `gemm-f32-ship/PLAN.md` for the pre-fix figures (REPORT.md:159-160); that
file carries only the rounded "0.4538 -> 0.004736" (PLAN.md:13,124,160). The exact digits
live in the acc-type cell.

**Is "the 740's numbers sit in the 750's PRE-FIX regime" fair?** As a statement of error
MAGNITUDE, yes: 0.395/63.9 % sits next to 0.454/62.8 %, and both are ~80x the accepted
post-fix KLD; the same-top figures nearly coincide. As a CAUSAL statement ("on this phone,
with this quant, the engine behaves like the unfixed path", REPORT.md:160-161), it
overreaches, for three stacked reasons:
1. At the audited commit the Q4_K GEMM kernel's f32-product fix is in the tree
   (`67c73d26c` "opencl: compute the Adreno q4_K GEMM product in f32", verified ancestor of
   `1068eb03d`), deliberately shipped per gemm-f32-ship/PLAN.md:167.
2. Source dispatch analysis (item 5) says that fixed kernel is the ONLY reachable Q4_K x F32
   batch GEMM on this device. "Unfixed path" is therefore not merely unproven; it is
   contradicted by the tree, unless the runtime deviated from the source (compile-failure
   fallback being the one silent mechanism).
3. The comparison is cross-quant, cross-device-class and cross-binary (item 2). Similar
   magnitude does not establish similar cause. An alternative candidate for the 740's residual
   error is documented in the archive itself: the activations are narrowed to f16 by
   `kernel_transpose_32_16` into a CL_HALF_FLOAT image - a host-side operand axis shared by
   all ten quant GEMM paths including q4_K, which the acc-type cell explicitly could not test
   and named as the remaining axis (adreno-acc-type/REPORT.md, transpose/operand paragraphs).

Notably, the report itself flags the engagement question as NOT VERIFIED (REPORT.md:160-163)
- honest - but then immediately re-uses the "unfixed path" framing it just disclaimed. Pick
one: either the provenance is unknown, or the regime claim is causal. Both cannot be held.

## Item 5 - THE OPEN QUESTION (kernel engagement): the raw cannot settle it, but the source narrows it decisively - "fix does not engage" is the UNLIKELY reading

**What the raw material contains:** no kernel-selection evidence whatsoever. gpu-arm.log has
no OpenCL line (filtered); opencl-banner.log shows this build's defaults on this device
(Adreno kernels ON, SoA quant flattening ON, `khr dot product support: true`,
opencl-banner.log:24-25,12) but is test-backend-ops, not the measured process; the cl-cache
directory that would have listed compiled kernels was deleted (REPORT.md:181) without being
listed. Correctly, the report claims no more than NOT VERIFIED.

**What the source at `1068eb03d` settles - the possibility space for dense Q4_K x F32
mul_mat at batch 256 on this device (no env beyond LD_LIBRARY_PATH/TMPDIR was set):**
- Device generation: both 740 and 750 classify as A7X (ggml-opencl.cpp:300-302).
- dp4a int8 dense GEMM: default requires `adreno_gen == X2E` (:22691-22699) - OFF on A7X;
  the enabling env `GGML_OPENCL_Q4K_DENSE_DP4A` was not set.
- Binary "a8" GEMM kernels (`gemm_noshuffle_q4_k_f32_32b_trans_ila_a8_bin`): compiled only
  under `adreno_gen == X2E` (:4599-4641), hence null on the 740, hence `use_q4_k_bin_kernels`
  false (:9478-9490) - OFF.
- Flat-GEMV divert (`use_flat_gemv_for_large_m_q4_K`): only for weights with row count
  % 64 != 0 (:9404-9420) - not applicable to this model's dimensions (n_vocab 128,000;
  archived metadata), and irrelevant at batch 256.
- The model is dense: `n_expert = 0`, arch `lfm2`, file_type 15 = Q4_K_M
  (s23-native-gpu-bench/raw/q1_bench_fa.out:202,7,39) - the MoE kernel family is not in play.
- What remains, at ne1 = 256 > 8 (so the cok/r1/kimg small-batch variants, all gated to
  ne1 <= 8, are out; and all four compile from the same program anyway, ggml-opencl.cpp:4428-
  4430): the default transposed-weight GEMM launching `kernel_gemm_noshuffle_q4_k_f32`
  (:22776-22806), whose source at this commit contains the fix: `float8 c0` accumulators and
  `c0 += convert_float8(B) * (float)dequantized_weights.s0`
  (kernels/gemm_noshuffle_q4_k_f32.cl:61,102-105).

**Conclusion on the open question.** IF the Q4_K GEMMs ran on GPU (item 3 says they did),
they ran, as far as the source can determine, through the kernel that CARRIES the f32-product
fix. "The fix does not engage for this quant" is therefore the unlikely reading; it would
require the runtime dispatch to deviate from the source - the one candidate mechanism being a
silent compile-failure fallback on the very commit that removed `exit(1)` from that path.
The source-consistent reading is the other branch of the report's dichotomy: the fix
engaged and did not rescue 740 + Q4_K_M - which also means the q4_K kernel's fidelity, never
KLD-measured on any device before this run (gemm-f32-ship/PLAN.md:161 "no";
gpu-divergence-verdict/REPORT.md:198-201 "whose fidelity has never been measured on any
device"), measures poorly HERE, without implying it would measure poorly on the 750, or that
the 750's q4_0 result transfers.

**What artefact would settle it outright** (any one of these):
1. The cl-cache listing (or preserving the directory) - compiled kernel files name the
   kernels actually built for the process.
2. The OpenCL banner from the MEASURED process - un-filter the log at WARN level, or use a
   `-v`-style probe adjacent to the run; the acc-type cell already prescribed exactly this
   after its own provenance VOID.
3. A one-line kernel-selection log at launch (kernel name + tensor type + shape).
4. A bracketing rerun: `GGML_OPENCL_Q4K_DENSE_DP4A=1` vs default, plus
   `GGML_OPENCL_Q4K_GEMM_COK=0` - outputs differing prove dispatch sensitivity and identify
   the executed variant by its arithmetic fingerprint.

## Item 6 - HONESTY ITEMS: PARTIAL (everything device-side is an author assertion; nothing in raw contradicts; host-side claims verified)

**Verifiable from the archived raw:**
- Both arms rc=0, sequential, cpu END 01:31:42Z and gpu END 01:35:39Z (cpu-arm.log:10,
  gpu-arm.log:66), consistent with the claimed session flow.
- The deployed-binary claim: sha256 of the still-present build artifact
  `build-android-ocl-1068/bin/llama-perplexity` = `7276aafd...ab7479`, 119,689,504 bytes,
  mtime Sep 21 21:12 - matches REPORT.md:62-63 and the session window.
- Worktree clean at `1068eb03d` (git status empty); commit subject and message match the
  quote in REPORT.md:60-61; author date 15:33:35 -0400 (report says 15:33:53 - 18 s off,
  trivial).
- Help transcript: `raw/help.txt` is byte-identical to `/tmp/s23_kld_help.txt` (diff clean);
  the flags the report quotes exist (help.txt:39,45,86-93). Note the report's own pointer
  says the transcript lives at /tmp only (REPORT.md:192-193) - it is in raw/ as well.
- Lab repo: `scratchpad/agents/s23-kld-740-q4km/` is untracked and the last commit (771adb2f,
  handover) predates the report - "no commit, no push" (REPORT.md:190) is consistent.
- The banner file matches the claimed device and driver exactly (opencl-banner.log:2,4,8).

**Report-author assertions with NO archived artefact (mark as such whenever quoting):**
- All five `dumpsys battery` reads (AC/USB/Wireless false, status 3, 79 -> 75 %,
  REPORT.md:11,69,126-127,189). raw/ contains no battery transcript of any kind.
- The pre/post `/data/local/tmp` listings "matching" and the full removal of
  `/data/local/tmp/s23-kld-740/` (REPORT.md:180-185). No listing transcript archived; even
  opencl-banner.log carries no timestamp or command header, so its session placement rests
  on the report's word (its kernel-cache path naming the session dir is the one internal
  corroboration).
- "No app opened, no settings changed, no installs, Jelly Star never contacted"
  (REPORT.md:13,186-189). Unverifiable, and the audit is asked to be strict here: a previous
  session overwrote this phone's `screen_off_timeout` without reading it first. After an
  incident of that kind, a settings-discipline claim needs archived evidence (a settings
  read before, a read after, or at minimum the battery/listing transcripts); it has none.
  The claim may be true; it is not demonstrated.

---

## Verdict summary

| Item | Verdict |
|---|---|
| 1. Numbers | CONFIRMED as faithful transcription; internally consistent with source-verified aggregation (pooled, 127x14, cumulative rows); recomputation impossible (per-position data deleted); +/- sound as binomial/SEM with stated caveats |
| 2. Protocol comparability | PARTIAL - flags/corpus/chunks/seed identical and 750 numbers verbatim-verified; "verbatim commands" omits the 750's KALSA_GEMM env selection; "same instrument" false at binary level; 750 was a cloud QRD board; quant differs (declared) |
| 3. Arms | CONFIRMED by strong indirect evidence (timing 15x, KLD floor, reference PPL agreement); direct in-log evidence absent (banner filtered - correctly disclosed); partial single-op fallback not excludable |
| 4. Regime claim | PARTIAL - magnitudes verified (pointer imprecise: exact pre-fix digits live in adreno-acc-type, not gemm-f32-ship/PLAN.md); "pre-fix regime" fair as magnitude, overreach as cause; source contradicts "unfixed path" |
| 5. Kernel engagement | PARTIAL - raw cannot settle it (report honest); source says the only reachable Q4_K GEMM on A7X carries the f32-product fix, so "fix does not engage" is unlikely and "engages and does not rescue" is the source-consistent reading; settling artefacts listed |
| 6. Honesty items | PARTIAL - hygiene claims (battery x5, cleanup, listings, settings, apps) are author assertions with zero archived raw; host claims (commit, binary sha, clean worktree, untracked report, help transcript) verified |

## Bottom line for the production question

The gate evaluation is arithmetically correct and the measurement is trustworthy as a
one-device, one-run, native-instrument result: on this Galaxy S23, at engine `1068eb03d`,
Q4_K_M prefill on the Adreno 740 fails the pre-registered conjunctive gate by ~79x on median
KLD and 31 points on same-top, with n=1778 and both failure modes (CPU fallback, broken
reference) affirmatively excluded by the logs' internal evidence. That is legitimate evidence
for keeping the V73 GPU-prefill lane off under the lab's gate discipline. It is NOT evidence
that the f32-product fix fails to engage on Q4_K_M (the source points the other way), NOT
evidence about other S23/740 units or thermal states (n=1 device, n=1 run, no thermal
telemetry archived), and its "pre-fix regime" sentence should not be quoted as causal. Before
this cell's conclusion is hardened into "the fix cannot help Q4_K_M", run one of the four
settling artefacts in item 5; the difference between "does not engage" and "engages and does
not help" decides whether the next lever is kernel provenance (a provenance bug) or the
shared f16 activation-operand axis the acc-type cell already nominated.
