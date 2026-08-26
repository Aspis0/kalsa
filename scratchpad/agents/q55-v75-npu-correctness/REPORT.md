# q55 numbers

DISCLAIMER: correctness r is a same-device 32-chunk comparison, not a proof of all workloads; Part B t/s is exploratory and charge-counter energy is recorded only.
LEGEND: r = PPL_HTP / PPL_CPU - 1; PASS <= 0.02, GREY <= 0.05, FAIL > 0.05 or NaN; proof is required for certification.

| arm | model | npu | guard_rc | workload_rc | launcher_rc | PPL | PPL_std | max_C | ΔT_C | wall_s | t/s | signature |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| partA_olmoe_htp | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.0 |  |  |  |
| partA_olmoe_htp_valid | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.2 |  |  |  |
| partA_olmoe_htp_kvhost_retry | OLMoE | 1 | 0 | 0 | 0 | 8.9214 | 0.12933 | 31.2 | 4.5 |  |  |  |
| partA_olmoe_cpu_kvhost | OLMoE | 0 | 0 | 0 | 0 | 8.9233 | 0.12926 | 39.4 | 7.6 |  |  |  |
| partB_olmoe_npu_1 | OLMoE | 1 | 0 | 0 | 0 |  |  | 31.9 | 0.0 | 0.671243 | 581.412000 |  |
| partB_olmoe_cpu_1 | OLMoE | 0 | 0 | 0 | 0 |  |  | 31.1 | 0.4 | 7.759044 | 52.618300 |  |
| partB_olmoe_cpu_2 | OLMoE | 0 | 0 | 0 | 0 |  |  | 31.1 | 0.0 | 7.802833 | 53.105600 |  |
| partB_olmoe_npu_2 | OLMoE | 1 | 0 | 0 | 0 |  |  | 32.1 | 1.0 | 0.626154 | 804.845000 |  |
| partA_qwen_htp | Qwen3.5-4B-Q4_0 | 1 | 0 | 137 | 124 | None | None | 38.0 | 6.2 |  |  |  |

## Arbitration deviation

KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines.
Pre-retry MemAvailable=6818768 kB (>5.0 GB); no processes were closed and no device state changed.

## Part A

OLMoE: PPL_HTP=8.9214; PPL_CPU=8.9233; r=-0.00021293; gate=PASS; proof={"attn_execute_op": 6208, "execute_op_any": 28659, "execute_op_htp0": 28659, "expert_mul_mat_id": 3024, "mul_mat_id": 3024}
Qwen3.5-4B-Q4_0: not completed

## Stop-rule correction

The earlier Part B STOPPED classification was false: Loading driver libcdsprpc.so and HTP0 new session ... _dom=cdsp are normal session-open messages, not crash signatures.
Correct case-sensitive stop substrings: CDSP0 CRASHED; dspqueue_read failed; dspqueue_write failed; INTERNAL-ERROR; ggml_abort; GGML_ASSERT; Aborted; Segmentation; or workload rc >= 128 not caused by the guard.
TRUE crash signatures: none
TRUE stop events: partA_qwen_htp: launcher_rc=124; workload_rc=137; guard_rc=0; guard_outcome=normal; abort_reason=launcher_wall_clock_cap

## Part B

| model | sequence | ΔT_C | MAX_C | wall_s | t/s |
|---|---|---:|---:|---:|---:|
| OLMoE | NPU | 0.0 | 31.9 | 0.671243 | 581.412000 |
| OLMoE | CPU | 0.4 | 31.1 | 7.759044 | 52.618300 |
| OLMoE | CPU | 0.0 | 31.1 | 7.802833 | 53.105600 |
| OLMoE | NPU | 1.0 | 32.1 | 0.626154 | 804.845000 |

status=STOPPED
thermalservice_headroom_available=false; no dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]
final_state=exact serial device; 53% battery; 32.9C; unplugged; no residual llama-bench/llama-perplexity/thermal_guard process

## Corrections applied after audit (REVIEW_MATH.md, BANK-with-corrections) — orchestrator
1. Scope wording: with `-nkvo` the K/V STORAGE is host memory; ALL traced compute (28,659
   execute-ops incl. 1,040 FLASH_ATTN_EXT, K/V projections, 3,024 expert MUL_MAT_ID) executed on
   HTP0 — there is zero CPU-traced compute. Certified: numerical equivalence of the HTP0-executed
   forward graph vs CPU over 32 chunks × 1023 tokens (wiki.test.raw), OLMoE-1B-7B-0924-Instruct-
   Q4_0, n_ctx 2048, v75 houji, in the -nkvo configuration ONLY. Not certified: no-nkvo at 2048
   ctx (unrunnable: KV fastrpc_mmap 256 MB fails), Qwen, other contexts, latency.
2. Part B first NPU arm t/s: min 581.4 / mean 845 over 2 reps (spread 581–1109); run without
   -nkvo at n_ctx 512.
3. Attempt numbering: attempt 1 died at CLI parse (`--no-host 1` invalid), attempt 2 at the KV
   fastrpc_mmap (268,435,456 B, error 0x1, rc 1, 0 execute-ops), attempt 3 (= -nkvo only) ran.
4. Ledger entry carries the `-nkvo` qualifier.
