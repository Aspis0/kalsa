# Xiaomi 14 in-app governor observation

Date is from the source log timestamp and directory. This report preserves the quoted log lines verbatim.
Device: Xiaomi 14 (SM8650). Model: LFM2.5-2.6B QAD-Q4_0, SHA prefix `a247afd6`. The Xiaomi cell identifies the device and model hash; the ship-model preregistration maps that hash to the QAD quant. [scratchpad/agents/xiaomi14-3way/REPORT.md:1,10-11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22]

The extracted log excerpt below contains the high-fit turn. The separate measured low-memory row is recorded in the app backlog and retained here with that source's precision.

| Device + SoC | Model + quant | Available | GPU / NPU fit | Price | Outcome | Prewarm | APK run | Date | Source |
|---|---|---:|---|---:|---|---:|---:|---|---|
| Xiaomi 14, SM8650 | LFM2.5-2.6B QAD-Q4_0 | 3182 MiB | Fit / NoFit | `with_gpu`: 3300 MiB | NPU dropped; GPU kept | 14.4 s for 1760 tokens | 38821127533 | 2026-10-15 | /Users/marco/Projects/kalsa-brain/docs/BACKLOG.md:535; scratchpad/agents/xiaomi14-3way/REPORT.md:1,10-11; scratchpad/agents/qdc-8elite-heat-arms/PREREG.md:22 |

Original log line 3168:

```text
10-15 23:47:33.839 20348 29402 I ReactNativeJS: KALSA_GOVERNOR_PLAN {"gpu_fit":"Fit","decode_repack":true,"required_mib_with_repack":4820.12,"required_mib_without_repack":3300.06,"available_mib":5472.34,"bench_norepack_forced":null,"npu_device":"HTP0","npu_fallback":null,"npu_lane":"auto","npu_fit":"Fit","available_src":"fresh","pacing_start":0.083,"pacing_full":0.203,"npu_price":"with_gpu"}
```

Original log line 4347:

```text
10-15 23:47:42.923 20348 29402 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"done","promptMs":3565.937,"promptN":1760,"hash":"2138549136"}'
```

Original log line 4348:

```text
10-15 23:47:42.931 20348 29402 I ReactNativeJS: 'KALSA_PREWARM', '{"op":"snapshot_save","ok":false,"reason":"save_error","hash":"2138549136"}'
```

Original log line 14231:

```text
10-15 23:48:52.682 20348 29402 I ReactNativeJS: KALSA_TELEMETRY {"turnId":"1","attempt":1,"round":0,"tokensCached":3274,"tokensEvaluated":3001,"tokensPredicted":272,"draftTokens":0,"draftAccepted":0,"promptMs":2595.244,"predictedMs":36884.973,"predictedPerSecond":7.3742767820380415,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":1241}
```

Original log line 14234:

```text
10-15 23:48:52.684 20348 29402 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"NPU","engine_decode":"NPU","commit_bytes":0,"commit_ms":0,"prefill_ms":2595.244,"prefill_chunks":"512+512+128+89","prefill_ctx_ngl":99,"forced":false,"thermal_state":"FAST","thermo_source":"battery","fit":"Fit","npu_device":"HTP0","npu_fallback":null,"cache_type_k":"q8_0","cache_type_v":"q8_0","prefill_kv":"device","decode_hops":0,"decode_tokens_cpu":0,"decode_tokens_npu":273,"decode_tokens_gpu":0,"decode_hop_commit_bytes":0,"decode_hop_commit_ms":0,"decode_hop_headroom_windows":0,"decode_paced_ms":13907,"decode_paced_tokens":273,"decode_paced_capped":0,"decode_pacing_duty_last":0.515892505645752,"decode_pacing_headroom_last":0.17237421870231628,"fallback_reason":"","failed":false,"failure_reason":"","attempt":1,"turnId":"1","route_requested":"auto","route_mode":"auto","route_push":"applied","route_mismatch":null,"route_chunks":[{"index":0,"requested":"auto","actual":"gpu","tokens":512,"prefill_ms":1007,"forced":false,"layers_device":"HTP0"},{"index":1,"requested":"auto","actual":"gpu","tokens":512,"prefill_ms":1040,"forced":false,"layers_device":"HTP0"},{"index":2,"requested":"auto","actual":"gpu","tokens":128,"prefill_ms":287,"forced":false,"layers_device":"HTP0"},{"index":3,"requested":"auto","actual":"gpu","tokens":89,"prefill_ms":259,"forced":false,"layers_device":"HTP0"}],"route_chunks_dropped":0,"route_chunks_truncated":false,"platform_thermal_status":0,"state_source":"battery"}
```

The per-leg zone-headroom decode hop is active in production on one-copy loads. The app omits `decode_hop_tokens`; the binding fills it from the SoC legs row, which sets hop 32 for SM8550 and SM8650. The S23 in-app record shows NPU↔GPU hops. In this Xiaomi turn, `decode_hops` and `decode_hop_headroom_windows` are zero because the NPU retained enough margin to avoid a hop. Production also uses the battery-derived FAST/WARM/COOLMODE thermal state and decode pacing. [/Users/marco/Projects/kalsa/src/engine/governorInputs.ts:445-448,545-570; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor-params.cpp:337-338,357-359; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-llama.cpp:464-466; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-legs-table.cpp:80-91; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-governor.cpp:91-105,314-320; /Users/marco/Projects/llama.rn-kalsa-onecopy/cpp/rn-thermal-legs.cpp:116-127; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy-hop.cpp:182-253; /Users/marco/Projects/llama.rn-kalsa-onecopy/vendor/llama.cpp/src/llama-governor-policy.cpp:226-237,290-315; scratchpad/agents/s23-g2-inapp-1f0e967b/REPORT.md:55; scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:33]

The same turn logged `tokensPredicted` 272 and `decode_tokens_npu` 273; keep these as separate telemetry counts pending reconciliation. [scratchpad/agents/xiaomi-inapp-npu-2026-10-15/REPORT.md:27,33]
