Harness deltas vs the baseline s23-layers-device-proof/raw (everything else reused verbatim):
- env.sh: new OUT/LAB/SHOTS paths; S = 192.168.1.152:35017 (today's endpoint).
- turn.sh battery floor 25 % (owner rule 2026-09-23; baseline used 20).
- turn.sh saves only grep-filtered dumpsys battery lines to raw/ (full dump kept in /tmp for the gates).
- turn.sh records `settings get global low_power` in state-pre (owner covariate rule).
- turn.sh runs the mandatory intra-turn thermal watchdog (poll 10 s, WARN 40.0, force-stop app at 43.0, log to <label>-watchdog.txt).
- turn.sh breaks the telemetry wait early if the app pid disappears (watchdog kill) instead of burning the 300 s.
- turn.sh captures the rendered answer text after telemetry (grep of text= attrs only; full XML stays in /tmp).
- sqlw.sh verify step points at this lab's sqlq.sh (baseline pointed at the older /tmp/s23-gov copy).
- extract.sh adds engine_prefill, prefill_kv, cache_type_k/v, attempt, failed, temp_pre, watchdog max temp columns.
