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

## Lane 2 (session 3 resume) — live monitor

- First live poll after arm: battery 93%; current temperature 34.1 °C; unplugged; `llama-perplexity` active; no authorized crash signature; no PPL chunk line yet.
- Second live poll: battery 93%; current temperature 35.6 °C; `PPL_CPU[1]=7.9064`; workload active; no authorized crash signature.
- Third live poll: battery 92%; current temperature 35.3 °C; guard tail shows numeric temperatures and levels with no `SENSOR_FAILURE`, `WARN`, or kill event; workload active (temporarily observed in kernel `D` state while reading/processing); no authorized crash signature.
- Fourth live poll: battery 91%; current temperature 37.5 °C; guard healthy with numeric level/temperature samples and no kill event; `PPL_CPU[1]=7.9064` remains latest; workload active; no authorized crash signature.
- Fifth live poll: battery 90%; current temperature 39.6 °C; workload active; guard has not yet emitted WARN/KILL; `PPL_CPU[1]=7.9064` remains latest; no authorized crash signature.
- Sixth live poll: battery 90%; current temperature 40.9 °C; guard emitted expected WARN at 404 tenths under WARN 400; no kill; workload active; no authorized crash signature.
- Seventh live poll: battery 89%; current temperature 42.2 °C; guard still below KILL 430; workload active; latest PPL remains chunk 1; no authorized crash signature.

## Lane 2 (session 3 resume) — stopped by thermal guard

- Raw tag: `q53_lane2_session3_resume_1025`; guard trace ended at 434 tenths / 43.4 °C with `KILL_THRESHOLD` then `KILLED`; workload rc=137.
- Completed chunks: 2 (`PPL_CPU[1]=7.9064`, `PPL_CPU[2]=9.4097`); chunk 8 and 32 were not reached, so r8/r32 and the gate are `NaN` / `NOT_COMPUTABLE`.
- Battery end: 88%; 43.4 °C; AC=false; USB=false; Wireless=false.
- No real crash signature. The only matching text was the allowed benign `common_fit_params ... abort` warning and normal lower-case `cdsp` URI text.
- No llama or thermal-guard process remained after the guard kill.
- Launcher reporting race diagnosed: guard rc=2 was observed as guard disappearance and labeled launcher exit 75; the launcher is now fixed to preserve guard exit 2 as a thermal kill for subsequent arms.

## Lane 2 (session 3) — stopped

- Tag: `q53_lane2_session3_135800`; start 100%, 27.4 °C, unplugged.
- `PPL_CPU[1]=7.9064`; `PPL_CPU[8]=NaN`; `PPL_CPU_32=NaN`; r8/r32 not computable; gate not computed.
- Guard samples: max 387 tenths; guard exit 3 (`sensor fail-closed`); terminal trace includes `SENSOR_FAILURE_1`, `_2`, `_3`, `SENSOR_ERROR`, `KILL_FAILED`.
- Workload rc 137; launcher exit 4; adb reconnect attempts 2; battery end 96%, 37.9 °C, unplugged.
- No `dspqueue` or `INTERNAL-ERROR` signature. Session stop signature, verbatim: `0.00.670.758 W common_fit_params: failed to fit params to free device memory: n_gpu_layers already set by user to 0, abort`
- No q57 workload was started after this stop. No residual `llama` or `thermal_guard` process at final read-only check.

## Lane 2 (session 3 resume) — pre-arm

- Resume reason: prior stop was a false positive on the benign `common_fit_params ... abort` warning and the old guard parser counted valid temperatures as sensor failures.
- Timestamp: 2026-08-25 10:25:08 EDT.
- Cool-start poll: battery 94%; current temperature 29.7 °C; AC=false; USB=false; Wireless=false; unplugged.
- Guard after fix: WARN 400 / KILL 430; interval 10 s; sensor failure limit 4; sensor read timeout 10 s; fail-closed window 40 s.
- T5 parser re-check passed immediately before this arm: guard/workload/launcher rc 0; no sensor failures; no residual process.
- Device hashes remain pinned and matched at the current endpoint `192.168.1.152:36269`.
- Workload not yet started at this log point.
