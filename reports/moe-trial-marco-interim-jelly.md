# INTERIM — trial Marco (Jelly only) · 2026-08-10/11

Snapshot so Jelly work is not only on-device. **Not** the final adoption report.

## Done on Jelly

| item | result |
|---|---|
| Termux + API + Boot | installed (github-debug) |
| Binary build | `bmoe-cli` armv8.2-a+dotprod+fp16 · sha `36b01966…` |
| Models | Marco i1-Q4_K_M (10 505 424 704 B, sha `a001d324…`) + KEXP (13 416 430 592 B) |
| T0 | PASS · arch `qwen3moe` |
| T1 | PASS · stream smoke campaign config |
| **T3 ABBA k6d065** | **DONE** · gate **FAIL** (0.72× < 1.3×) |

### T3 numbers (canonical)

- KEXP median: **1.63 tok/s** (k=6, drop 0.65)
- Marco median: **1.17 tok/s** (drop OFF)
- ratio: **0.72×** → **NO-GO velocità** on Jelly relative ranking
- Artefacts: `results/trial_marco/t3/`

## PC (in flight / partial)

- Corpus multi5: `corpus/multi5/`
- KEXP bpb **k8 no-drop** (historical): macro **0.583** → `results/trial_marco/ppl_kexp/`
- KEXP bpb **k6d065** (gate): not finished at interim time
- Marco multi5: partial (at least EN bpb 0.605)
- Qwen3.5-4B multi5: pending
- Final report `reports/moe-trial-marco.md`: pending

## Decision so far (speed only)

On Jelly, Marco does **not** meet 1.3× KEXP(k6d065). I/O tax (~190 MiB/tok, ~34% hit) dominates. Absolute tok/s not product-citeable; relative ranking is.
