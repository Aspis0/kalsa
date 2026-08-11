# KEXP multi5 baseline configs (trial-marco)

## ppl_kexp/ (HISTORICAL — pre-correction 2026-08-10)
- config: --n-expert-used 8, NO drop-cold
- macro-bpb: 0.5831
- NOT used for gates after gualt correction

## ppl_kexp_k6d065/ (GATE COMPARATOR — campaign default)
- config: --n-expert-used 6 --drop-cold-experts 0.65
- all T2 gates vs KEXP use this
- T3 gate: Marco >= 1.3x KEXP(k6d065)
