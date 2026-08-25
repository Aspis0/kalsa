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

## Arms B/C — optional continuation

- Date: 2026-08-25.
- Device: Galaxy S23 / Hexagon v73; active endpoint `192.168.1.152:36269`; mDNS service `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.
- Guard PC SHA256: `f8b664194d7eae7d04ebb3bba8745769cbd79777796803d25eed7974e9bda84`; device SHA256: MATCH.
- Launcher SHA256: `64ef5fb808b7bd2784555b54db3c395aecd1d85021e568c948d1f07b7f783b40`.
- q56 revalidation: T1–T4 PASS; T5 normal-completion re-check PASS.
- Device remained unplugged for all arms: AC=false, USB=false, Wireless=false.
- Launcher environment: `GGML_HEXAGON_NDEV=1`, `GGML_HEXAGON_VERBOSE=1`; NPU arms `GGML_HEXAGON_HOSTBUF=1`; CPU arms HOSTBUF unset.
- Guard polling: 1 s launcher/guard interval, sensor timeout 10 s, sensor failure limit 4, WARN 400 tenths.
- Order: B1, C1, C2, B2 (allowed B-C-C-B order). All workload, guard, and launcher return codes were 0. No adb reconnects.
- Cool-start poll/gate: B1 2026-08-25T15:12:27Z, 29.7 °C, 84%; C1 2026-08-25T15:15:37Z, 29.8 °C, 84%; C2 2026-08-25T15:18:30Z, 31.2 °C, 83%; B2 2026-08-25T15:21:39Z, 31.6 °C, 82%. All passed ≤32.0 °C and ≥50%.
- Exact workload base: `llama-bench -m /data/local/tmp/kalsahtp/Qwen3.5-4B-Q4_0.gguf -p 512 -n 0 -r 2 --no-warmup -t 8 -fa on --load-mode none -o jsonl -v`; B adds `-ngl 99 -dev HTP0`, C adds `-ngl 0` and no `-dev`.

### Arm B — block 1

- Tag: `q57_armB_block1`; guard WARN/KILL 400/410; workload rc=0; guard rc=0; launcher rc=0; wall=46.527 s.
- Start: 84%, 29.6 °C, 4181 mV, charge counter 3172500 µAh, unplugged.
- End: 84%, 30.8 °C, 4169 mV, charge counter 3161250 µAh, unplugged.
- JSONL: 1 row; samples=2; prefill tokens=1024; `samples_ts=81.9936,94.5511`; `pp512_avg_ts=88.272380`.
- Guard MAX=30.6 °C; ΔT(start→post)=+1.2 °C; °C/512-token pass=0.6.
- Δcharge=11250 µAh; mean voltage=4175 mV; energy=169.0875 J; J/token=0.165124512.
- Execute-op proof: 1764 `HTP0 execute-op` lines; offloaded 33/33 layers; `execute_op_htp0=true`.
- Crash signature: NONE.

### Arm C — block 1

- Tag: `q57_armC_block1`; guard WARN/KILL 400/430; workload rc=0; guard rc=0; launcher rc=0; wall=60.526 s.
- Start: 84%, 29.8 °C, 4177 mV, charge counter 3161250 µAh, unplugged.
- End: 83%, 32.3 °C, 4150 mV, charge counter 3161250 µAh, unplugged.
- JSONL: 1 row; samples=2; prefill tokens=1024; `samples_ts=34.8171,30.7436`; `pp512_avg_ts=32.780367`.
- Guard MAX=32.5 °C; ΔT(start→post)=+2.5 °C; °C/512-token pass=1.25.
- Δcharge=0 µAh; mean voltage=4163.5 mV; energy=0 J recorded; J/token=0 recorded; counter unchanged caveat applies.
- Offloaded 0/33 layers; HTP0 execute-op count=0; `execute_op_htp0=false`.
- Crash signature: NONE.

### Arm C — block 2

- Tag: `q57_armC_block2`; guard WARN/KILL 400/430; workload rc=0; guard rc=0; launcher rc=0; wall=90.961 s.
- Start: 83%, 31.1 °C, 4162 mV, charge counter 3161250 µAh, unplugged.
- End: 83%, 33.1 °C, 4149 mV, charge counter 3161250 µAh, unplugged.
- JSONL: 1 row; samples=2; prefill tokens=1024; `samples_ts=26.9187,27.8937`; `pp512_avg_ts=27.406200`.
- Guard MAX=33.3 °C; ΔT(start→post)=+2.0 °C; °C/512-token pass=1.0.
- Δcharge=0 µAh; mean voltage=4155.5 mV; energy=0 J recorded; J/token=0 recorded; counter unchanged caveat applies.
- Offloaded 0/33 layers; HTP0 execute-op count=0; `execute_op_htp0=false`.
- Crash signature: NONE.

### Arm B — block 2

- Tag: `q57_armB_block2`; guard WARN/KILL 400/410; workload rc=0; guard rc=0; launcher rc=0; wall=55.452 s.
- Start: 82%, 31.5 °C, 4158 mV, charge counter 3161250 µAh, unplugged.
- End: 82%, 32.1 °C, 4147 mV, charge counter 3101250 µAh, unplugged.
- JSONL: 1 row; samples=2; prefill tokens=1024; `samples_ts=86.3959,94.7414`; `pp512_avg_ts=90.568617`.
- Guard MAX=32.1 °C; ΔT(start→post)=+0.6 °C; °C/512-token pass=0.3.
- Δcharge=60000 µAh; mean voltage=4152.5 mV; energy=896.94 J; J/token=0.875917969.
- Execute-op proof: 1764 `HTP0 execute-op` lines; offloaded 33/33 layers; `execute_op_htp0=true`.
- Crash signature: NONE.

- Energy caveat: `Charge counter` was read from `dumpsys battery` immediately before/after each arm. C1 and C2 were unchanged despite level/voltage/temperature movement; their zero-energy values are recorded counter deltas, not a claim of zero physical energy.
- Final residue check at 2026-08-25T15:23:04Z: no `llama-bench`, `llama-perplexity`, or `thermal_guard` process; battery 82%, 32.1 °C, unplugged.
