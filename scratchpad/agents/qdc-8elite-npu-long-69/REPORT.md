# Cell #69 — NPU leg alone for 25 min on QDC Snapdragon 8 Elite (QRD8750): what heat does to it

Plugged reference board, no case: this is the SoC and board under a sustained NPU load, not a phone in a hand.
Evidence: `raw/session1-npulong-09a496d71.grep` (legs report, per-minute zone maxima, every cooling-state change),
`raw/sa881661_zones.csv` (every zone and cdsp/gpu cooling state every 2 s), `raw/sa881661_zones_map.txt` (trips).

## Setup

- QDC session 877592 (job tag sa881661), 4:41:18-5:09:08 PM EDT (28 min, Completed), QRD8750 (SM8750, "Sun"), Hexagon v79. Portal by Haiku `37248e18`;
  `connect.sh` by the coordinator; tunnel on 6037 killed by the coordinator.
- Kit `~/kalsa-qdc/npulong-kit-09a496d71.tgz`: governor-bench f72b761b, skel v79 69e92a9e. One-copy NPU leg alone
  (J(1): the Q6_K lm_head runs on the GPU inside the NPU leg), back-to-back 2048-token runs for 1500 s.
- The battery reads a fixed 42.0 C on this board (as in cell #66); the watchdog was set to 48.0 C.

## Result

16 runs of 2048 tokens, all exit 0, no error lines.

| runs | tok/s | when |
|---|---|---|
| 1-5 | 26.2-26.6 | 0-431 s |
| 6-16 | 22.4-22.7 (-14 %) | 431-1500 s, flat |

Zones (max over sensors, C): NSP 33 -> 73 (1 min) -> 85 (4) -> 91 (7) -> 93 (13) -> 101 (20) -> **104 (25), still
rising; NSP trip 105**. GPU 35 -> 72 (7) -> 86 (25). CPU 42 -> 73 (7) -> 87 (25). Board `sys-therm-8` (trip 43.0)
crossed **43.0 at 422 s**; from that sample the **`gpu` cooling device stepped 0 -> 1 -> 3 -> 6 -> 9 -> 10 in 11 s**
and stayed at 10. `cdsp`, `cdsp_hw`, `cdsp_sw_hvx`, `cdsp_sw_hmx` stayed 0 for the whole run.

## Reading

- **The 8 Elite's NPU leg is slowed by the GPU's cooling, not its own.** The -14 % step starts with run 6 (431 s),
  which coincides with the GPU cooling device reaching 10 (433 s). The NPU leg's lm_head runs on the GPU (J(1)), so
  a GPU frequency cap reaches it. The NSP's own cooling never engaged. This is a correlation in one run, not an
  ablation. The ablation would be the same run with the lm_head on the NPU, or with the GPU cap held off.
- **The NSP does reach its trip zone here**, unlike the S23, which plateaus at 82-86 C. It is at 104 C against a
  105 trip after 25 min and still climbing about 1 C every 2-3 min. With guard 5 C, rule v3 would leave the NPU at
  about 20 min (NSP 100-101).
- **What it means for the governor on this SoC.** The guard has real work to do on the 8 Elite, and the board-level
  throttle (sys-therm-8 -> gpu cdev) is a second signal the governor does not watch today. Hopping to the GPU at
  20 min would land on a capped GPU (cdev 10). The real-phone version of this (skin binding) cannot be measured on QDC.
