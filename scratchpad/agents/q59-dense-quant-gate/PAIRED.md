# **POST-HOC, NON-GATING — the preregistered gate verdict (IQ4_NL FAIL on es/zh, Q4_0 FAIL) is unchanged**

# q59 paired-chunk PPL analysis

This is a post-hoc confidence-interval analysis. It does not alter the preregistered point-estimate gate or its verdict.

## Method and self-checks

Each log supplies cumulative PPL values `P_1..P_N` for the same chunks across arms. I reconstructed per-chunk mean NLL as `nll_k = k·ln(P_k) − (k−1)·ln(P_{k−1})`, with the `P_0` term set to zero. For each candidate, `d_k = nll_candidate,k − nll_control,k`; therefore `exp(mean(d)) − 1 = PPL_candidate/PPL_control − 1`, exactly the same point-estimate quantity as REPORT.md.

All 15/15 cells parsed. Every log had exactly N cumulative `[k]` matches with indices 1..N, its last cumulative PPL matched the `Final estimate`, and that final estimate matched JSON `ppl`.
The displayed maximum absolute discrepancy `|mean(nll) − ln(JSON ppl)| = 0.000e+00` is a telescoping identity: the reconstructed terms sum to `N·ln(P_N)` for any sequence. It validates only that the parsed last value is bound to JSON `ppl` and that the float loop is sane; it does **not** validate the individual per-chunk reconstruction. The genuine non-tautological checks are the exact-N/index checks, last cumulative == Final estimate == JSON `ppl`, and the paired-vs-REPORT.md Δ% identity.
The paired-vs-REPORT.md Δ% identity was checked for all 10 candidate cells: maximum absolute difference from REPORT.md's display-rounded Δ% was `4.945e-05` percentage points. All genuine checks passed.

## Rounding-noise floor

Because each logged `P_k` has four decimals, `|error(ln(P_k))| ≤ 0.00005/P_k`. The `(2N−1)·5e-5/P_N` figure is a **worst-case bound on the last chunk's reconstructed value**; the pairwise `d_N` bound below is the sum of candidate and control bounds. This is a numerical floor for reconstructed per-chunk values, not additional model uncertainty.

The `(2N−1)·5e-5/P_N` figure is an upper bound only when `P_{N−1} ≥ P_N`. The exact adjacent-term bound is `N·5e-5/P_N + (N−1)·5e-5/P_{N−1}`; it is approximately 1.006× larger for wiki control, where the sequence rises at the end. This has no numeric consequence for the reported results.

### Worst-case last-chunk reconstruction bound

| corpus | N | control nll_N floor | IQ4_NL nll_N floor | IQ4_NL/control pair floor | Q4_0 nll_N floor | Q4_0/control pair floor |
|---|---:|---:|---:|---:|---:|---:|
| wiki | 64 | 0.00073003 | 0.00073857 | 0.00146860 | 0.00074848 | 0.00147850 |
| it | 60 | 0.00078305 | 0.00077652 | 0.00155957 | 0.00076478 | 0.00154783 |
| es | 59 | 0.00080989 | 0.00079877 | 0.00160866 | 0.00078599 | 0.00159588 |
| fr | 59 | 0.00081492 | 0.00081118 | 0.00162610 | 0.00079775 | 0.00161267 |
| zh | 61 | 0.00046923 | 0.00046447 | 0.00093370 | 0.00045399 | 0.00092321 |

The next table reports the observed per-chunk differences alongside the floor. The range and mean are in NLL units; `pair floor / mean` is the pairwise final-chunk floor divided by the observed mean absolute per-chunk difference. The final column counts individual differences below `|d_k| < 1e-3`.

| candidate | corpus | observed d_k range | mean abs(d_k) | pair floor / mean | chunks with \|d_k\| < 1e-3 |
|---|---|---:|---:|---:|---:|
| iq4_nl | wiki | [-0.09070837, 0.11218633] | 0.03231214 | 4.55% | 3 |
| iq4_nl | it | [-0.01736176, 0.03699879] | 0.01146827 | 13.60% | 3 |
| iq4_nl | es | [-0.01611782, 0.12381809] | 0.01643965 | 9.79% | 2 |
| iq4_nl | fr | [-0.04552280, 0.02521393] | 0.01213413 | 13.40% | 2 |
| iq4_nl | zh | [-0.04045710, 0.11626942] | 0.01764282 | 5.29% | 3 |
| q4_0 | wiki | [-0.08886146, 0.09927865] | 0.03150591 | 4.69% | 3 |
| q4_0 | it | [-0.00834156, 0.06776046] | 0.02423233 | 6.39% | 0 |
| q4_0 | es | [-0.01164225, 0.15480932] | 0.03056706 | 5.22% | 2 |
| q4_0 | fr | [-0.02558735, 0.06569486] | 0.02410982 | 6.69% | 1 |
| q4_0 | zh | [-0.00574827, 0.09529777] | 0.03327165 | 2.77% | 1 |

The reconstruction errors telescope out of `mean(d)`: error on `mean(d) ≤ 5e-5·(1/P_N^cand + 1/P_N^ctrl) = 7.6e-6…1.39e-5` NLL, i.e. at most `0.0014` percentage points of Δ%, versus CI half-widths of `0.30–0.98` percentage points. Under a uniform ±`5e-5/P_k` rounding model, RMS per-chunk noise in `d_k` is `1.6e-4…2.7e-4` and inflates `sd(d)^2`/SE/CI width by at most `0.05%` (worst case IQ4_NL/it, approximately `0.0001` percentage points on a `0.30` percentage-point half-width). Only individual `|d_k| ≲ 1e-3` are sign-ambiguous (`0–3` chunks per comparison); a worst-case three-flip leaves every language-corpus sign-test p below `0.05`, while only the non-gating wiki/IQ4_NL p=`0.0081` could reach approximately `0.06`.

## Per-chunk NLL difference summaries

| candidate | corpus | N | mean(d) | sd(d), sample | SE |
|---|---|---:|---:|---:|---:|
| iq4_nl | wiki | 64 | -0.01163288 | 0.04036814 | 0.00504602 |
| iq4_nl | it | 60 | 0.00837439 | 0.01186882 | 0.00153226 |
| iq4_nl | es | 59 | 0.01383125 | 0.02068681 | 0.00269319 |
| iq4_nl | fr | 59 | 0.00460033 | 0.01363051 | 0.00177454 |
| iq4_nl | zh | 61 | 0.01018567 | 0.02322176 | 0.00297324 |
| q4_0 | wiki | 64 | -0.02495735 | 0.03279518 | 0.00409940 |
| q4_0 | it | 60 | 0.02360548 | 0.01590217 | 0.00205296 |
| q4_0 | es | 59 | 0.02994905 | 0.02454685 | 0.00319573 |
| q4_0 | fr | 59 | 0.02129397 | 0.01760369 | 0.00229181 |
| q4_0 | zh | 61 | 0.03302372 | 0.02141903 | 0.00274243 |

## IQ4_NL vs Q4_K_M

| corpus | N | Δ%_point | 95% CI low | 95% CI high | CI vs +1.0% | chunks worse / N | sign-test p | naive ±% per arm |
|---|---:|---:|---:|---:|---|---:|---:|---|
| wiki | 64 | -1.1565% | -2.1293% | -0.1741% | entirely <= +1.0% | 21/64 | 0.008147 | control +1.0554%; iq4_nl +1.0540% |
| it | 60 | +0.8410% | +0.5386% | +1.1443% | straddles +1.0% | 46/60 | 4.224e-05 | control +1.0110%; iq4_nl +1.0169% |
| es | 59 | +1.3927% | +0.8589% | +1.9294% | straddles +1.0% | 47/59 | 5.126e-06 | control +1.0083%; iq4_nl +1.0200% |
| fr | 59 | +0.4611% | +0.1123% | +0.8111% | entirely <= +1.0% | 41/59 | 0.003794 | control +1.0034%; iq4_nl +1.0035% |
| zh | 61 | +1.0238% | +0.4368% | +1.6142% | straddles +1.0% | 45/61 | 2.643e-04 | control +1.1431%; iq4_nl +1.1520% |

## Q4_0 vs Q4_K_M

| corpus | N | Δ%_point | 95% CI low | 95% CI high | CI vs +1.0% | chunks worse / N | sign-test p | naive ±% per arm |
|---|---:|---:|---:|---:|---|---:|---:|---|
| wiki | 64 | -2.4648% | -3.2454% | -1.6780% | entirely <= +1.0% | 14/64 | 7.069e-06 | control +1.0554%; q4_0 +1.0421% |
| it | 60 | +2.3886% | +1.9775% | +2.8015% | entirely > +1.0% | 57/60 | 6.254e-14 | control +1.0110%; q4_0 +1.0197% |
| es | 59 | +3.0402% | +2.3968% | +3.6876% | entirely > +1.0% | 55/59 | 1.698e-12 | control +1.0083%; q4_0 +1.0229% |
| fr | 59 | +2.1522% | +1.6944% | +2.6121% | entirely > +1.0% | 53/59 | 1.754e-10 | control +1.0034%; q4_0 +1.0121% |
| zh | 61 | +3.3575% | +2.8034% | +3.9146% | entirely > +1.0% | 58/61 | 3.286e-14 | control +1.1431%; q4_0 +1.1521% |

`Δ%_point` is the paired point estimate, not a new gate decision. The CI classification asks only whether the 95% CI is entirely at or below +1.0%, entirely above +1.0%, or straddles +1.0%.

## Wiki observation

On wiki, Q4_0 favoured Q4_K_M on 50/64 chunks (`d_k < 0`); the two-sided exact sign-test p-value was `7.069e-06`. The paired 95% CI for Q4_0 Δ% was `[ -3.2454%, -1.6780% ]`, so it excludes 0: **YES**.

This is the observed wiki pattern: both candidates are better than Q4_K_M on wiki, while both are worse on all four language corpora.

## Limitations

- Post-hoc and non-gating; the preregistered verdict is unchanged.
- Single seed and one evaluated model/protocol.
- Four-decimal log rounding creates the reconstruction floor reported above; individual very small per-chunk differences should not be overinterpreted.
- Wiki uses 64 of 145 chunks, as specified by Amendment 1.
- No Bonferroni correction is claimed; these are unadjusted per-corpus exploratory intervals and sign tests.
