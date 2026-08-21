# W5 — OLMoE GPU MoE on S23 Adreno 740 (2026-08-21, unplugged)

**Headline:** on Adreno 740, the GPU MoE path upstream keeps disabled — which we fixed — is **2.17× faster in burst decode** and **~1.5× sustained** vs CPU experts, at **equal-or-lower temperature**. Full offload **ngl=16 stable**. Exploratory, not a ship claim.

The kernels that were 0/80+0/4 before K2 (`kernel_{gemv,gemm}_moe_q{4,5}_k_f32_ns`) are the compute on Arm A. Arm B is the same ngl with `-ncmoe 99` (experts CPU). Binary: noextra `libllama-bench-impl.so` `d2030f23…` on **both** arms (stock extra_bufts would anonymous-repack ~3.5 GiB and re-risk the oomwall). `-fa off`. `LOG_ALLOC` off. TLS after unplug. UNPLUG_GATE **PASS** (`USB powered: false`, `AC powered: false`).

**Caveats (honest):** exploratory **ABBA×2** (8 burst cells); **one** 1B-active model (OLMoE-1B-7B Q4_K_M); **one** device (S23 A740); **A8 tg excluded** (`mWakefulness=Dozing`). Pre-registered **N≥10** (and a second model/device) needed for any ship claim. Do not quote 2.17× as product copy.

## Probe 4→8→12→16 (never 99)

Chosen ngl: **16**. All four lived. No 4 GB MemAvailable cliff. No power-off.

| ngl | tg16 t/s | MemAvailable kB | temp °C | rc |
|---:|---:|---|---:|---:|
| 4 | 13.86 | 5332k → recovered | 28.4 → 29.7 | 0 |
| 8 | 17.51 | ~5.3 GB class | 29.8 | 0 |
| 12 | 22.42 | 5303 → 5422 | 31.0 → 30.8 | 0 |
| **16** | **27.30** | 5400 → 5434 | 31.7 → 32.5 | 0 |

## Burst ABBA×2 — ngl=16, pp128+tg128

Arm A = experts GPU. Arm B = experts CPU.

| seq | arm | pp t/s | tg t/s | temp °C | batt | note |
|---|---|---:|---:|---|---:|---|
| 1 | A | 63.91 | 27.44 | 32.5 → 33.2 | 100 | |
| 2 | B | 41.80 | 12.64 | 33.2 → 34.1 | 100 | |
| 3 | B | 43.27 | 12.65 | 34.1 → 35.1 | 99 | |
| 4 | A | 63.54 | 27.51 | 35.1 → 35.9 | 99 | |
| 5 | A | 63.48 | 27.55 | 35.9 → 36.8 | 99 | |
| 6 | B | 41.38 | 14.06 | 36.8 → 37.2 | 98 | |
| 7 | B | 37.17 | 11.41 | 37.2 → 37.7 | 98 | |
| 8 | A | 61.44 | 15.65 | 37.7 → 38.1 | 98 | **Dozing — tg dropped** |

Means (A8 tg out):

| | pp t/s | tg t/s |
|---|---:|---:|
| A GPU experts | 63.09 (n=4) | **27.50** (n=3) |
| B CPU experts | 40.91 (n=4) | **12.69** (n=4) |
| A/B | 1.54× | **2.17×** |

## Sustain — 4× tg512 / arm (already warm)

| cell | arm | tg512 t/s | temp °C | batt |
|---|---|---:|---|---:|
| 1–4 | A | 15.19, 15.55, 15.61, 14.76 | 37.6 → 39.3 | 98 → 95 |
| 5–8 | B | 10.19, 10.82, 10.04, 10.01 | 39.3 → **40.2** | 95 → 93 |

A mean **15.28 t/s**, B mean **10.26 t/s** → **~1.49×**. A plateau 38–39 °C; B ended hotter. Burst 27.5 → sustain 15.3 on A is length+heat (first A PRE MemFree was 80 MB). GPU experts still faster and not hotter.

Device stayed up. No oomwall. Raw: `runs.csv` + `ab_*.stdout.txt` + `sus_*.stdout.txt`.
