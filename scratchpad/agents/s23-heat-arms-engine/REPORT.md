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

## Follow-up — current proxy and complete thermal arms

### Current proxy decision

The corrected pre-registration is in `PREREG.md`. Sysfs remained inaccessible
to Android `shell`, so I tested the Battery Service current property instead.
`dumpsys batteryproperties` was empty on this firmware; `cmd battery get
current_now` and `dumpsys battery`'s live `current now` field were available.

The 30-second idle and 30-second CPU `llama-bench tg256` capture recorded raw
current `-302` at idle and `-3096` after compute began
(`raw/validation-device-out/current-validation.tsv`). The bench did not finish
within 225 seconds and was stopped with `rc=143` after the registered load
sample was collected (`raw/validation-device-out/validation.markers:2`,
`raw/validation-device-out/load-runs.log`). To check edge latency directly, an
additional CPU-load pulse sampled `cmd battery get current_now` each second:
it held at `-106` through 10 load samples, changed to `-1080` on sample 11, and
still had not returned to idle after eight recovery samples
(`raw/current-pulse.tsv:10-32`). This fails the pre-registered 1–2 sample
response criterion. **Energy is dropped for this session**: no idle baseline,
net mWh, or mWh/token figure is claimed. Thermal results below are primary.

### Arms, dispatch, and gates

All nine prefill and six decode arms completed with exit 0. Every arm's
before/after power check said `Awake`; the session sampler logged `Awake` on all
1,127 samples. Thermal status was 0 on every sample and battery temperature
peaked at 34.7 °C. Each measured arm began at battery temperature ≤33.0 °C and
status 0. The phone stayed unplugged, tracing stayed 0, and Kalsa was
force-stopped during each binary run. Final state: Awake, stay-on still enabled,
67% battery, 33.5 °C battery, thermal status 0. No app preferences were touched.

- **GPU proof:** each P-GPU log has the OpenCL model buffer and a QUALCOMM
  OpenCL platform/driver line; for example `P-gpu-1.log:132-152`.
- **NPU proof:** the separate verbose run exited 0 and had 484
  `HTP0 execute-op MUL_MAT` lines, with the v73 skel; sample op line
  `npu-proof.log:13849`. Each measured P-NPU log has a 1,525.87 MiB HTP0 model
  buffer (`P-npu-1.log:133-134`).
- **CPU arms:** CPU model buffer only for P-CPU; D arms used `-dev none -ngl 0`
  and produced a `tg256` row.

The thermal window for each arm is arm launch through process exit plus 60 s.
Area is trapezoid-integrated temperature above the arm-start value, using real
sample timestamps. The sampler cadence had median 1 s and maximum 2 s; skin was
available in all samples. `raw/results.tsv` gives every repetition; its medians
are summarized here. Prefill area is also normalized to the 962 prompt tokens.

| Prefill | Median prompt eval | Median speed | Battery Δ °C | Battery area °C·s (per 1k tokens) | Skin peak °C | Skin Δ °C | Skin area °C·s (per 1k tokens) | Peak status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P-CPU | 9,905.57 ms | 97.12 tok/s | 1.20 | 42.90 (44.59) | 33.50 | 1.10 | 53.15 (55.25) | 0 |
| P-GPU | 6,948.76 ms | 138.44 tok/s | 0.70 | 23.25 (24.17) | 33.70 | 0.80 | 29.30 (30.46) | 0 |
| P-NPU | 1,470.99 ms | 653.98 tok/s | 0.20 | 6.20 (6.45) | 33.40 | 0.40 | 9.95 (10.34) | 0 |

**Thermal verdict:** HTP is coolest: its median battery area per 1k tokens is
73.3% below OpenCL and 85.5% below CPU. OpenCL is 45.8% below CPU. Skin area
also favors HTP: 66.0% below OpenCL and 81.3% below CPU. Energy cannot be
ranked because the available current signal is too delayed.

| Decode | Median run time | Median `tg256` speed | Battery Δ °C | Battery area °C·s | Skin peak °C | Skin Δ °C | Skin area °C·s | Peak status |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| D-t5 | 13.0 s | 22.41 tok/s | 1.45 | 67.33 | 34.80 | 1.60 | 73.10 | 0 |
| D-t3 | 15.0 s | 18.49 tok/s | 1.30 | 65.28 | 34.60 | 1.55 | 76.00 | 0 |
| D-t2 | 18.5 s | 15.16 tok/s | 1.40 | 66.48 | 34.80 | 1.60 | 79.75 | 0 |

Fewer threads did not show a clear thermal benefit: the battery-area medians
overlap and differ by only 1–3%; skin area rises as threads fall. Energy per
token is **not measured**, so no energy-saving claim is supported.

### Failures and non-fatal warnings

- Initial sysfs reads were denied (`raw/preflight.log:39-43`); this is why the
  current proxy was tested. The proxy failed the latency criterion described
  above, so energy was omitted.
- The first sampler launch hit `/system/bin/printf: Argument list too long`
  when it stored the full `dumpsys power` output, then falsely recorded
  `wake=NA` and stopped before any arm (`raw/driver-first-failure.txt`).
  Parsing was changed to stream the wakefulness line; the next postflight
  confirmed Awake.
- A first P-CPU attempt exited 1 before token evaluation because the test
  driver pointed at the wrong prompt path (`raw/attempt-path-fix/P-cpu-1.log:5`).
  The path was corrected; the full 15-arm sequence then passed.
- HTP startup logged a URI lookup error and fell back to its v73 single-session
  URI (`raw/final-device-out/npu-proof.log:270`); dispatch proof still counted
  484 HTP MUL_MAT operations and exited 0.
- P-NPU logs warn that fit parameters could not meet a 1 GiB free-memory target
  with `-ngl 99` (`P-npu-1.log:15-18`). The requested HTP0 model buffer was
  allocated and measured, the separate op proof passed, and all P-NPU runs
  exited 0. CPU decode logs also show the known FastRPC domain-query fallback
  (`D-5-1.log:10`); decode ran with CPU-only flags and exited 0.
- The analyzer's first pass exposed a header delimiter mismatch, then a proof
  marker index error. Both were corrected; final analysis exited 0 and reports
  9/9 valid prefill and 6/6 valid decode arms (`raw/analyze-final.log`).

### Commands and raw evidence

Final engine-arm command exited 0:

```sh
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'cd /data/local/tmp/heat3way && sh s23-engine/sess.sh'
```

The validation wrappers and final analyzer exited 0; the diagnostic
`llama-bench` child was intentionally terminated after the 30-second loaded
sample with `rc=143`. Shell syntax check, Python syntax compilation, final
device pull, and `git diff --check` all exited 0.

The engine kit binaries and ship model were already on the phone under
`/data/local/tmp/heat3way`; model SHA-256 matched the registered
`a247afd6414918eac8e520a9e6137dc271235461ecbe1180462221d5b8d40b03`.
Prompt and kit hashes are in `raw/device-input-sha256.txt`. Session markers,
per-second samples, proof log, all 15 arm logs, current-validation traces,
postflight, and command outputs are under `raw/`.
