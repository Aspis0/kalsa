# q57 v73 NPU thermal trace RUN_LOG

File-first log. Initial pre-resume entry recorded no q57 workload; the resumed Arm A result is appended below.

- Date: 2026-08-25
- Device: Galaxy S23 / Hexagon v73
- Serial endpoint: 192.168.1.152:43187 (mDNS service serial: adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp)
- q57 preregistration locked at `a4999d53`; read before measurement: yes
- q56 four-test revalidation: PASS (T1–T4)
- Start eligibility snapshot: 100%; 27.0 °C; unplugged
- No model push; no charging-state change; no deletion.

## Final status

- q57 Arm A/B/C: NOT RUN.
- Reason: hard stop after q53 lane-2 session-3 workload abort signature; no retry or NPU arm permitted.
- Final read-only device check: 96% battery; 36.3 °C at check; unplugged; no residual llama/guard process.

## Resume after false-stop correction — cooldown before Arm A

- q53 lane-2 resumed under the corrected guard but was stopped by the real CPU thermal guard at 43.4 °C before chunk 8; no workload crash signature.
- q57 Arm A remains gated until current battery temperature is at or below 32.0 °C and battery is at least 45%; device remains unplugged.
- Cooldown poll 1: 2026-08-25T10:39:09-04:00; battery 88%; current temperature 37.8 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 2: 2026-08-25T10:39:59-04:00; battery 87%; current temperature 36.7 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 3: 2026-08-25T10:41:02-04:00; battery 87%; current temperature 35.8 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 4: 2026-08-25T10:42:03-04:00; battery 87%; current temperature 35.0 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 5: 2026-08-25T10:43:04-04:00; battery 87%; current temperature 34.3 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 6: 2026-08-25T10:44:07-04:00; battery 87%; current temperature 33.7 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 7: 2026-08-25T10:45:08-04:00; battery 87%; current temperature 33.2 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 8: 2026-08-25T10:46:09-04:00; battery 87%; current temperature 32.7 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 9: 2026-08-25T10:47:11-04:00; battery 87%; current temperature 32.3 °C; AC=false; USB=false; Wireless=false.
- Cooldown poll 10: 2026-08-25T10:48:12-04:00; battery 87%; current temperature 31.9 °C; AC=false; USB=false; Wireless=false; Arm A gate satisfied.

## Arm A live monitor

- Tag: `q57_armA_resume_1048`; guard START: WARN 400 / KILL 410; sensor timeout 10 s; failure limit 4; fail-closed window 40 s.
- First live poll: battery 87%; current temperature 33.6 °C; unplugged; guard READY/TRACKING present; HTP workload active; no PPL line yet; no authorized crash signature.
- Second live poll: battery 86%; current temperature 38.8 °C; `PPL_HTP[1]=7.9075`; HTP0 execute-op lines observed in the live trace; no authorized crash signature; guard below KILL 410.

## Arm A — stopped by guard kill

- Tag: `q57_armA_resume_1048`; cool start 31.8 °C / 87% / unplugged.
- Guard trace: WARN at 405 tenths; KILL_THRESHOLD at 414 tenths; KILLED; guard rc=2; workload rc=137; launcher rc=2; no sensor failures; adb reconnects=0.
- PPL: `[1]7.9075,[2]9.4123`; chunk 8 was not reached, so `PPL_HTP[8]=NaN`.
- Delta versus CPU reference 7.4314%: `NaN` because `PPL_HTP[8]` is unavailable.
- MAX temperature: 414 tenths = 41.4 °C.
- First sample epoch 1787669313 at 318 tenths; first sample at or above 40.0 °C epoch 1787669538 at 405 tenths: time-to-40 = 225 s = 3.75 min.
- Arm ended at 247 s (4.12 min), before a full five-minute window. First-to-last available pre-kill slope = (41.4−31.8)/4.12 = 2.33 °C/min; five-minute slope is not available.
- Execute-op proof count: 5,995 lines containing `HTP0 execute-op`; `execute_op_htp0=true`.
- No real crash signature. Normal lower-case `cdsp` URI/domain and `libcdsprpc.so` startup text were not treated as crashes.
- Hard stop applied after an NPU guard kill: Arms B and C were not run; no retry.
