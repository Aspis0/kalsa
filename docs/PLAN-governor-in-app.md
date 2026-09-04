# Plan: governor v0.2 in Kalsa

Date: 2026-09-04. Scope: architecture recon and implementation plan. This file is the only file authorized for writing; no UI/settings work is included.

## Decision

Integrate the fork governor as an opt-in, two-context native mode. Keep the current Android CPU-only path as the fallback. The fork contract is two independent contexts, sequence 0 only, and sticky failure. `kalsallama-wt-governor/src/llama-ext.h:321-325`. Separately, the kernel/evidence verdict says: “Half-offload is NEVER right” and explains the KEXP expert-placement consequence. `kalsa-moe-experiments/docs/ALIVE.md:140-145`. The governor design’s separate prohibition is: “il mezzo-offload è l'arm B BANDITO dalle misure”. `kalsa-moe-experiments/scratchpad/agents/governor-v0/PLAN.md:71-73`.

### 1. Exact integration seam

Today `llama_rn_context` owns one `llama_model`, one `llama_init_result`, one `llama_context *ctx`, and one completion object. `node_modules/llama.rn/cpp/rn-llama.h:108-145`. `loadModel` creates that model/context pair through `common_init_from_params`. `node_modules/llama.rn/cpp/rn-llama.cpp:466-507`. The JSI init host constructs this owner, loads it, and exposes its context info. `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:461-648`.

The decode seam is not one call: the normal completion loop reaches `llama_decode(parent_ctx->ctx, ...)`, and MTP and slot-manager paths do too. `node_modules/llama.rn/cpp/rn-completion.cpp:846-846`; `node_modules/llama.rn/cpp/rn-completion.cpp:938-938`; `node_modules/llama.rn/cpp/rn-completion.cpp:1075-1101`; `node_modules/llama.rn/cpp/rn-slot-manager.cpp:979-991`. JSI currently samples, converts pieces, and prints perf against that same context. `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1027-1165`.

Replace the single `ctx` owner in governor mode with: two model handles (CPU and accelerator), one `llama_governor *`, and an active-context accessor used by token conversion, sampling, perf, and result construction. The governor initializer receives model handles and creates both contexts internally. `kalsallama-wt-governor/src/llama-governor.cpp:10-64`; `kalsallama-wt-governor/src/llama-ext.h:329-389`.

This is modest owner-level glue, not a transparent wrapper around the existing context: every raw decode path, active-context read, sampling path, and session path must be audited. Existing session save/load serializes one context. `node_modules/llama.rn/cpp/jsi/JSISession.h:44-188`; `kalsa/src/engine/LlamaService.ts:1825-2257`. Before production flag-on, add one paired governor session save/load API that serializes both KV states plus governor phase/watermarks, and make JSISession call it; do not ship a cold-session-only governor mode.

Reference-host call order, in addition to backend/model resolution:

1. Initialize backend; resolve CPU and accelerator devices. `kalsallama-wt-governor/tools/governor-bench/governor-bench.cpp:97-114`.
2. Load the accelerator model with `n_gpu_layers=99`, load the CPU model with `n_gpu_layers=0`, then call `llama_governor_init(prefill_model, decode_model, ...)`. `kalsallama-wt-governor/tools/governor-bench/governor-bench-run.cpp:83-99`.
3. Get the prefill context for tokenization with `llama_governor_get_prefill_context`. `kalsallama-wt-governor/tools/governor-bench/governor-bench-run.cpp:110-112`.
4. For each turn: read stats-before, build a sequence-0 prompt batch, call `llama_governor_decode`, get the active governor context, sample, then repeat one-token decode/sample calls. `kalsallama-wt-governor/tools/governor-bench/governor-bench-run.cpp:126-166`.
5. Submit the final no-logits one-token decode, read stats-after, and report deltas including commit bytes/time. `kalsallama-wt-governor/tools/governor-bench/governor-bench-run.cpp:167-173`; `kalsallama-wt-governor/tools/governor-bench/governor-bench.cpp:80-92`.

The benchmark does not set a thermo profile; the app must call `llama_governor_set_thermo_profile` after init and before the first decode, then once per turn. That API and the profile fields are public. `kalsallama-wt-governor/src/llama-ext.h:221-230`; `kalsallama-wt-governor/src/llama-ext.h:344-358`. **Assumption:** initially disable parallel slots and speculative/MTP decode until their active-context audit passes; v0.2 exposes only sequence 0 and the current wrapper has those single-context assumptions. `kalsallama-wt-governor/src/llama-ext.h:321-325`; `node_modules/llama.rn/cpp/rn-completion.cpp:938-938`; `node_modules/llama.rn/cpp/rn-slot-manager.cpp:979-991`.

### 2. Engine pin and overlay

The app production pin is fork-main commit `a0cabca6b1b3248a92e05a8633fd0d82cf776e75`. `native/kalsallama.pin:1-5`. The governor worktree is `kalsa/governor-v0.2`, whose current `HEAD` is `1a33da0f6`; its `git log --oneline main..HEAD` contains the v0.2 runtime, router tests, KV commit, benchmark, and wrapper fixes. The fork documents app production main as the a0 lineage. `kalsallama-wt-governor/KALSA_FORK.md:14-20`.

The app declares `llama.rn` 0.12.8 and runs the overlay plus patch-package at postinstall. `kalsa/package.json:12;49`. Pin the final app to a governor commit rebased onto `12f6d9b6d` (fork origin/main’s a0-plus-three-OpenCL-commit lineage), not to the current governor tip based on a0. **Assumption:** the fork team can produce and freeze that rebased commit; the app should record its immutable SHA in `native/kalsallama.pin` and regenerate the flattened vendor source.

Conflict risk is real but localized: `git diff --stat main...HEAD` on the governor branch is 38 files, 4,295 insertions, 53 deletions; the `a0cabca6b..12f6d9b6d` engine bump is three commits, six files, +193/−60, concentrated in OpenCL implementation/kernel picks. S1 must preserve those three OpenCL picks. Expect direct conflicts in build/source lists and the OpenCL kernel embedding touched by `patches/llama.rn+0.12.8.patch:1-86;338-346`; resolve against the newer OpenCL picks and rerun the fork tests.

Extend `scripts/sync-kalsallama.sh`’s API-copy list, which currently includes `llama-ext.h` but not the governor/KV staging sources. `scripts/sync-kalsallama.sh:334-373`. Add these runtime files:

```text
src/llama-governor.cpp
src/llama-governor.h
src/llama-governor-runtime.cpp
src/llama-governor-policy.cpp
src/llama-governor-policy.h
src/llama-governor-metrics.cpp
src/llama-governor-metrics.h
src/llama-kv-commit.cpp
src/llama-kv-commit.h
src/llama-kv-staged.cpp
src/llama-kv-staged.h
src/llama-hybrid-commit.cpp
src/llama-hybrid-commit.h
```

The overlay already handles the fork’s modified core files; verify `llama-context.cpp`, KV-cache, hybrid-memory, model, and `llama-ext.h` remain in that list. The overlay uses `rsync --delete` with explicit exclusions. `scripts/sync-kalsallama.sh:566-588`. Do not copy tests or the benchmark into the app. The real RN build file is `node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt`; its `llama*.cpp` glob absorbs the new sources. `node_modules/llama.rn/android/src/main/rnllama/CMakeLists.txt:21-30;56-105`.

### 3. App-side data flow

Create one small, called module, `src/engine/governorInputs.ts` (<250 lines), with two exports: `buildGovernorParams(modelInfo, deviceProfile, memorySnapshot)` and `readGovernorThermo()`. No settings/UI API is needed.

- `generation`: map a validated native SoC/backend capability to the fork generation. Existing `DeviceProfile` has brand, model, model id, memory, OS, and CPU capacities but no SoC generation field. `kalsa/src/engine/deviceProfile.ts:36-57`. **Assumption:** add a narrow validated lookup/probe for the target QRD8650/8 Elite devices; unknown generation means `gpu_fit=NoFit`.
- `gpu_fit`: call the existing memory estimate, then add an explicit GPU-driver/OpenCL reserve and GPU-copy term. The current estimator prices CPU weights/repack/compute/KV only. `kalsa/src/engine/memoryEstimate.ts:129-247`. §7.18 proves why the term is mandatory: the system lost 3.4 GB while the process showed about 150 MB, because driver/CL allocations were outside `/proc`. `kalsa/docs/HARNESS_FINDINGS.md:4004-4030`. Use the documented candidate `800 MiB + 1.05 * offloaded_weight_bytes` as the initial conservative term, then calibrate it against that system-memory delta. `kalsa-moe-experiments/docs/ALIVE.md:409-409`.
- `model_kind`: derive Dense/Hybrid/MoE from the registry’s `hybrid` and expert-streaming metadata, not from a filename. `kalsa/src/engine/ModelRegistry.ts:41-68;131-140;466-480`. LFM2.5-2.6B is registry-marked hybrid. `kalsa/src/engine/ModelRegistry.ts:293-314`.
- `npu_lane_enabled`: always `false` for this integration; the field is declared at `llama-ext.h:208`; the separate engine enum documents that NPU is deferred in v0.2. `kalsallama-wt-governor/src/llama-ext.h:146-159;208-208`.

Use one JSON-shaped `governor` object in the load params and one small `governor_thermo` object per completion/turn. `initLlama` already forwards a JS params object to native JSI, and completion params are parsed at the JSI boundary. `node_modules/llama.rn/src/index.ts:785-820;1226-1346`; `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:461-493;1027-1090`. Native parses the load object once into `llama_governor_params`; before each turn it converts the thermo object and calls `llama_governor_set_thermo_profile`. Do not add per-token JS callbacks.

Battery data must come from a tiny Kotlin/Java module under `android/` (for example, an app-package `GovernorBatteryModule.kt`), or an Expo module if that is the existing native-module convention—not from C++ JSI directly. It returns BatteryManager temperature in tenths C, level percent, and plugged state. The existing app helper exposes battery level/state through Expo but no temperature; the existing thermal hook’s thermal-zone read is at `kalsa/src/hooks/useThermalMonitor.ts:82-86` and its UI/memory-proxy behavior is at `:57-69;111-132`. **Assumption:** poll every 10 seconds during an active turn and every 30 seconds idle; take an initial snapshot before governor load, refresh before every turn, and mark invalid/stale readings rather than inventing values. For the batteryless QRD/HDK fixture, production logic defaults `sensor_valid=false` and does not initialize the governor (non-thermal single-context CPU route). **S5 therefore needs a declared bench-only thermo source, or it cannot exercise governor mode on QDC at all:** the boards expose no battery temperature (`vbat` is a voltage) but `dumpsys thermalservice` reports `skin`, CPU `nsp*` and `GPU*` temperatures (kalsa-moe-experiments/scratchpad/agents/qdc-apk-smoke-63/raw/A_sa803197e_thermal_pre_s4.txt:1-12). The bench override `kalsa.bench.thermo` (AsyncStorage, same channel as `kalsa.bench.norepack`) supplies `{ batt_temp_tenths_c: round(skin*10), batt_level_pct: 100, plugged: true, sensor_valid: true }`, refreshed per turn by the cell driver from `dumpsys thermalservice`, and every `KALSA_GOVERNOR` line carries `thermo_source: "bench-skin"` so a QDC number can never be mistaken for a BatteryManager one. Production never synthesizes a profile. If such a profile is nevertheless passed to v0.2, `profile_is_valid` returns false and the policy enters `Invalid`; prefill admission aborts and decode admission waits/fails rather than selecting GPU. `kalsallama-wt-governor/src/llama-governor-policy.cpp:53-64;88-95;152-156;182-187;214-220`; `kalsallama-wt-governor/src/llama-governor-runtime.cpp:92-103`. The fork’s policy has 10-minute dwell and 1-hour flip-budget concepts, so faster sensing does not imply rapid engine flipping. `kalsallama-wt-governor/src/llama-governor-policy.cpp:8-15`.

Do not encode “GPU is greener” as a rule: the S23/Adreno 740 GPU arm was cooler but used 30% more battery per token, and the evidence explicitly does not transfer that conclusion to the newer device class. Battery is an input to the governor, not a performance promise. `kalsa/docs/HARNESS_FINDINGS.md:3110-3140`.

Emit one `KALSA_GOVERNOR` telemetry line per completed turn with selected engine per phase, prefill/decode timings, commit bytes and milliseconds, thermal state/profile validity, fit decision, and fallback reason. The fork exposes stats/commit fields for this. `kalsallama-wt-governor/src/llama-ext.h:232-259;377-389`. Keep existing `KALSA_TELEMETRY` and `KALSA_GPU_FALLBACK` behavior unchanged. `kalsa/src/engine/LlamaService.ts:833-871;1429-1457;2958-2973`.

### 4. Fallback and safety

For no OpenCL device, `NoFit`, invalid profile, or any other pre-load refusal, do not load the two-context mode: construct the existing single-context CPU params with `n_gpu_layers=0` and call the existing `initLlama(params)` path. `kalsa/src/engine/deviceTuning.ts:335-374;763-787`; `kalsa/src/engine/LlamaService.ts:1250-1302`. If governor init fails after both models are loaded, first call `llama_governor_free`, release/unload both model owners (not just the governor’s contexts), clear governor state, remove the governor params, set `n_gpu_layers=0`, and invoke that same single-context CPU `initLlama(params)` path once. The current owner’s destructor is the cleanup precedent. `kalsallama-wt-governor/src/llama-governor.cpp:61-64`; `node_modules/llama.rn/cpp/rn-llama.cpp:448-464`. Emit `KALSA_GOVERNOR_FALLBACK` with `stage=init`, `models_loaded=2`, reason, and fit/profile fields. Do not expect `KALSA_GPU_FALLBACK` here: its retry guard keys on `params.n_gpu_layers > 0`. `kalsa/src/engine/LlamaService.ts:1429-1457`. Do the fit refusal before either model load; lmkd SIGKILL is not catchable, and the harness observed GPU allocations invisible to `/proc`. `kalsa/docs/HARNESS_FINDINGS.md:3998-4030`.

RAM arithmetic for LFM2.5-2.6B:

- Registry file size `W = 1,593,894,944 bytes = 1,520.06 MiB`. `kalsa/src/engine/ModelRegistry.ts:293-300`.
- Production currently resolves `n_ubatch=256` (`DEFAULT_UBATCH`) and tags it `measured:ubatch-256`; LlamaService passes `tuning.n_ubatch` to the context. `kalsa/src/engine/deviceTuning.ts:223-223;659-668`; `kalsa/src/engine/LlamaService.ts:1268-1271`. **Assumption:** two clean mmap views share file-backed pages and the GPU owns approximately one full `W` copy. At the production compute term, `W + W + 2*249 = 3,538.1 MiB` (`3.46 GiB`). `kalsa/src/engine/memoryEstimate.ts:22-24;34-35`; `kalsa-moe-experiments/scratchpad/agents/governor-v0/PLAN.md:82-101`.
- Upper bound for the app’s guarded/overridden `n_ubatch=512`: the measured compute term is `497 MiB` per context, so `W + W + 2*497 = 4,034.1 MiB` (`3.94 GiB`). Both bounds exclude KV, metadata, and driver workspace; 512 is the hard guard/override ceiling, not today’s default. `kalsa/src/engine/LlamaService.ts:1268-1271`; `kalsa/src/engine/memoryEstimate.ts:22-24`; `kalsa/src/engine/deviceTuning.ts:659-668`.
- On the old 8 GB phone harness, one LFM load measured `2.46 GB` anonymous RSS plus `60 MB` file RSS; the documented load ceiling was `3.33 GB`. `kalsa/docs/HARNESS_FINDINGS.md:1641-1655`. The initial GPU reserve is `800 MiB + 1.05*1,520.06 = 2,396.1 MiB` (`2.34 GiB`); conservatively charging the measured `2.46 GB` (`~2.29 GiB`) plus that reserve is already `~4.63 GiB`, before OS, KV, and variance. This is a gate charge, not proof of additive resident RSS.
- LFM’s registry entry does not provide `kvBytesPerToken`; unknown KV must not be treated as free. `kalsa/src/engine/ModelRegistry.ts:105-114;293-314`. On 8 GB devices, unknown GPU/driver/KV budget therefore resolves to `NoFit` until a device-specific budget is validated.

### 5. Testable implementation steps

**S1 — Rebase and build.** Rebase the governor branch onto the production `12f6d9b6d` lineage, preserve the three OpenCL picks, run macOS build, governor unit tests, and benchmark. Test: `test-governor-v02-router` and the reference host complete three turns. Hostile audit: inspect `git diff --name-status`, CMake source lists, and reject any single-context or half-offload path.

**S2 — Native two-context session behind a flag.** Extend the llama.rn owner/JSI bridge to load CPU+GPU model handles and call `_init_with_params`; route all decode/sampling/perf reads through the governor. Add the paired session save/load API before production flag-on, so both KV states and governor watermarks survive `KALSA_SESSION`. Test: macOS native build, flag-off app remains on the current CPU path, flag-on synthetic turn and save/restore complete. Force `llama_kv_route::Reject` during governor init and verify both models unload, `KALSA_GOVERNOR_FALLBACK` emits, and the existing CPU load path succeeds. `kalsallama-wt-governor/src/llama-governor.cpp:45-50`. Hostile audit: grep every `llama_decode`, `parent_ctx->ctx`, MTP, slots, and session call; force sticky governor failure and verify no use-after-free.

**S3 — JSI params and thermo.** Add the load JSON object, per-turn thermo object, and Android BatteryManager snapshot. Test: macOS parses valid/invalid fixtures; QDC logs initial and per-turn profile values. Hostile audit: omit fields, pass stale/invalid readings, remove OpenCL, and ensure native rejects GPU eligibility rather than guessing.

**S4 — LlamaService wiring and telemetry.** Call `governorInputs` at load/turn boundaries; retain the FIFO lifecycle and current CPU fallback. Test: TypeScript fixtures cover SoC, registry kind, fit, unknown KV, and `npu_lane_enabled=false`; macOS completes with governor disabled. Hostile audit: tool rounds, `moe_stream`, fallback completion, and telemetry duplication must not select a stale context or emit misleading GPU success.

**S5 — QDC A/B cell.** On QRD8650 and 8 Elite, compare today’s CPU-only path with governor using the ship LFM2.5-2.6B, identical prompt/generation, battery and thermal snapshots. First acceptance gate, before any speed claim: same-model-hash greedy generation on device must have exact token-ID equality between governor mode and single-context CPU; if exact equality is impossible, predeclare an oracle with a maximum mismatch tolerance and decoded-text rule. Only after that gate passes: TTFT `<= CPU/3`, decode `>= CPU`, and zero lmkd kills. Capture per-phase engine, commit, process/system memory, and failure reason. Existing fork-cell evidence is prior art, not app acceptance: it reports roughly 10x TTFT improvement in one QDC governor cell but is not this llama.rn integration. `kalsa-moe-experiments/scratchpad/agents/qdc-8elite-governor-crossbackend/REPORT.md:30-39`; `kalsa-moe-experiments/scratchpad/agents/governor-v0/PLAN.md:20-26`. Hostile audit: ABBA order, cold/warm repeats, low battery, plugged/unplugged, and model-hash verification.

**S6 — Fit gate with GPU term.** Implement the `800 MiB + 1.05*offloaded bytes` reserve, calibrate per device, and refuse unknown/near-boundary cases before load. Test: synthetic boundary matrix plus QDC near-limit runs; `NoFit` must land exactly on CPU-only behavior. Hostile audit: hide driver allocations from `/proc`, force OpenCL init failure, and run repeated loads while watching lmkd/system memory.

**S7 — Thermal loop.** Update the profile during generation and verify policy transitions, dwell, low-battery behavior, and reload budget. Test: QDC plug/unplug, battery below 25%, warning/limit/kill boundaries, cooling, invalid sensor, and stale sensor cases. Hostile audit: inject a mid-turn sensor failure and governor sticky error; the next safe load must be CPU-only, with no settings/UI changes.

### 6. Ranked risks

1. GPU driver/OpenCL memory is invisible to the current `/proc` gate and lmkd cannot be caught. `kalsa/docs/HARNESS_FINDINGS.md:3998-4030`; `kalsa/src/engine/memoryEstimate.ts:180-247`.
2. Two-context routing is a lifecycle/API migration, not a one-line `llama_decode` substitution; sampling, MTP, slots, perf, and sessions all assume one context. `node_modules/llama.rn/cpp/jsi/RNLlamaJSI.cpp:1027-1165`; `node_modules/llama.rn/cpp/jsi/JSISession.h:44-188`.
3. Hybrid/recurrent KV commit cost can dominate: LFM2 shortconv is small, while Qwen35’s fixed recurrent state is about 52.7 MB and 99.65% of state bytes; the fork warns its 2% gate is untrustworthy until dirty-range tracking. `kalsa-moe-experiments/scratchpad/agents/governor-v0/PLAN.md:20-26`; `kalsallama-wt-governor/src/llama-ext.h:261-270`.
4. Flash-attn auto plus quantized V-cache constraints can make init fail; the catalog uses quantized V and `flash_attn=off` is not a universal governor setting. `kalsa/src/engine/engineParams.ts:77-91`.
5. Streaming/`moe_stream` is configured at load while the app’s stream executes multiple completion/tool rounds and a fallback completion; every round must use the governor’s active context. `kalsa/src/engine/LlamaService.ts:1178-1195;1285-1302;2487-2496;2893-2957;3233-3289`.
6. Vision is CPU-only on Android today; govern text LLM contexts without accidentally moving the image path. `kalsa/src/engine/LlamaService.ts:1496-1515`.
7. Session editing/settings UI belongs to another session (scope boundary supplied by the user); governor must ship behind existing engine plumbing/flag only.
