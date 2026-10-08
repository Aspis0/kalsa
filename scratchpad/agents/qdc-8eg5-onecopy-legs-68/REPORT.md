# Cell #68 — one-copy legs on QDC Snapdragon 8 Elite Gen 5 (SM8850 MRD, correctness)

Plugged QDC device: correctness only, tok/s indicative. Evidence: `raw/session1-legs-09a496d71.grep` (recon, kit sha
check, both legs reports).

## Setup

- QDC session 877564 (job tag sa881633), 4:17:48-4:37:55 PM EDT (20 min, ended in the portal, Completed). Device
  783ee7e5, "Snapdragon 8 Elite Gen 5, Mobile Reference Design, SM8850, Android 16", Adreno 840 (OpenCL compiler
  E031.50.19.14), Hexagon v81. Portal by Haiku `379bce80`; `connect.sh` / `d_run.sh` run by the coordinator; tunnel
  on 6037 killed by the coordinator.
- Kit `~/kalsa-qdc/onecopy-kit-v81-09a496d71.tgz`: governor-bench f72b761b (engine 09a496d71; the later l4_y8 gate,
  e01a61cee, is A7X-only and the 840 is A8X, so this binary takes the same OpenCL routes as the fixed one), skels v81 2f75aa19 + v79 69e92a9e.
- **Run 1 aborted by our own watchdog**: this MRD reports a fixed 45.0 C battery temperature (450 at start and at
  every arm), so the 45.0 C kill fired on G at once and every later arm failed to load the missing reference. The
  script's threshold was raised to 48.0 C (comment says why), the kit rebuilt, and run 2 re-used the same session
  (model already on the device).

## Result (run 2)

| arm | exit | KL mean | KL max | status | tok/s (indicative) |
|---|---|---|---|---|---|
| L (7 hops: cpu 96, gpu 64, npu 95 tokens) | 0 | 0.000049 | 0.001143 | PASS | cpu 20.2, gpu 30.8, npu 26.9 |
| L-npu | 0 | 0.000115 | 0.001730 | PASS | 26.8 |
| L-gpu | 0 | 0.000010 | 0.000108 | PASS | 30.5 |
| L-gpu2 | 0 | 0.000010 | 0.000108 | PASS | 30.6 |
| L-cpu | 0 | 0.000012 | 0.000168 | PASS | 19.7 |
| A-gpu | 0 | 0.000010 | 0.000114 | PASS | - |
| A-j1 | 0 | 0.000115 | 0.001730 | PASS | - |
| V-gpu (E5, 4000 v4 GEMVs) | 0 | 0.000010 | 0.000108 | PASS | 7.8 (per-call check) |

E5: 4000 verified calls, worst 2.285e-05 x RMS, 0 FAIL. No ABORT, refusal or error lines.

## Reading

**The SM8850 row is correct on every leg**, with the same pattern as the 8 Elite (cell #66): GPU legs deterministic
(identical KL across L-gpu, L-gpu2, V-gpu), NPU KL equal to the J(1) reference A-j1. The GPU leg is the fastest leg
on this board (30.5 tok/s vs NPU 26.8, CPU 19.7, plugged). No real-phone gain measurement is possible on QDC.
