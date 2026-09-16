# S23 energy measurement — platform blocker and the path around it (2026-09-16)

Recorded from the cold S23 run of the stamped per-phase protocol
(`device-s23-out/run1/`, 02:12:00–02:21:21 UTC). The run itself produced **no
energy numbers**, and the reason is a platform constraint, not a harness bug.

## The blocker

`scripts/energy-sample.sh` reads power from sysfs. On the S23 that is denied to
the adb shell user, independently verified:

```
adb -s 192.168.1.152:43089 shell cat /sys/class/power_supply/battery/current_now
cat: /sys/class/power_supply/battery/current_now: Permission denied
```

The same for `voltage_now`, `temp`, `status` and `capacity` (stock Samsung
kernel, SELinux, adbd as `uid=2000(shell)`). The sampler's fallback is
`2>/dev/null || ""`, so it failed silently: all 603 sampler rows across the four
stems carry empty power, temperature and status columns. Only `t_s` and
`cpu_freqs_kHz` are populated. The alternative node `max77705-fuelgauge` exposes
no `current_now` either.

`dumpsys battery` is not a substitute for instantaneous current: it reports
`level`, `voltage` and the powered flags.

## Why this matters to the plan

The Jelly Star allows this read; the S23 does not. So the per-phase **energy**
protocol cannot be replicated on the S23 with the current sampler, and any plan
that assumes "same protocol, two devices" for joules is wrong as written.

## The data does exist — through the framework, not sysfs

The `dumpsys battery` history records every `ACTION_BATTERY_CHANGED` broadcast
with fields the sysfs path never showed us. From this run's window:

```
02:12:30  level:57  voltage:3740  temperature:297  current_avg:-1503  cc:2163750
02:13:00  level:56  voltage:3688  temperature:323  current_avg:-1990  cc:2152500
02:16:01  level:54  voltage:3760  temperature:364  current_avg:-1337  cc:2062500
02:20:02  level:52  voltage:3787  temperature:368  current_avg:-839   cc:1987500
```

Three things follow.

1. `current_avg` in mA and a cumulative charge counter `cc` in µAh are available
   on this device through the Android framework. During the run `cc` fell from
   2,377,500 to 1,965,000 µAh, i.e. **412,500 µAh consumed**, which at the
   observed ~3.8 V is roughly 1.56 Wh or 5.6 kJ over the session.
2. The battery temperature rose from about 28.0 to 36.8 °C. The throughput drift
   this run showed (2.6B/REP 6.0/5.9/5.4 t/s, 1.2B/PURE 8.8/9.9/9.9) is therefore
   not unexplained: the device was heating through the run.
3. The broadcast cadence is 30–90 s under load, far too coarse for per-phase
   attribution. Reading `BatteryManager.getIntProperty(BATTERY_PROPERTY_CURRENT_NOW)`
   from an app is the high-rate path, and the project already ships a native
   battery module (`native/GovernorBatteryModule.kt`). That is a different
   harness from the CLI one: it means driving the app, which is the same
   infrastructure the app-side benches use.

## Consequences recorded

- The S23's role in the energy framework is now: **timing, thermal and clock
  evidence only**, until an app-side or framework-side sampler exists.
- The cold-run stability check failed on this device anyway (3 of 4 stems drifted
  more than 5 %), so even a thermally matched protocol needs a warm-up or a
  temperature gate on the S23 before any cross-device comparison.
- The absolute-level caveat still stands: the Jelly's own sessions differ by
  orders of magnitude in idle floor, so only ratios and within-session deltas are
  comparable across devices in any case.
