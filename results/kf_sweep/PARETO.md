# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 6 (excluded=0: 6)

| order | arm | width | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF |  | 2.560 | 0.391 | 21.0 | 0.98275344 | 34172 | 52.806230 | 32.000 | 64→61 | 1000 | 411 |
| 2 | ON | 6 | 3.057 | 0.327 | 13.1 | 1.13975775 | 517 | 99.282862 | 36.000 | 60→56 | 1000 | 344 |
| 3 | ON | 4 | 2.945 | 0.340 | 15.3 | 1.02157626 | 6186 | 68.194787 | 37.000 | 55→52 | 1000 | 359 |
| 4 | ON | 3 | 2.786 | 0.359 | 16.4 | 1.01482870 | 30754 | 63.683277 | 37.000 | 51→48 | 1000 | 379 |
| 5 | ON | 2 | 2.731 | 0.366 | 17.5 | 0.98941699 | 4917 | 57.309585 | 38.000 | 47→44 | 1000 | 385 |
| 6 | OFF |  | 2.548 | 0.392 | 20.7 | 1.01314962 | 162 | 55.096480 | 37.000 | 43→40 | 1000 | 410 |

## Per-token tail (hot blocks)

- **OFF** n=1000  p50=`383.92` p90=`517.14` p95=`561.44` p99=`637.71` max=`706.28` ms  stutter(>2×p50)=`0` (0.00%)
- **ON** n=4000  p50=`343.54` p90=`477.62` p95=`501.84` p99=`540.62` max=`696.42` ms  stutter(>2×p50)=`1` (0.03%)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF (cold-first): sag=`0.2365` n=1000
- b2_ON_w6 (hot): sag=`0.3536` n=1000
- b3_ON_w4 (hot): sag=`0.3484` n=1000
- b4_ON_w3 (hot): sag=`0.3594` n=1000
- b5_ON_w2 (hot): sag=`0.3227` n=1000
- b6_OFF (hot): sag=`0.2331` n=1000

## Supporting (hot-block aggregates)

- J/token  OFF=`1.013149623`  ON=`1.0413949252499999`
- majflt/token  OFF=`0.162`  ON=`10.5935`
- read_bytes_gb (block mean)  OFF=`55.09648`  ON=`72.11762775`
- temp_max (max over hot blocks)  OFF=`37.0`  ON=`38.0`
- memavail_min_kib (hot blocks) = `3458968.0`

## Width Pareto (hot blocks)

Hot = `order_idx >= 2`. OFF pooled; each ON width is its own group. `majflt/tok first100` vs `rest` uses the per-token CSV `majflt` column (already a per-token delta).

| width | tok/s | p50 | p90 | p99 | max | stutter% | J/tok | majflt/tok | majflt/tok first100 | majflt/tok rest | read GB | ttft_s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFF | 2.548 | 383.92 | 517.14 | 637.71 | 706.28 | 0.00 | 1.013150 | 0.162000 | 0.0000 | 0.0911 | 55.0965 | 14.872 |
| 2 | 2.731 | 358.66 | 492.00 | 559.48 | 604.83 | 0.00 | 0.989417 | 4.917000 | 0.3300 | 5.1422 | 57.3096 | 16.502 |
| 3 | 2.786 | 349.15 | 493.33 | 536.71 | 696.42 | 0.00 | 1.014829 | 30.754000 | 17.8600 | 23.7744 | 63.6833 | 17.248 |
| 4 | 2.945 | 336.84 | 465.18 | 522.64 | 583.00 | 0.00 | 1.021576 | 6.186000 | 0.0000 | 5.4589 | 68.1948 | 17.163 |
| 6 | 3.057 | 328.74 | 437.26 | 481.42 | 523.99 | 0.00 | 1.139758 | 0.517000 | 0.0000 | 0.0000 | 99.2829 | 14.970 |

## Verdicts

Note: sweep mode (multiple ON widths). The four YES/NO/MIXED gates below are **informational** — they compare OFF vs pooled ON (v1 semantics) and are not the registered gate cell. Use the Width Pareto table for screening.

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **YES** | j/tok ON=1.04139 OFF=1.01315 ratio=1.0279 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **NO** | sag ON=0.3460 OFF=0.2331  temp_max ON=38.00 OFF=37.00 dT=+1.00C (YES: sag_ON≤sag_OFF and dT≤+1.0  NO: sag_ON>sag_OFF+0.05 or dT>+2.0) |
| KF_MEMORY_WIN | **NO** | majflt/tok ON=10.5935 OFF=0.162 memavail_min_kib=3458968.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **MIXED** | p99_ms ON=540.62 OFF=637.71  stutter_rate ON=0.0003 OFF=0.0000 (YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  NO: p99_ON>p99_OFF×1.1 or stutter_ON>stutter_OFF+0.01) |

