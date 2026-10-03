# S23: does GPU decode rest the CPU? OpenCL tg256 with 1 vs 5 host threads (2026-10-03)

Why: the owner wants decode to hop CPU <-> NPU <-> GPU, GPU included for short bursts, to spread heat over separate
blocks. The sustained run (`s23-decode-heat-sustained`) showed the GPU decode arm (`-t 5`) keeping the CPU zones at
~90 C, as hot as a CPU arm: in that configuration the GPU does not rest the CPU.

Setup: S23 unplugged, Awake, traced 0, Kalsa stopped once at start (15 s settle), same engine kit and GGUF as
2026-09-28 (SHA256SUMS OK). `llama-bench -p 0 -n 256 -r 1 -fa 1`, GPU `-ngl 99 -dev GPUOpenCL -t {5,1}`, NPU
`-ngl 99 -dev HTP0 -t 1`. Order gpu-t5, gpu-t1, gpu-t5, gpu-t1, npu-t1; 60 s tail; no cool-start gate. Readout: zone
peaks (robust) and the same C·s/token metric (`analyze.py`, `raw/analysis.txt`).

| # | arm | tok/s | peak CPU / GPU / NSP C | battery C·s/tok | skin C·s/tok |
|---|---|---:|---|---:|---:|
| 1 | GPU t5 | 13.97 | 90.3 / 78.1 / 66.9 | 0.429 | 0.556 |
| 2 | GPU t1 | 9.70 | **60.9** / 58.2 / 53.3 | (0.011) | 0.197 |
| 3 | GPU t5 | 12.61 | 91.2 / 78.9 / 67.3 | 0.217 | 0.385 |
| 4 | GPU t1 | 8.55 | **66.8** / 59.0 / 54.1 | (0.000) | 0.105 |
| 5 | NPU t1 | **22.86** | 60.9 / 59.4 / 88.0 | 0.105 | 0.127 |

## Reading

- **With one host thread the GPU does rest the CPU**: CPU zone peak 61-67 C vs 90-91 C at `-t 5`. The 5 host
  threads, not the GPU, were heating the CPU block. Cost: GPU decode drops to 8.6-9.7 tok/s from 12.6-14.0 (-30 %).
- **The NPU at one host thread is the best decode arm measured on the S23**: 22.9 tok/s (21.7 at `-t 5` in the
  sustained run), CPU zone 61 C instead of 75, NSP 88 C, 0.105 / 0.127 battery / skin C·s per token.
- So the "separate blocks" premise holds once host threads are cut: NPU-t1 and GPU-t1 each leave the CPU near
  60 C, so a CPU -> NPU -> GPU rotation can rest each block in turn.

## Caveats

- n=2 per GPU arm, n=1 NPU; tg256 (~11-30 s per arm).
- The battery/skin areas of the t1 arms are biased low: each followed a hot t5 arm, so the phone was cooling
  (battery area ~0). Use the zone peaks, not those areas, for t1. A matched t1-only block is still to measure.
- Speed at t1 for longer decodes (GPU fell to 7.8 tok/s at tg1024 with t5) is unmeasured.
- Engine kit f25f0c1c5; in-app the governor's thread counts are set by the app, not by this bench.
