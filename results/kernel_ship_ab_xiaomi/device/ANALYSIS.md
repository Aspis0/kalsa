# Kernel ship A/B — analysis (PREREG)

Complete pairs (both arms excluded=0): **12**

## Metric 1 — decode wall s/token (confirmatory)

- Pairs used: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
- Median A: `0.368000` s/token
- Median B: `0.314500` s/token
- Hodges–Lehmann shift (B−A): `-0.056250` s/token
- % change (median B vs median A): `-14.538%`
- Wilcoxon signed-rank two-sided: W=`0` p=`0.000976562` (scipy)
- alpha=0.05; lower s/token is faster; negative HL means B faster.
- Decision: **significant** at alpha 0.05 (two-sided).

| pair | A s/tok | B s/tok | B−A |
| ---: | ---: | ---: | ---: |
| 1 | 0.336000 | 0.261000 | -0.075000 |
| 2 | 0.295000 | 0.279000 | -0.016000 |
| 3 | 0.294000 | 0.294000 | +0.000000 |
| 4 | 0.368000 | 0.295000 | -0.073000 |
| 5 | 0.382000 | 0.325000 | -0.057000 |
| 6 | 0.368000 | 0.317000 | -0.051000 |
| 7 | 0.367000 | 0.313000 | -0.054000 |
| 8 | 0.368000 | 0.321000 | -0.047000 |
| 9 | 0.374000 | 0.315000 | -0.059000 |
| 10 | 0.382000 | 0.327000 | -0.055000 |
| 11 | 0.419000 | 0.329000 | -0.090000 |
| 12 | 0.396000 | 0.314000 | -0.082000 |

## Supporting metrics 2–5

### 2. Sustained late-rep (last 4 complete pairs)
- N=4  median A=`0.389000`  median B=`0.321000`  HL(B−A)=`-0.071500`

### 3. J/token
- N=2 pairs [1, 12]  median A=`0.990544`  median B=`2.94921`  HL(B−A)=`1.95867`

### 4. Max battery temperature
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`39`  median B=`38.85`  HL(B−A)=`0`

### 5. TTFT proxy (first measured run of each arm)
- first A `p01_A` ttft_s=`7.207`
- first B `p01_B` ttft_s=`7.769`
