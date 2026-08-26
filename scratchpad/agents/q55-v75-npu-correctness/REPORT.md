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
| partA_qwen_cpu_12char | Qwen3.5-4B-Q4_0 | 0 | 2 | 137 | 0 | None | None | 39.5 | 7.7 |  |  |  |

## Arbitration deviation

KV cache on host: attention K/V stay on CPU; the experts MUL_MAT_ID and dense matmuls still execute on HTP0 — proof required via execute-op lines.
Pre-retry MemAvailable=6818768 kB (>5.0 GB); no processes were closed and no device state changed.

## Part A

OLMoE: PPL_HTP=8.9214; PPL_CPU=8.9233; r=-0.00021293; gate=PASS; proof={"attn_execute_op": 6208, "execute_op_any": 28659, "execute_op_htp0": 28659, "expert_mul_mat_id": 3024, "mul_mat_id": 3024}
Qwen3.5-4B-Q4_0: HTP_running_PPL_n12=8.2314; CPU_running_PPL_n12=None; r12=; gate=UNAVAILABLE; 12-chunk characterization (HTP arm capped at 10 min), not a 32-chunk certification; HTP_max_chunk=12; CPU_max_chunk=10; status=CPU arm stopped before common chunk 12; proof={"attn_execute_op": 2584, "execute_op_any": 19449, "execute_op_htp0": 19449, "expert_mul_mat_id": 0, "mul_mat_id": 0}

## Stop-rule correction

The earlier Part B STOPPED classification was false: Loading driver libcdsprpc.so and HTP0 new session ... _dom=cdsp are normal session-open messages, not crash signatures.
Correct case-sensitive stop substrings: CDSP0 CRASHED; dspqueue_read failed; dspqueue_write failed; INTERNAL-ERROR; ggml_abort; GGML_ASSERT; Aborted; Segmentation; or workload rc >= 128 not caused by the guard.
TRUE crash signatures: none
TRUE stop events: partA_qwen_cpu_12char: launcher_rc=0; workload_rc=137; guard_rc=2; guard_outcome=thermal kill; abort_reason=battery_below_45_percent_guard; battery_floor_triggered=True; battery_floor_chunk=10
Exact guard stop lines: `1787741990,395,44,BATTERY_LOW_ABORT`; `1787741990,395,44,KILLED`

## CPU t/s discrepancy diagnosis

q55 exact CPU command: /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/OLMoE-1B-7B-0924-Instruct-Q4_0.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -ngl 0
q55 JSON: first-sample pp512 t/s = 52.6183, 53.1056; avg_ts = 70.541380, 69.473463; n_threads=8; cpu_mask=0x0; /proc/<binary_pid>/cpuset=/.
q55 launcher/priority: nohup setsid sh -c supervisor, then sh -c workload wrapper with exec; no nice/taskset/chrt/ionice/setpriority; taskset -p output was not captured.
q55 CPU flags/environment: -t 8, -ngl 0, no -dev, --load-mode none, -n 0; ADSP_LIBRARY_PATH/CDSP_LIBRARY_PATH/NDEV/VERBOSE retained by launcher, HOSTBUF unset.
q48 exact CPU command: ./llama-bench -m "$MODEL" -p 512 -n 128 -r 2 --no-warmup -ngl 0 -o jsonl -oe jsonl --load-mode none -fa on --ubatch-size 1024
q48 CPU setup: -t omitted (default), -ngl 0, no -dev, --load-mode none, -n 128; setup_env_cpu explicitly unset Hexagon variables; direct invocation, no watchdog wrapper evidence.
Diagnosis: records establish a non-identical comparison (n_gen and thread/environment setup differ); they do not isolate which factor dominates. No rerun performed.

## Part B

| model | sequence | ΔT_C | MAX_C | wall_s | t/s |
|---|---|---:|---:|---:|---:|
| OLMoE | NPU | 0.0 | 31.9 | 0.671243 | 581.412000 |
| OLMoE | CPU | 0.4 | 31.1 | 7.759044 | 52.618300 |
| OLMoE | CPU | 0.0 | 31.1 | 7.802833 | 53.105600 |
| OLMoE | NPU | 1.0 | 32.1 | 0.626154 | 804.845000 |

status=STOPPED
thermalservice_headroom_available=false; no dynamic numeric headroom exposed; raw thresholds include [NaN, NaN, NaN, 1.0, NaN, NaN, 1.95]

## Orchestrator arbitration — Qwen Part A (capped-arm clause)
The PREREG's clause uses "the running PPL at the last COMMON chunk n ≥ 8 for both arms". The
HTP arm reached [12] (10-min cap), the CPU-ref reached [10] (battery-floor kill at 44 %). Common
chunk = 10 (raw/partA_qwen_htp.running_ppl.log, raw/partA_qwen_cpu_12char.running_ppl.log):
HTP [10] 7.8331 vs CPU [10] 7.8246 → **r10 = +0.109 %** (r8 = +0.136 %: 7.4331 vs 7.4230).
Gate letter: PASS (≤ 2 %) — **10-chunk characterization of the dense/hybrid lane (R3) on v75 with
-nkvo, NOT a 32-chunk certification.** Qwen Part B not run.

## Session end state
Xiaomi unplugged 44 % / 34.9 °C, no residual processes; the CPU-ref kill was the launcher's
battery-floor rule (BATTERY_LOW_ABORT at 44 %), not thermal (39.5 °C < 43). CPU pp512 t/s
discrepancy vs q48 (first-sample 52–53 / jsonl avg 70 vs q48 142) NOT isolated: different flags
(-n 0 -t 8 vs -n 128 without -t, Hexagon env unset in q48); recorded, not gated.
