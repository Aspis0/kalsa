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

## Delta re-audit 2 (5/09, db1606c)

`db1606c` patch: `shouldUseMTP` / `should_use_mtp` `throw` → `return false`. Also deleted the stale `gpu-opencl` comment (`LlamaService.ts` was `:1608`).

**MTP fix — CONFIRMED.** `rn-completion.cpp:720-721` `if (parent_ctx->hasGovernor()) { return false; }`. `rn-slot.cpp:334-335` same. Caller `rn-completion.cpp:1031-1032` `if (shouldUseMTP()) { return nextTokenMTP(); }` → plain `nextToken()`. `initMTP()` `:752-753` returns before `createMTPDraftContext`. Slot `:375` `if (!should_use_mtp() || spec != nullptr) { return; }`. JSI `:1260` media+MTP check also becomes false. No draft ctx, no `common_speculative_init`.

**`createMTPDraftContext` (`rn-llama.cpp:788-790`) is NOT model-init.** Callers: `rn-completion.cpp:772` (inside `initMTP`), `rn-slot.cpp:409` (inside `init_mtp`), `rn-slot-manager.cpp:107` (`ensure_mtp_speculative`, only from `init_mtp` `:405`). After this fix all three are gated by `shouldUseMTP`/`should_use_mtp` = false. **UNREACHABLE** in governor mode. (Load-time MTP refusal is a different throw: `rn-llama.cpp:633` on `has_speculative_mode`; JS already `delete governorParams.speculative` `:1538-1539`.)

**Telemetry.** S5 one chat turn (no tools) hits `:3247` `emitGovernorTelemetry` + `:3249` `KALSA_BENCH_TOKENS` then `return`. `:3558-3560` is the tool-exhaust path only. Mutually exclusive. Exactly one of each per completed chat turn.

**CI `33936537090`:** `status: in_progress`, `conclusion: ""`.

### Remaining `hasGovernor()` throws → app

| site | throw | JSI | LlamaService | S5 run 2 | verdict |
|---|---|---|---|---|---|
| `rn-llama.cpp:788` | MTP draft ctx | (via completion) | `completion` | no, `shouldUseMTP` false | **UNREACHABLE** |
| `:921` applyLora | runtime LoRA | `llamaApplyLoraAdapters` | none in `src/` | — | **UNREACHABLE** |
| `:953` removeLora | runtime LoRA | `llamaRemoveLoraAdapters` | none | — | **UNREACHABLE** |
| `:972` initMultimodal | mmproj | `llamaInitMultimodal` | `:1689` only when `mmprojPath`; `governorLoad` requires `!mmprojPath` (`:1302`) | vision models | **UNREACHABLE** in governor (mutually exclusive) |
| `:1117` clearCache | `"Governor mode does not support clearCache"` | `llamaClearCache` | `:848` prefix-hash miss; `:3922` translate; `:4034` completeOnce; extract only if `EXTRACT_MEMORY_PRESERVE_CHAT_KV` false (`ttftFlags.ts:37` true) | S5 mount skips notify (`AppShell.tsx:2063-2067`) | **REACHABLE** (settings change / translate / completeOnce). Throw **swallowed** (`:849`, `:3923`, `:4035`); KV **not** cleared. Finding: degrade is silent no-op, not dual-KV clear / CPU reload+FALLBACK. |
| `enableParallelMode :1044` | parallel slots | `llamaEnableParallelMode` | none | — | **UNREACHABLE** |
| `RNLlamaJSI.cpp:834` | `"Governor mode is not enabled"` | `llamaSetGovernorThermo` | `:925` only if `activeGovernorActive` | inverse gate | **UNREACHABLE** while governor on (JS catch `:935` anyway) |
| `JSISession.h:48` load | session load | `llamaLoadSession` | `:1662` skipped if `activeGovernorActive`; extract snapshot restore caught | fresh install | **UNREACHABLE** on S5; **REACHABLE-ONLY-WITH-FEATURE** restore |
| `JSISession.h:158` save | session save | `llamaSaveSession` | `:2115` persist after chat, catch `:2234` | after turn, background | **REACHABLE-ONLY-WITH-FEATURE** (KV persist). Caught; turn still succeeds. |

**Delta-2 verdict: GO-WITH-FIXES** for S5 run 2. The QDC hot-path throw is gone; prewarm+one chat turn no longer hits a `hasGovernor()` throw. Remaining REACHABLE throws (`clearCache`, session save) do not fail that turn but still must not throw — they currently throw-and-swallow without clearing both KV stores. CI not green yet.

## Delta re-audit 3 (5/09, 6f0a33c0d + fcaf0df)

Device S5 run 2 (`QRD8650_B_t1_filtered.txt:1799-1809`): `admit_prefill: prompt cannot be partitioned into safe tabled chunks` twice; telemetry `tokensCached:1024, tokensEvaluated:1329, tokensPredicted:0, promptMs:45154`; `KALSA_GOVERNOR engine_prefill:CPU commit_bytes:0`. Logcat `failed to eval, n_eval: 290` then `n_eval: 305, n_past: 1024`. Prewarm `{"op":"done","promptMs":0}`.

**1. Admission tail — PARTIAL for this prompt.** `k_table_tokens = {128,512,1024,2048}` (`llama-governor-policy.cpp:14`). New branch only when `table==0` (`:197-207`): `prompt_tokens < 128 && now_c + 1.9 <= 39.5` → Admit (CPU request) or CPUFallback (else) with `tokens = prompt_tokens`. **305 is not < 128.** Walk: 305 → table row 128 (`Chunk`); remainder 177 → 128; remainder **49** → `table==0` → **this** branch. Device died on that 49-Wait *before* any 128-chunk `llama_decode`. Runtime partition: `llama-governor-runtime.cpp:56-66` treats Wait as `"prompt cannot be partitioned…"` `-2`. Tests: `test-governor-v02-router.cpp:190-192` only `CPU, 49, 35°C → Admit tokens==49`. No 1329/1024, no 305, no GPU-requested 49 (would be CPUFallback `:202-203`). `fcaf0df` copies that policy file only.

**CPUFallback does not move work to `ctx_decode`.** `admit_prefill` sets `result.engine = CPU` always (`policy.cpp:181`) and never reads it in the runtime. Caller (`runtime.cpp:48-49`): `tokens >= n_tokens` → `return 0`. Then `decode_impl` still `llama_decode(target, batch)`.

**2. Routing — policy does NOT pick the context. CONFIRMED.** `llama-governor.cpp:166-167` `is_prefill = n_tokens > 1; target = is_prefill ? ctx_prefill : ctx_decode`. `:171-176` policy rc only Abort/Wait/chunk. `:195` `llama_decode(target, batch)`. `prefill_engine()` (`:158-160`) GPU only if `V75 && Fit && gpu_prefill_measured`. App never sets it (`governorInputs.ts:110-117`; parse default false `rn-governor-params.cpp:136`). Stats `stats_.prefill_engine = policy_.prefill_engine()` (`runtime.cpp:27`) → log says CPU while **eval is on the GPU handle** (ngl 99). Governor is not inert. `gpu_prefill_measured: true` on V75 (ALIVE #55-58, Adreno 750 pp512 284-291 vs CPU ~99) is a **telemetry/router-label** fix, not a ctx switch. **V79: no GPU branch** (`:158-166` only V75 GPU and V73 GPU_COOLMODE). PLAN maps SM8750→V79; GOVERNOR-STATE `:79` “v75 GPU prefill only when fit and measured”; Adreno 830 GPU prefill is MEASURED (`:26-28`). Gap, not a documented V79-never-GPU rule.

**3. 45 s / commit 0 / would the tail fix emit a token?** `n_batch: 512` (`LlamaService.ts:1420`) ⇒ 1329 = 512+512+305. 512 is an exact table row → Admit → real `llama_decode(ctx_prefill)` (that is the 45 s). Then 305 partition hits 49-Wait → `-2`. `rn-completion.cpp` `if (parent_ctx->decode(...))` logs `failed to eval, n_eval: 305, n_past: 1024` on **any** non-zero rc — not a 305-token `llama_decode`. `commit_bytes=0`: never `n_tokens==1`, so no prefill→decode `commit_side` (`llama-governor.cpp:186-189`). **Tail fix alone is not enough:** after chunks, `admit_prefill` `return 0` (`runtime.cpp:90`) and **outer** `decode_impl` still `llama_decode(target, original 305 batch)` (`:195`) with n_past already advanced by 128+128+49 → second fail. Chunking tests are policy-only.

**4. Prewarm false success — CONFIRMED.** `LlamaService.ts:766` `n_predict: 0`; `:783-792` `predicted > 0` → skip, else `op: "done"` even when `promptMs` is 0. Native `-2` does not throw. Minimal detect: refuse `done` if `promptMs == 0` (or `tokens_cached` << prefix / native admit error).

**5. Tests** do not exercise 1329/1024 or GPU tail. Quote: `:190-192` CPU 49 Admit; `:185-186` GPU 512 CPUFallback (exact row, not a tail).

**Delta-3 verdict: NO-GO** for S5 run 3.

## Delta re-audit 4 (5/09, e1a0f5028 + ac4820d)

**1. Pre-fix vs post-fix.** Chunk loop was already at `runtime.cpp:56-89`. Pre-fix `return 0` after decoding 128+128+49, then `decode_impl` `llama_decode`’d the original 305 (`llama-governor.cpp` old `:176 return policy_rc`). Device: `n_batch:512` → 512+512 Admit (exact table rows) then 305 → partition Wait on 49 → `-2` `"cannot be partitioned"` → llama.rn `if (decode())` logs `failed to eval, n_eval:305, n_past:1024`. Post-fix: `enum { k_prefill_chunked = 1 }` (`llama-governor.h:41`); chunk loop `return k_prefill_chunked` (`runtime.cpp:90`); `return policy_rc == k_prefill_chunked ? 0 : policy_rc` (`llama-governor.cpp:176`) **skips** the original-batch `llama_decode` (`:196`). Sequence: `llama_decode` 512, 512, 128, 128, 49. `llama_batch_get_one` has `pos/n_seq_id/seq_id/logits = nullptr` (`llama-batch.cpp:937-941`); `token+offset` is the only live pointer — correct. Test `make_batch` (`turns.cpp:59-67`) sets last-token logits only; last 49-view `logits+256` keeps `logits[304]=1`. `seq_id` is `llama_seq_id**`; `+offset` is per-token. Failing chunk: `runtime.cpp:85-87` `if (rc != 0) return rc` (sticky `failed` from inner `decode_impl`). Then 1-token decode → `commit_side` prefill→decode (`llama-governor.cpp:187-190`). Measured `commit_bytes=9186048`.

**2. Delta-3 finding 1: FIXED.** Quote `llama-governor.cpp:175-176` `if (policy_rc != 0) { return policy_rc == k_prefill_chunked ? 0 : policy_rc; }` — original 305 is not replayed. Residual: `k_prefill_chunked==1` equals llama.cpp “KV slot” rc; a chunk returning 1 would be swallowed. Unlikely at n_ctx 8192 / 1329 tokens.

**3. Tests I ran.** `cmake --build …/build --target test-governor-v0-turns test-governor-v02-router -j8` exit 0. `test-governor-v02-router` EXIT 0 `router_v02_golden=PASS`. Assert `admitted == std::vector<uint32_t>{ 128, 128, 49 }` (`test-governor-v02-router.cpp:215-216`) under GPU request. `test-governor-v0-turns -m …/stories15M-q4_0.gguf` EXIT 0: `governor_chunked_prefill=PASS decodes=512+512+128+128+49 generated=1 commit_bytes=9186048`. No-double-eval: `prefill_ubatches != 5` fails (`turns.cpp:164-167`); 5 = 512+512+128+128+49, a replayed 305 would be 6.

**4. Vendor `ac4820d`.** Pin + `VENDOR_SHA` + `build-info.cpp` + three governor files only. `diff` after `ggml_`/`GGML_` → `lm_ggml_`/`LM_GGML_` = MATCH.

**5. Remainder.** Prewarm `803b499`: `LlamaService.ts:797-798` `evalFailed = (nativeError…) || tokensEvaluated <= 0 || promptMs <= 0`. Legit prewarm with `promptMs>0` and `tokensEvaluated>0` is not skipped. Device fail (`promptMs:0`) is now `op:skip eval-failed`. `gpu_prefill_measured: generation === "V75" || generation === "V79"` (`governorInputs.ts:117`). V79 still has no GPU branch in `prefill_engine()`; PLAN S5 still names 8 Elite with no written deferral. **Acceptable for QRD8650 (V75).** Not for the 8 Elite cell.

**6. CI `33941962100`:** `status: in_progress`, `conclusion: ""`.

**Delta-4 verdict: GO** for S5 run 3 on QRD8650 (APK must include `ac4820d`). No code change required for that board. Wait for CI green or sideload an `ac4820d` APK. Do not start 8 Elite until a V79 GPU prefill rule exists.

## Delta re-audit 5 (6/09, 6ed44f567 + 64931c1)

Device: run 3 B `promptMs 0` because `JSICompletion.h:193` `llama_perf_context(ctx->active_ctx())` after the last 1-token decode.

**1. Timing.** `prefill_us` wraps each `llama_decode` with `n_tokens>1` (`llama-governor.cpp:206-216`). Chunked path: inner 512+512+128+128+49 each add; outer `k_prefill_chunked` skips a replay. Reset: `beginCompletion` → `resetGovernorPrefillStats()` (`rn-completion.cpp:681`) zeros `prefill_us`/`prefill_n`/`prefill_chunks` (`runtime.cpp:126-129`). Per **completion**, not process. Commit is `commit_side` on phase change (`llama-governor.cpp:187-190`), **outside** the timed window. `commit_ms` stays `commit_us/1000` (`RNLlamaJSI.cpp:863`). `prefill_n += n_tokens` per successful prefill batch (`:137`). Cached 1024 + new 305 ⇒ `prefill_n=305` this turn (reset after prewarm). CPU: `n_p_eval` = prompt tokens with batch>1 since `llama_perf_context_reset` (`llama-context.cpp:669-673`; `include/llama.h:1539-1542` `t_p_eval_ms` / `n_p_eval`). Governor `prompt_n`/`prompt_ms` (`JSICompletion.h:196-201`) match **this-completion new tokens**. Clocks: CPU `t_p_eval` is compute-start→`synchronize`; governor is full `llama_decode` wall. Same tokens, slightly wider B window. Commit excluded both.

**2. Arm A.** `governor_prefill = hasGovernor() && prefill_n > 0` (`:195`). FLAG-OFF uses `timings.n_p_eval` / `t_p_eval_ms` as before. Extra `governorStats()` empty copy (`rn-llama.cpp:617`). Functionally identical `promptMs`.

**3. Chunks.** `char prefill_chunks[128]` (`llama-ext.h:313`); per-chunk `snprintf` into remainder (`llama-governor.cpp:138-141`); cleared on reset. Not per-token. Long prompts truncate silently. `prefill_ctx_ngl = ctx_prefill->get_model().n_gpu_layers()` at ctor (`:59`) = prefill `params.n_gpu_layers` (`llama-model.cpp:1683-1685`) → 99.

**4. Vendor `64931c1`.** vendor/ = ext + three governor files + SHA + build-info. `diff` after `ggml_`/`GGML_` rename = MATCH. Tests (I ran): `test-governor-v02-router` EXIT 0; `test-governor-v0-turns` EXIT 0 `governor_chunked_prefill=PASS decodes=512+512+128+128+49 prefill_us=251443 generated=1 commit_bytes=9186048`. Assert `prefill_n == 1329 && prefill_us != 0 && chunks=="512+512+128+128+49"` (`turns.cpp:168-169`). Reset-across-turns not tested (app resets at `beginCompletion`).

**5. Hot path.** No new throw on a turn. `lm_ggml_time_us` only if `is_prefill` (`:206`); 1-token decode does not call it.

**6. CI `33946344038`:** `in_progress`, `conclusion: ""`.

**Delta-5 verdict: GO** for S5 run 4 TTFT on QRD8650 (APK `64931c1`). Use `KALSA_TELEMETRY promptMs` / `KALSA_GOVERNOR prefill_ms` as this-turn new-token prefill; do not compare to prewarm.

## Delta re-audit 6 (6/09, residuals)

**1. Sentinel.** `k_prefill_chunked = -1001` (`llama-governor.h:45`). Documented `llama_decode` rcs (`include/llama.h:964-968`): `0` success, `1` KV slot, `2` aborted, `-1` invalid batch, `< -1` fatal. Implemented in `llama-context.cpp`: `-1`, `-2`, `-3`, `1` (no `-1001`). Callers: `runtime.cpp:90` return; `llama-governor.cpp:186` map to `0`. Residual: `-1001` is in the documented fatal class; a future `llama_decode` using that value would be swallowed. Not in this tree.

**2. V79.** `prefill_engine` (`policy.cpp:157-163`): `(V75 || V79) && Fit && gpu_prefill_measured` — same guards, no thermal change. ALIVE **cell** #38 (table row 21): G ttft **1434/1470** vs C **16476/14412**, decode **25.3/24.2**. Router: V79 FAST → GPU (`test-governor-v02-router.cpp:211-212`); V75 without measured stays CPU (`:39-40`); V73 is GPU_COOLMODE decode, not this GPU prefill branch. No new Unknown-generation assert; code excludes it.

**3. clear_cache.** Both ctx: `llama_memory_clear(..., clear_data)` (`runtime.cpp:126-132`); `llama.h:718-721` honours `data`. Null mem no-op (`llama-context.cpp:3799-3801`). Resets `prefill_state`/`decode_state` (watermarks), `last_phase=None`, commit counters (`:134-146`). Does **not** clear sticky `failed`. App: `rn-llama.cpp:1123-1132` no throw; also `embd.clear()`/`n_past=0`. Callers inside `withEngineJob`: prefix miss `:868` (skips if `engineJobPendingCount > 0` `:859-863`); translate `:3964`; completeOnce `:4076`. Lock comment `:629`. JSI still `throwIfContextBusy` (`RNLlamaJSI.cpp:2315`) — not new; FIFO should not hit it. No new hot-path throw.

**4. Session skip.** Save: `saveEngineSession` `:2044-2046` **before** native; one `KALSA_SESSION {"op":"save","ok":false,"reason":"governor-mode"}` (`:3678`). `snapshotNativeSession` same (`:3687-3689`). Load: `:1688` `console.warn` (not that JSON); `restoreNativeSession` `:3710` silent `return false`. FLAG-OFF save path unchanged (gate is `activeGovernorActive`).

**5. Vendor `e8c2b1f`.** Pin `3a161adfc`. vendor MATCH after `ggml_`/`GGML_` rename (cpp/h/runtime/policy/ext). Tests I ran: router EXIT 0; turns EXIT 0 `governor_chunked_prefill=PASS decodes=512+512+128+128+49 prefill_us=251039 generated=1 commit_bytes=9186048` (telemetry intact; clear_cache asserted).

**6. CI `33947705999`:** `in_progress`.

**Delta-6 verdict: GO** for S5 run 4 on QRD8650 (APK `e8c2b1f`).

## Delta re-audit 7 (6/09, a6642b73d + 0517dc2)

Device: S5 B2 Wait at 38.14 °C stalled (`-2`). Abort still `fail("prefill admission aborted")` (`runtime.cpp:46-47`).

**1. Route.** First multi-token: `decode_impl` `:178-179` resets `prefill_route_` only if `last_phase != Prefill`. Wait or (`CPUFallback && thermal_state != FAST`) while Undecided → CPU (`runtime.cpp:49-59`) `return 0` then `target = ctx_decode` (`llama-governor.cpp:190-191`). CPUFallback in FAST is the exact-row GPU-request label (512/49 tails), **not** a thermal fallback — honouring it always would CPU-prefill cool 512s. Ignoring it in FAST: line 64-67 `return 0` ⇒ outer `llama_decode` of that batch on GPU. Safe for the 49-tail. Reset is **not** `beginCompletion`; only phase-edge + `clear_cache` (`runtime.cpp:161`). Prewarm (`n_predict:0`) leaves `last_phase=Prefill` and a sticky route into the chat turn. First 1-token after CPU prefill: `cpu_route_handoff` (`:202-204`) skips `commit_side`; `target=ctx_decode`. Test pos max 304 after 305-token prompt (`turns.cpp:249`), then 305 after generate (`:265`).

**2. Later Wait on GPU route does not drop tokens.** `:64-67` `return 0` after GPU is already chosen = “do not chunk; `decode_impl` `llama_decode`s the **original** batch” (`:214`). Chunk-loop Wait (`:87-89`) returns 0 **before** the 128+128+49 `decode_impl` for-loop, so the outer call still evals the full n_eval. REFUTE drop. Side effect: a hot remainder after a cool 512 is GPU-eval’d anyway.

**3. Tests I ran.** Build EXIT 0. Router EXIT 0. Turns EXIT 0: `governor_hot_cpu_prefill=PASS engine=CPU chunks=cpu:305 prefill_us=24694 generated=1 commit_bytes=0` and chunked `prefill_us=251327`. Assert is `generated < 0` (`turns.cpp:264`) — **accepts token 0**. Must be `generated >= 1`. `position_matches(..., 304)` is 305 tokens (max pos exclusive-end).

**4. Telemetry.** `governorEngineName(CPU)="CPU"` (`RNLlamaJSI.cpp:53`). Hot path sets `prefill_engine=CPU`, `prefill_chunks="cpu:N"`, `prefill_us` around CPU `llama_decode`, `commit_bytes=0`. **Clobber:** every later `decode_impl` calls `refresh_policy_stats()` (`:183`) which does `stats_.prefill_engine = policy_.prefill_engine()` (`runtime.cpp:27`) — WARM still returns GPU (`policy.cpp` V75+measured). After the first generated token, `KALSA_GOVERNOR engine_prefill` is **GPU**. Test does not re-check engine after generate.

**5. Vendor `0517dc2`.** Pin `a6642b73d`. MATCH after `lm_ggml_` rename. No new throw. Timing/clear_cache still present.

**6. CI `33951262697`:** `in_progress`.

**Delta-7 verdict: GO-WITH-FIXES** — stall is gone; S5 “engine_prefill CPU” is not guaranteed.
