# DESIGN — NPU (Hexagon HTP) as the per-phase governor's prefill backend

Design only, 2026-09-28. No app/binding/engine change accompanies it. Evidence:
quality verdict **EQUIVALENT** to OpenCL incl. commit_side (`governor-htp-prefill-spike/REPORT.md`,
"handoff variance across three prompts": HTP mean agreement 99.306 % / mean KLD 0.000853797 inside
OpenCL's prompt ranges; commit bytes `21,741,568/21,741,568` identical per backend), dispatch proof
1,089 `HTP0 execute-op MUL_MAT` lines (`raw/kld_htp.log`), **4.7× faster than GPU on the S23**
(`s23-heat-arms-engine/REPORT.md:86-88`: P-GPU 6,948.76 ms vs P-NPU 1,470.99 ms prompt eval),
**73.3 % cooler per prompt on the S23** (`s23-heat-arms-engine/REPORT.md:90-91`: median battery area
per 1k tokens 73.3 % below OpenCL, 85.5 % below CPU), **53 % cooler on the 8 Elite**
(`qdc-8elite-heat-arms/REPORT.md:43-46`: NPU skin area 21.2 vs GPU 45.5 °C·s).

## 1. The path from the app to an HTP0 prefill context

| stage | where | state |
|---|---|---|
| governor JSON | app `governorInputs.ts:183-208 buildGovernorParams` → spread at `LlamaService.ts:2375-2386`, `:2485 governor: governorLoad` | **`npu_lane_enabled: false` hardcoded `governorInputs.ts:207`**; `npu_fit`/`htp_trunk_readable`/`htp_experts_readable` never sent |
| binding parse | `rn-governor-params.cpp:129-133` parses `npu_fit`, `htp_trunk_readable`, `htp_experts_readable`, `npu_lane_enabled` | **hard blocker `:148-150`: `if (params.npu_lane_enabled) throw "Governor NPU lane is not supported"`** |
| two contexts | `rn-llama.cpp:77-78` `prefill_params.n_gpu_layers = 99` / `decode_params.n_gpu_layers = 0`; two `common_init_from_params` `:100, :110`; `rn_governor` ctor `:134-138`; contexts built `vendor/llama.cpp/src/llama-governor.cpp:38-53` (+ KV-route guard `:46-50`) | decode forced CPU today; prefill rides the default GPU backend |
| device selection (missing link) | `llama_model_params.devices` NULL-terminated list (`vendor …/include/llama.h:314-315`); `common_params.devices` vector (`common/common.h:347`) filled by name (`common/arg.cpp:1115-1136 parse_device_list`: `ggml_backend_load_all` + `ggml_backend_dev_by_name` + nullptr terminator), applied `common/common.cpp:1695-1696` | the binding never sets it; the spike did, in the test only: `KALSA_PREFILL_DEVICE=HTP0` (`governor-htp-prefill-spike/REPORT.md` "Modifica minima", `tests/test-governor-v0-hybrid.cpp:34-46,412-417` on spike commit `4997b298`) |
| packaging + env | **already in the APK**: `unzip -l /Users/marco/kalsa-apks/aba67977-debuggable/…/app-release.apk` → `assets/ggml-hexagon/libggml-htp-v73.so` (653 416 B) + v75/v79/v81, `lib/…/librnllama_v8_2_dotprod_i8mm_hexagon_opencl.so`; binding: `android/build.gradle:50,58` includes `libggml-htp-*.so`; `RNLlama.java:27-30` lists v73–v81; `RNLlama.java:150-169` `resolveHtpDirectory` → `ensureHtpLibraries` → **`Os.setenv("ADSP_LIBRARY_PATH", …)` + `GGML_HEXAGON_DEVICES=16` (`:165-167`)** | done — no packaging work |
| runtime eligibility | arch detected at backend init: `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6850 "ggml-hex: Hexagon Arch version v%d"` (`:7210 GGML_HEXAGON_ARCH` override, `:3752` loads `libggml-htp-v%u.so` per arch); SoC map `governorInputs.ts:61-74` (SM8550→V73) | v73+ ⇔ shipped assets (v73–v81 present) |

**Memory fit (two-context layout).** Baseline plan numbers: `required_mib_with_repack 4518.12`,
`without 2998.06`, `available ~4116–4285 MiB` (baseline raw `KALSA_GOVERNOR_PLAN` lines). Spike
buffers: HTP prefill CPU 205.08 MiB + **HTP0 1 525.87 MiB** vs OpenCL CPU 205.08 + CPU_REPACK
205.08 + OpenCL 1 307.20 → the HTP prefill copy costs ≈ **+219 MiB** over OpenCL. So the
with-repack lane becomes ≈ 4737 MiB > S23 availability: on the 8 GB S23 the NPU lane realistically
needs `decode_repack=false` (decode copy drop, `rn-llama.cpp:86-89`). `lanePrice`
(`governorInputs.ts:86-115`) must price the HTP copy; `npu_fit`/`htp_*_readable` are parsed but have
**no consumer yet** (`vendor …/llama-ext.h:250-252`, `rn-governor-params.cpp:130-133`) — they are
the intended eligibility hooks.

## 2. Policy: how prefill_engine() chooses NPU vs GPU vs CPU

Today (`vendor …/llama-governor-policy.cpp:174-203`): safety early-returns → **CPU**
(invalid/CRITICAL/LOWBAT/battery <45 %, `:186-188` "safety preempts"); then the `/bench route`
override request (`llama_governor_prefill_mode {Auto=0, CPU=1, GPU=2}`, `llama-ext.h:311-315`;
set via `benchConfig.ts:137 "cpu"|"gpu"|"auto"` → `rn-llama.cpp:734-736` → `rn-governor.cpp:89-93`
→ C API `llama-ext.h:466` → `policy.cpp:362-369`, consulted only after safety `:190`); then
generation+Fit+measured → GPU; else CPU. **NPU is never returned.**

Owner direction → branch shape (behind `npu_lane_enabled`):

- **NPU preferred while cool**: new first branch after the safety returns —
  `npu_lane_enabled && npu_fit==Fit && htp_*_readable && classify()==FAST → NPU`
  (classify `:83-91`; lane cap already `prefill_token_cap = npu_lane_enabled ? 512 : 0`,
  `policy.cpp:267-268`, a subset of the chunk table `{128,512,1024,2048}` `:19`).
- **CPU is out for prefill**: today's CPU fallback rows stay only as the safety
  (the heat table makes it useless: P-CPU 9 905.57 ms / 44.59 °C·s per 1k vs P-NPU 1 470.99 /
  6.45, `s23-heat-arms-engine/REPORT.md:86-88`); CRITICAL keeps refusing in admission
  (`admit_prefill` Abort/Wait + token-dose table, and the engine `-2` pause "no safe prefill chunk
  under the thermal ceiling; pausing").
- **Sustained NPU heat → hop to GPU**: the engine already holds the signal —
  `k_trend_c_per_min = 1.5`, `k_dwell_ms = 10 min` (`policy.cpp:9-13`) feeding `update_thermal` →
  `classify`; the hop rule is `FAST → NPU`, sustained-positive-trend/WARM → GPU. **Exact thresholds
  pending lab** (heat arms for NPU-sustained not run; the owner said measurements are pending) —
  land the branch disabled (`npu_lane_enabled=false`) and flip after the arm.
- App/platform signal (from `LEVERS.md`): Android status rides the TS ladder + the per-completion
  route push; if JS-side override must express NPU, extend the mode enum (`llama-ext.h:311-315`
  + the range check `policy.cpp:363-365`) with `NPU = 3` — optional; policy-first is preferred
  because only the policy sees temperature inside a prefill.

## 3. Changes, pin bumps, tests

1. **Engine** (`kalsallama`): NPU branch in `prefill_engine` + router/policy unit tests
   (`tests/test-governor-v02-router.cpp`), devices/hybrid extension of
   `test-governor-v0-devices.cpp` and `test-governor-v0-hybrid.cpp` (spike pattern). Host tests:
   **`KALSA_HYBRID_GGUF`** gates the model-backed hybrid target (`tests/test-governor-v0-hybrid.cpp:233-235`,
   unset → SKIP exit 77; `:119` rejects a non-hybrid model); standing seven-target check stays
   `0 0 77 77 0 0 0` (`REPOS.md`).
2. **Binding** (`llama.rn-kalsa`): lift the `rn-governor-params.cpp:148-150` throw behind the
   explicit param; set `prefill_params.devices = { HTP0 }` in `load_governor_models`
   (`rn-llama.cpp:77+`, name resolution per `common/arg.cpp:1115-1136`); host build + tests.
3. **Pins**: app `package.json` + lock → binding commit; binding `vendor/VERSIONS` → engine commit;
   provenance via `scripts/assert-engine-provenance.sh` (`REPOS.md`: "Only editing the sha in
   package.json and the lockfile" changes the build).
4. **App** (`kalsa`): `governorInputs.ts:207` → conditional `npuLaneEnabled` (generation ∈
   {V73,V75,V79} ∧ htp fit ∧ no-repack-fit on 8 GB), send `npu_fit` + `htp_*_readable`, price the
   +219 MiB HTP copy in `lanePrice` (`governorInputs.ts:86-115`), add the fields to
   `buildGovernorPlanLog`; host tests `governorInputs.test` / `governorPlanLog.test`. Evidence line
   needs no new log: `KALSA_GOVERNOR.engine_prefill` already reports the engine the policy chose
   (stats `vendor …/llama-governor.cpp:21,55`).

## 4. Risks

- **HTP session init at load**: two full model loads (`rn-llama.cpp:100,110`) plus the CDSP
  session — spike peak RSS 2.47 GiB and no isolated init-time number; the governor load gets
  slower and fitter-sensitive (measure load time + MemAvailable before/after in step 5).
- **FastRPC failures**: observed non-fatal `error 0x14` URI lookup with single-session CDSP
  fallback (spike `raw/kld_htp.log:271`; `s23-heat-arms-engine/REPORT.md:118`); a lane-on load that
  fails outright must funnel through the existing fallback (`log_governor_fallback` →
  `governorRuntime.ts initWithGovernorFallback` + `KALSA_GOVERNOR_FALLBACK_RETRY`), not wedge.
- **Runtime GPU fallback**: while the hop is unmeasured, only admission `Wait`/`-2` and the
  platform ladder (see `../governor-thermal-ladder/LEVERS.md`) protect a running turn; a mid-turn
  HTP *crash* can only be rescued by reload → soak before default-on.
- **Samsung perfmond**: `s23-dsp-spin-web/REPORT.md:13-17` — `perfmond`'s Perfetto session hands
  fds to `traced_perf`, then `adsprpcd`/`cdsprpcd` spin at100 % with no public bug; `:101` the
  `debug.perfmond.*` setprop is SELinux-accepted but its effect unproven, `:156-161` mechanism is
  inference. Long-lived CDSP sessions could burn exactly the heat the NPU saves → soak arm watches
  the daemons (`s23-dsp-spin-web/STOP-SOURCE.md`, `SETPROP-TRIAL.md` for non-root mitigations).

## 5. Step plan (small, reviewable commits)

1. **engine**: policy NPU branch (disabled by default) + router tests; seven-target host run green.
2. **engine**: devices/hybrid test extension (spike `KALSA_PREFILL_DEVICE` pattern) + `KALSA_HYBRID_GGUF` host run; quote exit codes.
3. **binding**: throw → explicit param + `prefill_params.devices={HTP0}`; host build/tests.
4. **app**: pin bumps (package.json+lock), `governorInputs` eligibility + HTP-fit pricing (+219 MiB), plan fields; host tests.
5. **device**: debuggable APK soak — load time, FastRPC/URI fallback, perfmond spin watch, `KALSA_GOVERNOR.engine_prefill=NPU` proof on a real turn.
6. **heat arm** (s23-heat-arms method, NPU-sustained reps) → hop thresholds → only then flip `npu_lane_enabled` default.
