# q55 numbers

DISCLAIMER: correctness r is a same-device 32-chunk comparison, not a proof of all workloads; Part B t/s is exploratory and charge-counter energy is recorded only.
LEGEND: r = PPL_HTP / PPL_CPU - 1; PASS <= 0.02, GREY <= 0.05, FAIL > 0.05 or NaN; proof is required for certification.

| arm | model | npu | guard_rc | workload_rc | launcher_rc | PPL | PPL_std | max_C | ΔT_C | wall_s | t/s | signature |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| partA_olmoe_htp | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.0 |  |  |  |
| partA_olmoe_htp_valid | OLMoE | 1 | 0 | 1 | 1 | None | None | 27.9 | 0.2 |  |  |  |

## Part A

OLMoE: PPL_HTP=NA; PPL_CPU=NA; r=NA; gate=VOID (HTP context allocation failed before PPL; execute-op proof count=0; CPU-ref not run after safety stop)
Qwen3.5-4B-Q4_0: PPL_HTP=NA; PPL_CPU=NA; r=NA; gate=SKIP (q55 stopped after OLMoE HTP allocation failure)
execute_op_proof_counts: partA_olmoe_htp=execute-op HTP0 0, MUL_MAT_ID 0, expert MUL_MAT_ID 0, attention execute-op 0; partA_olmoe_htp_valid=0,0,0,0; Qwen=not run

## Part B

| model | sequence | ΔT_C | MAX_C | wall_s | t/s |
|---|---|---:|---:|---:|---:|

status=STOPPED
thermalservice_headroom_numeric=UNAVAILABLE (Thermal Status: 0 and static thresholds only; no dynamic numeric headroom value)
stop_reason=partA_olmoe_htp_valid HTP runtime allocation failure; q55 stopped without retry
runtime_error=HTP0 buffer mapping failed / fastrpc_mmap failed / failed to allocate buffer for kv cache; no PPL or Part B numbers
