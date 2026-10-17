# Learning-governor Stage 0 replay - lfm2.5-2.6b on SM8650

Source `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/xiaomi-obs-20-2026-10-17/raw/observations.jsonl`: 26 rows, 26 used, 0 gap rows dropped, 348 window samples.
Producer: binding pin `d4754cb564d42d52381098e810396dcf88fa5d8e`; state {FAST, WARM}, source {battery}, rule {heat_rank}.

## 1. Rows, legs and speed

| row | turn | round | pred_n | win | wall min | paced tok | decode tok/s | pps | wake win | h_wake | skin_wake C | h_first | h_last | blind | y C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 459 | 15 | 0.50 | 5 | npu 16.43 | 15.23 | 2 | 0.0026 | 36.6 | 0.0000 | 0.0821 | 2 | 2.38 |
| 1 | 2 | 0 | 477 | 15 | 0.59 | 0 | npu 14.42 | 13.50 | 0 | 0.0065 | 36.7 | 0.0065 | 0.0738 | 1 | 2.02 |
| 2 | 3 | 0 | 205 | 7 | 0.26 | 0 | npu 13.98 | 13.13 | 0 | 0.0156 | 37.0 | 0.0156 | 0.0358 | 0 | 0.61 |
| 3 | 4 | 0 | 345 | 11 | 0.45 | 0 | npu 13.61 | 12.80 | 0 | 0.0088 | 36.8 | 0.0088 | 0.0544 | 0 | 1.37 |
| 4 | 5 | 0 | 574 | 18 | 0.71 | 0 | npu 14.88 | 13.55 | 3 | 0.0011 | 36.5 | 0.0000 | 0.0646 | 3 | 1.90 |
| 5 | 6 | 0 | 362 | 12 | 0.45 | 0 | npu 14.37 | 13.45 | 0 | 0.0117 | 36.9 | 0.0117 | 0.0707 | 0 | 1.77 |
| 6 | 7 | 0 | 401 | 13 | 0.52 | 6 | npu 13.85 | 12.97 | 0 | 0.0191 | 37.1 | 0.0191 | 0.0827 | 0 | 1.91 |
| 7 | 8 | 0 | 511 | 16 | 0.71 | 216 | npu 13.32 | 12.09 | 0 | 0.0336 | 37.5 | 0.0336 | 0.1048 | 0 | 2.14 |
| 8 | 9 | 0 | 764 | 24 | 1.03 | 477 | npu 14.55 | 12.32 | 0 | 0.0336 | 37.5 | 0.0336 | 0.1116 | 0 | 2.34 |
| 9 | 10 | 0 | 336 | 11 | 0.44 | 142 | npu 14.14 | 12.66 | 0 | 0.0563 | 38.2 | 0.0563 | 0.1121 | 0 | 1.67 |
| 10 | 11 | 0 | 701 | 22 | 1.08 | 494 | npu 13.52 | 10.84 | 0 | 0.0578 | 38.2 | 0.0578 | 0.1290 | 0 | 2.14 |
| 11 | 12 | 0 | 101 | 4 | 0.14 | 0 | npu 13.14 | 12.36 | 0 | 0.0739 | 38.7 | 0.0739 | 0.0736 | 0 | -0.01 |
| 12 | 13 | 0 | 149 | 5 | 0.19 | 0 | npu 14.94 | 13.14 | 0 | 0.0516 | 38.0 | 0.0516 | 0.0705 | 0 | 0.57 |
| 13 | 13 | 1 | 98 | 4 | 0.13 | 50 | npu 14.88 | 12.93 | 0 | 0.0764 | 38.8 | 0.0764 | 0.0893 | 0 | 0.39 |
| 14 | 13 | 2 | 64 | 3 | 0.08 | 65 | npu 14.63 | 13.05 | 0 | 0.0937 | 39.3 | 0.0937 | 0.1010 | 0 | 0.22 |
| 15 | 14 | 0 | 102 | 4 | 0.12 | 236 | npu 14.53 | 14.02 | 0 | 0.0800 | 38.9 | 0.0800 | 0.0816 | 0 | 0.05 |
| 16 | 14 | 1 | 67 | 3 | 0.08 | 54 | npu 15.20 | 13.37 | 0 | 0.0816 | 38.9 | 0.0816 | 0.0966 | 0 | 0.45 |
| 17 | 14 | 2 | 59 | 2 | 0.08 | 60 | npu 15.00 | 12.72 | 0 | 0.1027 | 39.6 | 0.1027 | 0.1087 | 0 | 0.18 |
| 18 | 15 | 0 | 384 | 13 | 0.88 | 1224 | npu 14.27 | 7.31 | 0 | 0.1338 | 40.5 | 0.1338 | 0.1601 | 0 | 0.79 |
| 19 | 16 | 0 | 493 | 16 | 1.05 | 494 | npu 12.24 | 7.81 | 0 | 0.1208 | 40.1 | 0.1208 | 0.1554 | 0 | 1.04 |
| 20 | 17 | 0 | 535 | 17 | 0.96 | 536 | npu 13.30 | 9.34 | 0 | 0.0898 | 39.2 | 0.0898 | 0.1480 | 0 | 1.75 |
| 21 | 18 | 0 | 1317 | 42 | 2.68 | 1318 | npu 12.58 | 8.20 | 0 | 0.0905 | 39.2 | 0.0905 | 0.1567 | 0 | 1.99 |
| 22 | 19 | 0 | 471 | 15 | 0.98 | 472 | npu 12.27 | 8.04 | 0 | 0.1059 | 39.7 | 0.1059 | 0.1511 | 0 | 1.36 |
| 23 | 20 | 0 | 584 | 19 | 1.25 | 585 | npu 11.77 | 7.82 | 0 | 0.1014 | 39.5 | 0.1014 | 0.1508 | 0 | 1.48 |
| 24 | 21 | 0 | 522 | 17 | 0.97 | 523 | npu 13.31 | 8.98 | 0 | 0.1023 | 39.6 | 0.1023 | 0.1518 | 0 | 1.48 |
| 25 | 22 | 0 | 624 | 20 | 1.21 | 625 | npu 13.00 | 8.58 | 0 | 0.1001 | 39.5 | 0.1001 | 0.1532 | 0 | 1.59 |

Per-leg speed is `tok x 1e6 / us` (DESIGN 3.3). The ring's boundary steps across all rows: 32 tokens.
**DESIGN 3.4 criterion 3 (speed attribution):** 7/26 rows are unpaced 100 % NPU rows; 19/26 rows had `paced.tok > 0`.
| row | NPU tok/s | pps | delta | within 10 % |
| --- | --- | --- | --- | --- |
| 1 | 14.42 | 13.50 | +6.8 % | yes |
| 2 | 13.98 | 13.13 | +6.5 % | yes |
| 3 | 13.61 | 12.80 | +6.3 % | yes |
| 4 | 14.88 | 13.55 | +9.8 % | yes |
| 5 | 14.37 | 13.45 | +6.8 % | yes |
| 11 | 13.14 | 12.36 | +6.3 % | yes |
| 12 | 14.94 | 13.14 | +13.7 % | NO |
Verdict: 6/7 candidate rows within 10 %; largest |delta| 13.7 %.

## 2. Derived wake start and tokens from the wake

The wake is the first window whose forecast headroom is `> 0`: `h == 0` is blind (a real reading) and `h == null` is an absent forecast, and only the transition out of blind defines a wake. A window's tokens are the difference of consecutive cumulative boundaries, attributed to the leg of its END boundary (`leg_prev`).

| row | wake win | blind win | absent win | npu tok | gpu tok | cpu tok | coolmode tok | unattr tok | window tok | decode tok | window coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 2 | 2 | 0 | 384 | 0 | 0 | 0 | 0 | 448 | 460 | 97.4 % |
| 1 | 0 | 1 | 0 | 448 | 0 | 0 | 0 | 0 | 448 | 478 | 93.7 % |
| 2 | 0 | 0 | 0 | 192 | 0 | 0 | 0 | 0 | 192 | 206 | 93.2 % |
| 3 | 0 | 0 | 0 | 320 | 0 | 0 | 0 | 0 | 320 | 346 | 92.5 % |
| 4 | 3 | 3 | 0 | 448 | 0 | 0 | 0 | 0 | 544 | 575 | 94.6 % |
| 5 | 0 | 0 | 0 | 352 | 0 | 0 | 0 | 0 | 352 | 363 | 97.0 % |
| 6 | 0 | 0 | 0 | 384 | 0 | 0 | 0 | 0 | 384 | 402 | 95.5 % |
| 7 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 512 | 93.8 % |
| 8 | 0 | 0 | 0 | 736 | 0 | 0 | 0 | 0 | 736 | 765 | 96.2 % |
| 9 | 0 | 0 | 0 | 320 | 0 | 0 | 0 | 0 | 320 | 337 | 95.0 % |
| 10 | 0 | 0 | 0 | 672 | 0 | 0 | 0 | 0 | 672 | 702 | 95.7 % |
| 11 | 0 | 0 | 0 | 96 | 0 | 0 | 0 | 0 | 96 | 102 | 94.1 % |
| 12 | 0 | 0 | 0 | 128 | 0 | 0 | 0 | 0 | 128 | 150 | 85.3 % |
| 13 | 0 | 0 | 0 | 96 | 0 | 0 | 0 | 0 | 96 | 99 | 97.0 % |
| 14 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 65 | 98.5 % |
| 15 | 0 | 0 | 0 | 96 | 0 | 0 | 0 | 0 | 96 | 339 | 28.3 % |
| 16 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 68 | 94.1 % |
| 17 | 0 | 0 | 0 | 32 | 0 | 0 | 0 | 0 | 32 | 60 | 53.3 % |
| 18 | 0 | 0 | 0 | 384 | 0 | 0 | 0 | 0 | 384 | 1224 | 31.4 % |
| 19 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 494 | 97.2 % |
| 20 | 0 | 0 | 0 | 512 | 0 | 0 | 0 | 0 | 512 | 536 | 95.5 % |
| 21 | 0 | 0 | 0 | 1312 | 0 | 0 | 0 | 0 | 1312 | 1318 | 99.5 % |
| 22 | 0 | 0 | 0 | 448 | 0 | 0 | 0 | 0 | 448 | 472 | 94.9 % |
| 23 | 0 | 0 | 0 | 576 | 0 | 0 | 0 | 0 | 576 | 585 | 98.5 % |
| 24 | 0 | 0 | 0 | 512 | 0 | 0 | 0 | 0 | 512 | 523 | 97.9 % |
| 25 | 0 | 0 | 0 | 608 | 0 | 0 | 0 | 0 | 608 | 625 | 97.3 % |

From the wake, all rows: 10144 npu, 0 gpu, 0 cpu, 0 gpu-coolmode, 0 unattributed tokens. The ring stops at the last boundary, so a completion's last partial window is never in these counts - hence the coverage column below 100 %.

## 3. Freshness distributions (OPEN 2) and the wake skin (OPEN 5)

- `hf_age` per row, ms: n=26 min=173 p50=571 p90=1417 max=3094
- window `h_age`, ms: n=348 min=71 p50=1085 p90=1895 max=3094
- window `status_age`, ms: n=348 min=61 p50=544 p90=1032 max=2072
- window `app_age`, ms: n=348 min=163 p50=22256 p90=60826 max=163688

Against the DESIGN 5.1 gates: window `h_age` above the 4000 ms forecast-read gate 0/348; window `status_age` above the 10000 ms status gate 0/348; window `app_age` above the old 120000 ms gate 11/348 and above the 1200000 ms backstop of DESIGN-ADDENDUM Item B 0/348.

Wake skin (AOSP map skin = 36.5 + 30 h): skin at the wake sample, C: n=26 min=36.5 p50=38.7 p90=39.7 max=40.5.
OPEN 5 test - rows with `h_first == 0` and `h_last > 0`: 2/26 rows, carrying 28 window(s) reading strictly between 0 and 0.083 (`headroomAt(39.0 C, 66.5)`, the Stage 0b start line).
The row field `hl` is the forecast the policy last read, and the policy keeps reading after the ring's last boundary: identical on 10 of the 26 comparable rows and within 0.168 C on every one of them (the signs differ because the forecast keeps moving after the boundary).

## 4. Forecast noise (OPEN 3)

Per-row detrended noise sigma, C (NPU-only rows): n=25 min=0.0042 p50=0.1281 p90=0.2689 max=0.2927 over 26 rows.
Successive |delta h| per window, C (upper bound): n=315 min=0.0002 p50=0.1174 p90=0.2574 max=0.4155.

Blind (`h == 0`) and absent (`h == null`) windows are excluded from both lines: a floor is not a reading. 315 of the windows supplied a successive difference.

The successive difference mixes real heating with forecast noise, so it is an upper bound and not a noise measurement; the detrended residual of each row's own trend is the noise. Over 26 NPU-only rows the median sigma is 0.1281 C (worst row 0.2927 C) - at or under the DESIGN 5.6 residual-sigma floor of 0.2 C, as an ESTIMATE over 26 rows, not a determination of the forecast's true noise. Closing this item needs rows whose forecast is quiet - a cold or idle stretch, where the trend is small enough for the residual to mean what it says.

## 5. Zone hot temperatures and trip ranges

| leg | rise pairs | dark-zone pairs dropped | rise min C | rise max C | observed hot max C |
| --- | --- | --- | --- | --- | --- |
| cpu | 322 | 0 | -5.90 | 7.00 | 56.9 |
| gpu | 322 | 0 | -1.60 | 4.70 | 53.6 |
| npu | 322 | 0 | -2.00 | 7.10 | 60.5 |

A null zone temperature is a dark zone (one dark zone makes the whole leg unknown), so that pair is dropped from zone statistics rather than counted as a zero rise. A row's first pair mixes the first decode step's own idle sample with the first loaded window, which is where the largest single rise comes from.
Trip ranges `[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]` in C: every row `[60.0, 115.0, 100.0, 100.0, 95.0, 95.0]`. A null entry is a leg whose zones the phone does not report.

## 6. Battery sysfs vs BatteryManager (OPEN 4)

Probe readable on 0/26 rows for temp, 0/26 for status. Compared: 0 temperatures, 0 statuses.
Nothing to compare: the probe answered on no row, so the 0.5 C and 95 % criteria are untested rather than passed.

**Verdict: OPEN 4 answered negatively on these rows: the probe read neither value.**

## 7. Heat fit of DESIGN 5.6, and the collinearity of OPEN 6

Rows entering the fit: 25/26. Excluded: 1 - censored: blind window (h == 0) inside the observed span.

Target `y = 30 x (h_last - h_wake)` in C (the platform forecast's implied skin change over the observed span), with per-leg tokens counted from the wake, per DESIGN 5.6's "observation from the wake sample". `prefill_gpu_k` counts the prompt tokens only when every prefill chunk named a GPU device; with the device labels absent it is 0, which is why it is not identifiable below.

| column | unit | coefficient | same fit without cool |
| --- | --- | --- | --- |
| npu_k | C per 1k NPU tokens | 6.534 | 7.409 |
| gpu_k | C per 1k GPU tokens | not identifiable | not identifiable |
| cpu_k | C per 1k CPU tokens | not identifiable | not identifiable |
| prompt_k | C per 1k prompt tokens | -0.033 | -0.033 |
| prefill_gpu_k | C per 1k GPU-prefilled prompt tokens | not identifiable | not identifiable |
| wall_min | C per completion minute | -2.052 | -2.710 |
| cool | C per (-h_wake x wall_min) | 2.511 | - |

- rank 5 of 5 columns over 25 rows; dropped as identically zero: gpu_k, cpu_k, prefill_gpu_k; residual df 20
- condition number of the scaled design matrix (s(max)/s(min)): 154.8 with the cooling column, 48.8 without it (Gram ratio, its square: 23969.3 and 2382.7)
- residual sigma 0.3810 C, max |residual| 0.6885 C (sigma floor 0.2 C, outlier cut max(1.0 C, 3 sd), both from DESIGN 5.6)

**The condition-number convention**, because the number is meaningless without it: each predictor column is scaled to unit L2 norm and the intercept column is left at 1; the reported figure is the 2-norm condition number of THAT design matrix. The Gram ratio printed beside it is its square - an eigen-decomposition of X'X yields squared singular values, so a reader comparing against a design-matrix figure wants the square root.

**OPEN 6 verdict.** The design is FULL RANK (5 of 5 columns, 25 rows, 20 residual degrees of freedom) - no column is mathematically unidentifiable here - but it is ILL-CONDITIONED: condition number 154.8 against 48.8 without the cooling column. Dropping the cooling column moves `npu_k` from 6.534 to 7.409 C per 1k tokens and `wall_min` from -2.052 to -2.710 C per minute, so the cooling term and the token/time columns are fighting over the same variance: the individual coefficients are UNSTABLE ESTIMATES and none of them should be read as a heat number yet. gpu_k, cpu_k, prefill_gpu_k carry no variance on these rows and are reported as not identifiable; Stage 0 rows do not spend those tokens, so no Stage 0 row set will fix that.

## 8. Per-device prefill attribution (M4 row fields)

0/26 rows carry `prefill_ms`; the other 26 were written before the M4 builder and name no prefill time or device. Device cases over all rows: gpu 0, npu 0, mixed 0, absent 26.

No row carries both a prefill time and a device label, so there is no per-device rate to report: an absent rate is not a zero rate.


`engine_prefill` is the ROUTE's label and `prefill_dev` the device that ran the layers: a phone NPU load reads `GPU` on the route while Hexagon runs the matmuls, so the heat question needs the device column. `prompt_n` is what each completion reported, so a cached prefix is counted once per round.

## 9. What this replay cannot measure

**GPU overshoot: not measurable - and NOT because GPU windows are absent.** These rows do carry GPU activity: 0 GPU window(s) and 0 GPU token(s) from the wake. What is missing is the thing an overshoot is measured *against*: a Stage 3 speed pass. AUDIT-3 restricted Stage 0 to what today's decisions produce, and today's HEAT_RANK is what picked those GPU legs - there is no `speed_fit` prediction of what those tokens should have cost, so there is nothing to be over. More Stage 0 rows cannot produce one; the number waits for Stage 3 Check B.

## 10. OPEN verdicts from these rows

| OPEN | question | verdict |
| --- | --- | --- |
| 2 | forecast read age in practice (the 4 s gate) | max window `h_age` 3094 ms over 348 windows, 0 above the gate: the gate holds on this arm |
| 3 | forecast noise vs the 0.2 C sigma floor | estimated over 26 NPU-only rows, blind and absent windows excluded: median detrended sigma 0.1281 C, worst row 0.2927 C - at or under the 0.2 C floor as an estimate, not a determination |
| 4 | battery sysfs readable in-process | OPEN 4 answered negatively on these rows: the probe read neither value |
| 5 | wake skin, and readings inside (0, 0.083) | rows with `hf == 0` and `hl > 0`: 2/26, carrying 28 window(s) inside the band; wake skin p50 38.7 C (range 36.5-40.5) |
| 6 | `bg` / cooling collinearity; is the cooling column needed | full rank 5/5 over 25 rows, residual df 20; condition number 154.8 (Gram 23969.3), 48.8 without the cooling column; 3 column(s) carry no variance - the coefficients are collinear and unstable, not identified |
