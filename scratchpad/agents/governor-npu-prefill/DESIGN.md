# DESIGN — NPU (Hexagon HTP) as the per-phase governor's prefill backend

Design only, 2026-09-28 (rework after review). No app/binding/engine change accompanies it.
Evidence: quality verdict **EQUIVALENT** to OpenCL incl. commit_side
(`governor-htp-prefill-spike/REPORT.md`, "handoff variance across three prompts": HTP mean
agreement 99.306 % / mean KLD 0.000853797 inside OpenCL's prompt ranges; commit bytes
`21,741,568/21,741,568` identical per backend), dispatch proof 1,089 `HTP0 execute-op MUL_MAT`
lines (`raw/kld_htp.log`), **4.7× faster than GPU on the S23**
(`s23-heat-arms-engine/REPORT.md:86-88`: P-GPU 6,948.76 ms vs P-NPU 1,470.99 ms prompt eval),
**73.3 % cooler per prompt on the S23** (`s23-heat-arms-engine/REPORT.md:90-91`), **53 % cooler on
the 8 Elite** (`qdc-8elite-heat-arms/REPORT.md:43-46`: NPU skin area 21.2 vs GPU 45.5 °C·s).

Citations: policy/engine lines are the **fork** (`/Users/marco/Projects/kalsallama`); lines that
exist only in the **pinned vendor copy** (`llama.rn-kalsa/vendor/llama.cpp`, the tree the app
actually builds, `REPOS.md`) say so — fork main has no `set_prefill_override`.

## 1. The path from the app to an HTP0 prefill context

| stage | where | state |
|---|---|---|
| governor JSON | app `governorInputs.ts:183-208 buildGovernorParams` → spread `LlamaService.ts:2375-2386`, `:2485 governor: governorLoad` | **`npu_lane_enabled: false` hardcoded `governorInputs.ts:207`**; `npu_fit`/`htp_trunk_readable`/`htp_experts_readable` never sent |
| binding parse | `rn-governor-params.cpp:129-133` parses `npu_fit`, `htp_trunk_readable`, `htp_experts_readable`, `npu_lane_enabled` | **hard blocker `:148-150`: `if (params.npu_lane_enabled) throw "Governor NPU lane is not supported"`** |
| two contexts | `rn-llama.cpp:77-78` `prefill ngl=99 / decode ngl=0`; loads `:100,:110`; contexts built in the governor (vendor `llama-governor.cpp:38-53`, KV-route guard `:46-50`) | decode forced CPU; prefill rides the default GPU backend today |
| device selection (missing link) | `llama_model_params.devices` NULL-terminated (fork `include/llama.h:314-315`); `common_params.devices` (`common/common.h:347`), filled by name (`common/arg.cpp:1115-1136 parse_device_list`), applied `common/common.cpp:1695-1696` | the binding never sets it; the spike did, in the test only: `KALSA_PREFILL_DEVICE=HTP0` (spike REPORT "Modifica minima", `tests/test-governor-v0-hybrid.cpp:34-46,412-417` on spike commit `4997b298`) |
| packaging + env | **already in the APK**: `unzip -l …/aba67977-debuggable/…/app-release.apk` → `assets/ggml-hexagon/libggml-htp-v73.so` (653 416 B) + v75/v79/v81; binding `android/build.gradle:50,58`; `RNLlama.java:27-30` (v73–v81); `RNLlama.java:151-170` `resolveHtpDirectory` → `ensureHtpLibraries` → `Os.setenv("ADSP_LIBRARY_PATH")` + `GGML_HEXAGON_DEVICES=16` (`:165-166`) | done; **the failure paths only `Log.w` and disable Hexagon — see §3 degrade rule** |
| runtime eligibility | arch at backend init: `ggml/src/ggml-hexagon/ggml-hexagon.cpp:6850 "ggml-hex: Hexagon Arch version v%d"` (`:7210 GGML_HEXAGON_ARCH`, `:3752 libggml-htp-v%u.so` per arch); SoC map `governorInputs.ts:61-74` (SM8550→V73) | v73+ ⇔ shipped assets |

**Memory fit.** Baseline plan: `required_mib_with_repack 4518.12` / `without 2998.06` /
`available ~4116–4285 MiB`. Spike buffers: HTP0 prefill **1 525.87 MiB** vs OpenCL 1 307.20 →
**≈ +219 MiB** → with-repack NPU lane ≈ 4737 MiB > S23 availability: on the 8 GB S23 the lane
needs `decode_repack=false` (`rn-llama.cpp:86-89`); `lanePrice` (`governorInputs.ts:86-115`) must
price the HTP copy. `npu_fit`/`htp_*_readable` are parsed but have **no consumer yet**
(fork `llama-ext.h:250-252`) — they are the intended eligibility hooks.

## 2. Policy: NPU vs GPU vs CPU

Today (fork `llama-governor-policy.cpp`): `prefill_engine() :155-177` — safety early-returns →
**CPU** (`:155-161`: invalid/CRITICAL/Invalid/LOWBAT), bench force (`:161`), gen+Fit+measured →
GPU, V73-MoE-cool → GPU_COOLMODE, else CPU. **NPU never returned.** The `/bench route` override
lives only in the **pinned vendor** copy: mode enum `{Auto=0,CPU=1,GPU=2}` (vendor
`llama-ext.h:311-315`), consulted *after* safety (vendor `policy.cpp:188 "safety preempts"`,
`:190` hook), set via `benchConfig.ts:137` → `rn-llama.cpp:734-736` → `rn-governor.cpp:89-93` →
vendor `llama-ext.h:466` → vendor `policy.cpp:362-369` (range check).

Owner direction → branch shape (behind `npu_lane_enabled`):

- **NPU preferred while cool**: first branch after the safety returns —
  `npu_lane_enabled && npu_fit==Fit && htp_*_readable && state==FAST → NPU`.
  `classify` (fork `:66-79`) is refreshed inside `update_thermal` (fork `:88`, `state_ = classify`
  `:129/:132`); hop out uses `can_leave` (fork `:84-86`: exit temperature **and** dwell
  `k_dwell_ms` fork `:8`, 10 min). Lane cap already exists: `prefill_token_cap` =
  `npu_lane_enabled ? 512 : 0` (fork `:267-268`), a subset of the chunk table
  `{128,512,1024,2048}` (fork `:14`); `prefill_rule` (fork `:181-188`, NoHTP→1, GPU→5,
  GPU_COOLMODE→8, else 9) is the per-turn evidence of the choice in stats.
- **CPU is out for prefill**: heat table P-CPU 9 905.57 ms / 44.59 °C·s per 1k vs P-NPU 1 470.99 /
  6.45 (`s23-heat-arms-engine/REPORT.md:86-88`); CPU rows stay only as the safety (CRITICAL keeps
  refusing in admission + the engine `-2` pause "no safe prefill chunk under the thermal ceiling").
- **Sustained NPU heat → hop to GPU**: signal already in-engine — `k_trend_c_per_min = 1.5`
  (fork `:13`) + dwell (`:8`) feeding `update_thermal`/`classify`; rule `FAST → NPU`,
  positive-trend/WARM → GPU. **Exact thresholds pending lab** (NPU-sustained heat arm not run);
  land the branch disabled and flip after the arm.
- App/platform signal rides `../governor-thermal-ladder/LEVERS.md`; if JS override must express
  NPU, extend the vendor enum with `NPU = 3` (vendor `llama-ext.h:311-315` + range check
  `:363-365`) — optional, policy-first is preferred (only the policy sees temperature mid-prefill).

## 3. Changes, pin bumps, tests

1. **Engine** (kalsallama): NPU branch + router/policy unit tests (`tests/test-governor-v02-router.cpp`);
   devices/hybrid extension of `test-governor-v0-devices.cpp` / `test-governor-v0-hybrid.cpp`.
   **Test integrity — the exit vector `0 0 77 77 0 0 0` (`REPOS.md`) alone cannot tell "skipped
   because unset" from "broken and skipped"**: every 77 must be proven by its stderr line
   `KALSA_HYBRID_GGUF is unset` (`tests/test-governor-v0-hybrid.cpp:233-235`, message
   `governor-hybrid: SKIP KALSA_HYBRID_GGUF is unset (exit 77)`), **and** one run with
   `KALSA_HYBRID_GGUF` set to the ship GGUF (`LFM2.5-2.6B-QAD-Q4_0.gguf`, SHA-256
   `a247afd64149…d40b03`, spike REPORT) must exit **0**. A runner that records vector-only is a
   failed check.
2. **Binding** (llama.rn-kalsa) — **degrade, never throw**:
   - `common/arg.cpp:1115-1136 parse_device_list` **throws** `invalid device: %s` when
     `ggml_backend_dev_by_name` misses or resolves to CPU (`:1127-1129`), while the Java side only
     warns and disables Hexagon: `RNLlama.java:151-152` (no HTP dir), `:158-159` (lib install
     failed), `:165-170` (`setenv` failed). On a phone without the lane that combination makes the
     **whole governor load throw** (a rejected `prefill_params.devices` reaches
     `common_init_from_params`, `rn-llama.cpp:100` → `fail("accelerator_model_load", …)`).
   - Spec: in `load_governor_models`, **resolve `HTP0` first** — `ggml_backend_load_all()` +
     `ggml_backend_dev_by_name("HTP0")` (same lookup as `arg.cpp:1126`) — and only if it resolves
     set `prefill_params.devices = { dev, nullptr }`. If it is absent (lane off, HTP dir/libs/env
     failed): **fall back to GPU** with a logged reason in **`KALSA_GOVERNOR_PLAN`** — new fields
     `npu_device` (`"HTP0" | "GPU"`) and `npu_fallback` (`null | "htp-device-missing" |
     "htp-dir-missing" | "htp-libs-missing" | "htp-env-missing"`), so the plan line the harness
     gates on always states which prefill device was actually chosen and why. No throw, no
     `invalid device`.
   - Host build + tests after the throw at `rn-governor-params.cpp:148-150` is lifted behind the
     explicit param.
3. **App** (kalsa): `governorInputs.ts:207` → conditional `npuLaneEnabled`
   (generation ∈ {V73,V75,V79} ∧ `npu_fit==Fit` ∧ HTP-copy fit ∧ **no mmproj** — see below), send
   `npu_fit` + `htp_*_readable`, price the +219 MiB HTP copy in `lanePrice`
   (`governorInputs.ts:86-115`), add `npu_device`/`npu_fallback` to `buildGovernorPlanLog`; host
   tests `governorInputs.test` / `governorPlanLog.test`. Evidence needs no new log line:
   `KALSA_GOVERNOR.engine_prefill` already reports the chosen engine (fork
   `llama-governor.cpp:21,55`). **Pins**: app `package.json`+lock → binding commit; binding
   `vendor/VERSIONS` → engine commit (`REPOS.md`, `scripts/assert-engine-provenance.sh`).
   - **mmproj/vision eligibility (found, exists)**: the app gate is
     `LlamaService.ts:2375-2386` — `governorLoad` requires `… && !options.mmprojPath &&
     !streamExperts`; the engine governor has **no** mmproj guard (grep `llama-governor*`/`llama-ext.h`
     for mmproj → 0 hits). The NPU predicate therefore inherits it by living only inside
     `governorLoad`, and it must be restated explicitly in the NPU condition (reviewer's request):
     no vision model ever reaches the HTP lane.

## 4. Risks

- **HTP session init at load**: two model loads (`rn-llama.cpp:100,110`) + CDSP session; spike peak
  RSS 2.47 GiB, init time not isolated — measure load time and MemAvailable before/after (step 5).
- **FastRPC**: observed non-fatal `error 0x14` URI lookup → single-session CDSP fallback (spike
  `raw/kld_htp.log:271`, heat REPORT:118); a lane-on load that fails outright must funnel through
  the existing fallback (`log_governor_fallback` → `governorRuntime.ts initWithGovernorFallback` +
  `KALSA_GOVERNOR_FALLBACK_RETRY`), not wedge.
- **Session save/restore with two contexts**: under the governor, sessions are already **banned**
  — save refused at `LlamaService.ts:5926-5928` (`if (activeGovernorActive && engine === context)`)
  logging `logGovernorSessionSaveSkip` → `:5916 KALSA_SESSION {"op":"save","ok":false,"reason":"governor-mode"}`
  (second save site `:3309`), load refused at `:5981-5984` (same guard, `return false`). So an
  HTP prefill context serializes nothing today and the NPU lane adds **no session risk under the
  ban**. If the ban is ever lifted, the serialized session is a decode-context artifact whose KV
  layout must match the prefill backend it was taken with — restoring a GPU-prefill session onto
  an HTP prefill context (or back) must be rejected by backend identity, not attempted.
- **Runtime GPU fallback**: until the hop is measured, only admission `Wait`/`-2` and the platform
  ladder (`../governor-thermal-ladder/LEVERS.md`) protect a running turn; a mid-turn HTP *crash*
  can only be rescued by reload → soak before default-on.
- **Samsung perfmond**: `s23-dsp-spin-web/REPORT.md:13-17` (perfmond's Perfetto session hands fds
  to `traced_perf`, then `adsprpcd`/`cdsprpcd` spin at 100 % with no public bug; `:101` SELinux
  accepts the `debug.perfmond.*` setprop but its effect is unproven; `:156-161` mechanism is
  inference) — long-lived CDSP sessions could burn exactly the heat the NPU saves → soak arm
  watches the daemons (`s23-dsp-spin-web/STOP-SOURCE.md`, `SETPROP-TRIAL.md`).

## 5. Step plan (small, reviewable commits)

1. **engine**: policy NPU branch (disabled by default) + router tests; seven-target host run green —
   with the **77-proof rule** (stderr `KALSA_HYBRID_GGUF is unset` for each 77) plus one
   `KALSA_HYBRID_GGUF=<ship GGUF>` run expecting 0.
2. **engine**: devices/hybrid test extension (spike `KALSA_PREFILL_DEVICE` pattern) + same proofs.
3. **binding**: lift the `:148-150` throw behind the explicit param; **resolve-then-set devices with
   GPU degrade + `npu_device`/`npu_fallback` in KALSA_GOVERNOR_PLAN** (never `parse_device_list` on
   an unresolved name); host build/tests.
4. **app**: pin bumps (package.json+lock), eligibility (incl. `!mmprojPath`), HTP-fit pricing
   (+219 MiB), plan fields; host tests (`governorInputs`, `governorPlanLog`).
5. **device**: debuggable APK soak — load time, FastRPC/URI fallback, perfmond spin watch,
   `KALSA_GOVERNOR.engine_prefill=NPU` proof on a real turn, plan shows `npu_device`.
6. **heat arm** (s23-heat-arms method, NPU-sustained reps) → hop thresholds → flip the default.
