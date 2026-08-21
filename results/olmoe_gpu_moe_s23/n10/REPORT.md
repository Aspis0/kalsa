# n10-kexp-session REPORT

**Protocol re-read:** PREREG_N10.md **v1.2** (2026-08-21 owner decision). Confirmed re-read before continuing this session.

**Amendment:** v1.1 required N>=10 complete ABBA blocks. v1.2 (pre-analysis, stopping rule fixed before any block result of this session was read) changes the confirmatory target to **N>=5** (20 cells, 10 A + 10 B). Per-block protocol, gates, pins, exclusions, 1.30x floor, temp criterion **unchanged**. Extra OLMoE blocks beyond 5 are not collected: KEXP has priority.

**Pre-amendment blocks:** **0**. The v1.1 harness was not yet running when v1.2 landed. Every OLMoE block in this report is post-amendment, still using the identical per-block protocol.

**Device:** S23 SM-S911U Adreno 740, serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`. PC-side `adb shell` (not Termux).

**Frozen pins (N>=5 ship cell):** noextra `libllama-bench-impl.so` `d2030f23…`; `libggml-opencl.so` `2ed2e48a…`; OLMoE Q4_K_M `3bd9ec48…`; ngl=16 both arms; `-fa off -t 4`; LOG_ALLOC unset; stock extra_bufts `bad17952…` FORBIDDEN.

**Status:** SHIP (pending remaining ship-claim checks)
**Complete blocks:** 5 / 5  (ids: 1, 2, 3, 4, 5)
**Primary median tg512 A:** 16.356   **B:** 10.530   **ratio A/B:** 1.553
**Median peak temp A:** 38.4 C   **B:** 39.0 C
**Cool-start-only secondary ratio:** 1.553  (cool-start complete blocks: 5)
**J/token:** see cell level_pre/post; likely `not extractable at 1% resolution` until the full set is in.

## Block table

| block | status | temp_c_block_start | warm_start | level_pre | level_post | tg512 cells | governor | iso_block_start |
|---:|---|---:|---|---:|---:|---|---|---|
| 1 | COMPLETE | 28.6 | False | 76 | 73 | A:25.459231 B:10.656000 B:10.563061 A:15.322094 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt | 2026-08-21T16:19:15.8128156-04:00 |
| 2 | COMPLETE | 34.5 | False | 72 | 70 | A:19.962864 B:10.591901 B:9.956474 A:13.996718 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt | 2026-08-21T16:24:58.4579216-04:00 |
| 3 | COMPLETE | 34.8 | False | 70 | 67 | A:19.700701 B:10.865555 B:10.439430 A:13.879137 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt | 2026-08-21T16:34:25.1651537-04:00 |
| 4 | COMPLETE | 34.8 | False | 67 | 64 | A:18.955649 B:10.659507 B:10.287043 A:13.450382 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt | 2026-08-21T16:42:33.4316883-04:00 |
| 5 | COMPLETE | 35 | False | 64 | 61 | A:17.389984 B:10.497329 B:10.093158 A:14.177614 | cpu0:walt; cpu1:walt; cpu2:walt; cpu3:walt; cpu4:walt; cpu5:walt; cpu6:walt; cpu7:walt | 2026-08-21T16:52:53.6894145-04:00 |

## Cells (csv ground truth)

Raw: `results/olmoe_gpu_moe_s23/n10/runs.csv`. Do not trust the terminal.

## Mellum2 (exploratory, NOT ship)

Not started until N>=5 OLMoE is in the bag.

## KEXP #14 (exploratory, NOT ship, NOT in the N>=5 median)

Not started. Planned: 3 ABBA blocks if battery allows, q6k cherry opencl `b9d99fa8…`.

## Abort

none
