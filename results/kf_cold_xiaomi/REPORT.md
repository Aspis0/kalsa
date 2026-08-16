# kf_cold_xiaomi — cold-start K-F probe on fast flash: NULL (exploratory)

**Question**: does the K-F cold-start win (Jelly: −20% wall, TTFT −40% at cold)
generalize to fast-flash devices?
**Answer: NO — clean null, with the mechanism identified.** On the Xiaomi's
fast flash, the existing `--overlap` engine already hides cold IO almost
entirely: c01 OFF **cold** (fadv-verified, 558k pages evicted) reads 0.446
s/token of flash but stalls only **0.048 s/token (8.7%)**. There is no stall
left for the prefetch to remove — K-F's telemetry shows it working perfectly
(precision 78.2%, late 2%, max-inflight = width) on nothing.

## Blocks (n=200, t4, k6 d0.65, plugged + stayon, fadv before every cold block)

| block | arm | ms/tok | note |
|---|---|---:|---|
| b0 warmup | OFF | 311 | discard |
| w1 warm anchor | OFF | 554 | vs 398-406 historical (unplugged): charging = hotter/throttled — see caveats |
| c01 | OFF | 551 | cold; stall 8.7% |
| c02 | ON | 558 | cold; prefetch precision 78.2% |
| c03 | ON | 551 | |
| c04 | OFF | 535 | |
| c05 | OFF | 529 | |
| c06 | ON | 323 | ← mid-cell regime shift (thermal/charge governor) |
| c07 | ON | 329 | |
| c08 | OFF | 335 | |
| c09 | OFF | 329 | |
| c10 | ON | 331 | |
| c11 | ON | 327 | |
| c12 | OFF | 384 | outlier (thermal rebound) |

Pairs (design order): p1 +7 ms ON, p2 +16 ON, p3 contaminated (regime shift
inside the pair), p4 −6 ON, p5 +2 ON, p6 −57 ON (c12 outlier). Clean pairs:
ON−OFF ≈ +7/+16/−6/+2 → **parity**; both regimes internally flat
(slow: OFF ~538 vs ON ~554; fast: OFF ~332 vs ON ~327).

## The completed K-F map (3 devices × 2 regimes)

| device | regime | OFF stall | K-F effect |
|---|---|---|---|
| Jelly (slow eMMC) | cold | 22–29% | **−20% wall, TTFT −40%, p99 −17% — WIN** |
| Jelly | warm | 21–29% (cheap) | **+7% LOSS (prereg, p=0.001)** |
| S23 | probe config | ~11% | null |
| Xiaomi (fast UFS) | warm | 19–21% | null / −2% |
| Xiaomi | **cold** | **8.7%** (overlap absorbs IO) | **null** |

**Product conclusion**: K-F ships as a **cold-start accelerator for slow-flash
devices only**. Dispatcher: ON iff (measured stall% high AND cache cold AND no
thermal alarm) — which in practice selects exactly Jelly-class hardware at
first-inference time. On fast flash, `--overlap` is already the whole story.

## Caveats (exploratory — no stats claims)

- Phone plugged and charging: warm anchor 554 vs 398-406 historical
  (unplugged) — hotter, different governor. Within-cell A/B validity is
  preserved (arms alternate through both regimes), cross-cell absolute
  comparisons are not.
- Mid-cell regime shift (~21:40, between c05 and c06) split the cell into a
  slow and a fast half; pair p3 straddles it and is discarded; both halves are
  internally flat.
- v1 of this probe produced garbage (a rejected `--prompt-file` flag → usage
  dump; weak validity check accepted it). Fixed by grok: prompt via device-side
  `-p "$(cat …)"`, DONE requires parsed timing + wall>40s + >20KB. Garbage
  archived in `out_garbage_v1/`… (v1 STATUS in `STATUS.v1.txt` if present).

Data: `out/*.txt` (full stdouts incl. moe-stream + kf-prefetch telemetry),
`STATUS.txt` (driver log with fadv verifications), `run_cold_probe.sh` (driver).
