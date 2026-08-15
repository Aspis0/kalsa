# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 8 (excluded=0: 8)

| order | arm | width | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF |  | 3.673 | 0.272 | 10.7 | 0.58735773 | 8052 | 26.181911 | 29.800 | 100→99 | 200 | 87 |
| 2 | ON | 4 | 3.673 | 0.272 | 5.9 | 0.61182156 | 4006 | 26.515243 | 30.400 | 99→99 | 200 | 83 |
| 3 | ON | 4 | 3.683 | 0.272 | 5.5 | 0.62850462 | 4146 | 27.221910 | 30.600 | 99→98 | 193 | 81 |
| 4 | OFF |  | 3.744 | 0.267 | 10.9 | 0.58098375 | 6111 | 24.667668 | 29.400 | 98→98 | 200 | 81 |
| 5 | OFF |  | 3.639 | 0.275 | 12.4 | 0.61361128 | 5810 | 25.619419 | 30.500 | 98→97 | 200 | 84 |
| 6 | ON | 4 | 3.692 | 0.271 | 5.9 | 0.66300317 | 6200 | 26.351845 | 31.000 | 97→97 | 197 | 81 |
| 7 | ON | 4 | 3.613 | 0.277 | 5.8 | 0.64730098 | 5765 | 27.812905 | 29.700 | 97→97 | 193 | 84 |
| 8 | OFF |  | 3.724 | 0.269 | 11.5 | 0.65905443 | 4553 | 24.924631 | 29.400 | 96→96 | 200 | 82 |

## Per-token tail (hot blocks)

- **OFF** n=600  p50=`258.14` p90=`354.03` p95=`374.63` p99=`422.51` max=`559.87` ms  stutter(>2×p50)=`1` (0.17%)
- **ON** n=783  p50=`256.21` p90=`356.43` p95=`379.66` p99=`421.25` max=`533.69` ms  stutter(>2×p50)=`1` (0.13%)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF (cold-first): sag=`0.0795` n=200
- b2_ON_w4 (hot): sag=`0.0193` n=200
- b3_ON_w4 (hot): sag=`0.0423` n=193
- b4_OFF (hot): sag=`0.0723` n=200
- b5_OFF (hot): sag=`0.0792` n=200
- b6_ON_w4 (hot): sag=`0.0416` n=197
- b7_ON_w4 (hot): sag=`0.0600` n=193
- b8_OFF (hot): sag=`0.0459` n=200

## Supporting (hot-block aggregates)

- J/token  OFF=`0.61788315`  ON=`0.6375560893997445`
- majflt/token  OFF=`27.456666666666667`  ON=`25.69220945083014`
- read_bytes_gb (block mean)  OFF=`25.070572666666667`  ON=`26.97547575`
- temp_max (max over hot blocks)  OFF=`30.5`  ON=`31.0`
- memavail_min_kib (hot blocks) = `2139352.0`

## Width Pareto (hot blocks)

Hot = `order_idx >= 2`. OFF pooled; each ON width is its own group. `majflt/tok first100` vs `rest` uses the per-token CSV `majflt` column (already a per-token delta).

| width | tok/s | p50 | p90 | p99 | max | stutter% | J/tok | majflt/tok | majflt/tok first100 | majflt/tok rest | read GB | ttft_s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFF | 3.702 | 258.14 | 354.03 | 422.51 | 559.87 | 0.17 | 0.617883 | 27.456667 | 0.0200 | 0.0000 | 25.0706 | 26.192 |
| 4 | 3.665 | 256.21 | 356.43 | 421.25 | 533.69 | 0.13 | 0.637556 | 25.692209 | 0.0600 | 0.0000 | 26.9755 | 26.957 |

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **YES** | j/tok ON=0.637556 OFF=0.617883 ratio=1.0318 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **YES** | sag ON=0.0408 OFF=0.0658  temp_max ON=31.00 OFF=30.50 dT=+0.50C (YES: sag_ON≤sag_OFF and dT≤+1.0  NO: sag_ON>sag_OFF+0.05 or dT>+2.0) |
| KF_MEMORY_WIN | **YES** | majflt/tok ON=25.69220945083014 OFF=27.456666666666667 memavail_min_kib=2139352.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **YES** | p99_ms ON=421.25 OFF=422.51  stutter_rate ON=0.0013 OFF=0.0017 (YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  NO: p99_ON>p99_OFF×1.1 or stutter_ON>stutter_OFF+0.01) |

