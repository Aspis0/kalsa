NO

# Independent audit — governor admission floor

Read-only source review. No builds or tests were run, as requested.

## Blocking finding

### CONFIRMED — warm prefill lengths ending in one token still pause

At 39.9 °C (and 39.99 °C), the floor makes the 128-token row survive. A 129-token batch is planned as 128 plus a one-token remainder. The policy admits that one-token tail, but the runtime rejects every planned chunk of size one with `-2`, before executing any chunk. `decode_impl` propagates that flow-control result. The same deterministic failure occurs for lengths congruent to 1 modulo 128 while the floor selects 128, including 257.

The public decode path enables runtime chunking (`src/llama-governor.cpp:227-228`):

> return decode_impl(batch, true);

src/llama-governor-policy.cpp:216-224

> const bool below_warn = now_c < k_warn_c;
> while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) {
>     if (table == 1 && below_warn) {
>         break;
>     }
>     --table;
> }
> if (table == 0) {
>     if (prompt_tokens < k_table_tokens[0] && below_warn) {

src/llama-governor-policy.cpp:224-242

> if (prompt_tokens < k_table_tokens[0] && below_warn) {
>     result.tokens = prompt_tokens;
>     ...
>     result.decision = requested == llama_governor_engine::CPU
>         ? llama_governor_decision::Admit : llama_governor_decision::CPUFallback;
> ...
> result.tokens = k_table_tokens[table - 1];
> if (result.tokens != prompt_tokens) {
>     result.decision = llama_governor_decision::Chunk;

src/llama-governor-runtime.cpp:94-114

> int32_t remaining = batch.n_tokens;
> while (remaining > 0) {
>     const auto next = policy_.admit_prefill(
>             policy_.prefill_engine(), static_cast<uint32_t>(remaining),
>             policy_.current_temperature_c());
>     ...
>     const int32_t count = std::min<int32_t>(next.tokens, remaining);
>     if (count <= 1) {
>         return -2;
>     }
>     chunk_sizes.push_back(count);
>     remaining -= count;
> }

src/llama-governor.cpp:253-256

> const int32_t policy_rc = is_prefill ? admit_prefill(batch, allow_chunking) : select_decode();
> if (policy_rc != 0) {
>     return policy_rc == k_prefill_chunked ? 0 : policy_rc;
> }

This fix therefore does not make all below-40 °C prefills proceed. The new end-to-end case uses 305 tokens, whose remainder is 49, and misses the one-token tail (`tests/test-governor-v0-turns.cpp:260-273`). Add a 129-token runtime case; handle its last token as decode or choose a legal partition that avoids a singleton.

That singleton path returns `-2` without the new pause warning (`src/llama-governor-runtime.cpp:109-110`), so warning-line instruments will not see this failure.

## Admission boundaries and precedence

### CONFIRMED — intended threshold arithmetic, with a deliberate headroom bypass

The comparison is strict: 39.99 is below the floor and 40.0 is not. At 40.0, the 128 row fails `40.0 + 1.9 <= 39.5`, the floor does not break the loop, and admission waits. Below 40, the floor deliberately admits the 128 row even when its unmeasured delta projects above `k_limit_c`; at 39.99 that projection is 41.89 °C. This follows the owner decision, but the new logic chooses `k_warn_c` over the existing `k_limit_c` headroom.

src/llama-governor-policy.cpp:10-15

> constexpr float k_warn_c = 40.0f;
> constexpr float k_limit_c = k_warn_c - 0.5f;
> constexpr uint32_t k_table_tokens[] = { 128, 512, 1024, 2048 };
> constexpr float k_cpu_delta_c[] = { 1.9f, 3.25f, 3.25f, 5.15f };

src/llama-governor-policy.cpp:216-242

> const bool below_warn = now_c < k_warn_c;
> ...
> result.tokens = k_table_tokens[table - 1];
> if (result.tokens != prompt_tokens) {
>     result.decision = llama_governor_decision::Chunk;

Prompts 2–127 pass whole below 40; 128 selects the exact 128 row; zero is rejected before the floor (`src/llama-governor-policy.cpp:199-204`). A one-token input is classified as decode, not prefill (`src/llama-governor.cpp:246`). There is no 39.99 or exact-128 test; the router tests use 39.9, 40.0, 2, and 5000 (`tests/test-governor-v02-router.cpp:367-392`).

### PLAUSIBLE — NaN can bypass the internal policy helper, but not the runtime input path

`admit_prefill()` does not validate its `now_c` argument. With a valid policy profile and a direct internal call using NaN, both `< k_warn_c` and `NaN + delta > k_limit_c` are false, so prompts of at least 128 tokens retain their largest table row. The runtime obtains `now_c` from an `int32_t` tenths-Celsius field divided by 10, so its input cannot be NaN. This is helper hardening, not a reachable binding path found here.

src/llama-governor-policy.cpp:195-217, 279

> llama_governor_engine requested, uint32_t prompt_tokens, float now_c) const {
> ...
> const bool below_warn = now_c < k_warn_c;
> while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) {
> ...
> float llama_governor_policy::current_temperature_c() const { return temperature_c(profile_); }

src/llama-governor-policy.cpp:22-23; src/llama-ext.h:270-271

> float temperature_c(const llama_governor_thermo_profile & profile) {
>     return profile.batt_temp_tenths_c / 10.0f;
> }
> int32_t batt_temp_tenths_c = 0;

### CONFIRMED, pre-existing — a negative battery reading marked valid is accepted

For an unplugged profile, `profile_is_valid()` checks `sensor_valid`, trend, and battery-level bounds but no battery-temperature range. A caller that marks a negative battery reading valid gets a negative `now_c`; the policy classifies it as cool and admits. The former delta comparison also admitted such readings, so this is not introduced by the floor.

src/llama-governor-policy.cpp:22-23, 53-61

> return profile.batt_temp_tenths_c / 10.0f;
> if (!profile.sensor_valid || !std::isfinite(profile.trend_c_per_min)) {
> ...
> if (profile.batt_level_pct < 0 || profile.batt_level_pct > 100) {
> ...
> if (!profile.plugged) {
>     return true;

src/llama-governor-policy.cpp:69-80

> if (temperature >= k_kill_c || temperature >= limits.critical_enter) {
>     return llama_governor_thermal_state::CRITICAL;
> ...
> return llama_governor_thermal_state::FAST;

8eac584bb `src/llama-governor-policy.cpp:211-216`

> while (table > 0 && now_c + k_cpu_delta_c[table - 1] > k_limit_c) {
>     --table;
> }

### REFUTED — the floor itself does not override the initial state gate or GPU routing policy

Invalid/CRITICAL state aborts, while the no-profile/Unknown startup path waits, before `below_warn` is read. LOWBAT is not rejected by this policy gate, but `prefill_engine()` selects CPU for LOWBAT; after a successful admission runtime latches that CPU route. The floor does not turn that request into GPU.

src/llama-governor-policy.cpp:160-165

> if (!valid_schema(params_) || !profile_valid_ || !have_profile_ ||
>     state_ == llama_governor_thermal_state::CRITICAL || state_ == llama_governor_thermal_state::Invalid ||
>     state_ == llama_governor_thermal_state::LOWBAT) {
>     return llama_governor_engine::CPU;

src/llama-governor-policy.cpp:199-204

> if (!profile_valid_ || !have_profile_ || state_ == llama_governor_thermal_state::Invalid ||
>     state_ == llama_governor_thermal_state::CRITICAL || prompt_tokens == 0) {
>     result.decision = state_ == llama_governor_thermal_state::Invalid ||
>                       state_ == llama_governor_thermal_state::CRITICAL
>         ? llama_governor_decision::Abort : llama_governor_decision::Wait;

src/llama-governor-policy.h:62

> llama_governor_thermal_state state_ = llama_governor_thermal_state::Unknown;

src/llama-governor-runtime.cpp:62-65, 78-80

> const auto requested = policy_.prefill_engine();
> ...
> prefill_route_ = requested == llama_governor_engine::CPU ? prefill_route::CPU : prefill_route::GPU;

### PLAUSIBLE — short GPU admissions carry a CPUFallback decision that runtime ignores

Below 40 °C, a GPU request shorter than 128 gets `decision=CPUFallback` and `engine=CPU` by default; the runtime first latches the requested GPU route, then treats `CPUFallback` as success and continues with that route. This is an existing policy/runtime mismatch, newly exercised by the floor for short warm prompts. LOWBAT still requests CPU; the ambiguity is whether these short GPU prompts were meant to fall back or stay on GPU.

src/llama-governor-policy.cpp:197-198, 223-228

> llama_governor_prefill_admission result{};
> result.engine = llama_governor_engine::CPU;
> ...
> result.decision = requested == llama_governor_engine::CPU
>     ? llama_governor_decision::Admit : llama_governor_decision::CPUFallback;

src/llama-governor-runtime.cpp:78-85

> prefill_route_ = requested == llama_governor_engine::CPU ? prefill_route::CPU : prefill_route::GPU;
> ...
> if (admission.decision == llama_governor_decision::CPUFallback) {
>     return 0;
> }

### CONFIRMED, pre-existing — an already-latched CPU route skips later state checks

This is a pre-existing runtime edge, not introduced by the floor. If a caller sends successive prefill batches, updates the profile between calls, and the prior call left `last_phase == Prefill` with `prefill_route_ == CPU`, the next call neither resets the route nor reaches the Invalid/CRITICAL gate. It proceeds on the decode context. The threading contract permits sequential profile updates between decode calls; it only forbids overlap. The engine API permits this sequence.

src/llama-governor.cpp:246-249

> if (is_prefill && allow_chunking && last_phase != phase::Prefill) {
>     prefill_route_ = prefill_route::Undecided;

src/llama-governor.cpp:303-305

> record_side(target, *state, is_prefill, batch.n_tokens);
> last_ctx = target;
> last_phase = next_phase;

src/llama-governor-runtime.cpp:57-60

> if (prefill_route_ == prefill_route::CPU) {
>     return 0;

src/llama-governor.cpp:259-261, 285-286

> const bool cpu_prefill = is_prefill && prefill_route_ == prefill_route::CPU;
> llama_context * target = cpu_prefill ? ctx_decode : (is_prefill ? ctx_prefill : ctx_decode);
> const int32_t rc = llama_decode(target, batch);

src/llama-governor.h:15-17

> // Threading contract: decode(), set_thermo_profile(), record_telemetry(),
> // note_expert_route(), and stats() are decode-thread methods and must not overlap.
> // stall_enter()/stall_exit() are the only worker-thread callbacks; they are mutex-protected.

src/llama-governor-runtime.cpp:197-202

> bool llama_governor::set_thermo_profile(const llama_governor_thermo_profile & profile, int64_t now_ms) {
>     const bool ok = policy_.update_thermal(profile, now_ms);
>     refresh_policy_stats();

### REFUTED — no supported mid-loop temperature race, infinite loop, zero chunk, or oversize chunk

`decode()` and `set_thermo_profile()` may not overlap. Chunk planning and execution are synchronous inside the decode call, so the stored temperature cannot change during that loop under the contract. `next.tokens == 0` is rejected, `count <= 1` returns, each accepted count is positive and subtracted from `remaining`, and `min()` prevents an oversize chunk. The `Wait` branch at runtime lines 104–106 would return 0 to the outer decoder if the temperature changed during planning, but that requires violating the threading contract. The confirmed singleton-tail failure above is finite and returns `-2`.

src/llama-governor-runtime.cpp:97-113

> if (next.decision == llama_governor_decision::Abort || next.tokens == 0) {
> ...
> if (next.decision == llama_governor_decision::Wait) {
>     return 0;
> }
> const int32_t count = std::min<int32_t>(next.tokens, remaining);
> if (count <= 1) {
>     return -2;
> }
> remaining -= count;

## Test changes

### CONFIRMED — expectation rewrites are authorized; tests are red-capable, with a coverage hole

The old 37.9 °C CPU and 38.1 °C GPU `Wait` assertions directly contradicted the owner’s new below-40 rule, so rewriting them to `Chunk/128` is legitimate. The new router `check()` increments `failures`, and `main()` returns 1 on any failure; the end-to-end warm case returns false through `run()` and `main()` returns 1. These are capable of going red for the intended regression, not green-only. They still miss length 129 / singleton tails, exact 128, and 39.99.

8eac584bb `tests/test-governor-v02-router.cpp:280-281`

> check(policy.admit_prefill(llama_governor_engine::CPU, 2048, 37.9f).decision ==
>       llama_governor_decision::Wait, "2048 CPU from 37.9 is rejected");

497ca1cc `tests/test-governor-v02-router.cpp:280-282`

> check(warm_2048.decision == llama_governor_decision::Chunk && warm_2048.tokens == 128,
>       "2048 CPU from 37.9 falls to the smallest row below the warn line");

8eac584bb `tests/test-governor-v02-router.cpp:308-309`; 497ca1cc `:309-311`

> check(policy.admit_prefill(llama_governor_engine::GPU, 305, 38.1f).decision ==
>       llama_governor_decision::Wait, "hot GPU prefill remains a policy Wait");
> const auto warm_gpu = gpu_policy.admit_prefill(llama_governor_engine::GPU, 305, 38.1f);
> check(warm_gpu.decision == llama_governor_decision::Chunk && warm_gpu.tokens == 128,

tests/test-governor-v02-router.cpp:23-28, 478-483

> if (!condition) {
>     std::fprintf(stderr, "router-v02: FAIL %s\n", name);
>     ++failures;
> }
> if (failures != 0) {
>     return 1;
> }

tests/test-governor-v0-turns.cpp:770-773, 940-943

> if (!run_warm_prefill_admits(model.get())) { return false; }
> return ok ? 0 : 1;

No tests were run.

## Log privacy and instrumentation

### CONFIRMED — stable prefix, no prompt or model content

The old warn’s bytes through `pausing` are preserved; the new line appends a space and numeric temperature plus a static enum name. That preserves a prefix/substring parser, not a full-line equality parser. The new fields contain no tokens, prompt, or generated text.

8eac584bb `src/llama-governor-runtime.cpp:56`

> LLAMA_LOG_WARN("%s: no safe prefill chunk under the thermal ceiling; pausing\n", __func__);

497ca1cc `src/llama-governor-runtime.cpp:73-75`

> LLAMA_LOG_WARN("%s: no safe prefill chunk under the thermal ceiling; pausing "
>                "(now_c=%.1f state=%s)\n",
>                __func__, now_c, thermal_state_name(policy_.thermal_state()));

`thermal_state_name()` returns only fixed enum labels (`src/llama-governor-runtime.cpp:12-22`). The incident capture records the old stable substring (`scratchpad/agents/s23-single-apk/RECON-ADMISSION.md:12`); this change preserves that prefix but not a full-line exact match.

## Binding sync

### CONFIRMED — only engine logic and version stamps changed; logic is byte-identical

The binding commit’s changed paths are exactly the two vendored governor sources; `vendor/VERSIONS`; vendor `common/build-info.cpp`, `ggml-version.h`, and `llama-version.h`; and `src/version.ts` plus its CommonJS, module, and TypeScript outputs. No other `vendor/` path changed. `cmp` against engine commit `497ca1cc` returned 0 for both vendored policy and runtime sources.

`vendor/VERSIONS:7-9`

> LLAMA_CPP_REPO=https://github.com/Aspis0/kalsallama
> LLAMA_CPP_REF=497ca1ccacae82f7383a70135b1d1b3f181a0c0b
> LLAMA_CPP_COMMIT=497ca1ccacae82f7383a70135b1d1b3f181a0c0b

`src/version.ts:1-2`; `vendor/llama.cpp/common/build-info.cpp:6-7`; `vendor/llama.cpp/ggml/src/ggml-version.h:3-4`; `vendor/llama.cpp/src/llama-version.h:3-4`

> export const BUILD_NUMBER = '11222'
> export const BUILD_COMMIT = '497ca1c'
> int LLAMA_BUILD_NUMBER = 11222;
> char const * LLAMA_COMMIT = "497ca1c";
> #define GGML_COMMIT  "497ca1c"
> #define LLAMA_COMMIT  "497ca1c"

The three generated JS version outputs also say `11222` / `497ca1c` (`lib/commonjs/version.js:7-8`, `lib/module/version.js:3-4`, `lib/typescript/version.d.ts:1-2`).

## Dead code

### REFUTED — no new dead helper or flag found

`thermal_state_name()` is called by the new warning (`src/llama-governor-runtime.cpp:75`); `below_warn` controls both the row-floor break and short-tail admission (`src/llama-governor-policy.cpp:218, 224`). No new dead code found.

> __func__, now_c, thermal_state_name(policy_.thermal_state()));
> if (table == 1 && below_warn) {
> if (prompt_tokens < k_table_tokens[0] && below_warn) {
