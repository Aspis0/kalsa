# REPORT - night-gpu-numerics-audit: independent audit of the q6_K routing evidence

Auditor: second pair of eyes. Scope: the four claims of the night's GPU-numerics conclusion,
checked against archived raw material only. No file outside this report was modified. No push.
Method: every number below was re-read from the archived files with `rg --no-ignore` / direct
reads; dispatch predicates were re-derived from the object-store blob
(`git show 1068eb03d:ggml/src/ggml-opencl/ggml-opencl.cpp`, extracted to /tmp, 31562 lines);
the tensor census was re-counted from the GGUF itself with a fresh parser (the model file at
`/Users/marco/kalsa-models/LFM2.5-2.6B-Q4_K_M.gguf`); the four worktree binaries were re-hashed
on the host tonight.

Primary source: `scratchpad/agents/s23-kld-740-q4-0/` (REPORT.md sections 8-12, `raw/`),
with `opencl-q6k-accurate-path/REPORT.md`, `opencl-f32-transpose/REPORT.md`,
`opencl-full-precision/REPORT.md` as build-side testimony, and
`s23-kld-740-q4km/raw/gpu-arm.log` (the original stock run, 2026-09-22T01:31:57Z) as the
stock reference log.

---

## 1. Verdicts on the four claims

### Claim 1 (stock numbers and the dispatch path) - CONFIRMED, with one census correction

- Stock numbers: `s23-kld-740-q4km/raw/gpu-arm.log:41` `Median  KLD:   0.394993`,
  `:64` `Same top p: 63.892 +/- 1.139 %`, command at `:2` (`-c 256 -b 256 -ngl 99 -fa off -s 42
  --temp 0 --kl-divergence --kl-divergence-base cpu.kld`). Confirmed.
- Dispatch: at `1068eb03d`, `ggml-opencl.cpp:23090` is
  `if (q6k_dense_dp4a_on && !is_output_w_dp4a && ne1 > 8 && (ne00 % 32 == 0) && (ne01 % 64 == 0))`;
  the branch dispatches `kernel_gemm_noshuffle_q6_k_q8_1_dp4a` at `:23108` and RETURNS at
  `:23126` (`return;`, closing brace `:23127`). The transpose block is at `:23168`
  (`kernel = backend_ctx->kernel_transpose_32_16;`) and the f32 GEMM selection at
  `:23191-23192`. All five conditions hold on A7X at ne1 = 256 for the GPU-routed Q6_K
  tensors:
  - `q6k_dense_dp4a_on`: env unset gives `adreno_gen != X1E` (:23080-23083); A7X comes from
    `strstr(device_name, "740")` at `:300-302`; `has_integer_dot` from
    `cl_khr_integer_dot_product` at `:7005-7006`, and BOTH of tonight's archived verdict
    blobs (quoted inside `verdict-file-content.txt` / `verdict-files-both-runs.txt`) record
    `has_integer_dot=1` and driver E031.41.03.62. Confirmed.
  - `ne1 > 8`: 256 > 8. `ne00 % 32 == 0`: forced structurally by
    `GGML_ASSERT(ne00 % ggml_blck_size(src0->type) == 0)` at `:22903` (Q6_K block = 256).
    `ne01 % 64 == 0`: I re-counted from the GGUF - the 18 GPU-routed Q6_K tensors are
    14 ffn_down (ne00 = 10752, ne01 = 2048) and 4 attn_v (ne00 = 2048, ne01 = 512); all
    satisfy ne00 % 32 = 0 and ne01 % 64 = 0. `!is_output_w_dp4a`: none of the 18 is named
    output/token_embd. Confirmed.
- Q4_K dp4a is X2E-only: `:22684-22688` defaults `q4k_dense_dp4a_on` to
  `adreno_gen == X2E`, ANDed with `has_integer_dot` at `:22691` - off on A7X, so the 148
  Q4_K tensors take transpose + noshuffle GEMM. Confirmed.
- Census correction (does not change the conclusion): the model has exactly 266 tensors =
  99 F32 + 148 Q4_K + 19 Q6_K (my parser's type histogram). Of the 19 Q6_K tensors, 18 are
  GPU-routed (14 ffn_down + 4 attn_v); the 19th is `token_embd.weight` (ne01 = 128000),
  which declines to CPU on A7X for vocab-scale K-quants (ggml-opencl.cpp:9741-9747,
  `ne[1] >= 32768`, env `GGML_OPENCL_A7X_LMHEAD_CPU` default on). The standing phrasing
  "the 19 Q6_K tensors are computed by the dp4a kernel" and the 914b34a7e commit message's
  "14 ffn_down + 5 attn_v" are both off by one on the attn_v count and include a tensor
  that never reaches this dispatch. Immaterial to the routing conclusion, but any landing
  narrative should say 18.
- "A fix to that kernel could not change the result - and indeed it did not, bitwise":
  verified (section 2 below, cell A).
- Two citation slips found in `opencl-q6k-accurate-path/REPORT.md`: the assert is at
  `:22903`, not `:22907` as cited; and the "per-tensor catalogue walk" it attributes to
  `opencl-f32-transpose/REPORT.md section 3` does not exist there (section 3 is a transpose
  call-site list, no per-tensor ne01 values are archived anywhere). I did the census myself
  (above), so the underlying claim survives, but the citation is wrong.

### Claim 2 (the 2x2 factorial) - CONFIRMED for the numbers, QUALIFIED on the framing

All four cells exist in the archived logs at the exact claimed precision
(`s23-kld-740-q4-0/raw/`, grep `Median  KLD` / `Same top p`):

| cell | file | Median KLD | Same top | Mean PPL(base) | chunks |
|---|---|---|---|---|---|
| half + dp4a (stock-equivalent) | `gpu-q6k.log` | 0.394993 | 63.892 +/- 1.139 | 27.203079 | 14 |
| float + dp4a (candidate 2) | `gpu-f32t.log` | 0.395990 | 63.780 +/- 1.140 | 27.203079 | 14 |
| half + f32 (candidate 3) | `gpu-c3.log` | 0.006977 | 93.026 +/- 0.604 | 27.203079 | 14 |
| float + f32 (combo default) | `gpu-full.log` | 0.006954 | 92.913 +/- 0.609 | 27.203079 | 14 |

PPL deltas match the report (-0.727638 / -0.702314 / -2.767506 / -2.739322), Mean KLD:
0.661847 / 0.657936 / 0.022402 / 0.022027. All confirmed.

QUALIFICATION 1 - the "single binary produced the 2x2" framing is stronger than what
happened. The combo binary a8eb58010 produced THREE cells: `gpu-full` (both selectors
default), `gpu-half` (`KALSA_GEMM_B=half`), `gpu-dp4a` (`KALSA_Q6K_DENSE=dp4a`)
(`fx-status.txt`: START full/half/dp4a/c3, no fourth combo arm). The half+dp4a cell is
inherited from two other binaries: the original stock run (1068eb03d) and the bitwise-
identical 914b34a7e run (`gpu-q6k.log`). Combination 4 (`KALSA_GEMM_B=half
KALSA_Q6K_DENSE=dp4a` - which the full-precision report itself calls "the matched stock
control", section 3 arm 4) was never run. The use of the inherited cell as baseline is
defensible (two binaries already agree on it bitwise), but the merged binary has never been
shown to reproduce stock, so a merge error in a8eb58010 would be invisible to this design.
This weakens only the interaction claim marginally, not the leg conclusions.

QUALIFICATION 2 - the exact commands and env values of the four arms are NOT archived:
`factorial-run.sh` (1565 bytes, visible in `pre-cleanup-listing.txt`) was deleted in
cleanup and never mirrored to the lab. The env settings are pinned indirectly (cache trace
for the half arm, outcomes for the rest - see claim 4), but the invocation itself is
author-asserted.

### Claim 3 (bitwise replication, independent binaries) - CONFIRMED

- `diff gpu-c3.log gpu-half.log`: the ONLY differing line is line 1 (wrapper wall time,
  1.38 vs 1.08 minutes). All 14 chunk rows and every statistic digit-for-digit identical.
  `diff gpu-f32t.log gpu-dp4a.log`: same result (1.05 vs 1.10 minutes). So "bitwise
  identical" is true of every measured quantity in the logs.
- Independent builds: four different build directories (push records `q6k-push.txt`,
  `f32t-push.txt`, `q6kp-push.txt`, `full-push.txt`), four different commit stamps
  (11195/914b34a7e, 11196/40a9358a1, 11196/14a3afebf, 11197/a8eb58010 - version lines in
  `*-version-line.txt`), four different sha256s. I re-hashed the four host binaries tonight;
  all four match the values pushed to the phone: 970ee8c3..., 5a92eab2..., eded46b0...,
  d5d070bb....
- One precision on "different kernel-set ids": true for the half+f32 pair - candidate 3 ran
  the 914b34a7e kernel set (197 HIT incl. q6_K f32 GEMM key `46b3efcb34bfebf5`, src=11169B),
  while combo-half MISS-rebuilt the two GEMM programs without the float define (keys
  `3191cd8a548f001d` src=20124B and `9b73c76ba9857e9d` src=11450B, `gpu-half.err` MISS
  lines). Those are different compiled programs producing identical output - the strongest
  replication of the night. It is NOT true for the float+dp4a pair: combo-dp4a warm-hit the
  same cache entries candidate 2 had compiled (keys `fdce465c...`, `2c77817b...` visible in
  `gpu-dp4a.err`), so that pair shares compiled kernels and differs only in host binary.
  The report's "Both replications hold across different binaries and kernel-set ids"
  overstates the second pair.

### Claim 4 (provenance: printf filtered, routing behavioural) - CONFIRMED

`grep -c "dense q6_K prefill GEMM path"` across all six `.err` files AND
`provenance-gpu.err`: 0 occurrences. The `activation operand` printf: also 0. The INFO
filter also removes the `version:` banner (absent from every `.err`), consistent with the
mechanism. The routing evidence is therefore: (i) source walk (verified, claim 1),
(ii) compile-time cache evidence for the OPERAND leg only, (iii) the numbers. The author's
characterisation is honest and, if anything, understated in one direction: the arm identity
chain (`*-version-line.txt` captured at push time, hashes host = device) is better than
"behavioural only" suggests for WHICH binary ran, even though it is behavioural for WHAT
executed.

---

## 2. The load-bearing checks

### (a) Numbers, sample size, and the bitwise stock claim - CONFIRMED (print-level)

- All four cells' median KLD / same-top exist at the claimed precision (table above).
  Per-chunk rows: 14 rows present in each of the six logs; I diffed the replication pairs
  in full (only the wall-time line differs).
- n = 1778: the logs print no n. I recomputed it from the binomial standard error of
  same-top (se = sqrt(p(1-p)/(n-1))): implied n-1 = 1778.3 / 1777.6 / 1778.3 / 1775.4
  across the four cells (rounding of the printed 3-decimal se explains the spread) -
  consistent with n = 1778 = 14 x 127, not with any other plausible n.
- The bitwise stock claim: `diff` of the statistics blocks (from the `chunk PPL` header to
  EOF) of `s23-kld-740-q4km/raw/gpu-arm.log` (original stock, 1068eb03d) vs tonight's
  `gpu-q6k.log` (914b34a7e): identical except the `=== END ===` trailer. That is ~100
  printed quantities at full printed precision (6-decimal KLD percentiles, 6-significant-
  figure PPL, chunk rows). Strictly this is print-level identity, not a proven bitwise
  identity - the GPU logits were never dumped, so no byte-level comparison of outputs is
  possible. At 6 decimals on quantities of order 0.001-17.95, print-level identity across
  all percentiles is very strong evidence, and the claim as worded in the report
  ("identical to the stock run's logged values at the full printed precision") is accurate.
  The shorter phrase "bitwise" in the summary claims is acceptable shorthand, but the
  auditable fact is: identical at every printed digit.

### (b) Same reference, same settings - CONFIRMED, two gaps noted

- Reference: `raw/cpu-reference-q4km.kld` hashes (I ran shasum -a 256 on the archive) to
  `82e2ab4d7733c08de87f0ed4a6cddfa3ba34e79f7702c74731e3f5474837340f` - identical to the
  value in the report AND to the device-side hash in `cpu-q4km-sha-device.txt` (same size,
  455196580 bytes). The regenerated CPU arm (`cpu-q4km.log`) shows 14 chunks and final PPL
  27.2114, matching the deleted original's recorded 27.2114.
- Same reference across cells: Mean PPL(base) = 27.203079 in all six GPU logs - this
  quantity is computed from the reference file, so its 6-decimal identity across every cell
  pins a common reference behaviourally, on top of the command assertions.
- Chunks/flags: `computing over 14 chunks, n_ctx=256, batch_size=256, n_seq=1` in all six
  logs; the `FA is not enabled` V-cache warning in all six (`-fa off`); corpus md5
  `1d037601b756c2cdc94292273b8bce34` verified on device at push (`verify-model-device.txt`),
  one corpus.txt shared by all arms in the run dir. Seed is irrelevant to perplexity/KLD
  (no sampling), so a seed mismatch cannot invalidate anything here.
- Gap 1: `-ngl 99` and the full argv per arm are author-asserted; no arm log echoes the
  command (the original stock run's wrapper did - `gpu-arm.log:2` - tonight's wrappers did
  not). A different -ngl would change layer assignment and therefore the numbers; the
  bitwise identity of the stock-equivalent run with the original `-ngl 99` command pins
  that one, and the replication pairs pin the combo arms to each other, but the combo
  arms' -ngl is ultimately testimony.
- Gap 2: the Q4_K_M model file was never hashed on the device (pre-existing file, reused;
  unlike the Q4_0 model, which has a full hash chain). The Mac copy hashes to
  `79fdf003...bfee14` but nothing ties the phone file to it except behaviour (identical
  chunk rows with the earlier session, identical PPL(base)). Strong, but not a hash chain.

### (c) Dispatch predicates from the object store - CONFIRMED

See claim 1. Every load-bearing line re-read from the `1068eb03d` blob: `:23090`
(five-way condition), `:23080-23085` (env default + generation + integer dot),
`:23086-23088` (is_output_w_dp4a), `:23108` (dp4a dispatch), `:23126` (return),
`:23168` (transpose), `:23191-23192` (f32 GEMM), `:22684-22691` (q4_K dp4a X2E-only),
`:22903` (block-size assert), `:22928` (GEMV/mc3 escape), `:23028` (tiled escape),
`:9300-9314` (tiled default X2E/A8X only), `:24229` (outer route),
`:9741-9747` (vocab-scale CPU decline). The ggml-opencl.cpp file is byte-identical between
1068eb03d and 914b34a7e (`git diff --stat` empty), so the line numbers apply to both.

### (d) Replication - CONFIRMED (see claim 3)

The strongest point deserves restating: in the half+f32 cell, two different HOST binaries
ran two different COMPILED q6_K f32 GEMM programs (different source text 11169B vs 11450B,
different cache keys) and produced identical output to the last printed digit. A compile
failure, a wrong-kernel dispatch, or a build mix-up cannot survive that.

### (e) No-interaction arithmetic - CONFIRMED; one caveat on the quoted range

- q6_K leg (dp4a -> f32): 0.394993/0.006977 = 56.61x at half operand; 0.395990/0.006954 =
  56.94x at float operand. The report's "56-57x" is correct.
- Operand leg (half -> float): +0.000997 KLD (+0.25%) at dp4a; -0.000023 KLD (-0.33%) at
  f32. Same-top: +/-. 63.892 -> 63.780 (-0.112 pp, well inside the +/- 1.14) and
  93.026 -> 92.913 (-0.113 pp, well inside the +/- 0.60). "Moves nothing measurable" is
  fair.
- Full cell vs the single-leg prediction: multiplicative no-interaction predicts
  0.006977 x (0.395990/0.394993) = 0.006995; observed 0.006954 (-0.6%). Same-top:
  93.026 - 0.112 predicted vs 92.913 observed. Consistent with no interaction.
- CAVEAT on "within the reported +/- ranges": for same-top the printed +/- (0.604/0.609)
  is the right yardstick and the deltas pass easily. For MEDIAN KLD the logs print no +/- at
  all, so "within noise" is a judgement, not a measurement. The nearest archived yardstick
  is the chunk-to-chunk scatter of the MEAN KLD (0.022402 +/- 0.001434 vs 0.022027 +/-
  0.001410; delta 0.000375, well inside), which supports the same conclusion. A formal
  interval on the median (bootstrap over the 1778 positions from archived .kld data) was
  never computed. The conclusion survives; the wording oversells slightly.

### (f) Falsification path - the author's account is honest; here is what it leaves open

What is observed vs behavioural, precisely:
- OBSERVED (compile-time, in cache traces): the half arm compiled its two GEMM programs
  WITHOUT `-DKALSA_GEMM_B_FLOAT` (exactly 2 MISS, keys `3191cd8a`/`9b73c76b`, zero
  DKALSA lines in `gpu-half.err`); the float arms hit the FLOAT-define keys (`fdce465c`
  for q4_K with the truncated `-DKALSA_GEMM_B_FLO...`, `2c77817b` for q6_K with the full
  `-DKALSA_GEMM_B_FLOAT=1`). So the operand selector's state is compile-time evidence.
- NOT OBSERVED anywhere: which kernels EXECUTED. The q6_K routing selector
  (`KALSA_Q6K_DENSE`) changes no kernel source, leaves no compile trace, and its printf is
  INFO-filtered (verified: 0 hits in all .err files). For that leg the entire story rests
  on the source walk + the numbers.
- Eager compilation is itself documented in the archive (the Q4_0 cell proved 196 programs
  compile regardless of model), so "compiled" never implies "executed" - the author knows
  this and says it.

Alternatives that would produce the same four numbers, and why they fail:
1. Partial CPU fallback of the 18 q6_K nodes in the f32-default arms (a silent decline that
   ALSO skips the in-function f32 GEMM). This is the serious one: it would collapse KLD
   similarly, and the author did not address it by name. It fails for a structural reason:
   the commits (both diffs are reproduced in full in the two candidate reports) touch
   nothing in op assignment or supports_op; once the dp4a branch declines, control in
   `ggml_cl_mul_mat_q6_K_f32_adreno` flows unconditionally into transpose + f32 GEMM - there
   is no code path from these edits that can hand the node back to CPU. To believe the
   fallback story you must additionally believe the shipped binaries differ from their
   sources, for which there is no evidence (build logs rc=0, hashes match host binaries I
   re-hashed tonight). Note, however, that the run wall-times do NOT discriminate the two
   stories (c3 1.38 min vs half 1.08 min is within the night's startup/thermal variance),
   so timing cannot be cited as the refutation; the refutation is structural.
2. Env leakage or arm mislabelling (e.g. the dp4a arm actually ran f32). Constrained by the
   outcome pattern: four distinct results in two bitwise pairs, each pair landing exactly
   where the dispatch model predicts, and the half arm independently pinned by its cache
   MISS pattern. A labelling error would have to swap whole cells consistently across two
   binaries - possible in principle, but it would still leave the 2x2 structure and the
   56-57x effect intact under the swap, i.e. the conclusion is invariant to it.
3. Merge error in the combo binary making one leg behave differently than in its sibling
   binary. Excluded for the two legs actually doubled (bitwise pairs across binaries); NOT
   excluded for the never-run combination 4 (both selectors stock) - see claim 2,
   qualification 1. This is the one live hole, and it only touches the interaction
   arithmetic, not the leg effects.
4. A wrong-reference artifact (e.g. cells scored against different references). Refuted by
   the identical PPL(base) 27.203079 in all six logs plus the archived reference hash.

On the whole: given the printf hole, the behavioural case is unusually strong - two
independent binaries, two independent compiled kernel sets (for the f32 leg), a 2x2 outcome
structure that is invariant to relabelling, and a source walk I verified line by line. The
residual risk concentrates in exactly one place: nobody has ever OBSERVED the q6_K tensors
executing the f32 GEMM on the device. An execution-level observation would close it
completely.

### (g) Author-asserted with no archived artefact (assertion, not evidence - not marked false)

1. The exact argv and env of all six tonight-runs (`factorial-run.sh` and the earlier arm
   scripts deleted in cleanup, not mirrored to the lab). Partially reconstructed from
   effects (see claim 2 qualification 2).
2. Battery temperature 37.3 C at end of night: NOT in any archived file. The final charger
   read (`final-charger-read.txt`, 392 bytes) contains no temperature field; the only
   archived temperatures are 30.7 C (f32t push, 03:52) and 31.0 C (full push, 04:01) inside
   `f32t-version-line.txt` / `full-version-line.txt`. The report's temperature narrative
   for the end of the night is unarchived.
3. Battery level "85 -> 70": the final read says level 69. Trivial, but the number in the
   report is not the number in the file.
4. "Unplugged throughout": archived reads exist at 22:57, 02:45 (x2), 03:52-04:01 (in the
   version-line captures), and 04:14 - i.e. the four factorial arms (04:03-04:10) are
   bracketed but not individually read. Since these statistics are deterministic, charging
   state cannot affect the numbers; this is a protocol-compliance gap only.
5. Negative device-rule claims (Kalsa app never opened, no settings writes, Jelly Star not
   contacted): no artefact can prove a negative; accepted as assertion per past practice.
6. `-ngl 99` per combo arm (see (b) gap 1) and the device-side identity of the pre-existing
   Q4_K_M model file (see (b) gap 2).
7. Also archived, for the record, so nobody calls these gaps later: cleanup IS archived
   (`post-cleanup-listing.txt`: run dir reduced to corpus.txt, cpu-q4km.kld, lib/), and the
   verdict files ARE archived with `ok=1`, `has_integer_dot=1`, driver E031.41.03.62.

---

## 3. Overall verdict

Is the night's conclusion supported? YES, on the evidence as archived:

1. The q6_K dense-path routing (dp4a with int8 activation quantization) is the dominant
   error source: routing those 18 tensors to the f32 GEMM collapses median KLD 56.6x
   (0.394993 -> 0.006977) and same-top +29.1 pp, while the q4_K operand leg moves nothing
   measurable. The one never-executed-kernel prediction (914b34a7e bitwise no-effect) was
   falsifiable and survived falsification, twice.
2. The transpose/operand leg (candidate 2, `KALSA_GEMM_B`) is worth EXCLUDING from any
   landing: it moved median KLD by +0.25% (wrong sign) and same-top by -0.11 pp, and it
   carries a real expected speed cost (roughly 0.5-0.8x on the affected GEMMs per the
   archive's own precedent). No accuracy benefit exists to trade against it.
3. Full precision still fails the gate, and that is measured, not projected: 0.006954 vs
   the 0.005 gate (1.39x over) and 92.913% vs 95% (2.087 pp short), also 1.47x / 1.91 pp
   worse than the 750's accepted Q4_0 numbers. Any landing justified by these numbers is a
   partial-improvement landing, not a gate pass - the reports say this plainly.

What I would require before this evidence justifies a code landing:

1. An execution-level observation of the routing: one run (even a short one) with the
   `dense q6_K prefill GEMM path:` line actually visible - e.g. via the stderr-unfiltered
   path (the cache-debug mechanism proves one exists) or any per-node backend trace - so
   the central claim stops being purely behavioural. This is the single highest-value
   missing artefact.
2. Run combination 4 (both selectors stock) on the merged binary once, to prove a8eb58010
   is stock-equivalent and convert the factorial's inherited baseline into a measured cell.
3. Fix the census in any commit message or doc: 18 GPU-routed Q6_K tensors (14 ffn_down +
   4 attn_v); token_embd is CPU on A7X. The "19 (14+5)" wording is wrong and will be caught
   in review.
4. Archive run scripts before cleanup (or stop deleting them). Tonight's central factorial
   has no archived invocation.
5. A speed measurement of the routing change alone (dp4a -> f32 GEMM). The night measured
   accuracy only; the archive's own honest bound for the q6_K leg slowdown is 1.5-2.5x on
   that leg, and the model-level cost is unknown. A landing that silently halves q6_K
   prefill throughput will not survive review on accuracy numbers alone.
6. Either a gate revision or an explicit statement in the landing that the current gate is
   still failed at full precision - the numbers say 0.006954 > 0.005 and 92.913 < 95, so
   the change cannot be sold as meeting the standing gate.

## 4. Coverage statement

All of items (a)-(g) and claims 1-4 were reached and completed; nothing was truncated.
Not done, by design: no re-execution of any binary, no recompute of KLD from the archived
reference (requires the GPU logits, which were never dumped), no disassembly of the
binaries (source-to-binary fidelity is evidenced by hashes and build logs, not proven at
byte level). The one prior whose verification I could not complete from the archive is the
on-device identity of the pre-existing Q4_K_M model file ((b) gap 2); the phone is cleaned
and no hash was taken before cleanup.
