# S23 in-app energy with the Meter, APK bc99cfeb: governor ON vs OFF, energy per turn - 2026-10-11

This is the first in-app consumption measurement read from the Meter's own traces. It is **not** the sampler-overhead
A/B (same workload, trace on vs trace off): that is cell `s23-meter-overhead-bc99cfeb`.

**CORRECTED the same evening.** The first version of this report took energy from the charge-counter drop and gave
turn 1 ON as 64-95 mWh (OFF 334 mWh, "3.5-5.2x"). Both ON turn-1 traces start at a full battery: the counter reads
3,750,000 uAh and changes value only 1-2 times over the whole turn (4-6 quanta of 3.75 mAh), so it under-read ON
by 3.1x and 4.0x. The numbers below integrate
current x voltage instead.

**Turn 1 of the same 20-turn script: governor ON (NPU prefill + NPU decode) costs 254-294 mWh at 6.4-6.5 W, 12.1-13.5
mWh per 100 output tokens; governor OFF (CPU only) costs 376 mWh at 7.0 W, 24.4 mWh per 100 output tokens, and takes
the skin from 32.9 to 42.1 C (Android status 3, SEVERE) within that one turn.** Per turn ON saves 1.3-1.5x; per output
token 1.8-2.0x. One OFF turn against two ON turns: these are observed ratios, not an effect estimate.

## Setup

| | |
|---|---|
| APK | app `bc99cfeb`, debuggable (Meter `GovernorBatteryPackage` in the dex) |
| Device | S23 (SM-S911U), unplugged, `kalsa.bench.energy_trace=1` (one `files/energy/<ms>-t<N>.csv` per turn, schema `kalsa-governor-battery-trace-v2`) |
| Script | `campaigns/t20c-g2` conversation c1-V1, tools OFF, compaction anchored |
| ON | `kalsa.governor.enabled=1`, one-copy, route `NPU>NPU` in KALSA_GOVERNOR |
| OFF | `kalsa.governor.enabled=0`; the load offloads 0/31 layers to the GPU (`load_tensors: offloaded 0/31 layers`): CPU prefill and decode |
| Energy | integrated `current_uA` x `voltage_mV` (`raw/energy_iv.py`). On the S23 the `current_uA` field reads in **mA**: on the three turns of cell `s23-meter-overhead-bc99cfeb`, which start below full, it matches the charge-counter energy within 0.1-2.4 % (531/543, 297/300, 392/393 mWh). Integration is a left sum up to the last sample, so it omits the final ~1 s (~0.5 % of a turn) |

## Turn 1

| | ON run 2 | ON replicate | **OFF** |
|---|---|---|---|
| Trace | `raw/on-run2-t1.csv` | `raw/on-rep-t1.csv` | `raw/off-t1.csv` |
| Duration | 166 s | 140 s | 193 s |
| Energy, current x voltage | 294 mWh | 254 mWh | **376 mWh** |
| Mean power | 6.38 W | 6.53 W | **7.00 W** |
| (charge counter, start / steps) | 95 mWh (3,750,000 / 2) | 64 mWh (3,750,000 / 1) | 334 mWh (3,225,000 / 5) |
| Tokens evaluated / predicted | 8562 / 2439 | 8357 / 1879 | 8785 / 1543 |
| mWh per 100 output tokens | 12.1 | 13.5 | **24.4** |
| Skin at turn end | 38.4 C | 38.8 C | **42.1 C, status 3** |

## Turns 1-6 ON (`raw/on-6turns-iv.txt`)

| | run 2 | replicate |
|---|---|---|
| Energy | 1311 mWh (1029 by the counter) | 1681 mWh (1396 by the counter) |
| Power, turn 1 -> turn 6 | 6.38 -> 3.44 W | 6.53 -> 3.47 W |
| mWh per 100 output tokens | 14.5 | 15.4 |

The governor's pacing shows in the power: a cold turn 1 runs at ~6.5 W, and once the skin crosses the pacing lines the
turns settle at ~3.5 W.

## Reading

- The energy difference per turn is modest (1.3-1.5x); the larger difference is heat: OFF reached SEVERE in one turn
  (skin +9.2 C in 193 s, `raw/off-side.csv`). On this same APK, governor ON stayed at status 2 or below over three
  turns (cell `s23-meter-overhead-bc99cfeb`, skin max 41.1 C); over 20 turns it never reached status 3 on the
  earlier APK `233486dd` with the same S23 pacing lines (cell `s23-g2-full099-233486dd`, two runs).
- OFF started warmer (32.9 C) than ON run 2 (28.9 C); a warmer CPU leaks more, so OFF leans pessimistic.
- The answers differ in length (1543-2439 output tokens) on a similar prefill (8.4-8.8k tokens), and OFF is a single
  turn: the per-turn and per-token ratios describe these runs, they do not bound the governor's effect.
- On the S23 the Meter's energy must come from current x voltage: the charge counter pins at full charge.

## What went wrong in the OFF arm

- Attempt 1 ran ON: `run-t20c.sh` forces `kalsa.governor.enabled=1`. Relabelled as the ON replicate (`meter-on2`).
- Attempt 2 died at the ready gate: a snapshot restore logs `KALSA_PREWARM op=restore ok`, never `op=done` (backlog H9).
- Attempt 3 used a local, uncommitted harness copy (`scripts/campaign-meteroff/` in the kalsa-wt-gov worktree: pref
  written as 0, the plan wait skipped, the ready gate also accepts a restore). Its Mac-side watchdog (`raw/run-arm.sh`)
  stopped logging at 17:34:31 and the harness was gone by 17:41 without its exit lines. The app kept generating
  unwatched: status 3 at 17:40:20, skin max 42.1 C, below the 43 C pause. Force-stopped by hand at 17:41. Cause of the
  stall not found; only turn 1 completed. The next run added a device-side guard (`s23-meter-overhead-bc99cfeb/raw/guard.sh`).
- After the arm: `kalsa.governor.enabled` written back to 1 and the dead-load marker removed, read back from the
  device DB.

## Not covered

- One OFF turn. It ended at status 3 one degree under the harness's 43 C pause; further OFF turns were not run.
  Earlier S23 CPU-only sessions throttled to unusable under load.
- Xiaomi and the QDC boards: no Meter run.
