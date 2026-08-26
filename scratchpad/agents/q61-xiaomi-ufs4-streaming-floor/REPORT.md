# q61 numbers

DISCLAIMER: this cell does NOT decide GO/NO-GO for any kernel; it characterizes the streaming prefill floor. The selected arm is secondary borderline (model < MemTotal), not a clean streaming-regime arm.
LEGEND: headroom = eval wall / max(I/O floor, stime + utime/k); k = hypothetical user-matmul speed-up; stime stays on CPU; values >1 are ceilings, not predictions.

| n | rep | cache | load_s(stderr) | eval_wall_s | sampler_window_s | window/wall | prefetch_MB | eval_read_MB | eval_MB/s | re-read_x | utime_s | stime_s | user_share_8t | stime_share_8t | majflt |
|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 512 | 1 | cold-designated | 3.640537 | 13.767405 | 19.510000 | 1.417115 | 7404.044 | 5090.849 | 369.775 | 0.782 | 38.410 | 17.160 | 0.348740 | 0.155803 | 524 |
| 512 | 2 | warm | 3.476999 | 16.012015 | 30.360000 | 1.896076 | 0.000 | 11826.696 | 738.614 | 1.817 | 37.370 | 16.520 | 0.291734 | 0.128966 | 590 |
| 512 | 3 | warm | 2.372447 | 10.047197 | 14.660000 | 1.459113 | 0.000 | 5099.254 | 507.530 | 0.783 | 38.980 | 12.070 | 0.484961 | 0.150166 | 598 |
| 2048 | 1 | cold-designated | 2.354963 | 60.461335 | 93.250000 | 1.542308 | 0.000 | 11147.067 | 184.367 | 1.712 | 166.020 | 47.980 | 0.343236 | 0.099196 | 117783 |
| 128 | 1 | cold-designated | 3.701232 | 8.364790 | 14.350000 | 1.715524 | 0.000 | 5230.707 | 625.324 | 0.804 | 12.380 | 11.660 | 0.185002 | 0.174242 | 1084 |

| n | rep | self_io_floor_s | cell_best_io_floor_s | self_hr_k2 | self_hr_k4 | self_hr_k8 | cell_best_hr_k2 | cell_best_hr_k4 | cell_best_hr_k8 |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 512 | 1 | 13.767405 | 6.892436 | 0.378589 | 0.514429 | 0.626895 | 0.378589 | 0.514429 | 0.626895 |
| 512 | 2 | 16.012015 | 16.012015 | 0.454822 | 0.619121 | 0.755596 | 0.454822 | 0.619121 | 0.755596 |
| 512 | 3 | 10.047197 | 6.903815 | 0.318352 | 0.460564 | 0.593017 | 0.318352 | 0.460564 | 0.593017 |
| 2048 | 1 | 60.461335 | 15.091874 | 0.461572 | 0.675659 | 0.879662 | 0.461572 | 0.675659 | 0.879662 |
| 128 | 1 | 8.364790 | 7.081788 | 0.468616 | 0.566912 | 0.633336 | 0.468616 | 0.566912 | 0.633336 |

model_regime = secondary borderline (model < MemTotal; not a clean streaming arm)
best_observed_eval_pass_MB_s = 738.613852
pp512_warm_self_consistent_io_floor_ratio_median = 1.000000
pp512_warm_cell_best_io_floor_ratio_median = 0.843569
pp512_warm_wording_self_consistent = flash-bound
pp512_warm_wording_cell_best = flash-bound
settling_statement = self-consistent pp512 warm headroom <= 1.3x: streaming stays CPU on every generation we own; HVX, if ever, is resident-only
max_temperature_C = 29.7
battery_start_pct = 78
battery_end_pct = 75
guard_T2 = PASS
guard_T1 = PASS (launcher readiness classified guard-not-ready due immediate kill)
anomalies = no PC MoE GGUF met the clarified >=1.2x MemTotal primary threshold; no model push; selected model is secondary borderline: 6.509642624 GB file is > current MemAvailable but < MemTotal; q61_guard_t2_20260826 rehearsal used HTP-linked binary and is excluded; valid T2 uses kalsa16 CPU/OpenCL build; q61_guard_t1_cpu_20260826 guard killed before launcher readiness classification; guard log and rc/workload kill path are valid; sampler: /proc/pressure/io unreadable in at least one measured run; local recorder cleanup bug after r1 was salvaged from preserved raw files, with no residual device process and no rerun of r1
