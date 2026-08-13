# Prefill curve — Qwen3.5-2B Q4_K_M · Xiaomi 14 Adreno 750 · UNPLUGGED

Source: on-device `llama-bench` JSONs. `-t 6 -r 2`. GPU = `-ngl 99 -fa off`. CPU = `-ngl 0`.
Cold fadvise between cells. avg_ts from JSON; ratio = GPU/CPU.

| pp | CPU t/s | CPU samples | GPU t/s | GPU samples | GPU/CPU |
|---:|--------:|-------------|--------:|-------------|--------:|
| 128 | 31.459 | 31.763, 31.156 | 181.652 | 184.569, 178.735 | 5.77× |
| 512 | 35.937 | 31.977, 39.898 | 214.485 | 215.040, 213.929 | 5.97× |
| 1024 | 38.449 | 39.738, 37.160 | 216.292 | 216.328, 216.257 | 5.63× |
| 2048 | 51.103 | 53.324, 48.882 | 211.613 | 211.498, 211.727 | 4.14× |

pp128 from phase 3 (`phase3_baseline/`), same binary/device, same evening, UNPLUGGED.

Wall of one timed rep (`avg_ns`, excludes load):

| pp | CPU s | GPU s | saved |
|---:|------:|------:|------:|
| 128 | 4.069 | 0.705 | 3.36 |
| 512 | 14.422 | 2.387 | 12.04 |
| 1024 | 26.663 | 4.734 | 21.93 |
| 2048 | 40.152 | 9.678 | 30.47 |

## Real TTFT (llama-cli, ~4.3 KB fixed prompt, n=16, temp 0, --no-warmup --perf)

This pin does **not** emit `llama_perf_context_print` (same as F3). Timing line is the compact `[ Prompt: X t/s | Generation: Y t/s ]`. n_prompt not printed. Harness `wall_s` = load + prefill + 16 decode (thinking model).

| order | cell | Prompt t/s | Gen t/s | wall_s | batt |
|---|---|---:|---:|---:|---:|
| 1 | CPU | 29.4 | 6.4 | 114 | 96→95 |
| 2 | GPU | 197.5 | 16.5 | 53 | 95→95 |
| 3 | GPU | 204.6 | 13.6 | 83 | 95→95 |
| 4 | CPU | 47.1 | 5.5 | 54 | 95→95 |

Median Prompt t/s: CPU 38.25 · GPU 201.05 · ratio **5.26×**.

## 4B (batt 94% after 2B, gate ≥85%)

| pp | CPU t/s | CPU samples | GPU t/s | GPU samples | GPU/CPU |
|---:|--------:|-------------|--------:|-------------|--------:|
| 512 | 18.402 | 19.168, 17.635 | 85.415 | 87.769, 83.062 | 4.64× |
| 2048 | 11.893 | 11.431, 12.355 | 86.152 | 86.179, 86.124 | 7.25× |

4B GPU holds 86 t/s. 4B CPU regresses at 2048 (RAM pressure, RSS ~11 GiB / 11.4 GiB). Ratio grows because CPU falls, not because GPU scales.

## Battery

2B: 99% → 94%, peak batt 35.6 °C.
4B: 94% → 87%, peak batt 38.1 °C.
Never plugged.

## Verdict

The 5.77× pp128 GPU advantage **holds through 1024** (5.6–6.0×) and **does not grow**. At 2048 CPU jumps to 51 t/s (one `n_batch=2048` shot) and the ratio compresses to 4.14× — GPU still wins, still ~30 s saved on the prefill itself. Product case (docs/RAG ~1k tok): GPU prefill stays ~5.6×; real llama-cli Prompt t/s median 5.26×. 4B confirms the GPU plateau and adds the RAM-pressure caveat at 2k.
