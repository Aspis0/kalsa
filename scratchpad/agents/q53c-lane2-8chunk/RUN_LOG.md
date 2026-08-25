# q53c lane-2 CPU reference — run log

prereg_commit=931c9e85
htp_run_performed=0
htp_source=scratchpad/agents/q53-v73-npu-correctness/raw/lane2_s2_qwen_htp_ppl.log
htp_log_bytes=76575653
htp_running_ppl_8=7.4314
htp_running_ppl_8_log_line=190774
htp_final_ppl_32=8.5179
htp_final_ppl_32_error=0.12523
htp_final_log_line=560759
htp_device_mtime_local=2026-08-25T00:14:45.361167495-04:00
htp_device_mtime_utc=2026-08-25T04:14:45.361167495Z
adb_drop_utc=2026-08-25T03:46:11.441006Z
mtime_after_adb_drop_seconds=1713.920161
htp_execute_op_lines=55730
htp_execute_op_sample_1=64863:0.30.340.173 D ggml-hex: HTP0 execute-op RMS_NORM+MUL
htp_execute_op_sample_2=64869:0.30.340.195 D ggml-hex: HTP0 execute-op SCALE
htp_execute_op_sample_3=64872:0.30.340.202 D ggml-hex: HTP0 execute-op GET_ROWS
htp_timing_answer=log_finished_after_adb_drop; final_estimate_present; exact_shutdown_time_unavailable

## CPU reference

pre_run_llama_bench_sha256=5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507
pre_run_libggml_hexagon_sha256=f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448
pre_run_libggml_htp_v73_sha256=c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5
pre_run_llama_perplexity_sha256=4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50
pre_run_qwen_sha256=298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb
pre_run_corpus_sha256=173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08
pre_run_hash_result=all_match
pre_run_requirements=temperature_le_30C;battery_ge_50%;unplugged
pre_run_level_percent=54
pre_run_temperature_tenths=280
pre_run_voltage_mv=3877
pre_run_health=2
pre_run_ac_powered=false
pre_run_usb_powered=false
pre_run_wireless_powered=false
pre_run_guard_sha256=af2819af183e64f447680e7e5058fa8da1f4237fbe65548e427b55e98edab3e2

cpu_command=/data/local/tmp/kalsahtp/llama-perplexity -m /data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf -f /data/local/tmp/wiki.test.raw -c 2048 -b 2048 -ub 1024 -t 8 -ngl 0 --chunks 32 --ppl-stride 0 -fa on --load-mode none -v
cpu_binary_pid=26481
cpu_cpuset=CPUSET_UNAVAILABLE
cpu_guard_warn_tenths=380
cpu_guard_kill_tenths=410
cpu_guard_interval_s=10
cpu_guard_exit=2
cpu_workload_rc=137
cpu_wall_seconds=362.448
cpu_guard_max_temperature_tenths=383
cpu_max_temperature_tenths=394
cpu_post_kill_eventlog_max_temperature_tenths=394
cpu_battery_start_percent=54
cpu_battery_end_percent=50
cpu_battery_end_temperature_tenths=383
cpu_running_ppl_1=7.9064
cpu_running_ppl_8=NA
cpu_running_ppl_32=NA
cpu_running_chunk_max=1
cpu_r8=NA
cpu_r32=NA
cpu_gate_r8=NA
cpu_gate_r32=NA
cpu_execute_op_htp0=false
cpu_outcome=thermal_hard_abort_before_chunk_8;post_kill_thermal_overshoot
cpu_guard_hard_abort=true
cpu_raw_stdout_sha256=NA
