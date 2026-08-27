# q62 numbers

| attempt | status | stop_reason |
|---|---|---|
| Attempt 1 | STOPPED unknown arg: -r | unknown arg: -r |
| Attempt 2 | DONE_OPTIONAL | NA |

| arm | invocation | io_ms | compute_ms | mgmt_ms | read_mb | majflt | cpu_ms | wall_s | compute_share(point) | io_share(point) | overlap | wording(engine phase-0 counters) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| optional_p2048 | optional_p2048 | NA | NA | NA | 33171.949 | NA | NA | 159.936000 | 0.898279 | 0.101721 | 0.000000 | NA |
| primary | primary_inv1 | NA | NA | NA | 7148.645 | NA | NA | 38.049000 | 0.889521 | 0.110479 | 0.000000 | NA |
| primary | primary_inv2 | NA | NA | NA | 7148.645 | NA | NA | 35.814000 | 0.880098 | 0.119902 | 0.000000 | NA |
| primary | primary_inv3 | NA | NA | NA | 7148.645 | NA | NA | 32.781000 | 0.899413 | 0.100587 | 0.000000 | NA |
| secondary | secondary_inv1 | NA | NA | NA | 7148.645 | NA | NA | 34.987000 | 0.871487 | 0.128513 | 0.000000 | NA |
| secondary | secondary_inv2 | NA | NA | NA | 7148.645 | NA | NA | 34.206000 | 0.870543 | 0.129457 | 0.000000 | NA |
| secondary | secondary_inv3 | NA | NA | NA | 7148.645 | NA | NA | 34.699000 | 0.875802 | 0.124198 | 0.000000 | NA |
Cache comparison (secondary − primary prefill wall; negative = secondary faster): inv1 -3.062 s (-8.05%); inv2 -1.608 s (-4.49%); inv3 +1.918 s (+5.85%); mean -0.917 s (-2.58%).
Pooled mean = mean of per-invocation deltas in seconds / mean primary wall = -0.917 s / 35.548 s = -2.58%; not the mean of per-invocation percentages.
Prefill cache interpretation: consistent with no measurable prefill effect (deltas −8.05/−4.49/+5.85 %, within this device's ±6–14 % run scatter).
Optional arm: n=1, exploratory.

## Phase-0 I/O trace

phase code 0 is PREFILL; phase code 1 is the single decode step and is excluded. overlap=0 is taken from the trace header.
Max-lane-per-layer model (primary audit): the trace has no timestamps; all PREFILL rows have step=485, with one wave per layer and lanes interleaved. This model is PLAUSIBLE NOT VERIFIED for PREFILL, but is bracketed by the engine's own decode io_ms=334.4 ms versus trace max-lane 328.3 ms (1.9%) and refutes serialized Σlat=1275 ms. The primary verdict cannot flip: even the serialized upper bound stays ≤0.5.

| invocation | phase_code | prefill_rows | sum_latency_s | lane0_s | lane1_s | lane2_s | lane3_s | sum_layers_max_lane_s (I/O wall) | compute_wall_s | wall_s | overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| optional_p2048 | 0 | 90684 | 64.912462 | 16.262921 | 16.225016 | 16.218765 | 16.205759 | 16.268917 | 143.667083 | 159.936000 | 0 |
| primary_inv1 | 0 | 19542 | 16.483904 | 4.196081 | 4.097951 | 4.093394 | 4.096478 | 4.203631 | 33.845369 | 38.049000 | 0 |
| primary_inv2 | 0 | 19542 | 17.098218 | 4.285709 | 4.273158 | 4.272482 | 4.266868 | 4.294159 | 31.519841 | 35.814000 | 0 |
| primary_inv3 | 0 | 19542 | 13.127897 | 3.291864 | 3.278180 | 3.276945 | 3.280908 | 3.297338 | 29.483662 | 32.781000 | 0 |
| secondary_inv1 | 0 | 19542 | 17.899308 | 4.472693 | 4.472311 | 4.479551 | 4.474753 | 4.496277 | 30.490723 | 34.987000 | 0 |
| secondary_inv2 | 0 | 19542 | 17.646286 | 4.411847 | 4.411011 | 4.410162 | 4.413265 | 4.428204 | 29.777796 | 34.206000 | 0 |
| secondary_inv3 | 0 | 19542 | 17.155753 | 4.286872 | 4.291554 | 4.289173 | 4.288154 | 4.309557 | 30.389443 | 34.699000 | 0 |

## I/O floors, shares, and PREREG wording

lower = sum latency / 4; point = sum over layers of max lane time; upper = sum latency. compute_wall = wall - point I/O wall.

| invocation | bound | I/O floor wall_s | io_share | compute_share(point) | PREREG wording | wording robust across bounds |
|---|---|---:|---:|---:|---|---|
| optional_p2048 | lower | 16.228115 | 0.101466 | 0.898279 | compute-bound | True |
| optional_p2048 | point | 16.268917 | 0.101721 | 0.898279 | compute-bound | True |
| optional_p2048 | upper | 64.912462 | 0.405865 | 0.898279 | compute-bound | True |
| primary_inv1 | lower | 4.120976 | 0.108307 | 0.889521 | compute-bound | True |
| primary_inv1 | point | 4.203631 | 0.110479 | 0.889521 | compute-bound | True |
| primary_inv1 | upper | 16.483904 | 0.433228 | 0.889521 | compute-bound | True |
| primary_inv2 | lower | 4.274554 | 0.119354 | 0.880098 | compute-bound | True |
| primary_inv2 | point | 4.294159 | 0.119902 | 0.880098 | compute-bound | True |
| primary_inv2 | upper | 17.098218 | 0.477417 | 0.880098 | compute-bound | True |
| primary_inv3 | lower | 3.281974 | 0.100118 | 0.899413 | compute-bound | True |
| primary_inv3 | point | 3.297338 | 0.100587 | 0.899413 | compute-bound | True |
| primary_inv3 | upper | 13.127897 | 0.400473 | 0.899413 | compute-bound | True |
| secondary_inv1 | lower | 4.474827 | 0.127900 | 0.871487 | compute-bound | False |
| secondary_inv1 | point | 4.496277 | 0.128513 | 0.871487 | compute-bound | False |
| secondary_inv1 | upper | 17.899308 | 0.511599 | 0.871487 | mixed | False |
| secondary_inv2 | lower | 4.411571 | 0.128971 | 0.870543 | compute-bound | False |
| secondary_inv2 | point | 4.428204 | 0.129457 | 0.870543 | compute-bound | False |
| secondary_inv2 | upper | 17.646286 | 0.515883 | 0.870543 | mixed | False |
| secondary_inv3 | lower | 4.288938 | 0.123604 | 0.875802 | compute-bound | True |
| secondary_inv3 | point | 4.309557 | 0.124198 | 0.875802 | compute-bound | True |
| secondary_inv3 | upper | 17.155753 | 0.494416 | 0.875802 | compute-bound | True |
Study-wide narrowest margin: secondary inv3 upper-bound io share = 0.494, 1.1% below the 0.5 boundary; secondary inv1/inv2 are mixed under the serialized upper bound, with robustness False/False/True. All 3×3 cells are compute-bound except those two secondary upper-bound cells.
Primary narrowest margin: inv2 upper-bound io share = 0.477, 4.5% below the 0.5 boundary; all primary 3×3 cells are compute-bound.

## Headroom (wall-seconds)

point is the primary I/O wall; lower/upper are sensitivity bounds. Formula: wall / max(I/O wall, compute_wall/k), k = 2, 4, 8.

| invocation | lower_k2 | point_k2 | upper_k2 | lower_k4 | point_k4 | upper_k4 | lower_k8 | point_k8 | upper_k8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| optional_p2048 | 2.226481 | 2.226481 | 2.226481 | 4.452962 | 4.452962 | 2.463872 | 8.905923 | 8.905923 | 2.463872 |
| primary_inv1 | 2.248402 | 2.248402 | 2.248402 | 4.496804 | 4.496804 | 2.308252 | 8.993609 | 8.993609 | 2.308252 |
| primary_inv2 | 2.272473 | 2.272473 | 2.094604 | 4.544947 | 4.544947 | 2.094604 | 8.378417 | 8.340167 | 2.094604 |
| primary_inv3 | 2.223672 | 2.223672 | 2.223672 | 4.447344 | 4.447344 | 2.497049 | 8.894689 | 8.894689 | 2.497049 |
| secondary_inv1 | 2.294928 | 2.294928 | 1.954657 | 4.589855 | 4.589855 | 1.954657 | 7.818626 | 7.781327 | 1.954657 |
| secondary_inv2 | 2.297417 | 2.297417 | 1.938425 | 4.594833 | 4.594833 | 1.938425 | 7.753700 | 7.724576 | 1.938425 |
| secondary_inv3 | 2.283622 | 2.283622 | 2.022587 | 4.567244 | 4.567244 | 2.022587 | 8.090347 | 8.051640 | 2.022587 |
Settling rule (PREREG; primary): min headroom(k=4) = 2.095 ≥ 2.0 under every bound → streaming-NPU has a real ceiling under the product streamer (HVX prerequisite (1) — decision is the owner's).
Secondary settling: min headroom(k=4) = 1.938 under the serialized upper bound (owner-decision zone); lower/point bounds are ≥ 2.0.
Settling k=4 minima across all bounds by arm: optional_p2048=2.464; primary=2.095; secondary=1.938.

## Read and rate cross-check

trace read_bytes / 1,048,576 = MiB and /1,000,000 = decimal MB. The engine field is named read_mb but 351.160 matches 368,214,016 / 1,048,576 = 351.156250 MiB (rounded), not decimal MB; decimal MB is shown separately. Effective prefill MB/s = trace bytes / point I/O wall / 1,000,000; engine decode rate is the printed MiB/s counter.
Systematic over-read in pp512 runs: +4096 B per read in 19,161/19,542 reads (+1.05%), included consistently in all pp512 byte totals.

| invocation | prefill_read_bytes | prefill_read_MiB | engine_decode_read_mb_field | engine_decode_read_MB_decimal | engine_decode_read_bytes | engine_decode_read_MiB | effective_prefill_MB_s | effective_prefill_MiB_s | engine_decode_MiB_s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| optional_p2048 | 34783309824 | 33171.949219 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 2138.022504 | 2038.977150 | 798.000000 |
| primary_inv1 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 1783.195705 | 1700.587945 | 1050.000000 |
| primary_inv2 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 1745.603129 | 1664.736870 | 1021.000000 |
| primary_inv3 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 2273.317930 | 2168.004923 | 1079.000000 |
| secondary_inv1 | 7495897088 | 7148.644531 | 245.880000 | 257.818624 | 257818624 | 245.875000 | 1667.134274 | 1589.903139 | 817.000000 |
| secondary_inv2 | 7495897088 | 7148.644531 | 245.880000 | 257.818624 | 257818624 | 245.875000 | 1692.762277 | 1614.343908 | 770.000000 |
| secondary_inv3 | 7495897088 | 7148.644531 | 245.880000 | 257.818624 | 257818624 | 245.875000 | 1739.366195 | 1658.788867 | 823.000000 |

## Sampler and gates

sampler_cpu_s=0.020 over 40 rows followed the wrapper pid, not binary_pid — cross-check failed. No sampler CPU share is derived; cpuset evidence from binary_pid stands.

| invocation | sampler_rows | sampler_cpu_s | sampler_wall_s | sampler_read_bytes | cpuset | cpuset_gate | cross-check | guard_max_temp_C |
|---|---:|---:|---:|---:|---|---|---|---:|
| optional_p2048 | 140 | 0.020 | 184.880 | 8192 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 34.7 |
| primary_inv1 | 40 | 0.020 | 59.580 | 0 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 28.7 |
| primary_inv2 | 38 | 0.020 | 53.020 | 12288 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 29.2 |
| primary_inv3 | 36 | 0.020 | 44.260 | 4096 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 31.2 |
| secondary_inv1 | 41 | 0.030 | 47.360 | 28672 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 32.2 |
| secondary_inv2 | 38 | 0.010 | 44.030 | 16384 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 32.2 |
| secondary_inv3 | 38 | 0.010 | 43.860 | 4096 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 33.0 |

## Gate values

| gate | value |
|---|---|
| prompt_tokens | 486 (primary CSV summary n_prompt field); Amendment-1 window 480–544 is effectively 480–511 with -n 1 (n_ctx 512); 486 is inside both |
| decode_n | 1 (n=0 probe rejected; one decode row excluded) |
| calibration_measurement | false; calibration loads discarded |
| primary_battery_min_pct | 50 (gate >=45) |
| cool_start_max_C | 30.4 (gate <=32.0) |
| guard_warn_C / kill_C / poll_s | 40 / 43 / 10 |
| cpuset_allowed | 0-7 |
| drop_caches | denied in Attempt 1; not retried |
| follow-up battery deviation | run_q62.py used >=40% versus locked >=45%; actual levels 68% -> 60% were all >=45%; no invocation was admitted that the locked gate would reject |
| secondary | --cache-mb 2000; 3 separate invocations completed; gate used >=40% (formal deviation above); observed levels all >=45% |
| optional_p2048 | --cache-mb 0; 1 invocation completed; n=1, exploratory; prompt_tokens=2033; gate used >=40% (formal deviation above) |
| phase-0 engine counters | io_ms, compute_ms, mgmt_ms, cpu_ms, majflt absent; not fabricated |
| primary wall trend | 38.049→35.814→32.781 s (−13.85%); 82.8% of the drop is compute-side, I/O non-monotone; primary verdict survives |
| optional calibration | optional_p2048_calib1=1947, optional_p2048_calib2=None, optional_p2048_calib3=2033; calibration 2 n_ctx rejection retained; final accepted count=2033 |
| optional prompt hash | a748f3c4fa0977517f9e74d3aef64e62c74f1c2d5a71cae949eb080cb585bb8a; 7894 B; device recheck matches; superseded candidate 66271b47... was 7973 B and is retained as raw/q62_p2048.superseded_candidate.sha256.txt |

The former read-rate-divided-by-wall identity is not used. The engine's BMOE_PROGRESS/CSV counters cover the one decode step, not phase-0 I/O/compute.
