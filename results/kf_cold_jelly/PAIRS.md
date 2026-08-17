# KF COLD Jelly — registered Wilcoxon (OFF − ON)

Kept blocks (excluded=0): 24 / 24
Complete registered pairs: 12 (need ≥ 10)

| pair | OFF blk | ON blk | OFF s/tok | ON s/tok | OFF−ON |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | 2 | 0.1890 | 0.2000 | -0.0110 |
| 2 | 4 | 3 | 0.1930 | 0.1930 | +0.0000 |
| 3 | 5 | 6 | 0.2430 | 0.1990 | +0.0440 |
| 4 | 8 | 7 | 0.1920 | 0.1950 | -0.0030 |
| 5 | 9 | 10 | 0.1920 | 0.1980 | -0.0060 |
| 6 | 12 | 11 | 0.1900 | 0.1880 | +0.0020 |
| 7 | 13 | 14 | 0.1920 | 0.1950 | -0.0030 |
| 8 | 16 | 15 | 0.1910 | 0.2240 | -0.0330 |
| 9 | 17 | 18 | 0.1780 | 0.2000 | -0.0220 |
| 10 | 20 | 19 | 0.1850 | 0.1990 | -0.0140 |
| 11 | 21 | 22 | 0.1830 | 0.1980 | -0.0150 |
| 12 | 24 | 23 | 0.1750 | 0.2120 | -0.0370 |

## Test

- N pairs = 12; ties dropped → **effective N = 11**
- exact-test floor for that N = **0.000976562** (`2/2^11`)
- Wilcoxon exact two-sided: **W=12 p=0.0634766**
- mean OFF=0.1919 ON=0.2001 → ON vs OFF **+4.3%**
- Hodges–Lehmann shift (OFF−ON) = -0.009000 s/tok
- signs: ON faster 2 / ON slower 9 / ties 1

Decision: **not significant** at alpha 0.05 (null).

