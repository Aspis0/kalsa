# q59 dense-quant PPL gate — hostile mathematical audit (AUDIT_MATH.md)

Auditor: independent re-derivation, Python 3 stdlib, read-only on all cell files (only this file written).
Scope: `scratchpad/agents/q59-dense-quant-gate/` — PREREG.md, REPORT.md, PAIRED.md, ARBITRATION.md,
paired_chunks_q59.py, finalize_q59.py, RUN_LOG.md, manifest.json, all 15 `gguf/ppl/ppl-*.{json,log}`,
runner.out.log, pipeline_q59.log, pipeline_wrapper.log, and the claimed llama.cpp source at build
commit `1882bf8cd` (`BigMoeOnEdge/third_party/llama.cpp/tools/perplexity/perplexity.cpp`).

Every number below was recomputed from the raw files, not read from the reports.

---

## A. GATE ARITHMETIC (REPORT.md, from the 15 JSON files)

### A1. Δ% and PASS/FAIL — ALL CONFIRMED

Recomputed Δ% = 100·(ppl_cand/ppl_ctrl − 1) from JSON `ppl` (same values the runner's own
`IQ4_NL_DELTA` lines used, runner.out.log:24-29):

| corpus | N | IQ4_NL Δ% (exact) | Q4_0 Δ% (exact) | result |
|---|---|---|---|---|
| wiki | 64 | −1.156548 → −1.1565 | −2.464849 → −2.4648 | both PASS |
| it | 60 | +0.840955 → +0.8410 | +2.388629 → +2.3886 | IQ4_NL PASS; Q4_0 FAIL |
| es | 59 | +1.392735 → +1.3927 | +3.040204 → +3.0402 | both FAIL |
| fr | 59 | +0.461093 → +0.4611 | +2.152230 → +2.1522 | IQ4_NL PASS; Q4_0 FAIL |
| zh | 61 | +1.023772 → +1.0238 | +3.357506 → +3.3575 | both FAIL |

Against the locked +1.0% (PREREG.md:28-29, 46): **IQ4_NL FAIL on es and zh only; Q4_0 FAIL on
it/es/fr/zh — exactly the verdict lines of REPORT.md:7-11 and ARBITRATION.md:14-20.** Threshold
margins (es +0.393, zh +0.024 pp vs the ≤0.0014 pp worst-case rounding bias of A…B3 above) are
>10× the numerical uncertainty; no borderline decision. CONFIRMED.

### A2. Chunk counts — CONFIRMED

Per corpus, all three arms have identical N: wiki 64/64/64, it 60/60/60, es 59/59/59, fr 59/59/59,
zh 61/61/61 (recomputed from every log's `[k]` set). For all 15 cells: number of `[k]` matches =
JSON `n_chunks` = max index = N, indices exactly 1..N (paired_chunks_q59.py enforces this;
independent re-check agrees). Matches ARBITRATION.md:27 "64/60/59/59/61".

### A3. Model sha256 — CONFIRMED

Per arm, sha256 identical across all 5 corpora (JSON `model_sha256`), identical to manifest.json
`gguf` entries, AND identical to freshly recomputed sha256 of the actual files on disk (all four
GGUFs hashed: Q4_K_M `a7d67fef…`, IQ4_NL `d1badf26…`, Q4_0 `cabebaa4…`, BF16 `9ba85223…`), plus
source BF16, both source shards (`26a93f06…`, `cb544bd9…`) and all 5 corpus files
(`173c87a5…`, `fddf9633…`, `45b4bdbf…`, `c477f06d…`, `234fe0fd…`) — all match manifest. Provenance
chain is closed on disk. CONFIRMED.

### A4. Sizes table — CONFIRMED

Recomputed: MiB 2783446240/2²⁰ = 2654.50; IQ4_NL 2564.85; Q4_0 2490.79; shipped 2703.64. Δ vs
same-source Q4_K_M: +0.0000 / −3.3772 / −6.1673 (all match REPORT.md:15-19). Δ vs shipped:
−1.8176 / −5.1334 / −7.8728. Shipped is +1.8513% larger than the same-source Q4_K_M (so the
ARBITRATION.md:59 "1.8 % larger" is right; REPORT's −1.8176% is the inverse, also right). CONFIRMED.

### A5. Pre-Amendment leak check — CONFIRMED (as evidenced)

- All three wiki JSONs contain `--chunks 64`; the language cells `--chunks -1`
  (ppl-control-wiki.json cmd; run_ppl_q59.py chunk default). Amendment 1 (PREREG.md:38-46) respected.
- `ppl-control-wiki.log` contains exactly 64 `[k]` entries, `calculating perplexity over 64 chunks`
  line, mtime 14:00 = runner DONE control/wiki (runner.out.log:3-4) — i.e. it is the amended run,
  not the aborted −1 run (which was killed at N=7, RUN_LOG.md "Amendment 1 execution stop/relaunch").
- The aborted run's log was overwritten (`log.open("w")`, run_ppl_q59.py:99), so its values cannot
  be compared directly; but there is no channel by which they could enter any result: JSONs are
  written only after rc=0 + full parse (run_ppl_q59.py:113-116), REPORT is generated from the
  JSONs (finalize_q59.py), PAIRED from the logs. Only pre-amendment artifacts are scheduler
  "WAIT/START" lines with no numbers (pipeline_wrapper.log:1-2, pipeline_q59.log:1-2). No stale
  JSON exists (directory listing; runner skips only valid rc=0 JSONs, run_ppl_pipeline_q59.py:44-51).
  CONFIRMED — "no PPL value from the aborted cell was used" (ARBITRATION.md:27-28).

### A6. Ordering / timestamps / wall_s — CONFIRMED

runner.out.log:6-43 exactly follows Amendment 1: control↔IQ4_NL alternating per corpus
(wiki→it→es→fr→zh), then — and only after `IQ4_NL_GATE_FAIL` (es, zh) — the Q4_0 fallback in the
same corpus order; Q8_0 never run; final `DONE q59 Amendment 1`. RUN→DONE deltas = JSON `wall_s`
+ 3.7–5.8 s scheduler overhead for all 15 cells (e.g. control/wiki 3933.0 vs 3927.16; q4_0/zh
4343.0 vs 4338.19). Per-pass rates 57–77 s/chunk with iq4_nl slowest, control fastest — plausible
for CPU decode of 4B at Idle priority. NOTE (no impact): the ETA line
`estimated_total_chunks=668` is 2·(64+71+67+65+67) from tokenizer-based pre-estimates
(run_ppl_pipeline_q59.py:10) vs the actual 606 chunks; the ETA was wrong by ~10%, but it is only
a schedule estimate, never fed into anything numeric.

---

## B. PAIRED RECONSTRUCTION (PAIRED.md / paired_chunks_q59.py)

### B0. Independent re-derivation — 10/10 MATCH, no script bug found

I re-implemented the pipeline without reading the script first: parse `[k]P_k` (regex verified
below), `nll_k = k·ln P_k − (k−1)·ln P_{k−1}` with P₀-term = 0, `d_k`, mean, sample sd (N−1), SE,
`Δ% = expm1(mean d)`, CI `expm1(mean ± 1.96·SE)`, `worse`, two-sided exact binomial sign test.
Every one of the 10 comparisons reproduces PAIRED.md's mean/sd/SE to all 8 printed decimals,
CI endpoints to 4 decimals, worse/N and sign-test p to the printed precision, and Δ% to 6
decimals (e.g. iq4_nl/es mean=+0.01383125, sd=0.02068681, SE=0.00269319, Δ=+1.392735,
CI [+0.8589, +1.9294], 47/59, p=5.126e-06; q4_0/zh −3.357506 vs REPORT +3.3575). The stored
paired_chunks_q59.json agrees with my values everywhere I probed (max discrepancy 0.0, max
identity diff 4.945e-05, wiki obs 50/64, p=7.069e-06). Script-specific checks: off-by-one — none
(indices enforced 1..N); P₀ = 0 is the correct telescoping convention (u₀ = ln P₀ with P₀ = 1,
the only value making the identity exact); sd uses N−1 (paired_chunks_q59.py:220); CI is
computed on the log scale and transformed with expm1 (correct, not a delta approximation);
identity tolerance 0.00005 pp + 1e-10 matches the 4-decimal rounding of REPORT.md's printed Δ%
(paired_chunks_q59.py:227). **Finding: none.** All CONFIRMED.

### B1. The "self-check" is a telescoping tautology — CONFIRMED (as claimed by the audit brief)

`Σ_{k=1..N} [k·u_k − (k−1)·u_{k−1}] = N·u_N` exactly, for any u-sequence (u₀ = 0). Numerically I
confirm `mean_nll − ln(P_N) = 0.000e+00` in all 15 cells — and this is a float-level identity
(≈1e-16 residue), not a data check. **Consequences:** (i) the mean(nll) is determined ENTIRELY by
P_N; P_1…P_{N−1} cancel out and could be arbitrary garbage without moving the discrepancy by
1 ulp; (ii) the check validates only that the parse of the last `[k]` value equals the JSON
`ppl` (already checked separately at 1e-12, paired_chunks_q59.py:139-140) and that the float loop
did not overflow; (iii) the maximum-allowed "tolerance" (6.965e-06 = 5e-5/7.1786, the *global*
max 1/P over all cells) is likewise beside the point. The genuine checks in the script are the
ones that are NOT tautological: exactly-N matches with indices 1..N, last cumulative == final
estimate == JSON ppl, and the paired-vs-REPORT Δ% identity (max 4.945e-05 pp, dominated by
REPORT's own 4-decimal display rounding). **Severity: MINOR (wording)** — PAIRED.md:11 presents
the 0.000e+00 figure as a validation of the reconstruction; it should state that the mean is
exact by telescoping and that this check only binds P_N to the JSON. Fix is one sentence.

### B2. Equal-tokens-per-chunk assumption — CONFIRMED (from the actual source, not memory)

The binary commit is `1882bf8cd` (RUN_LOG.md; commit exists in the local tree). In
`tools/perplexity/perplexity.cpp` at that commit: with `--ppl-stride 0`,
`params.ppl_stride <= 0` routes to the legacy `perplexity()` (perplexity_v2, the stride path,
hard-errors "stride … must be greater than zero" and would return ppl = −1, so the route is
also confirmed by the logs' "calculating perplexity over 64 chunks" wording and by non-negative
PPLs). Legacy path: `n_chunk_max = tokens.size()/n_ctx` (whole 2048-token chunks, trailing
partial chunk dropped), per chunk `count += n_ctx − first − 1` with `first = n_ctx/2` →
**count grows by exactly 1023 per chunk, constant**; `P_k = exp(nll_cum/count)`; per-chunk
targets are chunk positions 1025…2047 scored from logits 1024…2046, with identical BOS
substitution across arms, KV cache cleared per chunk, n_seq = max(1, 512//2048) = 1 (matches logs).
Hence `nll_k = k·ln P_k − (k−1)·ln P_{k−1}` equals the true per-chunk mean NLL over the 1023
scored tokens **exactly, up to the 4-decimal print rounding** — and chunk k is the same token
block in all arms (same corpus bytes, deterministic tokenization). **NOTE (pedantic):** the
"second half" is n_ctx/2 − 1 = 1023 tokens, not 1024; zero impact on any number. CONFIRMED.

### B3. Rounding floor — numbers CONFIRMED; the "NOT negligible" assessment REFUTED for the analysis-relevant quantities

Floor table re-derivation: every `(2N−1)·5e-5/P_N` and pairwise sum matches PAIRED.md:20-26 to
all 8 decimals (e.g. it: control 0.00078305, iq4_nl 0.00077652, pair 0.00155957; zh pair
0.00093370). All observed d_k ranges and mean|d| also match to 8 decimals, and the
`pair floor / mean` ratios (4.55%…13.60%) are arithmetically right. But:

**(i) Error on mean(d) — telescopes out.** Σ_k ε_k = N·e_N per arm (exact), so
error(mean d) = e_N^cand − e_N^ctrl, |·| ≤ 5e-5·(1/P_N^cand + 1/P_N^ctrl) = 7.6e-6…1.39e-5 NLL
(max: fr), i.e. ≤ **0.0014 percentage points** of Δ% — versus CI half-widths of 0.30–0.98 pp and
gate margins ≥ 0.024 pp. The observed Δ% identity drift is 0 (0.000e+00) and the Δ%_paired-vs-
REPORT diff (4.945e-05 pp) is purely REPORT's display rounding. The point estimate and the CI
*centers* are rounding-robust at the 0.1% level of a half-width.

**(ii) Effect on sd/SE/CI width.** Under the uniform ±5e-5/P_k model: Var(e_k) = (h/P_k)²/3;
Var(ε_k) = k²·Var(e_k) + (k−1)²·Var(e_{k−1}); d adds candidate + control (independent). Computed
with the actual P_k: RMS per-chunk rounding noise in d_k is 1.6e-4…2.7e-4 across the 10
comparisons. Relative inflation of sd(d)² is 3.7e-5…4.8e-4 (worst: iq4_nl/it), i.e. SE and CI
width are inflated by **≤ 0.024%** (≈0.0001 pp on a 0.30 pp half-width). Negligible.

**(iii) Is "NOT negligible" justified?** For mean, SE, CI width, point estimate: **NO** — the
errors telescope out of the mean and inflate the SE by ≤0.05%. For the sign test: only 0–3
chunks per comparison have |d_k| < 4·RMS ≈ 1e-3 (min |d| = 3.4e-5, iq4_nl/zh); even a worst-case
3-flip leaves every language-corpus p < 0.05 (fr 41/59 → 38/59 ⇒ p = 0.036; it/es/zh p ≤ 4e-5);
the single borderline item is the non-gating wiki/iq4_nl p = 0.0081 (extreme 3-flip → ≈0.060),
whose accompanying CI [−2.13%, −0.17%] is rounding-robust (mean error ≤ 0.0011 pp vs 0.98 pp
half-width). So the floor matters ONLY for individual very small |d_k| — which PAIRED.md:90
already says — and the claimed "comparable to smallest |d|" wording is the only defensible
sentence. **Severity: MAJOR (wording)** — the `**IMPORTANT: … NOT negligible …**` banner
(PAIRED.md:18) and the "floor assessment" column marking 8/10 rows "NOT negligible vs mean |d|"
(PAIRED.md:33-40, rule at paired_chunks_q59.py:406-409) suggest the reconstruction or its
aggregates are unreliable, which is false by (i)–(ii). The comparison also stacks a worst-case
bound on the *last* chunk only (≈3.5–6× above the typical error: RMS at k=N is
√2·N·(h/P)/√3 ≈ 3-4e-4 vs the quoted ~1.5e-3) against the *mean* observed |d|. Reframe before
banking: state that the floor is a worst-case per-chunk bound; mean/CI/SE are affected by
≤0.0014 pp / ≤0.05% (give the numbers); only individual |d_k| ≲ 1e-3 are sign-ambiguous.
**NOTE (technicality):** `(2N−1)·h/P_N` is an upper bound only when P_{N−1} ≥ P_N; where the
sequence rises at the end (e.g. wiki control 8.6458 → 8.6983) the true sum-bound
N·h/P_N + (N−1)·h/P_{N−1} is ≈1.006× larger. The text already labels it "approximate"
(PAIRED.md:16); no numeric consequence.

### B4. Ties in the sign test — CONFIRMED clean

Zero exact ties (d_k == 0.0) in all 10 comparisons (recomputed). The script counts ties
(`chunks_tied`), drops them from the binomial denominator (paired_chunks_q59.py:243-245,
182-186) — the correct textbook treatment — and the exact two-sided binomial p I recomputed
independently matches to the last printed digit in all 10 cases. No tie-handling bug.

### B5. Multiple comparisons — CONFIRMED no overreach

ARBITRATION.md:62 declares the intervals unadjusted. Every inequality claim in ARBITRATION.md
survives a Bonferroni correction ×5 (10 comparisons → 5 tests per candidate): weakest are
iq4_nl/fr p=3.794e-3 → 0.019 and iq4_nl/wiki p=8.147e-3 → 0.041; all others < 1e-2 after
correction. No claim in §2 silently relies on a joint/adjusted reading: claims 1-3 are
per-corpus statements whose conjunction is only a summary of individually significant results.
CONFIRMED.

---

## C. ARBITRATION.md — every number traced

### §1 (hygiene): CONFIRMED
- "15/15 cells rc=0" — all JSON rc=0 ✓. "JSON ppl/ppl_err equal REPORT.md" — recomputed; all 15
  match to the printed 4 decimals ✓. "one model sha256 per arm across all 5 corpora" ✓ (A3, and
  matches disk). "chunk counts identical per corpus across arms (64/60/59/59/61)" ✓ (A2).
  "runner detached (PID 39848)" — runner.pid.txt = 39848 ✓; "exited after DONE q59 Amendment 1" —
  pipeline_q59.log's final line ✓ (process liveness itself is not verifiable from files, but the
  claimed last log line is exactly present). "no PPL value from the pre-amendment aborted cell was
  used" ✓ (A5).

### §2 (1): CONFIRMED (one wording NOTE)
"genuinely (not noise) worse … on all four language corpora" requires sign-test p AND CI
excluding 0 on every language corpus: p = 4.2e-5/5.1e-6/3.8e-3/2.6e-4 and CIs
it [+0.539,+1.144] / es [+0.859,+1.929] / fr [+0.112,+0.811] / zh [+0.437,+1.614] — all exclude
0 ✓. "+0.5…+1.4 %" ✓ (points +0.46…+1.39). "upper bound never exceeds +1.93 %" ✓ (max 1.9294).
Naive ±err 1.003–1.152% ✓ ("~1.0–1.15 %"); paired SEs are 0.15–0.30 pp, a 6–7× reduction, so
"the pairing shows [Δ vs 0] is real" ✓. **NOTE (wording):** "the pairing shows [the +1% gate]
does not [sit at the noise floor]" (ARBITRATION.md:48-49) overstates for the +1.0% line itself —
on it/es/zh the CIs straddle +1.0%, which claim (2) immediately concedes; the pairing resolves
Δ ≠ 0, not Δ vs +1.0%. Suggest "the pairing shows the degradation is distinguishable from 0
(and bounded above by ≤+1.93%), while the exact position vs +1.0% stays unresolved on it/es/zh".

### §2 (2): CONFIRMED — it/es/zh CIs all straddle +1.0%; fr (below) correctly excluded.
### §2 (3): CONFIRMED — Q4_0 lower bounds it 1.9775 / es 2.3968 / fr 1.6944 / zh 2.8034; min 1.6944 ≥ 1.69 ✓.
### §2 (4): CONFIRMED — wiki: iq4_nl Δ −1.1565%, CI [−2.1293,−0.1741] excludes 0; q4_0 Δ −2.4648%,
CI [−3.2454,−1.6780] excludes 0; q4_0 better on 50/64 chunks (d<0), p=7.069e-6. The "factual,
unexplained" framing is honest; "not evidence for IT/ES/FR/ZH users" is fair given the four
language corpora all show the opposite sign.
### §2 (5): CONFIRMED — −3.3772% (−3.38) vs same-source; −5.1334% (−5.13) vs shipped; shipped
+1.8513% larger ("1.8 %"). "Not gated; small" consistent with PREREG.
### Option B table: CONFIRMED — "−3.4 % size", "+0.5 … +1.4 % PPL … upper bound ≤ +1.93 %".
### NOT VERIFIED (external to this cell's files, cannot be audited here): q52/B′ behavioural-loop
history, "PPL 5/5 did not see B′'s degeneration", R3 prefill factor "3.19–3.5×", PLAN.md row
"28c" numbering. **NOTE:** PLAN.md and ALIVE.md at repo root contain no 'q59' text yet — §4 is
prescriptive of the bank step, which matches its wording ("Bookkeeping for the bank"), but the
listed edits must actually be performed when banking; not a defect in the verdict.

---

## D. Parsing hazards and misc — CONFIRMED

- `[k]` regex: exactly N matches per log with indices exactly 1..N for all 15 logs; no stray
  `[digits]` tokens anywhere else (set- and position-checked; timestamps "0.05.190.280 I", the
  ETA and "over N chunks" lines contain no brackets; the FLOAT pattern cannot fire outside
  bracket context). The per-log "calculating perplexity over N chunks" lines agree with the JSON
  counts (64×3, 60×3, 59×6, 61×3).
- `Final estimate` line: exactly 1 per log; ppl matches JSON `ppl` (1e-12) and the last `[k]`;
  the 5-decimal `+/-` value matches JSON `ppl_err` in all 15 (e.g. fr 0.07203, zh 0.14738,
  0.15005). Float printing consistent (JSON/REPORT 4 decimals, e.g. 0.09062 → "0.0906").
- wall_s sanity: all 15 RUN→DONE deltas = wall_s + 3.7–5.8 s; order and times fully consistent
  with Amendment 1 (A6); no overlap (sequential, one child at a time).
- manifest.json `ppl_runs` (15 records) payload-consistent with the cell JSONs; corpora shas in
  manifest match disk; `report_generated_utc` 10:10:39Z vs final DONE 06:10:39 local implies a
  UTC−4 clock — internally consistent, no discrepancy.
- No `q4_0-skipped.json`, no Q8_0 artifacts — consistent with the executed fallback path.

---

## Findings summary

| # | severity | location | finding |
|---|---|---|---|
| 1 | MAJOR (wording) | PAIRED.md:18, 33-40; paired_chunks_q59.py:406-409 | "IMPORTANT: … NOT negligible" banner + 8/10 "NOT negligible vs mean \|d\|" assessments overstate the 4-decimal rounding floor. Re-derived: error on mean(d) ≤ 1.4e-5 (≤0.0014 pp); sd/SE/CI-width inflation ≤ 0.024-0.05%; floor is a worst-case last-chunk bound (~3.5-6× the typical error) compared against mean \|d\|. Only individual \|d_k\| ≲ 1e-3 (0-3 chunks per comparison) are sign-ambiguous. All floor *numbers* are correct. |
| 2 | MINOR (wording) | PAIRED.md:11; paired_chunks_q59.py:130-134 | `\|mean(nll) − ln(JSON ppl)\| = 0.000e+00` is a telescoping tautology (Σ telescopes to N·ln P_N; P_1…P_{N−1} cancel). It validates only P_N↔JSON consistency + float arithmetic, not per-chunk accuracy. Disclose this in the Methods paragraph. |
| 3 | MINOR (wording) | ARBITRATION.md:48-49 | "the pairing shows [the gate] does not [sit at the noise floor]" — the pairing resolves Δ≠0 and bounds Δ ≤ +1.93%, but on it/es/zh the CIs straddle +1.0% (claim 2 concedes); tighten the sentence. |
| 4 | NOTE | PAIRED.md:16 | `(2N−1)·h/P_N` bound assumes P_{N−1} ≥ P_N (violated, e.g., wiki control 8.6458→8.6983); true bound ~1.006× larger. Already labeled "approximate". |
| 5 | NOTE | PAIRED.md:28 / B2 | "second half of each chunk" is 1023 tokens (n_ctx/2 − 1), not 1024; irrelevant to all numbers. |
| 6 | NOTE | runner.out.log:2; run_ppl_pipeline_q59.py:10 | ETA "668 chunks" uses tokenizer pre-estimates (71/67/65/67 vs actual 60/59/59/61); ETA only, no gate impact. |
| 7 | NOTE | ARBITRATION.md:70 | External facts (q52/B′, R3 3.19-3.5×, PPL-5/5-B′) NOT VERIFIED — outside this cell's files. PLAN.md/ALIVE.md q59 bookkeeping edits not yet present (to-do for the bank step). |

Everything else — gate Δ% and verdicts (A1), chunk counts (A2), all hashes incl. on-disk
recomputation (A3), sizes (A4), no-leak (A5), ordering/wall_s (A6), all 10 paired statistics to
8 decimals, CIs, sign tests (B0), constant-count reconstruction exactness from source (B2), ties
(B4), multiplicity (B5), every ARBITRATION §1-§2 number (C), parsing hygiene (D) — is
**CONFIRMED**. No BLOCKER, no numeric error, no failed invariant, no leaking aborted values.

## Required corrections before banking (wording only)

1. PAIRED.md Rounding-noise floor section: replace the IMPORTANT banner and the "NOT negligible
   vs mean |d|" assessments with the quantitative statement (mean-error ≤ 0.0014 pp; SE/CI
   inflation ≤ 0.05%; sign-test robust except possibly wiki/iq4_nl p, non-gating) or at minimum
   state the floor is a worst-case per-chunk bound that cancels out of the mean and inflates SE
   marginally (the ARBITRATION.md:62-63 caveat already says this correctly — align PAIRED.md).
2. PAIRED.md Method paragraph: disclose that the 0.000e+00 self-check is a telescoping identity
   (mean is ln P_N by construction) and that the meaningful checks are match counts, indices,
   last-value == final == JSON, and the Δ% identity.
3. ARBITRATION.md claim 1: one-sentence tightening per finding 3 (optional but recommended).

VERDICT: BANK-WITH-CORRECTIONS — wording-only fixes in PAIRED.md (rounding-floor banner/assessments; tautology disclosure) and optionally ARBITRATION.md claim-1 sentence; every number verified correct, all gate and paired-statistics claims CONFIRMED. If the two PAIRED.md wording fixes are applied, the gate can be banked as-is.