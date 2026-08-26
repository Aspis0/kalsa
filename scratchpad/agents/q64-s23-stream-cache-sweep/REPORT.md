# q64 numbers

status=DONE_AUDITED
commit=4fc6bf4e
device=Galaxy S23 SM_S911U
serial=adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp
model_bytes=10505424704
runtime_files=7
prompt_window_engine_tokens=120-136
calibration_loads=1

## gates

battery_start_pct=90
battery_end_pct=82
battery_invocation_min_pct=40
battery_stop_pct=35
cool_start_max_C=32.0
max_temperature_C=31.3
guard_warn_C=40.0
guard_kill_C=43.0
guard_poll_s=10
spacing_s=60
invocation_cap_s=720
cpuset=0-7

## per-arm medians

| C_MiB | n_success | n_killed | n_skipped | observed_decode_tokens | decode_tok_s_9_102 | decode_tok_s_full_observed | decode_tok_s_full128 | 128/prefill_s (pre-registered convention; engine counts 133 tokens → engine tps 3.9 % higher) | cache_hit_pct_last_observed | cache_hit_pct_token128 | read_mb | io_share_9_observed | read_rate_MB_s | auto_resolved_cache_MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 0 | 3 | 0 | 0 | 102 | 1.070611 | 1.066873 | NA (EOS at 102) | 11.954796 | -1.000000 | NA | 32918.982656 | 0.465373 | 344.317286 | NA |
| 1500 | 3 | 0 | 0 | 102 | 1.755435 | 1.713534 | NA (EOS at 102) | 10.873259 | 29.270000 | NA | 20839.067648 | 0.496791 | 350.082942 | NA |
| 2000 | 3 | 0 | 0 | 102 | 1.934488 | 1.904931 | NA (EOS at 102) | 7.936508 | 39.440000 | NA | 16626.495488 | 0.490315 | 310.512946 | NA |
| 4000 | 3 | 0 | 0 | 102 | 2.838197 | 2.756121 | NA (EOS at 102) | 7.938969 | 58.560000 | NA | 8716.431360 | 0.379229 | 235.524896 | NA |
| auto | 3 | 0 | 0 | 102 | 2.752912 | 2.753804 | NA (EOS at 102) | 7.775011 | 55.380000 | NA | 10032.152576 | 0.404809 | 272.063093 | 3437.000000 |

## curve

curve_decode_tok_s_9_102_C_0=1.070611
curve_decode_tok_s_9_102_C_1500=1.755435
curve_decode_tok_s_9_102_C_2000=1.934488
curve_decode_tok_s_9_102_C_4000=2.838197
curve_decode_tok_s_9_102_C_auto=2.752912

## app constant

best_non_killed_arm=4000
best_non_killed_decode_tok_s_9_102=2.838197
within_5pct_threshold_tok_s_9_102=2.696288
app_constant_C_MiB=3437
app_constant_arm=auto
app_constant_observed_basis_C_MiB=4000
frozen_app_constant_available=False
app_constant_auto_resolved_cache_MiB=3437.000000

## Arbitration (post-hoc, declared)

decode_window=9–102
decoded_text_identity=EOS-identical across all 15 runs, md5 of decoded text identical
best_arm=4000
best_decode_tok_s_9_102=2.838197
threshold_95pct=2.696288
auto_decode_tok_s_9_102=2.752912
auto_to_best_ratio=0.969950
auto_resolved_sizes_MiB=3429.3/3437.0/3524.5
auto_resolved_median_MiB=3437.0
app_constant=3437 MiB (auto's median resolved size)
frozen_window=NA (EOS at 102)

## blocks

| block | scheduled | success | killed | skipped | completed_arms | killed_arms | skipped_arms |
|---:|---:|---:|---:|---:|---|---|---|
| 1 | 5 | 5 | 0 | 0 | 0,1500,2000,4000,auto |  |  |
| 2 | 5 | 5 | 0 | 0 | 1500,2000,4000,auto,0 |  |  |
| 3 | 5 | 5 | 0 | 0 | 2000,4000,auto,0,1500 |  |  |

## q60b comparison

q60b_mmap_io_gate_seq_median_MB_s=430.223000
q60b_mmap_best_sustained_cell_MB_s=1157.376741
q60b_mmap_streaming_figure=1157.376741 MB/s (REPORT.md best_sustained_cell_MB_s; q60b mmap page-fault streaming; S23 same device class; io_gate_seq_median_MB_s; q60b n=128/512/2048; cold-designated rep1 then warm reps)
q60b_conditions=q60b mmap page-fault streaming; S23 same device class; io_gate_seq_median_MB_s; q60b n=128/512/2048; cold-designated rep1 then warm reps
q64_metric=4000-MiB best-arm median read rate over observed decode wall (102 rows); post-hoc app constant=3437 MiB
q64_app_constant_read_rate_MB_s=235.524896
q64_to_q60b_ratio=0.547448
wall-normalized effective read-rate ratio 0.547 vs the raw O_DIRECT sequential gate 430.2 MB/s (results/io_gate/s23_ufs31), not a capability comparison; io-time-only rates at the app constant 569–613 MB/s (1.32× the gate)
causal_claim=none

## Prefill caveat

prefill_column=128/prefill_s (pre-registered convention; engine counts 133 tokens → engine tps 3.9 % higher)
prefill_caveat=the prefill decline vs cache size is NOT established (within-arm spread 11.3–16.7 s, block-3 all slow, no prefill telemetry)

## deviations

deviation_1=page cache not droppable without root; cold expert cache is process-local
deviation_2=dmesg readability recorded per invocation; logcat lowmemorykiller queried per invocation
deviation_3=-n 128 emitted 102 decode rows before EOS; requested 9-128 and full-128 windows are unavailable
deviation_4=initial q56 detached-guard manifest exposed guard rc null after a successful 1500-MiB arm; launcher_rc=1 wrapper-race artifacts also occurred on b2_a2_2000 and b3_a4_0 (workload_rc=0, complete 102-row CSVs); adapter corrected and data preserved; no validity impact
deviation_5=dmesg not readable; rc/signal plus logcat evidence used for LMK classification
