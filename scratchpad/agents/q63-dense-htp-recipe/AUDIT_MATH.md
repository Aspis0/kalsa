# q63 AUDIT_MATH — hostile numbers audit

Auditor: independent recomputation from raw artifacts (logs, JSONs, GGUF files on disk,
pinned llama.cpp source). Scope: numbers only. All deltas/stats below were recomputed with
an independent parser (regex + float math, no reuse of the cell scripts' functions).

Locked rule (PREREG.md:168-169): `Delta% = PPL_candidate / PPL_Q4_K_M - 1`; `PASS iff
Delta% <= +1.0% on ALL five corpora` — point estimate, same standard as q59.

---

## 1. Gate arithmetic — all 10 deltas recomputed from raw PPLs: CORRECT

Recomputed `100*(P_cand/P_ctrl - 1)` from the recorded per-cell PPLs
(`ppl/candidate{1,2}-*.json`, control JSONs in q59 `gguf/ppl/ppl-control-*.json`).
Every delta agrees with REPORT.md:5-14 and with `manifest.json` `gates.*` to ≤1e-9.

| arm | corpus | cand PPL | ctrl PPL | delta% (recomputed) | REPORT | letter vs rule | correct |
|---|---|---|---|---:|---:|---|---|
| c1 | wiki | 8.4976 | 8.6983 | −2.307347… | −2.3073% | PASS | yes |
| c1 | it | 7.6313 | 7.5985 | +0.431664… | +0.4317% | PASS | yes |
| c1 | es | 7.2920 | 7.2232 | +0.952486… | +0.9525% | PASS | yes |
| c1 | fr | 7.1874 | 7.1786 | +0.122587… | +0.1226% | PASS | yes |
| c1 | zh | 12.9734 | 12.8935 | +0.619692… | +0.6197% | PASS | yes |
| c2 | wiki | 8.4235 | 8.6983 | −3.159238… | −3.1592% | PASS | yes |
| c2 | it | 7.6978 | 7.5985 | +1.306837… | +1.3068% | FAIL | yes |
| c2 | es | 7.3478 | 7.2232 | +1.724997… | +1.7250% | FAIL | yes |
| c2 | fr | 7.2387 | 7.1786 | +0.837211… | +0.8372% | PASS | yes |
| c2 | zh | 13.1110 | 12.8935 | +1.686896… | +1.6869% | FAIL | yes |

PASS/FAIL letters in REPORT match the locked point-estimate rule in all 10 cells.
C1 all-five = True; C2 all-five = False (fails exactly it/es/zh) — as banked
(REPORT.md:18-19, `manifest.json` `gates.*.all_five`, STATUS.txt `C1_GATE/C2_GATE`).

Robustness of the closest call: C1 es +0.9525% is decided at the point estimate with a
+0.0475 pp margin. Worst-case 4-decimal rounding of the recorded PPLs puts the true delta
in [+0.9511, +0.9539]% — comfortably below the +1.0% threshold; the PASS is not a
rounding artifact. Same for every other cell (c2 it worst-case lower bound +1.3055%,
c2 es +1.7236%, c2 zh +1.6861%, c2 fr upper bound +0.8386% — no letter changes).

## 2. Control provenance — CORRECT

- REPORT control-PPL column (8.6983 / 7.5985 / 7.2232 / 7.1786 / 12.8935) equals q59's
  banked controls exactly (q59 REPORT.md table; `q59/gguf/ppl/ppl-control-*.json` on
  disk). Both the pair (PPL, chunk count) and model SHA agree.
- Rebuilt-binary validity pre-check (RUN_LOG.md:5, `ppl/control-validity-fr.json`):
  genuine 3633.96 s cell (RC 0), PPL 7.1786, 59 chunks, err 0.07203. `|7.1786 − 7.1786|
  = 0 ≤ 0.0005` → PASS per the locked acceptance (PPL 7.1786 ± 0.0005 AND 59 chunks).
  The rebuilt binary reproduced the q59 fr run bit-identically at the printed precision:
  same final PPL, same ±err (0.07203), and the per-chunk cumulative sequence in
  `ppl/control-validity-fr.log` equals the q59 `ppl-control-fr.log` value-for-value.
- Control model file on disk: 2,783,446,240 B (matches PREREG), SHA-256
  `a7d67fef…eb1887` recomputed on disk — matches the banked digest.
- Note (by design, not a violation): equivalence was empirically established on fr only;
  wiki/it/es/zh controls remain the original q59-binary runs, exactly as the lock
  permits ("run exactly one q59 control cell: control/fr").

## 3. Paired per-chunk analysis — CORRECT (all 10 rows, bit-exact)

Reconstruction validity, verified against the pinned source
(`worktree-1882bf8cd/tools/perplexity/perplexity.cpp`): the `[i]` lines print
`exp(nll/count)` with `count += n_ctx − first − 1` per chunk (perplexity.cpp:434, 633,
652); with the locked `-c 2048`, every chunk contributes exactly 1023 scored tokens, so
`ln P_k = cumNLL_k/(1023·k)` and the reconstruction `nll_k = k·ln P_k − (k−1)·ln P_{k−1}`
recovers the per-chunk per-token mean NLL exactly. No telescoping tautology, no
unequal-token weighting. Identity check: `mean(d_nll) ≡ ln(P_cand/P_ctrl)` to 1e-16 in
all four sample cells — the paired Δ% column is the gate delta by construction (the
information-carrying statistics are the CI, worse/N, and sign p, which use per-chunk
variation).

Independent recomputation from the raw chunk logs (q59 control logs + q63 candidate
logs), all 10 rows: N, mean/sd/se of d_nll, delta%, CI95 (z = 1.96), worse/better/tied,
exact two-sided binomial sign test p — **bit-exact matches** to `paired_q63.json` and
`PAIRED_Q63.md` (max |diff| = 0.00e+00 in every row). Sample rows:

| arm | corpus | N | delta% | CI95 lo | CI95 hi | worse/N | sign p |
|---|---|---:|---:|---:|---:|---:|---:|
| c1 | wiki | 64 | −2.3073% | −3.3411% | −1.2625% | 14/64 | 7.07e-06 |
| c1 | es | 59 | +0.9525% | +0.3947% | +1.5133% | 41/59 | 3.79e-03 |
| c2 | wiki | 64 | −3.1592% | −4.0305% | −2.2800% | 8/64 | 5.56e-10 |
| c2 | es | 59 | +1.7250% | +1.0515% | +2.4030% | 50/59 | 5.26e-08 |

Sign-test formula (paired_chunks_q63.py:49-50) is the textbook two-sided exact binomial
(`2·Σ_{k=0}^{min(w,b)} C(n,k)/2^n`); p-values confirmed by an independent
implementation. Hand-check of the c1 es CI: mean 0.0094797888 ± 1.96·0.0028266357 →
expm1 → [+0.3947%, +1.5133%] ✓.

Known q59 pitfalls:
- Telescoping tautology: avoided (see above; the per-chunk differences are genuine
  per-chunk quantities, and the Δ% identity with the gate delta is expected, not a bug).
- Rounding floor: cumulative PPLs are printed `%.4lf`, so the reconstruction inherits
  ±0.5e-4-per-value rounding. Monte-Carlo perturbation (2000 draws, uniform ±0.5e-4 on
  every printed cumulative value, both arms) shifts the CI bounds by ≤ ~0.003 pp and
  moves sign p within one order of magnitude in the worst cell (c1 wiki p ∈
  [1.9e-06, 7.7e-05]; c1 es p ∈ [1.6e-03, 8.6e-03]; c2 es unchanged at 5.3e-08).
  No CI-vs-threshold or significance conclusion changes. Fourth decimal of the CI is
  not meaningful; non-gating analysis, same standard as q59 (q59's own script carried
  the same floor and only reported error bounds).
- CI vs threshold: see §5.

Method note (not an error, same as q59): CI uses z = 1.96 (paired_chunks_q63.py:44-45),
the t-critical for n = 59–64 would be ≈ 2.00, i.e. ~2% wider CIs. No decision depends
on it; the analysis is declared post-hoc and non-gating (PAIRED_Q63.md header).

## 4. Chunk counts — CORRECT (10/10)

All candidate cells: log contains exactly one chunk line with indices 1..N in order,
N = 64/60/59/59/61 for wiki/it/es/fr/zh, matching `EXPECTED_CHUNKS`
(q63_common.py:28), the per-cell JSON `n_chunks`, the manifest `expected_chunks`, and
REPORT.md. No cell mismatch. Control-validity: 59/59 ✓.

## 5. Honest wording / CI vs threshold — NO OVERCLAIM FOUND

- C1 es paired CI [+0.3947, +1.5133] does straddle +1.0% (verified); C1 zh
  [−0.0022, +1.2455] and C2 fr [+0.4907, +1.1849] also straddle it. Under the locked
  point-estimate rule, the PASS letters remain correct, and no artifact claims
  otherwise:
  - REPORT.md is a numbers-only table; no CI sentence anywhere.
  - PAIRED_Q63.md carries the header "POST-HOC, NON-GATING" and only tabulates.
  - STATUS.txt, manifest.json, paired_q63.json contain no "excludes/straddles/entirely
    above/below" language (regex sweep over all artifacts: no hits).
  - The only interpretive sentence in the artifact set is the git commit message
    ("quality lives in the M-mix", commit 70035b18), a causal reading of C1-pass/C2-fail
    — not a CI/threshold claim, and it does not overstate the numbers it cites (all
    six deltas quoted there match REPORT). Flagged only for completeness.
- Delta rounding margins (worst-case 4-dp) change no PASS/FAIL letter (§1).

## 6. File sizes / SHAs / C2 FAIL letters — CORRECT

- On-disk sizes: C1 = 3,098,664,160 B, C2 = 2,765,741,280 B — equal to REPORT.md:18-19
  and to the PREREG payload predictions exactly. Byte accounting closes: GGUF offset
  10,968,288 + F32 3,899,392 (184) + IQ4_NL 1,700,904,960 (222) + Q8_0 1,382,891,520
  (35) = 3,098,664,160; C2: 10,968,288 + 3,899,392 + 2,075,443,200 (256) + 675,430,400
  (1) = 2,765,741,280. Neither file is truncated or padded.
- SHA-256 recomputed on disk: C1 `c54e95f8…9d89d`, C2 `0836af5e…c36ded`, control
  `a7d67fef…1887` — all match REPORT/manifest and the per-cell runtime hashes recorded
  by `run_ppl_q63.py` before each PPL cell (file identity between hashing and
  measurement, and quantize-before-PPL ordering, confirmed by RUN_LOG timestamps: C1
  quant 19:45–19:50, PPL 20:44–02:57; C2 quant 02:57–03:01, PPL 03:01–08:58).
- Dumps (`manifest.json` `dumps.*`): 441 tensors each; C1 = 184 F32 / 222 IQ4_NL /
  35 Q8_0 (token_embd Q8_0, 675,430,400 B), C2 = 184 F32 / 256 IQ4_NL / 1 Q8_0;
  `unexpected_types = []` → readability PASS under the frozen type-only rule, both
  decided before any PPL (RUN_LOG DUMP_DONE at 19:50:38 / 03:01:35 precede PPL phases).
- C2 FAIL letters: it/es/zh all exceed +1.0% (recomputed), wiki/fr do not — the FAIL
  set is exactly right (REPORT.md:11-14).
- Quantize argv matches the locked recipe: C1 = 6 `--tensor-type` patterns in the
  frozen order (3 Q8_0 promotions, then 3 IQ4_NL catch-alls), `--output-tensor-type
  Q8_0 --token-embedding-type Q8_0`, no `--pure`, ftype IQ4_NL, 8 threads; C2 = `--pure`
  + same overrides. Corpus SHAs identical between q59 control cells and q63 candidate
  cells (same input files). PREREG.md on disk is byte-identical to lock commit 7477247a.

### Execution-hygiene observation (no numeric impact)

The first scheduler start died on `KeyError: 'c1'` (runner.err.log) before any PPL
cell; the second start (RUN_LOG.md:16-27) skipped the completed validity/quant/dump
cells and ran the PPL cells once each. No cell was duplicated or re-measured.

---

## Findings summary

| # | severity | finding |
|---|---|---|
| F1 | none | All 10 gate deltas, PASS/FAIL letters, control values, validity check: correct. |
| F2 | none | All 10 paired rows bit-exact vs reported; reconstruction math valid (constant 1023 tokens/chunk from source); sign-tests verified. |
| F3 | none | Sizes, SHAs, type inventories, chunk counts, quantize recipes: verified on disk. |
| F4 | info | Paired CI uses z=1.96 (t≈2.00 at n=59–64) — ~2% narrower CI; q59 standard, non-gating. |
| F5 | info | 4-dp cumulative prints put a rounding floor on the paired CI (≤±0.003 pp) and sign p (≤1 order) — no conclusion changes. |
| F6 | info | C1 es +0.9525% is the margin-thinnest PASS (0.0475 pp); robust to PPL rounding; point-estimate rule applied consistently. |
| F7 | info | Reused controls for wiki/it/es/zh were not re-run with the rebuilt binary (fr equivalence only, exactly as locked; fr matched bit-identically). |
| F8 | info | Commit message "quality lives in the M-mix" is interpretive; stated numbers are all accurate; nothing in REPORT/PAIRED/STATUS/manifest claims the C1 es CI excludes the threshold. |

---

## Verdict

**BANK** — no numeric errors found in any gated or reported number. All 10 gate
deltas, all PASS/FAIL letters, control provenance, the validity pre-check, all 10
paired per-chunk rows (N, Δ%, CI, worse/N, sign p), chunk counts, file sizes, SHAs,
type inventories, and C2 FAIL letters have been independently recomputed and match
the banked artifacts bit-exactly. The C1 es +0.9525% PASS is correct under the locked
point-estimate rule, its CI correctly straddles +1.0%, and no artifact overclaims
otherwise. Findings F4–F8 are informational only; none requires any correction to
REPORT.md, PAIRED_Q63.md, or manifest.json.