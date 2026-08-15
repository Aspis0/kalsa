# Kernel ship A/B — analysis (PREREG)

Complete pairs (both arms excluded=0): **12**

## Metric 1 — decode wall s/token (confirmatory)

- Pairs used: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
- Median A: `0.266500` s/token
- Median B: `0.156500` s/token
- Hodges–Lehmann shift (B−A): `-0.105000` s/token
- % change (median B vs median A): `-41.276%`
- Wilcoxon signed-rank two-sided: W=`0` p=`0.000488281` (scipy)
- alpha=0.05; lower s/token is faster; negative HL means B faster.
- Decision: **significant** at alpha 0.05 (two-sided).

| pair | A s/tok | B s/tok | B−A |
| ---: | ---: | ---: | ---: |
| 1 | 0.218000 | 0.120000 | -0.098000 |
| 2 | 0.230000 | 0.120000 | -0.110000 |
| 3 | 0.256000 | 0.149000 | -0.107000 |
| 4 | 0.257000 | 0.147000 | -0.110000 |
| 5 | 0.256000 | 0.147000 | -0.109000 |
| 6 | 0.267000 | 0.148000 | -0.119000 |
| 7 | 0.267000 | 0.166000 | -0.101000 |
| 8 | 0.266000 | 0.182000 | -0.084000 |
| 9 | 0.269000 | 0.166000 | -0.103000 |
| 10 | 0.267000 | 0.164000 | -0.103000 |
| 11 | 0.269000 | 0.165000 | -0.104000 |
| 12 | 0.270000 | 0.164000 | -0.106000 |

## Supporting metrics 2–5

### 2. Sustained late-rep (last 4 complete pairs)
- N=4  median A=`0.269000`  median B=`0.164500`  HL(B−A)=`-0.103750`

### 3. J/token
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`0.0588944`  median B=`0.112791`  HL(B−A)=`0.0654993`

### 4. Max battery temperature
- N=12 pairs [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]  median A=`40`  median B=`39.8`  HL(B−A)=`-0.05`

### 5. TTFT proxy (first measured run of each arm)
- first A `p01_A` ttft_s=`11.48`
- first B `p01_B` ttft_s=`10.798`

