# Learning governor - code recon (2026-10-12)

Delegate: Paseo Explorer (claude-haiku-5-5), agent 19a75cfb, read-only. Engine `f1f612388`
(~/Projects/kalsallama-upstream-b11514), binding `2581a9aa` (~/Projects/llama.rn-kalsa-onecopy), app `df359450`
(~/Projects/kalsa-wt-severe). Coordinator spot-checked: the two legs rows (`rn-legs-table.cpp:74-91`) and that the
policy stores `params_` once (`llama-governor-policy.h:170`, getters only). The rest is the delegate's reading; the
binding's `getGovernorStats` conversion and the native-log capture path were not verified by it.

## 1. Decision points

**Prefill leg**: `prefill_engine()`, `src/llama-governor-policy.cpp:368-446`.
- Inputs: `state_`, `profile_valid_`, `params_.npu_lane_enabled`, `gpu_fit`, `generation`, `model_kind`,
  `hot_plugged_`, `state_from_platform_`, the bench override.
- Safety preempt `:381-382` (`state_ == LOWBAT) { return llama_governor_engine::CPU; // safety preempts`).
- NPU first `:415-416` (`if (npu_lane_live() && not_a_safety_state()) { return llama_governor_engine::NPU;`).
- Comment `:411`: `"GPU when the NPU is hot" needs an NPU temperature input that does not exist yet`.
- GPU fallback `:427-434`: only when the NPU is not live, V73/V75/V79/V81 with `gpu_prefill_measured`. GPU_COOLMODE
  `:436-441`: V73 MoE, battery-only. CPU otherwise `:443-445`.
- Admission chunking `admit_prefill()` `:458`; `k_table_tokens = {128,512,1024,2048}`, `k_cpu_delta_c[] = { 1.9f,
  3.25f, 3.25f, 5.15f }` (`:21`), called "unmeasured defaults" near `:479`.

**Decode leg**: `select_decode()`, `policy.cpp:544-615`.
- Wait `:547-552` without profile or in Unknown / Invalid / CRITICAL.
- Hop active only when `:571` `params_.decode_hop_tokens > 0 && npu_lane_live() && not_a_safety_state()`; inactive
  -> CPU `:586`.
- GPU_COOLMODE `:597-607`: V73, COOLMODE not from platform, not hot-plugged, gpu Fit, cool delta measured, kexp
  scope, cool_pays != No, reload budget, 60 min flip window (`k_flip_window_ms` `:10`).
- Hop legs `src/llama-governor-policy-hop.cpp`: `heat_rank_fit()` `:64-92` ("HEAT_RANK (owner rule v3) takes the
  window on the cheapest-heat leg that is fit"); `hop_decide()` `:159`; leg choice `:228-234`; fallbacks NPU_FIRST
  `:236-256` (hysteresis `k_hop_hysteresis_c = 4.0f`, `policy.h:32`), GPU_BURST `:257-278`, alternation `:278` when
  zones are unknown. Decisions only at window boundaries (`policy.cpp:571-577`).
- Pacing duty `llama_governor_decode_pacing_duty()` `src/llama-governor-pacing-duty.cpp:68-86`: `std::min({
  headroom_duty(headroom, params), battery, cap })`; status >= 3 -> min duty; status 2 -> `decode_coolmode_duty`
  (`:46-56`). Sleep in `pace_decode()` (`llama-governor-pacing.cpp`), capped by `k_decode_pacing_cap_us = 250000`.

**Safety states** (`update_thermal()` `policy.cpp:248-340`):
- Unplugged thresholds warm 38, cool 39.5, kill 44 (`:190-200`); plugged t_idle-based capped at 42. `k_warn_c = 43`
  (`:16`), `k_kill_c = 44` (`:18`), `k_dwell_ms` 10 min (`:9`).
- CRITICAL / Invalid: prefill CPU, decode wait, admission Abort. LOWBAT: prefill CPU, hop inactive.
- COOLMODE: no NPU/GPU prefill except V73 MoE GPU_COOLMODE; hop allowed.
- WARM / FAST: NPU prefill and hop allowed.
- Platform floor `policy.cpp:49-62`: status 2..6 raises FAST/WARM to COOLMODE, never cools (applied `:321`).
  `state_from_platform_` blocks GPU_COOLMODE for decode (`:597`) and prefill (`:432`).

## 2. Legs table

- `cpp/rn-legs-table.cpp`: struct `rn_legs_row` `:41-60`, rows `k_rows[]` `:75-91`. Per row: soc, hexagon arch,
  gpu vendor/model tokens, gpu compiler, `decode_headroom_tau_s`, `decode_heat_weight`,
  `decode_heat_per_token_npu/gpu/cpu`, `decode_hop_tokens`, `decode_leg_weighting`, `decode_load_step_npu/gpu/cpu_c`,
  `decode_guard_headroom_c`. **No tok/s, no prefill numbers, no throughput floors.**
- Two rows: S23 SM8550/v73/Adreno 740 (heat 2.8/3.2/4.7, load steps 19/9/22, guard 5); Xiaomi 14 SM8650/v75/Adreno 750
  (heat 1.1/3.2/7.3, load steps 5/11/26, guard 5). tau 10 s and heat weight 7 are rule constants.
- **Units conflict** (delegate): S23 comment "per-token heat 2.8/3.2/4.7 skin C"; Xiaomi comment "1.1/3.2/7.3 skin C
  per 1k tokens"; engine `llama-ext.h` comment on `decode_heat_per_token_*` "battery C*s/token from the lab; NPU
  0.15-0.17, CPU 0.30, GPU 0.35-0.42". Resolve before a learner reads them.
- Path: `rn_legs_for(hw_facts)` (`rn-legs-table.cpp:176`) -> `rn-llama.cpp:443-446`; `merge_leg_row_defaults()`
  (`rn-governor-params.cpp:353`) fills only keys JS did not send. Gated on one-copy + `npu_lane_enabled`
  (`rn-llama.cpp:445`); match needs SoC, Hexagon arch, Adreno tokens, compiler line, dotprod (`:101-110`).
- App: `buildGovernorParams` sends `decode_hop_tokens` only when > 0 (`governorInputs.ts:341-343`);
  `pacingHeadroomLines()` adds the pacing lines for SM-S911 and 23127PN0CG.

## 3. Runtime measurements

| Signal | Where | Cadence | Side |
|---|---|---|---|
| Per-leg decode tokens and time | `llama-governor.cpp:545-555` (`stats_.decode_tokens_npu += ...; stats_.decode_us_npu += engine_us;`) | per decode batch | engine stats |
| Prefill timing | `prefill_ms`, `prefill_chunks`, `prefill_ctx_ngl` + `prefill_engine` | per turn | engine stats, read in JS |
| Per-turn tok/s | `turnTelemetry.ts:136-140, 199-202` | per turn | JS |
| Component temps (cpu/nsp/gpu zones) | `rn-thermal-legs.cpp:83-117` (min over passive trip) | every `decode_hop_tokens` (32) tokens, `rn-governor.cpp:164-182` | binding only; JS never reads zones |
| Battery temp, level, plugged | `GovernorBatteryModule.kt:63`; `readGovernorThermo()` `governorInputs.ts:479` | per completion (`LlamaService.ts:1785`) | JS -> engine |
| Battery trend | `trend_c_per_min` default 0 (`governorInputs.ts:475`); no producer found | - | always 0 |
| Android status | `rn-platform-thermal.h:22`, 1 s | 1 s | native |
| Android headroom | `rn-platform-thermal.h:28`, 2 s; JS sends none (`rn-governor.cpp:218-220`) | 2 s | native |
| Battery current / charge / voltage | Meter, `kalsa.bench.energy_trace=1`, 1 Hz | per turn | bench only |

## 4. Persistence and runtime updates

- Persisted keys: `kalsa.governor.enabled` (`governorRuntime.ts:3`), bench keys `kalsa.bench.thermo`,
  `governor_force`, `npu_lane`, `decode_hop`, `energy_trace`. **No per-device learned state anywhere.** Engine and
  binding write no files.
- Load path: `buildGovernorParams()` (`governorInputs.ts:321`) -> binding JSON parse (`rn-governor-params.cpp`) ->
  row merge (`rn-llama.cpp:446`).
- Mid-session: thermo profile per completion (`LlamaService.ts:1785-1790` -> `rn-governor.cpp:199-226`); decode
  headroom pushed by the binding per window (`rn-governor.cpp:187-196`); decode legs via `refresh_decode_legs()`
  (`llama-governor-legs.cpp:271-296`); prefill override (bench).
- **Decode params are construction-only**: heat per token, load steps, guard, hop tokens, tau, weighting, pacing
  lines, coolmode duty. No setter. A learner that changes them needs a new engine entry point.
- `decode_floor_tps_*` (`llama-ext.h`): read by `refresh_decode_legs`, never set by binding or app.

## 5. Existing per-turn logs

- `KALSA_GOVERNOR` (`LlamaService.ts:1854-1930`): engine_prefill/decode, prefill_ms/chunks/ctx_ngl, thermal_state,
  thermo_source, decode_tokens_cpu/npu/gpu, decode_hops, decode_hop_headroom_windows, decode_paced_*, pacing duty and
  headroom last, platform status, state_source, route fields. **Missing: per-leg decode time (`decode_us_*`), battery
  temp value, per-zone temps.** Counters are cumulative since the last cache clear: diff consecutive lines.
- `KALSA_TELEMETRY` (`turnTelemetry.ts:227`), `KALSA_GOVERNOR_PLAN` (`governorInputs.ts:228`),
  `KALSA_GOVERNOR_PLATFORM` / `_HEADROOM` / `_THERMO` (binding `rn-governor.cpp:78-84, 275, 304, 311`).
- Hop line `llama-governor-policy-hop.cpp:292-296` (native LLAMA_LOG_INFO; JS capture unverified).
- Bootstrap gap: no per-turn per-leg tok/s line.

## 6. Invariants and pins

- Safety states force CPU (`policy.cpp:381-382, 415, 571`); CPU leg never excludable (`legs.cpp` H-05,
  `policy-hop.cpp:~220`, `llama-ext.h` set_decode_legs doc).
- One leg change per window, at window boundaries (`policy.cpp:571-577`; `policy-hop.cpp:4`). No reload inside a hop
  (`policy.cpp:~560`).
- Platform-raised COOLMODE never buys GPU decode/prefill: `test_platform_coolmode_never_buys_gpu_decode`,
  `test_platform_coolmode_skips_gpu_cool_prefill` (`tests/test-governor-platform-thermal.cpp`).
- Status >= 2 floors to COOLMODE and never cools (`test_high_status_floors_at_coolmode`); status 5 never kills the
  session; platform drop waits the battery dwell.
- Heat rank: hysteresis 4 C; return needs guard + hysteresis (`test-governor-v02-hop-heat-rank.cpp`).
- Pacing sanitizers (`test-governor-pacing-duty.cpp`). Binding row gating (`tests/legs_table_test.cpp`,
  `thermal_legs_test.cpp`, `governor_v3_precedence_test.cpp`). App: `declaredSevere.test.ts`,
  `governorInputs.test.ts`, `governorBatterySampler.test.ts`; hard gate `thermalHardGate.ts:51-53` (status >=
  CRITICAL, fail-open on unknown).

**Not found:** NPU temperature input to prefill; per-leg tok/s in any log; native battery trend producer; any
decode-param setter; persisted per-device learned state.
