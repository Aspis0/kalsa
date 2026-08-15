# K-F width sweep — sustained long blocks, Pareto p50/p99/stutter/J-tok — 2026-08-14

Jelly, Marco-Mini, campaign cell flags, 6 blocks x 1000 REAL tokens
(long-generation prompt `5c3f4113`, no EOS deaths), plan
`OFF W6 W4 W3 W2 OFF`, cooldown-to-baseline between blocks, batt 64->40,
temp 32->38 C, floors honored, pin `36b01966` untouched.

## Headline 1 — under SUSTAINED load the tail FLIPS: ON beats OFF at every width

| width | tok/s | p50 ms | p90 | p99 | max | stutter% | J/tok | read GB |
|---|---|---|---|---|---|---|---|---|
| OFF | 2.548 | 383.9 | 517.1 | **637.7** | 706.3 | 0.00 | 1.013 | 55.1 |
| 2 | 2.731 | 358.7 | 492.0 | 559.5 | 604.8 | 0.00 | **0.989** | 57.3 |
| 3 | 2.786 | 349.2 | 493.3 | 536.7 | 696.4 | 0.00 | 1.015 | 63.7 |
| 4 | 2.945 | 336.8 | 465.2 | 522.6 | 583.0 | 0.00 | 1.022 | 68.2 |
| 6 | **3.057** | **328.7** | **437.3** | **481.4** | **524.0** | 0.00 | 1.140 | 99.3 |

p99 improves MONOTONICALLY with width (638 -> 481 ms). Stutter ~0
everywhere. The short-block regression (REALITY v1: ON p99 605 vs OFF
442) was a warm-regime artifact: in the hot sustained regime it is OFF
whose tail degrades (thermal), not ON.

**Honest scope note:** the chat product regime is short bursts on a
fresh-ish phone — closer to REALITY v1 (where ON's tail LOST) than to
this sustained cell. KF_TAIL is therefore REGIME-DEPENDENT: sustained =
green, burst = red. The registered ROBUST cell must mirror product
usage (short generations with idle gaps) before any green claim.

## Headline 2 — width Pareto has a clean knee at W4

- **W6**: max speed (+20.0% tok/s vs OFF) and best tail, but J/tok +12.5%
  and read bytes +80% — pays energy for speed. ENERGY gate alone: fail.
- **W4**: +15.6% tok/s at J/tok parity (+0.8%) — the Pareto knee.
- **W2**: +7.2% tok/s at J/tok **-2.4%** (energy-positive), read ~parity.
- W3: between W2/W4; its majflt spike (30.7/tok) is a single-block
  anomaly, not monotone — do not over-read.

Default candidate: **W4** (speed at energy parity), pending the
burst-regime re-test; W2 if energy ever becomes the binding gate.

## Headline 3 — THERMAL under sustained: NO, and it is physics

Sag (early-half vs late-half tok/s): ON 0.32-0.36 at every width vs OFF
0.23; temp_max ON 38 vs OFF 37. ON runs faster early, generates more
heat, throttles harder; all arms converge to ~2.4-2.5 tok/s late —
thermally limited, where IO is no longer binding and prefetch gains
evaporate. The 1000-token median still wins (+20% W6) because the early
phase dominates. On thermally-limited hardware K-F is a burst
accelerator, not a sustained-rate raiser. (Gate as declared: NO —
banked as such, with this explanation.)

## MEMORY re-read — the gate metric is an IO-path artifact

majflt/tok: OFF 0.16, W6 0.52, W4 6.2, W2 4.9 (W3 30.8 anomaly).
Non-monotone and inverted vs IO volume (W6 does the MOST IO with the
FEWEST faults): fault counts reflect WHICH path serves the bytes
(prefetch path vs demand mmap faults), not memory distress.
MemAvailable min 3.46 GB — floor never approached, no swap storm. The
honest MEMORY verdict: no pressure; the declared gate fires NO on a
metric that does not measure what it was named for. Gate definition to
revise for the registered cell (majflt of the DEMAND path only, or RSS
churn).

## Cold-start split (owner's request)

first-100 vs rest majflt/tok: OFF 0.00/0.09, W2 0.33/5.14, W4 0.00/5.46,
W6 0.00/0.00. No first-block cold-start bill in this cell (the v1
first-ON-block spike did not reproduce with long blocks and cooldowns);
faults accumulate in steady-state at mid widths instead (path mix).
TTFT: OFF 14.9 s, W6 15.0 s (parity); W2-W4 16.5-17.2 s (single
measurements, weak signal).

## Scoreboard effect (owner list)

- KF_TAIL: ❌ -> **regime-split** (sustained ✅ / burst ❌) — burst cell
  decides.
- KF_ROBUST: MIXED informational here (pooled ON p99 beats OFF; stutter
  0.03% vs 0.00%) — registered cell in the product regime decides.
- KF_THERMAL: **NO under sustained, by physics** (burst regime is the
  product regime — measure there).
- KF_MEMORY: gate metric unfit; no actual memory pressure. Redefine.
- KF_ENERGY_NEUTRAL: holds pooled (1.028); per-width map W2 0.976 /
  W4 1.008 / W6 1.125.

## Artifacts

`results/kf_sweep/` (runs.csv, per_token/ b1..b6, power/, PARETO.md,
master log, block_plan.txt). Battery cost 24 points.
