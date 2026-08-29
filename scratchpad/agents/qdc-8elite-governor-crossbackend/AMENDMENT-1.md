# AMENDMENT-1 — thermal instrumentation was wrong; run 1 is VOID

Written 2026-08-29 ~07:55 EDT, BEFORE re-running. Amends PREREG.md (locked ddddf077).

## What happened

Run 1 (session 788862) executed both blocks and produced complete numbers. While
double-checking instrumentation I found the thermal gate was reading the WRONG sensor
group, so it could never fire:

- `dumpsys thermalservice` prints **two** groups. `Cached temperatures:` (line ~11) is
  stale — it returned the identical values (CPU0 59.4, GPU0 45.7) for over 30 minutes
  including under sustained load. `Current temperatures from HAL:` (line ~43) is live.
- Live readings during a 20-second CPU benchmark: CPU0 **51.7 → 82.2 → 86.5 °C**,
  GPU0 50.7 → 62.3 → 64.6 °C. The device also reports **`Thermal Status: 3`** (severe).
- Consequence: the PREREG's abort rule ("abort if pre-run temperature exceeds the first
  run's by >8 °C") was evaluated against a frozen number and never triggered.

The measured degradation across blocks is consistent with real throttling, and it hit
the CONTROL arm hardest: arm A block 1 → block 2 went ttft 1395.9 → 2226.3 ms and decode
23.80 → 16.22 t/s (−32 %). A control arm that loses a third of its decode rate between
blocks means the block-to-block comparison is not usable.

**Run 1 is declared VOID for performance purposes.** Its logs are kept as evidence
(`raw/`) and its correctness result stands on its own (see below), but no timing from it
will be cited as a measurement.

## Amendments (binding for run 2)

1. **Thermal truth = the HAL section only.** Parse strictly after the line
   `Current temperatures from HAL:`. Record CPU0..CPU7 and GPU0..GPU3, plus the global
   `Thermal Status:` integer, before and after EVERY run.
2. **Cool-down gate before every run**: wait until live CPU0 ≤ 60 °C AND
   `Thermal Status` ≤ 1, polling every 30 s, with a 10-minute cap. If the cap is hit,
   the run is recorded as `THERMAL-CAP` and the block is VOID.
3. **Abort rule restated on live values**: abort the block if any run's pre-run live CPU0
   exceeds the block's first run pre-run CPU0 by >8 °C.
4. Everything else in PREREG.md (arms, order, metrics, decision rule, r=3, medians)
   is unchanged. No new arms.

## What run 1 DOES establish (not affected by thermals)

Correctness, which is pass/fail and does not depend on clocks:
`test-governor-v0-devices` **PASSED on real GPU+CPU** (prefill on OpenCL/Adreno 830,
decode on CPU): 3 turns, token contract satisfied, `prefill_splits=2` (vs 1 on CPU-only —
the split-constancy assertion is no longer vacuous), both commit paths exercised
(`naive=1 staged=2`), commit bytes 1720320. That is the step-8 correctness goal met.
