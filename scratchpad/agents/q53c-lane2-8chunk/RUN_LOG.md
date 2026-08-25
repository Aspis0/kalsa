# q53 Lane 2 — session 3 RUN_LOG

File-first log. No lane-2 workload has started yet.

- Date: 2026-08-25
- Device: Galaxy S23 / Hexagon v73
- Serial endpoint: 192.168.1.152:43187 (mDNS service serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp)
- q53 preregistration locked at `7ec4c231`; read before measurement: yes
- Guard revalidation T1–T4: pending
- Start eligibility snapshot: 100%; 27.0 °C; unplugged
- Session label: session 3
- No model push; no charging-state change; no deletion.

## Lane 2 (session 3) — pre-arm

- Timestamp: 2026-08-25 13:58:00 UTC
- Battery: 100%; temperature 27.4 °C; AC=false; USB=false; Wireless=false; unplugged.
- Uptime: 39326.30 s.
- Device hash recheck: `llama-perplexity` `4aef69d7b032db4fea15d5fab86041328c2180b0086f74656c319d9331f7ba50` MATCH; corpus `173c87a53759e0201f33e0ccf978e510c2042d7f2cb78229d9a50d79b9e7dd08` MATCH; Qwen3.5-4B-Q4_0 `298fcb5fe7a77ccc79745ae24751560c5ac56874caff4bb39b1f2055bd72b8bb` MATCH.
- Guard: WARN 400 / KILL 430; session hard cap 0; interval 10 s; sensor failure limit 3.
- Workload not yet started at this log point.

## Lane 2 (session 3) — stopped

- Tag: `q53_lane2_session3_135800`; start 100%, 27.4 °C, unplugged.
- `PPL_CPU[1]=7.9064`; `PPL_CPU[8]=NaN`; `PPL_CPU_32=NaN`; r8/r32 not computable; gate not computed.
- Guard samples: max 387 tenths; guard exit 3 (`sensor fail-closed`); terminal trace includes `SENSOR_FAILURE_1`, `_2`, `_3`, `SENSOR_ERROR`, `KILL_FAILED`.
- Workload rc 137; launcher exit 4; adb reconnect attempts 2; battery end 96%, 37.9 °C, unplugged.
- No `dspqueue` or `INTERNAL-ERROR` signature. Session stop signature, verbatim: `0.00.670.758 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 0, abort`
- No q57 workload was started after this stop. No residual `llama` or `thermal_guard` process at final read-only check.
