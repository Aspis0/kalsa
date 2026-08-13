# MemAvailable curves — Task B retry

House rule: abort if MemAvailable < 300 MiB for 60 s. **Never fired.**
Sampler: 5 s, CSV in `curves/*_mem.csv`. MemFree logged only.

## Pre-flight (this session)

| moment | MemAvailable | MemFree | SwapFree | AnonPages |
|---|---:|---:|---:|---:|
| before `am kill-all` | 3 991 288 kB (3.81 GiB) | 209 148 | 7 667 708 | 2 508 700 |
| after kill-all + `memory-factor NORMAL` | 6 444 844 kB (6.15 GiB) | 2 057 576 | 9 857 532 | 1 362 916 |
| after script's own kill-all (run start) | 7 034 584 kB (6.71 GiB) | 325 620 | 10 179 324 | 1 160 304 |
| first cell START | 7 016 952 kB (6.69 GiB) | — | — | — |

## Per-cell MemAvailable (from 5 s sampler)

| tag | start kB | min kB (MiB) | max kB | last kB | samples | below 300 MiB |
|---|---:|---:|---:|---:|---:|---|
| t6_fact_o1 | 7 016 952 | 2 577 388 (2517) | 7 095 240 | 2 612 168 | 13 | no |
| t6_creative_o2 | 6 864 524 | 3 416 608 (3337) | 7 005 324 | 5 952 344 | 18 | no |
| t6_creative_o3 | 7 547 088 | 3 689 904 (3603) | 7 539 812 | 3 689 904 | 21 | no |
| t6_fact_o4 | 7 528 368 | 3 614 356 (3530) | 7 476 488 | 3 614 356 | 21 | no |
| t4_fact_ref | 7 608 232 | 3 658 396 (3573) | 7 555 040 | 3 658 396 | 21 | no |
| t4_creative_ref | 7 614 936 | 3 662 564 (3577) | 7 507 696 | 3 662 564 | 20 | no |

`--cache-mb 2000` accepted every cell (resident 1999.2 MiB). Working set **FIT**.
SwapFree stayed ~9.5–10.2 GiB (no 4 GiB drain like the extm-ON attempt).

`pid_majflt` column in the CSV is **garbage** (mksh `$10` == `${1}0`). Use engine
`major faults/token` in `*.out` plus the MemAvailable series.
