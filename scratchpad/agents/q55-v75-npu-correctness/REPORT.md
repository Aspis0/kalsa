# q55 numbers

DISCLAIMER: correctness r is a same-device 32-chunk comparison, not a proof of all workloads; Part B t/s is exploratory and charge-counter energy is recorded only.
LEGEND: r = PPL_HTP / PPL_CPU - 1; PASS <= 0.02, GREY <= 0.05, FAIL > 0.05 or NaN; proof is required for certification.

| arm | model | npu | guard_rc | workload_rc | launcher_rc | PPL | PPL_std | max_C | ΔT_C | wall_s | t/s | signature |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| partA_olmoe_htp | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.0 |  |  |  |
| partA_olmoe_htp_valid | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.2 |  |  |  |
| partA_olmoe_htp_kvhost_retry | OLMoE | 1 | 0 | 0 | 0 | 8.9214 | 0.12933 | 31.2 | 4.5 |  |  |  |
| partA_olmoe_cpu_kvhost | OLMoE | 0 | 0 | 0 | 0 | 8.9233 | 0.12926 | 39.4 | 7.6 |  |  |  |
| partB_olmoe_npu_1 | OLMoE | 1 | 0 | 0 | 0 |  |  | 31.9 | 0.0 | 0.671243 | 581.412000 | ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007b0244c2d0 |

## Arbitration deviation

KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines.
Pre-retry MemAvailable=6818768 kB (>5.0 GB); no processes were closed and no device state changed.

## Part A

OLMoE: PPL_HTP=8.9214; PPL_CPU=8.9233; r=-0.00021293; gate=PASS; proof={"attn_execute_op": 6208, "execute_op_any": 28659, "execute_op_htp0": 28659, "expert_mul_mat_id": 3024, "mul_mat_id": 3024}
Qwen3.5-4B-Q4_0: not completed

## Stop reason

q55 STOPPED by the locked NPU rule after Part B OLMoE NPU arm: a literal CDSP line was present; no further arm or retry was started.
Exact stop lines:
ggml-hex: Loading driver libcdsprpc.so
ggml-hex: HTP0 new session : session-id 0 domain-id 3 uri file:///libggml-htp-v75.so?htp_iface_skel_handle_invoke&_modver=1.0&_dom=cdsp&_session=0 handle 0xb400007b0244c2d0

## Part B

| model | sequence | ΔT_C | MAX_C | wall_s | t/s |
|---|---|---:|---:|---:|---:|
| OLMoE | NPU | 0.0 | 31.9 | 0.671243 | 581.412000 |

status=STOPPED
thermalservice_headroom_available=false; no dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]
