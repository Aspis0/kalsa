# q58 numeric report

## per-run

| n | engine | rep | ΔT_prompt_C | MAX_C | wall_s | t/s | execute-op / offload | thermal pre/post |
|---:|:---:|---:|---:|---:|---:|---:|:---|:---:|
| 128 | NPU | 1 | 0.400 | 27.300 | 16.950 | 75.783 | 1764 / offloaded 33/33 layers to GPU | 0/0 |
| 128 | CPU | 1 | 3.800 | 28.900 | 53.136 | 6.007 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 128 | CPU | 2 | 0.000 | 31.100 | 18.209 | 38.686 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 128 | NPU | 2 | 0.600 | 31.700 | 15.483 | 73.646 | 1764 / offloaded 33/33 layers to GPU | 0/0 |
| 512 | NPU | 1 | 0.000 | 31.700 | 20.066 | 126.082 | 1764 / offloaded 33/33 layers to GPU | 0/0 |
| 512 | CPU | 1 | 3.000 | 34.300 | 63.774 | 19.289 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 512 | CPU | 2 | 3.500 | 35.000 | 63.707 | 19.227 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 512 | NPU | 2 | 0.000 | 31.800 | 19.289 | 128.802 | 1764 / offloaded 33/33 layers to GPU | 0/0 |
| 1024 | NPU | 1 | 0.800 | 32.600 | 28.201 | 127.868 | 3430 / offloaded 33/33 layers to GPU | 0/0 |
| 1024 | CPU | 1 | 3.300 | 35.300 | 181.904 | 23.942 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 1024 | CPU | 2 | 3.200 | 35.000 | 187.293 | 28.213 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 1024 | NPU | 2 | 1.400 | 33.100 | 87.907 | 82.507 | 3430 / offloaded 33/33 layers to GPU | 0/0 |
| 2048 | NPU | 1 | 2.100 | 34.100 | 111.024 | 92.171 | 6762 / offloaded 33/33 layers to GPU | 0/0 |
| 2048 | CPU | 1 | 5.300 | 36.900 | 378.454 | 25.006 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 2048 | CPU | 2 | 5.000 | 37.200 | 375.252 | 25.478 | 0 / offloaded 0/33 layers to GPU | 0/0 |
| 2048 | NPU | 2 | 2.300 | 34.400 | 134.888 | 84.396 | 6762 / offloaded 33/33 layers to GPU | 0/0 |

## per-size means

| n | engine | runs | mean ΔT_prompt_C | mean MAX_C | mean wall_s | mean t/s | °C/1k tokens | s/1k tokens |
|---:|:---:|---:|---:|---:|---:|---:|---:|---:|
| 128 | NPU | 2 | 0.500 | 29.500 | 16.216 | 74.715 | 3.906 | 13.387 |
| 128 | CPU | 2 | 1.900 | 30.000 | 35.672 | 22.347 | 14.844 | 96.155 |
| 512 | NPU | 2 | 0.000 | 31.750 | 19.678 | 127.442 | 0.000 | 7.848 |
| 512 | CPU | 2 | 3.250 | 34.650 | 63.740 | 19.258 | 6.348 | 51.927 |
| 1024 | NPU | 2 | 1.100 | 32.850 | 58.054 | 105.187 | 1.074 | 9.970 |
| 1024 | CPU | 2 | 3.250 | 35.150 | 184.599 | 26.077 | 3.174 | 38.606 |
| 2048 | NPU | 2 | 2.200 | 34.250 | 122.956 | 88.284 | 1.074 | 11.349 |
| 2048 | CPU | 2 | 5.150 | 37.050 | 376.853 | 25.242 | 2.515 | 39.620 |

## frozen derivations

N_max(NPU) = 512 tokens
max ΔT_prompt over individual NPU runs at n ≤ N_max = 0.600 °C
thermal-threshold candidate = 40.0 − 0.600 = 39.400 °C

## battery start/end

start level/temp/voltage = 81% / 26.9 °C / 4132 mV
end level/temp/voltage = 68% / 34.3 °C / 3995 mV

## thermalservice

Thermal Status pre/post observed = [0] / [0]
current numeric headroom = NOT_EXPOSED
headroom thresholds = NaN, 0.8666667, 0.93333334, 1.0, 1.1333333, 1.4333333, 2.4333334

## crash signature

NONE

## Corrections applied after audit (REVIEW_DOC.md, BANK-with-corrections)
1. Thermal-threshold candidate: the report's 39.4 °C used the individual-max ΔT (0.6); the
   PREREG formula uses sizes ≤ N_max with their MEAN ΔT → 40.0 − 0.5 = **39.5 °C** is the value
   banked (both retained in manifest; 39.5 is the labelled one).
2. Metric labels: ΔT, wall, "°C/1k" and "s/1k" are PER-PROCESS numbers (they include HTP
   session allocation + model materialization on the NPU arm, mmap load on the CPU arm). Load
   share of wall: ~46–49 % at n=128, ~22–25 % at n=2048. Prompt-only wall (from stderr
   timestamps): NPU 1.7 s vs CPU 12.3 s at n=128; NPU 23.2 s vs CPU 81.6 s at n=2048 — the NPU
   advantage holds at every size after deconfounding; the confound penalizes the NPU arm.
3. Anomaly: n128_cpu_1 = cold mmap + first-eval penalty (load 26.2 s + prompt 21.4 s; t/s 6.0
   vs 38.7 on the second CPU rep). Recorded; does not affect the NPU verdict.
