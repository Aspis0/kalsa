# Kernel ship A/B — analysis (PREREG)

Complete pairs (both arms excluded=0): **12**

## Metric 1 — decode wall s/token (confirmatory)

- Pairs used: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
- Median A: `0.258500` s/token
- Median B: `0.148000` s/token
- Hodges–Lehmann shift (B−A): `-0.108250` s/token
- % change (median B vs median A): `-42.747%`
- Wilcoxon signed-rank two-sided: W=`0` p=`0.000488281` (scipy)
- alpha=0.05; lower s/token is faster; negative HL means B faster.
- Decision: **significant** at alpha 0.05 (two-sided).

| pair | A s/tok | B s/tok | B−A |
| ---: | ---: | ---: | ---: |
| 1 | 0.220000 | 0.127000 | -0.093000 |
| 2 | 0.255000 | 0.130000 | -0.125000 |
| 3 | 0.257000 | 0.147000 | -0.110000 |
| 4 | 0.256000 | 0.149000 | -0.107000 |
| 5 | 0.257000 | 0.147000 | -0.110000 |
| 6 | 0.256000 | 0.146000 | -0.110000 |
| 7 | 0.260000 | 0.149000 | -0.111000 |
| 8 | 0.263000 | 0.147000 | -0.116000 |
| 9 | 0.269000 | 0.171000 | -0.098000 |
| 10 | 0.268000 | 0.160000 | -0.108000 |
| 11 | 0.269000 | 0.163000 | -0.106000 |
| 12 | 0.267000 | 0.169000 | -0.098000 |

## Supporting metrics 2–5

### 2. Sustained late-rep (last 4 complete pairs)
- N=4  median A=`0.268500`  median B=`0.166000`  HL(B−A)=`-0.102500`

### 3. J/token
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`0.108939`  median B=`0.12176`  HL(B−A)=`0.0439627`

### 4. Max battery temperature
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`39.3`  median B=`39.5`  HL(B−A)=`-0.05`

### 5. TTFT proxy (first measured run of each arm)
- first A `p01_A` ttft_s=`10.896`
- first B `p01_B` ttft_s=`10.778`

