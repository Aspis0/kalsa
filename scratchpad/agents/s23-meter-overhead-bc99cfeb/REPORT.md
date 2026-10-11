# S23 Meter sampler overhead, APK bc99cfeb - 2026-10-11

**Measured: the Meter's sampler costs ~1.1-1.36 ms of CPU per second in its own thread, and the health HAL it queries
runs at 1.23 ms/s while the sampler lives against 0.25-0.28 ms/s without it (all HAL threads). Conditional bound:
adding a system_server share assumed no larger than the HAL's, and pricing every millisecond at an assumed 4 W per
core, the sampler stays under ~15 mW, i.e. 0.24-0.44 % of the 3.5-6.5 W a turn draws - under the pre-registered 1 %
bar (`governor-meter-recon/REPORT.md`). The two assumptions and the uncounted items below are what the bound rests on.**

Corrected after a hostile audit the same evening: the first version read `/proc/<hal>/schedstat`, which is the HAL's
main thread only, and claimed the HAL does no work without the sampler. The HAL has two threads; the rerun below sums
both, and the HAL does run (at ~0.25 ms/s) without the sampler.

## Why not the discharge A/B

The pre-registered design was "same workload, trace on vs trace off, compare mean discharge". On the S23 it cannot
see 1 %: the charge counter moves in 3.75 mAh quanta and pins at full charge, the trace-off arm has no per-turn current
at all, and two identical ON runs already differed by 28 % over six turns (1311 vs 1681 mWh, cell
`s23-meter-gov-onoff-bc99cfeb`). The sampler's cost is instead measured at its source.

## Method

- The sampler is a `HandlerThread` named `GovernorBatterySampler` (`native/GovernorBatteryModule.kt`, app
  `bc99cfeb`), started for each turn (`src/engine/LlamaService.ts:4990`) and stopped after it (`:5935`). Each 1 s
  sample reads `BatteryManager.getIntProperty` (binder to the health HAL), the sticky `ACTION_BATTERY_CHANGED`
  intent for the voltage (binder to system_server), and writes and flushes one CSV row.
- Sampler thread: `raw/ovh-probe.sh`, on the device as the app uid, every 2 s, `/proc/<app>/task/<tid>/schedstat`
  of that thread (its on-CPU ns, own kernel time included; work it causes in other processes is not in it).
  `raw/ovh-thread.txt`.
- Health HAL (`vendor.samsung.hardware.health-service`, pid 1824, two threads): rerun with `raw/hal-probe.sh`, shell
  uid, every 2 s, the sum of `/proc/1824/task/*/schedstat` over both threads plus whether a sampler thread is alive.
  `raw/hal-all.txt`. (The first runs' `raw/hal-trace-on.txt` and `raw/hal-gap.txt` read the main thread only.)
- Workload: governor-ON turns of the G2 script (`run-t20c.sh`): three turns for the thread probe
  (`campaigns/meter-ovh.json`; stop flag after 2, the runner finished turn 3 first), one more turn for the all-thread
  HAL probe (`campaigns/meter-ovh2.json`). Device-side heat guard `raw/guard.sh` (skin >= 44 C or level < 30 % ->
  force-stop); it never fired. Skin max 41.1 C, status 2 at most.

## Results

| Source | CPU time | Rate |
|---|---|---|
| Sampler thread, turn 1 (tid 30022) | 413.7 ms over ~384 s | 1083 us/s |
| Sampler thread, turn 2 (tid 14353) | 312.5 ms over ~282 s | 1116 us/s |
| Sampler thread, turn 3 (tid 25296) | 546.3 ms over ~405 s | 1356 us/s |
| Health HAL, both threads, sampler alive (rerun turn, 345 s) | 424.2 ms | 1230 us/s |
| Health HAL, both threads, no sampler (296 s before the turn, app launch and harness steps included) | 73.9 ms | 250 us/s |
| Health HAL, both threads, no sampler (30 s after the turn) | 8.5 ms | 283 us/s |
| system_server, sticky intent | not separable (always busy) | **assumed** <= the HAL's |

So the sampler adds ~0.95-1.0 ms/s in the HAL; the bound below charges it the full 1.23 ms/s.

Turn energy (current x voltage via `raw/energy_iv.py`): 531, 297, 392 mWh at 4.96, 3.82, 3.46 W for the three probed
turns (`raw/ovh-t1..t3.csv`; charge counter 543, 300, 393 mWh); the rerun turn 455 mWh at 4.76 W (`raw/ovh2-t1.csv`).

## Bound

Thread <= 1.36 ms/s + HAL <= 1.23 ms/s + system_server **assumed** <= 1.23 ms/s: <= ~3.8 ms of CPU per second. Priced
at an **assumed** 4 W per core (prime core at top clock; not measured here): <= ~15 mW, i.e. 0.24 % of a 6.5 W cold
turn and 0.44 % of a 3.5 W paced turn.

## Not covered

- Not counted: the fuel-gauge read below the HAL (I2C), the flash write per row, and any wakeup cost. During a turn
  the CPUs are busy anyway, so a separate wakeup cost is unlikely, but none of the three is measured.
- The system_server share is assumed, not measured; the bound holds only under that assumption and the 4 W price.
- S23 only. The Jelly's per-turn draw (1,045 mA median) was the bar's original reference; the Jelly is out of scope
  (owner, 2026-10-11).
