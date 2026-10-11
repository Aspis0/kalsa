# S23 Meter sampler overhead, APK bc99cfeb - 2026-10-11

**The Meter's sampler costs about 2.1-2.5 ms of CPU per second of trace, measured: ~1.1-1.36 ms in its own thread
plus ~1.0-1.1 ms in the health HAL it queries. Even with the unmeasured system_server share taken as large as the
HAL's and every millisecond priced at a prime core's top power, that is at most ~14 mW: 0.2-0.4 % of the 3.5-6.5 W a
turn draws. Under the pre-registered 1 % bar (`governor-meter-recon/REPORT.md`), with margin.**

## Why not the discharge A/B

The pre-registered design was "same workload, trace on vs trace off, compare mean discharge". On the S23 it cannot
see 1 %: the charge counter moves in 3.75 mAh steps and pins at full charge, the trace-off arm has no per-turn
current at all, and two identical ON runs already differed by 28 % over six turns (1311 vs 1682 mWh, cell
`s23-meter-gov-onoff-bc99cfeb`). The sampler's cost is instead measured at its source.

## Method

- The sampler is a `HandlerThread` named `GovernorBatterySampler` (`native/GovernorBatteryModule.kt`, app
  `bc99cfeb`), started for each turn (`src/engine/LlamaService.ts:4990`) and stopped after it (`:5935`). Each 1 s
  sample reads `BatteryManager.getIntProperty` (binder to the health HAL), the sticky `ACTION_BATTERY_CHANGED`
  intent for the voltage (binder to system_server), and writes and flushes one CSV row.
- `raw/ovh-probe.sh`, on the device as the app uid, every 2 s: `/proc/<app>/task/<tid>/schedstat` of that thread
  (ns on CPU, kernel time included). `raw/ovh-thread.txt`.
- The health HAL (`vendor.samsung.hardware.health-service`, pid 1824): `/proc/1824/schedstat` every ~11 s, with and
  without a live sampler thread. `raw/hal-trace-on.txt`, `raw/hal-gap.txt`.
- Workload: three governor-ON turns of the G2 script (`run-t20c.sh`, `campaigns/meter-ovh.json`, stop flag after 2;
  the runner finished turn 3 first). Device-side heat guard `raw/guard.sh` (skin >= 44 C or level < 30 % ->
  force-stop); it never fired. Skin max 41.1 C, status 2 at most.

## Results

| Source | CPU time | Rate |
|---|---|---|
| Sampler thread, turn 1 (tid 30022) | 413.7 ms over ~384 s | 1083 us/s |
| Sampler thread, turn 2 (tid 14353) | 312.5 ms over ~282 s | 1116 us/s |
| Sampler thread, turn 3 (tid 25296) | 546.3 ms over ~405 s | 1356 us/s |
| Health HAL, sampler alive (turn 1, 56 s) | 63.0 ms | 1125 us/s |
| Health HAL, sampler alive (turn 2, 34 s) | 33.7 ms | 990 us/s |
| Health HAL, no sampler thread (23 s between turns) | **0 ns** | 0 |
| system_server, sticky intent | not separable (always busy) | assumed <= the HAL's |

The HAL does no work at all while no sampler thread lives, so its whole load during a turn is the Meter's.

Turn energy, same three turns (`raw/ovh-t1..t3.csv`, current x voltage via `raw/energy_iv.py`): 531, 297, 392 mWh at
4.96, 3.82, 3.46 W (charge counter: 543, 300, 393 mWh).

## Bound

Measured ~2.1-2.5 ms/s, plus system_server at most as much as the HAL (~1.1 ms/s): <= ~3.6 ms of CPU per second.
Priced at an assumed 4 W per core (prime core at top clock; an assumption, not measured here) that is <= ~14 mW, i.e.
0.2 % of a 6.5 W cold turn and 0.4 % of a 3.5 W paced turn. A 1 Hz loop on short wakeups more likely lands on the
little cores, which would put it near 0.02 %. During a turn the CPUs are awake anyway, so the sampler adds no wakeup
cost of its own.

## Not covered

- The fuel-gauge read below the HAL (I2C) and the flash write per row are not CPU time and are not counted; both are
  small next to a turn but unmeasured.
- S23 only. The Jelly's per-turn draw (1,045 mA median) was the bar's original reference; the Jelly is out of scope
  (owner, 2026-10-11).
