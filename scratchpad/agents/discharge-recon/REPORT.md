# Battery discharge on the test phones — everything knowable, written down

Reconnaissance date: **2026-09-21**. Read-only: no file in any repository was
edited, created, moved or deleted except this report; nothing was written to the
device; no benchmark was run; no device setting was changed.

**This is the "drain" companion** to the sibling report
`LAB/scratchpad/agents/energy-instrumentation/REPORT.md` (written the same
morning, 07:26), which mapped the app-side energy *surface*. Where the two
overlap, this report says so rather than re-deriving it.

## Path and revision aliases used throughout

| alias | tree | revision at read time |
|---|---|---|
| `APP` | `/Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy` (`Aspis0/kalsa`) | branch `qwen-repack-policy`, HEAD `fc3627d` |
| `LAB` | `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck` (`Aspis0/kalsa-moe-experiments`) | branch `main`, HEAD `da1618a6` |
| `ENGINE` | `~/Projects/kalsallama` (`Aspis0/kalsallama`) | branch `b11010-merge` |

**Device used.** Galaxy S23, `SM-S911U`, adb serial
`adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, Android 16 (`ro.build.version.sdk=36`),
board `kalama`, `ro.soc.model=SM8550`, app `com.kalsa.app` uid `10347` (u0a347),
installed versionName `0.1.0`, APK sha256 `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`.
Connected over **wireless adb** (TLS), so the cable was not attached: `dumpsys
battery` reported `AC powered: false`, `USB powered: false`, `Wireless powered: false`.

> **One device-identity note.** `AGENTS.md` names the S23 as
> `192.168.1.152:43089` and marks it as another session's. That transport was
> **not** attached. `adb devices` showed the Jelly Star (`192.168.1.82:5555`) and
> the mission-granted S23 (`adb-R3CW406P8CV…`), a different phone on the same
> network. Only the mission-granted S23 was queried. Serial choices are
> `UNVERIFIED` here beyond the string the device reports.

---

# Answer first — the five things that matter

1. **The S23 is not blind to battery data any more; only the sysfs path is
   blocked.** `dumpsys battery` and `cmd battery get` return real framework values
   without root: `current now`, `current_average`, `Charge counter` (µAh),
   `voltage`, `temperature`, `level`, plug flags. Every individual
   `/sys/class/power_supply/battery/*` node is `Permission denied` for
   `uid=2000(shell)`; the alternative `max77705-fuelgauge` directory has no
   `current_now`. The record "S23 shell fuel-gauge reads come back
   permission-denied or empty" is true for **sysfs** and stale for **dumpsys**
   (evidence in §A, §C).

2. **But the shell-side *series* is coarse and the numbers are not what they
   look like.** The framework broadcast that carries the series fires every
   ~10–11 minutes at idle (30–90 s under load, documented but not re-verified
   here); the charge counter is quantised — it sat at `435000 µAh` for 238 s at
   ~200 mA in my own probe; and `current_now` bounced between −4 and −670 in the
   same probe while `current_average` stayed −164…−257. A `% / hour` number from
   the shell is honest over ≥30–60 minutes. A joule-per-turn number is not
   obtainable from the shell at all.

3. **The high-rate app-side series exists in the installed APK but is dead
   code.** `GovernorBattery` appears 19 times across the 21 dex files and the
   trace schema string `kalsa-governor-battery-trace-v1` is in the dex, so the
   module ships and is registered; but `startSampling` / `readHighRate` have
   **no JS caller** (`APP/src/engine/governorBatterySampler.ts` exports three
   functions, nothing imports them) and the module has **no voltage column**, so
   even if started it cannot produce a joule.

4. **The phone is never quiet.** Qualcomm's DSP daemon `adsprpcd` has consumed
   `7,586,623` jiffies of CPU (≈75,866 s) since boot over `209,422 s` uptime =
   **36 % of one core, averaged since boot**, and 26–51 % of one core in short
   windows. `cdsprpcd`, `sscrpcd`, `audioadsprpcd` add a little. The record
   "about a full core continuously" is **too strong**: this is roughly a third
   to a half of one core, and it is a permanent un-controlled floor on every S23
   number.

5. **What the S23 can support today without root, with what precision, and what
   it cannot.** Measurable: idle/average discharge in **%/hour** over ≥30–60 min
   windows; energy in **J** over windows long enough to cross one charge-counter
   step (≈26 000–67 500 µAh, i.e. ~100–250 J) via `J = ΔQ · V̄ · 1e-6 · 3600`;
   the **full 1 Hz temperature series** from `/sys/class/thermal/thermal_zone*/temp`
   (readable!); frequency caps (`scaling_max_freq`); OS thermal status; wakelock
   and wakeup counters; per-UID estimated mAh from `dumpsys batterystats`.
   Impossible from the shell: true instantaneous power (W) below ~1 minute, and
   therefore per-phase or per-token joules on the S23 — those need the app-side
   1 Hz sampler with a voltage column, which does not exist yet.

---

# A. The data sources that exist, and what each returns on this S23

Raw outputs are quoted verbatim; commands are given in full so they can be
re-run.

## A.1 `dumpsys battery` — the framework battery snapshot

```
$ adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell dumpsys battery
  AC powered: false
  USB powered: false
  Wireless powered: false
  Dock powered: false
  Charge counter: 472500
  status: 3
  health: 2
  present: true
  level: 12
  scale: 100
  voltage: 3628
  temperature: 281
  current now: -505
  charge counter: 472500
```

- **Fields and units:** `level` (%) and `scale` (100); `voltage` (mV);
  `temperature` (0.1 °C); `Charge counter` / `charge counter` (µAh); `status`
  (BatteryManager int, 3 = discharging); `current now` (the HAL's current, unit
  disputed — see §C); plug flags; `health`; plus Samsung-specific blocks
  (`mSavedBatteryAsoc`, `FirstUseDate`, protection mode).
- **Rate:** a snapshot, *not* a series. It also embeds `[BattActionChangedLogBuffer]`,
  a timestamped log of every `ACTION_BATTERY_CHANGED` broadcast with
  `level/status/voltage/temperature/current_avg/cc`. That buffer **is** a series,
  but only at broadcast cadence.
- **Root / permission:** none. Works as `uid=2000(shell)`.
- **During a run:** yes, one round trip; harmless.
- **Measures:** real framework-measured current/charge/voltage/temperature
  (not a model estimate), but sampled at the framework's cadence, not on demand.

**Broadcast cadence measured now (idle):** over 30 s the last buffer line did not
move; the last two entries were `08:35:40` (`level:12 … cc:506250`) and
`08:46:00` (`level:11 … cc:472500`) — **~10 min apart at idle**. The 30–90 s
figure in `APP/scripts/device-energy-trace.sh:19` and
`APP/docs/S23-ENERGY-BLOCKER.md` is for a *loaded* run and is
**UNVERIFIED here** (verifying it needs a run, which is outside this mission).

## A.2 `cmd battery get` — the same service, named keys

```
$ adb shell cmd battery -h
  get [-f] [ac|usb|wireless|dock|status|level|temp|present|counter|invalid|current_now|current_average]
```

Real values on this S23:

| key | first read | with `-f` (fresh) | unit (as printed) |
|---|---|---|---|
| `level` | 12 | 12 | % |
| `temp` | 281 | 281 | 0.1 °C |
| `counter` | 472500 | 472500 | µAh |
| `status` | 3 | 3 | int |
| `current_now` | −32 | −12 | µA per AOSP, mA-like on this device |
| `current_average` | −168 | −184 | µA per AOSP, mA-like on this device |

- **Rate:** on call. `-f` forces a fresh HAL read.
- **Root / permission:** none.
- **During a run:** yes.
- **Measures:** current/charge/level/temperature from the same battery service
  `BatteryManager.getIntProperty()` binds to. **No energy field.**

## A.3 `/sys/class/power_supply/*` — blocked

```
$ adb shell 'ls -la /sys/class/power_supply/'
  ac  battery  max77705-charger  max77705-fuelgauge  max77705-otg
  mfc-charger  otg  pca9481-charger  pogo  sec-direct-charger  usb  wireless

$ adb shell 'ls /sys/class/power_supply/battery/'
ls: /sys/class/power_supply/battery/: Permission denied

$ adb shell 'cat /sys/class/power_supply/battery/current_now'
cat: /sys/class/power_supply/battery/current_now: Permission denied
```

The same `Permission denied` for `voltage_now`, `temp`, `status`, `capacity`,
`charge_counter`, `health`, `technology`, and for every `uevent` under `ac`,
`battery`, `usb`, `wireless`, `pogo`, `mfc-charger`, `pca9481-charger`,
`sec-direct-charger`, `max77705-charger`, `max77705-fuelgauge`. The
`max77705-fuelgauge` directory is **listable** (`device  fg_data  online  power
subsystem  type  uevent  wakeup56`) but `fg_data` is `Permission denied` and
there is **no `current_now` node**. SELinux denies this to `u:r:shell:s0`; it is
not an empty-file artefact.

- **Root / permission:** root or an SELinux change would be needed. `uid=2000(shell)`
  cannot read any content.
- **Measures (if it were readable):** the fuel gauge's raw current/voltage.

## A.4 `dumpsys batterystats` — per-UID estimates, wakelocks, history

Bounded excerpts from the live dump:

**Estimated power use (a model estimate, from the power profile):**

```
  Estimated power use (mAh):
    Capacity: 3785, Rated: 3785, Typical: 3900, Computed drain: 3244, actual drain: 3244
    screen: 149 apps: 149
    cpu: 4337 apps: 4337 duration: 6h 26m 12s 547ms
    wakelock: 93.8 apps: 93.8 duration: 4h 47m 12s 476ms
  ...
  UID u0a347: 755 fg: 417 (55m 11s 175ms) bg: 252 (5s 327ms) cached: 0.390 (3s 969ms)
      screen=85.1 cpu=670 cpu:fg=417 cpu:bg=252 cpu:cached=0.390
      (on battery, screen on) screen=85.1 cpu=615 …
      (on battery, screen off/doze) cpu=54.7 cpu:bg=54.5 cpu:cached=0.212
```

**Our app is an identifiable UID**: `u0a347` = 10347 (`APP/native/…`,
`cmd package list packages -U` → `package:com.kalsa.app uid:10347`). The estimate
for it since the last full charge is **755 mAh total, 417 mAh foreground**.

**Wakelock and kernel-wakelock counters** are present and per-UID labelled:

```
  Kernel Wake lock sec-battery-monitor: 34m 51s 311ms (50133 times) realtime
  Kernel Wake lock qcom_rx_wakelock: 30m 2s 881ms (34777 times) realtime
  All partial wake locks:
  Wake lock u0a86 *job*r/com.sec.android.app.samsungapps/…: 6m 21s 982ms (5 times) …
  Wake lock 1000 deviceidle_maint: 1m 4s 955ms (8 times) …
```

**History: the `+` / `-` event lines**, with measured fields per event:

```
Battery History [Format: 2] (11% used, 458KB used of 4096KB, …):
  09-20 20:41:19.355 RESET:TIME: 2026-09-20-20-41-19-355
  09-20 20:41:19.355 100 status=full health=good plug=none temp=282 volt=4382 current=1
      ap_temp=29 pa_temp=28 skin_temp=29 … charge=3750 … +running +wake_lock +wifi_multicast
      +wifi_radio +screen phone_signal_strength=great +wifi wifi_signal_strength=4
      wifi_suppl=completed +ble_scan
  ...
  09-20 20:41:18.547 100 +sensor +state=1000:"sensor:0x6f6"
  09-20 20:41:18.638 100 -job=5004:"com.samsung.cmh/…"
```

Each history line carries `temp=`, `volt=`, `current=`, `charge=`, `ap_temp=`,
`pa_temp=`, `skin_temp=` when the value changed, plus `+`/`-` state transitions.
This is a **timestamped, framework-measured series** — but event-driven, and only
as dense as the battery monitor's own sampling.

**Machine-readable forms both work without root:**

```
$ adb shell 'dumpsys batterystats -c' | wc -l          # checkin format
90556
$ adb shell 'dumpsys batterystats -c' | grep '^9,10347,'
9,10347,l,pwi,uid,755,1,85.1,0
9,10347,l,awl,30,30
9,10347,l,wl,*launch*,0,f,0,0,0,0,0,p,0,0,0,0,0,bp,0,0,0,0,0,w,0,0,0,0

$ adb -s … exec-out 'dumpsys batterystats --proto' | wc -c
120343                       # raw protobuf on stdout, read-only
```

Options accepted: `--checkin`, `--proto`, `--history`, `--charged`, `-c`,
`--daily`, `--reset`/`--reset-all` (destructive — do not use), `--usage`,
`--wakeups`, `--power-profile`, `--cpu`, `--settings`, `<package.name>`.

- **Root / permission:** none for reading. (`--reset`, `--write`, `--new-daily`
  are writes and were not used.)
- **During a run:** yes, but `--reset` clears the counters, so a campaign must
  never call it.
- **Measures:** **a model estimate** (mAh) for the power table and per UID; the
  `+`/`-` history and the wakelock counters are real measurements. The estimate's
  calibration constants are in `dumpsys batterystats --power-profile`
  (`battery.capacity=3785`, `cpu.idle=19.6`, per-cluster `cpu.core_power.*`
  arrays, `screen.on=73.9` …), all in mA/mAh units.

## A.5 Thermal, the throttle signal, and the three temperature routes

```
$ adb shell dumpsys thermalservice
Thermal Status: 0
Cached temperatures:
	Temperature{mValue=30.1, mType=0, mName=AP,      mStatus=0}
	Temperature{mValue=28.1, mType=2, mName=BAT,     mStatus=0}
	Temperature{mValue=28.7, mType=5, mName=PA,      mStatus=0}
	Temperature{mValue=29.3, mType=3, mName=SKIN,    mStatus=0}
HAL Ready: true
	ThermalHAL 2.0 connected: yes
```

```
$ adb shell 'for z in /sys/class/thermal/thermal_zone*; do echo "$z $(cat $z/type) $(cat $z/temp)"; done'
/sys/class/thermal/thermal_zone0  aoss-0    32800
/sys/class/thermal/thermal_zone1  cpuss-0   37200
...
/sys/class/thermal/thermal_zone12 cpu-1-7   35200
/sys/class/thermal/thermal_zone33 gpuss-0   34000
/sys/class/thermal/thermal_zone43 bcl_warn  -273000     # invalid
/sys/class/thermal/thermal_zone56 epm0      -273000     # invalid
```

```
$ adb shell 'for d in /sys/devices/system/cpu/cpufreq/policy*; do echo "$d max=$(cat $d/scaling_max_freq) min=$(cat $d/scaling_min_freq)"; done'
policy0 related=0 1 2   max=2016000 min=556800
policy3 related=3 4 5 6 max=2803200 min=614400
policy7 related=7       max=3360000 min=864000
```

- **`/sys/class/thermal/thermal_zone*/temp` is readable at 1 Hz by shell** (74–95
  zones on this device). This is the fastest temperature source on the S23. The
  zones are **not** skin or battery: `thermal_zone0` is `aoss-0`, and there is no
  zone named `skin` or `batt`. `SKIN` exists only through the thermal HAL.
- `dumpsys thermalservice` gives `SKIN`/`BAT`/`AP`/`PA` in 0.1 °C and a throttling
  **severity index** (`Thermal Status: 0` here).
- `scaling_max_freq` equals the hardware maximum on all three policies right now,
  so the device is **not throttled at this moment**; the governor is `walt`.
- **Measures:** temperature and a throttle severity. **No energy.**

## A.6 `dumpsys deviceidle` and `dumpsys power`

```
$ adb shell dumpsys deviceidle | grep -E 'mState|mLightState|mScreenOn|mCharging|mEnabled'
  mLightEnabled=true  mDeepEnabled=true
  mScreenOn=false
  mCharging=false
  mState=IDLE mLightState=OVERRIDE
```

`deviceidle` also carries the full doze timing table (`inactive_to=+30m`, `idle_to=+1h`,
`light_idle_to=+5m`, …) and an idling history (`light-idle: -2d10h…`, `deep-idle: …`).

```
$ adb shell dumpsys power | grep -E 'mWakefulness|mIsPowered|mPlugType|mBatteryLevel|Wake Locks'
  mWakefulness=Dozing
  mIsPowered=false
  mPlugType=0
  mBatteryLevel=12
  Wake Locks: size=1
    DOZE_WAKE_LOCK   'dream:doze' ACQ=-4h16m50s123ms (uid=1000 pid=2811 …)
```

- **Root / permission:** none.
- **Measures:** power/doze/screen state and wakelocks. **No energy.**
  `mWakefulness` is the load-bearing field: a `Dozing`/`Asleep` window is not a
  comparable measurement window (this is why `APP/scripts/device-energy-sweep.sh`
  aborts a block that dozed).

## A.7 Battery Historian

- **Not present anywhere in `APP` or `LAB`** (grep for "battery historian" over
  both trees: no hits).
- What it needs: an Android **bugreport** (the canonical input). `adb bugreport`
  runs `dumpstate` on the device and writes a zip under `/data/local/tmp` before
  pulling it — i.e. it **writes to the device**, which this mission forbids, so it
  was **not run**. The binaries exist (`/system/bin/bugreport`, `/system/bin/dumpstate`).
- **Read-only substitute available today:** `dumpsys batterystats --proto`
  returns 120 343 bytes of protobuf on stdout (`exec-out`) with no device write.
  Whether Battery Historian ingests that protobuf directly is **UNVERIFIED**.
- Practical verdict: Battery Historian is a **post-hoc analysis** tool, not a
  during-run instrument; it can only report what `batterystats` already records.

## A.8 Perfetto / atrace battery counters

- `perfetto` (v49.0) and `atrace` exist; `traced` runs. Shell is in group
  `3012(readtracefs)`.
- `atrace --list_categories` has **no battery category**; it does have `power`,
  `freq`, `thermal`, `idle`, `sched`.
- `perfetto --query` lists two relevant data sources:
  `android.power` (power rails / energy counters via the PowerStats HAL) and
  `linux.sysfs_power`.
- `dumpsys powerstats` returns **empty** with rc 0 for shell, and
  `dumpsys android.hardware.power.IPower/default` fails with `FAILED_TRANSACTION`:
  the power-rail counters are not exposed to `shell`.
- Starting a Perfetto/atrace trace **writes to tracefs**, so it was not done.
  Whether `android.power` yields real per-rail energy counters on this device is
  therefore **UNVERIFIED**.

## A.9 What each source measures — the decision table

| source | measures | unit | usable during a run? | root? |
|---|---|---|---|---|
| `dumpsys battery` | **current + charge + voltage + temperature** (framework) | µAh / mV / 0.1 °C, current unit disputed | yes (snapshot) | no |
| `dumpsys battery`, `[BattActionChangedLogBuffer]` | the same, as a log | idem | yes (post-hoc read) | no |
| `cmd battery get [-f]` | current now/average, counter, temp, level | idem | yes | no |
| `/sys/class/power_supply/*` | fuel gauge raw | — | no (denied) | yes |
| `dumpsys batterystats` power table | **model estimate** (mAh) | mAh | yes | no |
| `dumpsys batterystats` history / wakelocks | measured events, wakelock duration | s, counters | yes | no |
| `dumpsys batterystats --proto/-c` | all of the above, machine-readable | mixed | yes | no |
| `dumpsys thermalservice` | temperature + throttle severity | 0.1 °C, index | yes | no |
| `/sys/class/thermal/thermal_zone*/temp` | temperature | m°C | **yes, ~1 Hz** | no |
| `scaling_max_freq` | current frequency cap | kHz | yes (outside the turn) | no |
| `dumpsys deviceidle` / `dumpsys power` | doze/screen/wakelocks | state | yes | no |
| Perfetto `android.power` | possibly **rail energy** | nWh | not verified | not verified |
| Battery Historian | post-hoc analysis of the above | mixed | no (after) | no |

**The line that decides what we may claim:** only `dumpsys battery` /
`cmd battery get` / the battery-history events are *measurements*; the
`Estimated power use (mAh)` table is a **model estimate** from the power profile
and must never be quoted as measured energy.

---

# B. What the lab already collects, and where it lives

Two classes of instrument exist: **the audited Jelly sampler chain** (best
current practice, and the only one with a frozen schema) and **the S23
framework harnesses** (older, thinner, partly superseded).

## B.1 Current best practice — the audited chain (`APP`)

| script | samples | rate | output | columns | computes | status |
|---|---|---|---|---|---|---|
| `APP/scripts/energy-sample.sh` | sysfs `current_now`, `voltage_now`, `temp`, `status` + per-CPU `scaling_cur_freq` + `/proc/uptime` | 1 Hz nominal | `<tag>.csv` on device, pulled to the run dir | `t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz` | nothing (raw) | **current** — but produces empty energy columns on the S23 because sysfs is denied |
| `APP/scripts/energySchema.mjs` | parses the CSV | — | in-memory | — | right-Riemann `J = Σ\|I·V\|·Δt`, mean W, cadence | **current** |
| `APP/scripts/energyAggregate.mjs` | a campaign dir | — | between-arm table + CodeCarbon `emissions/*.csv` | `timestamp,project_name,run_id,duration,cpu_power,cpu_energy,emissions,os,cpu_count,cpu_model` | mean W, J, J/token | **current** |
| `APP/scripts/energyPhaseSplit.mjs` | sampler CSV + `.marks` (+ `.stamps`) | — | `<stem>.phases.csv` (`kalsa-energy-rep-v2`/`v3`) | v3: `run_id,rep,window_*_s,duration,load_idle_s,prefill_s,decode_s,j_load_idle,j_prefill,j_decode,j_per_tok_decode,prompt_tokens,gen_tokens,w_decode,n_*,cadence_*_s,warnings` | per-phase J, J/decode-token, coverage | **current**; v1 retracted |
| `APP/scripts/device-ngram-spec.sh` | drives `llama-cli`, starts/stops the sampler per arm, writes `.marks` | per arm | `device-ngram-spec-out/` | sampler CSV + marks + speed `.txt` | — | **current** (Jelly) |
| `APP/scripts/device-energy-sweep.sh` | ABBA blocks + `taskset`, temperature gate `TEMP_GATE_DECI=300` (30.0 °C), `IDLE_SECONDS=60`, 30 % battery floor | per block | `idle-floor.csv`, `<tag>.csv`, report | sampler columns above | per-phase J, idle floor W, placement deltas | **current** (Jelly); the audited instrument |
| `APP/scripts/device-energy-trace.sh` | `cat /proc/uptime; echo ---; dumpsys battery` | ≥5 s, default 10 s | append-only CSV, schema `kalsa-app-energy-trace-v1` | `host_iso,t_s,charge_counter_uah,current_now_ua,current_avg_ua,voltage_uv,level_pct,batt_temp_deci_c,status_code,plugged,ok` | nothing (raw trace) | **current but never run** — it is the closest existing S23 instrument |

The frozen contract is `APP/docs/ENERGY-SCHEMA.md`. Key rules quoted from it:
the metric is **relative** ("between-arm deltas are meaningful and absolute
values are not"), the sampler CSV is **frozen**, and `j_decode` is a **lower
bound** (right-Riemann attribution).

## B.2 The campaign harnesses (`APP/scripts/campaign/`) — battery as a gate, not a series

| script | what it reads | rate | where it goes | columns / fields |
|---|---|---|---|---|
| `APP/scripts/campaign/run-t20c.sh` | `dumpsys battery` level/temp/plug | preflight only (line 192, 228–229) | log lines | `battery level=… temp=…C charging=…` |
| `APP/scripts/campaign/turn.sh` | `dumpsys battery` plug flags | per turn (`:8`) | log | charging gate |
| `APP/scripts/campaign/recovery.sh` | `dumpsys thermalservice` status + `dumpsys battery` temp | polled | hard-abort log | stop at unplugged status ≥3 or ≥44.0 °C (`:18-19`) |
| `APP/scripts/device-env.sh` | `dumpsys thermalservice` (anchored awk `:49-55`) and `dumpsys battery` (`:57-73`) | on call | shell strings | `device_thermal_status`, `device_battery_temp_deci`, `device_battery_level` |
| `APP/scripts/campaign/collector.mjs` | `--battery-dump` | post-hoc | report object | `charging` flag only |

**Consequence:** a T20C run records battery **level and temperature at preflight
and per turn**, plus a charging stop gate — it does **not** record a battery
series or any energy. Per-turn drain rates cannot be recovered from a T20C run.

## B.3 S23-specific lab artefacts (`LAB`)

| artefact | samples | output | columns | what it computes | status |
|---|---|---|---|---|---|
| `LAB/scripts/run_calaqwen_s23.sh` | `termux-battery-status` (Termux:API) | `flight/flight_1s.csv` | `ts_epoch,iso,batt_pct,current_uA,voltage_mV,temp_c,plugged,die_c,memfree_kb,phase` | `E = Σ (cur−I_idle)·V·dt` discharge-only, J/token | **stale/superseded**; needs Termux, and its idle-baseline choice was wrong once (`I_idle=-430000` inflated J/tok 83 %, fixed in `results/calaqwen_s23/fix/`) |
| `LAB/scratchpad/agents/q44-ngl-sweep-mem/xiaomi_energy_driver.sh` | `dumpsys battery` pre/post per rep | `energy/*_battery_pre.txt`, `energy_summary.txt` | `dQ_uAh, Vmean, E_J, tokens, J_per_token, dT_C, T, level, cc` | `E = (dQ/1e6)·V̄·3600` | **stale** (Xiaomi), but its charge-counter method is the S23-compatible one |
| `LAB/scratchpad/agents/q48-olmoe-q40-npu/` | `dumpsys battery` `Charge counter` per rep | `charge_*_pre/post.txt` + report | Δcc, J | same formula | **stale**; recorded the granularity failure |
| `LAB/scratchpad/agents/s23-plugged-baseline/raw/plugged_idle_reference.csv` | 25 samples, nominal 30 s | CSV | `sample,host_timestamp,device_epoch,level,status,ac/usb/wireless_powered,battery_temp_C,screen_state,zone*_mC` (all 95 zones) | plugged idle reference **T_idle = 27.8 °C** | **valid**; labelled plugged idle (AC 100 %) |
| `LAB/scratchpad/agents/s23-unplugged-baseline-night0/` | battery level/temp per run | RUN_LOG/ERRATA | — | S23 unplugged idle drain | **BLOCKED/ERRATA**; see §C |
| `LAB/scratchpad/agents/q56-thermal-watchdog/` | thermal guard log | `health`/`integrity` text | `cooldown_*, phase1_*, final_*, abort_temperature_tenths=380, abort_level_pct=45` | watchdog behaviour, not drain | **valid** |

`LAB/scratchpad/agents/energy-instrumentation/REPORT.md` is the sibling
inventory of the **app-side** producers and is the reference for anything
app-internal; this table is the host/script side.

**Named best practice, today:**

1. On the Jelly: `APP/scripts/device-energy-sweep.sh` feeding
   `energyPhaseSplit.mjs` (v3 stamped) — the audited instrument.
2. On the S23 from the shell: **`APP/scripts/device-energy-trace.sh`** is the only
   correct, read-only, framework-based trace (anchored parser, empty-not-zero,
   history-buffer guard). It has **never been run** (`find APP -name '*energy-trace*'`
   returns only the script).
3. For a future app-side series: the dormant `GovernorBatteryModule` sampler +
   `governorBatterySampler.ts` wrapper (missing a voltage column).

**Stale/superseded:** `energy-sample.sh` as an S23 instrument (no dumpsys
fallback; produced 603 empty-power rows in `APP/device-s23-out/run1/`);
`run_calaqwen_s23.sh` (Termux dependency, one calibration error);
the q44/q48 ΔQ formulas are correct but their devices and windows are not
reusable.

---

# C. The known blockers and their current status

## C.1 "S23 shell fuel-gauge reads come back permission-denied or empty"

**Verified, with one correction.** All `/sys/class/power_supply/battery/*` reads
are `Permission denied` for `uid=2000(shell)` (commands in §A.3); that is
kernel/SELinux denial, not an empty file. The correction: `dumpsys battery` and
`cmd battery get` **do** return `current now`, `current_average`, `Charge
counter`, `voltage`, `temperature` on this Android 16 build. The record
`APP/docs/S23-ENERGY-BLOCKER.md:23-24` ("`dumpsys battery` is not a substitute
for instantaneous current: it reports level, voltage and the powered flags") is
contradicted by that same document at `:28-32` and by the device today. What the
sysfs sampler produced (`APP/device-s23-out/run1/`, 603 rows, 0 with a non-empty
`current_uA`) is real, and was caused by `APP/scripts/energy-sample.sh:40-43`
having no dumpsys fallback — not by the platform lacking the data.

**What is still blocked** is instantaneous current *as a series*, not the values.

## C.2 "The high-rate energy A/B had a between-run spread of 2–7 %, not the 0.68 % first assumed"

**Verified from the lab record.** `APP/docs/ENERGY-FRAMEWORK-STATUS.md:72`:
"The between-run spread of the per-phase metric is **2–7 %**. A sequential A-then-B
design cannot distinguish effects below roughly **5–10 %** … **25.4 %** for
1.2B/REP once the nested run effect is included". `APP/docs/ENERGY-PERPHASE-FINDINGS.md:81`:
"Rep-to-rep spread inside 1.2B/REP is 1.6–5.0 % in today's three runs, against
the 0.68 % quoted before; the between-run spread across the campaign stems is
2.0–6.7 %". The retracted 0.68 % is at `APP/ENERGY-2B-SELF-AUDIT-2026-09-15.md:33,38`
and the campaign spread table at `APP/device-v3-out/CAMPAIGN-REPORT.md:195,211`.
`LAB/PLAN.md:2054` repeats the correction. **A run-order confound remains**:
"increasing the number of reps inside a sequential block does not remove the
run-order confound" (`ENERGY-PERPHASE-FINDINGS.md`).

## C.3 "Android ggml affinity controls were inert while external `taskset` worked"

**Split verdict.**

- External `taskset` **works** on this S23; verified today:
  ```
  $ adb shell 'taskset 3f sh -c "grep -m1 Cpus_allowed_list /proc/self/status"'
  Cpus_allowed_list:	0-5
  $ adb shell 'taskset c0 sh -c "grep -m1 Cpus_allowed_list /proc/self/status"'
  Cpus_allowed_list:	6-7
  $ adb shell 'sh -c "grep -m1 Cpus_allowed_list /proc/self/status"'
  Cpus_allowed_list:	0-7
  $ adb shell 'taskset 0x3f sh -c true'
  taskset: bad mask '0x3f'
  ```
- The ggml-inside control **was** a compiled no-op: `APP/archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md`
  (measured 2026-08-09) documents three proofs — an empirical one-thread
  discriminator on the Helio G99 (11.30 vs 11.38 tok/s on A55 vs A76, while
  `cpu_capacity` says 3×), a preprocessor one (`__gnu_linux__` is glibc, absent
  on Bionic), and a binary one (no `sched_setaffinity` in an arm64 `llama-bench`).
  It also records that the one-line guard fix buys **+26 % prefill**.
- **Update:** the **currently shipped** `librnllama.so` in the installed APK
  *does* reference the mechanism:
  ```
  $ nm -D librnllama.so | grep -iE "sched_setaffinity|pthread_setschedparam"
                   U sched_setaffinity@LIBC
                   U pthread_setschedparam@LIBC
  $ strings librnllama.so | grep -i affinity
  warn: failed to set affinity mask 0x%llx : %s (%d)
  ```
  and `ENGINE/ggml/src/ggml-cpu/ggml-cpu.c:2953` now reads
  `#elif defined(__linux__)` (not `__gnu_linux__`). So the "never compiled"
  mechanism no longer describes the installed build. Whether the control is
  *effective at runtime* on this S23 is **UNVERIFIED** — settling it needs the
  one-thread discriminator, i.e. a benchmark, which is out of scope.

## C.4 "`dumpsys thermalservice` is not a reliable throttling signal; the visible place is `scaling_max_freq`"

**Partially verified, and the lab's own file corrects the strong form.**
`APP/analysis/…` (the plan `LAB/analysis/GOVERNOR-DEVICE-PLAN.md:209-210`) says
`Thermal Status 0` in *every* archived sample while `cpu7` ran at
`1824000/3302400 = 55 %`, and `:702` states it as a rule. **But**
`LAB/analysis/GOVERNOR-DEVICE-PLAN.md:894-897` is a correction: the
archive-wide "every sample" version does not reproduce (only the Xiaomi-only
version survives), and `:520` records an S23 `Thermal Status 3` within 9 minutes
of a loaded run. So `thermalservice` **does** move on a hot device; what it does
not do is move *early or proportionally*. On this idle S23 today it reads
`Thermal Status: 0` with `scaling_max_freq == cpuinfo_max_freq` on all three
policies (not throttled). The throttled-state comparison was **not** re-verified
(inducing it means heating the phone — forbidden). Conclusion the artefacts
support: **record `scaling_max_freq` per cluster and use thermalservice as a
severity index, not as the throttle measurement.**

## C.5 "The S23 has DSP daemons (`adsprpcd`) burning about a full core continuously"

**Verified in direction, refuted in magnitude.** Measured on this S23:

```
$ adb shell 'cat /proc/uptime'                          -> 209422.35
$ adb shell 'awk "{print \$14+\$15}" /proc/2251/stat'    -> 7586623   (adsprpcd)
7586623 jiffies / 100 = 75866 s CPU / 209422 s uptime    = 36.2 % of one core
```

Short windows gave 51 % (5 s), 37 % (15.45 s) and 26 % (40.76 s) of one core for
`adsprpcd`; `cdsprpcd`/`sscrpcd`/`audioadsprpcd` together contribute ≲1 %. So:
**a third to a half of one core, continuously, averaged over the boot** — not a
full core. This matches the lab's own naming of it as "a contaminant to subtract
from every S23 number" (`LAB/analysis/GOVERNOR-DEVICE-PLAN.md:513,716`), a claim
the plan audit (`:994,1016,1034`) notes was never instrumented. Note the plan
line quotes "33 h CPU" — the device has only been up 58 h here, so the daemon's
age is a per-session fact.

## C.6 Practical consequence: what is measurable today, with what precision

| quantity | can it be measured without root? | precision / how |
|---|---|---|
| drain rate in **%/hour** | **yes** | over ≥30–60 min, or one level step; the 1 % step is 26 250–67 500 µAh (§D.2), so resolution is ~1 % of pack |
| average **current** (mA) | **yes** | `dumpsys battery` `current_avg`; noise ±10–20 %, unit disputed |
| **energy** (J) | **yes, coarse** | `ΔQ·V̄` over ≥1 counter step (~26 000–67 500 µAh ≈ 100–250 J); not for short cells |
| **power** (W) at ≥1 Hz | **no** | no sysfs; the framework broadcast is ~10 min idle |
| **J per token / per phase** on S23 | **no** | needs the app-side 1 Hz sampler **with voltage**, which does not ship |
| temperature series | **yes, 1 Hz** | `/sys/class/thermal/thermal_zone*/temp` |
| throttle state | **yes** | `scaling_max_freq` per policy + `dumpsys thermalservice` severity |
| wakelocks | **yes** | `dumpsys batterystats` counters, per-UID |
| per-UID estimated mAh | yes, but **modelled** | `dumpsys batterystats` (not measurement) |
| rail energy (nWh) | **not verified** | Perfetto `android.power` / `powerstats` empty for shell |

---

# D. Confounders and controls

Everything below moves a discharge number on this phone. "Control" = can be held
constant; "record" = can only be observed and must be reported; "cannot" = neither.

| confounder | how it moves the number | control / record | can it be held constant? |
|---|---|---|---|
| **Charging (incl. ADB cable)** | charges the cell while "measuring" — invalidates everything | project rule "never benchmark while charging" (`APP/docs/ENERGY-FRAMEWORK-STATUS.md`); preflight gate reads `AC/USB/Wireless powered` (`APP/scripts/campaign/run-t20c.sh:143-190`) and re-checks mid-run; record plug state per sample | **control** — and note this S23's adb is **wireless**, so a run needs no cable at all |
| **Cable as an ADB transport** | a USB cable would charge; `adb bugreport` would also write to the device | `adb-tls-connect` / `adb tcpip`; record the transport used | **control** |
| **Screen brightness** | direct display power; `screen.on=73.9 mA` in the power profile, `screen.full=202.6` | record `settings get system screen_brightness` and `dumpsys display` state; `APP` keeps the phone awake with a screen timeout during arms | **record**; constant brightness on a phone is possible only by leaving it untouched |
| **Refresh rate** | the **app itself** pins the window to the panel's highest rate (`APP/plugins/withDisplayRefreshRate.js:28-43`, S23 supports 120 Hz) — reading/typing at 120 Hz costs more than at 60 | record `dumpsys display` `mActiveSfDisplayMode` / `mDisplayModeSpecs` | **record**; the app makes it 120 Hz whenever it is foregrounded |
| **Radio / Wi-Fi** | `wifi.controller.*`, `radio.active=177 mA`; the TLS adb link keeps Wi-Fi active | record `settings get global wifi_on`, wakelock counters `WifiSuspend`, `qcom_rx_wakelock`; `dumpsys wifi` state | **cannot** if the run is driven over wireless adb (which this S23 requires) |
| **Ambient temperature** | sets the thermal starting point and the cooling rate | no in-phone sensor for ambient; record the room, and record `AP`/`BAT`/`SKIN` at start | **cannot** — must be recorded |
| **Thermal step reached** | decode time +26–52 % cold→warm while J/token moves only −6…+7 % (`ENERGY-FRAMEWORK-STATUS.md`) | temperature gate before each block (`TEMP_GATE_DECI=300`, `device-energy-sweep.sh:44`), per-arm start/end temp, per-session idle floor, ABBA ordering | **partial control** (gate + ordering); the step itself is recorded |
| **Background apps / OS services** | `system_server`, GMS, Samsung jobs, sensors | record: `dumpsys batterystats` wakelocks/wakeups, `dumpsys deviceidle`, per-UID mAh; cannot freeze them without changing settings | **cannot** |
| **DSP daemons (`adsprpcd` etc.)** | 26–51 % of one core continuously (§C.5), heat + CPU | record `/proc/<pid>/stat` deltas; there is no un-rooted way to stop them | **cannot** — must be recorded/subtracted |
| **Battery state of charge (gauge non-linearity)** | the % level is not a linear charge measure; measured on this S23, Δcc per 1 % ranged **26 250–67 500 µAh** (below) | prefer **ΔQ (µAh)** over **%**; record the SoC window | **cannot** hold linearity; control the *window* (e.g. 30–80 %) and report it |
| **Doze / screen off** | a `Dozing`/`Asleep` block is a different power state | `dumpsys power mWakefulness`; `device-energy-sweep.sh` aborts a dozed block | **partial** — keep the device awake and verify it |
| **CPU affinity / thread count** | changes where the work runs; `taskset` works, ggml-internal affinity status is uncertain (§C.3) | record the exact command line and `taskset` mask; never label an arm "on the big cores" without the discriminator | **control** (external `taskset`) |
| **App foreground/background** | backgrounded apps are frozen; `expo-battery` polls only while active (`APP/src/hooks/useBatteryEta.ts:236-250`) | record `dumpsys power`/AppState; keep the app foreground | **control** |

**Measured non-linearity evidence** (`dumpsys battery` `[BattActionChangedLogBuffer]`,
parsed on this device — `Δcc` per 1 % level step):

```
level 26->25 dcc=37500   level 25->24 dcc=33750   level 24->23 dcc=67500
level 23->22 dcc=33750   level 22->21 dcc=37500   level 21->20 dcc=33750
level 20->19 dcc=33750   level 19->18 dcc=37500   level 18->17 dcc=30000
level 17->16 dcc=45000   level 16->16 dcc=30000   level 16->15 dcc=3750
level 15->14 dcc=45000   level 14->13 dcc=37500   level 13->12 dcc=26250
level 12->11 dcc=33750
```

Same level step, half the charge or double the charge depending on where you are.
**This is why a `% / hour` number is a rough instrument and `ΔQ` is the honest
one.**

**Which confounders cannot be held constant and must be measured instead:** ambient
temperature, the radio/Wi-Fi that carries the adb link itself, background OS
services, the DSP daemons, and the battery's own non-linearity. On a phone that is
also the test device, all five are irreducible; the protocol has to *record* them,
not eliminate them.

---

# E. A defensible discharge protocol (measurement design only)

The lab already has measurement rules; this section reuses them rather than
inventing a convention. Quoted rules:
`APP/docs/ENERGY-FRAMEWORK-STATUS.md` ("never benchmark while charging";
"between-run spread 2–7 %; sequential A-then-B cannot distinguish below 5–10 %";
"ABBA interleaving inside a thermally stable window, a temperature gate, and a
per-session idle floor"; "absolute joules are session-relative") and
`APP/docs/ENERGY-SCHEMA.md` ("the metric is RELATIVE"; the sampler CSV is frozen;
`j_decode` is a lower bound).

## E.1 The metric and its unit — pick the honest one

| candidate | honest on the S23? | why |
|---|---|---|
| **drain rate in %/hour** | **yes**, for a session-level statement | supported by `dumpsys battery` level + the `+`/`-` history; resolution ≈1 % of pack; use only over ≥30–60 min |
| **average current (mA)** | yes, with a stated uncertainty | `current_avg` is stable but noisy, and its unit is device-disputed (§C.3) — calibrate against Δcc first |
| **energy per turn / per token (J, mWh)** | **not on the S23 from the shell** | needs ≤1 % counter steps over short windows; unavailable. Only Jelly-class devices with readable sysfs can do this today |
| **ΔQ · V̄ (J) over a block** | yes, for blocks ≥1 counter step | the only S23-compatible energy number; must state the step size and the V̄ definition |
| **`dumpsys batterystats` mAh** | **never as measurement** | it is a model estimate |

**Recommendation:** the primary endpoint for the S23 is a **drain rate (%/hour)**,
with a secondary **block energy (J) from ΔQ·V̄** over windows that cross at
least one counter step. Per-turn and per-token joules are explicitly **out of
scope for the S23 until the app-side voltage sampler exists**.

## E.2 Sampling interval the sources support

- `/sys/class/thermal/thermal_zone*/temp`: **1 Hz** (readable, cheap).
- `scaling_max_freq`: 30–60 s (read it *outside* a turn; the plan rule is
  "not during a turn" — `LAB/analysis/GOVERNOR-DEVICE-PLAN.md`).
- `dumpsys battery` / `cmd battery get -f`: poll at 5–10 s but expect values to
  change only on the framework's own cadence (30–90 s loaded, ~10 min idle).
  `APP/scripts/device-energy-trace.sh` already refuses <5 s for this reason
  (`:57-58`).
- `dumpsys batterystats` / `--wakeups`: at block boundaries (the dump is ~90 k
  lines; do not poll it per second).
- The **app** sampler (`GovernorBatteryModule`) floor is 200 ms
  (`APP/native/GovernorBatteryModule.kt:302`), but its own comment argues ≥1 s
  adds nothing because the gauge smooths over ~1 s.

## E.3 Duration and state-of-charge window

- **Duration:** long enough to cross ≥1 charge-counter step. Measured step sizes
  on this device: 26 250–67 500 µAh per 1 % (mostly 33 750/37 500). At ~200 mAh
  idle, one step is ~10 min; give a block **≥30 min** so the number is not
  dominated by one quantum, or state the quantum explicitly.
- **SoC window:** use a **mid-SoC window** (roughly 30–80 %) and record it;
  avoid the ends where the gauge is least linear. The project's floors: the
  generic sweep floor is 30 % (`APP/scripts/device-energy-sweep.sh:157`); T20C's
  own floor is 8 % with an 85 % preflight start
  (`APP/scripts/campaign/run-t20c.sh:111-112`). Choose per experiment and write
  it down.
- **Doze:** keep the device awake and **verify** `mWakefulness=Awake` at both
  ends; a dozed block is uninterpretable (this is what voided the core-placement
  pilot).

## E.4 Interleaving to cancel drift

- **ABBA** inside one thermally stable window; the sweep instrument already does
  this (`APP/scripts/device-energy-sweep.sh:10-15`).
- **Temperature gate** before each arm (`TEMP_GATE_DECI=300` = 30.0 °C default).
- **Per-session idle floor**: a 60 s screen-awake idle sample
  (`IDLE_SECONDS=60`) recorded beside the arms, subtracted or reported.
- **Session-relative only:** never compare absolute J across sessions.
- **Same-boot:** device uptime `t_s` is monotonic per boot; a reboot voids a
  merged series.

## E.5 Repetitions and how to state the spread

- n≥3 per arm, and state the **between-run spread** (the lab's own metric is
  2–7 %), not a standard error. Report min/max or the three values; the campaign
  report does exactly this (`APP/device-v3-out/CAMPAIGN-REPORT.md:211`).
- State the **minimum detectable effect** implied by the design: ~5–10 % for a
  sequential A-then-B, and 25.4 % for the 1.2B/REP sequential case
  (`ENERGY-PERPHASE-FINDINGS.md`).
- Do not average over a thermal drift; report the drift (the v3 sidecars have
  `cadence_*` and coverage columns for exactly this honesty).

## E.6 What to record alongside every cell

temperature series (1 Hz, zones + battery + HAL skin), thermal status,
`scaling_max_freq` per policy, screen state + brightness + active display mode,
wakelock/wakeup counters, plug state, per-UID mAh, the sampler cadence
median/max, `adsprpcd` CPU delta, and the exact command line. The frozen schema
already carries `t_s,current_uA,voltage_uV,batt_temp_deciC,status,cpu_freqs_kHz`;
the extra fields go in the cell metadata, as `device-energy-sweep.sh` does.

## E.7 What could NOT be proven even with a perfect protocol

1. **A per-token energy claim on the S23** — the framework's 1 Hz current series
   does not exist shell-side; the counter is too coarse.
2. **A causal claim about the app alone** — `adsprpcd` and the OS services move
   the same battery and cannot be frozen; only an app-vs-not-app delta with the
   foreign load measured can be claimed.
3. **Absolute joules** — the lab's own rule: absolute values are not meaningful
   because display/radio floors dilute J; only within-session deltas/ratios.
4. **A sub-5 % effect with a sequential design** — the run-order confound is not
   removable by adding reps inside one block.
5. **Anything while charging** — the project rule makes it a non-measurement.

---

# F. The app's own contribution to its own drain

## F.1 What the app can measure about itself today

| surface | what it reads | rate | status |
|---|---|---|---|
| `GovernorBatteryModule.readThermo` (`APP/native/GovernorBatteryModule.kt:41-71`) | sticky `ACTION_BATTERY_CHANGED`: temperature, level, plugged, sensor-valid | only when the app asks; the value changes at OS broadcast cadence | **live, wired** (governor `thermo`) |
| `GovernorBatteryModule.readSoc` (`:74-84`) | `Build.SOC_MODEL` | once | **live** |
| `GovernorBatteryModule.readHighRate` (`:86-93`, values at `:164-167`) | `BATTERY_PROPERTY_CURRENT_NOW`, `BATTERY_PROPERTY_CHARGE_COUNTER` | on call | **shipped, no caller** |
| `GovernorBatteryModule.startSampling` (`:96-139`) | the two properties into a CSV, floor 200 ms | caller-set | **shipped, no caller**; schema `t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,current_status,charge_counter_status` (`:312-314`) — **no voltage** |
| `APP/src/engine/governorBatterySampler.ts:14,23,35` | JS wrappers for the above | — | **exported, imported nowhere** |
| `expo-battery` in `APP/src/hooks/useBatteryEta.ts` | level + charging state | 60 s, foreground only (`:236-250`) | **live** |
| `APP/src/hooks/useThermalMonitor.ts:117` | `/sys/class/thermal/thermal_zone0/temp` | 30 s | **live but wrong sensor**: zone0 is `aoss-0` on the S23, not skin/battery |
| `KalsaThermalModule` (`APP/modules/kalsa-thermal/…:46,79`) | `PowerManager.getCurrentThermalStatus()` | event + foreground query | **live**; `readToHardGate` discards everything below `CRITICAL` (=4) |
| `expo-keep-awake` (`APP/src/app/AppShell.tsx:52,4734,5078`) | keeps the device awake | during model download only | **live** |
| telemetry (`APP/src/telemetry/telemetry.ts`) | crash/error allowlist | opt-in, default off (`:1-6`) | **live**; carries **no** battery/thermal field |

**Verification of "shipped but dead":** the installed APK contains the module and
its schema —

```
$ unzip -p base.apk '*.dex' | strings | grep -E "GovernorBatteryPackage|kalsa-governor-battery-trace|current_uA|startSampling"
   ... Lcom/kalsa/app/GovernorBatteryModule$HighRateRead; ...
   ... Lcom/kalsa/app/GovernorBatteryPackage; ...
   i# schema=kalsa-governor-battery-trace-v1; ...
   ht_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,current_status,charge_counter_status
   startSampling
   readHighRate
```

but the **Hermes bundle has no call site** for the sampler entry points (the
bundle contains `GovernorBattery` once, from `deviceProfile`, and
`startGovernorBatterySampling` / `readGovernorBatteryHighRate` have **no import
site in `APP/src` or `APP.tsx`**). So the app currently cannot measure its own
drain at high rate; it can only read a sticky temperature/level snapshot and a
60 s level poll.

**Wakelocks the app holds:** it declares `android.permission.WAKE_LOCK` (granted)
and uses `expo-keep-awake` only during model download; on this device it has no
foreground service (`app.config.js:35` declares only `RECORD_AUDIO` and
`READ_CALENDAR`; no `FOREGROUND_SERVICE` permission, no `Service` class). While
backgrounded, the app can be frozen, so a screen-off run cannot rely on the app
sampler as shipped.

**One app-caused confounder worth naming:** `withDisplayRefreshRate`
(`APP/plugins/withDisplayRefreshRate.js:28-43`, wired at `app.config.js:74`) sets
the window to the panel's highest refresh rate — 120 Hz on this S23 — so the app
in the foreground changes the display's own discharge contribution relative to a
backgrounded phone.

## F.2 What it must not do (project privacy rule)

The rule is: no content and no keys leave the device, and telemetry is opt-in
(`APP/src/telemetry/telemetry.ts:1-6`: "Default OFF … Allowlist-only reports — no
chat, docs, keys, stacks, URLs, paths"). No battery or thermal field exists in
the telemetry schema, so no drain datum leaves the device today. Any battery
telemetry added later must honour the same rule and remain opt-in; on-device
battery data has privacy weight even without chat content.

## F.3 What must live in a bench build, not a shipped one

| measurement | why bench-only |
|---|---|
| high-rate sampler with a **voltage column** + `thermal_status` | it is diagnostic instrumentation; the shipped schema has no voltage and starting it in production would add an always-on file writer |
| per-turn / per-phase energy read-out | needs a host-side join with `KALSA_TELEMETRY`/`KALSA_GOVERNOR` logcat and phase marks; a CLI env var the app cannot set |
| a foreground/service-backed sampler for screen-off cells | adds a permanent notification (`FOREGROUND_SERVICE` permission + Service) — a product decision, not a diagnostic |
| `getThermalHeadroom` exposure and a SEVERE-handover hook | changes runtime behaviour for real users |
| the `t_idle` / `plugged` reference (defect 5.2) | changes the governor's validity rule; correctness work, not instrumentation |

---

# Command table — every command, its availability, and what it returns

(`S23` = `adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`.)

| command | availability | returns | measures |
|---|---|---|---|
| `adb devices -l` | yes | Jelly `192.168.1.82:5555`, S23 `adb-R3CW406P8CV…` | — |
| `S23 shell getprop ro.product.model / ro.build.version.sdk / ro.soc.model` | yes | `SM-S911U` / `36` / `SM8550` | identity |
| `S23 shell id` | yes | `uid=2000(shell) … context=u:r:shell:s0` | permission context |
| `S23 shell dumpsys battery` | yes, no root | level, scale, voltage (mV), temperature (0.1 °C), Charge counter (µAh), current now, status, plug flags, `[BattActionChangedLogBuffer]` | measured current/charge/voltage/temp |
| `S23 shell 'dumpsys battery \| sed -n "/BattActionChangedLogBuffer/,/mBatteryChangedConditionCounts/p"'` | yes | timestamped `level/voltage/temperature/current_avg/cc` per broadcast | measured series at broadcast cadence |
| `S23 shell cmd battery -h` | yes | key list `ac\|usb\|wireless\|dock\|status\|level\|temp\|present\|counter\|invalid\|current_now\|current_average` | — |
| `S23 shell cmd battery get [-f] <key>` | yes | single value | measured current/charge/temp/level |
| `S23 shell 'cat /sys/class/power_supply/battery/<node>'` | **Permission denied** for all content nodes | — | — |
| `S23 shell 'ls /sys/class/power_supply/'` | yes (listing only) | 12 supply symlinks | topology |
| `S23 shell 'ls /sys/class/power_supply/max77705-fuelgauge/'` | yes | `device fg_data online power subsystem type uevent wakeup56` (readable listing, `fg_data` denied) | topology |
| `S23 shell dumpsys batterystats` | yes, no root | power table (mAh estimate), per-UID, wakelocks, `+`/`-` history | estimate + measured events |
| `S23 shell 'dumpsys batterystats -c'` | yes | 90 556 checkin lines, e.g. `9,10347,l,pwi,uid,755,1,85.1,0` | machine-readable estimate |
| `S23 exec-out 'dumpsys batterystats --proto'` | yes | 120 343 bytes protobuf | machine-readable estimate/events |
| `S23 shell 'dumpsys batterystats --power-profile'` | yes | `battery.capacity=3785`, `cpu.*` coefficients | the estimate's calibration |
| `S23 shell 'dumpsys batterystats --wakeups'` | yes | per-UID wakeup attribution, alarm/Wi-Fi subsystems | wakelocks |
| `S23 shell dumpsys thermalservice` | yes | `Thermal Status: 0`, HAL temperatures AP/BAT/PA/SKIN/USB | temperature + severity |
| `S23 shell 'for z in /sys/class/thermal/thermal_zone*; do …'` | **yes, readable** | 74+ `type temp` pairs in m°C | temperature |
| `S23 shell 'cat /sys/devices/system/cpu/cpufreq/policy*/scaling_max_freq'` | yes | 2016000 / 2803200 / 3360000 (== hw max now) | throttle cap |
| `S23 shell dumpsys deviceidle` | yes | `mState=IDLE mLightState=OVERRIDE mScreenOn=false mCharging=false` + timing table | doze state |
| `S23 shell dumpsys power` | yes | `mWakefulness=Dozing`, `Wake Locks: size=1 DOZE_WAKE_LOCK` | power/wakelock state |
| `S23 shell 'dumpsys display'` | yes | `Display State=OFF`, `mActiveSfDisplayMode … peakRefreshRate=60.0`, supported 10–120 Hz | refresh rate |
| `S23 shell 'settings get system screen_brightness'` | yes | `0` (screen off) | brightness |
| `S23 shell 'settings get global wifi_on / bluetooth_on / mobile_data'` | yes | `1 / 1 / 1` | radios |
| `S23 shell 'top -b -n 1 -o -%CPU'` | yes, but the first batch is unreliable | mostly 0.0 — **do not trust** | — |
| `S23 shell 'awk "{print \$14+\$15}" /proc/<pid>/stat'` | yes | CPU jiffies; the honest per-process measure | foreign CPU load |
| `S23 shell 'taskset 3f sh -c "grep Cpus_allowed_list /proc/self/status"'` | yes | `Cpus_allowed_list: 0-5` | affinity works externally |
| `S23 shell 'atrace --list_categories'` | yes (listing) | `power`, `freq`, `thermal`, `idle`, … no battery category | trace capability |
| `S23 shell 'perfetto --query'` | yes | data sources incl. `android.power`, `linux.sysfs_power` | rail counters (unverified) |
| `S23 shell 'dumpsys powerstats'` | yes but **empty** (rc 0) | — | rails not exposed to shell |
| `S23 shell 'dumpsys batteryproperties'` | yes but **empty** (rc 0) | — | — |
| `S23 shell 'which bugreport dumpstate'` | yes | `/system/bin/bugreport`, `/system/bin/dumpstate` | Battery Historian input (not run: writes to device) |
| `nm -D librnllama.so \| grep sched_setaffinity` | host, on the pulled APK | `U sched_setaffinity@LIBC` | affinity compiled in the shipped engine |
| `unzip -p base.apk '*.dex' \| strings \| grep GovernorBattery` | host | 19 hits incl. schema header | module ships |
| `unzip -p base.apk assets/index.android.bundle \| grep -a GovernorBattery` | host | 1 hit; no sampler call site | sampler is dead code |

---

# What could NOT be verified, and what would settle it

| unverified | why | what settles it |
|---|---|---|
| the loaded-run `ACTION_BATTERY_CHANGED` cadence on the S23 (30–90 s per docs) | only idle evidence here (~10–11 min) | one logged run reading broadcast timestamps while the engine decodes |
| the unit of `current_now` / `current_average` on this S23 (µA per AOSP vs mA-like) | I could only bracket against a coarse counter; the lab's own records agree on mA-like but disagree on the step size | an app-side 10-min window reading both properties at 1 Hz and integrating against Δcc with ≥5 counter steps |
| whether the counter's smallest step is 3 750 µAh (LAB `q48…REPORT.md:118`) or ~33 750 µAh (sibling report §C.3; my own Δcc table: 26 250–67 500 per 1 %) | the two lab records conflict; my probe saw **no** sub-33 750 tick in 238 s | a long ΔQ bracket with `cmd battery get -f counter` every 10 s until ≥3 ticks are observed |
| whether Perfetto `android.power` yields real rail **energy** counters on this S23 | starting a trace writes to tracefs (forbidden) and `dumpsys powerstats` is empty for shell | one authorised Perfetto session with the `android.power` data source, or a root read |
| whether Battery Historian ingests `dumpsys batterystats --proto` directly | no copy of Battery Historian in either repo; not run | run it once against the 120 343-byte protobuf |
| whether the shipped engine's affinity control is *effective at runtime* on the S23 | needs the one-thread discriminator (a benchmark) | the `APP/archived/docs/ANDROID_CPU_AFFINITY_IS_A_NOOP.md` discriminator run on this device, shipped build |
| the throttled-state behaviour of `dumpsys thermalservice` on the S23 | inducing it heats the phone (forbidden) | one authorised loaded run logging `Thermal Status` and `scaling_max_freq` together |
| the exact ambient temperature during any cell | no ambient sensor path | a room thermometer, recorded beside the cell |
| the S23's `adsprpcd` load during a *loaded* cell | only idle windows here | `/proc/2251/stat` deltas bracketing a cell |
| whether the app's `GovernorBatteryModule` behaves as the source (CSV header, thread) | I checked strings, not behaviour | one debug run of `startSampling` and a diff of the produced header against `APP/native/GovernorBatteryModule.kt:312-314` |
| the current value of `kalsa.governor.enabled` / `kalsa.bench.thermo` on the device | they live in `databases/RKStorage`, which the repo classifies as private chat data | a coordinated single-key read, never a bulk pull |

---

## Appendix — raw commands run for the headline numbers

```
# identity
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell 'getprop ro.product.model; getprop ro.build.version.sdk; getprop ro.soc.model'
# -> SM-S911U / 36 / SM8550

# charge-counter granularity (held constant for 238 s at ~200 mA)
for i in 1..7: uptime / cmd battery get -f counter / current_now / current_average
# -> 210035.33 435000 -85 -227 ... 210273.11 435000 -268 -230

# adsprpcd CPU since boot
cat /proc/uptime                         -> 209422.35
awk '{print $14+$15}' /proc/2251/stat    -> 7586623   (= 75 866 s / 209 422 s = 36.2 %)

# external affinity
taskset 3f sh -c 'grep -m1 Cpus_allowed_list /proc/self/status'  -> 0-5
taskset c0 sh -c 'grep -m1 Cpus_allowed_list /proc/self/status'  -> 6-7

# shipped engine affinity symbol
nm -D librnllama.so | grep sched_setaffinity -> U sched_setaffinity@LIBC
```

*End of report.*
