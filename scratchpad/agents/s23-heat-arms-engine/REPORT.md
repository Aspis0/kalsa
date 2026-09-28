# S23 engine heat and energy arms

## Outcome: blocked before the first arm

The S23 preflight passed the device safety gates: it was Awake, unplugged,
tracing was `0`, battery was 75%, battery temperature was 31.2 °C, and Android
thermal status was 0. The ship model hash matched
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
`dumpsys thermalservice` exposed a HAL SKIN reading (31.6 °C). The prompt,
engine binaries, and all arms were not run.

The preregistered energy metric requires `current_now` and `voltage_now` from
`/sys/class/power_supply/battery`. Both reads and even `uevent` returned
`Permission denied` as `uid=2000(shell)`; `su` is unavailable. The combined
sysfs preflight command exited 1. `dumpsys batteryproperties` showed
`current now: -178`, but that is not the requested sysfs sample and does not
provide a validated replacement pair with the required units. I stopped before
the idle baseline rather than estimate net mWh from incompatible telemetry.

The app process existed at preflight (`pidof com.kalsa.app` returned `5982`);
no binary run was started, so it was not force-stopped. The phone remained
unplugged. `svc power stayon true` was set; the screen was left Awake. No app
preferences, tracing state, or Jelly device were changed.

| Required measurement | Result |
|---|---|
| P-CPU / P-GPU / P-NPU (3 reps each) | Not run; energy source inaccessible |
| D-threads 5/3/2 (2 reps each) | Not run; energy source inaccessible |
| Idle power baseline | Not run |
| OpenCL QUALCOMM proof / HTP MUL_MAT proof | Not run |
| Per-arm energy, heat, timing, verdict | Not measured |

Raw preflight output is in `raw/preflight.log`. The signed-off plan and exact
arm order are in `PREREG.md`. Resuming requires a shell-readable current and
voltage source with validated units, or a revised energy protocol.
