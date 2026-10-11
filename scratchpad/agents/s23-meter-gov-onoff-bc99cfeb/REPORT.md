# S23 in-app energy with the Meter, APK bc99cfeb: governor ON vs OFF, energy per turn - 2026-10-11

This is the first in-app consumption measurement read from the Meter's own traces. It is **not** the sampler-overhead
A/B (same workload, trace on vs trace off) that G4 still owes: the trace was on in every arm here.

**First turn of the same 20-turn script: governor ON (NPU prefill + NPU decode) costs 64-95 mWh and 3.4-3.9 mWh per
100 output tokens; governor OFF (CPU only) costs 334 mWh and 21.7 mWh per 100 output tokens, and takes the skin from
32.9 to 42.1 C (Android status 3, SEVERE) within that one turn.** One OFF turn against two ON turns: the direction and
the order of magnitude hold, the exact ratio does not.

## Setup

| | |
|---|---|
| APK | app `bc99cfeb`, debuggable (Meter `GovernorBatteryPackage` in the dex) |
| Device | S23 (SM-S911U), unplugged, `kalsa.bench.energy_trace=1` (one `files/energy/<ms>-t<N>.csv` per turn, schema `kalsa-governor-battery-trace-v2`) |
| Script | `campaigns/t20c-g2` conversation c1-V1, tools OFF, compaction anchored |
| ON | `kalsa.governor.enabled=1`, one-copy, route `NPU>NPU` in KALSA_GOVERNOR |
| OFF | `kalsa.governor.enabled=0`; the load offloads 0/31 layers to the GPU (`load_tensors: offloaded 0/31 layers`): CPU prefill and decode |
| Energy | S23 `current_uA` has an uncalibrated unit, so energy = charge_counter drop (3750 uAh steps) x mean voltage. One step is 3.75 mAh, i.e. +-4-25 % on these turns |

## Turn 1

| | ON run 2 | ON replicate | **OFF** |
|---|---|---|---|
| Trace | `raw/on-run2-t1.csv` | `raw/on-rep-t1.csv` | `raw/off-t1.csv` |
| Duration | 166 s | 140 s | 193 s |
| Charge | 22.5 mAh | 15.0 mAh | 82.5 mAh |
| Energy | 95 mWh | 64 mWh | **334 mWh** |
| Mean power | 2.06 W | 1.64 W | **6.23 W** |
| Tokens evaluated / predicted | 8562 / 2439 | 8357 / 1879 | 8785 / 1543 |
| mWh per 100 output tokens | 3.9 | 3.4 | **21.7** |
| Skin at turn end | 38.4 C | 38.8 C | **42.1 C, status 3** |

Computed by `raw/analyze.py` (charge counter x voltage, joined to KALSA_TELEMETRY tokens from the run's jsonl).

## Reading

- Per turn, OFF costs 3.5-5.2x the energy of ON; per output token 5.6-6.4x. The prefill (~8.5k tokens per turn) dominates
  both arms, so the per-turn ratio is the fairer one: the answers differ in length.
- OFF reached SEVERE in one turn (skin +9.2 C in 193 s, `raw/off-side.csv`), from a warmer start (32.9 C) than ON run 2
  (28.9 C). A warmer CPU leaks more, so the OFF number leans pessimistic; not enough to close a 3.5x gap.
- ON never reached status 3 over 20 turns (cell `s23-g2-full099-233486dd`, two runs).

## What went wrong in the OFF arm

- Attempt 1 ran ON: `run-t20c.sh` forces `kalsa.governor.enabled=1`. Relabelled as the ON replicate (`meter-on2`).
- Attempt 2 died at the ready gate: a snapshot restore logs `KALSA_PREWARM op=restore ok`, never `op=done` (backlog H9).
- Attempt 3 used a local, uncommitted harness copy (`scripts/campaign-meteroff/` in the kalsa-wt-gov worktree: pref
  written as 0, the plan wait skipped, the ready gate also accepts a restore). Its Mac-side watchdog (`raw/run-arm.sh`)
  stopped logging at 17:34:31 and the harness was gone by 17:41 without its exit lines. The app kept generating
  unwatched: status 3 at 17:40:20, skin max 42.1 C, below the 43 C pause. Force-stopped by hand at 17:41. Cause of the
  stall not found; only turn 1 completed.
- After the arm: `kalsa.governor.enabled` written back to 1 and the dead-load marker removed, read back from the
  device DB.

## Not covered

- One OFF turn. More OFF turns would only pause at 43 C: on the S23 the CPU-only path is not viable under load, as
  earlier S23 CPU-only sessions already showed.
- Turns 2-6 ON (run 2: 1029 mWh, 11.4 mWh per 100 output tokens; replicate: 1396 mWh, 12.8) are warmer, paced turns
  and have no OFF counterpart.
- Xiaomi and the QDC boards: no Meter run.
