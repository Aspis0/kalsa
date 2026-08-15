# PRE-REGISTRATION — K-F confirmatory cell on Jelly (kf_ship_jelly)

Registered: 2026-08-15, before any block of this cell is run. Committed to git
before launch; the commit timestamp is the registration timestamp.

## Hypothesis

H1: on Jelly Star (Marco-Mini-Instruct-KEXP, certified campaign config
k6 d0.65, -t 2, --moe-stream cache=2000 anon io=4 overlap), enabling
`--kf-prefetch --kf-prefetch-width 4` reduces per-block wall seconds/token in
the burst regime (200-token generations) versus the same binary with prefetch
off. Direction: ON < OFF.

## Design

- 24 blocks, ABBA at block level: `OFF ON:4 ON:4 OFF` repeated 6 times.
- Pairing for the test: within each ABBA quartet, (block1 OFF, block2 ON) and
  (block4 OFF, block3 ON) → 2 pairs per quartet → **N = 12 pairs**.
- One binary for both arms: kernel_kf `bmoe-cli` sha `77a94640…` (the arm is
  the flag, nothing else changes). Campaign pin sha `36b01966…` checked by the
  harness as usual.
- Harness: `run_kf_reality_jelly.sh` (unmodified, the same that ran kf_burst),
  N_GEN=200, prompt `p_fact.txt` sha `b5301c32…`, cooldown-to-baseline gate
  (block-1 start temp +1.0 °C, cap 300 s), combined 1 Hz sampler.
- Device state at launch: unplugged, battery ≥ 90%, temp ≤ 33 °C, screen off
  allowed (termux-wake-lock held).

## Primary endpoint and test

- Per-block `wall_s_tok` from runs.csv.
- **Wilcoxon signed-rank, exact, two-sided, on the 12 (OFF − ON) pair
  differences. Significance threshold p < 0.05.**
- SHIP-support verdict requires: p < 0.05 AND median paired improvement in the
  hypothesized direction (ON < OFF).

## Secondary endpoints (disclosed, not gated)

Pooled per-token p50/p95/p99 and stutter rate (>2× pooled p50), J/token ratio
ON/OFF, majflt/token, TTFT, thermal sag, read_bytes. Reported verbatim from
`analyze_kf_reality.py`.

## Exclusions and stopping

- Blocks flagged `excluded=1` by the harness (thermal/battery/RAM aborts):
  the whole pair containing the block is dropped.
- If more than 4 of 12 pairs are dropped, the cell is VOID and is rerun in
  full; no partial claims.
- Harness STOP conditions (STOP_THERMAL/STOP_BATT etc.) may pause the cell;
  resume via RESUME_AT is allowed and disclosed (same plan, cooldown gate
  re-applied). Interruption boundaries are reported with the result.

## What this cell does NOT claim

- Nothing about devices other than Jelly (the Xiaomi null and the stall-share
  scaling law stand; an S23 exploratory probe runs separately and, if
  promising, gets its own pre-registered cell).
- Nothing about sustained-regime thermal ceilings (measured elsewhere).
- KF_SHIP additionally requires the activation-policy write-up (dispatcher
  stall-gate); this cell covers only the statistical confirmation leg.
