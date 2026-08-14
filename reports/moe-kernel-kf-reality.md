# K-F REALITY cell — sustained/tail/energy on Jelly — 2026-08-14

## Verdicts (thresholds declared before the run, in the analyzer header)

| gate | verdict | key numbers |
|---|---|---|
| **KF_ENERGY_WIN** | **YES** | J/token ON 0.762 vs OFF 0.770 (ratio 0.99; gate YES ≤ 1.05) |
| **KF_THERMAL_WIN** | **YES (weak evidence)** | sag ON 0.054 vs OFF 0.095; temp_max 30.0 C both arms |
| **KF_MEMORY_WIN** | **NO** | majflt/token ON 7.20 vs OFF 0.93 (gate NO > ×1.10); MemAvailable min 3.6 GB (floor never approached) |
| **KF_ROBUST_WIN** | **NO** | p99 ON 605 ms vs OFF 442 ms (gate NO > ×1.10); stutter ON 1.55% vs OFF 0.45% (gate NO > +0.01); max token ON 1352 ms vs OFF 666 ms |

Scoreboard effect: ENERGY ✅, THERMAL ✅(weak), MEMORY ❌, ROBUST ❌.

## The headline finding: the mean wins, the tail loses

ON is massively faster on average (hot blocks: p50 207 ms vs 313 ms/token)
**but its tail is worse**: the 99th-percentile token takes 605 ms (OFF: 442)
and the worst token 1352 ms (OFF: 666). Stutter tokens (> 2× arm median):
1.55% vs 0.45%. In UI terms: the stream is much faster overall, with rare
but real hiccups roughly twice as long as the baseline's worst.

Likely mechanism (hypothesis, not proven): prefetch I/O bursts colliding
with demand reads at unlucky token boundaries + the extra same-layer
collect. Tuning candidates for a v2: narrower width (6 → 4), issue
throttling/budget per token, or skipping issue when the IO queue is deep.

## Blocks (ABBA with cooldown-to-baseline between blocks)

| order | arm | tok/s | wall s/tok | stall% | J/tok | majflt | read GB | temp max | n | dur s |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OFF (cold) | 3.353 | 0.298 | 29.9 | 0.775 | 5592 | 19.4 | 28.0 | 223 | 83 |
| 2 | ON | 4.334 | 0.231 | 20.3 | 0.779 | 2759 | 22.6 | 29.0 | 191 | 60 |
| 3 | ON | 4.677 | 0.214 | 16.8 | 0.746 | 29 | 23.0 | 30.0 | 196 | 58 |
| 4 | OFF (hot) | 3.203 | 0.312 | 27.9 | 0.770 | 208 | 20.1 | 30.0 | 223 | 83 |

## Honest caveats

1. **Blocks self-terminated at EOS (~200 tokens), not the designed 1000.**
   The cell measured a warm regime, not true sustained heat: temp never
   exceeded 30 C, block duration 58-83 s. THERMAL YES is therefore weak
   evidence — a real sustained cell needs `--ignore-eos` (or a prompt
   that generates long) and 5+ minute blocks. ENERGY YES is solid (per-
   token energy at matched work). ROBUST NO is valid (tail measured on
   real decode). MEMORY NO is noisy — see next.
2. **majflt/token ON is dominated by one block**: b2_ON 14.4 faults/tok
   vs b3_ON 0.15/tok. The first ON block pays the fault bill for pages
   the prefetcher touches first; the second ON block is nearly fault-free.
   The declared threshold still fires NO, but the steady-state picture is
   closer to parity. Worth re-measuring in the sustained v2.
3. Hot-OFF tail statistics come from a single 223-token block (p99 = the
   ~2 worst tokens). Thin but pre-declared; the cooldown gate kept
   thermal state comparable (order confound controlled by design).
4. Battery cost of the whole cell: 5 points (73→68).

## Provenance

Branch `kalsa/kf-layer-ahead` @ `c3e8fc4`, kf bin `81c10e8c`, campaign
pin `36b01966` verified before/after (untouched), model `2f921958`,
prompt `b5301c32`. Cooldown-to-baseline between blocks (target = block-1
start temp + 1 C, cap 300 s). Native per-token CSV (`--csv`, `wall_ms`).
Artifacts: `results/kf_reality_jelly/device/` (runs.csv, per_token/,
power/, TAIL.md, master log).

## Next steps

- **v2 sustained** (needs `--ignore-eos` support check): 1000+ real
  tokens per block, 5+ min heat, re-read THERMAL and MEMORY there.
- **Tail engineering**: width/throttle experiments against the p99
  regression before K-F can claim ROBUST.
- K-F stays OUT of default configs until ROBUST and the pre-registered
  N≥10 ship cell pass (owner scoreboard: KF_SHIP_WIN NOT YET).
