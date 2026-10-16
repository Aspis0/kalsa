# Learning-governor Stage 0 replay - lfm2.5-2.6b on SM8650

Source `../../xiaomi-stage0-obs-aa789620/raw/observations.jsonl`: 8 rows, 8 used, 0 gap rows dropped, 324 window samples.
Producer: binding pin `861a3cc3e638ac73c447b0c0406ebf1e23b3a47f`; state {FAST, WARM}, source {battery}, rule {heat_rank}.

## 1. Rows, legs and speed

| row | turn | round | pred_n | win | wall min | paced tok | decode tok/s | pps | wake win | h_wake | skin_wake C | h_first | h_last | blind | y C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 551 | 18 | 0.51 | 44 | npu 19.35 | 17.86 | 11 | 0.0087 | 36.8 | 0.0000 | 0.0596 | 11 | 1.53 |
| 1 | 1 | 1 | 1646 | 52 | 2.38 | 1647 | npu 16.05 | 11.53 | 0 | 0.0596 | 38.3 | 0.0596 | 0.1244 | 0 | 1.94 |
| 2 | 1 | 2 | 1160 | 37 | 2.66 | 1161 | npu 13.82 | 7.27 | 0 | 0.1253 | 40.3 | 0.1253 | 0.1461 | 0 | 0.62 |
| 3 | 2 | 0 | 1295 | 41 | 3.57 | 1296 | npu 14.08 | 6.05 | 0 | 0.0982 | 39.4 | 0.0982 | 0.1728 | 0 | 2.24 |
| 4 | 3 | 0 | 1135 | 36 | 4.05 | 1136 | npu 11.66 | 4.68 | 0 | 0.1215 | 40.1 | 0.1215 | 0.1668 | 0 | 1.36 |
| 5 | 4 | 0 | 1519 | 48 | 6.56 | 1520 | npu 10.44 | 3.86 | 0 | 0.1219 | 40.2 | 0.1219 | 0.1659 | 0 | 1.32 |
| 6 | 5 | 0 | 1327 | 42 | 6.05 | 1328 | npu 9.39 | 3.66 | 0 | 0.1196 | 40.1 | 0.1196 | 0.1608 | 0 | 1.24 |
| 7 | 6 | 0 | 1588 | 50 | 8.37 | 1589 | npu 8.38 | 3.17 | 0 | 0.1169 | 40.0 | 0.1169 | 0.1619 | 0 | 1.35 |

Per-leg speed is `tok x 1e6 / us` (DESIGN 3.3). The ring's boundary steps across all rows: 32 tokens.
**DESIGN 3.4 criterion 3 (speed attribution):** 0/8 rows are unpaced 100 % NPU rows; 8/8 rows had `paced.tok > 0`.
No unpaced 100 % NPU row exists in these rows, so the criterion is NOT TESTED here (a paced row's tok/s is below `pps` by construction and would refute nothing).

## 2. Derived wake start and tokens from the wake

The wake is the first window whose forecast headroom is `> 0`: `h == 0` is blind (a real reading) and `h == null` is an absent forecast, and only the transition out of blind defines a wake. A window's tokens are the difference of consecutive cumulative boundaries, attributed to the leg of its END boundary (`leg_prev`).

| row | wake win | blind win | absent win | npu tok | gpu tok | cpu tok | coolmode tok | unattr tok | window tok | decode tok | window coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 11 | 11 | 0 | 192 | 0 | 0 | 0 | 0 | 544 | 552 | 98.6 % |
| 1 | 0 | 0 | 0 | 1632 | 0 | 0 | 0 | 0 | 1632 | 1647 | 99.1 % |
| 2 | 0 | 0 | 0 | 1152 | 0 | 0 | 0 | 0 | 1152 | 1161 | 99.2 % |
| 3 | 0 | 0 | 0 | 1280 | 0 | 0 | 0 | 0 | 1280 | 1296 | 98.8 % |
| 4 | 0 | 0 | 0 | 1120 | 0 | 0 | 0 | 0 | 1120 | 1136 | 98.6 % |
| 5 | 0 | 0 | 0 | 1504 | 0 | 0 | 0 | 0 | 1504 | 1520 | 98.9 % |
| 6 | 0 | 0 | 0 | 1312 | 0 | 0 | 0 | 0 | 1312 | 1328 | 98.8 % |
| 7 | 0 | 0 | 0 | 1568 | 0 | 0 | 0 | 0 | 1568 | 1589 | 98.7 % |

From the wake, all rows: 9760 npu, 0 gpu, 0 cpu, 0 gpu-coolmode, 0 unattributed tokens. The ring stops at the last boundary, so a completion's last partial window is never in these counts - hence the coverage column below 100 %.

## 3. Freshness distributions (OPEN 2) and the wake skin (OPEN 5)

- `hf_age` per row, ms: n=8 min=94 p50=1584 p90=2654 max=2654
- window `h_age`, ms: n=324 min=94 p50=1064 p90=1812 max=2654
- window `status_age`, ms: n=324 min=58 p50=787 p90=1068 max=1773
- window `app_age`, ms: n=324 min=584 p50=106692 p90=323488 max=503264

Against the DESIGN 5.1 gates: window `h_age` above the 4000 ms forecast-read gate 0/324; window `status_age` above the 10000 ms status gate 0/324; window `app_age` above the old 120000 ms gate 148/324 and above the 1200000 ms backstop of DESIGN-ADDENDUM Item B 0/324.

Wake skin (AOSP map skin = 36.5 + 30 h): skin at the wake sample, C: n=8 min=36.8 p50=40.0 p90=40.3 max=40.3.
OPEN 5 test - rows with `h_first == 0` and `h_last > 0`: 1/8 rows, carrying 7 window(s) reading strictly between 0 and 0.083 (`headroomAt(39.0 C, 66.5)`, the Stage 0b start line).
The row field `hl` is the forecast the policy last read, and the policy keeps reading after the ring's last boundary: identical on 1 of the 8 comparable rows and within 0.016 C on every one of them (the signs differ because the forecast keeps moving after the boundary).

## 4. Forecast noise (OPEN 3)

Per-row detrended noise sigma, C (NPU-only rows): n=8 min=0.0571 p50=0.2933 p90=0.4290 max=0.4290 over 8 rows.
Successive |delta h| per window, C (upper bound): n=305 min=0.0001 p50=0.0260 p90=0.1928 max=0.5426.

Blind (`h == 0`) and absent (`h == null`) windows are excluded from both lines: a floor is not a reading. 305 of the windows supplied a successive difference.

The successive difference mixes real heating with forecast noise, so it is an upper bound and not a noise measurement; the detrended residual of each row's own trend is the noise. Over 8 NPU-only rows the median sigma is 0.2933 C (worst row 0.4290 C) - above the DESIGN 5.6 residual-sigma floor of 0.2 C, as an ESTIMATE over 8 rows, not a determination of the forecast's true noise. Closing this item needs rows whose forecast is quiet - a cold or idle stretch, where the trend is small enough for the residual to mean what it says.

## 5. Zone hot temperatures and trip ranges

| leg | rise pairs | dark-zone pairs dropped | rise min C | rise max C | observed hot max C |
| --- | --- | --- | --- | --- | --- |
| cpu | 316 | 0 | -13.40 | 18.10 | 65.2 |
| gpu | 316 | 0 | -5.10 | 4.40 | 58.0 |
| npu | 316 | 0 | -5.50 | 3.50 | 71.1 |

A null zone temperature is a dark zone (one dark zone makes the whole leg unknown), so that pair is dropped from zone statistics rather than counted as a zero rise. A row's first pair mixes the first decode step's own idle sample with the first loaded window, which is where the largest single rise comes from.
Trip ranges `[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]` in C: every row `[60.0, 115.0, 100.0, 100.0, 95.0, 95.0]`. A null entry is a leg whose zones the phone does not report.

## 6. Battery sysfs vs BatteryManager (OPEN 4)

Probe readable on 0/8 rows for temp, 0/8 for status. Compared: 0 temperatures, 0 statuses.
Nothing to compare: the probe answered on no row, so the 0.5 C and 95 % criteria are untested rather than passed.

**Verdict: OPEN 4 answered negatively on these rows: the probe read neither value.**

## 7. Heat fit of DESIGN 5.6, and the collinearity of OPEN 6

Rows entering the fit: 8/8. Excluded: 0.

Target `y = 30 x (h_last - h_wake)` in C (the platform forecast's implied skin change over the observed span), with per-leg tokens counted from the wake, per DESIGN 5.6's "observation from the wake sample". `prefill_gpu_k` counts the prompt tokens only when every prefill chunk named a GPU device; with the device labels absent it is 0, which is why it is not identifiable below.

| column | unit | coefficient | same fit without cool |
| --- | --- | --- | --- |
| npu_k | C per 1k NPU tokens | -0.539 | 0.198 |
| gpu_k | C per 1k GPU tokens | not identifiable | not identifiable |
| cpu_k | C per 1k CPU tokens | not identifiable | not identifiable |
| prompt_k | C per 1k prompt tokens | -0.164 | -0.126 |
| prefill_gpu_k | C per 1k GPU-prefilled prompt tokens | not identifiable | not identifiable |
| wall_min | C per completion minute | 1.188 | -0.038 |
| cool | C per (-h_wake x wall_min) | 8.752 | - |

- rank 5 of 5 columns over 8 rows; dropped as identically zero: gpu_k, cpu_k, prefill_gpu_k; residual df 3
- condition number of the scaled design matrix (s(max)/s(min)): 77.2 with the cooling column, 21.3 without it (Gram ratio, its square: 5955.9 and 453.1)
- residual sigma 0.3846 C, max |residual| 0.5095 C (sigma floor 0.2 C, outlier cut max(1.0 C, 3 sd), both from DESIGN 5.6)

**The condition-number convention**, because the number is meaningless without it: each predictor column is scaled to unit L2 norm and the intercept column is left at 1; the reported figure is the 2-norm condition number of THAT design matrix. The Gram ratio printed beside it is its square - an eigen-decomposition of X'X yields squared singular values, so a reader comparing against a design-matrix figure wants the square root.

**OPEN 6 verdict.** The design is FULL RANK (5 of 5 columns, 8 rows, 3 residual degrees of freedom) - no column is mathematically unidentifiable here - but it is ILL-CONDITIONED: condition number 77.2 against 21.3 without the cooling column. Dropping the cooling column moves `npu_k` from -0.539 to 0.198 C per 1k tokens and `wall_min` from 1.188 to -0.038 C per minute, so the cooling term and the token/time columns are fighting over the same variance: the individual coefficients are UNSTABLE ESTIMATES and none of them should be read as a heat number yet. gpu_k, cpu_k, prefill_gpu_k carry no variance on these rows and are reported as not identifiable; Stage 0 rows do not spend those tokens, so no Stage 0 row set will fix that.

## 8. Per-device prefill attribution (M4 row fields)

0/8 rows carry `prefill_ms`; the other 8 were written before the M4 builder and name no prefill time or device. Device cases over all rows: gpu 0, npu 0, mixed 0, absent 8.

No row carries both a prefill time and a device label, so there is no per-device rate to report: an absent rate is not a zero rate.


`engine_prefill` is the ROUTE's label and `prefill_dev` the device that ran the layers: a phone NPU load reads `GPU` on the route while Hexagon runs the matmuls, so the heat question needs the device column. `prompt_n` is what each completion reported, so a cached prefix is counted once per round.

## 9. What this replay cannot measure

**GPU overshoot: not measurable - and NOT because GPU windows are absent.** These rows do carry GPU activity: 0 GPU window(s) and 0 GPU token(s) from the wake. What is missing is the thing an overshoot is measured *against*: a Stage 3 speed pass. AUDIT-3 restricted Stage 0 to what today's decisions produce, and today's HEAT_RANK is what picked those GPU legs - there is no `speed_fit` prediction of what those tokens should have cost, so there is nothing to be over. More Stage 0 rows cannot produce one; the number waits for Stage 3 Check B.

## 10. OPEN verdicts from these rows

| OPEN | question | verdict |
| --- | --- | --- |
| 2 | forecast read age in practice (the 4 s gate) | max window `h_age` 2654 ms over 324 windows, 0 above the gate: the gate holds on this arm |
| 3 | forecast noise vs the 0.2 C sigma floor | estimated over 8 NPU-only rows, blind and absent windows excluded: median detrended sigma 0.2933 C, worst row 0.4290 C - above the 0.2 C floor as an estimate, not a determination |
| 4 | battery sysfs readable in-process | OPEN 4 answered negatively on these rows: the probe read neither value |
| 5 | wake skin, and readings inside (0, 0.083) | rows with `hf == 0` and `hl > 0`: 1/8, carrying 7 window(s) inside the band; wake skin p50 40.0 C (range 36.8-40.3) |
| 6 | `bg` / cooling collinearity; is the cooling column needed | full rank 5/5 over 8 rows, residual df 3; condition number 77.2 (Gram 5955.9), 21.3 without the cooling column; 3 column(s) carry no variance - the coefficients are collinear and unstable, not identified |
