# q61 RUN_LOG

cell=q61-xiaomi-ufs4-streaming-floor
prereg_lock=e51542ed
device=23127PN0CG / houji_global / SM8650 / Hexagon v75 / Adreno 750 / UFS 4.0 / 12 GB
serial=adb-625689a2-9xEOfw._adb-tls-connect._tcp
wireless=1; unplugged=1; no_deletion=1; no_charging_change=1; git=0; BigMoeOnEdge=0; reconnects=0
guard_parser=current block only: ^  temperature: [0-9]+ and ^  level: [0-9]+; timeout=/system/bin/timeout; WARN=400; KILL=430; interval=1s; sensor_fail_limit=4
guard_T2=PASS; tag=q61_guard_t2_cpu_20260826; guard_rc=0; workload_rc=0; MAX; samples=271/79; execute_op_htp0=0
guard_T1=PASS; tag=q61_guard_t1_cpu_20260826; threshold=266=current_pre_temp_271-5; guard_rc=2; workload_rc=137; KILL_THRESHOLD; KILLED; max=281
guard_T1_launcher_note=immediate kill caused launcher readiness classification guard-not-ready/75; the guard log and required guard_rc/workload_rc path passed
primary_model=none found on PC at >=1.2x MemTotal; no push
selected_model=/data/local/tmp/Marco-Mini-Instruct-KEXP-fromsrc-trunk-q8_0.gguf; bytes=6509642624; sha256=bd63fc0f21a8c3aab4b7531ee30aa37f8e6320dfb65e85de74a9056e2feeb419; regime=secondary borderline (model < MemTotal; not a clean streaming arm)
selected_binary=/data/local/tmp/kalsa16/llama-bench; sha256=b2ae0fa6c413a5049a87b0706f2687cd7035ae5e43985fe40779dc0a7d225b2c; libllama_bench_impl_sha256=8adc148c0909e8ebbbf6ed41970b2c07ac0319db96454ad0dd7b2f281a9b8807; -ngl=0; mmap=1; -nr=1; NPU/GPU flags absent
protocol=pp512 x3, pp2048 x1, pp128 x1; each rep1 hash then >=600s no-touch; each launch separate; cool-start <=32.0C by 60s polls; battery floor 45%
stderr_split=--progress benchmark starting to prompt run marker is load phase; samples_ns is timed eval wall; sampler-window-vs-wall recorded per launch

## runs
q61_borderline_marco_n512_r1 pre_level=78 pre_temp_C=27.2 post_level=77 post_temp_C=27.9 wall_s=13.767405 load_s=3.640537 prefetch_MB=7404.044 eval_MB=5090.849 eval_MB_s=369.775 majflt=524 guard_manifest=raw/q61_borderline_marco_n512_r1.manifest.json
q61_borderline_marco_n512_r2 pre_level=77 pre_temp_C=27.9 post_level=77 post_temp_C=28.3 wall_s=16.012015 load_s=3.476999 prefetch_MB=0.000 eval_MB=11826.696 eval_MB_s=738.614 majflt=590 guard_manifest=raw/q61_borderline_marco_n512_r2.manifest.json
q61_borderline_marco_n512_r3 pre_level=77 pre_temp_C=28.3 post_level=77 post_temp_C=28.4 wall_s=10.047197 load_s=2.372447 prefetch_MB=0.000 eval_MB=5099.254 eval_MB_s=507.530 majflt=598 guard_manifest=raw/q61_borderline_marco_n512_r3.manifest.json
q61_borderline_marco_n2048_r1 pre_level=76 pre_temp_C=27.9 post_level=76 post_temp_C=29.7 wall_s=60.461335 load_s=2.354963 prefetch_MB=0.000 eval_MB=11147.067 eval_MB_s=184.367 majflt=117783 guard_manifest=raw/q61_borderline_marco_n2048_r1.manifest.json
q61_borderline_marco_n128_r1 pre_level=75 pre_temp_C=28.4 post_level=75 post_temp_C=28.4 wall_s=8.364790 load_s=3.701232 prefetch_MB=0.000 eval_MB=5230.707 eval_MB_s=625.324 majflt=1084 guard_manifest=raw/q61_borderline_marco_n128_r1.manifest.json

## derivations
best_observed_eval_pass_MB_s=738.613852; io_gate_xiaomi_reference_MB_s=2046.000; gate_comparability=reference_only
headroom=wall/max(eval_read/rate, stime+utime/k); k=2,4,8; self-consistent rate=each launch eval_read/eval_wall; cell-best rate=max observed eval pass; user-compute-only; stime stays CPU
pp512_warm_wording_self_consistent=flash-bound; ratio_median=1.000000; cell_best_wording=flash-bound; ratio_median=0.843569
settling_statement=self-consistent pp512 warm headroom <= 1.3x: streaming stays CPU on every generation we own; HVX, if ever, is resident-only
max_temperature_C=29.7; battery_start_pct=78; battery_end_pct=75
pressure_io_readable=0
anomalies=no PC MoE GGUF met the clarified >=1.2x MemTotal primary threshold; no model push; selected model is secondary borderline: 6.509642624 GB file is > current MemAvailable but < MemTotal; q61_guard_t2_20260826 rehearsal used HTP-linked binary and is excluded; valid T2 uses kalsa16 CPU/OpenCL build; q61_guard_t1_cpu_20260826 guard killed before launcher readiness classification; guard log and rc/workload kill path are valid; sampler: /proc/pressure/io unreadable in at least one measured run; local recorder cleanup bug after r1 was salvaged from preserved raw files, with no residual device process and no rerun of r1
