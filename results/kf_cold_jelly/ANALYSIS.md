# KF REALITY — Jelly analysis

Per-token mechanism: native `--csv` (`wall_ms`). Hot blocks: `order_idx >= 2`.

Rows in runs.csv: 28 (excluded=0: 24)

| order | arm | width | tok/s | wall_s/tok | stall% | J/tok | majflt | read_GB | temp_max | batt | n | dur_s |
| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |
| 1 | OFF |  | 5.302 | 0.189 | 22.8 | 0.76574403 | 1922 | 22.288732 | 30.000 | 96→95 | 200 | 53 |
| 2 | ON | 4 | 5.010 | 0.200 | 15.5 | 0.84427043 | 1878 | 24.862323 | 32.000 | 95→94 | 200 | 54 |
| 3 | ON | 4 | 5.185 | 0.193 | 14.0 | 0.80640993 | 2207 | 24.224698 | 33.000 | 93→92 | 200 | 52 |
| 4 | OFF |  | 5.177 | 0.193 | 22.3 | 0.79138999 | 1922 | 22.334771 | 34.000 | 91→91 | 200 | 53 |
| 5 | OFF |  | 4.108 | 0.243 | 21.8 | 0.78494911 | 599 | 22.266147 | 34.000 | 90→89 | 200 | 67 |
| 6 | ON | 4 | 5.030 | 0.199 | 12.6 | 0.82291445 | 1983 | 24.601297 | 30.000 | 78→77 | 200 | 54 |
| 7 | ON | 4 | 5.121 | 0.195 | 13.3 | 0.84954568 | 1524 | 24.497582 | 31.000 | 77→77 | 200 | 53 |
| 8 | OFF |  | 5.200 | 0.192 | 21.4 | 0.80961512 | 1774 | 22.328107 | 33.000 | 75→75 | 200 | 53 |
| 9 | OFF |  | 5.211 | 0.192 | 21.9 | 0.82731185 | 2035 | 22.307217 | 35.000 | 73→73 | 200 | 53 |
| 10 | ON | 4 | 5.055 | 0.198 | 13.6 | 0.85556609 | 2410 | 24.349196 | 35.000 | 71→71 | 192 | 52 |
| 11 | ON | 4 | 5.316 | 0.188 | 12.8 | 0.84078037 | 2012 | 23.758983 | 35.000 | 69→69 | 200 | 52 |
| 12 | OFF |  | 5.269 | 0.190 | 21.6 | 0.78695652 | 2036 | 22.134755 | 35.000 | 67→67 | 200 | 52 |
| 13 | OFF |  | 5.197 | 0.192 | 21.4 | 0.83248227 | 1895 | 22.239556 | 36.000 | 65→65 | 200 | 53 |
| 14 | ON | 4 | 5.130 | 0.195 | 13.3 | 0.82383428 | 1623 | 24.140112 | 36.000 | 63→63 | 200 | 53 |
| 15 | ON | 4 | 4.470 | 0.224 | 12.1 | 0.80505553 | 518 | 24.524026 | 35.000 | 62→61 | 200 | 63 |
| 17 | OFF |  | 5.605 | 0.178 | 24.2 | 0.71983993 | 2143 | 22.498939 | 24.000 | 100→99 | 200 | 51 |
| 18 | ON | 4 | 4.996 | 0.200 | 14.0 | 0.78670700 | 2121 | 24.695288 | 25.000 | 99→98 | 200 | 55 |
| 19 | ON | 4 | 5.027 | 0.199 | 14.6 | 0.83776707 | 1468 | 24.702456 | 27.000 | 98→98 | 193 | 53 |
| 20 | OFF |  | 5.411 | 0.185 | 23.2 | 0.76969045 | 1237 | 22.275211 | 28.000 | 98→97 | 200 | 52 |
| 21 | OFF |  | 5.450 | 0.183 | 23.0 | 0.75374743 | 1718 | 22.141743 | 30.000 | 97→96 | 200 | 51 |
| 22 | ON | 4 | 5.039 | 0.198 | 14.1 | 0.84776886 | 1303 | 24.625422 | 31.000 | 96→95 | 200 | 54 |
| 23 | ON | 4 | 4.714 | 0.212 | 14.2 | 0.84918484 | 1475 | 23.960748 | 31.000 | 94→94 | 191 | 55 |
| 24 | OFF |  | 5.721 | 0.175 | 25.7 | 0.08671375 | 1469 | 12.599276 | 31.000 | 92→92 | 200 | 49 |
| 16 | OFF |  | 5.235 | 0.191 | 23.0 | 0.69902026 | 1207 | 22.140908 | 31.000 | 91→90 | 200 | 52 |

## Per-token tail (hot blocks)

- **OFF**: no per-token rows (hot blocks=11)
- **ON**: no per-token rows (hot blocks=12)

## Thermal sag (late-half vs early-half tok/s, per hot block)

- b1_OFF_try1 (cold-first): sag=`n/a` n=0
- b2_ON_w4_try1 (hot): sag=`n/a` n=0
- b3_ON_w4_try1 (hot): sag=`n/a` n=0
- b4_OFF_try1 (hot): sag=`n/a` n=0
- b5_OFF_try1 (hot): sag=`n/a` n=0
- b6_ON_w4_try1 (hot): sag=`n/a` n=0
- b7_ON_w4_try1 (hot): sag=`n/a` n=0
- b8_OFF_try1 (hot): sag=`n/a` n=0
- b9_OFF_try1 (hot): sag=`n/a` n=0
- b10_ON_w4_try1 (hot): sag=`n/a` n=0
- b11_ON_w4_try1 (hot): sag=`n/a` n=0
- b12_OFF_try1 (hot): sag=`n/a` n=0
- b13_OFF_try1 (hot): sag=`n/a` n=0
- b14_ON_w4_try1 (hot): sag=`n/a` n=0
- b15_ON_w4_try1 (hot): sag=`n/a` n=0
- b17_OFF_try1 (hot): sag=`n/a` n=0
- b18_ON_w4_try1 (hot): sag=`n/a` n=0
- b19_ON_w4_try1 (hot): sag=`n/a` n=0
- b20_OFF_try1 (hot): sag=`n/a` n=0
- b21_OFF_try1 (hot): sag=`n/a` n=0
- b22_ON_w4_try1 (hot): sag=`n/a` n=0
- b23_ON_w4_try1 (hot): sag=`n/a` n=0
- b24_OFF_try1 (hot): sag=`n/a` n=0
- b16_OFF_retry_try1 (hot): sag=`n/a` n=0

## Supporting (hot-block aggregates)

- J/token  OFF=`0.7147015177272728`  ON=`0.8306436645622896`
- majflt/token  OFF=`8.197727272727272`  ON=`8.637205387205388`
- read_bytes_gb (block mean)  OFF=`21.387875454545455`  ON=`24.41184425`
- temp_max (max over hot blocks)  OFF=`36.0`  ON=`36.0`
- memavail_min_kib (hot blocks) = `3023488.0`

## Width Pareto (hot blocks)

Hot = `order_idx >= 2`. OFF pooled; each ON width is its own group. `majflt/tok first100` vs `rest` uses the per-token CSV `majflt` column (already a per-token delta).

| width | tok/s | p50 | p90 | p99 | max | stutter% | J/tok | majflt/tok | majflt/tok first100 | majflt/tok rest | read GB | ttft_s |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| OFF | 5.235 |  |  |  |  |  | 0.714702 | 8.197727 |  |  | 21.3879 | 13.827 |
| 4 | 5.008 |  |  |  |  |  | 0.830644 | 8.637205 |  |  | 24.4118 | 13.864 |

## Verdicts

| gate | verdict | numbers |
| --- | --- | --- |
| KF_ENERGY_WIN | **NO** | j/tok ON=0.830644 OFF=0.714702 ratio=1.1622 (YES≤1.05 NO>1.15) |
| KF_THERMAL_WIN | **MIXED** | sag ON=None OFF=None temp_max ON=36.0 OFF=36.0 (missing) |
| KF_MEMORY_WIN | **MIXED** | majflt/tok ON=8.637205387205388 OFF=8.197727272727272 memavail_min_kib=3023488.0 (abort=307200 safe>614400) |
| KF_ROBUST_WIN | **MIXED** | p99 ON=None OFF=None stutter_rate ON=None OFF=None (missing) |

