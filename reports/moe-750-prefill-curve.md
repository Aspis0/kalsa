# moe-750-prefill-curve

**Question:** the measured pp128 GPU/CPU = 5.77× (181.7 vs 31.5) — does it hold or grow at product-realistic prompt lengths, and what does that mean for real TTFT?

Date: 2026-08-12 (night)
Device: Xiaomi 14 (`23127PN0CG` / `houji` / SM8650 / Adreno 750), Android 16
Binary: cpufix `kalsa/opencl-q6k-dispatch-fix` @ `a92a51627` (REPACK=OFF, stripped)
  `llama-cli` `4986ff30447cb866656bce6762e6d30266669a2ebc4055a9c2ada00b9e4fdd80`
  `llama-bench` `5092a319dd43a4e62095cc49ce15b329be96d0188734e7380d8935fe56b01ea3`
Model: `Qwen3.5-2B-Q4_K_M.gguf` 1 280 835 840 B (sha `aaf42c8b…`, from S0 / gdn-750)
Optional 4B: `models/draft/Qwen3.5-4B-Q4_K_M.gguf` 2 740 937 888 B sha `00fe7986…` (PC verified)
Artifacts: `results/xiaomi_ab/`
Prior: `reports/moe-gdn-750.md` (correctness + pp128)

S23 (`192.168.1.152`) and Jelly (`192.168.1.82`) were **not** written. S23 4B marathon was live (COOLDOWN then GPU arm) for the whole of task A.

Everything below is **UNPLUGGED**. Every number is from a JSON or log on disk.

## TL;DR

| gate | result |
|---|---|
| Prefill ratio at product lengths | **HOLDS** through 1k (5.6–6.0×). **Does not grow.** Compresses to 4.14× at 2k because CPU jumps, not because GPU dies. |
| GPU pp throughput vs length | plateaus 212–216 t/s from pp512 through pp2048 |
| CPU pp throughput vs length | 31.5 → 35.9 → 38.4 → **51.1** at 2048 (fits in one `n_batch`) |
| Real TTFT ~4.3 KB prompt | compact Prompt t/s median CPU 38.25 / GPU 201.05 = **5.26×**. No `llama_perf_context_print` on this pin. |
| 4B pair | **first attempt DISCARDED (owner was using the phone).** Clean redo in progress 2026-08-13T05:32 UNPLUGGED 73% — pp512/1024/2048 + TTFT. Do not cite the 00:00–00:18 numbers. |

**Product one-liner:** on this 750, GPU prefill is a real ~5.6× win on 2B Q4_K_M at document/RAG (~1k tok). It is already saturated at pp128–pp512. Do not sell “it gets better on long prompts.” At 2k the ratio shrinks because the CPU batch fills, not because the GPU falls over.

## 0. Method

- `-t 6` from `cpu_capacity ≥ 50%` on this SM8650: `379 379 923 923 923 867 867 1024` → cores cpu2–cpu7. Same as S0 / `moe-gdn-750.md`.
- `llama-bench -r 2 -n 0` (prefill only) at `-p 512/1024/2048`, CPU (`-ngl 0`) then GPU (`-ngl 99 -fa off`) per size.
- Cold `posix_fadvise(DONTNEED)` via on-device `fadv` (NDK 27.1, dynamic — static rejected by Bionic TLS align) between every cell. First 2B fadv: `resident_before=291611 resident_after=0`.
- pp128 reused from phase 3 same evening, same binary, also UNPLUGGED (`results/xiaomi_ab/phase3_baseline/`).
- Real TTFT: `llama-cli -f` a fixed 4335-byte excerpt of `reports/research-adreno750.md` (sha `c3faee01…`), `-n 16 --temp 0 -c 2048 -no-cnv -st --perf --no-warmup --no-display-prompt`, ABBA CPU/GPU/GPU/CPU.
- Battery notes: `results/xiaomi_ab/task_a/battery_notes.txt` (pulled with the JSONs). Start 99% / 27.9 °C, AC/USB/Wireless false.

## 1. Prefill curve (2B)

`avg_ts` from each `llama-bench -o json`. Ratio = GPU/CPU on that row.

| pp | CPU t/s | CPU samples | GPU t/s | GPU samples | GPU/CPU | JSON |
|---:|--------:|-------------|--------:|-------------|--------:|---|
| 128 | 31.459 | 31.763, 31.156 | 181.652 | 184.569, 178.735 | **5.77×** | phase3_baseline |
| 512 | 35.937 | 31.977, 39.898 | 214.485 | 215.040, 213.929 | **5.97×** | task_a/bench_*_pp512.json |
| 1024 | 38.449 | 39.738, 37.160 | 216.292 | 216.328, 216.257 | **5.63×** | task_a/bench_*_pp1024.json |
| 2048 | 51.103 | 53.324, 48.882 | 211.613 | 211.498, 211.727 | **4.14×** | task_a/bench_*_pp2048.json |

Wall implied by `avg_ns` (one timed rep, not including load):

| pp | CPU s | GPU s | Δ saved |
|---:|------:|------:|--------:|
| 128 | 4.069 | 0.705 | 3.36 s |
| 512 | 14.422 | 2.387 | 12.04 s |
| 1024 | 26.663 | 4.734 | 21.93 s |
| 2048 | 40.152 | 9.678 | 30.47 s |

### Curve verdict

GPU/CPU **holds through the product 1k-token case, it does not grow.** GPU saturates 212–216 t/s from pp512 through pp2048 (pp1024 samples differ by 0.07 t/s). CPU keeps climbing (31.5 → 35.9 → 38.4) and then jumps to 51.1 at pp2048, which is exactly `n_batch=2048` — one shot, better CPU GEMM occupancy. That is why the ratio *compresses* to 4.14× at 2k. GPU did not regress (211.6 vs 216.3).

CPU pp512 sample spread (32.0 vs 39.9) is real — do not over-read the 5.97× peak. The honest 128–1024 band is **5.6–6.0×**.

For documents/RAG (~1k tok) the product statement is: **GPU prefill stays ~5.6× CPU**, ~22 s saved on the prefill itself before load. At 2k the save is still ~30 s (4.1×).

## 2. Real TTFT (~4.3 KB fixed prompt)

Prompt: `results/xiaomi_ab/prompts/ttft_2b_1000.txt` (4335 B, sha `c3faee01…`), contiguous excerpt of `reports/research-adreno750.md` from `## 0. Hardware map`. Intended ~1000 Qwen tokens; this pin does **not** print `n_prompt`.

`llama-cli -f … -n 16 --temp 0 -c 2048 -t 6 -no-cnv -st --perf --no-warmup --no-display-prompt`. ABBA CPU/GPU/GPU/CPU. Cold fadvise each run.

**This pin does not emit `llama_perf_context_print`** (same finding as `moe-f3.md`). The timing line is the compact `[ Prompt: X t/s | Generation: Y t/s ]`. Qwen3.5 entered thinking mode (`[Start thinking]`); the 16 generated tokens are thinking tokens, not the answer. Harness `wall_s` = load + prefill + 16 decode — **not** isolated TTFT.

| order | cell | Prompt t/s | Gen t/s | wall_s | log |
|---:|---|---:|---:|---:|---|
| 1 | CPU | 29.4 | 6.4 | 114 | `ttft_cpu_rep1.out` |
| 2 | GPU | 197.5 | 16.5 | 53 | `ttft_gpu_rep2.out` |
| 3 | GPU | 204.6 | 13.6 | 83 | `ttft_gpu_rep3.out` |
| 4 | CPU | 47.1 | 5.5 | 54 | `ttft_cpu_rep4.out` |

Median Prompt t/s: CPU **38.25** · GPU **201.05** · ratio **5.26×**. Matches the llama-bench 1k band (5.63×). CPU Prompt t/s is noisy (29.4 vs 47.1) — same class of variance as bench pp512. GPU Prompt t/s is tight and ~7% below bench pp1024 (216), which is the expected llama-cli vs llama-bench gap (chat template, no ubatch-only path).

Do **not** cite harness wall as TTFT. First CPU wall (114 s) paid a colder start; later CPU wall (54 s) is in the same band as GPU walls (53 / 83). Isolated prefill time is `n_prompt / Prompt_t/s`; without `n_prompt` on this pin that number is not on disk. The **rate** is on disk and is the comparable quantity.

## 3. 4B pair — first attempt discarded, clean redo in progress

Gate after 2B: batt **94%** UNPLUGGED (floor 85%). Model already on device
(`Qwen3.5-4B-Q4_K_M.gguf` 2 740 937 888 B, on-device sha `00fe7986…` MATCH).

**First 4B attempt (00:00:10–00:18:52, pp512+pp2048 only) is CONTAMINATED.**
The owner was using the phone (interactive foreground). Those JSONs stay on
disk under `results/xiaomi_ab/task_a/` with `CONTAMINATED_4B.md`. They are
**not** product numbers. Do not cite 18.4 / 85.4 / 11.9 / 86.2 from that window.

**Clean redo** started 2026-08-13T05:32, phone confirmed free, UNPLUGGED 73% /
28.9 °C, same `-t 6 -r 2 -n 0`, now **pp512 / pp1024 / pp2048** + TTFT ABBA
on the same 4335-byte prompt as 2B. Logs: `results/xiaomi_ab/task_a_4b_clean/`
(device `/data/local/tmp/gdn_750/logs/task_a_4b_clean/`). Table will be filled
from those JSONs when the harness exits.

| pp | CPU t/s | CPU samples | GPU t/s | GPU samples | GPU/CPU | JSON |
|---:|--------:|-------------|--------:|-------------|--------:|---|
| 512 | — | clean redo running | — | — | — | task_a_4b_clean/bench_4b_*_pp512.json |
| 1024 | — | clean redo running | — | — | — | task_a_4b_clean/bench_4b_*_pp1024.json |
| 2048 | — | clean redo running | — | — | — | task_a_4b_clean/bench_4b_*_pp2048.json |

## 4. Caveats

- Phase-3 pp128 and tonight's 512/1024/2048 are the same device/binary/unplugged policy, but not the same thermal/battery minute. pp128 is still the right baseline; do not treat the whole table as one ABBA.
- `llama-bench` still inits OpenCL on the CPU cell (stderr `ggml_opencl: selected platform`). That costs wall-clock on the harness, not `avg_ts`.
- FA is off. FA-auto dies on this 750 (`moe-gdn-750.md`). These numbers are the shipping OpenCL path, not a hypothetical shuffle-xor path.
- 2B Q4_K_M is the correctness-gated model, not the premium 35B. The 35B number is task B (CPU streaming), not this GPU curve.
- llama-cli TTFT: no `llama_perf_context_print`, no `n_prompt`, thinking-mode n=16. Cite Prompt t/s, not wall.
- Never measured plugged. Nothing deleted.

## 5. Battery log (2B complete)

| mark | batt% | batt temp °C | plugged |
|---|---:|---:|---|
| start | 99 | 27.9 | UNPLUGGED |
| after cpu_pp512 | 99 | 29.0 | UNPLUGGED |
| after gpu_pp512 | 99 | 29.0 | UNPLUGGED |
| after cpu_pp1024 | 98 | 31.8 | UNPLUGGED |
| after gpu_pp1024 | 98 | 31.9 | UNPLUGGED |
| after cpu_pp2048 | 97 | 35.5 | UNPLUGGED |
| after gpu_pp2048 | 96 | 35.6 | UNPLUGGED |
| after TTFT ABBA | 94 | 35.1 | UNPLUGGED |
| 4B start (contaminated) | 94 | 32.8 | UNPLUGGED |
| 4B end (contaminated) | 87 | 36.5 | UNPLUGGED |
| 4B clean redo start | 73 | 28.9 | UNPLUGGED |

Source: `results/xiaomi_ab/task_a/battery_notes.txt` (2B + contaminated 4B) and
`results/xiaomi_ab/task_a_4b_clean/battery_notes.txt` (clean redo). Peak SoC
thermal zone during 2B: `max_therm_mC=67100` after cpu_pp2048. 2B battery temp
never above 35.6 °C. The 4B 94%→87% window is the contaminated attempt — kept
only as a battery-drain hint, not as a product thermal claim.
