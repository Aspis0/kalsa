# S23 perfmond property trial

## Objective

After the owner's reboot, set `debug.perfmond.default.perfetto=0` and observe the profiling daemon for up to four hours. The Xiaomi and Jelly are out of scope; only the rediscovered Galaxy S23 is targeted. The Jelly may appear in device listings, but it receives no commands.

## Procedure and evidence

Initial post-reboot properties, daemon CPU, and uptime; the `setprop` exit code and read-back; then ten-minute Mac-side polls of uptime, daemon `top` CPU and `/proc/<pid>/stat` ticks, `traced_perf`, `perfetto --query`, property value, and matching logcat lines are recorded under `raw/`. Polling ends after four hours or the first daemon spin at 5% of one core or above. The poll script is archived at `raw/watch_perfmond.py` before first use. No app is launched and no inference is run.

## Heat arms stopped by owner

No valid timed CPU/GPU heat arm completed: **n=0**. The requested eight 1024-token arms and the optional 512-token block were not started; see the appended owner-stop table and evidence in `../s23-heat-cpu-vs-gpu-v2/REPORT.md`. No heat conclusion is available.

## Post-reboot property trial

At 2026-09-25 12:36:52 UTC, mDNS rediscovered the Galaxy S23 as `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` at `192.168.1.152:37563`. The Jelly appeared in `adb devices -l` only and received no command. Initial device uptime was 169.91 s; `debug.perfmond.default.perfetto=1`, `init.svc.perfmond=running`. `top` did not list either daemon as an active process; their `/proc/<pid>/stat` records had `utime=0` ticks (`adsprpcd` PID 2246, `cdsprpcd` PID 2248). The first preflight is `raw/post-reboot-preflight.txt`.

`setprop debug.perfmond.default.perfetto 0` returned exit code 0, and read-back was `0` (`raw/setprop-result.txt`). At 12:38:15 UTC the property still read 0, perfmond remained running, uptime was 253.30 s, and both daemon utime values remained 0; `top -m 100` still omitted both daemons (`raw/post-setprop-state.txt`). The watcher polled every ten minutes from its first usable snapshot at 12:51:28 UTC. It stopped at the first DSP spin, per the requested stop condition, at 13:41:28 UTC (poll 6), 63 minutes 13 seconds after the property was set. The four-hour maximum was not reached because the spin appeared first.

The first watcher attempt failed while decoding binary logcat output and saved no poll; the binary-safe replacement is archived as `raw/watch_perfmond.py`. Its immediate first poll is the first usable sample, and no finding is inferred from the failed attempt.

At polls 1–5, the property read back `0`, `perfmond` remained `running`, both DSP daemons showed 0.0% CPU in `top`, and their `/proc` utime values remained 0 ticks. `traced_perf` PID 9849 was present and `perfetto --query` reported one tracing session at each poll. The logcat snapshot at every poll included `received profiling signal` entries.

At poll 6 (host timestamp 2026-09-25T13:41:28.474835Z; device uptime 4046.44 s), the property still read `0` and `perfmond` was `running`. `adsprpcd` PID 2246 rose to 26.6% CPU and `cdsprpcd` PID 2248 to 30.0%; `/proc/<pid>/stat` utime rose from 0 to 32,670 and 31,746 ticks, respectively. `traced_perf` PID 9849 remained present; `perfetto --query` reported one session. The same poll's logcat contained `received profiling signal` entries through device time 09:41:30.963, including `perfsdkserver`, `trusteduilistener`, and `logcat`. **The spin therefore appeared while the property was 0, and profiling signals still arrived.** Full snapshots and matching signal lines are in `raw/monitor/polls.txt`; the corrected Mac-side poller is `raw/watch_perfmond.py`.
