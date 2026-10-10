# Cell 77: does COOLMODE pacing lower the temperature, and does a paced NPU cool more than a paced GPU? (S23, 2026-10-10)

Owner question, 2026-10-09: does throttling lower the temperature, and does a throttled NPU heat less than a throttled GPU?

## Answer

1. **Pacing lowers the heating rate.** The NPU at duty 0.5 warmed the skin at 0.48 C/min. The same NPU at full speed warmed it at 1.54 C/min, 3.2x faster.
2. **Pacing does not lower the heat per token.** Every arm rose about 2.0 C per 1000 tokens. Pacing spreads the same heat over twice the time, so the phone sheds it as it goes. That is what makes the rate sustainable.
3. **NPU and GPU paced are indistinguishable here.** At duty 0.5 they show the same skin slope (0.48 vs 0.49 C/min), the same rise per 1k tokens (2.08 vs 2.02 C) and the same battery rise (+6.5 vs +6.3 C).
   - The GPU arm started 3.1 C warmer.
   - It decoded more slowly: 6.4 vs 7.2 tok/s paced.
   - On this phone, at this duty, the paced NPU was not measurably cooler than the paced GPU in skin terms.

## Setup

| | |
|---|---|
| Device | S23 (SM8550), unplugged |
| Battery | 100 % at start, 90 % at end |
| `persist.traced.enable` | 0 |
| Bench | `governor-bench` `bd26f1b2` (engine `965e8e560`: pacing, bench flags) |
| Skel | `eb78db49` |
| Model | `ship.gguf` `a247afd6` (LFM2 2.6B) |
| One-copy env | Same as cells 73-76 |

Per arm:
- arm L, one rep of up to 4096 tokens;
- `--legs npu|gpu`;
- for the paced arms, `--coolmode-duty 0.5 --platform-status 3`, where status 3 floors the governor to COOLMODE;
- each arm capped at 600 s or skin 43 C;
- a 10 s sampler logs HAL SKIN, battery, Android status and MemAvailable (`run-s23-paced.sh`).

## Results (`raw/paced_*.csv`, `raw/paced_report.grep`)

| arm | decode tok/s | tokens | skin start -> end | slope, 60 s to end | skin rise / 1k tok | max Android status | min MemAvailable |
|---|---|---|---|---|---|---|---|
| npu-paced (duty 0.5) | 7.15 | 2976 in 600 s | 28.8 -> 35.0 | **0.48 C/min** | 2.08 C | 0 | 1.20 GB |
| gpu-paced (duty 0.5) | 6.40 | 2976 in 600 s | 31.9 -> 37.9 | **0.49 C/min** | 2.02 C | 0 | 1.18 GB |
| npu-full | 15.43 | 4065 in 270 s | 31.8 -> 40.0 | **1.54 C/min** | 2.02 C | 1 | 1.21 GB |

How the table is built:
- Tokens and decode time are summed from the complete `leg_window` lines in each log.
- The paced arms were stopped at 600 s (exit 143). Their last stdout buffer was lost, so their token counts are a lower bound, about 1 % short.
- npu-full finished its 4096 tokens: `leg_summary` shows 15.55 tok/s.

## Caveats

- **Warm starts.** The cool-wait gate compares the integer part of the skin temperature, so 31.9 C passed the "<= 31" bar. The GPU and npu-full arms started about 3 C warmer than npu-paced, which favours the warmer arm on slope because it sheds more heat. Compare slopes and per-token rise, not end temperatures.
- **Sample size.** One run per arm.
- **Measurement window.** Skin is the measure that matters to the user. The per-component headroom (NPU 22 C, GPU 33 C at SEVERE in G2) is not what this cell measured.
- **Pacing on the GPU.** At duty 0.5 the GPU spends half its time idle too. Whether the GPU's higher heat per token on the Xiaomi (cell 76: 3.2 vs NPU 1.1 per 1k tokens) shows up on the S23 at full speed is not tested here.

## Attempt 1 (2026-10-09): a memory hard reset, not heat

The first attempt ran `-r 20`:
- The paced NPU decoded 2048 tokens at 7.5 tok/s, with skin 29.3 -> 36.0 and status 0.
- The S23 then hard-reset during the next rep's model load in the same process. The bootloader log shows `PonReason.HARD_RESET = 1` and `RebootReason 0x4` (`raw/attempt1-reset-reason.grep`), the same signature as the 2026-10-07/08 resets.
- A repro afterwards (`raw/mem77b-repro2.csv`): one one-copy NPU load drops MemAvailable from about 5 GB to about 0.9 GB in 15 s, while the bench's RssAnon is about 90 MB. The rpcmem memory sits outside the process RSS. Two short reps did not reset.

The script now runs one rep per arm and kills the bench below 500 MB MemAvailable. The arms above bottomed at about 1.2 GB.
