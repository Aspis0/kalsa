# kf_ship_jelly — pre-registered confirmatory cell: NEGATIVE (direction reversed)

**Pre-registered verdict: SHIP-SUPPORT NOT MET.** Wilcoxon exact two-sided on the
12 registered pairs: **W=1, p=0.000977 — significant in the OPPOSITE direction.**
ON (kf-prefetch W4) is **+7.1% slower** than OFF (mean 0.2056 vs 0.1920 s/tok);
11 of 12 pairs against; median paired diff −0.0120 s/tok. Registration:
`PREREG.md`, commit `3785392`, pushed before launch.

## Numbers

| endpoint | OFF | ON | note |
|---|---|---|---|
| wall s/tok (mean of 12) | 0.1920 | 0.2056 | +7.1% — primary, REVERSED |
| stall share | 21–29% | 13–18% | prefetch still removes stall |
| J/token | 0.758 | 0.820 | +8.2% |
| p99 per-token | 345 ms | 423 ms | worse |
| stutter rate | 0.8% | 1.2% | worse |
| majflt/token | 12.4 | 14.4 | ON touches pages warm-OFF never needs |
| thermal sag / temp_max | 0.050 / 33° | −0.003 / 33° | only surviving ON edge |

## Disclosed interruptions (per PREREG "resume allowed and disclosed")

Three launches. #1 and #2 were killed by Android (screen-off process purge)
BEFORE any block ran. #3 ran blocks 1–10, was killed mid-block-11 (partial b11
discarded, never entered runs.csv), resumed via RESUME_AT=11 ~2 h later and ran
blocks 11–24 to completion. All 12 registered pairs are intact (each pair's two
blocks ran within the same session). 0 excluded blocks; 0 pairs dropped.

## Interpretation — the regime, not the device, decides

Same device, same binary, same config, same day as the burst-cold cell
(results/kf_burst, ALL FOUR GATES YES, wall −20%, p99 −17% at cold):

| regime | OFF wall | ON wall | ON effect |
|---|---|---|---|
| burst-cold (morning, cache cold) | 0.258–0.262 | 0.205–0.212 | **−20% WIN** |
| warm cache (evening, day-long inference) | 0.183–0.206 | 0.194–0.230 | **+7% LOSS (p=0.001)** |

The warm page cache makes OFF cheap (its stall is already low-cost readahead),
while the prefetch's speculative reads compete for bandwidth and add pages —
turning the same mechanism into pure overhead. Note tonight's OFF stall share
was 21–29%, ABOVE the ~20% scaling-law threshold, and ON still lost:
**stall share alone is NOT a sufficient dispatcher signal — cache warmth is a
required second input.**

## Consequences

1. **KF_SHIP stays blocked** — and correctly so: this cell just proved K-F must
   not be a steady-state default even on the device where it wins cold.
2. The product shape sharpens: **K-F is a cold-start/burst accelerator** — the
   regime where users actually hurt (first answer after opening the app: TTFT
   12–18 s vs 21–22 s, p99 −17% at cold). Auto-OFF once warm.
3. Dispatcher policy inputs: stall% (scaling law, 3 devices) AND cold-cache
   signal (majflt rate over first tokens / time-since-last-inference).
4. If K-F is to ship, the next registered cell must target its actual claim:
   pre-registered COLD cell with explicit cache reset (`cold_model.sh`) between
   pairs. Owner decision.

Data: `device/` (runs.csv, master log, per_token, power). Analysis: `ANALYSIS.md`
(analyzer verbatim), Wilcoxon in this file computed per PREREG pairing.
