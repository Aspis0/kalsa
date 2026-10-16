# ALIVE: measured state

Each measurement row includes its setup and source. Do not compare across devices or conditions without a matched run.

## Prefill per leg

| Device + SoC | Model + quant | Prompt / context | Leg(s) | Phase | Value + unit | Conditions | Date | Source |
|---|---|---|---|---|---|---|---|---|
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | 1010 tokens / context not stated | CPU / GPU OpenCL / NPU HTP | Prefill | 7542.59 / 6855.27 / 1447.97 ms | Bench; unplugged; thermal status 0; battery at least 57%; skin peak 36.6 C | 2026-09-29 | scratchpad/agents/xiaomi14-3way/REPORT.md:1,10-18; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Galaxy S23, SM8550 | LFM2.5-2.6B QAD-Q4_0 | 962 tokens / context not stated | CPU / GPU OpenCL / NPU HTP | Prefill | 97.12 / 138.44 / 653.98 tok/s | Bench; unplugged; awake; tracing 0; thermal status 0 | Date not stated in result report | scratchpad/agents/s23-heat-arms-engine/PREREG.md:8-20; scratchpad/agents/s23-heat-arms-engine/REPORT.md:61-67,84-88; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| QRD8750, SM8750, 8 Elite | LFM2.5-2.6B QAD-Q4_0 | 962 tokens / context not stated | CPU / GPU Adreno 830 / NPU HTP v79 | Prefill | 197.9 / 290.0 / 1046.4 tok/s | QDC board powered; skin measurement only | 2026-09-27 | scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:9-23; scratchpad/agents/qdc-8elite-heat-arms/REPORT.md:3,7,12-15,25-27 |
| 8 Elite Gen 5, SM8850, v81 | LFM2.5-2.6B QAD-Q4_0 | Prompt 595 tokens / context not stated | GPU fallback / NPU / CPU | In-app prefill | 295 / 1342 / 224 tok/s | App lane-off fallback on GPU; decode CPU; four turns; no crash | 2026-10-11 | scratchpad/agents/qdc-v81-fallback-df359450/REPORT.md:1,5,7-16,38-40; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

## Decode per leg

| Device + SoC | Model + quant | Prompt / context | Leg(s) | Phase | Value + unit | Conditions | Date | Source |
|---|---|---|---|---|---|---|---|---|
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt not stated / context not stated | CPU / GPU / NPU | Bench tg256 decode | 29.21 / 15.49 / 23.33 tok/s | Unplugged; thermal status 0; median of three; CPU frequency capped during later arms | 2026-09-29 | scratchpad/agents/xiaomi14-3way/REPORT.md:1,10-12,20,22-25; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt not stated / generated 1023 CPU, 511 NPU, 511 GPU tokens | CPU / NPU / GPU | Bench decode | 14.71 / 16.52 / 21.26 tok/s | Unplugged; screen awake; no cool wait; one run per leg; NPU and GPU windows short | Date not stated | scratchpad/agents/xiaomi-legheat-76/REPORT.md:1,11-18,27-31,61-65; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Galaxy S23, SM8550, v73 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | Device decode matrix | 17.1 / 14.5–15.7 / 12.8–13.5 tok/s | Real phone; one-copy three-leg kit | 2026-10 kit | archived/ALIVE-2026-10-16-full.md:96-104 |
| Xiaomi 14, SM8650, v75 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | Device decode matrix | 14–17.5 / 19.7–22.2 / 13.6–14.7 tok/s | Real phone; one-copy three-leg kit; see open differences below | 2026-10 kit | archived/ALIVE-2026-10-16-full.md:96-105; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| 8 Elite, SM8750, v79 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | Device decode matrix | 26.7 / 28.9 / 26.5 tok/s | QDC board powered; speed indicative | 2026-10 kit | archived/ALIVE-2026-10-16-full.md:96-100,106 |
| 8 Elite Gen 5, SM8850, v81 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | Device decode matrix | 27.1 / 30.6 / 19.2 tok/s | QDC board powered; speed indicative | 2026-10 kit | archived/ALIVE-2026-10-16-full.md:96-100,107 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | In-app decode | Telemetry predicted 7.3742767820380415 tok/s; 273 tokens decoded on NPU | Battery thermal source; FAST; zero hops/windows because NPU retained enough margin; decode pacing active; `layers_device` HTP0 | 2026-10-15 | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:27,33; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

## Heat per leg

| Device + SoC | Model + quant | Prompt / context | Leg(s) | Phase | Value + unit | Conditions | Date | Source |
|---|---|---|---|---|---|---|---|---|
| Galaxy S23, SM8550 | LFM2.5-2.6B QAD-Q4_0 | 962 tokens / context not stated | CPU / GPU / NPU | Prefill battery heat area | 44.59 / 24.17 / 6.45 C·s per 1000 tokens | Bench; unplugged; awake; tracing 0; thermal status 0 | Date not stated in result report | scratchpad/agents/s23-heat-arms-engine/PREREG.md:8-20; scratchpad/agents/s23-heat-arms-engine/REPORT.md:61-67,84-88; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| QRD8750, SM8750, 8 Elite | LFM2.5-2.6B QAD-Q4_0 | 962 tokens / context not stated | CPU / GPU / NPU | Prefill skin heat area | 52.3 / 45.5 / 21.2 C·s per arm | QDC board powered; AC power; battery readings stubbed; skin only | 2026-09-27 | scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:9-23; scratchpad/agents/qdc-8elite-heat-arms/REPORT.md:3,7,12-15,19-27 |
| 8 Elite, SM8750, v79 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU | Sustained board heat | NSP 104 C vs 105 C trip at 25 min; `gpu` cooling device throttled while CDSP cooling stayed at 0 | QDC board powered; one-run correlation, not an ablation | 2026-10 kit | scratchpad/agents/qdc-8elite-npu-long-69/REPORT.md:9-13,17-27,31-40; archived/ALIVE-2026-10-16-full.md:87 |
| Galaxy S23, SM8550 | LFM2.5-2.6B QAD-Q4_0 | Prompt/context not stated | NPU / GPU / CPU | Decode skin rise per 1000 tokens | 2.8 / 3.2 / 4.7 C | Real phone; unplugged | 2026-10 kit | archived/ALIVE-2026-10-16-full.md:81,104 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt not stated / 1023 CPU tokens | CPU | Decode skin rise per 1000 tokens | Approximately 7.3 C | Unplugged; screen awake; one run; no cool wait between legs | Date not stated | scratchpad/agents/xiaomi-legheat-76/REPORT.md:1,4,11-18,27-29,51-55,61-65; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt not stated / 8192 NPU tokens over four runs | NPU | Decode skin rise per 1000 tokens | 1.07 C | Unplugged; screen awake; start skin 33.4 C; cooled to at most 35 C before the arm | Date not stated | scratchpad/agents/xiaomi-endur-npu-gpu-75/REPORT.md:1,3-15,24-31; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt not stated / 2048 GPU tokens | GPU | Decode skin rise per 1000 tokens | About 3.2 C | Unplugged; screen awake; start skin 35.8 C after a 360 s cool wait; one run, stopped at 43 C | Date not stated | scratchpad/agents/xiaomi-endur-npu-gpu-75/REPORT.md:1,3-15,24-35; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

## Memory per leg and fit

| Device + SoC | Model + quant | Prompt / context | Leg(s) | Phase | Value + unit | Conditions | Date | Source |
|---|---|---|---|---|---|---|---|---|
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Context 2048 | NPU HTP0 only | Bench memory | Estimated buffers plus RSS: 2070–2100 MiB | Unplugged; MemAvailable affected by reclaim; honest estimate uses buffer sum plus RSS | 2026-10-15 | scratchpad/agents/xiaomi-lane-only-memory-cell-2026-10-15/REPORT.md:1-9,20-23; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Context 2048 | NPU HTP0 + GPU OpenCL | Bench memory | About 2870 MiB MemAvailable drop | Unplugged; one-copy; TILE32 waiver enabled; one run | 2026-10-15 | scratchpad/agents/xiaomi-lane-only-memory-cell-2026-10-15/REPORT.md:1-6,16,18,21-22; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Synthetic S23-class fixture (`htpArch: 73`) | LFM2.5-2.6B QAD-Q4_0 | Context 16384 | NPU lane-only | Unit-test price, not physical memory | 2500.06 MiB lane price; test available memory 3004.93 MiB; GPU price 3049.06 MiB | App unit test only; physical ctx-16384 lane-only memory is unmeasured | Test date not stated | /Users/marco/Projects/kalsa/src/engine/governorLaneOnly.test.ts:58-75; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

## Governor in-app outcomes

| Device + SoC | Model + quant | Prompt / context | Leg(s) | Phase | Value + unit | Conditions | Date | Source |
|---|---|---|---|---|---|---|---|---|
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Context not stated | GPU Fit; NPU Fit; HTP0 | Governor plan | Available 5472.34 MiB; required without repack 3300.06 MiB; NPU price with GPU | In-app; plan logged Fit for GPU and NPU | 2026-10-15 | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:9,33; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/xiaomi14-3way/REPORT.md:1,11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prewarm prompt 1760 tokens / context not stated | NPU HTP0 | Prewarm | 3565.937 ms | In-app; snapshot save then logged save_error | 2026-10-15 | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:15,21; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/xiaomi14-3way/REPORT.md:1,11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prompt 1241 tokens / context not stated | Prefill NPU; decode NPU | In-app turn | Prefill 2595.244 ms; 273 decoded tokens; telemetry predicted 7.3742767820380415 tok/s | Battery thermal source; FAST; decode pacing active. `route_chunks` says actual GPU while `layers_device` is HTP0 | 2026-10-15 | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:27,33; /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/xiaomi14-3way/REPORT.md:1,11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | Prewarm prompt 1760 tokens / context not stated | GPU kept; NPU dropped | Low-memory governor outcome | Available 3182 MiB; GPU Fit; NPU NoFit; `with_gpu` price 3300 MiB; prewarm 14.4 s; APK 38821127533 | In-app; lane-only branch was unverified in-app | 2026-10-15 | /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/xiaomi14-3way/REPORT.md:1,11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

Production decode uses live per-leg zone headroom for one-copy loads. The app omits `decode_hop_tokens`; the binding fills it from the SoC legs row. The Xiaomi turn logged zero hops and zero headroom windows because the NPU retained enough margin to avoid a hop. Production uses the battery-derived FAST/WARM/COOLMODE thermal state and decode pacing. [/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:445-448,545-570; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor-params.cpp:337-338,357-359; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-llama.cpp:464-466; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:80-91; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor.cpp:91-105,314-320; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-thermal-legs.cpp:116-127; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy-hop.cpp:182-253; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy.cpp:226-237,290-315; scratchpad/agents/s23-g2-inapp-1f0e967b/REPORT.md:55; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:33]

## Additional measured records

| Record | Result | Source |
|---|---|---|
| One-copy three-leg correctness | One weight copy serves NPU, GPU, and CPU; correct on S23 and Xiaomi phones and QDC SM8650/SM8750/SM8850. KL mean vs two copies was 1e-5–1.2e-4 on SM8750/SM8850; E5 residual was at most 2.3e-5. | archived/ALIVE-2026-10-16-full.md:74 |
| Prefill heat ordering | NPU was the coolest prefill leg on both chips; CPU prefill was never coolest. | archived/ALIVE-2026-10-16-full.md:81 |
| S23 in-app one-copy memory | PSS 2.51 GB one-copy vs 4.06 GB two-model; `decode_tokens_gpu` telemetry was wired and verified in-app. | scratchpad/agents/onecopy-three-legs/step6-inapp/summary-ram.grep:7-12; archived/ALIVE-2026-10-16-full.md:77 |
| S23 NPU KV-on-device prefill | 4.0× short-context and 5.5× long-context vs host KV; decode unchanged within noise; answers correct on 7/7 turns. | scratchpad/agents/s23-option-a-speed-7ec12eb0/REPORT.md:21-30; archived/ALIVE-2026-10-16-full.md:78 |
| Meter on S23 | One governor-on turn: 254–294 mWh vs 376 mWh governor-off; 1.8–2.0× per output token. Sampler overhead measured about 1.1–1.36 ms CPU/s plus about 1 ms/s in health HAL; conditional bound 0.24–0.44% of a turn, below the 1% bar. Energy is not valid as within-turn control. | archived/ALIVE-2026-10-16-full.md:84 |
| S23 Stage 0 observation | Six turns vs a `df359450` control; criteria 1–6 passed: seven rows, no gaps, tokens matched prediction, complete windows, forecast age at most 2.3 s. Leg mix was not judgeable; one 32-token GPU window per completion in each arm from turn 2. Native lines were absent, battery sysfs was denied, and app thermo sample age reached 350 s in a paced completion. | archived/ALIVE-2026-10-16-full.md:85 |
| Xiaomi 14 Stage 0 observation | Six turns, eight rows, no gaps; `sum(tok) - pred_n = +1` on each row; forecast age at most 2.65 s over 324 windows. Passive trips: CPU 60–115 C, NPU 100 C, GPU 95 C. Battery sysfs was unreadable; app thermo age reached 503 s. Decode stayed 100% NPU for 10229 tokens, 0 GPU and 0 CPU; speed moved 17.9→3.2 tok/s; skin peaked at 42.2 C; battery moved 79→63%; Android status stayed 0. There was no control arm, so no speed or heat claim. | archived/ALIVE-2026-10-16-full.md:86 |
| 8 Elite long NPU board run | Sixteen 2048-token runs; speed fell 14% after run 6. NSP reached 104 C vs 105 C trip at 25 min. Throttle tracked the `gpu` cooling device; CDSP cooling stayed 0. | scratchpad/agents/qdc-8elite-npu-long-69/REPORT.md:17-27,31-40; archived/ALIVE-2026-10-16-full.md:87 |
| Xiaomi 14 endurance, older cell | NPU reached about 7.5–8k tokens vs CPU about 1.5k before skin 43 C; heat was about 1.0 C vs 5.4 C per 1k tokens. GPU was excluded in that pre-fix run. | archived/ALIVE-2026-10-16-full.md:88 |
| Mixed K/V decode | No CPU decode penalty on one QDC SM8650 board at depths 0 and 2048. S23 was not measured; CPU was not tested at the Metal cliff at depth 15744. Android uses q8_0/q4_0; iOS resolves q8_0/q8_0. | archived/ALIVE-2026-10-16-full.md:89 |
| Binding tests | Jest is green after `npm ci`; the older 12/12 failures came from a pnpm-installed `node_modules`. | archived/ALIVE-2026-10-16-full.md:92 |
| Ling-3.0-tiny language probe | Chinese only; Italian, French, and Spanish answers failed with thinking on or off. | archived/ALIVE-2026-10-16-full.md:93 |

The S23 and Xiaomi Stage 0 records are observation-only; no controlled speed or heat comparison was made for Stage 0. [archived/ALIVE-2026-10-16-full.md:85-86]

## Refuted or superseded numbers

| Claim | Correct reading | Source |
|---|---|---|
| GPU 7347.20 ms versus NPU 1668.22 ms was called a contradiction of “NPU faster” | It agrees: lower elapsed time means faster prefill. The Xiaomi result likewise records GPU 6855.27 ms and NPU 1447.97 ms. | scratchpad/agents/governor-phase-routing/DESIGN.md:78-79; scratchpad/agents/xiaomi14-3way/REPORT.md:16-18 |
| Xiaomi dense GPU prefill 5.77× | Retired as a weak CPU baseline; corrected result 3.18×. | scratchpad/agents/governor-archive-mining/SYNTHESIS.md:53-56 |
| QDC 8 Elite decode NPU 8.616385 versus CPU 19.625266 tok/s | These rows are Qwen, not the LFM ship model; exclude them from LFM comparisons. | scratchpad/agents/qdc-8elite-npu-v79-d-rest/AUDIT.md:78-90 |
| S23 1.0–1.4 J/token | Whole-system estimate, not a valid per-device/model/backend/phase grid; the charge-counter spread was withdrawn. | scratchpad/agents/governor-archive-mining/SYNTHESIS.md:49-51 |

## Contradictions still open

| Open comparison | Record A | Record B | Sources |
|---|---|---|---|
| Xiaomi skin heat per 1k tokens | CPU about 7.3 C; NPU 1.07 C | Older endurance record: CPU about 5.4 C; NPU about 1.0 C | scratchpad/agents/xiaomi-legheat-76/REPORT.md:51-57; scratchpad/agents/xiaomi-endur-npu-gpu-75/REPORT.md:24-31; archived/ALIVE-2026-10-16-full.md:88 |
| S23 one-copy memory | Earlier process RSS about 2.4 GB vs 3.9 GB | Later in-app PSS 2.51 GB vs 4.06 GB | scratchpad/agents/s23-g2-inapp-1f0e967b/REPORT.md:53; scratchpad/agents/onecopy-three-legs/step6-inapp/summary-ram.grep:7-12; archived/ALIVE-2026-10-16-full.md:29,77 |
| Xiaomi predicted vs decoded tokens | `tokensPredicted` 272 | `decode_tokens_npu` 273 | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:27,33 |
| SM8650 row shipping status | Frozen plan says “NOT shipped” | Pinned binding contains an SM8650 row | archived/PLAN-2026-10-16-full.md:173-178; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:89-91 |
| Xiaomi bench decode ordering | 3-way median: CPU 29.21, NPU 23.33, GPU 15.49 tok/s | Per-leg cell: GPU 21.26, NPU 16.52, CPU 14.71 tok/s | scratchpad/agents/xiaomi14-3way/REPORT.md:20,24-25; scratchpad/agents/xiaomi-legheat-76/REPORT.md:11-18,27-31,61-65 |
| Xiaomi in-app vs bench NPU rate | In-app telemetry predicts 7.3742767820380415 tok/s | Bench 3-way NPU median 23.33 tok/s; the in-app turn used decode pacing | scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:27,33; scratchpad/agents/xiaomi14-3way/REPORT.md:20 |
| Phone release status | The frozen plan marks the phone release chain Done | The frozen phone ALIVE says APK “building” for CI run `37961298208` | archived/PLAN-2026-10-16-full.md:320-329,333-339; archived/ALIVE-2026-10-16-full.md:10-14 |

The frozen records disagree on phone release completion; reconcile the Done label with the cited CI APK state. [archived/PLAN-2026-10-16-full.md:320-329,333-339; archived/ALIVE-2026-10-16-full.md:10-14]

## Gaps

- Physical lane-only memory at app context 16384 is not measured; the bench measurement uses context 2048, and the app test is a price calculation. [scratchpad/agents/xiaomi-lane-only-memory-cell-2026-10-15/REPORT.md:1-6,21-24; /Users/marco/Projects/kalsa/src/engine/governorLaneOnly.test.ts:61-75]
- No valid per-device/model/backend/phase J/token grid exists. [scratchpad/agents/governor-archive-mining/AUDIT-SYNTHESIS-DEEPSEEK.md:132-134]
- Xiaomi per-layer memory and speed were measured on different devices, not together; the load-time GPU-first order has no joined measurement. [archived/ALIVE-2026-10-16-full.md:141-148]
- `kalsa-brain` branch `brain` contains commit `7ca211b4` (`Version 0.0.6`); external publication is not established by the local record. [kalsa-brain commit 7ca211b4]
- The desktop engine stderr allowlist remains flagged in the backlog. [/Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:543-548]

## Standing cautions

- A device number is only as good as phone state: unplugged versus charging, screen awake versus dozing, and starting skin temperature. Phone heat and speed claims are only unplugged; QDC boards are powered, so speed is indicative and heat is not. [archived/ALIVE-2026-10-16-full.md:111-113]
- Every timing ratio states the screen state of both arms; with the screen off Android parks CPUs, and screen_off_timeout is 30000 ms. Every published value carries its load condition. [archived/ALIVE-2026-10-16-full.md:114-115]
- Read the executing device from layers_device, not per-chunk actual or per-turn engine_prefill. The in-app log itself has actual gpu and layers_device HTP0. [archived/ALIVE-2026-10-16-full.md:116-118; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:33]
- In-app NPU speed depends on KV placement and context depth. [archived/ALIVE-2026-10-16-full.md:119-120; scratchpad/agents/htp-kv-attention/REPORT-xiaomi-v75.md:8-15,84-95]
- The 2026-09-28 SEVERE-versus-FAST blind spot predates the platform-status input (6892d0415) and has no in-app re-verification on disk. [archived/ALIVE-2026-10-16-full.md:121-122]
- The governor trend producer is inert at production cadence and is not to be shipped as an escalation trigger on this evidence. [archived/ALIVE-2026-10-16-full.md:83]
- Four pre-answer safety cells remain release-blocker candidates; a budget-up rerun with n at least 160 is required before acting. [archived/ALIVE-2026-10-16-full.md:123-124]
- Open since 2026-09-22 and still unverified: the KV-term magnitude (orientations disagree 3.2×) and the thermal limb of the Jelly prefill stall; both reruns sat at SEVERE. [archived/ALIVE-2026-10-16-full.md:125-126]
- Archive hash-cited artifacts before cleanup. A coder's refspec is a proposal, not a decision. [archived/ALIVE-2026-10-16-full.md:127-128]

## Where the record lives

- scratchpad/agents/<cell>/: preregistration, scripts, raw data, and reports.
- analysis/: dated findings and contracts.
- archived/: frozen documents and older histories.
- PLAN.md: rules, workstream state, next steps, and owner decisions.
- docs/ALIVE.md: measured facts.
