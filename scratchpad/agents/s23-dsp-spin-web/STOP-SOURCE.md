# S23 DSP spin - stop at the source (final, written by the coordinator 2026-09-26)

Agent 263437c8 was archived before writing this file; its last activity reported 15/15 clean polls over
~2.5 h. Coordinator check on 2026-09-26 ~00:45 local (adb, read-only):
- `getprop persist.traced.enable` = 0; `traced` / `traced_probes` not running.
- uptime 29,898 s (8.3 h, well past the old failure point at ~4,046 s).
- adsprpcd (pid 2222) and cdsprpcd (pid 2225): utime 0, stime 0 ticks since boot.

Verdict: the fix holds. `setprop persist.traced.enable 0` stops Perfetto, so Samsung perfmond never sends
the profiling signal that spun the DSP RPC daemons. It survives reboot.
Revert (restores the profiler): `adb shell setprop persist.traced.enable 1` and
`adb shell cmd device_config set_sync_disabled_for_tests none` (the agent also disabled device_config sync).
