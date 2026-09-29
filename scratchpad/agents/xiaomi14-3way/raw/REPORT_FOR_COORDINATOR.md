# Xiaomi 14 CLI benchmark — coordinator report

Run completed on 2026-09-29 using the Xiaomi 14 (SM8650, Adreno 750, Hexagon v75). I used the CLI kit only; the Kalsa app was not run. All six A arms and nine B arms completed with exit code 0 and no safety stop ([A complete](</tmp/xiaomi-3way/session-events.log:261>), [B complete](</tmp/xiaomi-3way/session-events.log:636>), [session end](</tmp/xiaomi-3way/session-events.log:638>)).

## Kit and preflight

- Kit: [`/Users/marco/kalsa-qdc/f25-v75-kit`](</Users/marco/kalsa-qdc/f25-v75-kit>), from f25f0c1c5. It has statically linked CLI binaries and only the versioned HTP skels in `lib/`; I used this kit alone. The device SHA check passed for both binaries and all four skels ([manifest result](</tmp/xiaomi-3way/device-kit-shas-recheck.log>)). v75 skel SHA256: `215a2fbf3401e6995a9e008fe115b2466d50396ca09d2766d70a5afa96a3d6d5` ([kit manifest line 4](</Users/marco/kalsa-qdc/f25-v75-kit/SHA256SUMS:4>)). Runtime used `ADSP_LIBRARY_PATH=$D/lib`; `LD_LIBRARY_PATH` was unset.
- Ship model SHA256 `a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03` and prompt SHA256 `2a4b5deaa3f4eefc5a878278184dcb6ba397f376c82395368f5126d9967d0ea1` matched on-device ([hash lines](</tmp/xiaomi-3way/device-input-shas.log:1>) / [line 2](</tmp/xiaomi-3way/device-input-shas.log:2>)). Prompt file: 3,833 bytes, 1,010 tokens.
- `--list-devices` reports GPUOpenCL/Adreno 750 and HTP0/Hexagon ([lines 2–4](</tmp/xiaomi-3way/device-list-recheck.log:2>)). It does not list CPU; the CPU path was confirmed with a short `-dev none -ngl 0` smoke run and zero GPU offload ([CPU buffer and placement](</tmp/xiaomi-3way/cpu-route-proof.log:1736>)). The HTP preflight opened `libggml-htp-v75.so` and reported an HTP0 model buffer of 1,525.87 MiB ([session](</tmp/xiaomi-3way/htp-v75-proof.log:272>), [buffer](</tmp/xiaomi-3way/htp-v75-proof.log:12283>)). Per-arm backend proofs are quoted in [quoted-result-lines.md](</tmp/xiaomi-3way/quoted-result-lines.md>).

## A — 3-way completion

Order: CPU, GPU, HTP, HTP, GPU, CPU. Each run used the verified 1,010-token prompt, `-n 127`, greedy sampling, and 126 decode runs. Values below point to the actual completion log lines; every arm exited 0.

| Arm | Route | Prompt / generated tokens | Prefill | Decode | Exit |
|---|---|---:|---:|---:|---:|
| `A-cpu-1` | CPU (`-ngl 0`) ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:204>), [eval](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:205>)) | 7474.35 ms ([line](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:204>)) | 27.73 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:205>)) | [0](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:214>) |
| `A-gpu-1` | GPUOpenCL / Adreno 750 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:203>), [eval](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:204>)) | 6875.73 ms ([line](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:203>)) | 13.21 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:204>)) | [0](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:212>) |
| `A-npu-1` | HTP0 / v75 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:183>), [eval](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:184>)) | 1467.37 ms ([line](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:183>)) | 15.84 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:184>)) | [0](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:191>) |
| `A-npu-2` | HTP0 / v75 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:183>), [eval](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:184>)) | 1428.57 ms ([line](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:183>)) | 16.64 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:184>)) | [0](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:191>) |
| `A-gpu-2` | GPUOpenCL / Adreno 750 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:203>), [eval](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:204>)) | 6834.82 ms ([line](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:203>)) | 13.31 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:204>)) | [0](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:212>) |
| `A-cpu-2` | CPU (`-ngl 0`) ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 1010 / 126 ([prompt](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:204>), [eval](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:205>)) | 7610.82 ms ([line](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:204>)) | 27.33 tok/s ([line](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:205>)) | [0](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:214>) |

## B — nine-arm tg256 decode

Order: CPU, GPU, HTP, GPU, HTP, CPU, HTP, CPU, GPU. Each arm used `llama-bench -p 0 -n 256 -r 1 -t 5 --no-warmup -o md`; there was no cool-start gate. `commands.tsv` preserves every CLI argument vector.

| Arm | Route | Prompt / generated tokens | tg256 tok/s | Exit |
|---|---|---:|---:|---:|
| `B-cpu-1` | CPU (`dev=none`) ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:8>)) | 29.31 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-cpu-1.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-cpu-1.log:16>) |
| `B-gpu-1` | GPUOpenCL / Adreno 750 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:11>)) | 17.23 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-gpu-1.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-gpu-1.log:16>) |
| `B-npu-1` | HTP0 / v75 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:14>)) | 24.09 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-npu-1.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-npu-1.log:16>) |
| `B-gpu-2` | GPUOpenCL / Adreno 750 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:12>)) | 15.49 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-gpu-2.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-gpu-2.log:16>) |
| `B-npu-2` | HTP0 / v75 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:15>)) | 23.33 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-npu-2.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-npu-2.log:16>) |
| `B-cpu-2` | CPU (`dev=none`) ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:9>)) | 29.17 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-cpu-2.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-cpu-2.log:16>) |
| `B-npu-3` | HTP0 / v75 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:16>)) | 23.17 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-npu-3.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-npu-3.log:16>) |
| `B-cpu-3` | CPU (`dev=none`) ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:10>)) | 29.21 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-cpu-3.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-cpu-3.log:16>) |
| `B-gpu-3` | GPUOpenCL / Adreno 750 ([proof excerpts](</tmp/xiaomi-3way/quoted-result-lines.md>)) | 0 / 256 ([command](</tmp/xiaomi-3way/commands.tsv:13>)) | 14.55 tok/s ([bench row](</tmp/xiaomi-3way/arm-logs/B-gpu-3.log:13>)) | [0](</tmp/xiaomi-3way/arm-logs/B-gpu-3.log:16>) |

## Per-arm temperatures and CPU maximum frequencies

Battery and skin values span each arm from pre-proof through its 60-second post-arm sampling tail. Frequency columns are `P0/P2/P5/P7` in kHz: policy0 covers cpu0–1, policy2 cpu2–4, policy5 cpu5–6, and policy7 cpu7. “Before → after” is the required `scaling_max_freq` read; min sampled captures reductions during the arm. Sample row links point to the raw readings, and [temperature-frequency-evidence.md](</tmp/xiaomi-3way/temperature-frequency-evidence.md>) quotes those exact rows.

| Arm | Battery start / peak / end °C | Skin start / peak / end °C | Thermal max | Freq before → after, P0/P2/P5/P7 kHz | Min sampled, P0/P2/P5/P7 kHz | Raw sample rows |
|---|---:|---:|---:|---|---|---|
| `A-cpu-1` | 27.4 / 28.5 / 28.5 | 28.11 / 31.312 / 30.037 | 0 | 2035200/2630400/2630400/2630400 → 2035200/2630400/2630400/2630400 | 2035200/2630400/2630400/2630400 | [start](</tmp/xiaomi-3way/live-samples.tsv:3>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:18>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:19>)/[end](</tmp/xiaomi-3way/live-samples.tsv:37>) |
| `A-gpu-1` | 28.5 / 29.2 / 29.2 | 30.037 / 32.819 / 31.356 | 0 | 2035200/2630400/2630400/2630400 → 2035200/2630400/2630400/2630400 | 2035200/2630400/2630400/2630400 | [start](</tmp/xiaomi-3way/live-samples.tsv:38>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:59>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:65>)/[end](</tmp/xiaomi-3way/live-samples.tsv:83>) |
| `A-npu-1` | 29.2 / 30.4 / 30.4 | 31.339 / 33.301 / 31.802 | 0 | 2035200/2630400/2630400/2630400 → 2035200/2630400/2630400/2630400 | 2035200/2630400/2630400/2630400 | [start](</tmp/xiaomi-3way/live-samples.tsv:84>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:105>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:99>)/[end](</tmp/xiaomi-3way/live-samples.tsv:117>) |
| `A-npu-2` | 30.4 / 30.8 / 30.8 | 31.797 / 33.64 / 32.244 | 0 | 2035200/2630400/2630400/2630400 → 2035200/2630400/2630400/2630400 | 2035200/2630400/2630400/2169600 | [start](</tmp/xiaomi-3way/live-samples.tsv:118>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:133>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:132>)/[end](</tmp/xiaomi-3way/live-samples.tsv:150>) |
| `A-gpu-2` | 30.8 / 31.3 / 31.3 | 32.233 / 34.176 / 32.745 | 0 | 2035200/2630400/2630400/2630400 → 2035200/2630400/2630400/2438400 | 2035200/2630400/2630400/2169600 | [start](</tmp/xiaomi-3way/live-samples.tsv:151>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:170>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:171>)/[end](</tmp/xiaomi-3way/live-samples.tsv:190>) |
| `A-cpu-2` | 31.3 / 31.3 / 31.3 | 32.728 / 35.084 / 33.352 | 0 | 2035200/2630400/2630400/2438400 → 2035200/2630400/2630400/2169600 | 2035200/2630400/2630400/2169600 | [start](</tmp/xiaomi-3way/live-samples.tsv:191>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:191>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:206>)/[end](</tmp/xiaomi-3way/live-samples.tsv:224>) |
| `B-cpu-1` | 31.6 / 32.3 / 31.9 | 33.335 / 35.267 / 33.476 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2630400/2630400/2169600 | [start](</tmp/xiaomi-3way/live-samples.tsv:225>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:239>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:239>)/[end](</tmp/xiaomi-3way/live-samples.tsv:257>) |
| `B-gpu-1` | 31.9 / 32.0 / 32.0 | 33.46 / 35.605 / 33.69 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:258>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:272>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:277>)/[end](</tmp/xiaomi-3way/live-samples.tsv:295>) |
| `B-npu-1` | 32.0 / 32.4 / 31.9 | 33.673 / 34.918 / 33.295 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:296>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:312>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:310>)/[end](</tmp/xiaomi-3way/live-samples.tsv:330>) |
| `B-gpu-2` | 31.9 / 32.1 / 32.1 | 33.278 / 35.848 / 34.089 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:331>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:345>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:351>)/[end](</tmp/xiaomi-3way/live-samples.tsv:370>) |
| `B-npu-2` | 32.1 / 32.1 / 32.1 | 34.071 / 35.506 / 34.013 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:371>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:371>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:385>)/[end](</tmp/xiaomi-3way/live-samples.tsv:405>) |
| `B-cpu-2` | 32.1 / 33.2 / 32.9 | 33.996 / 35.998 / 34.43 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:406>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:420>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:419>)/[end](</tmp/xiaomi-3way/live-samples.tsv:437>) |
| `B-npu-3` | 32.9 / 33.2 / 32.9 | 34.412 / 35.807 / 34.309 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:438>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:453>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:452>)/[end](</tmp/xiaomi-3way/live-samples.tsv:472>) |
| `B-cpu-3` | 32.9 / 33.3 / 33.2 | 34.291 / 36.232 / 34.721 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2630400/2630400/2169600 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:473>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:485>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:486>)/[end](</tmp/xiaomi-3way/live-samples.tsv:504>) |
| `B-gpu-3` | 33.2 / 33.5 / 33.5 | 34.704 / 36.623 / 35.025 | 0 | 2035200/2630400/2630400/2169600 → 2035200/2323200/2323200/1939200 | 2035200/2323200/2323200/1939200 | [start](</tmp/xiaomi-3way/live-samples.tsv:505>)/[battery peak](</tmp/xiaomi-3way/live-samples.tsv:539>)/[skin peak](</tmp/xiaomi-3way/live-samples.tsv:525>)/[end](</tmp/xiaomi-3way/live-samples.tsv:544>) |

## S23 side-by-side

| Comparison | Xiaomi 14 | S23 reference |
|---|---:|---:|
| A prefill CPU, median ms | 7542.59 ([L204](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:204>), [L204](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:204>)) | 10389.45 ([L7](</tmp/xiaomi-3way/s23-3way-6-results.tsv:7>)) |
| A decode CPU, median tok/s | 27.53 ([L205](</tmp/xiaomi-3way/arm-logs/A-cpu-1.log:205>), [L205](</tmp/xiaomi-3way/arm-logs/A-cpu-2.log:205>)) | 21.14 ([L2](</tmp/xiaomi-3way/s23-3way-6-results.tsv:2>), [L7](</tmp/xiaomi-3way/s23-3way-6-results.tsv:7>)) |
| A prefill GPU/OpenCL, median ms | 6855.27 ([L203](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:203>), [L203](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:203>)) | 7326.37 ([L6](</tmp/xiaomi-3way/s23-3way-6-results.tsv:6>)) |
| A decode GPU/OpenCL, median tok/s | 13.26 ([L204](</tmp/xiaomi-3way/arm-logs/A-gpu-1.log:204>), [L204](</tmp/xiaomi-3way/arm-logs/A-gpu-2.log:204>)) | 11.18 ([L3](</tmp/xiaomi-3way/s23-3way-6-results.tsv:3>), [L6](</tmp/xiaomi-3way/s23-3way-6-results.tsv:6>)) |
| A prefill HTP, median ms | 1447.97 ([L183](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:183>), [L183](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:183>)) | 1558.10 ([L5](</tmp/xiaomi-3way/s23-3way-6-results.tsv:5>)) |
| A decode HTP, median tok/s | 16.24 ([L184](</tmp/xiaomi-3way/arm-logs/A-npu-1.log:184>), [L184](</tmp/xiaomi-3way/arm-logs/A-npu-2.log:184>)) | 12.96 ([L4](</tmp/xiaomi-3way/s23-3way-6-results.tsv:4>), [L5](</tmp/xiaomi-3way/s23-3way-6-results.tsv:5>)) |
| B tg256 CPU, median tok/s | 29.21 ([L13](</tmp/xiaomi-3way/arm-logs/B-cpu-1.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-cpu-2.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-cpu-3.log:13>)) | 22.13 ([L2](</tmp/xiaomi-3way/s23-decode-group-summary.tsv:2>)) |
| B tg256 GPU/OpenCL, median tok/s | 15.49 ([L13](</tmp/xiaomi-3way/arm-logs/B-gpu-1.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-gpu-2.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-gpu-3.log:13>)) | 14.03 ([L3](</tmp/xiaomi-3way/s23-decode-group-summary.tsv:3>)) |
| B tg256 HTP, median tok/s | 23.33 ([L13](</tmp/xiaomi-3way/arm-logs/B-npu-1.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-npu-2.log:13>), [L13](</tmp/xiaomi-3way/arm-logs/B-npu-3.log:13>)) | 22.09 ([L4](</tmp/xiaomi-3way/s23-decode-group-summary.tsv:4>)) |

The Xiaomi results use the coordinator’s new static-binary kit, while the S23 reference used its prior kit. The matching-kit S23 control is being run separately, so treat these as reference comparisons rather than same-binary controls.

Android thermal status remained 0 across 544 samples. The battery minimum was 57%, battery temperature peaked at 33.5°C, and skin peaked at 36.623°C ([skin peak sample](</tmp/xiaomi-3way/live-samples.tsv:525>), [final state](</tmp/xiaomi-3way/session-events.log:638>)). The sampled CPU cap fell below baseline while status stayed 0; during B, P2/P5 reached 2,323,200 kHz and P7 reached 1,939,200 kHz ([B-GPU-3 rows](</tmp/xiaomi-3way/live-samples.tsv:516>), [minima summary](</tmp/xiaomi-3way/arm-summary.tsv:16>)).

## Cleanup

Initial and final `stay_on_while_plugged_in` both read `15`; I restored `svc power stayon true`. Post-cleanup state remained Awake, screen on, keyguard not showing, unplugged, and thermal status 0 ([post-cleanup snapshot](</tmp/xiaomi-3way/post-cleanup-state.log>)). The owned phone directory is absent ([cleanup check](</tmp/xiaomi-3way/post-cleanup-state.log:1>)); no Kalsa app process was found during arm checks, so no force-stop was needed. No lab repository files were edited.

## Raw artifacts

- [Arm logs and route proofs](</tmp/xiaomi-3way/arm-logs>)
- [Per-arm summary TSV](</tmp/xiaomi-3way/arm-summary.tsv>)
- [Quoted measured and proof log lines](</tmp/xiaomi-3way/quoted-result-lines.md>)
- [Quoted temperatures and frequency samples](</tmp/xiaomi-3way/temperature-frequency-evidence.md>)
- [Commands](</tmp/xiaomi-3way/commands.tsv>), [all live samples](</tmp/xiaomi-3way/live-samples.tsv>), and [session events](</tmp/xiaomi-3way/session-events.log>)
