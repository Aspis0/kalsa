# q56 thermal watchdog report

## health

```text
cooldown_reached=1
cooldown_minutes=15.8
cooldown_start_epoch=1787631844
cooldown_start_level_pct=56
cooldown_start_temperature_tenths=343
cooldown_start_ac=0
cooldown_start_usb=0
cooldown_end_epoch=1787632793
cooldown_end_level_pct=55
cooldown_end_temperature_tenths=299
uptime_seconds=5867.47
ro_boot_bootreason=shutdown,lpm
sys_boot_reason=shutdown,lpm
health_code=2
phase1_level_pct=55
phase1_temperature_tenths=299
phase1_voltage_mv=3887
phase1_ac=0
phase1_usb=0
data_total_gb=104
data_used_gb=96
data_available_gb=8.2
data_use_pct=93
final_level_pct=54
final_temperature_tenths=288
final_health_code=2
final_voltage_mv=3881
final_ac=0
final_usb=0
residual_llama_bench_processes=0
residual_thermal_guard_processes=0
abort_temperature_tenths=380
abort_level_pct=45
```

## integrity

```text
llama-bench=5db18906bfe159ba97da18404c513886a5b2a07ec715c18dda7a1bc2d6d38507 MATCH
libggml-hexagon.so=f06aa3098f63fd4f419d9943063a07a4718fc32832a919734d0094fccdea6448 MATCH
libggml-htp-v73.so=c8f9d14a388455ec364e99d4f63dbee773a4bad6de204b61496fe128f125edd5 MATCH
llama-perplexity=4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50 MATCH
wiki.test.raw=173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08 MATCH
LFM-B-prime=38a93d7120ef217effba39e4490d341ce02a0ed04fef899d65b03c1322a1b13a MATCH
Qwen3.5-4B-Q4_0=298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb MATCH
mismatches=0
thermal_guard_sha256=1397e02f7866e32d8921a2c3db9cd4a09d25ba42719f10933cb9fc82f2e93d58
launch_with_guard_sha256=a829f5f9d4b54c93455d763d2468643b3000d1cb7044219a752bf12b02a77fb6
thermal_guard_device_sha256=NOT_REVALIDATED
```

## validation

```text
test1=PASS
test1_binary_pid=25380
test1_cpuset=/
test1_workload_rc=137
test1_guard_rc=2
test1_warn_tenths=281
test1_kill_tenths=281
test1_max_temperature_tenths=286
test1_wall_seconds=2.031
test1_jsonl_rows=0
test1_execute_op_htp0_stderr=0

test2=PASS
test2_binary_pid=25431
test2_cpuset=/
test2_workload_rc=0
test2_guard_rc=0
test2_warn_tenths=400
test2_kill_tenths=430
test2_max_temperature_tenths=295
test2_wall_seconds=23.270
test2_jsonl_rows=2
test2_n_gpu_layers=0
test2_execute_op_htp0_stderr=0
```

## production_command

```text
python scratchpad\\agents\\q56-thermal-watchdog\\launch_with_guard.py --serial 192.168.1.152:41679 --tag future_cell --warn-tenths 400 --kill-tenths 430 --session-hard-cap-tenths 380 --sensor-failure-limit 3 --interval-s 10 --max-seconds 120 --local-dir scratchpad\\agents\\q56-thermal-watchdog\\raw -- /data/local/tmp/kalsahtp/llama-bench -m /data/local/tmp/LFM2.5-8B-A1B-KEXP-fromsrc-trunk-q8_0.gguf -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0 --load-mode none -fa on --ubatch-size 1024
requested_warn_tenths=400
requested_kill_tenths=430
session_hard_cap_tenths=380
effective_kill_tenths=380
effective_kill_temperature_c=38.0
sensor_failure_limit=3
sensor_timeout_s=5
sensor_failure_window_s=15
fail_closed_false_kill_accepted=1
```

## pulled_lane2_evidence

```text
lane2_s2_qwen_htp_ppl.log_bytes=76575653
lane2_s2_qwen_htp_ppl_chunks=32
lane2_s2_qwen_htp_ppl_final=8.5179
lane2_s2_qwen_htp_ppl_error_margin=0.12523
lane2_s2_qwen_htp_ppl_dspqueue_write=0
lane2_s2_qwen_htp_ppl_execute_op_htp0=1
live_capture_chunks=4
q53b_b512_htp_ppl_already_local=1
```

## anomalies

```text
bootreason=shutdown,lpm
data_use_pct=93
recovered_device_log_exceeded_live_capture=1
test2_jsonl_backends=HTP
test2_jsonl_devices=auto
test2_n_gpu_layers=0
```

## Fixes applied (post-audit)

```text
1 -> on-device supervisor starts detached guard first; wrapper PID is published before exec and waits for GUARD_TRACKING, removing the heavy-op PID race
2 -> launcher verifies guard PID, GUARD_READY, and a numeric first sample within two poll intervals; failure kills supervisor/workload and returns 75
3 -> warn_tenths, kill_tenths, hard_abort_tenths/session_hard_cap_tenths, and effective_kill_tenths are explicit and logged at START; manifest/report state effective kill
4 -> final sample uses the same WARN/KILL/BATTERY/SENSOR checks before MAX
5 -> dumpsys is bounded by timeout 5 and elapsed sample time is subtracted from the sleep interval
6 -> kill -9 is followed by a one-second liveness confirmation; failure logs KILL_FAILED and exits 3
7 -> inclusive integer-tenths WARN/KILL comparisons retained and documented by explicit threshold fields
8 -> zero, malformed, missing, and invalid-level samples are sensor failures
9 -> nohup/setsid detached guard retained
10 -> exec workload remains the tracked wrapper PID
11 -> detached on-device guard remains independent of adb
12 -> guard log open is checked before START; launcher adds /data/local/tmp free-space preflight
13 -> bounded launcher wall-clock cap retained; guard log growth remains bounded for launched sessions
14 -> every adb operation uses bounded reconnects of 3 attempts spaced 90 seconds; polling and pulls report exhaustion, and successful reconnects continue to log-pull
15 -> battery low abort retained and renamed BATTERY_LOW_ABORT in guard logs
16 -> production command now states requested kill 430, session hard cap 380, and effective kill 380
17 -> prior validation evidence retained unchanged; no new device evidence claimed
18 -> first-poll kill behavior retained
19 -> launcher refuses /data/local/tmp below 500 MB free
A -> wrapper records WORKLOAD_NEVER_STARTED on exec failure; launcher marks workload_never_started and returns distinct exit 77
B -> supervisor EXIT trap now checks kill -0 before attempting cleanup kill
D -> guard checks command -v timeout at startup, logs TIMEOUT_BINARY_MISSING, and refuses to arm without it
E -> sensor_fail_limit remains 3 by design; 3 consecutive 5 s reads = 15 s binder-unavailability window, and fail-closed false-kill is explicitly accepted
H -> guard-ready deadline is max(2 poll intervals, 10 seconds)
K -> manifest records guard_exit_code and named guard_outcome: 0 normal, 2 thermal kill, 3 sensor fail-closed, 75 guard-not-ready, other otherwise
local_shell_syntax=PASS
local_python_compile=PASS
local_help_parse=PASS
validation_status=code-fixed, device re-validation PENDING (needs a cool device ≥ 50% battery: rerun test 1 + test 2 + a new test 3 for the fail-closed path by simulating sensor failure)
```
