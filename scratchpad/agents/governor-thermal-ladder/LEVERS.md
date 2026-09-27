# Governor thermal ladder — levers research (read-only, 2026-09-27)

Question: SEVERE (Android status 3) must REDUCE load before it pauses; a pause alone
is not a governor. What can be turned, when, and at what cost? No code changed.

Repos: app `kalsa-wt-iroh`, binding `llama.rn-kalsa` @ 88b2b57e, engine `kalsallama`
(read at 833cde99b; the shipped pin is b11010-merge @ 8537d097c per `REPOS.md`).

## 1. The levers

| lever | mid-turn? | between turns? | where | cost to wire |
|---|---|---|---|---|
| Decode threads (`n_threads` / `n_threads_batch`) | NO today — no setter reaches the running context | NO — fixed at context creation | app picks: `threadProfile.ts:65` capacity rule (S23 = **5** threads, measured table `threadProfile.ts:10-14`), applied `LlamaService.ts:2476 n_threads: tuning.n_threads`, prefill-vs-decode split `:2454-2459` + `:2529-2534 applyPrefillThreadOverride` (only when they differ; G99 measured dual decode 2 / prefill 8). Binding defaults `rn-llama.cpp:838 default_threads = common_cpu_get_num_math()` at load; **binding never calls `llama_set_n_threads`** (grep cpp/src: 0 hits), engine has it (`kalsallama/src/llama-context.cpp:3887 → set_n_threads` `:1148-1153` writes cparams only) | HIGH — needs a JSI setter + pin bump, and open question: the binding attaches a ggml threadpool sized at load (`rn-llama.cpp:600-632`), decode takes `threadpool`/`threadpool_batch` (`llama-context.cpp:2541`), so cparams-only writes may be inert — needs a device answer |
| Decode duty cycle (pace between tokens) | NO effective JS path; native only | n/a | JS token delivery is **asynchronous**: `cpp/jsi/RNLlamaJSI.cpp:1332 callInvoker->invokeAsync(...)` then `:1338 onToken->call(...)` — a slow JS callback cannot throttle the decode thread. Native decode loop has no sleep/duty/throttle (grep `llama-governor-runtime.cpp` sleep\|duty\|throttl: 0 hits); the only native stop is the admission pause `-2` (`runtime.cpp:54-56` "no safe prefill chunk … pausing", decode side `:86`, `:133-137`) | HIGH — engine decode-loop pacing = policy/runtime change + pin bump; JS-only pacing would be cosmetic |
| Prefill backend CPU vs GPU per completion | Latched per prefill (route decided at admission, reset at prefill boundaries `llama-governor.h:82`, `llama-governor.cpp:179`) | **YES — pushed before every completion** | app: `benchRoute.ts:22-27` (`BENCH_ROUTE_PUSH_TIMEOUT_MS` doc: "push runs before every completion, each cooling retry, each utility call and the prewarm"), mode `benchConfig.ts:137 "cpu"\|"gpu"\|"auto"`; binding `rn-llama.cpp:734 setPrefillOverride(int)` + `src/index.ts:730`; engine latch `runtime.cpp:59-60` (requested → CPU/GPU), route evidence `KALSA_GOVERNOR.route_*` fields built in `benchRoute.ts` (governorRouteLogFields). The engine ALSO prefers CPU on its own when hot/low: `policy.cpp:155-160 prefill_engine()` returns CPU on CRITICAL/Invalid/LOWBAT or battery < 45 % | **LOW** — lever already exists end-to-end; productionizing = the ladder writing the stored route (app-only). Note `KALSA_GOVERNOR.forced` is a different thing: `LlamaService.ts:2738` forced = `governorBase.forced` (bench governor_force), not the route |
| Skip background prewarm (cut our own steady load) | n/a (background) | YES | skip ladder already exists: `LlamaService.ts:1056,1060,1069,1096 logPrewarm({op:"skip", reason:...})` (background / not_ready / kv_holds_chat / given_up) | LOW — app-only condition at the prewarm gate |
| Prefill chunk dose | **ALREADY AUTOMATIC mid-prefill** | n/a | engine policy table `policy.cpp:14 k_table_tokens {128,512,1024,2048}` + `:15 k_cpu_delta_c` vs `k_limit_c` (`:11`, warn40/limit39.5/kill43 `:10-12`); selection `policy.cpp:202-222`; partition loop + pauses `runtime.cpp:71-97` (Wait/Abort → `-2`; "Reducing tokens is the only allowed fallback; never switch to another engine" `:54-55`). This is the `"512+128+…"` of the logs | NONE (exists); tuning = policy constants (engine) |
| ubatch / n_batch | NO — context params at load | NO | `LlamaService.ts:2467 n_batch: 512`, `:2473 n_ubatch: tuning.n_ubatch` (guard ≤512, default 256 `:2471-2472`) | HIGH — changing needs a reload; not a runtime lever |
| NPU lane | not selectable today | not selectable | binding maps it but defaults off: `rn-governor-params.cpp:132 npu_lane_enabled = bool_or(governor, "npu_lane_enabled", false)`; TS option `types.ts:238`; app never sends it (grep app npu: 0 hits); and even enabled, `policy.cpp:155-177 prefill_engine()` returns only CPU / GPU / GPU_COOLMODE — NPU never requested (admission rule 2 exists for requested==NPU, `policy.cpp:211`); `params.npu_lane_enabled ? 512 : 0` token cap `policy.cpp:268`. Hexagon evidence = engine test judge only (`REPOS.md`) | HIGH + unproven hardware |
| Platform pause (≥3 → pause, resume ≤1, batt rule, 10-min cap) | at completion-attempt boundaries | YES | `platformPauseGate.ts` + `LlamaService.ts coolingRound` (commit 19368426, ON HOLD); cooling loop `thermalResume.ts:196`, poll `:69` (10 s), cap `:71` (**10 min**) | DONE (on hold) |
| Hard gate at CRITICAL (4) | blocks new work | YES | `thermalHardGate.ts:39-45 isAndroidThermalHardGated`, callers `engineEnsure.ts:69`, `useModelDownload.ts:141`, hook `useThermalHardGate.ts:65,77` | exists |
| Battery safety net (pause 43 / kill 44, owner) | mid-generation, native, per cell | — | `kalsallama policy.cpp:10-12` (k_warn 40, k_limit 39.5, k_kill 43) + thresholds rows `:45-55`; `classify()` `:66-79` → FAST/WARM/COOLMODE/CRITICAL (battery-only temp `:24-26`); pause `-2` reaches JS as `pause_reason` → `thermalResume.ts:31 pauseReasonOf` | untouched by design |

## 2. Where the ladder can live

- **Native policy** (`kalsallama/src/llama-governor-policy.cpp classify() :66`, called from `update_thermal :129/:132`; `update_thermal` runs whenever the app pushes a thermo profile — `runtime.cpp:178-190 set_thermo_profile`, app pushes at `LlamaService.ts:1735 refreshGovernorBeforeCompletion` before every completion and in the cooling refresh). **This is the only place with mid-generation (per-chunk/per-cell) control** — admission (`runtime.cpp:40-66`) and the decode pause (`:86`) act inside a running turn. Cost: engine change → binding pin bump.
- **TS (`platformPauseGate` / `LlamaService coolingRound`)**: completion-attempt boundaries only — can pause/resume, push the route, and skip work; **cannot** pace tokens (JSI token callback is `invokeAsync`, `RNLlamaJSI.cpp:1332`) or change threads/ubatch mid-generation. Cheap to iterate, no pin bump.
- Practical split: the ladder **decides in TS** (platform status read, levers pushed between completions) and the **native policy keeps the fast safety path** (battery + per-chunk dose + pause −2) — no new native surface needed for rungs 0–3.

## 3. Proposed ladder (Android status → levers)

| status | rungs (in order) |
|---|---|
| 0 NONE / 1 LIGHT | nothing: battery policy owns (classify FAST/…, bands `policy.cpp:10-12`) |
| 2 MODERATE | (a) skip background prewarm — cut our own steady load (between turns, app, LOW); (b) push prefill route `"cpu"` before every completion via the existing override (`benchRoute.ts`, LOW) — the engine already returns CPU on its own heat/battery rules (`policy.cpp:155-160`); battery thresholds untouched |
| 3 SEVERE | rungs of 2, and only if SEVERE persists → **pause as the last rung**: the existing attempt-gate → cooling loop (resume only at status ≤1 AND batt < 400 tenths, `thermalResume.ts:65,140-146`), bounded by the existing **10-min cap** (`thermalResume.ts:71`); battery pause/kill (43/44 owner values) stay as the mid-generation safety net |
| 4 CRITICAL | existing hard gate blocks new loads/downloads (`thermalHardGate.ts:39-45`) + engine admission already goes CPU/Abort (`policy.cpp:155-161`, `:188-193`); the platform pause stays armed underneath |

Not chosen as rungs (documented above): decode threads and ubatch (load-time only,
high cost), token duty cycle (JS inert; native = pin bump), NPU (not wired anywhere
in the app path and unproven).
