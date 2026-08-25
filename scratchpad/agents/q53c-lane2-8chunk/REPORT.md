# q53 Lane 2 — session 3

```
model=Qwen3.5-4B-Q4_0
model_sha256=298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb
offload=CPU
chunks_requested=32
chunks_completed=1
PPL_CPU[1]=7.9064
PPL_CPU[8]=NaN
PPL_CPU_32=NaN
r8=NaN
r32=NaN
gate=NOT_COMPUTABLE
guard_warn_tenths=400
guard_kill_tenths=430
guard_effective_kill_tenths=430
guard_exit=3
guard_outcome=sensor_fail_closed
guard_max_temperature_tenths=387
workload_rc=137
launcher_exit=4
battery_start=100,274,unplugged
battery_end=96,379,unplugged
adb_reconnect_attempts=2
status=STOPPED
thermal_csv=thermal.csv
```

## Lane 2 (session 3 resume) — guarded result

```text
tag=q53_lane2_session3_resume_1025
model=Qwen3.5-4B-Q4_0
model_sha256=298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb
offload=CPU
chunks_requested=32
chunks_completed=2
PPL_CPU[1]=7.9064
PPL_CPU[2]=9.4097
PPL_CPU[8]=NaN
PPL_CPU_32=NaN
r8=NaN
r32=NaN
gate=NOT_COMPUTABLE
guard_warn_tenths=400
guard_kill_tenths=430
guard_effective_kill_tenths=430
guard_exit=2
guard_outcome=thermal_kill
guard_max_temperature_tenths=434
workload_rc=137
launcher_exit=75 (raw run; guard rc=2 thermal kill; reporting race fixed afterward)
battery_start=94,290,unplugged
battery_end=88,434,unplugged
adb_reconnect_attempts=0
status=STOPPED_BY_GUARD_BEFORE_CHUNK_8
thermal_csv=thermal_session3_resume_1025.csv
real_crash_signature=NONE
```

The raw guard trace contains `KILL_THRESHOLD` and `KILLED` at 434 tenths;
there was no `ggml_abort`, `GGML_ASSERT`, `dspqueue`, `INTERNAL-ERROR`,
`Aborted`, `Segmentation`, or explicit upper-case `CDSP` crash line. The
benign `common_fit_params ... n_gpu_layers already set by user to 0, abort`
warning is not a crash signature.
