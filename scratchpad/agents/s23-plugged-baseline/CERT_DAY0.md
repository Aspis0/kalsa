# S23 day-1 correctness certification

Device: `adb-R3CW406P8CV-zyLM4b (2)._adb-tls-connect._tcp`  
Date: 2026-08-26  
Scope: correctness only; no benchmark and no model load.

## Gate

- Battery eligibility before certification: 93%, unplugged, battery temperature 27.1 °C; threshold required by owner approval: >=40%.
- q56 guard: `/data/local/tmp/thermal_guard.sh`, WARN 40 °C, KILL 43 °C, poll 10 s, sensor failure limit 4.
- CPU mask: `taskset ff` (cpuset 0-7); recorded `Cpus_allowed_list: 0-7`, `/proc/<pid>/cpuset: /`, and mask `ff` in `raw/cert/s23_day1_cert/*.cpuset`.
- Device was **not plugged** during certification; this is the approved unplugged correctness gate, not the plugged thermal reference.

## Results

| suite | exact invocation | result | rc | guard rc |
|---|---|---:|---:|---:|
| MoE / all types | `./test-backend-ops -o MUL_MAT_ID` | **407/407 passed** | 0 | 0 |
| dense | `./test-backend-ops -o MUL_MAT` | **925/925 passed** | 0 | 0 |
| roundtrip | `test-opencl-moe-roundtrip` | SKIPPED — no roundtrip executable in preserved device tool set | — | — |

The invocations match `results/barrier_verify_s23/run_one.sh` and its `MANIFEST.md`. Guard battery-temperature samples were 26.0–29.9 °C for MoE and 29.8–32.2 °C for dense; no WARN, KILL, sensor error, or guard stop occurred. Final battery snapshot after certification was 91%, unplugged, 29.1 °C.

## Stop rule

Copied from the prereg hygiene rule: stop on `CDSP0 CRASHED`, `dspqueue_* failed`, `INTERNAL-ERROR`, `ggml_abort`, `GGML_ASSERT`, `Aborted`, `Segmentation`, or `rc >= 128` not from the guard; also stop on guard kill, cpuset failure, battery/plug failure, ADB loss, or model hash mismatch. No listed stop token occurred.

## Evidence and budget

Raw stdout/stderr, guard logs, return codes, and cpuset records: `raw/cert/s23_day1_cert/`. Each case was capped at 600 s. No speed result is claimed. The preserved pinned set is functionally certified by these two passing suites.
