# Governor x Meter recon - architecture map and cost of the second version

Date: 2026-09-23 (overnight). Read-only. No sub-agents, no code changes, no device touched.
One file written (this one).

Path convention: `repo/file:line`, all line numbers verified against the working trees on this
Mac today unless the citation is explicitly attributed to another report (trees move; the
reports do not).

Trees read:

| alias | path | state read today |
|---|---|---|
| `APP` | `/Users/marco/Projects/kalsa` | `main` = `e5788cf`; Meter commit `6a58ef5` is an ancestor of `main` (checked with `git merge-base --is-ancestor`) |
| `ENGINE` | `/Users/marco/Projects/kalsallama` | `main` = `833cde99b`; local ref `kalsallama-governor-sole-decider` exists |
| `BINDING` | `/Users/marco/Projects/llama.rn-kalsa` | working tree read |
| `LAB` | `/Users/marco/Projects/kalsa-moe-experiments` | `PLAN.md`, `docs/ALIVE.md`, `scratchpad/` |

State fact that matters for everything below: the **post-consolidation layering** (app measures
raw, binding transports, engine decides) exists on **local refs only** - `kalsa-governor-policy-consolidate`
(`0db9dc68`, app) is contained by exactly one branch in the app checkout (`git branch --contains`),
and `kalsallama-governor-sole-decider` (`35eeeae3`) likewise. `APP` `main` still carries the three
copies of the policy (see 2.4). This matches `scratchpad/COORDINATOR-STATE.md` ("Work protected on
local refs - never pushed").

---

## 1. The Meter: what it measures, how, where, and how it is armed

### 1.1 Implementation (app side)

The Meter is one native module plus one thin JS wrapper, both tracked:

- `APP/native/GovernorBatteryModule.kt` - class `GovernorBatteryModule`, registered unconditionally
  into the generated project by `APP/plugins/withGovernorBattery.js` (`APP/app.config.js:101`).
  The module ships in the release APK (dex-level evidence in
  `scratchpad/agents/energy-instrumentation/REPORT.md`, "Answer first" and §F.1).
  - Sampler loop: `startSampling` (`GovernorBatteryModule.kt:111`), `sampleOnce` (`:237-260`) on a
    `HandlerThread` independent of the Activity, `stopSampling` (`:152`), teardown on `invalidate`
    (`:157`).
  - Per-row read: `readHighRateValues` (`:179-182`) = `BATTERY_PROPERTY_CURRENT_NOW` (`:180`) and
    `BATTERY_PROPERTY_CHARGE_COUNTER` (`:181`), plus voltage via `readVoltageMv` (`:222`, sticky
    `ACTION_BATTERY_CHANGED` intent - the comment at `:219` notes `EXTRA_VOLTAGE` is the only
    voltage route).
  - Cadence: JS wrapper sets `TRACE_INTERVAL_MS = 1000` (`APP/src/engine/governorBatterySampler.ts:14`);
    native floor is `MIN_SAMPLE_INTERVAL_MS = 200` (`GovernorBatteryModule.kt:337`). The reason for
    1 Hz is in the code: "The fuel gauge applies roughly one second of smoothing, so polling faster
    than ~1 Hz does not add physical information" (`:238-239`).
  - Writer: `openTraceWriter` (`:291-311`), append-only, header once, **flush per row**
    (`:255-257`), so a killed process loses no datum.
- `APP/src/engine/governorBatterySampler.ts` - `BENCH_ENERGY_TRACE_KEY = "kalsa.bench.energy_trace"`
  (`:11`), reader `readBenchEnergyTraceEnabled` (`:23-30`), path `energyTraceFilePath` (`:37-41`),
  `startGovernorBatteryTrace` (`:77-92`) gated on the key at `:81`, `stopGovernorBatteryTrace`
  (`:95-101`).

### 1.2 What the CSV carries

Schema string verbatim (`GovernorBatteryModule.kt:344-349`, archived copy in
`scratchpad/agents/meter-close/REPORT.md` §(c)):

```
# schema=kalsa-governor-battery-trace-v2; t_s=SystemClock.elapsedRealtime()/1000; voltage_mV=BatteryManager.EXTRA_VOLTAGE, millivolts; current_uA=property-documented unit, calibrate per device; INVALID=invalid reading
```

Columns (`GovernorBatteryModule.kt:350-352`), 9 fields, one row per second:

```
t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV,current_status,charge_counter_status,voltage_status
```

The three status columns carry `ok|unsupported|unavailable|error` per property (`:339-343`), and
`INVALID` marks a bad value (`:338`) - the "empty, never 0" discipline survives from the host
scripts.

### 1.3 Where the file lives

`FileSystem.documentDirectory + "energy/" + <wall_clock_ms> + "-t" + turnId + ".csv"`
(`governorBatterySampler.ts:37-41`, called with `FileSystem.documentDirectory` at
`APP/src/engine/LlamaService.ts:4584-4587`). On Android `documentDirectory` is the app's
`files/` dir, which is why the pull command in `scratchpad/agents/meter-close/REPORT.md` §(c) is
`adb shell run-as com.kalsa.app cat files/energy/1790009150962-t1.csv`.

Scope: **one CSV per turn**, started just before the turn body (`LlamaService.ts:4584`) and stopped
in the turn's `finally` (`LlamaService.ts:5412`).

### 1.4 How the trace is armed today

1. **The bench key.** The trace runs only when `kalsa.bench.energy_trace == "1"`
   (`governorBatterySampler.ts:22-30, :81`).
2. **No code writes that key.** A repo-wide grep of `APP/src` and `APP/scripts` finds only the
   constant and the reader (verified today; same finding in
   `scratchpad/agents/bench-apk/REPORT.md` §5 item 2: "no code path writes the energy flag from
   inside the app today").
3. **The only writer is host-side, through `run-as`.** The arming recipe is
   `sql_write "INSERT OR REPLACE INTO catalystLocalStorage ... 'kalsa.bench.energy_trace','1'" ...`
   using `APP/scripts/ci-lib.sh:119` (`sql_write`), quoted verbatim in
   `scratchpad/agents/jelly-rerun/REPORT.md` §9.2. `sql_write` itself reads and pushes the app's
   SQLite store via `run-as` (`ci-lib.sh:118-152`).
4. **`run-as` requires a debuggable build.** Observed on the shipping APK:
   `run-as com.kalsa.app` -> `package not debuggable`, consequences: cannot arm the key, cannot
   pull the CSV, cannot read the store, and `device-share-send.sh`'s guard also died
   (`jelly-rerun/REPORT.md` §11 D1/D2). That cell therefore has **no energy CSV at all** ("No
   energy CSV (D1)", §12; comparison table row "energy CSV ... none (D1) (sec. 14)").
5. **The debuggable dependency, and why it broke.** The `debuggable true` line was a hand edit
   inside the gitignored, `expo prebuild`-regenerated `android/app/build.gradle`; a clean prebuild
   deleted it along with the ability to measure (`scratchpad/COORDINATOR-STATE.md:72`,
   `PLAN.md` "The instrument lesson" item 1, `docs/ALIVE.md` §instrument lesson item 1).
   The tracked replacement already exists: gate `KALSA_DEBUGGABLE === "1"` at `APP/app.config.js:71-73`
   -> plugin `APP/plugins/withDebuggableRelease.js`, and the CI workflow sets it only for the
   `bench-dev-models` branch (`.github/workflows/build-kalsa-apk.yml` lines 60 and 66, read at
   `e206a94` - `bench-apk/REPORT.md` §1). The bench build was proven end to end: clean prebuild
   reproduces both states deterministically (§3.1) and the artifact's own manifest contains
   `debuggable=true` (§3.4, sha256 `bfb5b4f9...`, +6.47 MB over the non-debuggable APK - the size
   delta is fully accounted for by dex-layout/profile artifacts, §3.4). Today's shipping APK was
   verified the other way: `aapt2 ... | grep -c debuggable` -> **0** (§2, sha256 `d3c66bdb...`).
6. **Pull path**: only `run-as ... cat files/energy/*.csv`. Archived Meter output exists on this
   Mac: `scratchpad/agents/meter-close/raw/coordinator-verify/*.csv` (5 files, 712 lines total)
   plus `raw/coder-artifacts/`.

### 1.5 The channels that exist and the ones that do not

From `bench-apk/REPORT.md` §5 (reported only, nothing built), checked against the tree today:

| channel | plumbing exists? | command exists? |
|---|---|---|
| deep link / intent extra (`kalsa://share?...` already patched into `MainActivity` by `plugins/withAndroidShareIntent.js`, listener `APP/src/app/AppShell.tsx:3640-3653`) | yes | **no** - no `bench?energy=1` case, no flag write |
| in-app bench key writer (`APP/src/bench/benchConfig.ts` writes the other `kalsa.bench.*` keys; Settings bench panel exists) | yes | **no** energy writer |
| file in app-specific external storage (`getExternalFilesDir`) - would remove `run-as` from the host pull | `react-native-fs@2.20.0` present, can address `ExternalDirectoryPath` | **no** usage anywhere in `src/`, `native/`, `plugins/` |
| sticky `ACTION_BATTERY_CHANGED` intent | read path exists (`GovernorBatteryModule.kt:219-230`) | is **not** an arming path |

So: **arming without `run-as` is two small, plumbing-reusing changes; pulling without `run-as` is
one more (external dir or in-app export). Debuggable is a requirement today, not in principle.**

### 1.6 The second (host) channel, for completeness

`APP/scripts/device-energy-trace.sh` - schema `kalsa-app-energy-trace-v1`, host-side `dumpsys battery`
at >= 10 s cadence, columns include `current_avg_ua` (`:61`), anchored parse guard (`:19-25`,
`:81-121`). It **has been run**: `APP/out/t20c-gate-20260916/energy-trace.csv` = 555 lines (2
comments + header + 552 rows, 10 s spacing, 2026-09-16 15:45 -> 17:19). Note
`energy-instrumentation/REPORT.md` §B.3 says this script "has never been run" - that is stale for
this file (the report was written 2026-09-21 against a different worktree; the trace above is on
disk). Also `APP/scripts/energy-sample.sh` (on-device sysfs shell sampler) and the host joule
math (`APP/scripts/energySchema.mjs:54-60`, `p = |I*V|/1e12` W, Riemann sum) predate the Meter.

---

## 2. What the governor consumes today

### 2.1 The observation struct (`ENGINE src/llama-ext.h:269-277`)

```cpp
struct llama_governor_thermo_profile {
    int32_t batt_temp_tenths_c = 0;
    int32_t batt_level_pct = 100;
    bool plugged = false;
    bool sensor_valid = false;
    bool t_idle_valid = false;
    float t_idle_c = 0.0f;
    float trend_c_per_min = 0.0f;
};
```

Where each field is produced, end to end:

| field | produced | unit conversion | notes |
|---|---|---|---|
| `batt_temp_tenths_c` | `APP/native/GovernorBatteryModule.kt:60` (`EXTRA_TEMPERATURE`), emitted `:74` | none (tenths of C) | engine reads it as `batt_temp_tenths_c/10` (`llama-governor-policy.cpp:33-35`) |
| `batt_level_pct` | `GovernorBatteryModule.kt:62-64` (`EXTRA_LEVEL/SCALE`), emitted `:75` | percent | |
| `plugged` | `GovernorBatteryModule.kt:65` (`EXTRA_PLUGGED`), emitted `:76` | - | |
| `sensor_valid` | `GovernorBatteryModule.kt:77` (`present && temperature > 0`) | - | sensor fact |
| `t_idle_valid` / `t_idle_c` | **app-side latch on the plug-in edge** at `GovernorBatteryModule.kt:41, :67-73, :78-80` (on `main` today), lifted tenths->degrees in `APP/src/engine/governorInputs.ts:126-137`, range gate `idleValid` at `governorInputs.ts:138` | tenths -> whole degrees once, at `governorInputs.ts:136` | this is pre-consolidation `main`; on ref `kalsa-governor-policy-consolidate` the latch and the `:138` gate are deleted and the module emits raw live temperature (`governor-policy-consolidate/REPORT.md` §2.1) |
| `trend_c_per_min` | **nobody.** `governorInputs.ts:146` defaults it to 0 and no producer exists anywhere in `APP/src`, `APP/native`, `APP/modules` (grep verified today) | - | independently found in `energy-instrumentation/REPORT.md` §E.3 and gap 5: "always 0" |

Bench-skin override: `readGovernorThermo` (`governorInputs.ts:150-177`) first checks
`kalsa.bench.thermo` (`:6`, `:152-156`) and falls back to `NativeModules.GovernorBattery.readThermo`
(`:157-167`), then an invalid-profile default (`:170-177`).

Session-scope inputs are a **separate** struct, `llama_governor_params`
(`ENGINE src/llama-ext.h:243-266`), built app-side by `buildGovernorParams`
(`governorInputs.ts:81-104`: `generation`, `model_kind`, `gpu_fit`, `gpu_prefill_measured`,
`bench_force_gpu_prefill`, ...). Its schema is checked by `valid_schema`
(`llama-governor-policy.cpp:28-31`).

### 2.2 The transport (app -> binding -> engine)

Agreed layering, as implemented and as recorded in
`scratchpad/agents/governor-policy-consolidate/REPORT.md` §1 ("app measures, binding transports,
engine decides"):

1. **App**: `nativeGovernorThermo` strips only `thermo_source`
   (`APP/src/engine/LlamaService.ts:1651-1658`); pushes happen at model load
   (`LlamaService.ts:2312` read, `:2329` into `governor.load.thermo`) and before every completion
   round via `refreshGovernorBeforeCompletion` (`LlamaService.ts:1715-1751`, call sites `:4798`
   and `:5253`), each wrapped in `withNativeCallTimeout` (`:1693-1713`) and gated by
   `activeGovernorActive && engine === context`.
2. **Binding**: JSI `governorThermoFromJsi` (`BINDING cpp/jsi/RNLlamaJSI.cpp:42-44`) and
   `parseGovernorThermo` (`:239-244`) -> `rnllama::parse_governor_thermo`
   (`BINDING cpp/rn-governor-params.cpp:75-91`, field-for-field copy) with structural sanity
   `governor_thermo_profile_is_valid` (`:93-101`); `rn_governor::set_thermo_profile`
   (`cpp/rn-governor.cpp:72-79`) stamps `now_ms` and calls the engine.
3. **Engine**: `llama_governor_set_thermo_profile` (`ENGINE src/llama-ext.h:406-410`) ->
   `llama_governor::set_thermo_profile` (`src/llama-governor-runtime.cpp:178-183`) ->
   `policy_.update_thermal` (`src/llama-governor-policy.cpp:88`).

### 2.3 The policy that consumes it (`ENGINE src/llama-governor-policy.cpp`)

- **Validity gate**: `profile_is_valid` (`:53-64`) - `sensor_valid`, finite trend, level in 0..100,
  and on the plugged branch the engine's plugged rule against `t_idle_c`. Failure -> `state_ =
  Invalid` (`:90-96`).
- **Drift rule**: plugged reference latched on first plugged sample (`:97-100`), re-judged every
  poll by the `> 1.5f` check at `:101` -> `Invalid`; cleared on unplug (`:108-111`). This is the
  rule the old app latch used to mask (before/after cases A-D:
  `governor-policy-consolidate/REPORT.md` §2.2).
- **Classification**: thresholds `get_thresholds` (`:42-50`) - fixed set when unplugged, offsets
  from `t_idle_c` when plugged; `classify` (`:66-78`); the state machine in `update_thermal`
  (`:117-152`) with named constants `k_kill_c` (`:12`), `k_trend_c_per_min` (`:13`, consumed at
  `:139`), `k_dwell_ms` (`:8`, used by `dwell_elapsed` `:80-82`); `LOWBAT` at `batt_level_pct < 25`
  (`:125`); `hot_plugged_` at `:115`.
- **Where prefill routing is decided**: the runtime asks the policy per prefill:
  `llama_governor::admit_prefill` -> `policy_.prefill_engine()` (`src/llama-governor-runtime.cpp:45`)
  and `policy_.admit_prefill(...)` (`:46-49`); the route is latched Undecided->CPU/GPU at `:59-61`;
  chunked fallback loops back through `admit_prefill` per chunk (`:74-99`). Inside the policy,
  `prefill_engine` (`llama-governor-policy.cpp:155-179`) is the decision point: validity +
  `batt_level_pct < 45` gate (`:158`), `bench_force_gpu_prefill` (`:163`), generation/fit/measured
  gates (`:170-174`), `GPU_COOLMODE` with `!hot_plugged_` (`:175-178`), default CPU. `prefill_rule`
  (`:181-188`) maps that to the reported rule id. `admit_prefill` (`:190-232`) sizes chunks against
  `k_table_tokens` / `k_cpu_delta_c` (`:14-15`, walk at `:202-213`) with the ceiling `k_limit_c`
  (`:11`). Decode-side selection is `select_decode` (`:234-264`) with `k_flip_window_ms` (`:9`,
  used at `:243`).

### 2.4 Layering status (as read today on `APP` `main`)

The triplication the consolidation removes is still present on `main`: Kotlin latch
(`GovernorBatteryModule.kt:41,67-73`), TS range gate (`governorInputs.ts:138`), binding plugged
rule (removed only on ref `kalsarn-governor-transport`; the pre-consolidation copy is cited in
`COORDINATOR-STATE.md:261` as `rn-governor-params.cpp:103`). The engine's logic is byte-identical
before/after (`governor-policy-consolidate/REPORT.md` §3). Any new field must be added under that
same mandate: **one producer (app), field-for-field transport (binding), one decision (engine)**.

### 2.5 Standing caution on the governor itself

The governor is off by default (`PLAN.md` "Governor", `APP/src/engine/governorRuntime.ts:15-21`)
and its **last on-device engagement attempt refused** (`fallback_reason:"governor not eligible"`,
`engine_prefill:"CPU"` - `scratchpad/agents/s23-governor-smoke/REPORT.md:314,365`; recorded OPEN in
`PLAN.md` open item 11). Anything that leans on the Meter leans on a governor that has not yet
engaged on a phone.

---

## 3. The gap, precisely

To decide on **measured energy** instead of level and temperature, the engine needs one number.
Three candidates, and where each already exists:

**(a) Instantaneous current / power - EXISTS in-process, 1 Hz, armed.**
`BATTERY_PROPERTY_CURRENT_NOW` + `CHARGE_COUNTER` are already read at `GovernorBatteryModule.kt:180-181`
and `readHighRate` exposes them to JS (`:102-107`); voltage exists beside them (`:222`). The JS
wrapper `readGovernorBatteryHighRate` (`governorBatterySampler.ts:46-52`) has **zero callers**
(grep verified today) - the transport half-exists and is dead. When the trace is armed, the same
two numbers arrive per row in the CSV. Power is `|I*V|`, exactly the host formula at
`APP/scripts/energySchema.mjs:56-60`.

**(b) Rolling mAh/min - derivable, resolution device-dependent.**
Either integrate (a) over a window, or difference the charge counter. The counter does not tick at
1 Hz: measured from the archived Meter CSVs (counted today, `meter-close/raw/coordinator-verify/`),
the counter moves in exact **29,460 uAh steps** on the Jelly, and the per-turn ticks are:
t1 (23.2 s span) **0 ticks**, t2 **1**, t3 **2**, t4 **1**, t5 (363.9 s) **3**. Cross-device:
S23 steps of 33,750 uAh with a 300 s idle bracket giving **delta = 0**
(`energy-instrumentation/REPORT.md` §C.3), and the host trace `APP/out/t20c-gate-20260916/energy-trace.csv`
(552 rows, counted today) ticks in 3,750-15,000 uAh steps with median spacing 30.5 s.
So a rolling average over minutes exists; a rolling average over seconds does not.

**(c) Per-turn total - DOES NOT EXIST as a resolvable number.**
DERIVED from the archived Meter CSVs and `meter-close/REPORT.md` §(c): turn draw median
`current_uA = -1,045,000` at 3815-3922 mV, i.e. **~4.0 W**; one Jelly counter step (29,460 uAh at
~3.86 V) is **~409 J**; at that draw one step is consumed in **~101 s** of full load. The
completed turns span 23-364 s and burn roughly 93 / 89 / 590 / 605 / 1466 J (4.0 W x span). So
t1/t2 deltas are below or at one step (t1 observed delta = 0), and the best case t5 carries
+-1 step = **+-33 %** error. A per-turn mAh the governor could act on would have to be minutes
long. This matches the lab's repeated hit on the same wall
(`q44-ngl-sweep-mem/REPORT.md:223`, `q48-olmoe-q40-npu/REPORT.md:186`, quoted in
`energy-instrumentation/REPORT.md` §C.3).

**Correction to the task premise**: the app does **not** sample `current_avg`. A grep of `APP/src`
and `APP/native` for `current_avg|CURRENT_AVERAGE` returns nothing; the app samples `CURRENT_NOW`.
`current_avg` exists only on host channels: the `current_avg_ua` column of
`scripts/device-energy-trace.sh:61,100` (empty in **all 552 rows** of the t20c-gate trace - that
device's `dumpsys battery` printed no `current_avg`) and in `BatteryService` logcat lines (e.g.
`kalsa/out/bench/.logcat_turn_buf.txt:5557`, `current_avg:-692`). Its unit is also device-relative:
mA on the S23 against the Javadoc's uA, to be calibrated per device
(`energy-instrumentation/REPORT.md` §C.3).

**What would have to travel from app to engine** (respecting the agreed layering):

1. App: one producer computes the chosen number - rolling power from `readHighRate` (a) or a
   windowed average - exactly where `trend_c_per_min` would be produced if anyone produced it.
   Note the pipe for a **derived, slow** app number already exists end to end and is currently
   empty: `trend_c_per_min` crosses `governorInputs.ts:146` -> `rn-governor-params.cpp:87` ->
   `llama-ext.h:276` and is consumed at `llama-governor-policy.cpp:139` - with value 0 always.
2. Binding: one field added to `parse_governor_thermo` (`rn-governor-params.cpp:81-90`) - the
   transport is a field-for-field copy by design, so this is a mechanical line.
3. Engine: the field added to `llama_governor_thermo_profile` (`llama-ext.h:269-277`) and one
   consumption site, chosen among the existing slow consumers: the `batt_level_pct` gates
   (`llama-governor-policy.cpp:125, :158`), `select_decode` eligibility (`:244-249`), or the
   `cool_pays` / `cool_delta_measured` params inputs (`llama-ext.h:251, :257`) that today are
   `Unknown`/`false` and never fed by energy evidence. Thresholds stay in the engine's named
   constants (`:8-15`); no new threshold should be born in the app.
4. Chain: engine ref -> binding `vendor/VERSIONS` bump -> app `package.json` pin + lockfile ->
   provenance gate (`scripts/assert-engine-provenance.sh`) -> APK, i.e. the same five-step order
   recorded in `COORDINATOR-STATE.md` landing checklist, plus pin tests in
   `tests/test-governor-v02-router.cpp` (the pattern used for the consolidation).

---

## 4. Ranked, bounded proposal

### Option 1 (rank 1) - the "more sensitive governor" without the Meter: produce `trend_c_per_min`, stop discarding `SEVERE`

- **Minimal change**: app only. Compute the trend the contract already carries (temperature delta
  over the existing `readGovernorThermo` polls, emitted at `governorInputs.ts:146` instead of 0),
  and optionally surface the platform `SEVERE` status that is already in JS and thrown away
  (`APP/src/engine/platformThermalStatus.ts:40-55` maps everything below the hard gate to `false`;
  `energy-instrumentation/REPORT.md` §E.2 item 1 documents the attach points).
- **Cost**: one app file (plus tests). No engine, no binding, no pin chain, no schema version.
  The engine side is **already written and pinned**: the drift/escalation consumer at
  `llama-governor-policy.cpp:139` with `k_trend_c_per_min`, and its pin test
  ("drifting plugged baseline invalidates profile", `tests/test-governor-v02-router.cpp:169`).
- **What could break**: a wrong or noisy trend makes WARM escalate to COOLMODE early (refusing
  GPU prefill when it should not) or never (the current state, i.e. no change). Poll cadence is
  per completion round (`LlamaService.ts:4798`), so resolution is `0.1 C` over seconds-to-minutes
  - coarse but honest.
- **The one measurement that falsifies it**: compute trend offline from two archived sessions'
  `KALSA_GOVERNOR_THERMO`/battery logs and ask whether rising and flat windows separate at the
  tenths-of-a-C quantisation. If rising vs flat cannot be told apart at that resolution, the
  "more sensitive governor" branch has no sensitivity either, and the honest answer is that the
  governor stays where it is.

### Option 2 (rank 2) - the "cheap Meter" branch: arm the Meter on the release APK, decisions unchanged

- **Minimal change**: one writer for `kalsa.bench.energy_trace` (deep link case or Settings bench
  toggle - `bench-apk/REPORT.md` §5 items 1-2, both reusing existing plumbing), and, to remove
  `run-as` from the read side, the external-files or in-app-export variant (item 3). The debuggable
  bench build (`KALSA_DEBUGGABLE`, §1.4 point 5) remains the belt-and-braces route for store access
  but stops being a requirement for energy.
- **Cost**: app-only, two small changes; the native sampler, the CSV schema, the host parsers and
  five archived reference CSVs already exist. Governor untouched - the Meter is a **measurement
  instrument**, which is what it has ever been.
- **What could break**: shipping a hidden arming channel in a release build (a disclosure/product
  decision, `energy-instrumentation` §F.2 "product decisions"); background freeze killing the
  thread (no foreground service, `app.config.js:35` - screen-on cells only).
- **The one measurement that decides whether this branch is even allowed**: the **sampler overhead
  A/B** - same workload, trace on vs trace off, compare mean discharge. The self-defeating bar,
  stated as the requested fraction: overhead_fraction = sampler's mean added draw / the turn's own
  draw. At the Meter's own measured Jelly turn draw of **1,045 mA median**
  (`meter-close/REPORT.md` §(c)), 1 % is **~10.5 mA** and 5 % is **~52 mA** continuous; equivalently
  the turn spends **~17.4 mAh/min**, so an overhead of 0.17 mAh/min is 1 %. If the 1 Hz
  `HandlerThread` (6 property/intent reads + one buffered flush per second) costs a visible
  fraction of that, the architecture is self-defeating and the Meter stays a bench tool. **No
  measurement of the Kotlin sampler's own consumption exists anywhere I could find** - this is the
  number being measured on the phone tonight, and it is the right number. The only archived cost
  figure in this family is the *host shell* sampler's pre-fix cost: "12 forks per sample cost
  ~0.28s CPU (~28% of one core)" (`APP/scripts/energy-sample.sh:7-10`) - proof that sampling cost
  is a real hazard, not that the Kotlin sampler shares it.

### Option 3 (rank 3) - conditional lean: transport ONE slow energy number, consumed only beside the existing slow gates

- **Minimal change**: the four-step travel in §3.3: one app producer, one binding parse line, one
  struct field, one consumption site chosen among `batt_level_pct` gates / `select_decode`
  eligibility / `cool_pays` evidence. The number to transport is **rolling power (W) or mAh/min
  over a minutes-scale window**, never a per-turn total (§3 candidate (c) does not exist).
- **Cost**: three repos + the five-step pin chain + pin tests; the consolidation precedent shows
  this shape lands in tens of lines (`governor-policy-consolidate/REPORT.md` §3: +50/-34 app,
  +0/-6 binding, comment+test only in engine).
- **What could break**: (i) any field added inside `profile_is_valid` can turn a missing reading
  into `Invalid` -> `Abort`, i.e. the sticky-failure class of defect 5.2 - so the energy field must
  be **optional and outside the validity gate**; (ii) `valid_schema` (`llama-governor-policy.cpp:28`)
  pins `schema_version` - params additions must keep it coherent across binding and engine;
  (iii) the triplication trap: the energy rule must be produced raw and decided once.
- **The one measurement that falsifies the lean**: a **decision-flip replay**. Archive a few
  sessions of (level, temperature, trend, rolling power) - the Meter already produces two of these
  per second - then replay `prefill_engine`/`select_decode` offline with and without the energy
  field. If the energy field flips **zero** decisions that level + temperature do not already
  flip, the governor gains nothing from the Meter and branch B (Option 1, Meter stays on
  development builds) is the answer. This replay is cheap precisely because the policy is a pure
  function of the profile today (`llama-governor-policy.cpp:42-264` reads only `profile_` and
  `params_`).

### Option 4 (rank 4, rejected before building) - per-turn energy routing (the full "lean")

The governor would need a per-turn mah/Wh total to price the next turn's route. That number cannot
be produced at turn boundaries: the charge counter steps in device-dependent chunks of
29,460 uAh (Jelly, counted from archived CSVs), 33,750 uAh (S23, measured with a delta = 0 bracket)
and 3,750-15,000 uAh (t20c host trace), against turns that burn 0-1.5 steps' worth of charge.
`current_avg` is host-only and unit-ambiguous. **Falsified by existing archives; no build required.**
If this option ever returns, it returns only after a per-device unit calibration and a
minutes-scale window, which is Option 3 by another name.

---

## 5. The soundness question, stated first

Energy is a slow, derived signal: the fuel gauge smooths over ~1 s (`GovernorBatteryModule.kt:238`),
the counter ticks in chunks, and the joule number is an integral of a quantity that only becomes
meaningful over minutes. A governor acting on it inside the turn it is spending is acting on a
lagging indicator of its own decision. So:

**This helps here** - decisions whose consequences live in the *next* minutes:

- **The next turn's admission**, where the engine already prices chunks in temperature
  (`k_table_tokens` / `k_cpu_delta_c`, `llama-governor-policy.cpp:14-15`): an energy analog - a
  session mAh budget - would let a low-battery phone take the slow-but-cheap route with a number
  finer than `batt_level_pct` (`:125, :158`), which moves in ~1 % bricks.
- **Whether to keep the model resident / keep the GPU lane warm**: `select_decode`'s flip window
  (`k_flip_window_ms`, `:9`) and `reload_budget_available` are already cross-turn economics. Idle
  drain vs reload cost is exactly an energy question, and the signal's lag is longer than the
  decision's horizon.
- **Filling `cool_pays` / `cool_delta_measured`** (`llama-ext.h:251, :257`): the policy's `Unknown`
  answers to "does the cool route actually pay" are an evidence gap, and post-hoc energy
  measurement is the honest way to close it - retrospective use of a lagging indicator is sound.

**This does not help there**:

- **Inside the turn**: `admit_prefill`'s per-chunk loop and the `prefill_engine` route latch
  (`llama-governor-runtime.cpp:40-99`) are decided before the consumption they cause exists;
  feeding them energy means feeding them the *previous* turn's energy, which is a learning rule,
  not a control loop - it needs hysteresis or it flaps the GPU/CPU route every turn, and
  `k_flip_window_ms` exists precisely because flipping is expensive.
- **As a safety interlock**: temperature and current respond in seconds; energy integrates. The
  thermal state machine (`llama-governor-policy.cpp:117-152`) is the interlock, and the
  validity gate must stay a *validity* gate - adding a slow derived signal to `profile_is_valid`
  would convert a lag into a sticky `Abort`, the exact defect class 5.2 was.
- **On its own**: the governor has not yet engaged on a device at all
  (`s23-governor-smoke/REPORT.md:314`), and the stall that motivates all of this reproduced on the
  shipped build with **zero** energy data (`jelly-rerun/REPORT.md` §12). Leaning on the Meter is
  downstream of an engagement that is still open.

Short version: **the Meter is sound as evidence and as a cross-turn budget; it is unsound as a
within-turn control signal.**

---

## 6. What I could not verify

1. **The sampler's own consumption.** No A/B, no figure, anywhere on disk. The branch decision
   (release-Meter vs dev-Meter) is blocked on it; it is the number the phone was measuring tonight.
2. **`current_avg` in the app.** The task premise says the app samples it; the code does not
   (grep, §3 correction). If a `current_avg` app-side read exists somewhere outside
   `APP/src`, `APP/native`, `APP/scripts` (e.g. a built artifact), I did not find it.
3. **Unit conventions per device.** `current_uA`'s header itself says "property-documented unit,
   calibrate per device" (`GovernorBatteryModule.kt:346`); S23 measured mA-vs-uA ambiguity
   (`energy-instrumentation` §C.3); Jelly and the t20c device were never calibrated against
   delta-charge.
4. **Whether the consolidated layering is pushed/landed.** Refs verified local only; I did not
   query remotes (`git branch --contains` local). The release tag content versus these refs was
   not re-derived.
5. **Whether the governor will engage at all** on the current chain (open item 11, `PLAN.md:567`),
   and whether the cool-state repeat that would unblock the thermal limb has run - last record
   says it was not set up because the APK was not debuggable (`docs/ALIVE.md` instrument note).
6. **`BATTERY_PROPERTY_ENERGY_COUNTER` support** on any of the three devices - inherited
   unverified from `energy-instrumentation/REPORT.md` §G, still unverified.
7. **How the trace file behaves under background freeze** (no foreground service; expectation only,
   not measured).
8. **Jelly pack capacity** - needed to express the 29,460 uAh step as a percentage; not found on
   disk, so I state the step in uAh only.

---

## THE MAP

| # | fact | where |
|---|---|---|
| 1 | Meter native sampler (HandlerThread, per-row flush, 1 Hz, voltage) | `kalsa/native/GovernorBatteryModule.kt:111,237-260,291-311,344-352` |
| 2 | CSV schema v2: `t_s,elapsed_realtime_ms,wall_clock_ms,current_uA,charge_counter_uAh,voltage_mV,<3 status cols>` | `GovernorBatteryModule.kt:344-352`; verbatim copy + 24-row proof: `scratchpad/agents/meter-close/REPORT.md` §(c) |
| 3 | Cadence 1 Hz (JS), 200 ms floor (native), 1 s gauge smoothing | `governorBatterySampler.ts:14`; `GovernorBatteryModule.kt:337,238-239` |
| 4 | File: `documentDirectory + energy/<wallclock_ms>-t<turnId>.csv`, one per turn | `governorBatterySampler.ts:37-41`; `LlamaService.ts:4584-4587` (start), `:5412` (stop) |
| 5 | Arming: bench key, reader at `governorBatterySampler.ts:11,26,81`; **no in-app writer** | grep today; `bench-apk/REPORT.md` §5.2 |
| 6 | Arming writer = host `sql_write` through `run-as` | `scripts/ci-lib.sh:119`; recipe `jelly-rerun/REPORT.md` §9.2 |
| 7 | `run-as` needs debuggable; shipping APK verified non-debuggable (`grep -c debuggable` = 0) | `jelly-rerun/REPORT.md` §11 D1; `bench-apk/REPORT.md` §2 |
| 8 | Hand-edit debuggable flag destroyed by clean prebuild; tracked `KALSA_DEBUGGABLE` gate + plugin + CI wiring proven | `app.config.js:71-73`; `plugins/withDebuggableRelease.js`; `PLAN.md` instrument lesson; `bench-apk/REPORT.md` §1, §3 |
| 9 | Channels that exist / do not (deep link, bench panel, external files) | `bench-apk/REPORT.md` §5 |
| 10 | Observation struct: 7 fields | `kalsallama/src/llama-ext.h:269-277` |
| 11 | Field producers: Kotlin reads, TS latch+gate+trend-default-0 | `GovernorBatteryModule.kt:60-80`; `governorInputs.ts:126-146` |
| 12 | `trend_c_per_min` has no producer, always 0 | grep today; `energy-instrumentation/REPORT.md` §E.3 |
| 13 | Transport chain app -> JSI -> parse -> engine, thermo pushed at load and per completion round | `LlamaService.ts:1651-1658,2312,2329,4798,5253`; `RNLlamaJSI.cpp:42-44,239-244`; `rn-governor-params.cpp:75-91`; `rn-governor.cpp:72-79`; `llama-governor-runtime.cpp:178-183` |
| 14 | Validity gate | `llama-governor-policy.cpp:53-64` (+ binding structural `rn-governor-params.cpp:93-101`) |
| 15 | Drift rule + latch + unplug clear | `llama-governor-policy.cpp:97-111` (pin test `tests/test-governor-v02-router.cpp:169`) |
| 16 | Classification and state machine, named constants | `llama-governor-policy.cpp:8-15,42-50,66-78,117-152` |
| 17 | Prefill routing decision point | `llama-governor-runtime.cpp:40-61` -> `llama-governor-policy.cpp:155-188`; chunking `runtime:74-99`, `policy:190-232`; decode `policy:234-264` |
| 18 | Energy number's only sources today: host scripts (J = int I*V) and bracketed delta-Q | `scripts/energySchema.mjs:54-60`; `energyPhaseSplit.mjs:410,474`; formulas inventoried in `energy-instrumentation/REPORT.md` §B.3 |
| 19 | Charge-counter resolution wall (per-turn delta unresolvable) | counted from `meter-close/raw/coordinator-verify/*.csv` (29,460 uAh steps; t1 delta = 0); `energy-instrumentation/REPORT.md` §C.3 (33,750 uAh, 300 s bracket delta = 0) |
| 20 | `current_avg` is host-only (`device-energy-trace.sh:61,100`), empty in all 552 rows of `kalsa/out/t20c-gate-20260916/energy-trace.csv`, unit device-dependent | grep today + `energy-instrumentation/REPORT.md` §C.2-3 |
| 21 | Layering mandate: app measures, binding transports, engine decides; consolidation on local refs | `governor-policy-consolidate/REPORT.md` §1-3; `COORDINATOR-STATE.md:260-264`; `git branch --contains 0db9dc68` |
| 22 | Governor off by default; last device engagement refused | `governorRuntime.ts:15-21`; `s23-governor-smoke/REPORT.md:314,365`; `PLAN.md` open item 11 |
| 23 | Meter output that actually covers a completed turn (5 CSVs, 712 lines) | `scratchpad/agents/meter-close/raw/coordinator-verify/`; report §(b) ladder, §(c) proof |
| 24 | No CSV on the fixed build - trace could not even be armed | `jelly-rerun/REPORT.md` §11 D1, §12, §14 |

## THE RANKING

1. **Build the sensitive governor first, without the Meter** - produce `trend_c_per_min` (the
   pipe exists and is empty), optionally stop discarding `SEVERE`. App-only, no pin chain, the
   engine consumer is already written and pinned. Falsifier: trend separable from flat at
   tenths-of-a-C resolution over existing poll cadence, yes or no.
2. **Then arm the Meter on the release APK as an instrument, not as an input** - one bench-key
   writer + a no-`run-as` pull path; debuggable stays a bench convenience, not a requirement.
   Gate: the **sampler-overhead A/B** against the measured turn draw of 1,045 mA - the bar is
   1 % (~10.5 mA / 0.17 mAh per minute), self-defeating at 5 % (~52 mA); unmeasured today, and
   this is the number that decides the owner's branch.
3. **Only if 1 and 2 are green: transport one slow number** (rolling W or mAh/min) through the
   existing thermo pipe, consumed **beside** `batt_level_pct`/`select_decode`/`cool_pays`, never
   inside `profile_is_valid`. Gate: the **decision-flip replay** - zero flips means zero value and
   the branch closes as B.
4. **Rejected before building: per-turn energy routing.** The per-turn number does not exist at
   any device's charge-counter resolution (measured steps 3,750-33,750 uAh against 0-1.5 steps of
   a turn); a lagging integral cannot gate the decision that produces it inside the same turn.
