# Learning-governor Stage 0 replay - lfm2.5-2.6b on SM8550

Source `/Users/marco/Projects/kalsa-moe-experiments/scratchpad/agents/s23-open6-designed-2026-10-17/raw/pulled-pre-run.jsonl`: 84 rows, 84 used, 0 gap rows dropped, 1369 window samples.
Producer: binding pin `861a3cc3e638ac73c447b0c0406ebf1e23b3a47f`; state {FAST, COOLMODE, WARM}, source {battery, platform}, rule {heat_rank, -}.

## 1. Rows, legs and speed

| row | turn | round | pred_n | win | wall min | paced tok | decode tok/s | pps | wake win | h_wake | skin_wake C | h_first | h_last | blind | y C |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 1 | 0 | 1785 | 56 | 2.01 | 0 | npu 15.80 | 14.81 | 0 | 0.6500 | 56.0 | 0.6500 | 0.8566 | 0 | 6.20 |
| 1 | 1 | 1 | 1202 | 38 | 1.80 | 957 | gpu 6.83, npu 14.18 | 11.12 | 0 | 0.8566 | 62.2 | 0.8566 | 0.9133 | 0 | 1.70 |
| 2 | 2 | 0 | 1883 | 59 | 3.72 | 1775 | gpu 6.99, npu 13.83 | 8.44 | 0 | 0.8702 | 62.6 | 0.8702 | 0.9267 | 0 | 1.69 |
| 3 | 3 | 0 | 2047 | 64 | 5.66 | 2047 | gpu 5.49, npu 12.72 | 6.03 | 0 | 0.8902 | 63.2 | 0.8902 | 0.9400 | 0 | 1.49 |
| 4 | 4 | 0 | 1068 | 34 | 2.96 | 1069 | gpu 5.44, npu 12.97 | 6.02 | 0 | 0.9101 | 63.8 | 0.9101 | 0.9400 | 0 | 0.90 |
| 5 | 5 | 0 | 2048 | 64 | 5.48 | 2048 | gpu 6.15, npu 13.14 | 6.23 | 0 | 0.9067 | 63.7 | 0.9067 | 0.9567 | 0 | 1.50 |
| 6 | 6 | 0 | 2047 | 64 | 5.80 | 2047 | gpu 5.33, npu 12.54 | 5.88 | 0 | 0.9300 | 64.4 | 0.9300 | 0.9667 | 0 | 1.10 |
| 7 | 1 | 0 | 69 | 0 | 0.00 | 0 | cpu 6.73 | 6.62 | - | - | - | - | - | 0 | - |
| 8 | 1 | 0 | 185 | 6 | 0.25 | 0 | npu 12.49 | 12.25 | 0 | 0.6300 | 55.4 | 0.6300 | 0.6500 | 0 | 0.60 |
| 9 | 1 | 0 | 708 | 23 | 0.87 | 0 | npu 14.68 | 13.58 | 0 | 0.6400 | 55.7 | 0.6400 | 0.7331 | 0 | 2.79 |
| 10 | 1 | 0 | 208 | 7 | 0.26 | 0 | npu 14.37 | 13.29 | 0 | 0.6633 | 56.4 | 0.6633 | 0.6766 | 0 | 0.40 |
| 11 | 1 | 0 | 156 | 5 | 0.20 | 0 | npu 14.06 | 13.06 | 0 | 0.6498 | 56.0 | 0.6498 | 0.6697 | 0 | 0.60 |
| 12 | 1 | 1 | 540 | 17 | 0.75 | 0 | gpu 6.30, npu 13.69 | 11.98 | 0 | 0.6718 | 56.7 | 0.6718 | 0.7409 | 0 | 2.07 |
| 13 | 1 | 2 | 76 | 3 | 0.14 | 0 | gpu 6.12, npu 13.88 | 8.93 | 0 | 0.7597 | 59.3 | 0.7597 | 0.7664 | 0 | 0.20 |
| 14 | 2 | 0 | 448 | 15 | 0.72 | 0 | gpu 6.17, npu 13.96 | 10.43 | 0 | 0.8134 | 60.9 | 0.8134 | 0.8542 | 0 | 1.22 |
| 15 | 3 | 0 | 535 | 17 | 0.64 | 0 | gpu 7.52, npu 16.66 | 14.04 | 0 | 0.8401 | 61.7 | 0.8401 | 0.8673 | 0 | 0.81 |
| 16 | 3 | 1 | 618 | 20 | 0.88 | 619 | gpu 7.38, npu 16.26 | 11.79 | 0 | 0.8797 | 62.9 | 0.8797 | 0.9033 | 0 | 0.71 |
| 17 | 3 | 2 | 130 | 5 | 0.22 | 131 | gpu 6.97, npu 16.56 | 9.83 | 0 | 0.9033 | 63.6 | 0.9033 | 0.9070 | 0 | 0.11 |
| 18 | 4 | 0 | 1045 | 33 | 1.92 | 1219 | gpu 8.11, npu 16.34 | 9.07 | 0 | 0.9034 | 63.6 | 0.9034 | 0.9469 | 0 | 1.31 |
| 19 | 4 | 1 | 474 | 15 | 1.06 | 475 | npu 15.54 | 7.45 | 0 | 0.8901 | 63.2 | 0.8901 | 0.9233 | 0 | 1.00 |
| 20 | 4 | 2 | 489 | 16 | 1.18 | 490 | gpu 6.91, npu 15.09 | 6.93 | 0 | 0.9266 | 64.3 | 0.9266 | 0.9499 | 0 | 0.70 |
| 21 | 1 | 0 | 75 | 3 | 0.08 | 0 | npu 17.13 | 15.73 | 0 | 0.6933 | 57.3 | 0.6933 | 0.6933 | 0 | -0.00 |
| 22 | 1 | 1 | 252 | 8 | 0.29 | 0 | npu 15.96 | 14.42 | 0 | 0.7000 | 57.5 | 0.7000 | 0.7231 | 0 | 0.69 |
| 23 | 1 | 2 | 91 | 3 | 0.10 | 0 | npu 15.90 | 15.58 | 0 | 0.7463 | 58.9 | 0.7463 | 0.7532 | 0 | 0.21 |
| 24 | 1 | 0 | 561 | 18 | 0.54 | 0 | npu 19.11 | 17.40 | 0 | 0.7666 | 59.5 | 0.7666 | 0.8229 | 0 | 1.69 |
| 25 | 1 | 0 | 31 | 1 | 0.06 | 32 | npu 18.99 | 9.01 | 0 | 0.9633 | 65.4 | 0.9633 | 0.9633 | 0 | 0.00 |
| 26 | 1 | 0 | 561 | 18 | 0.56 | 192 | npu 19.05 | 16.66 | 0 | 0.8367 | 61.6 | 0.8367 | 0.9063 | 0 | 2.09 |
| 27 | 1 | 0 | 31 | 1 | 0.06 | 32 | npu 19.15 | 9.45 | 0 | 0.9600 | 65.3 | 0.9600 | 0.9600 | 0 | 0.00 |
| 28 | 1 | 0 | 561 | 18 | 0.57 | 259 | npu 19.08 | 16.55 | 0 | 0.8367 | 61.6 | 0.8367 | 0.9053 | 0 | 2.06 |
| 29 | 1 | 0 | 31 | 1 | 0.08 | 32 | npu 18.80 | 6.99 | 0 | 0.9833 | 66.0 | 0.9833 | 0.9833 | 0 | 0.00 |
| 30 | 1 | 0 | 31 | 1 | 0.06 | 32 | npu 18.81 | 9.48 | 0 | 0.9566 | 65.2 | 0.9566 | 0.9566 | 0 | 0.00 |
| 31 | 1 | 0 | 697 | 22 | 0.89 | 363 | gpu 8.58, npu 16.32 | 13.09 | 0 | 0.8065 | 60.7 | 0.8065 | 0.9130 | 0 | 3.20 |
| 32 | 1 | 0 | 697 | 22 | 1.17 | 672 | gpu 7.96, npu 16.12 | 9.94 | 0 | 0.8603 | 62.3 | 0.8603 | 0.9433 | 0 | 2.49 |
| 33 | 1 | 0 | 667 | 21 | 1.49 | 668 | gpu 8.15, npu 16.37 | 7.49 | 0 | 0.8799 | 62.9 | 0.8799 | 0.9436 | 0 | 1.91 |
| 34 | 1 | 0 | 663 | 21 | 1.48 | 664 | gpu 8.09, npu 16.40 | 7.49 | 0 | 0.8800 | 62.9 | 0.8800 | 0.9533 | 0 | 2.20 |
| 35 | 1 | 0 | 663 | 21 | 1.47 | 664 | gpu 8.24, npu 16.39 | 7.51 | 0 | 0.8866 | 63.1 | 0.8866 | 0.9400 | 0 | 1.60 |
| 36 | 1 | 0 | 685 | 22 | 1.18 | 686 | gpu 8.15, npu 16.28 | 9.72 | 0 | 0.8732 | 62.7 | 0.8732 | 0.9469 | 0 | 2.21 |
| 37 | 1 | 0 | 697 | 22 | 1.20 | 671 | gpu 8.13, npu 16.17 | 9.70 | 0 | 0.8600 | 62.3 | 0.8600 | 0.9470 | 0 | 2.61 |
| 38 | 1 | 0 | 663 | 21 | 1.48 | 664 | gpu 7.93, npu 16.37 | 7.47 | 0 | 0.8767 | 62.8 | 0.8767 | 0.9432 | 0 | 2.00 |
| 39 | 1 | 0 | 561 | 18 | 0.54 | 0 | npu 19.14 | 17.45 | 0 | 0.6733 | 56.7 | 0.6733 | 0.7530 | 0 | 2.39 |
| 40 | 1 | 0 | 663 | 21 | 0.76 | 0 | gpu 8.65, npu 16.46 | 14.63 | 0 | 0.6667 | 56.5 | 0.6667 | 0.7629 | 0 | 2.89 |
| 41 | 1 | 0 | 663 | 21 | 0.76 | 0 | gpu 8.70, npu 16.44 | 14.63 | 0 | 0.7300 | 58.4 | 0.7300 | 0.8163 | 0 | 2.59 |
| 42 | 1 | 0 | 561 | 18 | 0.54 | 0 | npu 19.09 | 17.41 | 0 | 0.7333 | 58.5 | 0.7333 | 0.7966 | 0 | 1.90 |
| 43 | 1 | 0 | 31 | 1 | 0.04 | 32 | npu 19.01 | 12.93 | 0 | 0.9200 | 64.1 | 0.9200 | 0.9200 | 0 | 0.00 |
| 44 | 1 | 0 | 697 | 22 | 0.94 | 431 | gpu 8.15, npu 16.30 | 12.34 | 0 | 0.8334 | 61.5 | 0.8334 | 0.9266 | 0 | 2.79 |
| 45 | 1 | 0 | 697 | 22 | 1.02 | 585 | gpu 8.11, npu 16.18 | 11.42 | 0 | 0.8467 | 61.9 | 0.8467 | 0.9332 | 0 | 2.59 |
| 46 | 1 | 0 | 561 | 18 | 0.54 | 17 | npu 19.08 | 17.37 | 0 | 0.8067 | 60.7 | 0.8067 | 0.8563 | 0 | 1.49 |
| 47 | 1 | 0 | 31 | 1 | 0.05 | 32 | npu 18.95 | 10.93 | 0 | 0.9433 | 64.8 | 0.9433 | 0.9433 | 0 | 0.00 |
| 48 | 1 | 0 | 68 | 3 | 0.07 | 0 | npu 17.12 | 15.81 | 0 | 0.6167 | 55.0 | 0.6167 | 0.6200 | 0 | 0.10 |
| 49 | 1 | 1 | 262 | 9 | 0.30 | 0 | npu 15.89 | 14.52 | 0 | 0.6200 | 55.1 | 0.6200 | 0.6599 | 0 | 1.20 |
| 50 | 1 | 2 | 171 | 6 | 0.19 | 0 | npu 15.50 | 15.18 | 0 | 0.6699 | 56.6 | 0.6699 | 0.6899 | 0 | 0.60 |
| 51 | 1 | 0 | 506 | 16 | 0.48 | 0 | npu 19.19 | 17.54 | 0 | 0.6533 | 56.1 | 0.6533 | 0.7065 | 0 | 1.60 |
| 52 | 1 | 0 | 709 | 23 | 0.81 | 0 | gpu 8.67, npu 16.43 | 14.66 | 0 | 0.6833 | 57.0 | 0.6833 | 0.7831 | 0 | 2.99 |
| 53 | 1 | 0 | 31 | 1 | 0.06 | 32 | npu 16.77 | 9.43 | 0 | 0.9467 | 64.9 | 0.9467 | 0.9467 | 0 | 0.00 |
| 54 | 1 | 0 | 684 | 22 | 0.82 | 0 | gpu 8.19, npu 16.42 | 13.97 | 0 | 0.7734 | 59.7 | 0.7734 | 0.8533 | 0 | 2.40 |
| 55 | 1 | 0 | 506 | 16 | 0.48 | 0 | npu 19.17 | 17.52 | 0 | 0.7867 | 60.1 | 0.7867 | 0.8266 | 0 | 1.20 |
| 56 | 1 | 0 | 31 | 1 | 0.04 | 32 | npu 18.98 | 12.01 | 0 | 0.9300 | 64.4 | 0.9300 | 0.9300 | 0 | 0.00 |
| 57 | 1 | 0 | 811 | 26 | 0.81 | 0 | npu 18.30 | 16.79 | 0 | 0.7500 | 59.0 | 0.7500 | 0.8397 | 0 | 2.69 |
| 58 | 1 | 0 | 672 | 22 | 0.71 | 24 | gpu 9.56, npu 17.88 | 15.82 | 0 | 0.8067 | 60.7 | 0.8067 | 0.8798 | 0 | 2.19 |
| 59 | 1 | 0 | 646 | 21 | 0.75 | 181 | gpu 9.23, npu 17.21 | 14.37 | 0 | 0.8167 | 61.0 | 0.8167 | 0.8965 | 0 | 2.39 |
| 60 | 1 | 0 | 1213 | 38 | 1.67 | 798 | gpu 8.73, npu 16.40 | 12.11 | 0 | 0.8233 | 61.2 | 0.8233 | 0.9367 | 0 | 3.40 |
| 61 | 1 | 0 | 684 | 22 | 0.86 | 287 | gpu 8.19, npu 16.41 | 13.23 | 0 | 0.8266 | 61.3 | 0.8266 | 0.9132 | 0 | 2.60 |
| 62 | 1 | 0 | 683 | 22 | 4.26 | 650 | npu 4.20 | 2.68 | 0 | 0.8566 | 62.2 | 0.8566 | 0.9100 | 0 | 1.60 |
| 63 | 1 | 0 | 684 | 22 | 0.87 | 259 | gpu 8.18, npu 16.42 | 13.18 | 0 | 0.8201 | 61.1 | 0.8201 | 0.9097 | 0 | 2.69 |
| 64 | 1 | 0 | 776 | 25 | 0.76 | 0 | npu 18.52 | 16.97 | 0 | 0.7767 | 59.8 | 0.7767 | 0.8630 | 0 | 2.59 |
| 65 | 1 | 0 | 716 | 23 | 0.73 | 222 | npu 18.51 | 16.42 | 0 | 0.8201 | 61.1 | 0.8201 | 0.8965 | 0 | 2.29 |
| 66 | 1 | 0 | 712 | 23 | 0.72 | 219 | npu 18.45 | 16.39 | 0 | 0.8234 | 61.2 | 0.8234 | 0.8965 | 0 | 2.20 |
| 67 | 1 | 0 | 818 | 26 | 0.83 | 158 | npu 18.36 | 16.36 | 0 | 0.8100 | 60.8 | 0.8100 | 0.8930 | 0 | 2.49 |
| 68 | 1 | 0 | 73 | 3 | 0.08 | 0 | npu 17.12 | 15.80 | 0 | 0.8434 | 61.8 | 0.8434 | 0.8433 | 0 | -0.00 |
| 69 | 1 | 1 | 183 | 6 | 0.25 | 0 | gpu 7.32, npu 15.86 | 12.29 | 0 | 0.8434 | 61.8 | 0.8434 | 0.8666 | 0 | 0.69 |
| 70 | 1 | 2 | 241 | 8 | 0.39 | 225 | gpu 6.94, npu 14.79 | 10.28 | 0 | 0.8666 | 62.5 | 0.8666 | 0.8931 | 0 | 0.79 |
| 71 | 1 | 0 | 31 | 1 | 0.06 | 0 | gpu 8.84 | 8.62 | 0 | 0.6600 | 56.3 | 0.6600 | 0.6600 | 0 | 0.00 |
| 72 | 1 | 0 | 31 | 1 | 0.04 | 0 | npu 16.19 | 14.93 | 0 | 0.7233 | 58.2 | 0.7233 | 0.7233 | 0 | 0.00 |
| 73 | 1 | 0 | 31 | 1 | 0.08 | 0 | npu 6.49 | 6.38 | 0 | 0.7166 | 58.0 | 0.7166 | 0.7166 | 0 | 0.00 |
| 74 | 1 | 0 | 31 | 1 | 0.07 | 0 | gpu 8.44 | 8.23 | 0 | 0.6534 | 56.1 | 0.6534 | 0.6534 | 0 | 0.00 |
| 75 | 1 | 0 | 31 | 1 | 0.05 | 0 | npu 10.82 | 10.30 | 0 | 0.6600 | 56.3 | 0.6600 | 0.6600 | 0 | 0.00 |
| 76 | 1 | 0 | 31 | 1 | 0.06 | 0 | gpu 8.70 | 8.47 | 0 | 0.6666 | 56.5 | 0.6666 | 0.6666 | 0 | 0.00 |
| 77 | 1 | 0 | 31 | 1 | 0.06 | 0 | gpu 8.59 | 8.35 | 0 | 0.6833 | 57.0 | 0.6833 | 0.6833 | 0 | 0.00 |
| 78 | 1 | 0 | 31 | 1 | 0.05 | 0 | npu 10.82 | 10.34 | 0 | 0.6866 | 57.1 | 0.6866 | 0.6866 | 0 | 0.00 |
| 79 | 1 | 0 | 31 | 1 | 0.05 | 0 | npu 10.81 | 10.32 | 0 | 0.6667 | 56.5 | 0.6667 | 0.6667 | 0 | 0.00 |
| 80 | 1 | 0 | 31 | 1 | 0.05 | 0 | npu 10.81 | 10.31 | 0 | 0.6733 | 56.7 | 0.6733 | 0.6733 | 0 | 0.00 |
| 81 | 1 | 0 | 330 | 11 | 0.40 | 0 | npu 14.91 | 13.85 | 0 | 0.6734 | 56.7 | 0.6734 | 0.7066 | 0 | 1.00 |
| 82 | 1 | 0 | 31 | 1 | 0.04 | 0 | npu 15.20 | 14.17 | 0 | 0.6933 | 57.3 | 0.6933 | 0.6933 | 0 | 0.00 |
| 83 | 1 | 0 | 506 | 16 | 0.48 | 0 | npu 19.14 | 17.47 | 0 | 0.7134 | 57.9 | 0.7134 | 0.7530 | 0 | 1.19 |

Per-leg speed is `tok x 1e6 / us` (DESIGN 3.3). The ring's boundary steps across all rows: 32 tokens.
**DESIGN 3.4 criterion 3 (speed attribution):** 28/84 rows are unpaced 100 % NPU rows; 42/84 rows had `paced.tok > 0`.
| row | NPU tok/s | pps | delta | within 10 % |
| --- | --- | --- | --- | --- |
| 0 | 15.80 | 14.81 | +6.7 % | yes |
| 8 | 12.49 | 12.25 | +2.0 % | yes |
| 9 | 14.68 | 13.58 | +8.0 % | yes |
| 10 | 14.37 | 13.29 | +8.2 % | yes |
| 11 | 14.06 | 13.06 | +7.6 % | yes |
| 21 | 17.13 | 15.73 | +8.9 % | yes |
| 22 | 15.96 | 14.42 | +10.7 % | NO |
| 23 | 15.90 | 15.58 | +2.1 % | yes |
| 24 | 19.11 | 17.40 | +9.8 % | yes |
| 39 | 19.14 | 17.45 | +9.7 % | yes |
| 42 | 19.09 | 17.41 | +9.7 % | yes |
| 48 | 17.12 | 15.81 | +8.3 % | yes |
| 49 | 15.89 | 14.52 | +9.4 % | yes |
| 50 | 15.50 | 15.18 | +2.1 % | yes |
| 51 | 19.19 | 17.54 | +9.4 % | yes |
| 55 | 19.17 | 17.52 | +9.4 % | yes |
| 57 | 18.30 | 16.79 | +9.0 % | yes |
| 64 | 18.52 | 16.97 | +9.2 % | yes |
| 68 | 17.12 | 15.80 | +8.3 % | yes |
| 72 | 16.19 | 14.93 | +8.4 % | yes |
| 73 | 6.49 | 6.38 | +1.8 % | yes |
| 75 | 10.82 | 10.30 | +5.0 % | yes |
| 78 | 10.82 | 10.34 | +4.6 % | yes |
| 79 | 10.81 | 10.32 | +4.8 % | yes |
| 80 | 10.81 | 10.31 | +4.8 % | yes |
| 81 | 14.91 | 13.85 | +7.6 % | yes |
| 82 | 15.20 | 14.17 | +7.3 % | yes |
| 83 | 19.14 | 17.47 | +9.5 % | yes |
Verdict: 27/28 candidate rows within 10 %; largest |delta| 10.7 %.

## 2. Derived wake start and tokens from the wake

The wake is the first window whose forecast headroom is `> 0`: `h == 0` is blind (a real reading) and `h == null` is an absent forecast, and only the transition out of blind defines a wake. A window's tokens are the difference of consecutive cumulative boundaries, attributed to the leg of its END boundary (`leg_prev`).

| row | wake win | blind win | absent win | npu tok | gpu tok | cpu tok | coolmode tok | unattr tok | window tok | decode tok | window coverage |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0 | 0 | 0 | 0 | 1760 | 0 | 0 | 0 | 0 | 1760 | 1786 | 98.5 % |
| 1 | 0 | 0 | 0 | 1120 | 64 | 0 | 0 | 0 | 1184 | 1203 | 98.4 % |
| 2 | 0 | 0 | 0 | 1824 | 32 | 0 | 0 | 0 | 1856 | 1884 | 98.5 % |
| 3 | 0 | 0 | 0 | 1984 | 32 | 0 | 0 | 0 | 2016 | 2047 | 98.5 % |
| 4 | 0 | 0 | 0 | 1024 | 32 | 0 | 0 | 0 | 1056 | 1069 | 98.8 % |
| 5 | 0 | 0 | 0 | 1984 | 32 | 0 | 0 | 0 | 2016 | 2048 | 98.4 % |
| 6 | 0 | 0 | 0 | 1984 | 32 | 0 | 0 | 0 | 2016 | 2047 | 98.5 % |
| 7 | - | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 70 | 0.0 % |
| 8 | 0 | 0 | 0 | 160 | 0 | 0 | 0 | 0 | 160 | 186 | 86.0 % |
| 9 | 0 | 0 | 0 | 704 | 0 | 0 | 0 | 0 | 704 | 709 | 99.3 % |
| 10 | 0 | 0 | 0 | 192 | 0 | 0 | 0 | 0 | 192 | 209 | 91.9 % |
| 11 | 0 | 0 | 0 | 128 | 0 | 0 | 0 | 0 | 128 | 157 | 81.5 % |
| 12 | 0 | 0 | 0 | 480 | 32 | 0 | 0 | 0 | 512 | 541 | 94.6 % |
| 13 | 0 | 0 | 0 | 32 | 32 | 0 | 0 | 0 | 64 | 77 | 83.1 % |
| 14 | 0 | 0 | 0 | 384 | 64 | 0 | 0 | 0 | 448 | 1129 | 39.7 % |
| 15 | 0 | 0 | 0 | 480 | 32 | 0 | 0 | 0 | 512 | 536 | 95.5 % |
| 16 | 0 | 0 | 0 | 544 | 64 | 0 | 0 | 0 | 608 | 619 | 98.2 % |
| 17 | 0 | 0 | 0 | 96 | 32 | 0 | 0 | 0 | 128 | 131 | 97.7 % |
| 18 | 0 | 0 | 0 | 992 | 32 | 0 | 0 | 0 | 1024 | 1219 | 84.0 % |
| 19 | 0 | 0 | 0 | 448 | 0 | 0 | 0 | 0 | 448 | 475 | 94.3 % |
| 20 | 0 | 0 | 0 | 448 | 32 | 0 | 0 | 0 | 480 | 490 | 98.0 % |
| 21 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 76 | 84.2 % |
| 22 | 0 | 0 | 0 | 224 | 0 | 0 | 0 | 0 | 224 | 253 | 88.5 % |
| 23 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 92 | 69.6 % |
| 24 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 25 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 26 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 27 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 28 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 29 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 30 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 31 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 698 | 96.3 % |
| 32 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 698 | 96.3 % |
| 33 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 668 | 95.8 % |
| 34 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 664 | 96.4 % |
| 35 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 664 | 96.4 % |
| 36 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 686 | 98.0 % |
| 37 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 698 | 96.3 % |
| 38 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 664 | 96.4 % |
| 39 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 40 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 664 | 96.4 % |
| 41 | 0 | 0 | 0 | 608 | 32 | 0 | 0 | 0 | 640 | 664 | 96.4 % |
| 42 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 43 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 44 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 698 | 96.3 % |
| 45 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 698 | 96.3 % |
| 46 | 0 | 0 | 0 | 544 | 0 | 0 | 0 | 0 | 544 | 562 | 96.8 % |
| 47 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 48 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 69 | 92.8 % |
| 49 | 0 | 0 | 0 | 256 | 0 | 0 | 0 | 0 | 256 | 263 | 97.3 % |
| 50 | 0 | 0 | 0 | 160 | 0 | 0 | 0 | 0 | 160 | 172 | 93.0 % |
| 51 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 507 | 94.7 % |
| 52 | 0 | 0 | 0 | 672 | 32 | 0 | 0 | 0 | 704 | 710 | 99.2 % |
| 53 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 54 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 685 | 98.1 % |
| 55 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 507 | 94.7 % |
| 56 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 57 | 0 | 0 | 0 | 800 | 0 | 0 | 0 | 0 | 800 | 812 | 98.5 % |
| 58 | 0 | 0 | 0 | 640 | 32 | 0 | 0 | 0 | 672 | 673 | 99.9 % |
| 59 | 0 | 0 | 0 | 576 | 64 | 0 | 0 | 0 | 640 | 647 | 98.9 % |
| 60 | 0 | 0 | 0 | 1120 | 64 | 0 | 0 | 0 | 1184 | 1214 | 97.5 % |
| 61 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 685 | 98.1 % |
| 62 | 0 | 0 | 0 | 672 | 0 | 0 | 0 | 0 | 672 | 684 | 98.2 % |
| 63 | 0 | 0 | 0 | 608 | 64 | 0 | 0 | 0 | 672 | 685 | 98.1 % |
| 64 | 0 | 0 | 0 | 768 | 0 | 0 | 0 | 0 | 768 | 777 | 98.8 % |
| 65 | 0 | 0 | 0 | 704 | 0 | 0 | 0 | 0 | 704 | 717 | 98.2 % |
| 66 | 0 | 0 | 0 | 704 | 0 | 0 | 0 | 0 | 704 | 713 | 98.7 % |
| 67 | 0 | 0 | 0 | 800 | 0 | 0 | 0 | 0 | 800 | 819 | 97.7 % |
| 68 | 0 | 0 | 0 | 64 | 0 | 0 | 0 | 0 | 64 | 74 | 86.5 % |
| 69 | 0 | 0 | 0 | 128 | 32 | 0 | 0 | 0 | 160 | 184 | 87.0 % |
| 70 | 0 | 0 | 0 | 160 | 64 | 0 | 0 | 0 | 224 | 242 | 92.6 % |
| 71 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 72 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 73 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 74 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 75 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 76 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 77 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 78 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 79 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 80 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 81 | 0 | 0 | 0 | 320 | 0 | 0 | 0 | 0 | 320 | 331 | 96.7 % |
| 82 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 32 | 0.0 % |
| 83 | 0 | 0 | 0 | 480 | 0 | 0 | 0 | 0 | 480 | 507 | 94.7 % |

From the wake, all rows: 39552 npu, 1600 gpu, 0 cpu, 0 gpu-coolmode, 0 unattributed tokens. The ring stops at the last boundary, so a completion's last partial window is never in these counts - hence the coverage column below 100 %.

## 3. Freshness distributions (OPEN 2) and the wake skin (OPEN 5)

- `hf_age` per row, ms: n=83 min=105 p50=916 p90=1652 max=2318
- window `h_age`, ms: n=1369 min=53 p50=1070 p90=1877 max=2461
- window `status_age`, ms: n=1369 min=58 p50=604 p90=1024 max=1708
- window `app_age`, ms: n=1369 min=159 p50=31783 p90=155149 max=350368

Against the DESIGN 5.1 gates: window `h_age` above the 4000 ms forecast-read gate 0/1369; window `status_age` above the 10000 ms status gate 0/1369; window `app_age` above the old 120000 ms gate 179/1369 and above the 1200000 ms backstop of DESIGN-ADDENDUM Item B 0/1369.

Wake skin (AOSP map skin = 36.5 + 30 h): skin at the wake sample, C: n=83 min=55.0 p50=60.9 p90=64.3 max=66.0.
OPEN 5 test - rows with `h_first == 0` and `h_last > 0`: 0/84 rows, carrying 0 window(s) reading strictly between 0 and 0.083 (`headroomAt(39.0 C, 66.5)`, the Stage 0b start line).
The row field `hl` is the forecast the policy last read, and the policy keeps reading after the ring's last boundary: identical on 21 of the 83 comparable rows and within 0.894 C on every one of them (the other 1 row(s) have no ring to compare against) (the signs differ because the forecast keeps moving after the boundary).

## 4. Forecast noise (OPEN 3)

Per-row detrended noise sigma, C (NPU-only rows): n=29 min=0.0000 p50=0.1755 p90=0.2316 max=0.4945 over 44 rows.
Successive |delta h| per window, C (upper bound): n=430 min=0.0000 p50=0.0019 p90=0.5961 max=0.8979.

Blind (`h == 0`) and absent (`h == null`) windows are excluded from both lines: a floor is not a reading. 430 of the windows supplied a successive difference.

The successive difference mixes real heating with forecast noise, so it is an upper bound and not a noise measurement; the detrended residual of each row's own trend is the noise. Over 44 NPU-only rows the median sigma is 0.1755 C (worst row 0.4945 C) - at or under the DESIGN 5.6 residual-sigma floor of 0.2 C, as an ESTIMATE over 44 rows, not a determination of the forecast's true noise. Closing this item needs rows whose forecast is quiet - a cold or idle stretch, where the trend is small enough for the residual to mean what it says.

## 5. Zone hot temperatures and trip ranges

| leg | rise pairs | dark-zone pairs dropped | rise min C | rise max C | observed hot max C |
| --- | --- | --- | --- | --- | --- |
| cpu | 1286 | 0 | -12.80 | 13.50 | 74.9 |
| gpu | 1286 | 0 | -11.90 | 8.30 | 66.2 |
| npu | 1286 | 0 | -26.70 | 13.60 | 80.0 |

A null zone temperature is a dark zone (one dark zone makes the whole leg unknown), so that pair is dropped from zone statistics rather than counted as a zero rise. A row's first pair mixes the first decode step's own idle sample with the first loaded window, which is where the largest single rise comes from.
Trip ranges `[cpu_min, cpu_max, npu_min, npu_max, gpu_min, gpu_max]` in C: 2 distinct vectors: `[108.0, 115.0, 95.0, 95.0, 95.0, 95.0]` `[-, -, -, -, -, -]`. A null entry is a leg whose zones the phone does not report.

## 6. Battery sysfs vs BatteryManager (OPEN 4)

Probe readable on 0/84 rows for temp, 0/84 for status. Compared: 0 temperatures, 0 statuses.
Nothing to compare: the probe answered on no row, so the 0.5 C and 95 % criteria are untested rather than passed.

**Verdict: OPEN 4 answered negatively on these rows: the probe read neither value.**

## 7. Heat fit of DESIGN 5.6, and the collinearity of OPEN 6

Rows entering the fit: 83/84. Excluded: 1 - no wake: forecast absent or blind for the whole completion.

Target `y = 30 x (h_last - h_wake)` in C (the platform forecast's implied skin change over the observed span), with per-leg tokens counted from the wake, per DESIGN 5.6's "observation from the wake sample". `prefill_gpu_k` counts the prompt tokens only when every prefill chunk named a GPU device; with the device labels absent it is 0, which is why it is not identifiable below.

| column | unit | coefficient | same fit without cool |
| --- | --- | --- | --- |
| npu_k | C per 1k NPU tokens | 2.201 | 3.625 |
| gpu_k | C per 1k GPU tokens | 11.946 | 8.136 |
| cpu_k | C per 1k CPU tokens | not identifiable | not identifiable |
| prompt_k | C per 1k prompt tokens | 0.056 | 0.114 |
| prefill_gpu_k | C per 1k GPU-prefilled prompt tokens | -0.076 | -0.238 |
| wall_min | C per completion minute | 5.869 | -1.052 |
| cool | C per (-h_wake x wall_min) | 7.138 | - |

- rank 7 of 7 columns over 83 rows; dropped as identically zero: cpu_k; residual df 76
- condition number of the scaled design matrix (s(max)/s(min)): 298.8 with the cooling column, 39.1 without it (Gram ratio, its square: 89263.5 and 1532.7)
- residual sigma 0.4811 C, max |residual| 1.5878 C (sigma floor 0.2 C, outlier cut max(1.0 C, 3 sd), both from DESIGN 5.6)

**The condition-number convention**, because the number is meaningless without it: each predictor column is scaled to unit L2 norm and the intercept column is left at 1; the reported figure is the 2-norm condition number of THAT design matrix. The Gram ratio printed beside it is its square - an eigen-decomposition of X'X yields squared singular values, so a reader comparing against a design-matrix figure wants the square root.

**OPEN 6 verdict.** The design is FULL RANK (7 of 7 columns, 83 rows, 76 residual degrees of freedom) - no column is mathematically unidentifiable here - but it is ILL-CONDITIONED: condition number 298.8 against 39.1 without the cooling column. Dropping the cooling column moves `npu_k` from 2.201 to 3.625 C per 1k tokens and `wall_min` from 5.869 to -1.052 C per minute, so the cooling term and the token/time columns are fighting over the same variance: the individual coefficients are UNSTABLE ESTIMATES and none of them should be read as a heat number yet. cpu_k carry no variance on these rows and are reported as not identifiable; Stage 0 rows do not spend those tokens, so no Stage 0 row set will fix that.

## 8. Per-device prefill attribution (M4 row fields)

74/84 rows carry `prefill_ms`; the other 10 were written before the M4 builder and name no prefill time or device. Device cases over all rows: gpu 8, npu 66, mixed 0, absent 10.

Per DEVICE, because the device is what the heat question asks about. Each row contributes only its own `prompt_n` and its own `prefill_ms`:

| device | rows | prompt tok | prefill ms | prefill tok/s |
| --- | --- | --- | --- | --- |
| npu | 66 | 97849 | 227161 | 430.7 |
| gpu | 8 | 7530 | 1199427 | 6.3 |

The rows that carry the fields, each on its own:

| row | turn | route label | device(s) | prompt tok | prefill ms | prefill tok/s |
| --- | --- | --- | --- | --- | --- | --- |
| 10 | 1 | NPU | HTP0 | 1943 | 3127 | 621.4 |
| 11 | 1 | NPU | HTP0 | 2186 | 3410 | 641.1 |
| 12 | 1 | NPU | HTP0 | 2293 | 3687 | 621.8 |
| 13 | 1 | NPU | HTP0 | 221 | 494 | 447.4 |
| 14 | 2 | NPU | HTP0 | 3941 | 5997 | 657.1 |
| 15 | 3 | NPU | HTP0 | 2125 | 2968 | 715.9 |
| 16 | 3 | NPU | HTP0 | 115 | 287 | 401.0 |
| 17 | 3 | NPU | HTP0 | 226 | 421 | 536.3 |
| 18 | 4 | NPU | HTP0 | 1133 | 1532 | 739.4 |
| 19 | 4 | NPU | HTP0 | 758 | 1380 | 549.2 |
| 20 | 4 | NPU | HTP0 | 982 | 1834 | 535.4 |
| 21 | 1 | NPU | HTP0 | 32 | 141 | 227.6 |
| 22 | 1 | NPU | HTP0 | 681 | 1221 | 557.6 |
| 23 | 1 | NPU | HTP0 | 744 | 1263 | 589.0 |
| 24 | 1 | NPU | HTP0 | 765 | 1155 | 662.4 |
| 25 | 1 | GPU | GPUOpenCL | 765 | 124455 | 6.1 |
| 26 | 1 | NPU | HTP0 | 765 | 1153 | 663.4 |
| 27 | 1 | GPU | GPUOpenCL | 765 | 127724 | 6.0 |
| 28 | 1 | NPU | HTP0 | 765 | 1159 | 660.0 |
| 29 | 1 | GPU | GPUOpenCL | 765 | 128219 | 6.0 |
| 30 | 1 | GPU | GPUOpenCL | 765 | 125087 | 6.1 |
| 31 | 1 | NPU | HTP0 | 2175 | 3127 | 695.7 |
| 32 | 1 | NPU | HTP0 | 2175 | 3126 | 695.7 |
| 33 | 1 | NPU | HTP0 | 2175 | 3491 | 623.0 |
| 34 | 1 | NPU | HTP0 | 2175 | 3492 | 622.8 |
| 35 | 1 | NPU | HTP0 | 2175 | 3494 | 622.5 |
| 36 | 1 | NPU | HTP0 | 2175 | 3141 | 692.5 |
| 37 | 1 | NPU | HTP0 | 2175 | 3143 | 692.0 |
| 38 | 1 | NPU | HTP0 | 2175 | 3494 | 622.5 |
| 39 | 1 | NPU | HTP0 | 765 | 1154 | 662.9 |
| 40 | 1 | NPU | HTP0 | 2175 | 3080 | 706.1 |
| 41 | 1 | NPU | HTP0 | 2175 | 3080 | 706.1 |
| 42 | 1 | NPU | HTP0 | 765 | 1153 | 663.3 |
| 43 | 1 | GPU | GPUOpenCL | 765 | 113910 | 6.7 |
| 44 | 1 | NPU | HTP0 | 2175 | 3130 | 694.8 |
| 45 | 1 | NPU | HTP0 | 2175 | 3139 | 693.0 |
| 46 | 1 | NPU | HTP0 | 765 | 1146 | 667.4 |
| 47 | 1 | GPU | GPUOpenCL | 765 | 119656 | 6.4 |
| 48 | 1 | NPU | HTP0 | 32 | 139 | 230.1 |
| 49 | 1 | NPU | HTP0 | 707 | 1225 | 577.0 |
| 50 | 1 | NPU | HTP0 | 945 | 1649 | 573.2 |
| 51 | 1 | NPU | HTP0 | 765 | 1150 | 665.4 |
| 52 | 1 | NPU | HTP0 | 2175 | 3079 | 706.4 |
| 53 | 1 | GPU | GPUOpenCL | 2175 | 345393 | 6.3 |
| 54 | 1 | NPU | HTP0 | 2175 | 3097 | 702.3 |
| 55 | 1 | NPU | HTP0 | 765 | 1152 | 664.2 |
| 56 | 1 | GPU | GPUOpenCL | 765 | 114983 | 6.7 |
| 57 | 1 | NPU | HTP0 | 1049 | 1558 | 673.3 |
| 58 | 1 | NPU | HTP0 | 1324 | 1853 | 714.4 |
| 59 | 1 | NPU | HTP0 | 1606 | 2374 | 676.4 |
| 60 | 1 | NPU | HTP0 | 1888 | 2674 | 706.0 |
| 61 | 1 | NPU | HTP0 | 2175 | 3028 | 718.2 |
| 62 | 1 | NPU | HTP0 | 2175 | 11928 | 182.3 |
| 63 | 1 | NPU | HTP0 | 2175 | 3400 | 639.7 |
| 64 | 1 | NPU | HTP0 | 960 | 1502 | 639.3 |
| 65 | 1 | NPU | HTP0 | 997 | 1512 | 659.3 |
| 66 | 1 | NPU | HTP0 | 1018 | 1533 | 664.0 |
| 67 | 1 | NPU | HTP0 | 1028 | 1542 | 666.7 |
| 68 | 1 | NPU | HTP0 | 32 | 138 | 232.5 |
| 69 | 1 | NPU | HTP0 | 750 | 1267 | 591.8 |
| 70 | 1 | NPU | HTP0 | 993 | 1711 | 580.2 |
| 71 | 1 | NPU | HTP0 | 2175 | 3077 | 706.8 |
| 72 | 1 | NPU | HTP0 | 2175 | 62947 | 34.6 |
| 73 | 1 | NPU | HTP0 | 2175 | 10858 | 200.3 |
| 74 | 1 | NPU | HTP0 | 2175 | 3072 | 708.0 |
| 75 | 1 | NPU | HTP0 | 2175 | 4015 | 541.7 |
| 76 | 1 | NPU | HTP0 | 2175 | 3119 | 697.4 |
| 77 | 1 | NPU | HTP0 | 2175 | 3176 | 684.7 |
| 78 | 1 | NPU | HTP0 | 2175 | 4021 | 541.0 |
| 79 | 1 | NPU | HTP0 | 2175 | 4008 | 542.7 |
| 80 | 1 | NPU | HTP0 | 2175 | 4007 | 542.8 |
| 81 | 1 | NPU | HTP0 | 765 | 1288 | 593.8 |
| 82 | 1 | NPU | HTP0 | 765 | 1287 | 594.5 |
| 83 | 1 | NPU | HTP0 | 765 | 1151 | 664.5 |

- route NPU, layers on HTP0
- device agrees with the route (GPU on GPUOpenCL)

`engine_prefill` is the ROUTE's label and `prefill_dev` the device that ran the layers: a phone NPU load reads `GPU` on the route while Hexagon runs the matmuls, so the heat question needs the device column. `prompt_n` is what each completion reported, so a cached prefix is counted once per round.

## 9. What this replay cannot measure

**GPU overshoot: not measurable - and NOT because GPU windows are absent.** These rows do carry GPU activity: 50 GPU window(s) and 1600 GPU token(s) from the wake. What is missing is the thing an overshoot is measured *against*: a Stage 3 speed pass. AUDIT-3 restricted Stage 0 to what today's decisions produce, and today's HEAT_RANK is what picked those GPU legs - there is no `speed_fit` prediction of what those tokens should have cost, so there is nothing to be over. More Stage 0 rows cannot produce one; the number waits for Stage 3 Check B.

## 10. OPEN verdicts from these rows

| OPEN | question | verdict |
| --- | --- | --- |
| 2 | forecast read age in practice (the 4 s gate) | max window `h_age` 2461 ms over 1369 windows, 0 above the gate: the gate holds on this arm |
| 3 | forecast noise vs the 0.2 C sigma floor | estimated over 44 NPU-only rows, blind and absent windows excluded: median detrended sigma 0.1755 C, worst row 0.4945 C - at or under the 0.2 C floor as an estimate, not a determination |
| 4 | battery sysfs readable in-process | OPEN 4 answered negatively on these rows: the probe read neither value |
| 5 | wake skin, and readings inside (0, 0.083) | rows with `hf == 0` and `hl > 0`: 0/84, carrying 0 window(s) inside the band; wake skin p50 60.9 C (range 55.0-66.0) |
| 6 | `bg` / cooling collinearity; is the cooling column needed | full rank 7/7 over 83 rows, residual df 76; condition number 298.8 (Gram 89263.5), 39.1 without the cooling column; 1 column(s) carry no variance - the coefficients are collinear and unstable, not identified |
