# Cell #72 — one-copy legs with the upstream-b11514 merge engine on three QDC Snapdragons (correctness)

The QDC devices are plugged reference boards, so this cell is correctness only; tok/s are indicative.

Evidence in `raw/`, one set per job tag (`legs_report_*.grep`, `recon_*.grep`, `kit_verify_*.grep`):
- sa881954 = SM8650;
- sa881964 = SM8850;
- sa881973 = SM8750, plus its aborted run 1, `legs_report_sa881973-run1-watchdog48.grep`.

## Setup

- **Engine 23b2a44d7.** It is the merge 904d38fad (upstream b11514 merged into e01a61cee), plus the audit fixes 35233cf8e and 23b2a44d7.
- **Kit `~/kalsa-qdc/merge-kit-23b2a44d7.tgz`.**
  - governor-bench 50f33830: a static `build-ls-and` build, made with the documented recipe (`~/Projects/kalsa-artifacts-b11514/BUILD.txt`).
  - Release skels from the merge: v73 eb78db49, v75 938e432b, v79 9473449b, v81 ac06db24.
  - The kit sha check was OK on every device.
- **Arms:** the same as cells #66/#68/#71.
- **People:**
  - portal by Haiku `dcc02e1d`;
  - `connect.sh` and `d_run.sh` run by the coordinator, who also killed the tunnel on 6037 after each device.
- **Sessions (all Completed):**
  - 877885: QRD8650, SM8650, Adreno 750, v75. 11:36-11:50 PM EDT, 2026-10-08.
  - 877895: SM8850 MRD, Adreno 840, v81. 11:56 PM-12:09 AM.
  - 877904: QRD8750, SM8750, Adreno 830, v79. From 12:11 AM.
- **8 Elite run 1 was aborted by our own watchdog.**
  - This QRD8750 reports a fixed 48.0 C battery temperature. The QRD8750 of cells #66/#69 read 42.0 C.
  - So G was killed at once, and every later arm lacked its reference.
  - The QDC watchdog went to 52.0 C (comment in `run-legs.sh` says why), the kit was repacked, and run 2 reused the session.

## Result (KL mean / max; every arm exit 0, status PASS, no ABORT/refusal/error lines)

| arm | SM8650 (750, v75) | SM8850 (840, v81) | SM8750 (830, v79) |
|---|---|---|---|
| L (hops every 32 over 256) | 0.000017 / 0.000389 | 0.000049 / 0.001143 | 0.000049 / 0.001143 |
| L-npu | 0.000022 / 0.000434 | 0.000115 / 0.001730 | 0.000115 / 0.001730 |
| L-gpu = L-gpu2 = V-gpu | 0.000010 / 0.000431 (V 0.000428) | 0.000010 / 0.000108 | 0.000010 / 0.000108 |
| L-cpu | 0.000012 / 0.000199 | 0.000012 / 0.000168 | 0.000012 / 0.000168 |
| A-gpu | 0.000012 / 0.000510 | 0.000010 / 0.000114 | 0.000010 / 0.000114 |
| A-j1 (= L-npu reference) | 0.000022 / 0.000434 | 0.000115 / 0.001730 | 0.000115 / 0.001730 |
| E5 (4000 v4 GEMV calls, worst x RMS) | 2.208e-05 | 2.285e-05 | 2.285e-05 |
| tok/s npu / gpu / cpu (alone, indicative) | 24.1 / 23.4 / 13.5 | 27.1 / 30.6 / 19.2 | 26.7 / 28.9 / 26.5 |

## Reading

**The merged engine is correct on every leg on all three QDC Snapdragons**, as it is on the real S23 (cell #73).

Against the pre-merge cells:
- **SM8850:** KL is identical to #68.
- **SM8650:** the GPU KL of 1e-5 matches #71, and the GPU speed is the same (23.4 tok/s).
- **NPU legs:** KL equals the J(1) reference on every board.

The upstream b11514 merge and the audit fixes change no one-copy leg's correctness on v73/v75/v79/v81, or on Adreno 740/750/830/840.
