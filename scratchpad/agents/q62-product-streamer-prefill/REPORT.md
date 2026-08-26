# q62 numbers

| attempt | status | stop_reason |
|---|---|---|
| Attempt 1 | STOPPED unknown arg: -r | unknown arg: -r |
| Attempt 2 | DONE_PRIMARY_AUDITED | NA |

| arm | invocation | io_ms | compute_ms | mgmt_ms | read_mb | majflt | cpu_ms | wall_s | compute_share(point) | io_share(point) | overlap | wording(engine phase-0 counters) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| primary | primary_inv1 | NA | NA | NA | 7148.645 | NA | NA | 38.049000 | 0.889521 | 0.110479 | 0.000000 | NA |
| primary | primary_inv2 | NA | NA | NA | 7148.645 | NA | NA | 35.814000 | 0.880098 | 0.119902 | 0.000000 | NA |
| primary | primary_inv3 | NA | NA | NA | 7148.645 | NA | NA | 32.781000 | 0.899413 | 0.100587 | 0.000000 | NA |

## Phase-0 I/O trace

phase code 0 is PREFILL; phase code 1 is the single decode step and is excluded. overlap=0 is taken from the trace header.
Max-lane-per-layer model: the trace has no timestamps; all PREFILL rows have step=485, with one wave per layer and lanes interleaved. This model is PLAUSIBLE NOT VERIFIED for PREFILL, but is bracketed by the engine's own decode io_ms=334.4 ms versus trace max-lane 328.3 ms (1.9%) and refutes serialized Σlat=1275 ms. The verdict cannot flip: even the serialized upper bound stays ≤0.5.

| invocation | phase_code | prefill_rows | sum_latency_s | lane0_s | lane1_s | lane2_s | lane3_s | sum_layers_max_lane_s (I/O wall) | compute_wall_s | wall_s | overlap |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| primary_inv1 | 0 | 19542 | 16.483904 | 4.196081 | 4.097951 | 4.093394 | 4.096478 | 4.203631 | 33.845369 | 38.049000 | 0 |
| primary_inv2 | 0 | 19542 | 17.098218 | 4.285709 | 4.273158 | 4.272482 | 4.266868 | 4.294159 | 31.519841 | 35.814000 | 0 |
| primary_inv3 | 0 | 19542 | 13.127897 | 3.291864 | 3.278180 | 3.276945 | 3.280908 | 3.297338 | 29.483662 | 32.781000 | 0 |

## I/O floors, shares, and PREREG wording

lower = sum latency / 4; point = sum over layers of max lane time; upper = sum latency. compute_wall = wall - point I/O wall.

| invocation | bound | I/O floor wall_s | io_share | compute_share(point) | PREREG wording | wording robust across bounds |
|---|---|---:|---:|---:|---|---|
| primary_inv1 | lower | 4.120976 | 0.108307 | 0.889521 | compute-bound | True |
| primary_inv1 | point | 4.203631 | 0.110479 | 0.889521 | compute-bound | True |
| primary_inv1 | upper | 16.483904 | 0.433228 | 0.889521 | compute-bound | True |
| primary_inv2 | lower | 4.274554 | 0.119354 | 0.880098 | compute-bound | True |
| primary_inv2 | point | 4.294159 | 0.119902 | 0.880098 | compute-bound | True |
| primary_inv2 | upper | 17.098218 | 0.477417 | 0.880098 | compute-bound | True |
| primary_inv3 | lower | 3.281974 | 0.100118 | 0.899413 | compute-bound | True |
| primary_inv3 | point | 3.297338 | 0.100587 | 0.899413 | compute-bound | True |
| primary_inv3 | upper | 13.127897 | 0.400473 | 0.899413 | compute-bound | True |
Narrowest margin: inv2 upper-bound io share = 0.477, 4.5% below the 0.5 boundary; all 3×3 cells are compute-bound.

## Headroom (wall-seconds)

point is the primary I/O wall; lower/upper are sensitivity bounds. Formula: wall / max(I/O wall, compute_wall/k), k = 2, 4, 8.

| invocation | lower_k2 | point_k2 | upper_k2 | lower_k4 | point_k4 | upper_k4 | lower_k8 | point_k8 | upper_k8 |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| primary_inv1 | 2.248402 | 2.248402 | 2.248402 | 4.496804 | 4.496804 | 2.308252 | 8.993609 | 8.993609 | 2.308252 |
| primary_inv2 | 2.272473 | 2.272473 | 2.094604 | 4.544947 | 4.544947 | 2.094604 | 8.378417 | 8.340167 | 2.094604 |
| primary_inv3 | 2.223672 | 2.223672 | 2.223672 | 4.447344 | 4.447344 | 2.497049 | 8.894689 | 8.894689 | 2.497049 |
Settling rule (PREREG): min headroom(k=4) = 2.095 ≥ 2.0 under every bound → streaming-NPU has a real ceiling under the product streamer (HVX prerequisite (1) — decision is the owner's).

## Read and rate cross-check

trace read_bytes / 1,048,576 = MiB and /1,000,000 = decimal MB. The engine field is named read_mb but 351.160 matches 368,214,016 / 1,048,576 = 351.156250 MiB (rounded), not decimal MB; decimal MB is shown separately. Effective prefill MB/s = trace bytes / point I/O wall / 1,000,000; engine decode rate is the printed MiB/s counter.
Systematic over-read: +4096 B per read in 19,161/19,542 reads (+1.05%), included consistently in all byte totals.

| invocation | prefill_read_bytes | prefill_read_MiB | engine_decode_read_mb_field | engine_decode_read_MB_decimal | engine_decode_read_bytes | engine_decode_read_MiB | effective_prefill_MB_s | effective_prefill_MiB_s | engine_decode_MiB_s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| primary_inv1 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 1783.195705 | 1700.587945 | 1050.000000 |
| primary_inv2 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 1745.603129 | 1664.736870 | 1021.000000 |
| primary_inv3 | 7495897088 | 7148.644531 | 351.160000 | 368.214016 | 368214016 | 351.156250 | 2273.317930 | 2168.004923 | 1079.000000 |

## Sampler and gates

sampler_cpu_s=0.020 over 40 rows followed the wrapper pid, not binary_pid — cross-check failed. No sampler CPU share is derived; cpuset evidence from binary_pid stands.

| invocation | sampler_rows | sampler_cpu_s | sampler_wall_s | sampler_read_bytes | cpuset | cpuset_gate | cross-check | guard_max_temp_C |
|---|---:|---:|---:|---:|---|---|---|---:|
| primary_inv1 | 40 | 0.020 | 59.580 | 0 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 28.7 |
| primary_inv2 | 38 | 0.020 | 53.020 | 12288 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 29.2 |
| primary_inv3 | 36 | 0.020 | 44.260 | 4096 | 0-7 | True | FAIL_WRONG_PID_SHELL_WRAPPER | 31.2 |

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
| secondary / optional_p2048 | omitted by owner-directed primary-only session |
| phase-0 engine counters | io_ms, compute_ms, mgmt_ms, cpu_ms, majflt absent; not fabricated |
| wall trend | 38.049→35.814→32.781 s (−13.85%); 82.8% of the drop is compute-side, I/O non-monotone; verdict survives |

The former read-rate-divided-by-wall identity is not used. The engine's BMOE_PROGRESS/CSV counters cover the one decode step, not phase-0 I/O/compute.
