# Hostile audit: S3+S4 governor-in-app

Tree: `/Users/marco/Projects/kalsa-wt-governor` @ `81bcaf2` (S4) + `05ad253` (S3) + `74390c5` (S2 residuals). Spec: `PLAN-governor-in-app.md` S3/S4. Method: read-only except this file. jest governorInputs+Runtime PASS (exit 0). `tsc --noEmit` PASS (exit 0). `gh run 33927024200` RED.

**Overall: NO-GO** for debug APK + S5 QDC cell. Flag-on LFM on QDC never constructs two-context mode; S5 would A/B CPU vs CPU.

## S2 residuals — all three FIXED

1. Init Reject: one `KALSA_GOVERNOR_FALLBACK` with `stage:"route_reject"` when reason contains `"route"` (`rn-llama.cpp:126-129`). Overlay C API no longer logs a second line (`llama-governor-runtime.cpp:198-204` only `LLAMA_LOG_ERROR` / `failure_reason`). Throw is `"governor contexts have incompatible KV routes"` (`llama-governor.cpp:50`).
2. `moe_stream.reset()` before both arms (`rn-llama.cpp:662-663`).
3. `scripts/governor-params-test.sh` + `package.json` `test:governor-params`; `logs/governor-params-test.log` is `governor_params=PASS` then `0`.

## Findings

### B1. LFM2.5-2.6B is always `NoFit` — CONFIRMED, blocker
`governorInputs.ts:69`: `if (typeof kv !== "number" || !Number.isFinite(kv) || kv <= 0) return "NoFit" as const;`
`ModelRegistry.ts:293-314` LFM entry has no `kvBytesPerToken`.
S5 ship model never gets `governorLoad` (`LlamaService.ts:1297-1301` requires `gpu_fit !== "NoFit"`). Plan: unknown KV must not be free; **8 GB** unknown budget → NoFit. Implementation NoFits unknown KV on every RAM class, including QRD 12 GB. Fix: measure `kvBytesPerToken` for LFM, or NoFit unknown KV only when `total <= 8 GiB` and still add a conservative KV floor on QDC.

### B2. Plan-shaped bench thermo is invalid on plugged QDC — CONFIRMED, blocker
`governorInputs.ts:124-128`: `sensor && temp > 0 && … && (!plugged || (idleValid && idle + 1 < 42))` then writes that as `sensor_valid`.
Plan S3 example: `{ batt_temp_tenths_c, batt_level_pct: 100, plugged: true, sensor_valid: true }` — **no** `t_idle_*`. Test at `governorInputs.test.ts:120-130` asserts plugged battery without idle → `sensor_valid: false`. QDC is USB-powered. `governorLoad` requires `governorThermo.sensor_valid` (`LlamaService.ts:1300`). S5 following the plan never enables governor. Fix: document+require `t_idle_valid`/`t_idle_c` on bench-skin, or skip the idle AND in JS and let native `governor_thermo_profile_is_valid` decide.

### M1. SoC probe cannot see QDC — CONFIRMED, major
`governorInputs.ts:49`: `if (/(^|[^A-Z0-9])(QRD8650|SM8650)([^A-Z0-9]|$)/.test(text)) return "V75"`
Text is `modelName + modelId + manufacturer` (`:45-48`). `deviceProfile.ts:596`: `const modelName = asNullableString(Device?.modelName);` (expo-device = `Build.MODEL`).
QDC recon `qdc-apk-smoke-63/raw/recon_sa803197e.txt:5-6`: `ro.product.model` = `Pineapple for arm64`; `ro.soc.model` = `SM8650`. Generation is `Unknown`. Plan: unknown generation ⇒ `gpu_fit=NoFit`. `gpuFit()` never reads generation (`governorInputs.ts:62-92`). Test only checks `.generation` for `"unlisted"`, not `gpu_fit`. Fix: read `ro.soc.model` (or match `pineapple`/`sun`) and force `NoFit` when generation is `Unknown`.

### M2. Stale `KALSA_GOVERNOR_FALLBACK` classifies later init errors as governor — CONFIRMED, major
`governorRuntime.ts:28-29`: `/KALSA_GOVERNOR_FALLBACK|governor.*(fail|reject|invalid)/i.test(\`${message}\n${nativeLog}\`)`
`LlamaService.ts:373-376`: `nativeLogSummary` keeps last 3 lines matching `/error|fail|fallback|invalid|…/i` from a **never-cleared** 50-line `nativeLogTail` (`:331`).
After any prior FALLBACK, a corrupt-GGUF / OOM / `"Failed to load model"` still matches via the tail → one CPU retry that hides the bug. Regex also matches `"governor: thermo profile invalid"` on a later turn’s throw if that text is in the error. Fix: classify only the current `error.message` (or a load-epoch token); clear diagnostic tail on `disposeEngineLocked`.

### M3. Not one `KALSA_GOVERNOR` line per turn — CONFIRMED, major
Plan: one line per completed turn. `LlamaService.ts:3037` tool loop + `:3121` `await emitGovernorTelemetry` **per round**; also prewarm `:755`, fallback completion `:3439`, extract `:3704`, translate `:3876`, completeOnce `:4003`.
S5 logs will mix util/prewarm/tool-round lines with the chat turn. `engine_prefill`/`thermal_state` are C++ enums as ints (`RNLlamaJSI.cpp:835-839`), not names. Fix: emit once at end of `completeChat` only; stringify enums.

### M4. Batteryless QDC with bogus temp looks valid — CONFIRMED, major
`GovernorBatteryModule.kt:43`: `result.putBoolean("sensorValid", temperature > 0)` — no `BatteryManager.EXTRA_PRESENT`.
Intent present + temp>0 + `plugged=false` (some HDKs) → JS `sensor_valid=true`, `thermo_source:"battery"` on a board with no battery. Plan: production defaults invalid; only bench-skin is allowed on QDC. Fix: `EXTRA_PRESENT` must be true; else `sensorValid=false`.

### M5. Two-context RAM undercount — CONFIRMED, major
`governorInputs.ts:89-92`: `gpuReserveMiB = 800 + (1.05 * offloadedBytes) / MIB` then `requiredMiB = estimate.nonEvictableMiB + gpuReserveMiB`.
`800+1.05×W` units match the plan (`W=1_593_894_944` → ~2396 MiB). `estimateMemory` prices **one** compute + **one** KV (`memoryEstimate.ts:164`). Governor is two contexts. Plan bounds 3.46–3.94 GiB are `W+W+2*compute` excluding KV. Missing ~1×compute (~249 MiB @256) + 1×KV. Fix: add second compute (and second KV when known) before comparing to available.

### M6. Fallback retry does not match every native governor refusal — CONFIRMED, major
`rn-llama.cpp:632-633` throws `"Governor mode does not support speculative or MTP decoding"` **before** any FALLBACK log. Message does not match `governor.*(fail|reject|invalid)`. `cpuParams` deletes `speculative` (`LlamaService.ts:1495`) but the first throw never retries unless a stale FALLBACK is in the tail. Latent for MTP catalog models (LFM has no `mtp`). Fix: log FALLBACK or include `"Governor mode"` in the classifier; strip speculative from `governorParams` too.

### M7. `setGovernorThermo` abort vs engine Invalid — CONFIRMED, major
`RNLlamaJSI.cpp:812-813`: `throw std::runtime_error("governor: thermo profile invalid");` (never returns false).
`LlamaService.ts:903-904`: `if (!ok) throw …` is dead. A mid-session invalid bench/battery sample **throws the JS turn** instead of `profile_is_valid=false` → Invalid → prefill Abort (`llama-governor-policy.cpp:88-95`). Race: `refreshGovernorBeforeCompletion` awaits storage then `setGovernorThermo` with no `engine === context` re-check after the await (`LlamaService.ts:901-904` vs completeOnce `:3964` before the await). Fix: treat false/throw as Invalid admission, not a JS exception; re-check handle after await.

### M8. CI 33927024200 is not build proof — CONFIRMED, major
Run finished **red**. Failure: `Could not get resource 'https://dl.google.com/dl/android/maven2/…gradle-8.5.0.module' > Read timed out` (Gradle plugin classpath, not Kotlin). No APK, no compile of `GovernorBatteryModule`. Local prebuild **did** match the Expo 57 template (`android/.../MainApplication.kt:25-26` `PackageList(this).packages.apply { add(GovernorBatteryPackage()) }`). Plugin is idempotent (`withGovernorBattery.js:30-40`). New-arch interop: old `ReactContextBaseJavaModule` via `packageList` — PLAUSIBLE OK, unproven on device. Fix: rerun APK job; do not treat 33927024200 as green.

### M9. Test hygiene / error-path holes — CONFIRMED, major
`governorRuntime.test.ts:35-37` `mockImplementation` is not restored (`beforeEach` only `clearAllMocks`). No test for stale log, unknown generation → NoFit, LFM registry, `isGovernorFallback` negative cases, or LlamaService wiring. `governorInputs.test.ts` does not restore `readThermo` in `beforeEach`. Mocks are file-scoped (no cross-suite leak). Fix: `mockReset` in `beforeEach`; add the missing cases.

### m1. Stale “GPU now active” comments — CONFIRMED, minor
`LlamaService.ts:1393`: `// Production now offloads on Android too (deviceTuning → gpu-opencl)`
`engineParams.ts:101-103`: production “keeps whatever deviceTuning chose — which is now GPU offload on Android, not 0.”
`deviceTuning.ts:374`: `return { kind: "cpu-only", reason: "gpu-fit-gate-blind" };` Fix: delete the comments.

### m2–m5. Minor
- `isGovernorFallback` exported, only used internally (`governorRuntime.ts:23`).
- FALLBACK `reason` includes model path (`rn-llama.cpp:99-100`); `profile_valid:1` hardcoded on no-accelerator (`RNLlamaJSI.cpp:650`).
- `KALSA_NATIVE_VARIANT` logs JS `params.n_gpu_layers` (0) while native prefill is 99 (`LlamaService.ts:1523`; `rn-llama.cpp:72`).
- `sensorValid = temperature > 0` treats 0.0 °C as dead (`GovernorBatteryModule.kt:43`).

## Security / privacy — CLEAN
No thermo tenths, battery %, or device id on the JS `KALSA_GOVERNOR` line (`LlamaService.ts:917-926`). Native FALLBACK logs stage/reason/fit/profile_valid only. No new network. `nativeGovernorThermo` strips `thermo_source` (`LlamaService.ts:890-896`).

## Bridge field/units — CLEAN
Kotlin camelCase `battTempTenthsC` (BatteryManager tenths °C) → JS accepts both → native `batt_temp_tenths_c` /10 (`llama-governor-policy.cpp:22-23`). `npu_lane_enabled=false`, `reload_budget_available=false` (`governorInputs.ts:105-106`). Flag `kalsa.governor.enabled` default OFF (`governorRuntime.ts:16-20`). Failed governor init `cleanup()` then `unique_ptr` dtor before the single CPU `initLlama` (`rn-llama.cpp:78-90`; `governorRuntime.ts:41-47`). Thermo refresh exists on complete/translate/extract/prewarm **before** `completion()`. Patch `diff --git` list is llama.rn glue + pre-existing `common.cpp/h` kalsa markers; **no** ggml/llama vendored sources. New TS/Kotlin/plugin files all <250 lines. Vision/mmproj excluded (`LlamaService.ts:1302`). Dispose clears module governor flags (`:1729-1733`).

## Verdict
**NO-GO** — 2 blocker, 9 major, 5 minor. Do not run S5 until B1+B2 (and M1 probe) are fixed; otherwise the cell is CPU vs CPU with `thermo_source`/`fit` that will be misread as a governor result.

## Delta re-audit (5/09)

Tree `/Users/marco/Projects/kalsa-wt-governor` @ `c5c55a4`. Commits `1c4b142 4df562d 2646e77 826fe50 04ba9a9 c5c55a4`. CI `33932740946` **in_progress**.

### Part A — prior 16

| id | verdict | quote |
|---|---|---|
| B1 | **FIXED** | `ModelRegistry.ts:311` `kvBytesPerToken: 6656,` — logcat `A_sa803197e_s4_logcat.txt:9231` `size =  104.00 MiB ( 16384 cells…)` → `104×1048576/16384 = 6656`. |
| B2 | **PARTIAL** | JS no longer ANDs idle (`governorInputs.ts:138` `sensor_valid: sensor,`). Native still `t_idle_valid && t_idle_c + 1.0f < 42` when plugged (`llama-governor-policy.cpp:63`). Plan example `{plugged:true, sensor_valid:true}` without idle → init throw → CPU retry. S5 **must** send `t_idle_*` (test does, `:135-136`). |
| M1 | **FIXED** | `governorInputs.ts:47` `if (/(SM8650\|PINEAPPLE)/.test(soc)) return "V75"`. `deviceProfile.ts:520` `NativeModules?.GovernorBattery?.readSoc?.()`. Residual: modelName-only `"Pineapple for arm64"` still misses if `SOC_MODEL` empty. |
| M2 | **FIXED** | `LlamaService.ts:1528` `beginNativeLogEpoch()`; `:1545-1546` both logs are `nativeLogForEpoch(governorLoadEpoch)`. Stale epoch filtered. Test `governorRuntime.test.ts:64`. |
| M3 | **FIXED** | Only two emits: `:3248` then `return`; `:3559` after tool-exhaust path. Mutually exclusive. Prewarm/extract/translate/completeOnce only refresh, no emit. |
| M4 | **FIXED** | `GovernorBatteryModule.kt:45` `sensorValid", present && temperature > 0`. |
| M5 | **FIXED** | `governorInputs.ts:96-100` adds `estimate.computeMiB + estimate.kvMiB` on top of `nonEvictableMiB + gpuReserve` (second compute + second KV). LFM test Fit @12 GiB / NoFit @8 (`governorInputs.test.ts:113-125`). |
| M6 | **FIXED** | `LlamaService.ts:1538-1539` `delete governorParams.speculative`. Regex includes `Governor mode does not support` (`governorRuntime.ts:31`). |
| M7 | **FIXED** | `RNLlamaJSI.cpp:837-838` invalid thermo `return … jsi::Value(false)`. JS `:925-944` logs `KALSA_GOVERNOR_THERMO` and **does not throw**. Re-checks `engine === context` after await (`:923`). |
| M8 | **NOT FIXED** | New run `33932740946` `status: in_progress`, `conclusion: ""`. No APK proof yet. |
| M9 | **PARTIAL** | `resetAllMocks` (`governorInputs.test.ts:59`, `governorRuntime.test.ts:16`). Stale-log + LFM + pineapple tests added. Still no LlamaService wiring test. |
| m1 | **PARTIAL** | `engineParams.ts:101` no longer claims GPU offload. `LlamaService.ts:1608` still `deviceTuning selects gpu-opencl` vs `deviceTuning.ts:374` `cpu-only`. |
| m2 | **FIXED** | `isGovernorFallback` now used (`governorRuntime.test.ts:10,64`). |
| m3 | **FIXED** | `rn-llama.cpp:99` `"accelerator model load failed"` (no path). `RNLlamaJSI.cpp:672-676` `profile_valid:%d` from `governor_thermo_profile_is_valid`. |
| m4 | **FIXED** | `LlamaService.ts:1566-1568` governor logs `{ prefill: 99, decode: 0 }`. |
| m5 | **NOT FIXED** | still `temperature > 0` (`GovernorBatteryModule.kt:45`). |

### Part B — new

**Greedy (`826fe50`).** `benchSampling.ts:23-25` key `"greedy"` else `undefined`. `:36-48` temp 0, top_k 1, top_p 1, min_p 0, `penalty_last_n:0` / `penalty_repeat:1` (off), seed 42, `n_predict: Math.max(48,…)`, plus `n_probs:1`. Non-greedy: `:35` `if (mode !== "greedy") return params;` — `826fe50` LlamaService wraps the **same** `temperature: 0.7, top_k: 40, top_p: 0.95` object; no field changes when key unset. `KALSA_BENCH_TOKENS` only at `:3250` and `:3561`, both behind `benchSampling === "greedy"`, same mutually exclusive chat-turn exits. Not on prewarm/extract/translate. `n` sums `tokens_predicted`; `ids` first 32 (`:2748-2763`). Native: `rn-completion.cpp:45` `generated_token_ids.clear()` on rewind; `:1245-1246` push if `n_probs>0 && tok != -1`. **EOS omitted:** `:1176-1180` EOG returns with `result.tok` still `-1` (`:1036`). Symmetric in both S5 arms → oracle still comparable. `n_probs` applied **after** `common_sampler_sample` (`:1165-1170`); comment `common.h:224` “output the probabilities”. Does not choose the token. Both S5 arms set the key ⇒ both greedy + `n_probs:1` ⇒ cost symmetric. Privacy: key unset ⇒ `n_probs` stays 0, no push, no `KALSA_BENCH_TOKENS`. Tool rounds can fill the first 32 ids before the user-visible reply (S5 is tool-less).

**Vendor (`04ba9a9`).** Pin `e131345b7c1e14dcc081cae3591270aeec6d8659`. Fork HEAD same. `sed GGML_/ggml_ → LM_GGML_/lm_ggml_` then `diff` vendor vs fork `llama-governor.cpp/.h`, `llama-governor-runtime.cpp`, `llama-ext.h` = **empty**. Pure sync. Fork commit is **not** only friend+failure_reason: `llama-governor.cpp` also `fail("route Reject during phase handoff")` (was `"phase handoff failed"`) and stores `failure_reason_`. Header default `reload_budget_available = true` (`llama-ext.h:214`) restored from fork; JS still sends `false` (`governorInputs.ts:116`).

**Kotlin (`c5c55a4`).** `GovernorBatteryModule.kt:12` `import com.facebook.react.ReactPackage` matches Expo 57 `MainApplication.kt:11`. `readSoc` API<31: `:58-60` `putNull("socModel")`. Prebuild `MainApplication.kt:26` `add(GovernorBatteryPackage())`. QDC is API 34 (`VERSION_CODES.S`=31).

**CI.** `33932740946` in_progress. Not green, not red.

### Delta findings
- B2 residual (native plugged+no idle) — major until S5 JSON includes `t_idle_*`.
- EOS skipped in `generated_token_ids` — minor, both arms.
- Stale `gpu-opencl` comment — minor.
- CI unfinished — major for APK proof.

**Delta verdict: GO-WITH-FIXES** — 0 blocker, 2 major (B2 t_idle contract, CI not green), 3 minor. S5 may proceed once CI is green **and** bench-skin JSON carries `t_idle_valid`/`t_idle_c` (not the plan’s 4-field example).
