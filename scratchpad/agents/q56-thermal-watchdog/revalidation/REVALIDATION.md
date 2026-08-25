# q56 guard re-validation

Expected matrix from `REVIEW_GUARD.md`; results are appended immediately after each test.

| Test | Expected | Observed | Result |
|---|---|---|---|
| T1 kill path | guard 2, workload 137, `KILLED` | guard 2; workload 137; `KILL_THRESHOLD` + `KILLED`; MAX 272; JSONL absent | PASS |
| T2 pass-through | guard 0, workload 0, `MAX`, JSONL | guard 0; workload 0; `MAX`; JSONL 1,889 bytes / 2 rows; no WARN/KILL; MAX 274 | PASS |
| T3 sensor fail-closed | 3 sensor failures, `SENSOR_ERROR`, guard 3, workload 137 | 3 failures; `SENSOR_ERROR`; guard 3; workload 137; `KILLED`; max sensor temp 0 | PASS |
| T4 guard-not-ready | launcher 75, workload killed, guard absent/unstartable | launcher 75; guard log absent; guard rc absent; no residual llama/guard process after restore | PASS |

All four must pass before q53 lane-2 or q57 work.

## T1 — final attempt

- Tag: `reval_t1_135230_fix2`
- Pre-arm snapshot: 100%; 27.2 °C; unplugged; T1 WARN/KILL = 267 tenths = current − 5 tenths.
- Workload: LFM-B′ gguf, CPU-only `llama-bench -p 64 -n 16 -r 1 --no-warmup -t 8 -o jsonl -ngl 0`.
- Expected: guard exit 2, workload rc 137, `KILLED`.
- Observed: guard exit 2; workload rc 137; launcher exit 0; `READY`; `TRACKING_30737`; `WARN`; `KILL_THRESHOLD`; `KILLED`; max 272 tenths; no JSONL output.
- No crash signature; adb reconnect attempts 0.

The first T1 attempt (`reval_t1_134553`) exposed the immediate-kill readiness ordering issue and was not counted. The guard/launcher were fixed and re-pushed; the final attempt above passed.

## T2

- Tag: `reval_t2_135430`
- Pre-arm snapshot: 100%; 27.3 °C; unplugged.
- Expected: guard exit 0, workload rc 0, no threshold event, `MAX`, JSONL produced.
- Observed: guard exit 0; workload rc 0; launcher exit 0; samples 273→274 tenths; `MAX` present; no WARN/KILL; stdout JSONL 1,889 bytes / 2 rows; no crash signature; adb reconnect attempts 0.

## T3

- Final tag: `reval_t3_140100_fix2`; override `THERMAL_SENSOR_CMD=/data/local/tmp/nonexistent`; pre-arm 100%, 28.0 °C, unplugged.
- Expected: three consecutive sensor failures, `SENSOR_ERROR`, guard exit 3, workload rc 137, `KILLED`.
- Observed: exactly `SENSOR_FAILURE_1`, `_2`, `_3`, `SENSOR_ERROR`, `KILLED`; guard exit 3; workload rc 137; launcher exit 1; max sensor temp 0; no JSONL; no crash signature; adb reconnects 0.
- The first T3 attempt lacked workload rc because the launcher readiness deadline raced the third poll; the launcher deadline was extended by 5 seconds and the final attempt above passed.

## T4

- Final tag: `reval_t4_140650_fix1`; guard mode set to 000 before launch and restored to 755 immediately after.
- Expected: guard cannot start; launcher kills the gated workload and exits 75; no workload process remains.
- Observed: launcher exit 75; guard rc absent; guard log absent; stdout/stderr absent; no `llama` or `thermal_guard` process after restoration; pre-arm 100%, 27.6 °C, unplugged; adb reconnects 0.
- The first T4 attempt had a shell-wrapper guard rc=126 marker; the marker-write rule was tightened so an unstartable guard leaves it absent, matching the review artifact expectation. All four final matrix tests pass.
