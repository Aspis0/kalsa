# Marco Phase 1 runtime — quality grid (PC)

**Date:** 2026-08-12  
**Model:** `Marco-Mini-Instruct.i1-Q4_K_M.gguf`  
**sha256:** `a001d324b6edc6a797009fbe6eb94a52a9f32453ee8d06465409875f3e3a6dbc`  
**IT corpus:** Wikipedia «Caffè» v2 only (`498a5f3b…`). Literary Dante **not** used.

PC quality via `--ppl-decode`. Device speed **not** in this file (next: Jelly ABBA).

## Verdict

| Cell | k | drop | fail-fast IT+EN | full multi5 | macro bpb | Δ vs A0 |
|------|--:|-----:|-----------------|-------------|----------:|--------:|
| A0 | 8 | OFF | — (baseline) | — | 0.7277 | — |
| A1 | 8 | 0.65 | PASS | **PASS** | 0.7317 | **+0.0040** |
| A2 | 6 | 0.65 | PASS | **PASS** | 0.7459 | **+0.0182** |
| A3 | 6 | 0.50 | PASS | **PASS** | 0.7372 | **+0.0095** |

Gates (pre-declared): fail-fast per-lang Δ ≤ +0.05; full per-lang Δ ≤ +0.10; macro Δ ≤ +0.04.

A4 (k=5) **not run** — reserved only if needed after A2; A2 already passed.

## Per-lang bpb (full)

| Lang | A0 | A1 | A2 | A3 |
|------|---:|---:|---:|---:|
| en | 0.6051 | 0.6079 | 0.6153 | 0.6102 |
| es | 0.6766 | 0.6788 | 0.6892 | 0.6825 |
| fr | 0.7234 | 0.7260 | 0.7392 | 0.7332 |
| it | 0.7501 | 0.7546 | 0.7689 | 0.7590 |
| zh | 0.8834 | 0.8915 | 0.9166 | 0.9011 |

Worst single-lang delta: **A2 zh +0.033** (still under +0.10).

## Reading

- **A1** almost free vs A0 (drop-only).
- **A2** (campaign clone k6d065) is the largest quality tax, still inside gate.
- **A3** sits between A1 and A2.
- Drop does **not** skip matmul; these numbers only bound *quality* of k/drop.

## Next

Speed on **Jelly** (ranking only, `-t 2`): ABBA A0 vs A2, 2 prompts, n=200, cold, batt ≥45%.  
Gate: decode median ≥ 1.15× **or** MiB/tok ≤ −20% vs A0.

If A2 speed does not move hit/MiB → Phase 1 runtime **INSUFFICIENT** → MarcoKEXP (no “raise drop”).

## Artefacts

- `results/marco_phase1/VERDICT.md`
- `results/marco_phase1/QUALITY_STATUS.txt`
- `results/marco_phase1/A{1,2,3}/full/*_full_summary.json`
- `results/marco_phase1/runs_quality.csv`
