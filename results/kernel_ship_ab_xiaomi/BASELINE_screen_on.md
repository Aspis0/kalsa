# Screen-on idle baseline (PREREG amendment 3)

Measured 2026-08-16 10:47:56 → 10:50:56 EDT, immediately before the session,
device idle, screen Awake, UNPLUGGED, no compute running.

| | value |
|---|---|
| Charge counter start | 3 429 000 µAh |
| Charge counter end | 3 423 000 µAh |
| ΔQ | 6 000 µAh over 180 s |
| Voltage (constant) | 4.195 V |
| Energy | 6000 × 3.6e-3 × 4.195 = **90.6 J** |
| **P₀** | **0.503 W** |

Temperature fell 36.9 → 34.9 °C over the window (post-reboot cooldown), so the
device was settling, not heating.

## Why this matters more than expected

The S23 cell measured whole-device power of 0.42 W (arm A) and 0.82 W (arm B)
with the screen off. **This baseline is the same order as the entire compute
power**, so on this device the screen contributes as much energy as the model
does — and it contributes per unit *time*, which the slower arm accumulates more
of.

Back-of-envelope with the S23's per-token energies and plausible wall times
(A ≈ 52 s, B ≈ 30 s for 200 tokens): raw J/token would read A 0.240 vs B 0.197,
i.e. **B ~18 % better** — the opposite sign of the S23's measured +11.8 % against
B. Metric 3 must therefore be reported with `P₀ × t` subtracted, as amendment 3
declares, and the raw figure shown next to it.

Correction is applied at analysis time from `runs.csv` (joules and wall clock per
run); no harness change, so the harness that was reviewed is the harness that
runs.
