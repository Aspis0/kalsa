# RECON — S23 repack A/B timing (required fix #4 of repack-policy-review)

Worktree under test: `/Users/marco/.paseo/worktrees/1vffp1wo/s23-repack-timing`
Branch `s23-repack-timing-2026-09-21`, HEAD `964dd536f13b…` (`feat(engine): disable
ARM weight repack for qwen3.5-4b only`). Parent `5429799`.

Lab worktree (where this file lives): `/Users/marco/.paseo/worktrees/0dh4675z/gov-audit-recheck`,
branch `governor-audit-recheck`.

Device: S23, adb serial `adb-R3CW406P8CV-zyLM4b._adb-tls-connect._tcp`, model
`SM-S911U` (`ro.product.model`), 8 cores online (`0-7`), MemTotal 7,243,748 kB.
Owner session: this one. The Jelly Star and the Xiaomi are NOT touched.

Written before any timed measurement, 2026-09-21.

---

## 0. Device and power state at recon time

`adb -s <serial> shell dumpsys battery`:

```
AC powered: false
USB powered: false
Wireless powered: false
status: 3          # discharging
level: 97
temperature: 293   # 29.3 C
```

All three power sources false → the project rule (never measure under charge) is
satisfied at recon time. Every arm re-runs this check before it starts.

Models resident in the app container (`run-as com.kalsa.app ls -la files/models/`):

| dir | file | bytes |
|---|---|---|
| `qwen3.5-4b` | `Qwen3.5-4B-Q4_K_M.gguf` | 2 834 975 040 |
| `qwen3.5-4b` | `mmproj-F16.gguf` | 672 423 616 |
| `lfm2.5-2.6b` | `LFM2.5-2.6B-QAD-Q4_0.gguf` | 1 593 894 944 |

Also present: `qwen3.5-2b`, `lfm2.5-8b-a1b`, `lfm2.5-8b-a1b-kexp`, `dev-minicpm5-2b`.
Nothing is uninstalled or deleted; `adb install -r` only.

Installed package at recon time: `com.kalsa.app` versionCode 1, versionName 0.1.0
(`dumpsys package`). versionCode is not unique — see §3 for the build identity used.

---

## 1. The on-device benchmark/campaign harness

The project drives on-device model runs through **`scripts/ci-bench.sh`** with
`BENCH_TARGET=device`. It is the harness that produced every arm directory in
`device-kill-campaign/` (the `armA-…` / `armC-…` outputs are `ci-bench.sh`
artefacts: `prefs.txt`, `turnN/`, `fatal_*`). Exact commands and what each records:

### 1.1 `scripts/ci-bench.sh` — one campaign arm

```
PHASE=fase4 ARM=<label> SEED=<n> COMPACTION=off \
BENCH_TARGET=device \
MODEL_DIR=qwen3.5-4b MODEL_FILE=Qwen3.5-4B-Q4_K_M.gguf \
MMPROJ_FILE=mmproj-F16.gguf \
NOREPACK=1 \                     # 1|0|empty — the target lever (see §2)
APK_PATH=android/app/build/outputs/apk/release/app-release.apk \
scripts/ci-bench.sh
```

What it does, with file:line evidence:

- `ci-bench.sh:27-28` documents `NOREPACK`: `empty = absent = production repack on;
  1 disables weight repacking via no_extra_bufts`.
- `ci-bench.sh:388-390` writes the pref: `NOREPACK=1` → INSERT `kalsa.bench.norepack=1`;
  `NOREPACK=0` → INSERT `=0`; empty → DELETE the key.
- `ci-bench.sh:493-499` reads the pref back from the device DB and dies on a mismatch
  (both directions), so an arm cannot silently run the wrong load mode.
- `ci-bench.sh:204-205` validates the value through `validate_bench_norepack`
  (`ci-lib.sh:886`).
- `ci-bench.sh:1149 capture_turn_evidence` dumps logcat per turn into `$OUT/turn<N>/`:
  `telemetry.jsonl` (KALSA_TELEMETRY), `toolcall.jsonl`, `digest.jsonl`,
  `memory.jsonl`, `memory-extract.jsonl`, `loadprompt.txt` (KALSA_KVPREFIX),
  `prompt_meta.txt`, `thermal.txt`, `compactor_state.json`.
- `ci-bench.sh:1190-1194` writes `session-init.jsonl` from the `KALSA_SESSION ` lines —
  this is the **engine-internal load mode** sidecar (see §4).
- Pre- and post-turn `capture_sysprobe_snapshot` (see 1.3) records the process/system memory.

`ci-bench.sh` also writes a large pref matrix (compaction, thinking, format, toolchoice,
toolgate, nctx, winbudget, legacywindow, ranking, digestcadence, memory, toolhelp,
`kalsa.locale=it`) and runs a scripted multi-turn Italian conversation with tool probes.
That is a *quality* campaign, not a repack timing A/B; for the repack arms a thin
runner reusing the same primitives is used instead (§1.5). The lever, the pref
assertion and the sysprobe path are the audited parts and are reused unchanged.

### 1.2 `scripts/ci-e2e.sh` — two/three-turn app proof (emulator-shaped)

`ci-e2e.sh:1-4`: drives Kalsa, two turns in one conversation plus a restart turn.
Sets `kalsa.model.id`, `kalsa.context.compaction`, `kalsa.bench.thinking`
(`ci-e2e.sh:74-84`). It has **no NOREPACK lever**, so it is not usable for this A/B
as-is; it is listed because it is the shortest app-turn harness in the repo.

### 1.3 `scripts/ci-lib.sh` — the measurement primitives

- `ci-lib.sh:1401 install_and_sideload` — `adb install -r` (`:1416-1420`); on
  `BENCH_TARGET=device` it asserts the model is already downloaded through
  `run-as … ls -la files/models/<dir>/<file>` and returns (`:1425-1438`). It never
  pushes over the app's models on a phone.
- `ci-lib.sh:260 capture_sysprobe_snapshot <turn_dir> <pre|post> [pid]` — one remote
  `adb shell` that emits a fixed key=value body and never fails a turn. Keys it records:
  - `/proc/<pid>/status`: `VmHWM`, `VmRSS`, **`RssAnon`**, **`RssFile`**, `VmSwap`,
    `Cpus_allowed_list` (`ci-lib.sh:292-310`), plus `cpuset` (`:312-316`).
  - `/proc/<pid>/stat`: `minflt`, **`majflt`** (`ci-lib.sh:328-330`).
  - `/proc/<pid>/io`: rchar/wchar/syscr/syscw/read_bytes/write_bytes (`:333-…`).
  - `/proc/vmstat`: `workingset_refault_file`, `workingset_refault_anon`, `pgmajfault`,
    `pgsteal_kswapd/direct`, `allocstall_normal/movable`.
  - `/proc/meminfo`: `MemFree`, **`MemAvailable`**, `Cached`, `SwapCached`, `Dirty`,
    `Writeback`.
  - `/proc/diskstats` for the `/data` device; `thermal_status`; `battery_deci_c`;
    `battery_charge_uah`; `battery_level_pct`; `battery_ac_powered`
    (`ci-lib.sh:242-248`).
- `ci-lib.sh:82 sql` / `:110 sql_write` — WAL-safe read/write of the app's
  `catalystLocalStorage` (AsyncStorage) through `run-as`, with read-back assertion.
- `ci-lib.sh:1152 device_keepawake_setup` — holds the screen on for the run.

### 1.4 Supporting instruments

- `scripts/benchGrade.mjs` — grades `bench-out/raw.json` → `result.json`; resolves the
  arm's real repack mode from the turn sidecar (`benchGrade.mjs:588-640`), returns
  `no_extra_bufts` in the result (`:1023`, `:1234`). Read, not modified.
- `scripts/device-preflight.sh` — proves adb / `run-as` / WAL sqlite / UI-input on one
  phone and prints `level`, `USB powered`, `temperature`; it **warns** if
  `USB powered: true` (`device-preflight.sh:143-156`). This is the documented
  pre-run sanity gate and is run once before the arms.
- `scripts/memoryEstimateHarness.mjs` — offline harness for `estimateMemory`
  (`parseMemAvailableBytes` at `:251-268`). Its `:161-164` comment still says the UI
  gate always estimates with `repack:true`; that is stale (the live gate resolves
  model policy at `deviceProfile.ts:448-460`) and is *not* touched here.
- `scripts/device-energy-sweep.sh` (1260 lines) and `scripts/energy-sample.sh` — the
  Jelly-Star energy instrument (standalone `llama-bench`/`bmoe-cli` binaries, not the
  app). `energy-sample.sh` samples battery current/voltage/temp + per-CPU kHz at ~1 s
  into a CSV. Not used for the app arms; the app arms use `dumpsys battery` before/after
  plus the sysprobe battery keys.
- `scripts/device-decode-lineup.sh` — `llama-bench` decode tok/s (standalone, not the app).

### 1.5 The arm runner used here

`ci-bench.sh` cannot express a minimal two-arm repack A/B without also writing the
whole quality pref matrix and running its Italian probe conversation. The arms below
therefore run through a thin runner that calls the same audited primitives:
`install_and_sideload` / `sql_write`+read-back / `capture_sysprobe_snapshot` /
`device_keepawake_setup` from `ci-lib.sh`+`device-env.sh`, with `KALSA_SESSION` and
`KALSA_TELEMETRY` read from logcat and `/proc/<pid>/maps` grep'd for the loaded GGUF.
The runner lives in this lab directory (`run-arm.sh`) and is described in `REPORT.md`.
The lever, the read-back assertion and the sampler are byte-identical to `ci-bench.sh`.

---

## 2. Levers and their TRUE precedence (from source)

### 2.1 The levers

| lever | key | parse | effect |
|---|---|---|---|
| bench norepack | `kalsa.bench.norepack` | `benchConfig.ts:63-64`, `parseBenchNoRepack` `:518-536` | tri-state: `"1"`→`no_extra_bufts=1` (repack OFF); `"0"`→`no_extra_bufts=0` (repack **forced ON**); absent/other→`undefined` (policy decides) |
| bench engine override | `kalsa.bench.engine` | `benchConfig.ts:55`, `:739-…` | JSON `{nGpuLayers,nThreads,nThreadsPrefill,nUbatch,flashAttn,moeStream}`; `moeStream.enabled` **forces** `no_extra_bufts=true` |
| expert streaming | (not a pref — decided by `shouldStreamModel`) | `LlamaService.ts:2241-2248`, `:2411-2413`, `:2422-2423` | forces `params.moe_stream={enabled:true}` **and** `no_extra_bufts=true`; re-forced *after* `applyEngineOverride` |
| per-model policy | `ModelRegistry.loadPolicy` | `ModelRegistry.ts:225` (qwen) | qwen3.5-4b: `{mmap:true, repack:false}`; all others (incl. LFM) have no entry → `DEFAULT_LOAD_POLICY` `{mmap:true, repack:true}` (`loadPolicy.ts:33`) |

### 2.2 Precedence — CONFIRMED, with one source comment wrong

The enforced resolver `resolveLoadPolicy` (`loadPolicy.ts:54-84`) makes the effective
engine flags:

```
expert streaming  >  bench levers (norepack tri-state, bench useMmap)  >  per-model entry  >  DEFAULT_LOAD_POLICY
```

- `loadPolicy.ts:61-77`: `useMmap` = streaming ? true : benchUseMmap ?? policy.mmap;
  `noExtraBufts` = streaming ? true : benchNoRepack===true ? true : benchNoRepack===false ? false : !policy.repack.
- Streaming is evaluated **first** and forces both flags, so it wins over the bench
  levers *for streamed loads* (`loadPolicy.ts:6-17`, test `loadPolicy.test.ts:74-86`).
- On a **non-streamed** load `benchNoRepack` overrides the registry policy in both
  directions. `benchNoRepack=false` is exactly the "force repack ON for a model whose
  entry disables it" arm this measurement needs, and it exists because of the commit
  under test (`loadPolicy.ts:20-24`).
- The load path implements this: `LlamaService.ts:2239` reads `getBenchNoRepack()`;
  `:2257-2277` calls `resolveLoadPolicy` with `streamExperts:false`; `:2379` sends
  `use_mmap`, `:2381` sends `no_extra_bufts`; `:2415-2423` applies `applyEngineOverride`
  and then re-forces `no_extra_bufts = moe_stream ? true : load.noExtraBufts`.

**Correction to the policy review, kept as a fact of this recon:** the new doc comment
at `ModelRegistry.ts:162-166` states the precedence as
`bench levers (norepack, bench:engine useMmap) > expert streaming > entry > default`.
The resolver and the load path say the opposite order for streaming
(`loadPolicy.ts:6-17`, `:62-77`, `LlamaService.ts:2422-2423`; asserted by
`loadPolicy.test.ts:74-86`). That is the review's required fix #1 and is **not**
changed by this task; it is recorded here because the arm labels depend on the real
order, which is `streaming > bench > entry > default`.

**Gate-side nuance (measured, not assumed):** `decidePreSendFit` resolves the fit
footprint with `resolveGateLoadPolicy({ policy, benchNoRepack })` only
(`deviceProfile.ts:448-451`). `benchUseMmap` is carried in `gateModelLoad`'s input type
(`loadGate.ts:51`) and forwarded to `resolveGateContextTokens` (`loadGate.ts:86`), but
**not** into `decidePreSendFit`. Consequence: `kalsa.bench.norepack` is visible to the
gate; a `bench:engine useMmap` override is not priced by the gate. Neither arm below
uses the mmap override, so this does not affect them, but it bounds what the gate can
be trusted to reflect.

### 2.3 The known constraint on the qwen repack-ON arm

`model.tightNow` is the 1.5x rule at `deviceProfile.ts:483-486`: with verdict `tight`
and `availableBytes < 1.5 × requiredBytes` the load is refused. With repack priced in,
`requiredBytes` for qwen at 16K context is ≈ 3451 MiB (estimator arithmetic in the
review; `memoryEstimate.ts:148-164`), so admission needs ≥ 5177 MiB available against
this device's **MemTotal of 7,243,748 kB (6.91 GiB)**. The repack-ON qwen arm is
therefore expected to be **refused by the fit gate**, and the refusal line
(`KALSA_LOAD {"phase":"fitGate",…,"refusedBy":"fit","reasonKey":"model.tightNow"}`,
`AppShell.tsx:3959-3968`) is the result to record for that arm. The same-model
repack cost is then priced on **LFM 2.6B**, which fits both ways:
file 1.59 GB, repack copy ≈ 1.43 GB, KV 6656 B/token (`ModelRegistry` LFM entry) —
both well inside MemAvailable.

---

## 3. Building a local APK from this worktree

Documented path (`README.md:31-39`):

```
npx expo prebuild --platform android      # generates android/ (CNG)
cd android && ./gradlew assembleRelease
# APK lands in android/app/build/outputs/apk/release/
```

This worktree does not track `android/` (`.gitignore:42`) and starts with no
`node_modules`. The environment check found everything the build needs locally:

- Node v26.3.0 / npm 11.16.0 (`/opt/homebrew/bin`).
- Java 17 (`/opt/homebrew/opt/openjdk@17`, 17.0.20.1).
- Android command-line tools at `/opt/homebrew/share/android-commandlinetools`
  (platforms 35/36, build-tools 35/36, cmake 3.22.1, **ndk 27.1.12297006** — the exact
  NDK the app's own gradle config selects; the previous build's CMake metadata names it).
- Gradle 9.3.1 wrapper distribution already in `~/.gradle/wrapper/dists`.
- 73 GiB free on the data volume.

`node_modules` for this worktree is a symlink to `/Users/marco/Projects/kalsa/node_modules`.
That tree was verified byte-identical on the inputs that matter before reuse:
`package.json`, `package-lock.json` and `app.config.js` diff clean against this
worktree, and `plugins/` is identical, so the generated `android/` and the engine build
id are the same for both. The engine is compiled from source
(`plugins/withLlamaFromSource.js` forces `rnllamaBuildFromSource=true`; the fork ships
no prebuilt jniLibs), so the build is dominated by the llama.cpp native compile.

Measured build wall time and APK identity:

- Runner: `.build-s23-repack.sh` in the app worktree (prebuild → debuggable patch →
  gradle). Total 557 s (9 m 17 s): `npx expo prebuild --platform android --no-install`,
  then `./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a` which reported
  `BUILD SUCCESSFUL in 8m 42s` (764 actionable tasks, 736 executed). The native
  engine compile dominates; gradle and the llama.rn fork reuse the warm
  `~/.gradle` cache.
- Output: `android/app/build/outputs/apk/release/app-release.apk`, 159 214 430 bytes,
  sha256 `245c514c32f46acc8b04a9ceb5576d9507a64b614f6b8aa1b314f95bbbcfff3c`.
- Engine identity: `assets/app.config` in the APK carries
  `engineBuildId = kalsa-eng-v2:0d5c42479bfdfeb3207fc43a25484e5d046e389511a577fd889a008981d9c6b3`,
  byte-identical to `node scripts/engine-build-id.js` run in this worktree.
  The Hermes bundle (`assets/index.android.bundle`) contains `qwen3.5-4b`,
  `loadPolicy`, `kalsa.bench.norepack`, `noExtraBufts`.
- Native flags in the built engine include `-DGGML_USE_CPU_REPACK` and
  `-march=armv8.2-a+dotprod+i8mm`, i.e. the ARM repack path is compiled into the
  binary; the runtime picks `rnllama_jni_v8_2_dotprod_i8mm_hexagon_opencl` on the S23.

Two deliberate build settings, both required and both matching the project's CI
(`.github/workflows/apk.yml`):

1. `HEXAGON_SDK_ROOT`/`HEXAGON_TOOLS_ROOT` are pointed at a nonexistent path. This
   Mac has `~/.hexagon-sdk/6.4.0.2`, which `llama.rn/android/build.gradle:142-169`
   auto-detects and turns on the DSP host build; that path needs QAIC artifacts under
   `vendor/llama.cpp/…/htp/v73/` which the installed npm package does not carry, so
   configure fails. `apk.yml` installs no Hexagon SDK, so the **CI artifact is built
   CPU-only** — that is what this reproduces, and Android production loads CPU-only
   anyway (`n_gpu_layers = 0`).
2. The release build type is made `debuggable true` after prebuild, exactly as
   `apk.yml:181-215` does. `assembleRelease` with `debuggable=false` refuses `run-as`,
   and every measurement primitive (pref writes, model listing, `/proc` reads) goes
   through `run-as`.

---

## 4. Reading back the ENGINE-INTERNAL mode actually used (ground truth)

Emitted once per real engine load, immediately after `initLlama` resolves and before
any send:

```
KALSA_SESSION {"op":"init","no_extra_bufts":0|1}
```

Source: `LlamaService.ts:2429-2436`. `no_extra_bufts:1` = repack OFF; `0` = repack ON.
It is the same value that actually went into `ContextParams.no_extra_bufts`
(`LlamaService.ts:2381`, re-forced at `:2422-2423` for streaming), so it is the
engine's configuration, not the intent.

Read-back paths:

- raw logcat: `adb logcat -d | grep -F 'KALSA_SESSION ' | grep -F '"op":"init"'`.
- the campaign sidecar: `turn<N>/session-init.jsonl` (`ci-bench.sh:1190-1194`).
- graded: `result.json.no_extra_bufts` (`benchGrade.mjs:588-640`, `:1023`, `:1234`).

Adjacent, also-idiomatic lines:

- `KALSA_NATIVE_VARIANT {androidLib,nGpuLayers}` (`LlamaService.ts:2547-2556`) — which
  `.so` actually loaded (CPU vs `_opencl`) and the GPU layer count.
- `KALSA_LOAD {phase:"fitGate",modelId,refusedBy,reasonKey,disposedResident,source}`
  (`AppShell.tsx:3959-3968`) — the fit gate's own refusal record.
- `KALSA_TELEMETRY {turnId,…,promptMs,promptN,predictedMs,predictedPerSecond,…}`
  (`turnTelemetry.ts:222-230`) — prefill ms/tokens and decode tok/s per round.

**`mmap` has no telemetry line.** `use_mmap` is never logged; the only on-device proof
that weights are file-backed rather than anonymous is `RssFile` (large) vs `RssAnon`
(small) in the sysprobe plus the GGUF appearing in `/proc/<pid>/maps`. Both arms here
use `mmap:true` (qwen policy and LFM default), so mmap is not the variable; it is
confirmed by observation, not by a lever.

---

## 5. Establishing the LOADED MODEL (mandatory per arm)

`kalsa.model.id` is only a preference and is never proof of residency — the earlier
"qwen" S23/Jelly configuration that was measuring LFM is the standing lesson.
Per arm, after the load, four independent checks are recorded:

1. Preference actually read: `run-as com.kalsa.app` sql
   `SELECT value FROM catalystLocalStorage WHERE key='kalsa.model.id'`.
2. Files in the container: `run-as com.kalsa.app ls -la files/models/<dir>/` (sizes,
   §0). The qwen bundle is 2.83 GB + 0.67 GB mmproj; LFM is 1.59 GB — no overlap.
3. Mapped file: `pid=$(adb shell pidof com.kalsa.app)`; then
   `adb shell run-as com.kalsa.app cat /proc/$pid/maps` grepped for `\.gguf`. The VMA
   size of the GGUF mapping (the whole file under `mmap:true`) separates qwen
   (≈2.70 GiB) from LFM (≈1.52 GiB) unambiguously.
4. Engine mode: the `KALSA_SESSION op:init` line (§4), so model identity and repack
   mode come from the same load.

A result is only published for an arm where (2), (3) and (4) agree on the same load.

---

## 6. What this recon establishes vs what still needs measurement

Established by reading/running, before any arm:

- The harness, the lever semantics and the real precedence (§1, §2).
- The gate's refusal condition for qwen-with-repack (§2.3).
- The engine-mode readback and the loaded-model proof (§4, §5).
- That a local build of this commit is possible in this environment (§3, in progress).

NOT established here and requiring the arms (recorded in `REPORT.md`): any load time,
prefill/decode throughput, major-fault count, RSS split, temperature or battery change.
"Compiles" and "runs" are never reported as "measured".
