# Thermal sensor inventory and idle-noise preregistration

## Prediction — recorded before any noise samples

- Battery temperature (`dumpsys battery`) will update in 0.1 °C steps because the platform reports tenths of a degree. At idle, I expect standard deviation ≤0.1 °C, max–min ≤0.3 °C, and drift ≤0.2 °C over 10 minutes.
- SoC thermal zones will be noisier than the battery sensor but mostly stable at idle. I expect standard deviation ≤0.5 °C per zone and max–min ≤2.0 °C over 10 minutes; the sysfs values may expose finer formatting than the sensors' actual update granularity.

Predictions are frozen. The S23 is inventory-only because it is charging. The Xiaomi 14 will be sampled only if unplugged, Awake with Kalsa foreground, and below the thermal stop.

## Device inventory

Serials from `adb devices -l`:

- Xiaomi 14 (`houji`, 23127PN0CG): `adb-625689a2-9xEOfw._adb-tls-connect._tcp`.
- Galaxy S23 (`dm1q`, SM-S911U): `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.
- Jelly also appeared in the host serial list; it received no device command.

All thermal-zone reads below were ordinary, unrooted `adb shell` reads. Raw per-zone paths, labels, values, and read failures are in `raw/xiaomi-inventory.txt` and `raw/s23-inventory.txt`.

| Phone | Thermal zones | Readable `type` | Readable `temp` |
|---|---:|---:|---:|
| Xiaomi 14 | 102 | 102 | 102 |
| Galaxy S23 | 95 | 95 | 86; 9 unreadable |

### Sensor map and HAL

- **Xiaomi 14:** sysfs `cpu-*` core zones plus `cpuss-*` aggregate zones; `gpuss-0..7` GPU; `nsphvx-0..1` and `nsphmx-0..3` NSP; `battery` battery; no sysfs zone literally named skin. `dumpsys thermalservice` supplies named CPU0..7, GPU0..7, nsp0..5, `skin`, and `battery` HAL values. Status 0. Current HAL skin 31.395°C and battery 30.7°C, both with `low_power=0`; cached temperatures in the same dump are older/stale (for example cached CPU max 89.9°C and skin 42.073°C), so they are not treated as current values. HAL cooling devices include `gpu` level 2, CPU frequency devices, thermal-pause devices, and KGSL devfreq (level 0).
- **Galaxy S23:** readable `cpu-*` core zones and `cpuss-0..3` subsystem zones; `gpuss-0..7` GPU; `nspss-0..3` NSP; `battery` zone; no sysfs zone literally named skin. HAL names `AP` (CPU/SoC aggregate), `PA`, `BAT`, `MAINBATRAW`, `USB`, and `SKIN`; status 0 with `low_power=0`, and no cooling device entries were returned. `thermal_zone75..81`, `90`, and `91` have readable types but unreadable temps; their labels are PMIC/battery-management zones.
- On both phones, vendor core labels do not reveal a verified LITTLE/mid/prime cluster mapping. The aggregate `cpuss`, `aoss`, modem, power-supply, and mmWave labels are not safe to reinterpret as CPU/GPU/NSP/skin. S23 `AP` is not an isolated CPU sensor. Raw sysfs temp integers are usually millidegrees Celsius for the SoC zones; special zones can use other scales or sentinels (`-273000`, zero, `vbat`, `socd`), so they are not combined into a temperature series.

### Battery, thermal state, and installed app

- Xiaomi inventory: unplugged (AC/USB/wireless false), 88%, battery 30.9°C, thermal status 0, `low_power=0`, Awake; launcher foreground. App package `versionName=0.1.0`, `lastUpdateTime=2026-09-24 02:44:01`.
- Xiaomi noise-gate recheck: unplugged, 87%, battery 29.7°C, thermal status 0, `low_power=0`, Awake; launcher still foreground, no `com.kalsa.app` PID, and `/data` had 290 GB available (≥5 GB requirement satisfied). The filtered model-load log query returned no lines, so no resident model was shown.
- S23 inventory: AC powered true, USB/wireless false, 12%, battery 29.3°C, thermal status 0, `low_power=0`, Dozing; no resumed Kalsa activity. Package `versionName=0.1.0`, `lastUpdateTime=2026-09-24 12:24:41`.
- As required before each S23 command, `top -b -n 1 | grep -E 'adsprpcd|cdsprpcd'` recorded both daemons at 90.3%, then 100% each immediately before inventory, then 110%/100% before the shell-UID check. They were spinning. S23 was charging and is inventory-only; no S23 noise run was attempted.

## Xiaomi idle-noise gate before launch authorization — superseded

At the time of this earlier gate, there were no 1 Hz samples and no noise statistics. The Xiaomi was Awake and unplugged, but the launcher was resumed and `com.kalsa.app` was not running. Starting it would alter the current app/model state and could trigger model restoration/prewarm; that conflicts with the explicit no-load/no-unload/no-inference rule. I left the phone untouched and did not start the 10-minute run. Thus noise-run start/end charging brackets and per-sample `low_power` values are **not applicable**, not inferred from the separate inventory reads. That pre-authorization status was superseded by the later launch and invalid-attempt record below. The frozen predictions remain untested.

## Raw evidence

`raw/adb-devices.txt`, `raw/s23-daemon-precheck.txt`, `raw/s23-inventory.txt`, `raw/xiaomi-inventory.txt`, and `raw/xiaomi-noise-gate.txt` hold the direct outputs. `raw/evidence-inventory.txt` records `ls -la` and `wc -l` for the report and raw evidence.

## Xiaomi launch and idle-noise attempt — INVALID; no valid run

The owner authorized a launcher start. At 2026-09-25 00:03:46 UTC, `adb -s adb-625689a2-9xEOfw._adb-tls-connect._tcp shell am start -n com.kalsa.app/.MainActivity` returned `Starting: Intent { cmp=com.kalsa.app/.MainActivity }`. The timeout was read as 86400000 ms and left unchanged. Before launch, `pidof com.kalsa.app` was empty and the prior model-load query had no marker. Startup logcat captured KALSA_NATIVE tensor-loading/OpenCL initialization. It later showed `KALSA_PREWARM {"op":"skip","reason":"not_ready"}` at 00:15:03 UTC; no explicit model-resident success marker appeared, so the final resident-model state is unconfirmed.

The settle gate first observed 28.3 °C at 00:09:38 UTC, then unchanged for more than three minutes with thermal status 0. The attempted run began 00:13:25 UTC: AC/USB/wireless false, 86% battery, 28.3 °C, thermal 0, `low_power=0`, Awake, Kalsa foreground. It produced 30 rows ending 00:15:36 UTC over 131 seconds, a mean 4.517-second interval (not 1 Hz). The rows showed unplugged, thermal 0, low_power 0, and battery 86→85%, 28.3→28.1 °C, but are invalid and are not treated as noise measurements.

At the next block check, Kalsa was no longer foreground; the observed resumed activity was `sh.paseo/.MainActivity`, with the transition timestamped 00:15:14.480 UTC in logcat. The sampler exited with code 2, so there is no valid 10-minute run, end bracket, or noise statistic. No prompt or generation was sent. The preregistered prediction remains untested. I did not bring Kalsa back over the other activity.

Raw evidence: [launch/startup logcat](raw/xiaomi-launch-kalsa-logcat.txt), [initial KALSA log snapshot](raw/xiaomi-launch-kalsa-initial.txt), [settle gate](raw/xiaomi-settle-gate.txt), [start and block brackets](raw/xiaomi-launch-and-brackets.txt), [invalid partial samples](raw/xiaomi-idle-noise-invalid-partial.csv), [attempt summary](raw/xiaomi-idle-attempt-summary.txt), [driver output and exit](raw/session-driver-v2.log). The failed first guard and the stopped partial run are preserved in [session-driver.log](raw/session-driver.log) and [session-driver-v2.log](raw/session-driver-v2.log).

## S23 after reboot

### Preregistration (written before device access)

Predictions for the idle 10-minute run: `dumpsys battery` temperature will quantize in 0.1 °C steps, with standard deviation ≤0.1 °C, absolute first-to-last drift ≤0.2 °C, and max–min ≤0.3 °C. For each readable CPU core/cluster-labeled, `cpuss`, GPU (`gpuss-*`), NSP (`nspss-*`), and HAL skin sensor, I expect sysfs millidegree formatting where applicable, effective idle standard deviation ≤0.5 °C, and max–min ≤2.0 °C. Core prefixes will be kept as `cpu-0-*`/`cpu-1-*`; I will not infer LITTLE/mid/prime identities. This prediction was written before any S23 command in this session.

### S23 reboot preflight

Discovery at 2026-09-25 02:38:48 UTC found the rebooted S23 at `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`; the Xiaomi was only listed by discovery and received no command. Daemon snapshots were 97 seconds apart (02:39:05 and 02:40:42 UTC). At both snapshots `top` reported `adsprpcd` and `cdsprpcd` at 0.0%; each `/proc/<pid>/stat` utime remained 0 ticks. This passes the daemon gate. Device uptime was 142.73 s and 239.54 s respectively. The first bracket: unplugged, 96%, 35.2 °C, thermal status 1, Awake, launcher foreground. The second: unplugged, 96%, 33.2 °C, thermal status 0, Awake, launcher foreground. Both include full top/stat, battery, thermal and power evidence under `raw/s23-after-reboot/`.


### Idle-noise run

The screen timeout was unset before this session (`settings get system screen_off_timeout` produced an empty value). I set it to `2147483647` ms and verified that value. It remains at maximum for tonight's subsequent heat protocol; restoring the original unset state means deleting this override after that protocol. Kalsa was launched only with `am start -n com.kalsa.app/.MainActivity`. It auto-loaded the model and ran its startup prewarm: `KALSA_PREWARM` start at 22:44:11.972 local, lazy OpenCL flash-attention prepass compilation at 22:44:12.029, prewarm done at 22:44:28.165 (`promptMs=16131.715`, `promptN=1812`), and snapshot-save failure (`save_error`). The app later logged model unload for idle at 22:50:04.672. The startup log therefore indicates the model was no longer resident by the noise run. No prompt was sent and no inference was initiated by me.

After startup, the settle gate waited for battery temperature to remain unchanged for three minutes and thermal status to be 0. The raw gate shows it stable at 28.6 °C from 03:07:51.743 through at least 03:16:34.062 UTC (18 consecutive ~30-second polls), with thermal status 0 throughout; sampling began at 03:16:34.372 UTC. Start bracket: unplugged (AC/USB/wireless false), 93%, thermal status 0, 28.6 °C; `mWakefulness=Awake`, resumed `com.kalsa.app/.MainActivity`, keyguard false. The last sample was triggered at 03:26:33.389 UTC, uptime 2990.44 s. End bracket at 03:26:34.954 UTC: unplugged, 92%, thermal status 0, 29.8 °C; Awake, Kalsa resumed, keyguard false. All 20 block-boundary brackets passed these checks. Hard stops were not reached: thermal status stayed below 3, battery peaked at 29.9 °C, and battery stayed ≥92%.

The sampler used one persistent `adb shell` process and Mac-paced newline triggers. It produced 600 samples over ten minutes: mean device rate 1.000067 Hz, mean host-trigger rate 0.999996 Hz, mean device interval 0.999933 s. Individual intervals ranged from 0.80 to 1.64 s because boundary checks interrupt cadence; each 30-second block passed the 0.95–1.05 Hz cadence gate. This is a 1 Hz mean with bounded block cadence, not a claim that every adjacent interval was exactly one second. An earlier sampler launch failed before emitting samples; its diagnostics are preserved and excluded.

The sampler did not record `settings get global low_power` per sample, so no low-power values are inferred for the noise rows. Thermal status was 0 at every sample. Sensor names follow `raw/s23-inventory.txt`: CPU label prefixes are preserved without inferring architectural clusters; `cpuss-*`, `gpuss-*`, and `nspss-*` remain vendor labels. “CPU label group max” rows are only max-over-labelled-cores summaries.

| Sensor / reported label | Resolution (°C) | SD (°C) | Drift (°C)¹ | Max–min (°C) |
|---|---:|---:|---:|---:|
| Battery (dumpsys) | 0.1 | 0.380 | +1.140 | 1.3 |
| Battery sysfs | 0.1 | 0.379 | +1.135 | 1.3 |
| cpu-0-0 | 0.4 | 0.721 | +1.473 | 5.2 |
| cpu-0-1 | 0.4 | 0.683 | +1.133 | 4.8 |
| cpu-0-2 | 0.4 | 0.747 | +1.553 | 4.8 |
| cpu-1-0 | 0.4 | 1.069 | +1.907 | 11.8 |
| cpu-1-1 | 0.4 | 1.315 | +1.877 | 17.1 |
| cpu-1-2 | 0.4 | 1.018 | +1.773 | 6.4 |
| cpu-1-3 | 0.4 | 1.310 | +2.120 | 15.9 |
| cpu-1-4 | 0.4 | 1.094 | +1.797 | 11.8 |
| cpu-1-5 | 0.4 | 1.384 | +2.102 | 16.2 |
| cpu-1-6 | 0.4 | 0.816 | +1.665 | 8.1 |
| cpu-1-7 | 0.4 | 0.965 | +1.627 | 8.1 |
| cpu-1-8 | 0.4 | 0.779 | +1.718 | 6.5 |
| cpu-1-9 | 0.4 | 0.734 | +1.768 | 5.3 |
| cpu-1-10 | 0.4 | 0.718 | +1.753 | 4.8 |
| cpu-cluster-label-0 max (grouping by reported labels only) | 0.4 | 0.655 | +1.353 | 4.8 |
| cpu-cluster-label-1 max (grouping by reported labels only) | 0.4 | 1.568 | +2.012 | 15.4 |
| cpuss-0 | 0.4 | 0.824 | +1.733 | 6.4 |
| cpuss-1 | 0.4 | 0.842 | +1.820 | 6.0 |
| cpuss-2 | 0.4 | 0.810 | +1.780 | 6.8 |
| cpuss-3 | 0.4 | 0.790 | +1.833 | 6.8 |
| gpuss-0 | 0.3 | 0.477 | +1.225 | 3.1 |
| gpuss-1 | 0.3 | 0.483 | +1.257 | 2.7 |
| gpuss-2 | 0.3 | 0.507 | +1.303 | 3.1 |
| gpuss-3 | 0.3 | 0.488 | +1.297 | 2.7 |
| gpuss-4 | 0.3 | 0.512 | +1.317 | 3.1 |
| gpuss-5 | 0.3 | 0.490 | +1.293 | 3.1 |
| gpuss-6 | 0.3 | 0.503 | +1.298 | 3.1 |
| gpuss-7 | 0.3 | 0.497 | +1.292 | 3.1 |
| nspss-0 | 0.4 | 0.495 | +1.313 | 3.2 |
| nspss-1 | 0.4 | 0.503 | +1.273 | 2.8 |
| nspss-2 | 0.4 | 0.477 | +1.287 | 2.8 |
| nspss-3 | 0.4 | 0.504 | +1.360 | 3.2 |
| Skin (HAL) | 0.1 | 0.367 | +1.097 | 1.4 |


¹ Drift is the mean of the final 60 samples minus the mean of the first 60. Sysfs values are reported in millidegrees by the kernel, but observed resolution is the smallest nonzero step over the run. Thermal status was constant at 0. The battery's 0.1 °C step prediction was met, but its noise prediction was not: SD 0.380 °C, drift +1.140 °C, range 1.3 °C. SoC predictions were exceeded for most CPU/CPUSS/NSP ranges; GPU SD was near 0.5 °C while GPU range was 2.7–3.1 °C. Battery and skin rose together, and most SoC zones drifted upward, so these figures include a common-mode warm-up trend and are not stationary sensor noise alone. Reading all zones and `thermalservice` once per second may itself add some load; this run characterizes the complete sampling procedure as executed.

Raw evidence is under `raw/s23-after-reboot/`: device discovery; both daemon preflights; screen-timeout read/write; Kalsa launch and startup logs/markers; settle gate; all run brackets; 600-row CSV; statistics; and sampler scripts/driver logs, including the preserved failed no-sample attempt. `raw/s23-after-reboot/evidence-inventory.txt` records `ls -la` and `wc -l` for the session files. The CSV contains sample timestamps, uptime, power state, battery and all mapped sensors. The screen is intentionally left on with Kalsa foreground for the forthcoming heat protocol. No Xiaomi command was issued.
