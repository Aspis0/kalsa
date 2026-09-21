# Energy / consumption / thermal measurement and control surface — as it exists today

Reconnaissance date: 2026-09-21. Read-only. One file written (this one).

**Path convention used below** (every citation is `repo/path:line`):

| alias | tree | revision at read time |
|---|---|---|
| `APP` | `/Users/marco/.paseo/worktrees/1vffp1wo/qwen-repack-policy` (`Aspis0/kalsa`) | branch `qwen-repack-policy`, HEAD `fc3627d` |
| `ENGINE` | `~/Projects/kalsallama` (`Aspis0/kalsallama`) | branch `b11010-merge`; the cited lines are byte-identical on `main` (verified with `git show main:...`) |
| `BINDING` | `~/Projects/llama.rn-kalsa` (`Aspis0/llama.rn`) | branch `vendor-migration`, HEAD `0f313bab` |
| `LAB` | `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck` (`Aspis0/kalsa-moe-experiments`) | branch `main` |
| `PLAN` | `LAB/analysis/GOVERNOR-DEVICE-PLAN.md` | 743 lines |
| `AOSP` | `android.googlesource.com/platform/frameworks/base`, `refs/heads/main`, fetched 2026-09-21 into `/tmp` | line numbers drift with upstream; every AOSP claim also carries the URL |

Device under test: `SM-S911U`, adb serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`,
`ro.build.version.sdk=36`, fingerprint `samsung/dm1qsqw/dm1q:16/BP2A.250605.031.A3/S911USQS6EYL1:user/release-keys`,
board `kalama`, `ro.soc.model=SM8550`. Installed app: `com.kalsa.app`, versionCode `1`, versionName
`0.1.0`, `lastUpdateTime=2026-09-20 21:52:10`, pulled APK sha256
`245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`.

---

## Answer first

**What exists.** There are five independent read paths in the app, and they do not know about each
other. Two are live in the shipped APK and reach a consumer: the sticky-broadcast thermometer
(`GovernorBatteryModule.readThermo` → `readGovernorThermo` → governor `thermo` +
`setGovernorThermo`) and the SoC probe (`GovernorBatteryModule.readSoc` → `deviceProfile` →
`generationFor`). One is compiled into the APK but **dead**: the high-rate fuel-gauge sampler
(`GovernorBatteryModule.startSampling` / `readHighRate`) has no JS caller and its method names are
absent from the shipped Hermes bundle. Two are UI-advisory only and never reach the governor:
`expo-battery` level/state polling in `useBatteryEta`, and `powersysfs thermal_zone0` polling in
`useThermalMonitor`.

**What is missing.**

1. **Voltage.** The app reads battery current and charge counter natively
   (`APP/native/GovernorBatteryModule.kt:165-166`) but never reads voltage. Without voltage there is
   no joule, in any unit convention.
2. **A caller.** `readGovernorBatteryHighRate`, `startGovernorBatterySampling`,
   `stopGovernorBatterySampling` exist (`APP/src/engine/governorBatterySampler.ts:14,23,35`) and are
   imported nowhere in the app. The shipped bundle proves it: `GovernorBattery` appears once,
   `readThermo` once, but `startSampling`, `stopSampling`, `readHighRate` appear **0 times**.
3. **`t_idle`.** Nothing in the app or the device provides a plugged idle reference, which is what
   turns `plugged=true` into `Abort` (defect 5.2, reproduced in §D).
4. **The handover signal.** Android `SEVERE` (=3) already arrives in JS on
   `KalsaThermalModule`'s listener and is discarded by one comparison (`>= 4`).
5. **Any energy metric.** Joules and J/token are computed host-side by scripts from a 1 Hz CSV that
   only the shell sampler produces. Nothing in the app or the engine computes or stores energy.

**Minimal change to measure energy app-side.** One native edit and one JS edit in the app, plus one
independent three-line governor fix. (a) Add `BatteryManager.EXTRA_VOLTAGE` (and `EXTRA_STATUS`) to
the existing `sampleRow` columns in `APP/native/GovernorBatteryModule.kt:237-255` — the writer,
the thread, the min-interval guard and the schema header already exist and already ship. (b) Call
the existing `startGovernorBatterySampling(path, 1000)` (`APP/src/engine/governorBatterySampler.ts:23`)
from one place in the turn path and stop it after the last turn; nothing else needs building. (c)
Fix 5.2 by sending a real `t_idle_c`/`t_idle_valid`, or by dropping the `plugged` branch of
`profile_is_valid`. The first two give an app-side `(t, current, charge_counter, voltage)` series
for the A/B read-out; they do **not** by themselves give J/token, because token counts live in
`KALSA_TELEMETRY` and the join has to be done host-side (§B, §F).

**Correction to the record that motivated this work.** The premise "S23 shell fuel-gauge reads come
back permission-denied or empty" is half stale on today's build. `/sys/class/power_supply/battery/*`
is still `Permission denied` for `uid=2000(shell)` (verified for `current_now`, `voltage_now`,
`temp`, `status`, `capacity`, `charge_counter`, `current_avg`, `charge_full`), but
`dumpsys battery` on this Android 16 build **does** print `Charge counter: 693750`, `voltage: 3695`,
`temperature: 282`, `current now: -121`, and `cmd battery get` returns
`counter=693750`, `current_average=-101`, `temp=282`, `level=18`, `status=3`. The empty-columns
record (`APP/device-s23-out/run1/*.csv`, 603 data rows, 0 with a non-empty `current_uA`) is real but
was produced by the sysfs sampler `APP/scripts/energy-sample.sh:26,40-43`, which has no dumpsys
fallback. `APP/docs/S23-ENERGY-BLOCKER.md:23-24` ("dumpsys battery is not a substitute for
instantaneous current: it reports level, voltage and the powered flags") is contradicted by the same
document at `:28-32` and by the device itself today.

---

## A. What exists today, datum by datum

### A.1 The app's native module (`APP/native/GovernorBatteryModule.kt`, 324 lines)

Registered as `com.kalsa.app.GovernorBatteryPackage` in `MainApplication`
(`APP/plugins/withGovernorBattery.js:40-56`, plugin wired at `APP/app.config.js:101`; confirmed in
the installed build: `GovernorBatteryModule` and `GovernorBatteryPackage` are present in
`classes19.dex`, plus `GovernorBatteryPackage` referenced from `MainApplication`).

| datum | API | rate | unit | where it goes | wired? | background? |
|---|---|---|---|---|---|---|
| battery temperature | `intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)` `APP/native/GovernorBatteryModule.kt:57` | **the OS broadcast cadence** — `registerReceiver(null, …)` registers nothing (`AOSP core/java/android/content/Context.java:3303-3307`) so this returns the last sticky intent | 0.1 °C | governor `thermo.batt_temp_tenths_c` | **yes** | yes, while the process lives |
| battery level | `EXTRA_LEVEL`/`EXTRA_SCALE`, `:59-61` | same | % (0-100, `:61`) | governor `thermo.batt_level_pct` | **yes** | yes |
| plugged | `EXTRA_PLUGGED != 0`, `:62,65` | same | bool | governor `thermo.plugged` | **yes** | yes |
| sensor validity | `EXTRA_PRESENT && temperature > 0`, `:58,66` | same | bool | governor `thermo.sensor_valid` | **yes** | yes |
| voltage | — | — | — | — | **absent** | — |
| SoC model | `Build.SOC_MODEL`, `:84-86` | once per `DeviceProfile` build | string | `generationFor()` | **yes** | n/a |
| instantaneous current | `BatteryManager.BATTERY_PROPERTY_CURRENT_NOW`, `:165` | on call only | µA per AOSP, **mA-like on this S23** (§C) | return value of `readHighRate` | **no caller** | n/a |
| charge counter | `BatteryManager.BATTERY_PROPERTY_CHARGE_COUNTER`, `:166` | on call only | µAh | return value of `readHighRate` | **no caller** | n/a |
| current + charge counter at 200 ms-… | `startSampling(outputPath, intervalMs)`, `:96-139`, loop `:201-235` | caller-set, floor `MIN_SAMPLE_INTERVAL_MS = 200` `:302`; comment at `:206-207` argues ≥1 s adds nothing | CSV: `t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,current_status,charge_counter_status` `:312-314` | a host-supplied file path, appended, flushed per row `:230-232` | **no caller** | survives Activity pause (own `HandlerThread`, `:85-92`); not a foreground service, so it dies with the process and is frozen while cached |
| unsupported-property mapping | `getIntProperty` → `Int.MIN_VALUE` → `"unsupported"` `:178-184` | — | — | status string in the CSV | code path live, unreachable | — |

The sampler's own API is exposed to JS but unimported: `APP/src/engine/governorBatterySampler.ts:14,23,35`.
`grep -a` over the shipped `assets/index.android.bundle` gives `GovernorBattery` 1, `readThermo` 1,
`readSoc` 1, `t_idle_valid` 1, and `startSampling` / `stopSampling` / `readHighRate` **0**. No trace
file exists on the device either: `run-as com.kalsa.app ls -la files` shows only
`BridgelessReactNativeDevBundle.js`, `kalsa-notes/`, `models/`, `sessions/`.

### A.2 The governor contract (live path)

`readGovernorThermo()` `APP/src/engine/governorInputs.ts:179-205` prefers an AsyncStorage bench value
(`kalsa.bench.thermo`, key at `:11`) and otherwise calls `GovernorBattery.readThermo`. It normalises
with `profileFrom` `:158-177`, which does the two things that matter here: it reads only
`batt_temp_tenths_c`, `batt_level_pct`, `plugged`, `sensor_valid`, `t_idle_c`, `trend_c_per_min`, and
it coerces the absent idle fields:

```
APP/src/engine/governorInputs.ts:166    const idleValid = Boolean(input.t_idle_valid);
APP/src/engine/governorInputs.ts:173    t_idle_valid: idleValid,
```

`nativeGovernorThermo` (`APP/src/engine/LlamaService.ts:1646-1652`) strips only `thermo_source` and
forwards the rest, so the app **sends `t_idle_valid: false` explicitly**, not merely by omission.

### A.3 The engine service (where the values land)

| datum | site | note |
|---|---|---|
| thermo at load | `APP/src/engine/LlamaService.ts:2293-2321`, assembled into `thermo: nativeGovernorThermo(governorThermo)` `:2319` | only when `enabled && sensor_valid && gpu_fit !== "NoFit" && !mmprojPath && !streamExperts` `:2308-2315` |
| the ten governor keys | `buildGovernorParams` `APP/src/engine/governorInputs.ts:123-144` | unchanged from `PLAN` §0.3; I re-read them, they match |
| governor at load | `...(governorLoad ? { governor: governorLoad } : {})` `APP/src/engine/LlamaService.ts:2396` | → `BINDING cpp/jsi/RNLlamaJSI.cpp:232-236` `parseGovernorLoadParams` → `BINDING cpp/rn-governor-params.cpp:107-158` |
| thermo per round | `engine.setGovernorThermo(nativeGovernorThermo(snapshot))` `APP/src/engine/LlamaService.ts:1719`, inside `refreshGovernorBeforeCompletion` `:1710-1748` | called once per tool round at `:4776`, plus prewarm `:1166`, plus `:5229`, `:5755`, `:5989`, `:6110` — i.e. several times per turn, but the underlying value changes only at the OS broadcast cadence |
| governor stats out | `getGovernorStats` `APP/src/engine/LlamaService.ts:1754` → `KALSA_GOVERNOR` log line `:1760-1775` | fields: `engine_prefill, engine_decode, commit_bytes, commit_ms, prefill_ms, prefill_chunks, prefill_ctx_ngl, forced, thermal_state, thermo_source, fit, fallback_reason` — **no energy, no current, no voltage** |
| engine side | `BINDING cpp/jsi/RNLlamaJSI.cpp:827-850` (`llamaSetGovernorThermo`), `:852-880` (`llamaGetGovernorStats`) | the governor's whole input surface is the seven thermo fields |
| engine reads of the phone | none | `grep -rln 'battery\|BatteryManager\|thermal_zone\|gpubusy\|scaling_max_freq\|power_supply'` over `ENGINE/src` and `ENGINE/ggml/src` returns only `src/llama-ext.h` (a comment at `:266` describing a dumpsys tenths-of-°C value that the app — not the engine — supplies) |

The completion-time alternative (`governor_thermo` inside completion params,
`BINDING cpp/jsi/RNLlamaJSI.cpp:1175-1180`) is **not used by the app**: `grep -rn governor_thermo APP/src`
returns nothing.

### A.4 The other thermal surface

| datum | site | source | rate | wired to | verdict |
|---|---|---|---|---|---|
| OS thermal severity | `APP/modules/kalsa-thermal/android/src/main/java/expo/modules/kalsathermal/KalsaThermalModule.kt:40-51` (`PowerManager.getCurrentThermalStatus()`), listener `:71-82` | `PowerManager` (`AOSP core/java/android/os/PowerManager.java:2683`, added API 29) | event + one query on foreground | `readToHardGate` `APP/src/engine/platformThermalStatus.ts:40-52` → `isAndroidThermalHardGated` `APP/src/engine/thermalHardGate.ts:49-51` → `useThermalHardGate` | **live, but only `>= 4`** |
| advisory temperature | `APP/src/hooks/useThermalMonitor.ts:117` reads `/sys/class/thermal/thermal_zone0/temp` | expo-file-system text read | every 30 s `:22`, `setInterval` `:157` | Settings banner `APP/src/screens/SettingsScreen.tsx:2603-2618`; hint object `thermalThresholds.ts:178-188` (`preferGpuPath`) never consumed by the engine | live, **wrong sensor on the S23**: `thermal_zone0` is `aoss-0` on this device (§C) |
| battery level + charging state | `expo-battery` `getPowerStateAsync` `APP/src/hooks/useBatteryEta.ts:37-39` | `expo-battery` | 60 s while `AppState === "active"` `:22`, `:236-250` | `batteryEta` UI projection (`APP/src/app/AppShell.tsx:2757-2815`) | live, **stopped in background by design** `:236-250` |
| CPU core capacities | `readCpuCapacities` → `/sys/devices/system/cpu/cpuN/cpu_capacity` (`APP/src/engine/threadProfile.ts:222-228`) | expo-file-system | once, process-cached `:210-217` | thread count + tuning | live; **static capability, not frequency** |
| per-cluster frequency / headroom | — | — | — | — | **absent from the app.** `scaling_max_freq` appears in `APP/scripts/*` and `PLAN` §1.1 only |

### A.5 Telemetry and persistence

`grep -rn 'thermal|battery|batt_|temp'` over `APP/src/engine/turnTelemetry.ts`,
`APP/src/telemetry/telemetry.ts`, `APP/src/telemetry/pure.ts`, `APP/workers/telemetry/schema.ts`,
`APP/workers/telemetry/index.ts` returns only the word "attempt". No battery or thermal field is in
the telemetry schema, so no battery datum leaves the device.
Persistence: the governor on/off flag is AsyncStorage key `kalsa.governor.enabled`
(`APP/src/engine/governorRuntime.ts:3`), bench thermo override is `kalsa.bench.thermo`
(`APP/src/engine/governorInputs.ts:11`), both in `databases/RKStorage` (SQLite, listed on the device
at `run-as com.kalsa.app ls -la databases`). **UNVERIFIED**: the current value of either key on this
S23 — reading `RKStorage` means pulling a SQLite file the repo classifies as private chat data
(`LAB/REPOS.md`, "RKStorage-docs is ignored … contains real chat transcripts"), so I did not.

---

## B. Joules per token — who computes it today

**Nobody in the app, nobody in the engine. All of it is host-side, and every energy number descends
from a shell read.**

### B.1 The integration (app repo scripts, run on the Mac)

```
APP/scripts/energySchema.mjs:57-61
    const cur  = Math.abs(parseFloat(r.i));
    const volt = Math.abs(parseFloat(r.v));
    if (Number.isFinite(cur) && Number.isFinite(volt) && cur !== 0 && volt !== 0) {
      const p = (cur * volt) / 1e12; // uA*uV -> W
      joules += p * dt;
```

Right-Riemann sum over the ~1 Hz sampler rows (`:48-49`), input = the CSV produced on device by
`APP/scripts/energy-sample.sh`. The metric is declared relative, not absolute:
`APP/docs/ENERGY-SCHEMA.md:16-25`.

### B.2 The per-token division

```
APP/scripts/energyPhaseSplit.mjs:410   row.j_per_tok_decode = genTokens > 0 ? fmt(decJoules / genTokens) : "";
APP/scripts/energyPhaseSplit.mjs:474   row.j_per_tok_decode = decodeInt && genTokens > 0 ? fmt(jDecode / genTokens) : "";
```

`genTokens` comes from the run's own `llama_perf_context_print` line or a caller-verified counts
manifest (`:323-328`), not from the app. Buckets are the v3 stamped `load_idle / prefill / decode`
split; the v3 stamps are produced by the **CLI** through `KALSA_PHASE_STAMPS`
(`ENGINE/tools/cli/cli-context.cpp:32-34`, writer `:455-470`), an env var the RN app cannot set.
That is why `APP/scripts/energyPhaseSplit.mjs:368-369` has a "phase stamps absent; fell back to
kalsa-energy-rep-v2 arithmetic" branch.

### B.3 The energy number's only source

| producer | energy input | line |
|---|---|---|
| `APP/scripts/energy-sample.sh` (on-device, pushed by adb) | `read i < $PS/current_now` and `read v < $PS/voltage_now` with `PS=/sys/class/power_supply/battery` | `:26`, `:40-41`, header `:36` |
| `LAB/scratchpad/agents/q44-ngl-sweep-mem/xiaomi_energy_driver.sh` | `dumpsys battery \| grep -E "…Charge counter:…\|…voltage:"` and a hard-coded `echo "sysfs_charge_counter=EACCES"` | `:44-45` |
| `LAB/scratchpad/agents/q44-ngl-sweep-mem/extract_charge.py` | `dq = pre["charge_counter_uAh"] - post["charge_counter_uAh"]`; `E = (dq / 1e6) * v * 3600.0`; `jpt = E / tokens` | `:56-61` |
| `LAB/scratchpad/agents/q44-ngl-sweep-mem/analyze_energy.py` | `E = (dq / 1e6) * v * 3600.0`, documented at `:96` as `E_J = (dQ_uAh/1e6) * Vmean * 3600` | `:37`, `:96` |

So there are two host formulas in use: `J = ∫|I·V|dt` from the 1 Hz sampler, and
`J = ΔQ_µAh · V̄ · 1e-6 · 3600` from bracketed charge-counter reads. **Both take their energy
number from a shell read of the battery.**

The only S23-energy harness that has ever been written to read `dumpsys` is
`APP/scripts/device-energy-trace.sh` (schema `kalsa-app-energy-trace-v1`, parser `:81-121`, required
fields `:155-158`, 10 s floor `:180,196-199`). It arrived with commit `c45fd1f` and **has never been
run**: `find . -name '*energy-trace*'` under `APP` returns only the script itself, and no file cites
it. It is the closest existing thing to the app-side series and it is inert.

### B.4 What the S23 actually produced

`APP/device-s23-out/run1/` holds the four stamped per-phase stems. All four have the sysfs columns
empty:

| file | data rows | rows with non-empty `current_uA` |
|---|---|---|
| `LFM2.5-1.2B-Instruct-Q4_K_M_none_PURE.csv` | 49 | 0 |
| `LFM2.5-1.2B-Instruct-Q4_K_M_none_REP.csv` | 136 | 0 |
| `LFM2.5-2.6B-Q4_K_M_none_PURE.csv` | 202 | 0 |
| `LFM2.5-2.6B-Q4_K_M_none_REP.csv` | 216 | 0 |

603 rows total, matching `APP/docs/S23-ENERGY-BLOCKER.md:20-26`. `voltage_uV`,
`batt_temp_deciC`, `status` are empty in every row I sampled, only `t_s` and `cpu_freqs_kHz`
populated — the failure mode the sampler's `read … || i=""` at `APP/scripts/energy-sample.sh:40-43`
guarantees.

---

## C. Where the shell fails, and what replaces it

### C.1 The failure, on the device, today

```
adb -s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp shell id
uid=2000(shell) gid=2000(shell) … context=u:r:shell:s0

ls -l /sys/class/power_supply/          → 10 links: ac, battery, max77705-charger,
                                          max77705-fuelgauge, max77705-otg, mfc-charger, otg,
                                          pca9481-charger, pogo, sec-direct-charger, usb, wireless
ls /sys/class/power_supply/battery/     → Permission denied
cat /sys/class/power_supply/battery/current_now   → Permission denied
cat …/voltage_now  → Permission denied     cat …/temp     → Permission denied
cat …/status       → Permission denied     cat …/capacity → Permission denied
cat …/charge_counter → Permission denied   cat …/current_avg → Permission denied
cat …/charge_full  → Permission denied
ls /sys/class/power_supply/max77705-fuelgauge/ → device  fg_data  online  power  subsystem
```

That is the recorded blocker exactly (`APP/docs/S23-ENERGY-BLOCKER.md:14-19`), and the alterna-
tive node still exposes no `current_now` (`:26-27`). It is **not** an empty-file artefact: the kernel
denies the read.

### C.2 The framework route works — verified on this device

```
dumpsys battery
  AC/USB/Wireless/Dock powered: false      Charge counter: 693750
  status: 3    health: 2    present: true  level: 18   scale: 100
  voltage: 3695                            temperature: 282
  current now: -121                        charge counter: 693750

cmd battery get <p>        current_now  current_average  counter  temp  level  status  present  ac
first read (idle)                2            -101        693750   282    18      3     true  false
later reads (idle)        -20..-324      -99..-146       671250   280    18      3     true  false
with -f (fresh read)       -4,-233,-25   -117..-129      671250   278    18      3     true  false
```

`cmd battery get` reads the same battery service that `BatteryManager.getIntProperty()` binds to
(`adb shell cmd battery -h` lists exactly `ac|usb|wireless|dock|status|level|temp|present|counter|
invalid|current_now|current_average`). So on this build the property surface is:

| property | AOSP name | shell evidence on this S23 | app-readable? |
|---|---|---|---|
| charge counter | `BATTERY_PROPERTY_CHARGE_COUNTER` (`BatteryManager.java:393`) | `693750` → `671250` µAh | yes |
| current now | `…_CURRENT_NOW` (`:400`) | `-4 … -324`, noisy at 2 s spacing, occasionally a near-zero `2` | yes, noisy |
| current average | `…_CURRENT_AVERAGE` (`:409`) | `-99 … -146`, stable | yes |
| capacity | `…_CAPACITY` (`:415`) | level `18` | yes |
| charge status | `…_STATUS` (`:425`) | `3` | yes |
| energy counter | `…_ENERGY_COUNTER` (`:420`, nanowatt-hours) | **not exposed by `cmd battery get`** | **UNVERIFIED** → see §G |

No permission is involved on either side of that table: `BatteryManager.getIntProperty` carries no
`@RequiresPermission` in `AOSP core/java/android/os/BatteryManager.java:600-618`, and its documented
unsupported-value contract is exactly what `GovernorBatteryModule.readProperty`
(`APP/native/GovernorBatteryModule.kt:186-190`) already tests for:

```
AOSP BatteryManager.java:605-607   @return the property value. If the property is not supported or
                                   there is any other error, return (a) 0 if targetSdkVersion < P or
                                   (b) Integer.MIN_VALUE if targetSdkVersion >= P.
```

The app's `targetSdkVersion` is 36, so an unsupported property arrives as `Integer.MIN_VALUE` and is
labelled `"unsupported"` — the honest failure mode is already implemented.

### C.3 Two unit facts the design cannot skip (both device-measured)

**The charge counter ticks in ~1 % steps, not at 1 Hz.** From the device's own
`BattActionChangedLogBuffer` (09-21 03:54:11 → 07:01:36, 18 broadcasts), `cc` advances in steps of
**33 750 µAh** at roughly one step per 10–11 minutes while idle: `1372500 → 1312500 → 1278750 → … →
723750`, i.e. ~1 % of a ~3900 mAh pack per step. Cross-check of the unit and the capacity: over
57 % → 18 % the counter falls 2 377 500 → 693 750 µAh for 39 points, ≈ 43 000 µAh/point, i.e.
~4.0 Ah full scale — consistent with the S23's 3900–4000 mAh design capacity. A 300 s bracket I ran
(`/proc/uptime 204240.62 → 204540.95`, cc `671250 → 671250`) produced **Δcc = 0** while
`current_average` read `-146 → -99`; `cmd battery get -f counter` stayed at `671250` too, so this is
real quantisation, not broadcast staleness. Consequence: a ΔQ-based joule number has a hard floor of
≈ 33 750 µAh × 3.7 V ≈ **125 J per step**; a cell must burn a good fraction of 1 % of the battery
before ΔQ/J/token means anything. This is the granularity the lab keeps hitting
(`LAB/scratchpad/agents/q44-ngl-sweep-mem/REPORT.md:223`, "Charge counter too coarse for ~33 s runs
… CPU rep1 ΔQ=0"; `LAB/scratchpad/agents/q48-olmoe-q40-npu/REPORT.md:186`, "mostly 0 µAh ticks").

**`current_average` is numerically mA on this device, not the µA the Javadoc promises.** AOSP
documents microamperes (`AOSP BatteryManager.java:402-409`). On this S23 the cc-derived mean current
and the reported value agree in mA and differ by ~1000× in µA. Per broadcast, from the device's own
log:

| window | Δcc / Δt | cc-derived current | reported `current_avg` |
|---|---|---|---|
| 04:07:55 – 04:19:04 | 33 750 µAh / 669 s | −181.6 mA | −175 |
| 04:19:04 – 04:29:45 | 33 750 µAh / 641 s | −189.6 mA | −164 |
| 05:13:15 – 05:24:31 | 33 750 µAh / 676 s | −179.7 mA | −196 |
| 06:07:32 – 06:18:47 | 33 750 µAh / 675 s | −180.0 mA | −203 |
| 06:50:46 – 07:01:36 | 37 500 µAh / 650 s | −207.7 mA | −188 |

Ratios 0.87–1.13, i.e. same unit. The ±14 % spread is the cc quantisation; the factor of 1000 is not
explainable by it. **Therefore: `p = |I · V|` computed from `CURRENT_NOW`/`CURRENT_AVERAGE` is
correct only if the mA convention is applied — and the same code on a Jelly or Xiaomi would be
wrong by 1000×. Do not hard-code either unit; calibrate per device against Δcc.**

### C.4 The thermal picture on this device

```
adb shell 'for z in /sys/class/thermal/thermal_zone*; do echo "$z $(cat $z/type) $(cat $z/temp)"; done'
/sys/class/thermal/thermal_zone0  aoss-0   30800      # ← what APP/src/hooks/useThermalMonitor.ts:117 reads
/sys/class/thermal/thermal_zone12 cpu-1-7  39700
/sys/class/thermal/thermal_zone43 bcl_warn -273000    # invalid
/sys/class/thermal/thermal_zone56 epm0     -273000    # invalid
… 60 zones, no zone named skin or batt

dumpsys thermalservice
Thermal Status: 0
Cached temperatures:  SUBBAT 0.0, AP 29.1, PA 28.5, BAT 28.2, USB 27.4, SKIN 29.2, MAINBATRAW 28.2
HAL Ready: true — ThermalHAL 2.0 connected

adb shell cat /sys/class/kgsl/kgsl-3d0/gpubusy         → 0 0      (idle; readable)
adb shell 'cat cpu7/cpufreq/scaling_max_freq'          → 3360000 == cpuinfo_max_freq (not throttled)
```

Two consequences. The app's advisory temperature source is `aoss-0`, an always-on-subsystem sensor,
not skin and not battery — the concern `APP/src/engine/thermalThresholds.ts:6-11` raises in the
abstract is the measured reality on the S23. And the real `SKIN` reading (29.2 °C) exists **only**
through the thermal HAL / `dumpsys thermalservice`; there is no matching `thermal_zone*`, so no
sysfs path in the app can reach it. `PowerManager.getCurrentThermalStatus()` returns a severity
index, not a temperature; `getThermalHeadroom` (§E) is the only app-side skin-derived number.

### C.5 What actually replaces the shell

| need | replacement | evidence |
|---|---|---|
| instantaneous current | `BatteryManager.BATTERY_PROPERTY_CURRENT_NOW` (or `_AVERAGE`) | §C.2; the app already has the call at `APP/native/GovernorBatteryModule.kt:165` |
| charge (for a quantised ΔQ cross-check) | `BATTERY_PROPERTY_CHARGE_COUNTER` | `APP/native/GovernorBatteryModule.kt:166` |
| **voltage — the missing factor** | `BatteryManager.EXTRA_VOLTAGE` from the same sticky `ACTION_BATTERY_CHANGED` intent already fetched at `APP/native/GovernorBatteryModule.kt:43-45` | the intent the app already holds carries it; `dumpsys battery` shows `voltage: 3695` mV |
| battery temperature | `EXTRA_TEMPERATURE` | already at `:57` |
| OS thermal severity | `PowerManager.getCurrentThermalStatus()` / `OnThermalStatusChangedListener` | already in `APP/modules/kalsa-thermal/…/KalsaThermalModule.kt:46,79` |
| early heat warning | `PowerManager.getThermalHeadroom(forecastSeconds)` | §E |
| skin temperature as a number | **no app-side route**; severity index + headroom only | §C.4 |

---

## D. The governor contract, and defects 5.1 / 5.2 / 5.3 re-read from the trees

### D.1 What the app sends, and what the parser requires

**Sent, at load** (`APP/src/engine/governorInputs.ts:123-144`, ten keys, matching `PLAN` §0.3):

| key | type | source |
|---|---|---|
| `enabled` | boolean | `force \|\| GPU_PREFILL_CORRECT[generation]` `:130` |
| `generation` | `"V73" \| "V75" \| "V79" \| "Unknown"` | six regexes on `socModel` `:62-75` |
| `model_kind` | `"Dense" \| "MoE" \| "Hybrid"` | registry |
| `gpu_fit` | `"Fit" \| "NoFit"` | `gpuFit` `:84-121` |
| `gpu_prefill_measured` | boolean | `generation === "V75" \|\| "V79"` `:137` |
| `bench_force_gpu_prefill` | boolean | bench key |
| `npu_lane_enabled` | `false` literal | `:139` |
| `reload_budget_available` | `false` literal | `:140` |
| `forced` | boolean | bench key |
| `reason` | string, only when disabled | `:142` |

plus `thermo` (`APP/src/engine/LlamaService.ts:2319`), whose seven sub-keys are listed in §A.2.
On this S23 the SoC is `SM8550` (verified with `getprop ro.soc.model`), and
`GPU_PREFILL_CORRECT["V73"] === false` (`APP/src/engine/governorInputs.ts:25`), so the governor is
**off by table** unless `benchGovernorForce` or the AsyncStorage flag `kalsa.governor.enabled` is set
— exactly `PLAN` §3.2's "governor off by table, not by measurement".

**Required by the parser** (`BINDING cpp/rn-governor-params.cpp:107-158`): `governor.enabled` must be
a boolean (`:110-115`), `governor.thermo` must exist (`:116-118`), then `generation`, `model_kind`,
`gpu_fit`, `npu_fit` are parsed with throwing converters (`:39-69`), `cool_pays` likewise, and the
thermo profile is validated at `:154-157`. `npu_lane_enabled` throws when true (`:150-152`). Every
other key falls back to a default — including `t_idle_valid`.

**Rate.** `setGovernorThermo` is called once per tool round (`APP/src/engine/LlamaService.ts:4776`)
plus at prewarm (`:1166`), and the load-time snapshot is taken once (`:2293`). The *value* cadence is
the OS broadcast cadence, because `readThermo` registers nothing (§A.1).

### D.2 Defect 5.2 — reproduced, plus one correction to the mechanism

Verified chain, both sides:

```
APP/native/GovernorBatteryModule.kt:41-70   readThermo returns exactly
                                            battTempTenthsC, battLevelPct, plugged, sensorValid
                                            — no t_idle_c, no t_idle_valid, no trend_c_per_min
APP/src/engine/governorInputs.ts:166        const idleValid = Boolean(input.t_idle_valid);   → false
APP/src/engine/governorInputs.ts:173        t_idle_valid: idleValid,                         → sends false
APP/src/engine/LlamaService.ts:1646-1652    nativeGovernorThermo strips only thermo_source
APP/src/engine/LlamaService.ts:1719         engine.setGovernorThermo(…)
BINDING cpp/rn-governor-params.cpp:86       result.t_idle_valid = bool_or(thermo, "t_idle_valid", false);
BINDING cpp/rn-governor-params.cpp:100-104  if (!thermo.plugged) return true;
                                            return thermo.t_idle_valid && std::isfinite(thermo.t_idle_c) && …
ENGINE  src/llama-governor-policy.cpp:59-63 if (!profile.plugged) { return true; }
                                            return profile.t_idle_valid && … && profile.t_idle_c + 1.0f < 42.0f;
ENGINE  src/llama-governor-policy.cpp:88-96 update_thermal → !profile_is_valid → state_ = Invalid
ENGINE  src/llama-governor-policy.cpp:188-193 admit_prefill: Invalid|CRITICAL → Abort
ENGINE  src/llama-governor.cpp:151-155     fail(): failed = true
ENGINE  src/llama-governor.cpp:163-164     if (failed) return fail("governor is failed");
```

So `plugged = true` ⇒ profile `Invalid` ⇒ prefill `Abort` ⇒ `failed = true` **sticky** ⇒ every later
completion throws. `PLAN` §5.2 states the parser default; the correction is that the **app also sends
the false explicitly** (`governorInputs.ts:166,173`), and the app has a unit test that asserts this is
intentional: `APP/src/engine/governorInputs.test.ts:226-237` "forwards plugged source validity
without a JS idle gate". The bench override at `APP/src/engine/governorInputs.ts:11-12,183-187`
(`kalsa.bench.thermo`, which *can* carry `t_idle_valid: true`, see the test at
`APP/src/engine/governorInputs.test.ts:192-211`) is the only way to reach a valid plugged profile
today, and **no campaign writes it** (`grep -rn 'bench.thermo' APP/campaigns APP/scripts` returns
nothing). Two fixes are therefore both live options: send a real idle reference, or drop the
`plugged` branch — and `failed` must stop being terminal for a transient cable event.

### D.3 Defect 5.1 — CONFIRMED

```
ENGINE src/llama-governor-runtime.cpp:53-63
    const bool cpu_fallback = admission.decision == llama_governor_decision::CPUFallback &&
        policy_.thermal_state() != llama_governor_thermal_state::FAST;
    if (prefill_route_ == prefill_route::Undecided &&
        (admission.decision == llama_governor_decision::Wait || cpu_fallback)) {
        prefill_route_ = prefill_route::CPU;
        …
        return 0;
    }
```

`PLAN` §5.1 cites `:55-63`; the block I read is `:53-63` and the plan's `:55` is the second line of
the `if`. When the delta table refuses for heat
(`ENGINE src/llama-governor-policy.cpp:200-213`: the walk `while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) --table;`
ends in `Wait`, and the `table == 0` branch can also return `CPUFallback`), the runtime answers by
**routing the whole prompt to CPU** — the hotter engine — and returning 0 without chunking. The
refusal does not reduce tokens. Confirmed as described.

### D.4 Defect 5.3 — CONFIRMED

```
ENGINE src/llama-governor-policy.cpp:155   if (… state_ == LOWBAT || profile_.batt_level_pct < 45) return CPU;
ENGINE src/llama-governor-policy.cpp:216-221
    result.tokens = k_table_tokens[table - 1];
    result.rule = … requested == CPU ? 9 : 3;
    if (result.tokens != prompt_tokens) { decision = Chunk; }
    else if (requested == CPU) { decision = Admit; }
ENGINE src/llama-governor-runtime.cpp:65-68
    if (prefill_route_ == prefill_route::Undecided) {
        prefill_route_ = prefill_route::GPU;
        stats_.prefill_engine = requested;
    }
```

The battery floor (`:155`) makes `prefill_engine()` return `CPU`; for an exactly-table-sized prompt
the policy returns `Admit`(`:221`); `Admit` is neither `Wait` nor `CPUFallback`, so it falls through
to the `Undecided → GPU` branch. The route is GPU and only the rule string (9 vs 3) and the engine
label change. Confirmed, and `PLAN` §5.3's line citation `:65-68` matches byte-for-byte.

---

## E. The thermal wall

### E.1 What stops, and what decides it

There are three distinct stopping authorities, and they are not the same one.

**1. The OS throttles from `SEVERE` (=3) upward.** `PowerManager.THERMAL_STATUS_SEVERE` is
`Temperature.THROTTLING_SEVERE`, and the AIDL enum is sequential from an explicit `NONE = 0`
(`AOSP hardware/interfaces/thermal/aidl/android/hardware/thermal/ThrottlingSeverity.aidl:29-55`),
so `NONE=0, LIGHT=1, MODERATE=2, SEVERE=3, CRITICAL=4, EMERGENCY=5, SHUTDOWN=6`. The docs describe
SEVERE as "Severe throttling where UX is largely impacted" (developer.android.com PowerManager,
`THERMAL_STATUS_SEVERE`). `getCurrentThermalStatus()` was added in API 29 and `getThermalHeadroom`
in API 30 — both available on this API 36 device.
*Side finding:* the comment at `APP/src/engine/thermalHardGate.ts:45` writes the ladder as
"`NONE=0, PERCEPTIBLE=1, SEVERE=2`", which is wrong (`SEVERE` is 3, `MODERATE` is 2). The predicate
below it (`:49-51`, gate at `>= THERMAL_STATUS_CRITICAL` = `:32`) is nevertheless the intended one.

**2. The app stops itself at `CRITICAL` (=4), not at `SEVERE`.** The `KalsaThermal` listener
(`APP/modules/kalsa-thermal/…/KalsaThermalModule.kt:71-82`) delivers every status including 3, but
`readToHardGate` (`APP/src/engine/platformThermalStatus.ts:40-52`) maps anything below 4 to `false`.
Above the threshold the app renders a full-screen overlay and unloads the model
(`APP/src/app/AppShell.tsx:6748-6760`, `:3673-3680`), refuses send
(`APP/src/app/AppShell.tsx:5410-5412`, `APP/src/screens/AiChatPage.tsx:2183-2186`, `:3669-3672`),
disables the send button (`:3608`), and gates embedding work (`APP/src/app/AppShell.tsx:1577,1590,
1663,1687,1839,2046,2203`). So between SEVERE and CRITICAL the app is fully "running" while the
platform has already throttled it — which is precisely where the measurement dies.

**3. The campaign harness stops the run at unplugged `SEVERE` = 3, or battery ≥ 44.0 °C.**
`APP/scripts/campaign/recovery.sh:18-20` sets `CAMPAIGN_THERMAL_HARD_ABORT_C=44.0`,
`CAMPAIGN_THERMAL_HARD_ABORT_STATUS=3`; the predicate is `recovery.sh:210-243` (status arm `:224-227`,
battery arm `:234-241`, unplugged-only gate `:219`), and `:245-251` logs
`THERMAL HARD ABORT: … it will not resume`. The comment at `:15-17` names the reason: "the external
device watchdog kills at 43 °C battery". The status source is `dumpsys thermalservice`
(`APP/scripts/device-env.sh:69-73`).

**The recorded instance of "everything stops after N turns"** is `LAB/archived/PLAN-2026-09-full.md:1603`:
the Jelly T20C run stopped after **one** sustained turn — watchdog log `01:36:05 57% 26,0 °C status 0
→ 01:39 55% 28,0 → 01:42 53% 33,0 → 01:44 51% 34,0 → 01:45:08 STOP: thermal status 3 (SEVERE)`,
runner killed at nine minutes with the battery still at 51 %. Same shape on the S23 for
quality-of-service, not for the stop: `PLAN:520` records `Thermal Status 3` (SEVERE) in 9 minutes
from cold at 51 % battery; `LAB/analysis/CISWIRE-CHAR3GRAM-KV-AND-THERMAL-2026-09-19.md:58-64`
records the S23 at battery 37→44.5 °C, `thermal_status` up to 3, per-turn latency degrading
`117 → 132 → 105 s` and then `198 → 240 → 258 → 255 → 264 → 438 s`; the Jelly reaching SEVERE at
39.0 °C with `thermal_status=3` from about turn 8 (`:83-88`). So the wall is a **throttling** wall the
harness reacts to at SEVERE, and the app reacts to only at CRITICAL.

### E.2 The precise hook for an earlier handover

The cheapest correct hook already delivers the signal to JS and throws it away. In rank order:

1. **`SEVERE` from the existing stream.** `APP/src/engine/platformThermalStatus.ts:40-52`
   (`readToHardGate`) and `APP/src/engine/thermalHardGate.ts:32,49-51` are the whole distance
   between "SEVERE is already in JS" and "the governor is told to take over". The consumer already
   exists too: `APP/src/hooks/useThermalHardGate.ts:60-96` subscribes, fires the imperative ref
   before React paints (`:39-47`), and re-samples on foreground — a "take over" hook would attach at
   the same two places the gate attaches (`APP/src/app/AppShell.tsx:847-853, 3673-3680`).
2. **`PowerManager.getThermalHeadroom(forecastSeconds)`** — the platform's own early-warning number:
   "a value of 1.0 indicates that the device is (or will be) throttled at `THERMAL_STATUS_SEVERE` …
   a value of 0.75 will never come with `THERMAL_STATUS_MODERATE` but lower"
   (`AOSP core/java/android/os/PowerManager.java:2918-2936`, doc `:2903-2937`). It tracks slow-moving
   skin sensors, is rate-limited to one call per 500 ms and returns `NaN` if called faster
   (`:2941-2945`), so a 1 Hz poll is the intended use. `getThermalHeadroomThresholds()` gives the
   per-status thresholds but is `@FlaggedApi` (`:2994`). The app has no native method for
   `getThermalHeadroom` today; `KalsaThermalModule` would need one function.
3. **The gap the app cannot close at all:** the sysfs advisory path reads `aoss-0` on the S23
   (§C.4), so no in-app number approaches skin temperature.

### E.3 The data the governor would need at that moment, and does not have

| what the handover decision needs | today | blocker |
|---|---|---|
| `SEVERE` reached | arrives in JS, discarded at `>= 4` | one predicate |
| headroom / rate of rise | no native method; `trend_c_per_min` exists in the contract (`APP/src/engine/governorInputs.ts:33,175`) but is **never computed** — `profileFrom` reads it from the input and `readThermo` never supplies it, so it is always `0` | no consumer of the OS stream |
| a valid thermo profile while plugged | `Invalid` on the cable (§D.2) | defect 5.2 |
| idle reference `t_idle_c` | absent | defect 5.2 |
| sustained energy so the policy can price tokens against heat | no app-side series | §A, §B |
| per-cluster headroom `scaling_max_freq / cpuinfo_max_freq` | absent from the app | `PLAN` §1.1 |

---

## F. What a minimal app-side energy series needs

### F.1 Reuse before build — the inventory

| already exists | where | usable as-is? |
|---|---|---|
| native `HandlerThread` sampler with a CSV writer, schema header, per-row flush, min-interval guard, stop/start lifecycle, teardown on `invalidate` | `APP/native/GovernorBatteryModule.kt:96-139`, `:201-235`, `:237-278`, `:277-295` | **yes**, but the row is missing voltage |
| JS wrapper for exactly that | `APP/src/engine/governorBatterySampler.ts:14,23,35` | **yes**, and it is dead code today |
| the module already in the shipped APK, already registered | `APP/plugins/withGovernorBattery.js:1-45`, `APP/app.config.js:101`; APK evidence in the summary | **yes** |
| a coarse-coverage shell fallback for the S23 that parses `dumpsys` correctly (anchored fields, stops before the history buffers, empty-not-zero) | `APP/scripts/device-energy-trace.sh:81-121`, `:155-158` | **yes**, never run |
| the host-side contract for joules and J/token | `APP/scripts/energySchema.mjs:49-76`, `APP/scripts/energyPhaseSplit.mjs:410,474`, `APP/docs/ENERGY-SCHEMA.md` | **yes**, expects a 1 Hz `t_s,current,voltage` CSV |
| phase-boundary marks for a bucket split | the v3 stamps are CLI-only (`ENGINE/tools/cli/cli-context.cpp:32-34`); in-app the boundaries exist as `KALSA_TELEMETRY` (`APP/scripts/ci-bench.sh:1164-1166`) and `KALSA_GOVERNOR` (`APP/src/engine/LlamaService.ts:1760-1775`) logcat lines | **partially** — join on host, not in-app |
| a persisted app directory | `files/`, `files/sessions/`, `files/models/` (device listing); `sessionPersistence.ts:206-209` uses `FileSystem.documentDirectory` | **yes**, for the trace file |

### F.2 The smallest correct design

**API and rate.** `BATTERY_PROPERTY_CURRENT_NOW` + `BATTERY_PROPERTY_CHARGE_COUNTER` through
`BatteryManager.getIntProperty` (already at `APP/native/GovernorBatteryModule.kt:165-166`), and
`EXTRA_VOLTAGE` + `EXTRA_TEMPERATURE` + `EXTRA_PLUGGED` from the `ACTION_BATTERY_CHANGED` sticky
intent the module already fetches (`:43-45`). Poll at **1 Hz** — the module's own comment at
`:206-207` argues the fuel gauge applies roughly one second of smoothing, so faster adds no physical
information, and the framework forbids `getThermalHeadroom` faster than one call per 500 ms
(`AOSP PowerManager.java:2941-2945`). `MIN_SAMPLE_INTERVAL_MS = 200` (`:302`) already permits it.
One extra column, `thermal_status` from `getCurrentThermalStatus()` (or the headroom float), makes
the series directly comparable with the campaign stop rules.

**Where the samples go.** The existing writer, unchanged in shape: append-only CSV at
`FileSystem.documentDirectory + "energy/" + runStem + ".csv"`, header once when the file is empty
(`:262-273`), flush per row (`:230-232`). This is what the host tools already consume. A memory ring
is the cheaper alternative but then the read-out needs a new native method; the file needs none.
SQLite is the wrong tool: the trace is a stream, and the join with tokens happens on the host.

**Required schema change, and why it is the whole change:**

```
APP/native/GovernorBatteryModule.kt:312-314   current: "t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,current_status,charge_counter_status"
                                              needed:  … ,voltage_mV,batt_temp_deci_c,plugged,thermal_status,status_code
```

Without a voltage column the series cannot produce a joule, in any unit convention. With it,
`APP/scripts/energySchema.mjs:49-76` becomes usable **if** the integration is generalised to
`ΔQ·V̄` when `current` is quantised, or if the per-device current unit is calibrated first (§C.3).

**Foreground service or bound service?** Neither is required *to sample*: the module owns a
`HandlerThread` that is independent of the Activity (`:85-92`), so it survives `onPause` and keeps
writing while the process lives. It is **not** reliable in background as shipped: there is no
`FOREGROUND_SERVICE` permission and no `Service` anywhere in the app
(`APP/app.config.js:35` declares only `RECORD_AUDIO` and `READ_CALENDAR`; `grep -rln Service
APP/modules/*/android/src` finds only the two Expo `Module` classes), so a cached app can be frozen
and killed. For an A/B run on a charged phone with the screen on, the current thread is sufficient.
For a background or screen-off session, a foreground service with an ongoing notification is the
only correct answer, and that is a **product decision** — it adds a permanent notification to a
consumer app.

**How an A/B run reads out.** Host-side, exactly as `APP/scripts/energyPhaseSplit.mjs:851-880`
already globs `*_rN.stamps` sidecars: pull `files/energy/<stem>.csv` after `stopSampling`, pull
logcat for `KALSA_TELEMETRY` (`APP/scripts/ci-bench.sh:1164-1166`) and `KALSA_GOVERNOR`
(`APP/src/engine/LlamaService.ts:1760-1775`), then bucket by turn boundary and divide
`j_decode / genTokens`. `APP/scripts/energy-sample.sh`'s column set is a superset of what the
host tools need; keeping the app trace column-compatible up to voltage is what makes the two devices
comparable without a new parser.

**Files that would change**

| file | change |
|---|---|
| `APP/native/GovernorBatteryModule.kt` | `readThermo` adds `EXTRA_VOLTAGE`/`EXTRA_STATUS` (`:41-70`); `readHighRateValues` adds a third `PropertyRead` (`:164-167`); `HighRateRead` + `readHighRateMap` (`:21-24`, `:151-162`); `sampleRow` + `TRACE_COLUMNS` (`:237-255`, `:312-314`) |
| `APP/src/engine/governorBatterySampler.ts` | add `voltage` to the high-rate type and a `thermal_status` sample hook (`:1-39`) |
| the call site — one of `APP/src/engine/LlamaService.ts:1710-1748` or the turn boundary in `APP/src/app/AppShell.tsx` | `startGovernorBatterySampling(path, 1000)` before the first turn, `stopGovernorBatterySampling()` after the last; today there is **no** call site anywhere |
| `APP/src/engine/governorInputs.ts:166-175` (or the engine's `profile_is_valid`) | defect 5.2, independent of the above |
| `APP/modules/kalsa-thermal/…/KalsaThermalModule.kt` + `APP/src/engine/platformThermalStatus.ts:40-52` | expose `getThermalHeadroom` and stop discarding `SEVERE` — the §E hook |

**Product decisions, not code facts**

- Whether the app ships a foreground service (permanent notification) or the series is
  foreground-only, which caps a cell at screen-on time.
- Whether the trace file is a debugging artefact or a user-visible feature; on-device battery
  telemetry has privacy weight even without chat content.
- Whether `SEVERE` may slow or reshape an answer for a real user, or only for bench runs — the same
  question `PLAN` §8.2 already puts to the owner.
- Whether the joules-per-token reading rule (`APP/docs/ENERGY-FRAMEWORK-STATUS.md:111-113`, "accept
  up to +25 % decode time if J/token drops by ≥15 %") is applied per turn or per session.

---

## Gap list, ordered by what blocks the measurement

1. **No voltage anywhere in the app.** `GovernorBatteryModule` reads current and charge counter and
   never voltage (`:164-167`); the host formula needs `V` (`APP/scripts/energySchema.mjs:53-61`).
   Nothing measurable happens until this column exists. *Blocking.*
2. **The sampler has no caller and is not in the bundle.** `startSampling` / `readHighRate` /
   `stopSampling` appear 0 times in the shipped Hermes bundle; the JS wrapper
   (`APP/src/engine/governorBatterySampler.ts:23`) is imported nowhere. *Blocking.*
3. **Defect 5.2 — the cable turns the governor into a sticky failure.** `plugged=true` ⇒
   `t_idle_valid=false` ⇒ `Invalid` ⇒ `Abort` ⇒ `failed` sticky
   (`ENGINE src/llama-governor-policy.cpp:59-63`, `:88-96`, `:188-193`;
   `ENGINE src/llama-governor.cpp:151-155`, `:163-164`). Any A/B that needs the cable, or that
   happens to be plugged, measures nothing. *Blocking for any plugged cell; the owner's own work
   order puts 5.1/5.2/5.3 first.*
4. **Charge-counter granularity ≈ 33 750 µAh (~125 J) per step, and `current_average` has a
   device-dependent unit (mA on this S23, µA per the Javadoc).** A 30 s cell cannot be measured by
   ΔQ, and an uncalibrated `I·V` is wrong by 1000× (§C.3). *Blocking for short cells; requires either
   long cells or a per-device unit calibration.*
5. **The `SEVERE` handover signal is discarded.** `readToHardGate` maps everything below 4 to
   `false` (`APP/src/engine/platformThermalStatus.ts:40-52`); `trend_c_per_min` is always 0 because
   nothing computes it (`APP/src/engine/governorInputs.ts:175`). *Blocking for "take over before
   severe"; not blocking for a pure energy series.*
6. **The advisory temperature sensor is the wrong one on the S23.** `thermal_zone0` is `aoss-0`
   (`APP/src/hooks/useThermalMonitor.ts:117`); SKIN exists only through the thermal HAL (§C.4).
   *Blocks in-app skin temperature; severity and headroom remain available.*
7. **Phase boundaries exist only as logcat lines in-app.** The v3 stamps come from a CLI env var the
   app cannot set (`ENGINE/tools/cli/cli-context.cpp:32-34`), so in-app per-phase attribution is a
   host-side join, not an engine fact. *Non-blocking, but it fixes the bucket design.*
8. **Defects 5.1 and 5.3** change the route, not the measurement: under heat refusal the prompt goes
   to CPU unsplit (`ENGINE src/llama-governor-runtime.cpp:53-63`) and the battery floor produces
   `Admit` → GPU (`ENGINE src/llama-governor-policy.cpp:155,216-221` + runtime `:65-68`).
   *Blocks trusting any governor A/B, not the energy series itself.*
9. **No foreground service and no `FOREGROUND_SERVICE` permission.** The thread survives pause but
   not freezing (`APP/native/GovernorBatteryModule.kt:85-92`; `APP/app.config.js:35`). *Blocks
   screen-off / background cells until a product decision is taken.*

---

## What I could NOT verify, and what would settle it

| unverified | why | what settles it |
|---|---|---|
| `BATTERY_PROPERTY_ENERGY_COUNTER` (nanowatt-hours, `AOSP BatteryManager.java:420`) on this S23 | `cmd battery get` exposes no energy field, so there is no read-only shell route; `getIntProperty` needs a process | one app-side call logging `getLongProperty(BATTERY_PROPERTY_ENERGY_COUNTER)`; if it returns `Long.MIN_VALUE` the property is unsupported and the charge-counter route is the only one |
| the exact unit convention of `CURRENT_NOW` / `CURRENT_AVERAGE` on this device | I could only bracket against a 33 750 µAh-quantised counter, which bounds the factor to ±14 % but cannot exclude a deliberate Samsung scaling | an app-side 10-minute window under known load, reading both properties at 1 Hz and integrating against Δcc with ≥5 counter steps |
| whether the S23 governor flag `kalsa.governor.enabled` is currently set, and whether `kalsa.bench.thermo` exists on the device | both live in `databases/RKStorage`, which the repo classifies as private chat data | a coordinated read of the two keys only (e.g. `SELECT key,value … WHERE key IN (…)`), never a bulk pull |
| the ACTION_BATTERY_CHANGED cadence under the app's real load on the S23 | the only fresh evidence I have is the idle cadence (~10–11 min, from `BattActionChangedLogBuffer` 03:54→07:01); the 30–90 s figure quoted in `APP/scripts/device-energy-trace.sh:19` and `APP/docs/S23-ENERGY-BLOCKER.md` is from an earlier loaded run | one logged run: timestamps of consecutive `BatteryManager` broadcasts while the engine is decoding |
| a real `SKIN` temperature through any app-side API | `dumpsys thermalservice` shows `SKIN 29.2` from the HAL, but no `thermal_zone*` matches, and `getCurrentThermalStatus` returns severity, not °C | a native call to `getThermalHeadroom` (a fraction of the SEVERE envelope, `AOSP PowerManager.java:2918-2936`) logged beside `dumpsys thermalservice` for one run, to fix the mapping |
| whether the installed APK's `GovernorBatteryModule` behaves as the worktree's source (e.g. the sampler thread) | I verified the class and the trace schema string in `classes19.dex` and the strings in `libs/arm64-v8a/librnllama*.so`, not behaviour | run `startSampling` once via a debug build and diff the produced CSV header against `APP/native/GovernorBatteryModule.kt:312-314` |
| the S23's `adsprpcd`/`cdsprpcd` background load during any energy cell | not measured here; the contaminant is recorded (`PLAN` §3.2) | the same subtraction protocol the plan already specifies |
| `ENGINE` defect lines on the *installed* engine build | I read `~/Projects/kalsallama` at `b11010-merge` (identical to `main` at the cited lines), while the APK's `librnllama*.so` is built from the `BINDING` pin | `APP/scripts/assert-engine-provenance.sh` plus the fork pin in `package.json`, or the symbol-level check the app already performs |
