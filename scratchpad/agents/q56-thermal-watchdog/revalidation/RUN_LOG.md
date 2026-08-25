# q56 thermal watchdog revalidation RUN_LOG

Safety-critical session. This file is append-only during the revalidation.

- Date: 2026-08-25
- Device: Galaxy S23 / Hexagon v73
- Serial endpoint: 192.168.1.152:43187 (mDNS service serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp)
- Incident and q56 guard/launcher/review read before device actions: yes
- Current fixed guard and launcher are the only PC-side harness inputs.
- Device start snapshot: 100%; 27.0 °C; unplugged (AC=false, USB=false, Wireless=false)
- Device uptime snapshot: 38315.60 s
- `timeout`: `/system/bin/timeout`
- Preflight hashes: llama-bench MATCH; llama-perplexity MATCH; corpus MATCH; LFM-B-prime MATCH; Qwen3.5-4B-Q4_0 MATCH (Qwen path `/data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf`)
- Launcher compatibility fix: explicit `--allow-npu` gate added; failure signatures (`dspqueue`, `INTERNAL-ERROR`, `abort`) now stop a run.

No workload has started at this point.

## T1

- Initial attempt `reval_t1_134553`: guard exit 2 and first-sample `KILLED`, but readiness/tracking were absent and launcher returned 75. This exposed a sequencing defect.
- Fix applied PC-side: readiness/tracking are published only after a valid sample and before threshold processing; wrapper requires both; no device-file deletion; sensor override added.
- Re-pushed guard hash: `1e84bce0b90670737b9bed949ff7bb795c58c34e1795bdd5f3e1a3ab6c8c921f`.
- Final attempt `reval_t1_135230_fix2`: pre-arm 100%, 27.2 °C, unplugged; kill=267 tenths.
- Observed: guard=2, workload=137, launcher=0; `KILLED` present; MAX=272; JSONL absent; no crash signature; adb reconnects=0.

## T2

- Tag `reval_t2_135430`; pre-arm 100%, 27.3 °C, unplugged; WARN=400, KILL=430, session cap=380, effective kill=380.
- Observed: guard=0, workload=0, launcher=0; MAX present; no WARN/KILL; JSONL 2 rows / 1,889 bytes; MAX=274 tenths; no crash signature; adb reconnects=0.

## T3

- Attempt `reval_t3_135620`: guard=3 and sensor log complete, but launcher timeout killed the supervisor before rc publication; workload rc was null.
- Fix applied PC-side: readiness wait extended from `max(2 intervals, 10 s)` to `max(2 intervals + 5 s, 10 s)`; fail-closed guard rc=3 is allowed to publish its killed-wrapper rc.
- Final attempt `reval_t3_140100_fix2`: override `/data/local/tmp/nonexistent`; pre-arm 100%, 28.0 °C, unplugged.
- Observed: guard=3, workload=137, launcher=1; `SENSOR_FAILURE_1/2/3`, `SENSOR_ERROR`, `KILLED`; max sensor temp=0; no JSONL; no crash signature; adb reconnects=0.

## T4

- Attempt `reval_t4_140330`: launcher=75 and no residual processes after restore; shell-wrapper guard rc was 126.
- Fix applied PC-side: guard rc marker is not written for unstartable rc=126.
- Final attempt `reval_t4_140650_fix1`: mode 000 during launch, restored 755 immediately after; launcher=75; guard rc/log absent; no stdout/stderr; no residual `llama` or `thermal_guard`; pre-arm 100%, 27.6 °C, unplugged; adb reconnects=0.
- Final T1–T4 matrix status: PASS.

## Current parser/kill fix before T5

- Current-block parser fixed to select only `^  temperature: *[0-9]+` and `^  level: *[0-9]+`; dumpsys history lines and sysfs fallback are not used.
- Missing level is informational (`-1`); only missing/non-numeric/zero temperature increments sensor failures.
- Current defaults: `sensor_timeout_s=10`, `sensor_fail_limit=4`, `sensor_failure_window_s=40`.
- `kill -9` verification now polls up to 5 seconds at 0.5-second intervals and treats a zombie target as gone.
- Launcher crash matching excludes the benign `common_fit_params ... n_gpu_layers ... abort` warning and matches only the authorized real signatures.
- T5 attempt `reval_t5_20260825_1018`: launcher false-positive on normal `ggml-hex: Loading driver libcdsprpc.so`; workload was guard-killed rc=137, guard rc=0. Not a device crash.
- T5 attempt `reval_t5_20260825_1020_fix1`: launcher false-positive on normal lower-case `_dom=cdsp` URI text; workload was guard-killed rc=137, guard rc=0. Not a device crash.
- Fix: CDSP matching is now case-sensitive for explicit upper-case `CDSP`; normal lower-case `cdsp` startup URI/domain is accepted. Exec PID proof is recorded by the supervisor as the child PID (not POSIX `$$` from a subshell).
- T5 final `reval_t5_20260825_1022_fix2`: guard rc=0, workload rc=0, launcher rc=0; START reports timeout=10/fail-limit=4/window=40; every sample had numeric temperature and level=95; no SENSOR_FAILURE; MAX=298 tenths; JSONL=1,889 bytes / 2 rows; WORKLOAD_PID=24837; no residual llama/guard process.
