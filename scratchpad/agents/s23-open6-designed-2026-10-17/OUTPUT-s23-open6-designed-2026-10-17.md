# Learning-governor Stage 0 replay - lfm2.5-2.6b on SM8550

Source `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-open6-designed-2026-10-17/raw/observations.jsonl`: 20 rows, 20 used, 0 gap rows dropped, 613 window samples.
Producer: binding pin `df912b0e20275636817e1f4c66bb4bb9edc5a0ce`; state {FAST}, source {battery}, rule {heat_rank}.

## 1. Rows, legs and speed

| row | turn | round | pred_n | win | wall min | paced tok | decode tok/s | pps | wake win | h_wake | skin_wake C | h_first | h_last | blind | y C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 445 | 14 | 0.76 | 0 | npu 10.41 | 9.84 | 0 | 0.6967 | 57.4 | 0.6967 | 0.7331 | 0 | 1.09 |
| 1 | 2 | 0 | 719 | 23 | 1.31 | 0 | npu 9.77 | 9.16 | 0 | 0.6967 | 57.4 | 0.6967 | 0.7698 | 0 | 2.19 |
| 2 | 3 | 0 | 1342 | 42 | 2.52 | 0 | npu 9.37 | 8.87 | 0 | 0.7367 | 58.6 | 0.7367 | 0.8400 | 0 | 3.10 |
| 3 | 4 | 0 | 1716 | 54 | 3.42 | 533 | npu 9.02 | 8.37 | 0 | 0.7800 | 59.9 | 0.7800 | 0.8867 | 0 | 3.20 |
| 4 | 5 | 0 | 449 | 15 | 0.76 | 0 | npu 10.41 | 9.85 | 0 | 0.7199 | 58.1 | 0.7199 | 0.7766 | 0 | 1.70 |
| 5 | 6 | 0 | 1458 | 46 | 2.74 | 0 | npu 9.35 | 8.89 | 0 | 0.6967 | 57.4 | 0.6967 | 0.8233 | 0 | 3.80 |
| 6 | 7 | 0 | 1206 | 38 | 2.24 | 0 | npu 9.48 | 8.98 | 0 | 0.7500 | 59.0 | 0.7500 | 0.8599 | 0 | 3.30 |
| 7 | 8 | 0 | 1127 | 36 | 2.05 | 80 | npu 9.65 | 9.15 | 0 | 0.7767 | 59.8 | 0.7767 | 0.8733 | 0 | 2.90 |
| 8 | 9 | 0 | 484 | 16 | 0.85 | 0 | npu 10.07 | 9.46 | 0 | 0.7933 | 60.3 | 0.7933 | 0.8466 | 0 | 1.60 |
| 9 | 10 | 0 | 439 | 14 | 0.75 | 0 | npu 10.41 | 9.84 | 0 | 0.7133 | 57.9 | 0.7133 | 0.7698 | 0 | 1.69 |
| 10 | 11 | 0 | 1610 | 51 | 3.07 | 0 | npu 9.19 | 8.74 | 0 | 0.7200 | 58.1 | 0.7200 | 0.8566 | 0 | 4.10 |
| 11 | 12 | 0 | 459 | 15 | 0.80 | 0 | npu 10.13 | 9.52 | 0 | 0.7967 | 60.4 | 0.7967 | 0.8432 | 0 | 1.40 |
| 12 | 13 | 0 | 1329 | 42 | 2.47 | 0 | npu 9.46 | 8.97 | 0 | 0.7133 | 57.9 | 0.7133 | 0.8367 | 0 | 3.70 |
| 13 | 14 | 0 | 416 | 14 | 0.72 | 0 | npu 10.29 | 9.68 | 0 | 0.7333 | 58.5 | 0.7333 | 0.7899 | 0 | 1.70 |
| 14 | 15 | 0 | 425 | 14 | 0.74 | 0 | npu 10.24 | 9.62 | 0 | 0.7433 | 58.8 | 0.7433 | 0.7966 | 0 | 1.60 |
| 15 | 16 | 0 | 420 | 14 | 0.71 | 0 | npu 10.46 | 9.91 | 0 | 0.7200 | 58.1 | 0.7200 | 0.7865 | 0 | 2.00 |
| 16 | 17 | 0 | 569 | 18 | 1.00 | 0 | npu 10.12 | 9.55 | 0 | 0.7500 | 59.0 | 0.7500 | 0.8099 | 0 | 1.80 |
| 17 | 18 | 0 | 1578 | 50 | 3.04 | 224 | npu 9.17 | 8.66 | 0 | 0.7667 | 59.5 | 0.7667 | 0.8800 | 0 | 3.40 |
| 18 | 19 | 0 | 1712 | 54 | 3.30 | 0 | npu 9.09 | 8.66 | 0 | 0.7167 | 58.0 | 0.7167 | 0.8666 | 0 | 4.50 |
| 19 | 20 | 0 | 1369 | 43 | 2.55 | 0 | npu 9.42 | 8.97 | 0 | 0.7033 | 57.6 | 0.7033 | 0.8433 | 0 | 4.20 |

Per-leg speed is `tok x 1e6 / us` (DESIGN 3.3). The ring's boundary steps across all rows: 32 tokens.
**DESIGN 3.4 criterion 3 (speed attribution):** 17/20 rows are unpaced 100 % NPU rows; 3/20 rows had `paced.tok > 0`.
| row | NPU tok/s | pps | delta | within 10 % |
| --- | --- | --- | --- | --- |
| 0 | 10.41 | 9.84 | +5.7 % | yes |
| 1 | 9.77 | 9.16 | +6.6 % | yes |
| 2 | 9.37 | 8.87 | +5.6 % | yes |
| 4 | 10.41 | 9.85 | +5.6 % | yes |
| 5 | 9.35 | 8.89 | +5.2 % | yes |
| 6 | 9.48 | 8.98 | +5.6 % | yes |
| 8 | 10.07 | 9.46 | +6.4 % | yes |
| 9 | 10.41 | 9.84 | +5.8 % | yes |
| 10 | 9.19 | 8.74 | +5.1 % | yes |
| 11 | 10.13 | 9.52 | +6.4 % | yes |
| 12 | 9.46 | 8.97 | +5.4 % | yes |
| 13 | 10.29 | 9.68 | +6.3 % | yes |
| 14 | 10.24 | 9.62 | +6.5 % | yes |
| 15 | 10.46 | 9.91 | +5.6 % | yes |
| 16 | 10.12 | 9.55 | +6.0 % | yes |
| 18 | 9.09 | 8.66 | +5.0 % | yes |
| 19 | 9.42 | 8.97 | +5.1 % | yes |
Verdict: 17/17 candidate rows within 10 %; largest |delta| 6.6 %.

## 2. Derived wake start and tokens from the wake

The wake is the first window whose forecast headroom is `> 0`: `h == 0` is blind (a real reading) and `h == null` is an absent forecast, and only the transition out of blind defines a wake. A window's tokens are the difference of consecutive cumulative boundaries, attributed to the leg of its END boundary (`leg_prev`).

| row | wake win | blind win | absent win | npu tok | gpu tok | cpu tok | coolmode tok | unattr tok | window tok | decode tok | window coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 416 | 0 | 0 | 0 | 0 | 416 | 446 | 93.3 % |
| 1 | 0 | 0 | 0 | 704 | 0 | 0 | 0 | 0 | 704 | 720 | 97.8 % |
| 2 | 0 | 0 | 0 | 1312 | 0 | 0 | 0 | 0 | 1312 | 1343 | 97.7 % |
| 3 | 0 | 0 | 0 | 1696 | 0 | 0 | 0 | 0 | 1696 | 1717 | 98.8 % |
| 4 | 0 | 0 | 0 | 448 | 0 | 0 | 0 | 0 | 448 | 450 | 99.6 % |
| 5 | 0 | 0 | 0 | 1440 | 0 | 0 | 0 | 0 | 1440 | 1459 | 98.7 % |
| 6 | 0 | 0 | 0 | 1184 | 0 | 0 | 0 | 0 | 1184 | 1207 | 98.1 % |
| 7 | 0 | 0 | 0 | 1120 | 0 | 0 | 0 | 0 | 1120 | 1128 | 99.3 % |
| 8 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 485 | 99.0 % |
| 9 | 0 | 0 | 0 | 416 | 0 | 0 | 0 | 0 | 416 | 440 | 94.5 % |
| 10 | 0 | 0 | 0 | 1600 | 0 | 0 | 0 | 0 | 1600 | 1611 | 99.3 % |
| 11 | 0 | 0 | 0 | 448 | 0 | 0 | 0 | 0 | 448 | 460 | 97.4 % |
| 12 | 0 | 0 | 0 | 1312 | 0 | 0 | 0 | 0 | 1312 | 1330 | 98.6 % |
| 13 | 0 | 0 | 0 | 416 | 0 | 0 | 0 | 0 | 416 | 417 | 99.8 % |
| 14 | 0 | 0 | 0 | 416 | 0 | 0 | 0 | 0 | 416 | 426 | 97.7 % |
| 15 | 0 | 0 | 0 | 416 | 0 | 0 | 0 | 0 | 416 | 421 | 98.8 % |
| 16 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 570 | 95.4 % |
| 17 | 0 | 0 | 0 | 1568 | 0 | 0 | 0 | 0 | 1568 | 1579 | 99.3 % |
| 18 | 0 | 0 | 0 | 1696 | 0 | 0 | 0 | 0 | 1696 | 1713 | 99.0 % |
| 19 | 0 | 0 | 0 | 1344 | 0 | 0 | 0 | 0 | 1344 | 1370 | 98.1 % |

From the wake, all rows: 18976 npu, 0 gpu, 0 cpu, 0 gpu-coolmode, 0 unattributed tokens. The ring stops at the last boundary, so a completion's last partial window is never in these counts - hence the coverage column below 100 %.

## 3. Freshness distributions (OPEN 2) and the wake skin (OPEN 5)

- `hf_age` per row, ms: n=20 min=252 p50=1633 p90=1676 max=1682
- window `h_age`, ms: n=613 min=100 p50=1196 p90=1950 max=2122
- window `status_age`, ms: n=613 min=97 p50=569 p90=995 max=1119
- window `app_age`, ms: n=613 min=268 p50=52962 p90=142210 max=205993

Against the DESIGN 5.1 gates: window `h_age` above the 4000 ms forecast-read gate 0/613; window `status_age` above the 10000 ms status gate 0/613; window `app_age` above the old 120000 ms gate 113/613 and above the 1200000 ms backstop of DESIGN-ADDENDUM Item B 0/613.

Wake skin (AOSP map skin = 36.5 + 30 h): skin at the wake sample, C: n=20 min=57.4 p50=58.1 p90=59.9 max=60.4.
OPEN 5 test - rows with `h_first == 0` and `h_last > 0`: 0/20 rows, carrying 0 window(s) reading strictly between 0 and 0.083 (`headroomAt(39.0 C, 66.5)`, the Stage 0b start line).
The row field `hl` is the forecast the policy last read, and the policy keeps reading after the ring's last boundary: identical on 4 of the 20 comparable rows and within 0.503 C on every one of them (the signs differ because the forecast keeps moving after the boundary).

## 4. Forecast noise (OPEN 3)

Per-row detrended noise sigma, C (NPU-only rows): n=20 min=0.0868 p50=0.1341 p90=0.2434 max=0.2865 over 20 rows.
Successive |delta h| per window, C (upper bound): n=593 min=0.0000 p50=0.0022 p90=0.3027 max=0.5997.

Blind (`h == 0`) and absent (`h == null`) windows are excluded from both lines: a floor is not a reading. 593 of the windows supplied a successive difference.

The successive difference mixes real heating with forecast noise, so it is an upper bound and not a noise measurement; the detrended residual of each row's own trend is the noise. Over 20 NPU-only rows the median sigma is 0.1341 C (worst row 0.2865 C) - at or under the DESIGN 5.6 residual-sigma floor of 0.2 C, as an ESTIMATE over 20 rows, not a determination of the forecast's true noise. Closing this item needs rows whose forecast is quiet - a cold or idle stretch, where the trend is small enough for the residual to mean what it says.

## 5. Zone hot temperatures and trip ranges

| leg | rise pairs | dark-zone pairs dropped | rise min C | rise max C | observed hot max C |
| --- | --- | --- | --- | --- | --- |
| cpu | 593 | 0 | -9.90 | 10.70 | 63.2 |
| gpu | 593 | 0 | -1.60 | 6.70 | 56.3 |
| npu | 593 | 0 | -4.00 | 7.50 | 65.3 |

A null zone temperature is a dark zone (one dark zone makes the whole leg unknown), so that pair is dropped from zone statistics rather than counted as a zero rise. A row's first pair mixes the first decode step's own idle sample with the first loaded window, which is where the largest single rise comes from.
Trip ranges `[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]` in C: every row `[108.0, 115.0, 95.0, 95.0, 95.0, 95.0]`. A null entry is a leg whose zones the phone does not report.

## 6. Battery sysfs vs BatteryManager (OPEN 4)

Probe readable on 0/20 rows for temp, 0/20 for status. Compared: 0 temperatures, 0 statuses.
Nothing to compare: the probe answered on no row, so the 0.5 C and 95 % criteria are untested rather than passed.

**Verdict: OPEN 4 answered negatively on these rows: the probe read neither value.**

## 7. Heat fit of DESIGN 5.6, and the collinearity of OPEN 6

Rows entering the fit: 20/20. Excluded: 0.

Target `y = 30 x (h_last - h_wake)` in C (the platform forecast's implied skin change over the observed span), with per-leg tokens counted from the wake, per DESIGN 5.6's "observation from the wake sample". `prefill_gpu_k` counts the prompt tokens only when every prefill chunk named a GPU device; with the device labels absent it is 0, which is why it is not identifiable below.

| column | unit | coefficient | same fit without cool |
| --- | --- | --- | --- |
| npu_k | C per 1k NPU tokens | 9.720 | 12.262 |
| gpu_k | C per 1k GPU tokens | not identifiable | not identifiable |
| cpu_k | C per 1k CPU tokens | not identifiable | not identifiable |
| prompt_k | C per 1k prompt tokens | 0.005 | -0.079 |
| prefill_gpu_k | C per 1k GPU-prefilled prompt tokens | not identifiable | not identifiable |
| wall_min | C per completion minute | -1.520 | -5.150 |
| cool | C per (-h_wake x wall_min) | 3.190 | - |

- rank 5 of 5 columns over 20 rows; dropped as identically zero: gpu_k, cpu_k, prefill_gpu_k; residual df 15
- condition number of the scaled design matrix (s(max)/s(min)): 460.5 with the cooling column, 388.1 without it (Gram ratio, its square: 212055.1 and 150610.1)
- residual sigma 0.2295 C, max |residual| 0.4637 C (sigma floor 0.2 C, outlier cut max(1.0 C, 3 sd), both from DESIGN 5.6)

**The condition-number convention**, because the number is meaningless without it: each predictor column is scaled to unit L2 norm and the intercept column is left at 1; the reported figure is the 2-norm condition number of THAT design matrix. The Gram ratio printed beside it is its square - an eigen-decomposition of X'X yields squared singular values, so a reader comparing against a design-matrix figure wants the square root.

**OPEN 6 verdict.** The design is FULL RANK (5 of 5 columns, 20 rows, 15 residual degrees of freedom) - no column is mathematically unidentifiable here - but it is ILL-CONDITIONED: condition number 460.5 against 388.1 without the cooling column. Dropping the cooling column moves `npu_k` from 9.720 to 12.262 C per 1k tokens and `wall_min` from -1.520 to -5.150 C per minute, so the cooling term and the token/time columns are fighting over the same variance: the individual coefficients are UNSTABLE ESTIMATES and none of them should be read as a heat number yet. gpu_k, cpu_k, prefill_gpu_k carry no variance on these rows and are reported as not identifiable; Stage 0 rows do not spend those tokens, so no Stage 0 row set will fix that.

## 8. Per-device prefill attribution (M4 row fields)

20/20 rows carry `prefill_ms`; the other 0 were written before the M4 builder and name no prefill time or device. Device cases over all rows: gpu 0, npu 20, mixed 0, absent 0.

Per DEVICE, because the device is what the heat question asks about. Each row contributes only its own `prompt_n` and its own `prefill_ms`:

| device | rows | prompt tok | prefill ms | prefill tok/s |
| --- | --- | --- | --- | --- |
| npu | 20 | 22086 | 41192 | 536.2 |

The rows that carry the fields, each on its own:

| row | turn | route label | device(s) | prompt tok | prefill ms | prefill tok/s |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | NPU | HTP0 | 62 | 248 | 249.5 |
| 1 | 2 | NPU | HTP0 | 2143 | 3866 | 554.3 |
| 2 | 3 | NPU | HTP0 | 2147 | 3868 | 555.1 |
| 3 | 4 | NPU | HTP0 | 2147 | 3873 | 554.3 |
| 4 | 5 | NPU | HTP0 | 62 | 248 | 250.0 |
| 5 | 6 | NPU | HTP0 | 66 | 260 | 253.9 |
| 6 | 7 | NPU | HTP0 | 2147 | 3880 | 553.4 |
| 7 | 8 | NPU | HTP0 | 66 | 260 | 254.0 |
| 8 | 9 | NPU | HTP0 | 2143 | 3871 | 553.6 |
| 9 | 10 | NPU | HTP0 | 62 | 248 | 249.9 |
| 10 | 11 | NPU | HTP0 | 66 | 259 | 255.2 |
| 11 | 12 | NPU | HTP0 | 2143 | 3859 | 555.3 |
| 12 | 13 | NPU | HTP0 | 66 | 259 | 254.6 |
| 13 | 14 | NPU | HTP0 | 2143 | 3858 | 555.4 |
| 14 | 15 | NPU | HTP0 | 2143 | 3875 | 553.0 |
| 15 | 16 | NPU | HTP0 | 62 | 248 | 249.5 |
| 16 | 17 | NPU | HTP0 | 2143 | 3862 | 554.9 |
| 17 | 18 | NPU | HTP0 | 2147 | 3841 | 559.0 |
| 18 | 19 | NPU | HTP0 | 66 | 259 | 254.6 |
| 19 | 20 | NPU | HTP0 | 62 | 248 | 249.9 |

- route NPU, layers on HTP0

`engine_prefill` is the ROUTE's label and `prefill_dev` the device that ran the layers: a phone NPU load reads `GPU` on the route while Hexagon runs the matmuls, so the heat question needs the device column. `prompt_n` is what each completion reported, so a cached prefix is counted once per round.

## 9. What this replay cannot measure

**GPU overshoot: not measurable - and NOT because GPU windows are absent.** These rows do carry GPU activity: 0 GPU window(s) and 0 GPU token(s) from the wake. What is missing is the thing an overshoot is measured *against*: a Stage 3 speed pass. AUDIT-3 restricted Stage 0 to what today's decisions produce, and today's HEAT_RANK is what picked those GPU legs - there is no `speed_fit` prediction of what those tokens should have cost, so there is nothing to be over. More Stage 0 rows cannot produce one; the number waits for Stage 3 Check B.

## 10. OPEN verdicts from these rows

| OPEN | question | verdict |
| --- | --- | --- |
| 2 | forecast read age in practice (the 4 s gate) | max window `h_age` 2122 ms over 613 windows, 0 above the gate: the gate holds on this arm |
| 3 | forecast noise vs the 0.2 C sigma floor | estimated over 20 NPU-only rows, blind and absent windows excluded: median detrended sigma 0.1341 C, worst row 0.2865 C - at or under the 0.2 C floor as an estimate, not a determination |
| 4 | battery sysfs readable in-process | OPEN 4 answered negatively on these rows: the probe read neither value |
| 5 | wake skin, and readings inside (0, 0.083) | rows with `hf == 0` and `hl > 0`: 0/20, carrying 0 window(s) inside the band; wake skin p50 58.1 C (range 57.4-60.4) |
| 6 | `bg` / cooling collinearity; is the cooling column needed | full rank 5/5 over 20 rows, residual df 15; condition number 460.5 (Gram 212055.1), 388.1 without the cooling column; 3 column(s) carry no variance - the coefficients are collinear and unstable, not identified |
