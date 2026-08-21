# KEXP #14 exploratory — S23 speed cell (NOT ship)

**Label: EXPLORATORY.** Not part of the OLMoE N≥5 1.30× median. Date 2026-08-21.

## Protocol

ABBA × 3 tg512 if battery allows (v1.2 amendment: was 2, 3 if battery allows). `-fa off -t 4`. PC-side `adb shell`.

| arm | flags | experts |
|---|---|---|
| A | `-ngl 99` | GPU (`n_cpu_moe=0`) |
| B | `-ngl 99 -ncmoe 99` | CPU |

## Pins (on-device, every cell)

| artifact | sha256 |
|---|---|
| `libggml-opencl.so` (q6k cherry, q2_K/q3_K MoE + q6_K dense) | `b9d99fa8d8be3e40661fb2edbde27229d8666fcc58c481cbb0944dd0cfd36773` |
| noextra `libllama-bench-impl.so` | `d2030f23db3b4f62f6934c9de831050e71e87c7cfda6e5059d53099ec8b60346` |
| `llama-bench` stub | `b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c` |
| LFM2.5-8B-A1B-KEXP.gguf | `b07c80870f8a864549f4a419ccbfb4d4282ba2d55a2e8d808b7c377d3fc6c3f4` |

Did **not** push stock extra_bufts `bad17952…` from `build-android-opencl-s3oracle/bin/libllama-bench-impl.so`. Kernels live in opencl `.so`; extra_bufts is the oomwall.

## Result (2 complete ABBA; block 3 not run)

ngl=99 experts-GPU **lived**. Block 1 started at 44% (≥40). Block 2 started at 40%. SOC crossed 40% mid-block 2; block finished; block 3 not started (37% < floor). Owner: 2 ABBA acceptable if recharge would eat the session. Exploratory median A 13.740 / B 7.582 = **1.812×**. Not ship.

See `runs.csv` and `scratchpad/agents/n10-kexp-session/REPORT.md`. Pause record: `../olmoe_gpu_moe_s23/n10/pauses/pause_block03_20260821_183837.json`.
