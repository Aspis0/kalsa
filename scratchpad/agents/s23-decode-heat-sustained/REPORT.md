# S23 sustained decode heat per backend: CPU vs NPU vs GPU, tg1024 (2026-10-03)

Owner question 2026-10-03: "quando usiamo la GPU? ... Forse solo in decode? Ma siamo sicuri che sia più fresca?"
The 2026-09-28 run (`s23-backend-hopping-heat`) already measured decode heat at tg256 (~12 s runs): CPU 0.20,
GPU 0.43, NPU 0.14 battery C·s/token, with CPU and NPU ranges overlapping. This run makes each arm 4x longer.

Setup: Galaxy S23 (SM8550, Adreno 740, Hexagon v73), UNPLUGGED, Awake, traced 0, Kalsa force-stopped once at
session start (15 s settle). Same engine kit as 2026-09-28 (`/data/local/tmp/heat3way`, SHA256SUMS OK; llama-bench
sha256 5b52c79f..., ship GGUF a247afd6...). `llama-bench -p 0 -n 1024 -r 1 -t 5 -fa 1`, CPU `-ngl 0 -dev none`,
GPU `-ngl 99 -dev GPUOpenCL`, NPU `-ngl 99 -dev HTP0`. Latin-square order cpu,npu,gpu,npu,gpu,cpu,gpu,cpu,npu, NO
cool-start gate (owner rule 2026-09-25), 90 s tail per arm, 1 Hz sampler (HAL BAT + SKIN + CPU/GPU/NSP zones).
Metric as 2026-09-28: temperature area above the arm's start sample, START -> TAIL_END, divided by 1024 tokens
(`analyze.py`, output `raw/analysis.txt`). A first attempt is VOID (arm 1 hung 400 s at FastRPC init: the per-arm
force-stop of the app raced the DSP's release of the app's session; fixed by stopping the app once up front).

## Result: 5 valid arms; the session stopped itself at Android thermal status 3 (SEVERE) during arm 6 (CPU)

| # | arm | tok/s | battery start C | battery C·s/token | skin C·s/token | zone peaks CPU / GPU / NSP C |
|---|---|---:|---:|---:|---:|---|
| 1 | CPU-1 | 19.87 | 35.4 | 0.302 | 0.392 | 91.6 / 72.9 / 69.2 |
| 2 | NPU-1 | 21.79 | 37.1 | 0.148 | 0.172 | 74.5 / 66.6 / 94.3 |
| 3 | GPU-1 | 7.85 | 37.8 | 0.348 | 0.459 | 90.3 / 79.6 / 68.0 |
| 4 | NPU-2 | 21.68 | 38.4 | 0.166 | 0.197 | 75.3 / 67.4 / 95.1 |
| 5 | GPU-2 | 7.82 | 38.7 | 0.418 | 0.461 | 90.8 / 80.0 / 69.6 |
| 6 | CPU-2 | (17.62) | 39.7 | VOID | VOID | thermal status 3 hit, tail cut |

## Reading

- **GPU decode is the worst backend on every axis, and it degrades with length**: 7.8 tok/s at tg1024 (14.0 at
  tg256 on 2026-09-28) for 0.35-0.42 battery C·s/token, 2.2-2.8x the NPU. It also keeps the CPU zones at 90 C
  (host threads busy), so it heats both blocks. No case for GPU decode on the S23.
- **NPU decode is the fastest and the coolest when sustained**: 21.7 tok/s vs CPU 19.9 (CPU-2 17.6, throttling),
  0.148/0.166 vs CPU 0.302 battery C·s/token (about half), skin 0.17-0.20 vs 0.39. The NPU arms' CPU zones peak at
  75 C instead of 91.
- **CPU sustained decode drives the phone to SEVERE**: the only thermal-status-3 event came during a CPU arm
  (battery 41.7 C), consistent with `s23-cpu-only-throttles-to-unusable-under-load`.

## Caveats (stated, not hidden)

- CPU has ONE valid arm (n=1); NPU and GPU n=2. The NPU-vs-CPU gap is large (2x) but rests on one CPU arm.
- No cool-start gate: CPU-1 started coolest (35.4 C) and later arms warmer; a cooler start leaves more headroom to
  rise, which can inflate CPU-1's area. NPU-2 started at 38.4 C and still read 0.166, and the zone peaks (CPU 91 vs
  75) point the same way, but order is not fully balanced with 5 arms.
- Heat is a temperature-area proxy, not energy: Joules per token are still unmeasured on any backend.
- Engine kit f25f0c1c5 (2026-09-28), not today's engine; the decode kernels did not change in this campaign.
