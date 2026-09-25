# RECON — `/bench route cpu|gpu|auto` insertion points (read-only)

Spec: `../governor-archive-mining/SYNTHESIS.md` §4 (~L140-165).
Heads pinned at read time: engine `1b70069cb`, binding `531b477b`, app `e1d3441d`.
No code written; engine HEAD moves under another coder — re-verify line numbers before editing.

## 1. Engine `kalsallama-wt-oom` @ 1b70069cb

### Existing `bench_force_gpu_prefill`
- Declared: `src/llama-ext.h:254` — `bool bench_force_gpu_prefill = false; // bench-only: force GPU prefill when gpu_fit==Fit; production leaves it false` (a field of `llama_governor_params`, `llama-ext.h:243-264`).
- Read: `src/llama-governor-policy.cpp:171` — `if (params_.bench_force_gpu_prefill && params_.gpu_fit == llama_governor_fit::Fit) { return llama_governor_engine::GPU; }`.
- **Set path, init-time only:** app writes `kalsa.bench.governor_force` (`kalsa/src/engine/governorInputs.ts:9`, read `readBenchGovernorForce` `:214-221`) → load JSON `bench_force_gpu_prefill` parsed by binding `llama.rn-kalsa/cpp/rn-governor-params.cpp:134` (`params.bench_force_gpu_prefill = bool_or(governor, "bench_force_gpu_prefill", false);`) at `llama_init_context_with_params` → copied once into `policy_.params_` at construction `src/llama-governor-policy.cpp:37` (`: params_(params)`). **No setter exists; `params_` is private const-after-init.** Changing it today requires reload (app mirrors this: `LlamaService.ts:348` `activeGovernorForced`, set at load `:2751`, cleared `:2944`).

### Smallest per-decode override (copy the `set_thermo_profile` shape)
Template hops in-engine:
- method decl `src/llama-governor.h:37` — `bool set_thermo_profile(const llama_governor_thermo_profile &, int64_t now_ms);`
- method impl `src/llama-governor-runtime.cpp:220`
- C API impl `src/llama-governor-runtime.cpp:312-314` — `return governor && governor->set_thermo_profile(profile, now_ms);`
- C API decl `src/llama-ext.h:422` — `LLAMA_API bool llama_governor_set_thermo_profile(...)`
- threading contract `src/llama-governor.h:15-16` ("decode-thread methods and must not overlap").

Mirror as:
1. `llama-ext.h` next to :422: `LLAMA_API int llama_governor_set_prefill_override(llama_governor*, int mode);` (0=auto, 1=cpu, 2=gpu).
2. `llama-governor.h` next to :37: `int set_prefill_override(int mode);` + member (e.g. `int prefill_override_ = 0;` beside `prefill_route_` `:98`).
3. `llama-governor-runtime.cpp` next to :312: thin wrapper → governor method → `policy_.set_prefill_override(mode)` + `refresh_policy_stats()` (runtime.cpp:43-53) so `stats_.prefill_engine` reflects it.
4. `llama-governor-policy.{h,cpp}`: member + setter; consult it **only inside `prefill_engine()` after the safety early-return**.

`prefill_engine()` `src/llama-governor-policy.cpp:165-190` (quoted):
```cpp
llama_governor_engine llama_governor_policy::prefill_engine() const {
    if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
        state_ == llama_governor_thermal_state::CRITICAL || state_ == llama_governor_thermal_state::Invalid ||
        state_ == llama_governor_thermal_state::LOWBAT) {
        return llama_governor_engine::CPU;                 // :166-171 safety gate — MUST stay first
    }
    if (params_.bench_force_gpu_prefill && params_.gpu_fit == llama_governor_fit::Fit) {  // :171
        return llama_governor_engine::GPU;
    }
    ... // :174-189 measured V73/V75/V79 → GPU; V73 MoE cool → GPU_COOLMODE; else CPU
```
Insert after :171 block: `if (override == CPU) return CPU; if (override == GPU) return params_.gpu_fit == Fit ? GPU : CPU;` — the Fit gate mirrors :171, so force-GPU never overrides a failed fit; force-CPU below the gate is safe (CPU is the fallback everywhere). `prefill_rule()` `:191-197` then reports 9 (CPU) / 5 (GPU) automatically.

### Forced-CPU interaction with latch + admission
- Per-turn route reset: `src/llama-governor.cpp:247-249` — `if (is_prefill && allow_chunking && last_phase != phase::Prefill) { prefill_route_ = prefill_route::Undecided; }` (also `reset_prefill_stats` runtime.cpp:213-218, `clear_cache` :201).
- Latch: `src/llama-governor-runtime.cpp:97-101` — `if (prefill_route_ == prefill_route::Undecided) { prefill_route_ = requested == CPU ? CPU : GPU; stats_.prefill_engine = requested; }`. So forced CPU latches on the **first** prefill batch of the turn; later batches reuse it.
- Admission still runs first: `runtime.cpp:80-95` — `requested = policy_.prefill_engine()` → `policy_.admit_prefill(requested, n_tokens, now_c, n_batch)`. Forced CPU changes only the `requested` label: exact-row match → `Admit` (rule 9) instead of `CPUFallback`; table/heat Wait, the n_batch caps, and Abort on Invalid/CRITICAL (`policy.cpp:201-211`) are all unchanged → **no safety bypass**.
- Latched-CPU batches skip re-admission but keep the thermal gate: `runtime.cpp:66-77` ("The latched route skips re-admission below, so the Invalid/CRITICAL gate must still run here…").
- Execution: `llama-governor.cpp:255-257` — `const bool cpu_prefill = is_prefill && prefill_route_ == prefill_route::CPU; llama_context * target = cpu_prefill ? ctx_decode : ...` — both contexts exist from init, so **no reload, no KV move** (handoff skips `commit_side` via `cpu_route_handoff` `:273-276`). CPU pause behavior identical (Wait → `-2`, `runtime.cpp:88-94`).

### Per-chunk route facts collection (engine)
- Natural point: `src/llama-governor.cpp:299-303` — after `stats_.prefill_us += (ggml_time_us() - t0);` (t0 at `:287`) and before/next to `record_side(...)` `:303`, inside `if (is_prefill)`; every executed piece (whole batch or each partition chunk from `runtime.cpp:130-153`) passes through here with `batch.n_tokens`, `prefill_route_` (actual), `stats_.prefill_engine` (requested/latched) in scope; `forced = prefill_override_ != 0`.
- Storage: new fixed array + count in `llama_governor_stats` beside `src/llama-ext.h:358-361` (`uint64_t prefill_us; uint64_t prefill_n; char prefill_chunks[128];`) — e.g. `route_chunks[64] {index, requested, actual, tokens, prefill_ms, forced}` + `route_chunk_count`; reset in `reset_prefill_stats` (`runtime.cpp:213-218`, which already clears `prefill_chunks` at :217). `prefill_chunks` string proves precedent (`llama-governor.cpp:156-165` appends `cpu:`/`+N` per side).
- `reset_prefill_stats` is called per completion by the binding (`llama.rn-kalsa/cpp/rn-completion.cpp:807`), so stats are turn-scoped for free.

## 2. Binding `llama.rn-kalsa` @ 531b477b

### `set_thermo_profile` hops (copy exactly)
1. App → JS: `kalsa/.../LlamaService.ts:1779` `engine.setGovernorThermo(nativeGovernorThermo(snapshot))`.
2. JS wrapper: `lib/module/index.js:339-343` (`async setGovernorThermo(profile) { ... llamaSetGovernorThermo(this.id, profile); }`); global listed in `jsiBindingKeys` `index.js:13` (and `lib/commonjs/index.js:44,372-376`); TS decl `lib/typescript/jsi.d.ts:8`, method `lib/typescript/index.d.ts:211`.
3. JSI host fn: `cpp/jsi/RNLlamaJSI.cpp:831-854` — `createFromHostFunction(... "llamaSetGovernorThermo", 2 ...)` → parse `governorThermoFromJsi` (`RNLlamaJSI.cpp:42`) → `createPromiseTask` → `getContextOrThrow` → **`throwIfContextBusy(ctx)` (`:220-226`)** → `hasGovernor()` check → `ctx->setThermoProfile(profile)` (`:847`), returns bool promise. Load-time sibling: `:1215`.
4. Context: `cpp/rn-llama.cpp:730-732` `setThermoProfile` → `cpp/rn-governor.cpp:80-86` (`rn_governor::set_thermo_profile`, guards `governor_ == nullptr || failed_`) → `llama_governor_set_thermo_profile` (engine).
`setPrefillOverride` = same five hops: new global `llamaSetPrefillOverride(contextId, mode)` beside `RNLlamaJSI.cpp:831`, `llama_rn_context::setPrefillOverride` beside `rn-llama.cpp:730`, `rn_governor::set_prefill_override` beside `rn-governor.cpp:80`, add to `jsiBindingKeys` (`index.js:13`, `commonjs/index.js:44`), `jsi.d.ts` + `index.d.ts`, wrapper method beside `index.js:339`, and one `getGovernorStats`-style field passthrough.

### Returning per-chunk facts in the completion result (next to `pause_reason`)
- `pause_reason` emitted: `cpp/jsi/JSICompletion.h:188-193` — `if (!c.governor_pause.empty()) { res["pause_reason"] = c.governor_pause; }`; set in `cpp/rn-completion.cpp:1721-1728` (`governor_pause = pause;` at :1726), reset per completion at `:104`.
- Governor stats are already fetched for the same result: `JSICompletion.h:212-219` — `const auto governor_stats = ctx->governorStats(); ... t.prompt_n/prompt_ms from governor_stats.prefill_n/prefill_us`. Add, right there: `res["route_mode"]`, `res["route_chunks"]` (array from `governor_stats.route_chunks[0..route_chunk_count)`), gated on `ctx->hasGovernor()` like `:213`.
- `governorStats()` chain: `rn-llama.cpp:734` → `rn-governor.cpp:88-92` → `llama_governor_get_stats`; JSI serializes fields in `RNLlamaJSI.cpp:864-876` (e.g. `:875` `result.setProperty(rt, "prefill_chunks", ...)`) → add `route_chunks` there; JS side `lib/module/index.js:345-349` `getGovernorStats()` needs no change beyond the type.

## 3. App `kalsa-wt-bench-apk` @ e1d3441d

- **Parsing:** `src/bench/benchConfig.ts:824-828` `isBenchCommand` accepts `/bench ` or `bench:`; `stripBenchPrefix` `:833-841`; `tryHandleBenchCommand` `:848-856` (`parts = stripBenchPrefix(...).split(/\s+/)`, `sub=parts[0]`, `arg=parts[1]`), then per-subcommand blocks — copy the `devmodels` shape `:884-890` (`if (arg !== "on" && arg !== "off") return "bench: invalid ..."; const ok = await setX(arg); ... return reply`). Add `sub === "route"` with `arg ∈ {cpu,gpu,auto}` + one line in `BENCH_USAGE` / `formatBenchStatus` (`:799`).
- **Persistence:** new `export const BENCH_ROUTE_KEY = "kalsa.bench.route"` beside `benchConfig.ts:52-65` (pattern: `BENCH_*` keys, AsyncStorage `setItem`/`removeItem` for `auto`); documented init-time knobs are `benchConfig.ts:19-22` — `/bench route` is deliberately **not** one (runtime push, no relaunch).
- **Per-turn push:** `refreshGovernorBeforeCompletion` `src/engine/LlamaService.ts:1770-1805` — inside the gate `if (activeGovernorActive && engine === context)` (`:1775`), right after the `setGovernorThermo` call (`:1777-1790`), add `engine.setPrefillOverride(await readBenchRoute())`. Call sites: turn top `:5022` (and `:4938` refreshThermo hook, utilities `:6133/:6370/:6493`). Since the app pushes the stored mode before **every** completion, "next turn" semantics = key written by `/bench route`, `auto` pushes `0` and clears — no engine-side auto-clear needed.
- **KALSA_GOVERNOR log:** `emitGovernorTelemetry` `LlamaService.ts:1807-1855`; JSON at `:1819-1844` (existing keys `engine_prefill`, `prefill_ms`, `prefill_chunks`, `forced`, `thermal_state`, ...). Called at `:5236` and `:5673`, both inside `streamAssistantTurn` with `turnId` in scope (`const turnId = String(++turnSeq);` `:4219`). Add params `turnId` (pass at both sites), then keys `turnId`, `route_mode` (echo of the pushed override / `stats.engine_prefill`), `route_chunks` (new stats array). Join targets: `KALSA_TELEMETRY` already carries `turnId` (`turnTelemetry.ts` formatTelemetryLine), `KALSA_WINDOW` gains `turnId` per spec (old app site `AppShell.tsx:6524-6534` → now `src/host/engineTurnStream.ts:122` block).

## Risks / open
- Engine HEAD moves: the chunk loop and `admit_prefill` gained the `n_batch` cap + below-warn floor since the spec was written — re-read `runtime.cpp:64-154` before editing.
- `refresh_policy_stats()` must run after the setter or `stats_.prefill_engine`/`last_router_rule` lag one call (runtime.cpp:43-53).
- Rejection rule (spec: actual ≠ requested ⇒ reject) belongs app-side: compare `route_chunks[i].requested/actual` in `emitGovernorTelemetry` or post-process offline; engine never auto-switches mid-turn (latch comment `llama-governor.h:59-61`).
- Force-GPU while `gpu_fit != Fit` or `!gpu_prefill_measured` will still land CPU via :166-171 / :174-178 — report `route_mode` vs `engine_prefill` rather than treating it as failure of the hook (safety gate precedence is the spec's requirement).
