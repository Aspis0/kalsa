# Cell 78: Android thermal headroom vs status, skin and battery under NPU decode (S23, 2026-10-10)

Purpose: set the engine's graduated pacing lines (`decode_pacing_headroom_start` and `_full`).

## Answer

On the S23, Android's forecast (`cmd thermalservice headroom 10`, the same value as NDK `AThermal_getThermalHeadroom`) is an exact linear function of the HAL SKIN temperature, with a residual of 0.000 over 199 samples:

    headroom = (skin_c - 12.0) / 30.0

| Android status | first seen | headroom | skin | battery |
|---|---|---|---|---|
| 0 | t = 0 | 0.683 | 32.5 C | 32.4 C |
| 1 LIGHT | 128 s | 0.877 | 38.3 C | 37.5 C |
| 2 MODERATE | 224 s | 0.937 | 40.1 C | 39.7 C |
| 3 SEVERE | 338 s | 1.003 | 42.1 C | 41.8 C |

- At full NPU decode speed the S23 goes from 32.5 C to SEVERE in under 6 minutes.
- Battery tracks skin to within about 0.5 C here.
- Chosen engine lines: start 0.87 (the status-1 line, skin about 38 C) and full 0.97 (skin about 41 C, below SEVERE at 1.0), with min duty 0.35. A battery ramp from 39.5 C to 43 C sits under the headroom ramp.

## Setup

| | |
|---|---|
| Device | S23 (SM8550), unplugged |
| Battery | 91 % |
| App | Force-stopped first, so one model is in memory |
| Bench | `governor-bench` `bd26f1b2` |
| Script | `run-s23-headroom-cal.sh` |

Load:
- separate processes, each one 4096-token full-speed NPU rep (arm L, `--legs npu`);
- one model load per process, because of the 2026-10-09 hard reset in cell 77.

Sampler, every 2 s:
- headroom at 10 s;
- Android status;
- HAL SKIN;
- battery temperature;
- MemAvailable (`raw/headroom.csv`).

The run stopped on the script's guard: status >= 3 sustained for 60 s, at 396 s (`raw/cal_report.grep`). MemAvailable stayed at about 1.0-1.1 GB.

## Caveats

- One device, one run.
- The forecast horizon is 10 s.
- The linear form is what this S23's HAL reports. Other devices publish their own thresholds, so the lines are device-relative in skin terms.
