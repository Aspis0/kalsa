# Round 4 on the S23 — rule v3 HEAT_RANK vs NPU alone (unplugged, endurance to skin 43 C)

**Setup.**
- Script `run-step5-vsleg4.sh` (sha 3ec8dbc8). Bench r4 governor-bench f72b761b (engine 09a496d71, rule v3), release skel v73 f89da3d8.
- 2026-10-08 23:55 to 2026-10-09 01:40 EDT. Battery went from 83 % to 56 %, unplugged and Awake throughout.
- Arm order npu, hr, hr, npu (ABBA). Each arm: back-to-back 2048-token runs, stopped when skin reaches 43 C.
- Arms 2-4 started after the 25-minute cool-wait cap ("cool wait gave up at skin 32"). Arm 1 started at skin 31.8.

**Evidence.**
- `vsleg4_report.grep`;
- `vsleg4_<n>_<arm>.grep` (window, summary, headroom and governor lines from each arm's log);
- `vsleg4_<n>_<arm>.csv` (10 s);
- `zones_vsleg4.csv` (1 Hz).

## Result

| arm | windows (x32 tokens) | decode s | tok/s | seconds to skin 43 | NSP max / mean C | GPU max | CPU max |
|---|---|---|---|---|---|---|---|
| 1 npu | 192 (3 full runs) | 361.9 | 16.97 | 453 | 95.1 / 81.5 | 68.1 | 79.4 |
| 2 hr | 192 (13 on GPU) | 367.3 | 16.72 | 449 | 94.7 / 79.4 | 77.3 | 87.9 |
| 3 hr | 192 (all NPU) | 364.4 | 16.86 | 420 | 90.4 / 81.2 | 67.7 | 81.0 |
| 4 npu | 192 (3 full runs) | 364.3 | 16.86 | 431 | 95.9 / 81.5 | 67.4 | 75.8 |

In every arm the 4th run was killed at skin 43. The bench prints a run's windows only when the run ends, so all four arms show exactly 3 full runs: 6144 generated tokens, 6051 in the report's `windows_tokens`. The finer measure is the seconds to skin 43:
- npu: 453 and 431 (mean 442);
- hr: 449 and 420 (mean 434.5).

The `cdsp` and `gpu` cooling devices stayed 0 throughout.

**The one non-NPU decision was rule v3's own.**
- At the start of arm 2 run 2, about 6 s after run 1, the feeder read NPU headroom 8.6 C. That is below the guard (5 C) plus the NPU load step (19 C) plus 4.
- So HEAT_RANK started on the GPU: `governor: decode hop cpu->gpu at token 0 (headroom cpu 42.0 C, npu 8.6 C, gpu 38.0 C, hysteresis 4 C)`.
- It went back to the NPU once the NSP had recovered: `governor: decode hop gpu->npu at token 416 (headroom cpu 41.8 C, npu 28.2 C, gpu 21.3 C ...)`.
- Arm 3 never left the NPU.

## Reading

**On the S23, rule v3 equals the best single leg, the NPU, within noise.**
- Endurance: the same 3 full runs. Time to skin 43 was 434.5 s against 442 s, a difference of 2 %. Both pairs overlap (420-449 against 431-453).
- Speed: within 1 %.

The round-3 headroom governor lost by half (2785 tokens against 6051). Rule v3 removes that loss.

It does not beat the NPU on this phone. The NPU is the best S23 leg on both heat and speed, and the guard has nothing to protect: the `cdsp` cooling device never engaged, and the NSP peaks at 90-96 C. The expected place for a gain is a SoC whose NSP reaches its trip. The 8 Elite is one: QDC #69 had NSP 104 C against a 105 C trip at 25 min. That needs a real 8 Elite phone, not a plugged QDC board.

Caveat: NSP max reached 95-96 C here, above the "82-86 C plateau" read from round 3's means.
