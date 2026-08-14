# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 4 (excluded=0: 4)

| order | arm | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF | 3.353 | 0.298 | 29.9 | 0.77469093 | 5592 | 19.435860 | 28.000 | 73→72 | 223 | 83 |
| 2 | ON | 4.334 | 0.231 | 20.3 | 0.77875923 | 2759 | 22.645432 | 29.000 | 72→71 | 191 | 60 |
| 3 | ON | 4.677 | 0.214 | 16.8 | 0.74581040 | 29 | 23.003464 | 30.000 | 71→70 | 196 | 58 |
| 4 | OFF | 3.203 | 0.312 | 27.9 | 0.76985591 | 208 | 20.107543 | 30.000 | 69→68 | 223 | 83 |

## Per-token tail (hot blocks)

- **OFF** n=223  p50=`313.54` p90=`378.46` p95=`405.53` p99=`441.51` max=`665.64` ms  stutter(>2×p50)=`1` (0.45%)
- **ON** n=387  p50=`207.13` p90=`252.77` p95=`285.98` p99=`604.75` max=`1352.18` ms  stutter(>2×p50)=`6` (1.55%)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF (cold-first): sag=`-0.0436` n=223
- b2_ON (hot): sag=`0.1066` n=191
- b3_ON (hot): sag=`0.0018` n=196
- b4_OFF (hot): sag=`0.0945` n=223

## Supporting (hot-block aggregates)

- J/token  OFF=`0.7698559147982063`  ON=`0.7620719638242894`
- majflt/token  OFF=`0.9327354260089686`  ON=`7.204134366925064`
- read_bytes_gb (block mean)  OFF=`20.107543`  ON=`22.824448`
- temp_max (max over hot blocks)  OFF=`30.0`  ON=`30.0`
- memavail_min_kib (hot blocks) = `3626036.0`

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **YES** | j/tok ON=0.762072 OFF=0.769856 ratio=0.9899 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **YES** | sag ON=0.0542 OFF=0.0945  temp_max ON=30.00 OFF=30.00 dT=+0.00C (YES: sag_ON≤sag_OFF and dT≤+1.0  NO: sag_ON>sag_OFF+0.05 or dT>+2.0) |
| KF_MEMORY_WIN | **NO** | majflt/tok ON=7.204134366925064 OFF=0.9327354260089686 memavail_min_kib=3626036.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **NO** | p99_ms ON=604.75 OFF=441.51  stutter_rate ON=0.0155 OFF=0.0045 (YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  NO: p99_ON>p99_OFF×1.1 or stutter_ON>stutter_OFF+0.01) |

