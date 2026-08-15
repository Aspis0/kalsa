# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 12 (excluded=0: 12)

| order | arm | width | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF |  | 3.225 | 0.310 | 28.4 | 1.28490204 | 12537 | 18.678342 | 40.000 | 90→89 | 200 | 79 |
| 2 | ON | 4 | 3.088 | 0.324 | 10.2 | 1.29219805 | 324 | 21.238522 | 41.000 | 89→88 | 200 | 85 |
| 3 | OFF |  | 3.050 | 0.328 | 25.3 | 1.29389294 | 8893 | 18.897388 | 41.000 | 86→84 | 200 | 82 |
| 4 | ON | 4 | 3.209 | 0.312 | 11.5 | 1.25500765 | 2937 | 20.142760 | 42.000 | 82→81 | 191 | 77 |
| 5 | OFF |  | 2.910 | 0.344 | 23.3 | 1.28964329 | 799 | 18.628952 | 42.000 | 78→77 | 200 | 86 |
| 6 | ON | 4 | 3.078 | 0.325 | 8.6 | 1.26920001 | 1511 | 21.724410 | 43.000 | 75→74 | 200 | 84 |
| 7 | OFF |  | 2.613 | 0.383 | 19.1 | 1.38190785 | 2552 | 18.637398 | 43.000 | 71→70 | 200 | 96 |
| 8 | ON | 4 | 2.890 | 0.346 | 8.7 | 1.33710466 | 4833 | 19.928134 | 43.000 | 67→66 | 200 | 90 |
| 9 | OFF |  | 3.810 | 0.262 | 24.8 | 0.77091698 | 1184 | 22.827647 | 26.000 | 99→98 | 200 | 76 |
| 10 | ON | 4 | 4.715 | 0.212 | 12.7 | 0.72430198 | 469 | 22.317568 | 27.000 | 98→97 | 200 | 62 |
| 11 | OFF |  | 3.875 | 0.258 | 22.5 | 0.75419301 | 120 | 20.210487 | 29.000 | 97→97 | 200 | 74 |
| 12 | ON | 4 | 4.887 | 0.205 | 14.1 | 0.75228107 | 836 | 21.891338 | 27.000 | 95→95 | 200 | 54 |

## Per-token tail (hot blocks)

- **OFF** n=1000  p50=`315.65` p90=`418.46` p95=`457.16` p99=`565.03` max=`1141.91` ms  stutter(>2×p50)=`5` (0.50%)
- **ON** n=1191  p50=`291.27` p90=`381.97` p95=`408.83` p99=`466.60` max=`869.14` ms  stutter(>2×p50)=`3` (0.25%)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF (cold-first): sag=`0.0513` n=200
- b2_ON_w4 (hot): sag=`0.0809` n=200
- b3_OFF (hot): sag=`0.1779` n=200
- b4_ON_w4 (hot): sag=`0.1228` n=191
- b5_OFF (hot): sag=`0.1512` n=200
- b6_ON_w4 (hot): sag=`0.1283` n=200
- b7_OFF (hot): sag=`0.1176` n=200
- b8_ON_w4 (hot): sag=`0.0072` n=200
- b9_OFF (hot): sag=`0.1367` n=200
- b10_ON_w4 (hot): sag=`0.0005` n=200
- b11_OFF (hot): sag=`0.0968` n=200
- b12_ON_w4 (hot): sag=`0.0723` n=200

## Supporting (hot-block aggregates)

- J/token  OFF=`1.0981108140000002`  ON=`1.1038821276238455`
- majflt/token  OFF=`13.548`  ON=`9.160369437447523`
- read_bytes_gb (block mean)  OFF=`19.8403744`  ON=`21.207122000000002`
- temp_max (max over hot blocks)  OFF=`43.0`  ON=`43.0`
- memavail_min_kib (hot blocks) = `2138440.0`

## Width Pareto (hot blocks)

Hot = `order_idx >= 2`. OFF pooled; each ON width is its own group. `majflt/tok first100` vs `rest` uses the per-token CSV `majflt` column (already a per-token delta).

| width | tok/s | p50 | p90 | p99 | max | stutter% | J/tok | majflt/tok | majflt/tok first100 | majflt/tok rest | read GB | ttft_s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFF | 3.252 | 315.65 | 418.46 | 565.03 | 1141.91 | 0.50 | 1.098111 | 13.548000 | 2.1580 | 3.1340 | 19.8404 | 17.925 |
| 4 | 3.645 | 291.27 | 381.97 | 466.60 | 869.14 | 0.25 | 1.103882 | 9.160369 | 5.9850 | 7.0118 | 21.2071 | 16.476 |

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **YES** | j/tok ON=1.10388 OFF=1.09811 ratio=1.0053 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **YES** | sag ON=0.0687 OFF=0.1360  temp_max ON=43.00 OFF=43.00 dT=+0.00C (YES: sag_ON≤sag_OFF and dT≤+1.0  NO: sag_ON>sag_OFF+0.05 or dT>+2.0) |
| KF_MEMORY_WIN | **YES** | majflt/tok ON=9.160369437447523 OFF=13.548 memavail_min_kib=2138440.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **YES** | p99_ms ON=466.60 OFF=565.03  stutter_rate ON=0.0025 OFF=0.0050 (YES: p99_ON≤p99_OFF and stutter_ON≤stutter_OFF  NO: p99_ON>p99_OFF×1.1 or stutter_ON>stutter_OFF+0.01) |

