# q67 numbers

## Attempt 1 A1/A2 (void)

| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | execute_op_HTP0 | execute_op_attn |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| a1_htp | DONE | 0 | NA | 16 | 33.4 | 33.3 | 33.4 | / | 722 | 96 |
| a2_cpu | DONE | 0 | NA | 14 | 33.3 | 33.3 | 33.3 | / | 0 | 0 |

common chunks = 0; last common n = NA; r = VOID; verdict letter = VOID (common chunks < 8).

## Attempt 2 corrected A1/A2

| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | execute_op_HTP0 | execute_op_attn |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|---:|
| a1_htp_attempt2 | STOPPED | 137 | 2 | 486 | 34.3 | 41.1 | 41.1 | / | 30674 | 3951 |

| chunk | HTP_PPL | CPU_PPL |
|---:|---:|---:|

common chunks = 0; last common n = NA;
r = VOID (no common chunks; no numeric derivation)
gate letter = VOID (PASS <= 2%; GREY 2-5%; FAIL > 5% or NaN).
pre-declared verdict = STOPPED.

## r20 characterization under Amendment 2 (post-result)

A1 attempt 2 guard-kill: 41.1 C; wall 486 s; valid PPL chunks 20; guard rc 2; cpuset /.

| cooldown poll | elapsed_s | battery_% | temp_C | MemAvailable_kB | plugged |
|---:|---:|---:|---:|---:|---|
| 1 | 0 | 72 | 36.8 | 6066868 | True |
| 2 | 301 | 75 | 35.6 | 5963556 | True |
| 3 | 601 | 78 | 34.8 | 5746348 | True |

| arm | status | workload_rc | guard_rc | wall_s | pre_temp_C | post_temp_C | guard_max_C | cpuset | chunks |
|---|---|---:|---:|---:|---:|---:|---:|---|---:|
| a2_cpu_amendment2 | STOPPED | 137 | 2 | 568 | 34.8 | 43.0 | 43.0 | / | 4 |

| chunk | HTP_PPL | CPU_PPL |
|---:|---:|---:|
| PPL chunk 1 | HTP 8.589300 | CPU 8.478000 |
| PPL chunk 2 | HTP 9.699800 | CPU 9.627800 |
| PPL chunk 3 | HTP 10.080000 | CPU 10.035400 |
| PPL chunk 4 | HTP 10.073200 | CPU 10.057600 |

n = min(20, A2 chunks reached) = 4; last common n = 4;
r20 = VOID (A2 guard-killed before chunk 8)
q55 letter = VOID (PASS <= 2%; GREY 2-5%; FAIL > 5% or NaN).
A2 guard-killed before chunk 8; r remains VOID; no retry.

## r characterization under Amendments 2+3 (post-result, CPU-ref only)

UNPLUGGED verification: AC powered=false; USB powered=false; Wireless powered=false; Dock powered=false; battery 99%; temperature 33.9 C.

| cooldown poll | elapsed_s | battery_% | temp_C | MemAvailable_kB | plugged |
|---:|---:|---:|---:|---:|---|
| 1 | 0 | 99 | 33.7 | 3962932 | False |
| 2 | 301 | 99 | 30.9 | 3952384 | False |
| 3 | 601 | 99 | 29.9 | 3914084 | False |
| 4 | 902 | 99 | 29.4 | 3919512 | False |
| 5 | 1202 | 99 | 28.9 | 3747716 | False |
| 6 | 1503 | 98 | 28.7 | 3575788 | False |
| 7 | 1803 | 98 | 28.4 | 3612176 | False |
| 8 | 2104 | 98 | 28.4 | 3824108 | False |
| 9 | 2404 | 98 | 27.9 | 3861284 | False |

A2 attempt 3: NOT-RUN; unplugged verified; cool-start temperature passed; MemAvailable gate not met by 2404 s; no workload/guard invocation.
n = NA; r = VOID (A2 attempt 3 not started); q55 letter = VOID; final verdict = STOPPED.

## r characterization under Amendments 2-4 (post-result, CPU-ref only)

Amendment 4: exactly one adb reboot; same wireless ADB serial reattached after 281 s; idle 180 s; no new IP or adb connect.
UNPLUGGED verification after idle: AC powered=false; USB powered=false; Wireless powered=false; Dock powered=false; battery 96%; temperature 32.3 C.
Pre-arm gate window: polls through boot elapsed 921 s; final battery 95%; temperature 30.9 C; MemAvailable 3607860 kB; plugged=false.
A2 attempt 4: NOT-RUN; MemAvailable gate remained below 4194304 kB; r = VOID; n = NA; q55 letter = VOID; final verdict = STOPPED; cell closed.

## B pp512 (attempt 1; stands)

| arm | status | first_sample_t/s | jsonl_avg_t/s | dT_C | max_C |
|---|---|---:|---:|---:|---:|
| b_npu | DONE | 199.685 | 201.719477 | 0.7 | 33.3 |
| b_cpu | DONE | 43.8054 | 45.020171 | 0.6 | 34.6 |

## Frozen protocol record

Corrected command addition: -f /data/local/tmp/wiki.test.raw; all other A1/A2 flags and environment unchanged.
A1 HTP guard: WARN 40.0 C / KILL 41.0 C; A2 CPU guard: WARN 40.0 C / KILL 43.0 C; poll 10 s; cap 600 s.
Cool-start <= 35.0 C; MemAvailable >= 4194304 kB; cpuset evidence from binary_pid.
STOPPED: A1 NPU guard kill at 41.1 C, guard rc 2; Amendment 2 A2 CPU guard kill at 43.0 C after 4 chunks, guard rc 2; Amendment 3 A2 not started after 2404 s gate wait; Amendment 4 one reboot then A2 not started after 921 s post-boot gate wait; r VOID; no further attempt; B was not rerun.
