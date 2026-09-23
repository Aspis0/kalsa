# S23 plugged governor smoke test — PHASE 1 (functional), run log

Role: CODER, device run. ONE goal: the owner's PHASE 1 on the Galaxy S23 with the phone ON THE
CHARGER — a **functional** smoke test. Does the governor engage, does the GPU path compile, does the
process survive. No energy number is taken with the cable in and `kalsa.bench.energy_trace` stays OFF.

Report file: `~/Projects/kalsa-moe-experiments/scratchpad/agents/s23-governor-smoke/REPORT.md`.
English only. No commit, no push.

Section index:

| § | content | status |
|---|---|---|
| 0 | run setup, the build, the install, the preflight, starting device state | **DONE** |
| 1 | ACTIVATION — the governor turned on through the app's own path | **PROVEN** |
| 2 | ENGAGEMENT — the load path and what the app said | **REFUSED** |
| 3 | THE GPU FOR REAL — OpenCL kernel compile on Adreno 740 | **NOT EXERCISED** |
| 4 | ONE SHORT TURN — completion and `KALSA_TELEMETRY` | **PROVEN** |
| 5 | Verdicts, one per question, with the marker that carries each | **DONE** |
| 6 | Cleanup and restoration of the phone | **DONE** |

---

## 0. Run setup, the build, the install, the preflight

### 0.1 Devices, and which one this run touched

```
adb devices -l
  192.168.1.82:5555                             device  model:Jelly_Star   transport_id:25
  adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp  device  model:SM_S911U     transport_id:27
```

Every adb call in this run carries `-s adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp` (or
`ANDROID_SERIAL` set to it). **The Jelly Star was not touched.** It appears only in `adb devices`
above, which is unavoidable listing output — no `adb -s 192.168.1.82:5555`, no
`adb disconnect`, no `adb kill-server`.

Device under test, read with adb at the start of the run:

```
ro.product.model          SM-S911U
ro.board.platform         kalama           (SM8550, Adreno 740, Hexagon v73)
ro.build.version.release  16     sdk 36
ro.build.display.id       BP2A.250605.031.A3.S911USQS6EYL1
/proc/meminfo MemTotal    7243748 kB       (= 7 417 597 952 B, 6.91 GiB)
dumpsys battery           AC powered: true   USB powered: false
                          level: 100   status: 5 (full)   temperature: 294–304 (29.4–30.4 °C)
Thermal Status            0
```

Charge state: **AC powered true, status full, level 100**. The cable is in and stays in. Per the
project rule this run takes **no energy numbers**; the level/temperature reads above are for the
record only, and `kalsa.bench.energy_trace` is verified absent in §0.4.

### 0.2 The build, hashed before and after

Source artifact (`adb install -r` only; never uninstall, never clear app data):

```
/Users/marco/Projects/kalsa-wt-build-fixes/android/app/build/outputs/apk/release/app-release.apk
  size   159 255 122 bytes
  sha256 fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12   (before install)
```

What the APK carries, read out of the artifact itself before installing it:

| check | value |
|---|---|
| `assets/app.config` → `engineBuildId` | `kalsa-eng-v2:ea29410fe22ba889113df5344305190b1b631c0f31a54063149210730c618853` |
| `assets/index.android.bundle` → `KALSA_GOVERNOR_FAILED` | 1 occurrence |
| same → `KALSA_GOVERNOR_FALLBACK` | 2 |
| same → `KALSA_GOVERNOR_THERMO` | 1 |
| same → `KALSA_NATIVE_VARIANT` | 1 |
| same → `KALSA_TELEMETRY` | 1 |
| same → `t_idle_tenths_c`, `failure_reason` | 1 each |
| `lib/arm64-v8a/librnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl.so` | present, 772 584 B |
| `lib/arm64-v8a/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so` | present, 13 606 272 B |

The **engine pin** the build ran with, read from the build worktree not from the APK:

```
/Users/marco/Projects/kalsa-wt-build-fixes/node_modules/llama.rn/vendor/VERSIONS
  # LOCAL OVERRIDE (2026-09-21, build-with-fixes). The tree under vendor/llama.cpp
  # is a LOCAL commit of the fork, exported with
  #   git -C /Users/marco/Projects/kalsallama archive 1068eb03d
  # (branch kalsa-gpu-opencl-v73)
  LLAMA_CPP_REF=1068eb03d301a1dcb657f4e6923fe77678e651ee
```

READ IN THE CODE, in `~/Projects/kalsallama`:

```
git merge-base --is-ancestor 2b1ee43ab 1068eb03d   -> YES   (5.3 route by requested engine)
git merge-base --is-ancestor f2073505e 1068eb03d   -> YES   (5.1 pause instead of CPU fallback)
git merge-base --is-ancestor 61db879b8 1068eb03d   -> YES   (5.2 clear latched baseline on unplug)
git show --stat 1068eb03d
  ggml/src/ggml-opencl/CMakeLists.txt       |  10 ++
  ggml/src/ggml-opencl/cl-program-cache.cpp |  81 +++++++++
  ggml/src/ggml-opencl/cl-program-cache.h   |  31 +++-
  ggml/src/ggml-opencl/ggml-opencl.cpp      | 264 ++++++++++++
  src/llama-governor-policy.cpp             |   5 +-
  tests/test-opencl-moe-roundtrip.cpp       |  82 ++++++++++
```

So the artifact carries an engine that contains all three governor fixes plus the OpenCL change.

The **app-side** changes are in the worktree, and `git diff` there is small and exactly what the
owner described (`git rev-parse HEAD` = `e5788cfee46dd76dacd6893913d6c5f67b6ec762`):

```
 M src/engine/governorInputs.ts   (the only source file changed for this build)
-const EIGHT_GIB = 8 * 1024 * MIB;                          ← the total-RAM gate, REMOVED
-  if (typeof total !== "number" || total <= EIGHT_GIB) return "NoFit" as const;   ← the gate itself, REMOVED
-  V73: false, // never measured in-app
+  V73: true, // owner decision 2026-09-21: enabled in production …
-    gpu_prefill_measured: generation === "V75" || generation === "V79",
+    gpu_prefill_measured:
+      generation === "V73" || generation === "V75" || generation === "V79",
```

The app half of defect 5.2 lives in the native module and is present in this build — the plug-in-edge
latch, READ IN THE CODE at `native/GovernorBatteryModule.kt` (`android/app/src/main/java/com/kalsa/app/GovernorBatteryModule.kt`
is byte-identical to it, verified by `diff`):

```
 37    // Latched plugged baseline in tenths of a degree C: set on the plug-in edge,
 38    // held for the whole plugged session, cleared on unplug. The engine offsets
 39    // every plugged threshold from this value, so it must not track the live
 40    // battery temperature.
 41    private var idleBaselineTenthsC: Int? = null
 ...  inside readThermo(promise):
 66            if (plugged) {
 67                if (idleBaselineTenthsC == null && present && temperature > 0) {
 68                    idleBaselineTenthsC = temperature
 69                }
 70            } else {
 71                idleBaselineTenthsC = null
 72            }
 78            result.putBoolean("t_idle_valid", idleTenths != null)
 80                result.putInt("t_idle_tenths_c", idleTenths)
```

The latch is set inside `readThermo` itself, not by a broadcast receiver, so it fires on the **first
call** while the phone is already plugged. The plugged run therefore has a real chance at a valid
`t_idle` even though the cable went in hours before the app started. That is the app half of 5.2 as
built; whether it is enough is §2.

### 0.3 The install

```
adb -s <S23> shell am force-stop com.kalsa.app     # app was already stopped; belt and braces
adb -s <S23> install -r <APK>
  -> Performing Streamed Install
  -> Success
```

Nothing else was done to the package: no `uninstall`, no `pm clear`, no `-d`, no data wipe.

Post-install verification — the hash on the device equals the hash of the build artifact, byte for byte:

```
adb -s <S23> shell pm path com.kalsa.app
  -> package:/data/app/~~snvxplR7XmhaD3hXKmizxQ==/com.kalsa.app-Bwi60dCyzgJDiTKnr9n4dA==/base.apk
adb -s <S23> shell sha256sum <that path>
  -> fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12   ← identical to the build

dumpsys package com.kalsa.app
  versionName=0.1.0
  flags=[ DEBUGGABLE HAS_CODE ALLOW_CLEAR_USER_DATA ]
  lastUpdateTime=2026-09-21 16:04:10
  firstInstallTime=2026-08-15 20:52:25        ← unchanged: the app data survived the -r install
```

| | before (installed build) | after (this build) |
|---|---|---|
| sha256 of on-device base.apk | `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c` | `fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12` |
| `lastUpdateTime` | 2026-09-20 21:52:10 | 2026-09-21 16:04:10 |
| `firstInstallTime` | 2026-08-15 20:52:25 | 2026-08-15 20:52:25 (unchanged) |

The `245c514c…fff3c` pre-fix policy build the owner predicted is exactly the one that was installed.
**Confirmed by measurement, not assumed.**

### 0.4 Starting device state, and the key store before anything was armed

`kalsa.governor.enabled` was **not** written by hand at the start; the store was read first:

```
sql> SELECT key,value FROM catalystLocalStorage WHERE key LIKE 'kalsa.%'
kalsa.governor.enabled         ABSENT      (readGovernorEnabled() → false)
kalsa.bench.governor_force     ABSENT
kalsa.bench.thermo             ABSENT
kalsa.bench.energy_trace       ABSENT      ← the phase-2 instrument is OFF, as required
kalsa.model.id                 qwen3.5-4b
```

`kalsa.model.id = qwen3.5-4b` matters: that model has `files/models/qwen3.5-4b/mmproj-F16.gguf`
present, and `mmprojPath` alone refuses the governor (`LlamaService.ts:2331`, `!options.mmprojPath`).
The model must be switched to **LFM2.5-2.6B** for the governor to be reachable at all, so the run
drives the UI rather than the store wherever it can.

Total row count in the store: 39 (preflight, below).

### 0.5 The functional preflight — PASS, and it says the UI can be driven

```
OUT=/tmp/s23-phase1/preflight bash scripts/device-preflight.sh
PASS: exactly one attached non-emulator device (adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp)
PASS: debuggable APK, run-as id="uid=10347(u0_a347) …"
PASS: database read path, catalystLocalStorage count=39
PASS: stopped-app write/read/delete round-trip
PASS: uiautomator dump + input text usable (nodes=23)
PASS: host sqlite3 (3.51.0 2025-06-12)
PASS: battery level=100, USB powered: false, temperature=30.3 °C
```

Two notes for the record:

- The gate that fires on a plugged phone keys on `USB powered`, and this charger reports through
  `AC powered: true` / `USB powered: false`, so not even the WARNING at `device-preflight.sh:155`
  printed. The plugged state is nevertheless real and was confirmed independently in §0.1.
- `PASS: uiautomator dump + input text usable` is the one that decides how §1 is done: the real
  Settings toggle **is** drivable, so the store is not needed for the switch unless a specific step
  fails. Which one is used is stated plainly in §1.

### 0.6 What this run will NOT do

No `run-t20c.sh`, no `device-ciswire-cache.sh`, no `device-energy-sweep.sh`, no
`device-energy-trace.sh`, no `device-decode-lineup.sh` — every one of those aborts or stamps the run
invalid while charging, correctly, because they produce numbers. Phase 1 produces no numbers.
`kalsa.bench.energy_trace` stays absent for the whole run; §0.4 is its proof at the start and §6
will re-check it at the end.

### 0.7 Evidence on disk

```
/tmp/s23-phase1/
  preflight/preflight.txt        the PASS transcript above
  logcat-full.txt                the marker watcher (started in §1), full threadtime capture
  …                              screenshots / UI dumps as they are taken
```

Harness and logcat processes started by this run are killed at the end of §6, and any bench key armed
for the test is deleted (§6 re-reads the store to prove it).

---

## 1. ACTIVATION — the governor turned on through the app's own path

### 1.1 How it was turned on: the REAL UI TOGGLE, not the store

The settings screen was reached by hand through the app's own navigation (drawer via the `Menu`
button → `Impostazioni`) and scrolled until the switch appeared. The switch is a genuine
`android.widget.Switch` with the i18n label from `src/i18n/it.ts:130`, `"Governor termico (sperimentale)"`:

```
before tap
  <node class="android.widget.Switch" content-desc="Governor termico (sperimentale)"
        checkable="true" checked="false" clickable="true" bounds="[829,563][969,644]" …>

adb -s <S23> shell input tap 899 603        # the centre of those live bounds

after tap
  <node class="android.widget.Switch" content-desc="Governor termico (sperimentale)"
        checkable="true" checked="true"  clickable="true" bounds="[829,563][969,644]" …>
  … and the state label next to it changed to  text="Attivo"
```

**The store was NOT used for the switch.** No `sql_write`, no hand-armed key. The only reason the
store appears anywhere in this run is to *read back* what the UI wrote, which is the independent
verification below — not to author it.

### 1.2 The write landed, verified outside the app

The app was then force-stopped (so nothing in the app's own memory could be the source of truth) and
the SQLite store was pulled and read with the repo's own `sql` helper:

```
adb -s <S23> shell am force-stop com.kalsa.app
sql> SELECT value FROM catalystLocalStorage WHERE key='kalsa.governor.enabled';
  -> 1
```

| key | before this run | after the UI toggle |
|---|---|---|
| `kalsa.governor.enabled` | ABSENT (`readGovernorEnabled()` → false) | **`1`** |
| `kalsa.bench.governor_force` | ABSENT | ABSENT — **no bench key was armed at all** |
| `kalsa.bench.thermo` | ABSENT | ABSENT |
| `kalsa.bench.energy_trace` | ABSENT | ABSENT |

This matters for the interpretation of §2: the governor had **no help**. `kalsa.bench.governor_force`
is absent, so nothing about the attempt can be blamed on, or credited to, a bench override. V73 is
now reached through the production table entry `GPU_PREFILL_CORRECT[V73] = true` alone.

### 1.3 The load path really did consult the governor

The key landing in the store is not by itself proof that the engine-load path read it. The proof is a
marker that can only be emitted when it did. `KALSA_GOVERNOR` is gated on
`activeGovernorAttempted` (`LlamaService.ts:1756`, `return` when false), and that flag is set at
`LlamaService.ts:2652-2653` to

```
governorFeatureEnabled && governorBase != null && governorBase.enabled
```

with `governorFeatureEnabled = await readGovernorEnabled()` (`LlamaService.ts:2250`). So the *presence*
of a `KALSA_GOVERNOR` line proves all three: the flag was read and true, the params were built, and
`enabled` was true. That line exists:

```
09-21 16:11:38.815  15386 15463 I ReactNativeJS: KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU",
  "commit_bytes":0,"commit_ms":0,"prefill_ms":0,"prefill_chunks":"","prefill_ctx_ngl":0,"forced":false,
  "thermal_state":"Unknown","thermo_source":"battery","fit":"NoFit",
  "fallback_reason":"governor not eligible","failed":false,"failure_reason":""}
```

`"forced":false` is the second, independent confirmation that no bench force key was in play.

### 1.4 VERDICT — ACTIVATION: **PROVEN**

| question | answer | marker that carries it |
|---|---|---|
| turned on through the app's own path | yes, the real `<Switch>` | `checked="false"` → `checked="true"` + label `Attivo` + `kalsa.governor.enabled = 1` |
| the load path used it | yes | `KALSA_GOVERNOR` at 16:11:38.815 — only emittable when `activeGovernorAttempted` is true |
| no bench override involved | yes | `kalsa.bench.governor_force` ABSENT, `"forced":false` |

**What a silent failure would have looked like here:** the switch flips and the label says `Attivo`
(the UI is optimistic — `handleToggleGovernor` sets state before the write, `SettingsScreen.tsx:499-503`),
the app looks enabled in Settings, and *no* `KALSA_GOVERNOR` line is ever printed for the session,
with `nGpuLayers` 0. That state is indistinguishable in the UI from a real activation, and the only
way to tell them apart is the read-back in §1.2 plus the per-turn line. It is also the state the
pre-fix build would have produced entirely on its own.

---

## 2. ENGAGEMENT — what the app said on the load, with the cable in

### 2.1 The full marker set from the model load and the turn

Model load (LFM2.5 2.6B, the model switched to in §2.4), all in process `15386`:

```
09-21 16:09:46.746  ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'
09-21 16:09:51.295  ggml_opencl: kernel cache enabled at '/data/user/0/com.kalsa.app/cache/llama.cpp/cl-cache'
09-21 16:09:52.512  KALSA_NATIVE_VARIANT {"androidLib":"rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl","nGpuLayers":0}
```

Turn 1, the same process:

```
09-21 16:11:38.792  KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":1949,"tokensEvaluated":1852,
  "tokensPredicted":96,"draftTokens":0,"draftAccepted":0,"promptMs":567.441,"predictedMs":5798.54,
  "predictedPerSecond":16.55589165548569,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":26}
09-21 16:11:38.815  KALSA_GOVERNOR {"engine_prefill":"CPU","engine_decode":"CPU","commit_bytes":0,
  "commit_ms":0,"prefill_ms":0,"prefill_chunks":"","prefill_ctx_ngl":0,"forced":false,
  "thermal_state":"Unknown","thermo_source":"battery","fit":"NoFit",
  "fallback_reason":"governor not eligible","failed":false,"failure_reason":""}
```

Marker census over the whole capture (the watcher started at 16:05 and ran to the end of the turn):

| marker | occurrences | reading |
|---|---|---|
| `KALSA_NATIVE_VARIANT` | 1 | `nGpuLayers: 0` — a plain number, **not** `{"prefill":99,"decode":0}` |
| `KALSA_GOVERNOR` | 1 | `fit:"NoFit"`, `fallback_reason:"governor not eligible"` |
| `KALSA_GOVERNOR_FALLBACK` | 0 | absent, and expected to be absent — see §2.3 |
| `KALSA_GOVERNOR_FAILED` | 0 | the governor never attached, so there was nothing to fail |
| `KALSA_GOVERNOR_THERMO` | 0 | `setGovernorThermo` was never called (only happens when `activeGovernorActive`) |
| `KALSA_GPU_FALLBACK` | 0 | expected: it is reachable only when `initLlama` throws with `n_gpu_layers > 0` |
| `KALSA_STALL` | 0 | no stall |

### 2.2 Why the `nGpuLayers` shape decides this

`nGpuLayers` is `0`. Had the governor attached, the load would have taken the 99-layer prefill shape
and the log would read `{"prefill":99,"decode":0}` instead. `0` in the plain-number form is the
non-governor CPU path, which `LlamaService.ts:2421` and `:2442` force twice for a disabled or refused
governor. So the GPU lane was not taken, and this is visible in the *shape* of the value, not just
its magnitude.

### 2.3 The refusal is stated in words the app chose, and it is not about the thermo profile

`fallback_reason` comes from exactly one place, `LlamaService.ts:2656-2660`:

```
if (activeGovernorAttempted && !governorLoad && !activeGovernorFallbackReason) {
  activeGovernorFallbackReason = governorThermo?.sensor_valid
    ? "governor not eligible"
    : "governor: thermo profile invalid";
}
```

The emitted string is `"governor not eligible"`, which is the **`sensor_valid === true`** branch.
That is a real, positive statement about the plugged run: the battery-backed thermo profile passed
`sensor_valid`, and the app did **not** blame the charger or an invalid profile. `thermo_source:"battery"`
says the reading came from the native `GovernorBattery` module, not from a bench skin
(`readGovernorThermo`, `governorInputs.ts:187-200`).

### 2.4 The plugged case, defect 5.2, stated exactly

This is the sentence the run was for, and it has to be read at the right strength.

**What the run PROVES about 5.2:** with the cable in and the phone reporting `AC powered: true`,
`level 100`, `status 5 (full)`, the governor attempt was **not refused because of the charger**. The
app read the battery state (`thermo_source:"battery"`), judged the profile valid
(`fallback_reason` is the eligibility branch, `governor: thermo profile invalid` was *not* chosen),
and refused for an unrelated, memory-shaped reason (`fit:"NoFit"`). On the old build this same
plugged situation was the one that silently produced a CPU-only retry with no explanation; here the
app reports a refusal and names its class.

**What the run does NOT prove:** it does **not** show the governor "proceeding while plugged",
because it did not proceed at all. It also does not exercise the engine half of 5.2 (the plugged
thermal thresholds offset from a latched idle baseline). The app half of the latch is present in the
binary (§0.2, `idleBaselineTenthsC` set on first `readThermo` while plugged), and its value would
only have reached the engine through `engine.setGovernorThermo(...)`, which is called **only** when
`activeGovernorActive` is true (`LlamaService.ts:1721`). The governor never attached, so
`setGovernorThermo` was never called, so **the latched `t_idle` never reached the engine**. Whether the
latch produced a valid tenths value on this phone is therefore **NOT VERIFIED** — the app does not log
`readThermo`'s result, and this run has no marker that carries it. What would settle it: a
`KALSA_GOVERNOR_THERMO`-adjacent log of the `GovernorBattery` map, or a scenario in which the governor
actually attaches.

### 2.5 Why `fit` is `NoFit` — quantified on the host, labelled as a reconstruction

`fit` in that line is `activeGovernorFit = governorBase?.gpu_fit` (`LlamaService.ts:2651`), i.e. the
same value the gate tests at `LlamaService.ts:2326-2338` with `governorBase.gpu_fit !== "NoFit"`.
A `fit:"NoFit"` is therefore on its own sufficient to null `governorLoad` — this needs no help from
`streamExperts` or any other conjunct to explain the refusal.

**DEVICE MEASUREMENT:** the app reports `fit:"NoFit"` for LFM2.5 2.6B on this S23 at
`pressure.transition {"availableMb":2229}` (16:09:57) and `model.fit {"verdict":"does_not_fit",
"availableMb":3009}` (16:08:12, a different gate, `evaluateModelFit`).

**HOST RECONSTRUCTION (not a measurement)** — `gpuFit` re-implemented with the constants read from
`src/engine/memoryEstimate.ts` at the build's commit, inputs from `ModelRegistry.ts:266 ff`
(`sizeBytes 1_593_894_944`, `kvBytesPerToken 6656`, `engineCtx 8192`) and
`deviceTuning.ts:244` (`ubatch 256`), default load policy `{mmap: true, repack: true}`
(`loadPolicy.ts:37`):

```
weights        1520.1 MiB
repack (anon)  1360.6 MiB   = 1520.1 x REPACK_FRACTION (0.89513)
compute         249.0 MiB   = 256 x 249/256
kv               52.0 MiB   = 8192 x 6656
nonEvictable   1661.6 MiB
───────────────────────────────────────────────────────────────
gpuReserve     2396.1 MiB   = 800 + 1.05 x 1593894944/MiB     ← governorInputs.ts:110
requiredMiB    4358.7 MiB   = nonEvictable + gpuReserve + compute + kv

available 2229 MiB -> NoFit      available 3009 MiB -> NoFit      available 3536 MiB -> NoFit
available 2743 MiB -> NoFit      available 3347 MiB -> NoFit

break-even (available memory at which gpu_fit turns Fit):  4359 MiB = 4.26 GiB
S23 MemTotal: 7243748 kB = 6.91 GiB
```

Read plainly: the S23 would need ~4.26 GiB **free** for the governor to reach `Fit` on this model,
and it had 2.2–3.0 GiB. Note also that the required figure is not a total-RAM test at all — the
removed `total <= 8 GiB` gate would have refused this phone on its *total* memory, while the surviving
arithmetic refuses it on *available* memory against a requirement whose largest single term is the
2.4 GiB GPU reserve. The gate moved; it did not disappear.

`forced` cannot help here, and that is worth stating because it is the obvious next idea: `force`
enters `buildGovernorParams` only through `const enabled = force || GPU_PREFILL_CORRECT[generation]`
(`governorInputs.ts:130`). It does not touch `gpu_fit`. With V73 already `true` the force key would
have changed nothing, so arming it was not attempted.

### 2.6 VERDICT — ENGAGEMENT: **REFUSED**, and visibly so

| question | answer | marker |
|---|---|---|
| was the governor attempted | yes | `KALSA_GOVERNOR` present at all (`activeGovernorAttempted` true) |
| did it engage | **no** | `nGpuLayers: 0` (not `{prefill:99,decode:0}`); `engine_prefill:"CPU"`; `prefill_ctx_ngl: 0` |
| why | memory, not the charger | `fit:"NoFit"` + `fallback_reason:"governor not eligible"` + `thermo_source:"battery"` |
| did it fail | no | `failed: false`, `failure_reason: ""`, `KALSA_GOVERNOR_FAILED` absent |
| benchmark-visible `failure_reason` | none to show | the engine was never reached, so it had nothing to report |

**What a silent failure would look like, for next time — and note this run was NOT one, but was one
step away from it.** The refusal is only legible because `activeGovernorAttempted` is true and the
per-turn line therefore prints. Had the app not set that flag — or had the turn never run — the entire
session would have logged `nGpuLayers: 0` and nothing else: no `fit`, no `fallback_reason`, no
`KALSA_GOVERNOR_FAILED`. That is precisely the shape the owner's pre-fix build produced (§0.1: the
installed `245c514c…` build contains **zero** `KALSA_GOVERNOR_FAILED` and zero `failure_reason`
strings, per the prep report), and it is why the per-turn line, not the load, is the place a refusal
becomes visible. Second silent-failure shape, which this run avoided only because V73 is now `true`:
`KALSA_GOVERNOR_FALLBACK {stage:"correctness"}` is gated on `!governorBase.enabled`
(`LlamaService.ts:2360-2369`). A V73 device on the **old** table (`V73: false`) would have logged that
line; now that `enabled` is true the line cannot fire for V73, so the load-time silence grew one line
deaf. The refusal has moved entirely into the per-turn telemetry, and a watcher that greps only for
`KALSA_GOVERNOR_FALLBACK` at load time would now see nothing at all on this phone.

---

## 3. THE GPU FOR REAL — the OpenCL path on this Adreno 740

### 3.1 What the device and driver are, from the app's own log

The OpenCL backend initialised and named the hardware exactly:

```
09-21 16:09:46.736  ggml_opencl: selected platform: 'QUALCOMM Snapdragon(TM)'
09-21 16:09:46.746  ggml_opencl: device: 'QUALCOMM Adreno(TM) (OpenCL 3.0 Adreno(TM) 740)'
                    ggml_opencl: OpenCL driver: OpenCL 3.0 QUALCOMM build: 0676.73 Compiler E031.41.03.62
                    ggml_opencl: global mem size: 3536 MB
                    ggml_opencl: max mem alloc size: 884 MB
                    ggml_opencl: device FP16 support: true
                    ggml_opencl: khr dot product support: true
                    ggml_opencl: flattening quantized weights representation as struct of arrays (GGML_OPENCL_SOA_Q)
                    ggml_opencl: using kernels optimized for Adreno (GGML_OPENCL_USE_ADRENO_KERNELS)
                    ggml_opencl: Adreno xmem F16xF32 GEMM enabled (temporary weight prepack)
```

So the OpenCL JNI variant loaded and the Adreno 740 was accepted by the backend. This part works.

### 3.2 The program cache is ENABLED here — the prep report expected the opposite

The prep report (§4.3) predicted the Android-default **disabled** line,
`ggml_opencl: kernel cache disabled (no usable default cache directory)`, because on Android
`TMPDIR` is usually unset. The measured line is the opposite:

```
09-21 16:09:51.295  ggml_opencl: kernel cache enabled at '/data/user/0/com.kalsa.app/cache/llama.cpp/cl-cache'
```

and the directory is real on the device:

```
adb -s <S23> shell run-as com.kalsa.app ls -la cache/llama.cpp/
  drwx--S--- 3 u0_a347 u0_a347_cache 3452 2026-09-21 16:09 .
  drwx--S--- 2 u0_a347 u0_a347_cache 3452 2026-09-21 16:09 cl-cache
```

The reason is visible in the string itself: the path is under the app's **own** cache dir
(`/data/user/0/com.kalsa.app/cache/…`), not under `/data/local/tmp` or a system temp dir, so the
unprivileged app can create it. **This corrects the prep report's §4.3 prediction.** It also means the
`(device, driver)` verdict file has a writable home on this phone — which makes §3.4 sharper, not softer.

### 3.3 The kernel set was never built, so the compile question was never asked

The bulk kernel set is compiled by `load_cl_kernels` (`ggml-opencl.cpp:1545`), reached from
`ggml_opencl_buffer_type_alloc_buffer` (`:14224`), i.e. **only when an OpenCL buffer is first allocated**.
It emits one `ggml_opencl: compiling <tag>` line per program (`build_program_from_source_ex`, `:1349`).

Measured on this run:

| check | result |
|---|---|
| `ggml_opencl: compiling <tag>` lines | **0** |
| `ggml_opencl: kernel compile error` | 0 |
| `OpenCL error creating program` | 0 |
| `ggml_opencl: kernel set failed to build on …` | 0 |
| files in `cache/llama.cpp/cl-cache/` | **none** (`total 6`, empty) |
| any `verdict-*.txt` anywhere in app data | **none** (`find . -name 'verdict-*' -o -name '*.clbin'` → empty) |

`cl_program_cache_init` and the verdict *read* do run early — they sit at device init
(`ggml-opencl.cpp:7169-7175`), which is why the cache-enabled line is printed before any kernel build.
But `load_cl_kernels` never ran, because with `nGpuLayers: 0` and `engine_prefill:"CPU"` the engine
never allocated a single OpenCL buffer. The GPU was initialised and then never used.

### 3.4 The `(device, driver)` verdict: the path is armed, and it stayed empty

The new code writes the verdict next to the program cache
(`cl_program_cache_save_verdict`, `cl-program-cache.cpp:489`: `state.dir + "/verdict-" + key + ".txt"`,
contents `GGMLCLVERDICT 1 / ok= / vendor= / device_name= / driver_version= / global_mem_size= /
has_integer_dot= / written=`), and on a fresh `ok=0` record the next device init logs
`ggml_opencl: kernel set failed to build on '%s' (driver '%s'); device disabled, ops stay on CPU`
(`ggml-opencl.cpp:7175`). None of that happened, because there was no build attempt to record.

**This is the sharpest silent failure in the run, and it is worth naming precisely:** the verdict file
is guarded by `if (state.dir.empty()) { return; }` (`cl-program-cache.cpp:477`). Had the cache been
disabled — the case the prep report predicted — a failed kernel build would have recorded **nothing**,
permanently, silently. Here the directory is usable and the guard does not bite, so the file *would*
have been written on a failure. The reason the file is missing is the earlier, unhappier one: no GPU
work ever reached the compiler. An empty `cl-cache` therefore means *"the GPU lane was never entered"*,
and is indistinguishable on disk from *"the GPU lane was entered and nothing happened"* until one also
reads `nGpuLayers` and `engine_prefill`.

### 3.5 Did the process survive, and how do I know the guard was not the reason

It survived, and the guard is not why — the guard was never reached.

| what | evidence |
|---|---|
| the process that loaded the model is the process that finished the turn | pid `15386` at load (16:09:52.512) and the same pid `15386` on both turn lines (16:11:38.792/.815) |
| still alive after the turn | `adb shell pidof com.kalsa.app` → `15386` |
| no crash of any kind | 0 matches for `FATAL EXCEPTION`, `tombstone`, `SIGSEGV`, `SIGABRT` over the whole capture |
| the turn really produced output | the app's own view showed `2 + 2 = 4.` in reply to the prompt |
| the new no-`exit(1)` guard was exercised | **no — never reached.** `fatal=false` sits inside `build_program_from_source_ex`, which was never called (§3.3) |

So "the process survived" is true but says nothing about the guard: nothing put it to the test. Reporting
this as "the survival guard works" would be exactly the overclaim this run exists to avoid.

### 3.6 VERDICT — GPU PATH: **NOT EXERCISED** (refused upstream, before any compile)

| question | answer |
|---|---|
| does the Adreno 740 OpenCL device come up | **yes** — platform, device, driver build, mem size all logged |
| is the program cache usable on Android | **yes** — enabled at the app's own cache dir, correcting prep §4.3 |
| do the ~180 kernels compile on this Adreno 740 | **UNKNOWN — never attempted** (0 `compiling` lines, empty `cl-cache`) |
| did the `exit(1)` guard get tested | **no** |
| is the `(device, driver)` verdict written | **no** — `cl-cache` empty, no `verdict-*` file anywhere |

**What a silent failure would look like here**, so it is recognisable next time: a kernel compile
failure *with* the cache enabled now leaves a `verdict-*.txt` with `ok=0`, plus the next session's
`kernel set failed to build on '<device>' (driver '<driver>'); device disabled, ops stay on CPU`,
plus the process staying alive. If instead you see the process vanish mid-load with no
`KALSA_NATIVE_VARIANT`, that is the *old* `exit(1)` path and means the guard is missing from the
binary. And if you see the compiler log nothing at all and an empty `cl-cache`, that is **this** run:
not a GPU failure, but a GPU lane that was never entered — check `nGpuLayers` first, because the
symptom is identical.

---

## 4. ONE SHORT TURN

### 4.1 Getting into a conversation, because the home page is not one

The app opened on the home page, which the owner warned carries the words `Buon pomeriggio.` /
`Cosa vuoi approfondire oggi?`. It did:

```
Kalsa
LFM2.5 2.6B · QAD-Q4_0 · Pronto · locale
Web
Buon pomeriggio.
Cosa vuoi approfondire oggi?
```

The prompt was sent from a conversation created through the app's own drawer (`Menu` → `Nuova chat`),
not from the home page, then typed into the real composer
(`android.widget.EditText`, `hint="Fai una domanda…"`) and submitted by tapping the real `Invia` node
(`content-desc="Invia"`, live bounds `[909,1035][1017,1143]` → tap 963,1089). The prompt text exactly
as it appeared in the composer before sending:

```
Rispondi in una sola frase breve: quanto fa 2 piu 2
```

### 4.2 It completed

```
09-21 16:11:38.792  KALSA_TELEMETRY {"turnId":"1","round":0,"tokensCached":1949,"tokensEvaluated":1852,
  "tokensPredicted":96,"draftTokens":0,"draftAccepted":0,"promptMs":567.441,"predictedMs":5798.54,
  "predictedPerSecond":16.55589165548569,"contextFull":false,"interrupted":false,"truncated":false,"prompt_n":26}
```

| field | value |
|---|---|
| `promptMs` | 567.441 |
| `tokensPredicted` | 96 |
| `interrupted` | **false** |
| `truncated` / `contextFull` | false / false |
| `tokensCached` / `tokensEvaluated` | 1949 / 1852 |
| `predictedPerSecond` | 16.556 |
| `KALSA_STALL` | absent |
| the app's visible reply | `2 + 2 = 4.` |

`predictedPerSecond` is reported here only because it is a field of the telemetry line the app chose to
emit for a completed turn. It is a timing ratio from a **plugged functional run**, not an energy or
sustained-performance measurement, and nothing in this report should be read as a benchmark number.

### 4.3 VERDICT — TURN: **PROVEN**

| question | answer | marker |
|---|---|---|
| did the turn complete | yes | `KALSA_TELEMETRY` with `interrupted:false` at 16:11:38.792 |
| did the process survive | yes | `pidof` → `15386`, same pid as the load; 0 crash lines |
| were the numbers taken with the cable in | yes — and they are timing fields only | `AC powered: true` throughout; `kalsa.bench.energy_trace` ABSENT |

**What a silent failure would look like here:** a send that produces a `KALSA_TELEMETRY` line but with
`tokensPredicted: 0`, or no line at all while the UI keeps showing a spinner — and, per the owner's
warning, a send issued from the home page, which emits markers and no turn. The distinguishing detail
is that every real turn on this build carries a `KALSA_TELEMETRY` **and** its matching `KALSA_GOVERNOR`
line 23 ms apart; a turn that has one without the other is not a clean completion.

---

## 5. Verdicts, one per question

| # | question | verdict | the marker that carries it | timestamp |
|---|---|---|---|---|
| 1 | ACTIVATION — did the governor get turned on through the app's own path, and did the load path use it | **PROVEN** | real `<Switch>` `checked false→true` + label `Attivo`; `kalsa.governor.enabled = 1` read back with the app stopped; `KALSA_GOVERNOR` (only emittable when `activeGovernorAttempted`) | tap ~16:07:30; read-back 16:08; line 16:11:38.815 |
| 1b | no bench override involved | **PROVEN** | `kalsa.bench.governor_force` ABSENT; `"forced":false` | 16:11:38.815 |
| 2 | ENGAGEMENT — did it engage | **REFUSED** | `KALSA_NATIVE_VARIANT {"nGpuLayers":0}`; `fit:"NoFit"`; `fallback_reason:"governor not eligible"`; `engine_prefill:"CPU"` | 16:09:52.512; 16:11:38.815 |
| 2b | was the plugged state the cause (defect 5.2) | **NO — proven not to be** | `thermo_source:"battery"` with the eligibility branch of `fallback_reason`, i.e. `sensor_valid === true`; the refusal is `fit:"NoFit"` | 16:11:38.815 |
| 2c | was the latched `t_idle` valid and delivered to the engine | **NOT VERIFIED** | none — `setGovernorThermo` is unreachable unless the governor attaches, and the app does not log `readThermo` | — |
| 3 | GPU — does the OpenCL path compile on this Adreno 740 | **NOT EXERCISED** | 0 `ggml_opencl: compiling` lines; `cl-cache` empty; no `verdict-*` file | 16:09:51.295 (cache armed), then nothing |
| 3b | is the program cache usable on Android | **PROVEN — enabled** | `kernel cache enabled at '/data/user/0/com.kalsa.app/cache/llama.cpp/cl-cache'` (corrects prep §4.3) | 16:09:51.295 |
| 3c | was the no-`exit(1)` guard exercised | **NO** | the compile path was never called | — |
| 3d | did the process survive | **PROVEN** (but unrelated to the guard) | pid `15386` at load and after the turn; 0 `FATAL`/`tombstone`/`SIGSEGV`/`SIGABRT` | 16:09:52 → 16:11:38 → after |
| 4 | TURN — did one short turn complete | **PROVEN** | `KALSA_TELEMETRY {promptMs:567.441, tokensPredicted:96, interrupted:false}` + the reply `2 + 2 = 4.` | 16:11:38.792 |

### 5.1 The one-line result for the owner

The governor **activated for the first time on hardware** — the total-RAM gate is genuinely gone and a
7.42 GB phone now reaches the governor code path — and it then **refused to engage on memory**: with
the cable in, the app read the battery, accepted the plugged profile, and turned down the GPU lane with
`fit:"NoFit"` because it wants ~4.26 GiB free against the 2.2–3.0 GiB the S23 had. The GPU kernels
were therefore never compiled and never had the chance to fail: the `exit(1)` guard is unproven, not
vindicated. The charger, which is what this run was built to test, was **not** the reason for the
refusal.

### 5.2 What would move this forward, in order

1. **The `gpuFit` amortisation, not the RAM gate.** `requiredMiB` adds `computeMiB` and `kvMiB` a second
time even though they are already inside `nonEvictableMiB` (`governorInputs.ts:110-118` vs
`memoryEstimate.ts:164`). On this model that double-count is 301 MiB of the 4359. Fixing it still
leaves ~3.96 GiB required (4058 MiB), so it is a real bug but not the blocker.
2. **The 2.4 GiB `gpuReserveMiB`** (`800 + 1.05 x offloadedBytes`) is the dominant term and the one
that decides this phone. A 1.59 GB model on a 7.42 GB phone cannot satisfy it. This is the number to
question if the GPU lane is meant to run on an S23-class device at all.
3. **A marker for a null `governorLoad` that names the failing conjunct**, not just
`"governor not eligible"`. Four different conjuncts produce that one string, and on this run only the
presence of `fit:"NoFit"` in the same line told us which one fired.
4. **Log `readThermo`'s result once per load.** Without it, the app half of defect 5.2 is unverifiable
whenever the governor refuses — which is the only case the S23 can currently produce.

---

## 6. Cleanup and restoration

### 6.1 Processes started by this run

One logcat watcher was started (`adb -s <S23> logcat -v threadtime -b main,system,crash >
/tmp/s23-phase1/logcat-full.txt`). It is killed and verified gone:

```
pkill -f "logcat -v threadtime -b main,system,crash"   -> watcher killed
pgrep -fl "adb.*logcat"                               -> no adb logcat processes remain
```

No campaign harness, no sweep, no `device-*.sh` driver was started, so there is nothing else to kill.
The one-shot `scripts/device-preflight.sh` in §0.5 exited on its own.

### 6.2 Bench keys: none were armed, so none need deleting

The task's rule is *delete any bench key you arm when done*, so it is worth stating that **no bench key
was ever armed on this phone**. The sequence was: read the store (§0.4) → write nothing → drive the real
UI switch (§1.1) → read the store back (§1.2). Final store state, read cold with the app force-stopped:

```
kalsa.governor.enabled        1            ← written by the app's own Settings toggle, as instructed
kalsa.bench.governor_force    ABSENT       ← never armed
kalsa.bench.thermo            ABSENT       ← never armed
kalsa.bench.energy_trace      ABSENT       ← never armed, and OFF for the whole run, as required
kalsa.bench.thermo_enabled    ABSENT
kalsa.model.id                lfm2.5-2.6b  ← was qwen3.5-4b at the start; switched through the UI in §2.4
```

`kalsa.bench.energy_trace` is absent at the end exactly as it was at the start (§0.4), which is the
phase-1 discipline stated positively: **no energy trace was taken, and no mA or battery delta appears
anywhere in this report.**

### 6.3 Deliberate deviations from the found state, listed rather than hidden

I do not want a "left as found" claim that is quietly false. Three things are not as I found them:

1. **`kalsa.governor.enabled` is left at `1`, not deleted.** The phone was found with the key absent.
   The owner's instruction was to turn the governor on, so turning it back off would undo the point of
   the run; and doing it by hand would mean a `sql_write` to the production key, which is worse than
   leaving the app's own setting where the app's own toggle put it. **It is one tap in Settings →
   `Governor termico (sperimentale)` to revert.**
2. **`kalsa.model.id` is left at `lfm2.5-2.6b`, not `qwen3.5-4b`.** The switch was necessary (§0.4:
   the qwen bundle carries an `mmproj`, and `mmprojPath` alone refuses the governor). It was made
   through the UI, and it is reversible the same way. Note the previous model, `qwen3.5-4b`, was
   already failing to load on this phone before this run (`Caricamento non riuscito — tocca per
   riprovare`), so nothing that was working was broken by the switch.
3. **The display sleep timeout: I overwrote it and did NOT record the original. This is a mistake and
   it is NOT VERIFIED.** To keep the screen awake while driving `uiautomator` I ran
   `settings put system screen_off_timeout 1800000` (30 min) without first reading the previous value,
   and `svc power stayon true`. Both were reverted at the end — `svc power stayon false` and
   `settings put system screen_off_timeout 30000` (the Samsung default) — but **30000 ms is a guess at
   the original, not a restoration of it.** If the owner's own setting was different, it needs one
   manual change in Settings → Display → Screen timeout.

### 6.4 What was NOT done, stated for the record

| forbidden action | status |
|---|---|
| `adb uninstall` / `pm clear` / data wipe | not done; `firstInstallTime` unchanged at 2026-08-15 20:52:25 |
| `install` other than `-r` | not done; one `adb install -r`, `Success` |
| touching the Jelly Star `192.168.1.82:5555` | not done — it appears only in `adb devices -l` output, and no `adb -s 192.168.1.82:5555` was ever issued |
| `adb disconnect` / `adb kill-server` | not done — an `emulator-5554` belonging to another session appeared during the run and was left alone |
| any campaign / sweep / energy harness | not started (§6.1) |
| taking an energy number | not done; `kalsa.bench.energy_trace` absent at start and end |
| writing a file to the device that outlives the run | the only device-side file I created was `/data/local/tmp/ui.xml` (uiautomator scratch), removed at the end |
| commit / push | not done |

### 6.5 Final device state

```
pidof com.kalsa.app                              not running          (as found)
on-device base.apk sha256                        fbfe131f7150daa8e4a79c9c459673f30e272340578c455479b06abaac2d7b12
                                                 (identical to the build artifact; the pre-fix
                                                  245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c is replaced)
dumpsys battery                                  AC powered: true, USB powered: false,
                                                 status: 5 (full), level: 100     (unchanged)
cache/llama.cpp/cl-cache/                        empty — as it was before the run
app data                                         intact (firstInstallTime 2026-08-15 20:52:25)
```

### 6.6 Evidence left on disk for the reviewer

```
/tmp/s23-phase1/
  preflight/preflight.txt              the PASS transcript
  logcat-full.txt                      the full threadtime capture (whole run)
  gpufit-reconstruction.txt            the §2.5 host arithmetic + break-even
  ui-*.xml                             every uiautomator dump, in order
  0[1-4]-*.png                         screenshots (settings before/after the toggle, launch)
  markers.txt                          the turn start marker
  watcher.pid                          the killed watcher's pid
```

**Nothing in this report is a claim about a marker that was not seen.** Every line quoted with a
timestamp is copied from `logcat-full.txt` as captured. Where a conclusion comes from reading source
rather than from the device, it is labelled READ IN THE CODE or HOST RECONSTRUCTION. The things this
run could not settle — the `t_idle` latch value, whether the Adreno 740 kernels compile, the original
screen timeout — are labelled NOT VERIFIED rather than left to look settled.

